//! CHA retrieval-path benchmark: the filename-signal scan and its
//! per-name allocation churn.
//!
//! `rank_filenames` runs a linear scan over every visible basename per
//! fused-semantic query. The module doc claims "low tens of ms at 100k";
//! this file measures the real per-query cost at 20k synthetic names
//! (multiply ×5 for the 100k claim) across three query shapes — a token
//! hit, a prune-heavy miss, and a long whole-name query.
//!
//! It also isolates one concrete allocation waste inside the scan:
//! `tokenize` builds the full token Vec, then runs a *second* pass
//! (`tokens.iter().map(to_lowercase).collect()`) producing a second
//! Vec<String> — 2 Vecs + 2N Strings per basename per query. The fused
//! variant lowercases at flush time (same `str::to_lowercase`, same
//! content, same Unicode behaviour) in one pass. `tokenize` is private, so
//! the current shape is replicated verbatim here and the two are checked
//! for exact output equality over the whole corpus plus adversarial cases
//! before timing.
//!
//! Assertions pin equivalence only; timings print with `--nocapture`.

use mnemosyne::cosine::name_match::{rank_filenames, NameQuery, DEFAULT_NAME_MATCH_THRESHOLD};
use std::time::Instant;

const N: usize = 20_000;

/// Synthetic corpus with the shapes the matcher handles: camelCase,
/// separators, digits, plain lowercase runs.
fn corpus() -> Vec<(i64, String)> {
    (0..N as i64)
        .map(|i| {
            let name = match i % 4 {
                0 => format!("DrMundo_{i}_StreetDemonsDrMundo.jpg"),
                1 => format!("sunset_over_the_bay_{i}.png"),
                2 => format!("ChampionSplash{i}Final.webp"),
                _ => format!("img{i}.jpeg"),
            };
            (i, name)
        })
        .collect()
}

fn median_ms<F: FnMut()>(reps: usize, mut f: F) -> f64 {
    let mut times: Vec<f64> = (0..reps)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    times[times.len() / 2]
}

#[test]
fn rank_filenames_per_query_cost_at_20k() {
    let names = corpus();

    let run = |label: &str, query: &str, expect_nonempty: bool| {
        let q = NameQuery::new(query).unwrap();
        let ms = median_ms(5, || {
            let r = rank_filenames(&q, &names, DEFAULT_NAME_MATCH_THRESHOLD, 150);
            if expect_nonempty {
                assert!(!r.is_empty(), "query '{query}' should match the corpus");
            }
        });
        println!("rank_filenames({label:>18}) over {N} names: {ms:.2} ms");
    };

    println!("=== cha_ret name-match scan (N={N}; scale x5 for the 100k doc claim) ===");
    run("token hit", "mundo", true);
    run("prune-heavy miss", "qzx", false);
    run("long whole-name", "drmundo_1000_streetdemonsdrmundo", true);
}

// --- tokenize shapes ------------------------------------------------------

/// Verbatim replica of the private `name_match::tokenize` (current shape:
/// build raw tokens, then a second lowercasing pass into a second Vec).
fn tokenize_current(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    for c in s.chars() {
        if !c.is_alphanumeric() {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            prev = None;
            continue;
        }
        if let Some(p) = prev {
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

/// Candidate shape: lowercase at flush time — one pass, one Vec, and the
/// raw-token Strings never outlive their flush. Identical output: the same
/// `str::to_lowercase` runs on the same token content.
fn tokenize_fused(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    for c in s.chars() {
        if !c.is_alphanumeric() {
            if !cur.is_empty() {
                tokens.push(cur.to_lowercase());
                cur.clear();
            }
            prev = None;
            continue;
        }
        if let Some(p) = prev {
            let camel = p.is_lowercase() && c.is_uppercase();
            let digit_boundary = p.is_alphabetic() != c.is_alphabetic();
            if (camel || digit_boundary) && !cur.is_empty() {
                tokens.push(cur.to_lowercase());
                cur.clear();
            }
        }
        cur.push(c);
        prev = Some(c);
    }
    if !cur.is_empty() {
        tokens.push(cur.to_lowercase());
    }
    tokens
}

#[test]
fn tokenize_single_pass_lowercase_is_equivalent_and_cheaper() {
    // Equivalence sweep: the whole synthetic corpus plus adversarial shapes
    // (Unicode casing incl. the dotted capital I whose to_lowercase grows
    // the string, digits, camel runs, separators-only, leading dot).
    let names = corpus();
    for (_, n) in &names {
        assert_eq!(tokenize_current(n), tokenize_fused(n), "corpus name: {n}");
    }
    for s in [
        "DrMundo_21_StreetDemonsDrMundo",
        "İstanbulPhoto2024",
        "ÉcoleÉtéÀParis",
        "___",
        ".gitignore",
        "ABCdefGHI123jkl",
        "ẞharp",
        "photo—dash–test",
    ] {
        assert_eq!(tokenize_current(s), tokenize_fused(s), "case: {s}");
    }

    let cur_ms = median_ms(5, || {
        let mut total = 0usize;
        for (_, n) in &names {
            total += tokenize_current(n).len();
        }
        assert!(total > 0);
    });
    let fused_ms = median_ms(5, || {
        let mut total = 0usize;
        for (_, n) in &names {
            total += tokenize_fused(n).len();
        }
        assert!(total > 0);
    });

    println!("=== cha_ret tokenize shape ({N} names/pass) ===");
    println!("current (2 passes, 2 Vecs, 2N Strings): {cur_ms:.2} ms");
    println!("fused   (1 pass, 1 Vec, N Strings):     {fused_ms:.2} ms");
    println!(
        "delta: {:.2} ms ({:+.0}%)",
        fused_ms - cur_ms,
        100.0 * (fused_ms - cur_ms) / cur_ms
    );
}
