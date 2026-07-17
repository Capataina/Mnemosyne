//! Fuzzy filename matching — the 4th signal fused into search alongside
//! the three encoders (CLIP, SigLIP-2, DINOv2).
//!
//! ## Why this exists
//!
//! The encoders answer "what does this image look like / mean". None of
//! them can answer "the file is literally called
//! `DrMundo_21_StreetDemonsDrMundo.jpg` — find it by name", nor tolerate
//! a typo in that name (`mvndo` → `mundo`). This module scores every
//! image's basename against the query and produces a ranked list in the
//! exact `(image_id, score)` shape [`super::rrf::RankedList`] consumes,
//! so filename relevance weighs into the *same* Reciprocal Rank Fusion
//! as the encoders rather than being a separate code path.
//!
//! Two properties fall out of scoring names rather than embeddings:
//!
//! - **It needs no embedding.** An image that has never been encoded (a
//!   fresh index still mid-encode, a re-enabled encoder) still surfaces
//!   by name. The encoders can only rank what they have already embedded;
//!   the filename signal ranks the whole visible catalogue.
//! - **It is dependency-free.** The matcher below is a small
//!   Levenshtein + tokeniser, no fuzzy-search crate pulled in.
//!
//! ## How a basename is scored
//!
//! The score is the max of three complementary strategies, each catching
//! a query shape the others miss (all case-insensitive, extension
//! stripped):
//!
//! 1. **Containment** — the query, stripped to alphanumerics, appears
//!    verbatim inside the name. Catches fragment search ("mundo" inside
//!    "drmundostreetdemons") even when the name has no separators to
//!    tokenise on.
//! 2. **Token match** — the name is split on separators (`_ - .`, space)
//!    AND camelCase / letter↔digit boundaries into lowercase tokens, and
//!    the query is fuzzily compared against each. This is what lets
//!    "mundo" hit `DrMundoStreetDemons` (token `mundo`) and tolerates the
//!    "mvndo" typo (normalised edit similarity 0.8 against `mundo`).
//! 3. **Whole-name match** — the query fuzzily compared against the whole
//!    stem, so an exact or near-exact full filename scores ~1.0.
//!
//! ## Cost
//!
//! `rank_filenames` is a linear scan over the N visible basenames, each
//! costing a handful of Levenshtein DPs over short strings. The
//! expensive whole-name DP is length-pruned (a query far shorter than a
//! name cannot clear the acceptance floor, so its DP is skipped and only
//! the cheap token/containment checks run). At a few thousand images this
//! is sub-millisecond; at 100k it is a low-tens-of-ms scan — acceptable
//! for a per-query cost, and noted honestly rather than indexed.

/// Default acceptance floor for a name match, in [0, 1]. A basename
/// scoring below this is not considered a candidate at all (it never
/// enters the ranked list). 0.72 keeps single-substitution typos in a
/// short token (`mvndo`→`mundo` = 0.8) while rejecting coincidental
/// overlap; tuned to the brief's "~0.7–0.75 is fine".
pub const DEFAULT_NAME_MATCH_THRESHOLD: f32 = 0.72;

/// Below this similarity a match is never accepted at any sane threshold,
/// so the length-based prune in [`norm_lev_sim`] can early-return 0.0
/// whenever the two lengths differ enough that the similarity *ceiling*
/// (`1 − |la−lb| / max_len`) already falls under it. Kept comfortably
/// below [`DEFAULT_NAME_MATCH_THRESHOLD`] so the prune can only ever drop
/// pairs that would have been rejected anyway.
const PRUNE_FLOOR: f32 = 0.5;

/// Minimum query length (alphanumeric chars) for the containment
/// strategy to fire. A 1–2 char fragment is inside almost every name, so
/// gating containment at 3 avoids flooding the ranked list with noise
/// while still serving genuine fragment search.
const MIN_CONTAINMENT_LEN: usize = 3;

/// A query pre-normalised once so a catalogue scan does not re-lowercase
/// and re-filter the query per image. Construct with [`NameQuery::new`]
/// (returns `None` for an empty/whitespace query) and reuse across every
/// basename via [`NameQuery::score`].
#[derive(Debug, Clone)]
pub struct NameQuery {
    /// Lowercased, trimmed query with its separators intact — compared
    /// against the whole stem so an exact full filename scores ~1.0.
    lower: String,
    /// Lowercased query reduced to alphanumerics only — compared against
    /// tokens and used for containment, so `dr-mundo` and `drmundo` and
    /// `Dr Mundo` all behave the same.
    alnum: String,
}

impl NameQuery {
    /// Build a reusable query. Returns `None` when the query is empty or
    /// all-whitespace (nothing to match), so callers can skip the scan
    /// entirely.
    pub fn new(query: &str) -> Option<Self> {
        let lower = query.trim().to_lowercase();
        if lower.is_empty() {
            return None;
        }
        let alnum: String = lower.chars().filter(|c| c.is_alphanumeric()).collect();
        Some(Self { lower, alnum })
    }

    /// Score a single basename against the query, in [0, 1]. The max of
    /// the three strategies documented at module level; 0.0 means "no
    /// meaningful name overlap".
    pub fn score(&self, basename: &str) -> f32 {
        // Keep the raw (case-preserving) stem for tokenisation — the
        // camelCase boundary is the whole point of splitting `DrMundo`
        // into `dr`,`mundo`, and lowercasing first would erase it.
        let raw_stem = strip_ext(basename);
        let stem_lower = raw_stem.to_lowercase();
        let stem_alnum: String = stem_lower.chars().filter(|c| c.is_alphanumeric()).collect();

        let mut best = 0.0f32;

        // Strategy 1 — containment (fragment search).
        if self.alnum.len() >= MIN_CONTAINMENT_LEN && stem_alnum.contains(&self.alnum) {
            // Grade by how much of the name the fragment covers so a
            // tight match (query ≈ whole name) outranks a fragment buried
            // in a long name, while still keeping any containment well
            // above threshold.
            let coverage = self.alnum.len() as f32 / stem_alnum.len().max(1) as f32;
            best = best.max(0.7 + 0.3 * coverage);
        }

        // Strategy 2 — token match (camelCase split + typo tolerance).
        for token in tokenize(raw_stem) {
            best = best.max(norm_lev_sim(&self.alnum, &token));
            if best >= 1.0 {
                return 1.0; // Perfect token hit; nothing can beat it.
            }
        }

        // Strategy 3 — whole-name match (exact / near-exact filename).
        best = best.max(norm_lev_sim(&self.lower, &stem_lower));
        best = best.max(norm_lev_sim(&self.alnum, &stem_alnum));

        best
    }
}

/// Rank a catalogue of `(image_id, basename)` by filename similarity to
/// the query, keeping only matches at or above `threshold`, sorted
/// high-to-low, and truncated to `limit`. The return is the
/// `(image_id, score)` item shape a [`super::rrf::RankedList`] wraps, so
/// the caller feeds it straight into the same fusion as the encoders.
///
/// An empty return (nothing cleared the threshold) is the load-bearing
/// case for fusion equivalence: the caller pushes no list, so a search
/// whose query matches no names fuses exactly the encoder lists it would
/// have without this signal.
pub fn rank_filenames(
    query: &NameQuery,
    names: &[(i64, String)],
    threshold: f32,
    limit: usize,
) -> Vec<(i64, f32)> {
    if limit == 0 {
        return Vec::new();
    }
    let mut scored: Vec<(i64, f32)> = names
        .iter()
        .filter_map(|(id, name)| {
            let s = query.score(name);
            (s >= threshold).then_some((*id, s))
        })
        .collect();
    // Descending by score; ties broken by id for a deterministic order
    // (the unstable sort would otherwise pick arbitrarily among equal
    // scores, making tests flaky — same lesson as rrf's tie-break note).
    scored.sort_unstable_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });
    scored.truncate(limit);
    scored
}

/// A basename with its final extension removed, case preserved.
/// `Photo.JPG` → `Photo`; a dotless name is returned whole; a
/// leading-dot name (`.gitignore`) keeps its body since there is no
/// stem/extension split to make.
fn strip_ext(basename: &str) -> &str {
    match basename.rsplit_once('.') {
        // A leading dot with nothing before it is not an extension split.
        Some((stem, _ext)) if !stem.is_empty() => stem,
        _ => basename,
    }
}

/// Split a *raw* (case-preserving) stem into lowercase alphanumeric
/// tokens, breaking on every separator plus camelCase and letter↔digit
/// transitions, then lowercasing each token. So the original-cased
/// `DrMundo_21_StreetDemonsDrMundo` yields
/// `["dr","mundo","21","street","demons","dr","mundo"]`, and an
/// all-lowercase `drmundo_21_streetdemons` (no camel boundary to use)
/// yields `["drmundo","21","streetdemons"]` on separators and the digit
/// boundary alone. Empty tokens are dropped.
///
/// Must be called on the raw name, not a lowercased one — lowercasing
/// first erases the `Dr|Mundo` boundary that makes `mundo` an exact
/// token.
fn tokenize(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    for c in s.chars() {
        if !c.is_alphanumeric() {
            // Separator — flush the current token.
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            prev = None;
            continue;
        }
        if let Some(p) = prev {
            // camelCase (`r|M`) and letter↔digit (`o|2`) boundaries both
            // split a run that has no separator.
            let camel = p.is_lowercase() && c.is_uppercase();
            let digit_boundary = p.is_alphabetic() != c.is_alphabetic();
            if (camel || digit_boundary) && !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
        }
        cur.push(c);
        prev = Some(c);
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens.iter().map(|t| t.to_lowercase()).collect()
}

/// Normalised Levenshtein similarity in [0, 1]: `1 − dist / max_len`.
/// Identical strings → 1.0; either empty (and the other not) → 0.0.
///
/// Length prune: the similarity ceiling for two strings is
/// `1 − |la − lb| / max_len` (you cannot do better than the length
/// difference forces). When that ceiling already sits under
/// [`PRUNE_FLOOR`], the true similarity is below every sane threshold, so
/// we skip the O(la·lb) DP and return 0.0 — the optimisation that keeps
/// the whole-name comparison cheap for a short query against a long name.
fn norm_lev_sim(a: &str, b: &str) -> f32 {
    let la = a.chars().count();
    let lb = b.chars().count();
    if la == 0 || lb == 0 {
        return 0.0;
    }
    let max_len = la.max(lb);
    let ceiling = 1.0 - (la.abs_diff(lb) as f32) / max_len as f32;
    if ceiling < PRUNE_FLOOR {
        return 0.0;
    }
    let dist = levenshtein(a, b);
    1.0 - dist as f32 / max_len as f32
}

/// Classic two-row Levenshtein edit distance. O(la·lb) time, O(min) extra
/// space by keeping only the previous and current DP rows. Operates over
/// `char`s so multi-byte UTF-8 (accents in filenames) counts as one edit
/// rather than several bytes.
fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur: Vec<usize> = vec![0; b.len() + 1];
    for (i, &ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, &cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            cur[j + 1] = (prev[j + 1] + 1) // deletion
                .min(cur[j] + 1) // insertion
                .min(prev[j] + cost); // substitution
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn score(query: &str, name: &str) -> f32 {
        NameQuery::new(query).unwrap().score(name)
    }

    #[test]
    fn empty_query_is_none() {
        assert!(NameQuery::new("").is_none());
        assert!(NameQuery::new("   ").is_none());
    }

    #[test]
    fn exact_full_filename_scores_perfect() {
        // The user's exact-name case — including the extension, which the
        // matcher strips before comparing.
        let s = score(
            "DrMundo_21_StreetDemonsDrMundo",
            "DrMundo_21_StreetDemonsDrMundo.jpg",
        );
        assert!(s >= 0.99, "exact filename should score ~1.0, got {s}");
    }

    #[test]
    fn single_char_typo_clears_threshold() {
        // "mvndo" vs the token "mundo": one substitution in five chars →
        // 1 - 1/5 = 0.8, comfortably over the 0.72 default.
        let s = score("mvndo", "DrMundo_21_StreetDemonsDrMundo.jpg");
        assert!(
            s >= DEFAULT_NAME_MATCH_THRESHOLD,
            "single-char typo should clear threshold, got {s}"
        );
        // And it lands right around the expected 0.8, not accidentally 1.0.
        assert!((0.75..=0.85).contains(&s), "expected ~0.8, got {s}");
    }

    #[test]
    fn token_split_matches_camel_and_lowercase() {
        // camelCase source: "mundo" is an exact token of DrMundoStreetDemons.
        assert!(
            score("mundo", "DrMundoStreetDemons.jpg") >= 0.99,
            "camelCase token should match exactly"
        );
        // All-lowercase source with no separators: containment saves it.
        assert!(
            score("mundo", "drmundostreetdemons.jpg") >= DEFAULT_NAME_MATCH_THRESHOLD,
            "fragment inside a separatorless name should still match"
        );
    }

    #[test]
    fn case_insensitive() {
        let a = score("MUNDO", "drmundostreetdemons.jpg");
        let b = score("mundo", "DRMUNDOSTREETDEMONS.JPG");
        assert!((a - b).abs() < f32::EPSILON, "matching must be case-insensitive");
        assert!(a >= DEFAULT_NAME_MATCH_THRESHOLD);
    }

    #[test]
    fn unrelated_query_is_below_threshold() {
        let s = score("xyzzy", "DrMundo_21_StreetDemonsDrMundo.jpg");
        assert!(
            s < DEFAULT_NAME_MATCH_THRESHOLD,
            "unrelated query must not match, got {s}"
        );
    }

    #[test]
    fn short_fragment_below_containment_gate_does_not_flood() {
        // A 2-char query is below MIN_CONTAINMENT_LEN, so containment does
        // not fire; without a strong token/whole hit it stays low.
        let s = score("mu", "DrMundo_21_StreetDemonsDrMundo.jpg");
        assert!(s < DEFAULT_NAME_MATCH_THRESHOLD, "2-char fragment should not flood, got {s}");
    }

    #[test]
    fn rank_filenames_thresholds_sorts_and_truncates() {
        let q = NameQuery::new("mundo").unwrap();
        let names = vec![
            (1i64, "DrMundoStreetDemons.jpg".to_string()), // exact token → ~1.0
            (2i64, "sunset_over_the_bay.png".to_string()), // no match
            (3i64, "mundo_wallpaper.jpg".to_string()),     // exact token → ~1.0
            (4i64, "random_noise.gif".to_string()),        // no match
        ];
        let ranked = rank_filenames(&q, &names, DEFAULT_NAME_MATCH_THRESHOLD, 10);
        // Only the two mundo names survive the threshold.
        assert_eq!(ranked.len(), 2);
        let ids: Vec<i64> = ranked.iter().map(|(id, _)| *id).collect();
        assert!(ids.contains(&1) && ids.contains(&3));
        assert!(!ids.contains(&2) && !ids.contains(&4));

        // Truncation honours the limit.
        let capped = rank_filenames(&q, &names, DEFAULT_NAME_MATCH_THRESHOLD, 1);
        assert_eq!(capped.len(), 1);

        // limit 0 yields nothing.
        assert!(rank_filenames(&q, &names, DEFAULT_NAME_MATCH_THRESHOLD, 0).is_empty());
    }

    #[test]
    fn empty_when_nothing_matches_preserves_fusion_equivalence() {
        // The load-bearing property for the command: a query matching no
        // name yields an empty ranked list, so the caller pushes nothing
        // and the encoder-only fusion is byte-identical.
        let q = NameQuery::new("qwertyuiop").unwrap();
        let names = vec![
            (1i64, "DrMundoStreetDemons.jpg".to_string()),
            (2i64, "sunset.png".to_string()),
        ];
        assert!(rank_filenames(&q, &names, DEFAULT_NAME_MATCH_THRESHOLD, 10).is_empty());
    }

    #[test]
    fn name_signal_surfaces_an_unencoded_image_through_fusion() {
        // The end-to-end promise: an image no encoder ranked (never
        // embedded) still reaches the fused output purely on its name.
        use crate::cosine::rrf::{reciprocal_rank_fusion, RankedList, DEFAULT_K_RRF};

        // Two encoder lists that know nothing about image 999.
        let clip = RankedList {
            encoder_id: "clip".into(),
            items: vec![(1, 0.9), (2, 0.8), (3, 0.7)],
        };
        let siglip = RankedList {
            encoder_id: "siglip".into(),
            items: vec![(2, 0.85), (4, 0.6)],
        };

        // The filename signal ranks the unencoded image 999.
        let q = NameQuery::new("mundo").unwrap();
        let names = vec![(999i64, "DrMundoStreetDemons.jpg".to_string())];
        let name_items = rank_filenames(&q, &names, DEFAULT_NAME_MATCH_THRESHOLD, 50);
        assert_eq!(name_items.first().map(|(id, _)| *id), Some(999));
        let filename = RankedList {
            encoder_id: "filename".into(),
            items: name_items,
        };

        let fused = reciprocal_rank_fusion(&[clip, siglip, filename], DEFAULT_K_RRF, 10);
        assert!(
            fused.iter().any(|f| f.image_id == 999),
            "unencoded image 999 must surface via the name signal"
        );
    }

    #[test]
    fn appending_a_disjoint_name_list_leaves_encoder_scores_unchanged() {
        // A name list that only ranks ids the encoders never saw must not
        // perturb the fused scores of the encoder-ranked images — the
        // "additive, non-destructive" guarantee at the RRF level.
        use crate::cosine::rrf::{reciprocal_rank_fusion, RankedList, DEFAULT_K_RRF};

        let clip = RankedList {
            encoder_id: "clip".into(),
            items: vec![(1, 0.9), (2, 0.8)],
        };
        let before = reciprocal_rank_fusion(std::slice::from_ref(&clip), DEFAULT_K_RRF, 10);

        let disjoint_name = RankedList {
            encoder_id: "filename".into(),
            items: vec![(500, 0.95), (600, 0.9)],
        };
        let after = reciprocal_rank_fusion(&[clip, disjoint_name], DEFAULT_K_RRF, 10);

        for b in &before {
            let a = after
                .iter()
                .find(|x| x.image_id == b.image_id)
                .expect("encoder image must still be present");
            assert!(
                (a.fused_score - b.fused_score).abs() < f32::EPSILON,
                "encoder image {} score changed: {} → {}",
                b.image_id,
                b.fused_score,
                a.fused_score
            );
        }
    }

    #[test]
    fn tokenize_splits_separators_and_digit_boundaries() {
        let toks = tokenize("drmundo_21_streetdemons");
        assert!(toks.contains(&"drmundo".to_string()));
        assert!(toks.contains(&"21".to_string()));
        assert!(toks.contains(&"streetdemons".to_string()));
    }

    #[test]
    fn levenshtein_basic() {
        assert_eq!(levenshtein("mundo", "mundo"), 0);
        assert_eq!(levenshtein("mvndo", "mundo"), 1);
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("abc", ""), 3);
    }
}
