use super::math::{cosine_similarity, dot_slice, inv_norm, score_cmp_desc};
use super::store::FlatStore;
use crate::db;
use ndarray::Array1;
use rand::prelude::*;
use rayon::prelude::*;
use std::time::Instant;
use tracing::{debug, info, warn};

/// In-memory cosine index for ONE encoder's embeddings.
///
/// **ID-native (T3-2/#6) + flat store (T3-2/#8+#20).** Rows are keyed by
/// database `image_id` and held in a [`FlatStore`] — one id column, one
/// cached inverse-norm column, one row-major f32 block (heap-owned or
/// mmap-backed). Scoring reads block slices and multiplies by cached
/// inverse norms (`dot × q_inv × c_inv`), skipping the per-candidate
/// `sqrt` the old per-call `cosine_similarity` paid.
pub struct CosineIndex {
    /// Public field name preserved: the untouchable indexing pipeline
    /// reads `idx.cached_images.is_empty()` and the command layer reads
    /// `.len()`. The storage underneath is now the flat store.
    pub cached_images: FlatStore,
    /// Encoder id this store was populated for. Set by
    /// `populate_from_db_for_encoder`; drives which file `save_to_disk`
    /// writes. `None` for a hand-built index (`add_image`).
    pub(crate) encoder_id: Option<String>,
    /// Generation token captured at populate time
    /// (`db::embedding_generation_token`) — written into the persisted
    /// store header so a stale file is detected and rebuilt on load.
    pub(crate) gen_token: u64,
}

impl Default for CosineIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl CosineIndex {
    pub fn new() -> Self {
        CosineIndex {
            cached_images: FlatStore::new(),
            encoder_id: None,
            gen_token: 0,
        }
    }

    pub fn add_image(&mut self, image_id: i64, embedding: Array1<f32>) {
        match embedding.as_slice() {
            Some(s) => self.cached_images.push_owned(image_id, s),
            None => self.cached_images.push_owned(image_id, &embedding.to_vec()),
        }
    }

    /// Populate the in-memory index from the per-encoder embeddings
    /// table, picking only rows for the given encoder_id.
    ///
    /// Used by the encoder-picker dispatch: when the user switches
    /// the chosen image encoder, the cache is wiped and repopulated
    /// from this method. The on-disk embeddings stay intact (one row
    /// per (image_id, encoder_id)) so swapping back to a previously-
    /// used encoder is instant — the embeddings are already there.
    ///
    /// Special case: for `clip_vit_b_32` the new embeddings table
    /// might be empty for users who haven't re-indexed under the new
    /// schema. Falls back to the legacy `images.embedding` column
    /// (`get_all_embeddings`) so those users still get results.
    #[tracing::instrument(name = "cosine.populate_for_encoder", skip(self, db))]
    pub fn populate_from_db_for_encoder(&mut self, db: &db::ImageDatabase, encoder_id: &str) {
        let start = Instant::now();
        info!("populate_from_db_for_encoder({encoder_id})");
        let rows = match db.get_all_embeddings_for(encoder_id) {
            Ok(r) => r,
            Err(e) => {
                warn!("populate_from_db_for_encoder({encoder_id}) failed: {e}");
                return;
            }
        };

        // Backward-compat for CLIP: if the new embeddings table is
        // empty for clip_vit_b_32, fall back to the legacy
        // images.embedding column. Users who indexed before the
        // per-encoder schema have data only in the legacy column.
        let rows = if rows.is_empty() && encoder_id == "clip_vit_b_32" {
            info!(
                "embeddings table empty for clip_vit_b_32; falling back to \
                 legacy images.embedding column"
            );
            match db.get_all_embeddings() {
                Ok(r) => r,
                Err(e) => {
                    warn!("legacy get_all_embeddings fallback failed: {e}");
                    return;
                }
            }
        } else {
            rows
        };

        let total = rows.len();
        let dim = rows.iter().find(|(_, _, e)| !e.is_empty()).map_or(0, |(_, _, e)| e.len());
        self.cached_images.clear();
        self.cached_images.reserve(total, dim);
        for (id, _path, embedding) in rows {
            if embedding.is_empty() {
                continue;
            }
            self.cached_images.push_owned(id, &embedding);
        }
        self.encoder_id = Some(encoder_id.to_string());
        // The generation token the persisted store's header carries.
        // A DB error here just leaves it 0 — the store still writes,
        // and a 0-token file is always treated as stale on load, so we
        // fail safe (rebuild) rather than serve possibly-wrong vectors.
        self.gen_token = db.embedding_generation_token(encoder_id).unwrap_or(0);

        let elapsed_ms = start.elapsed().as_millis() as u64;
        info!(
            "populate_for_encoder({encoder_id}) done: {} embeddings in {} ms",
            self.cached_images.len(),
            elapsed_ms
        );

        // Diagnostic: tells the report which encoder's cache was
        // loaded with how many embeddings — pinpoints the "0 results"
        // case where the user picked an encoder that hasn't been
        // indexed yet.
        crate::perf::record_diagnostic(
            "cosine_cache_populated",
            serde_json::json!({
                "encoder_id": encoder_id,
                "count": self.cached_images.len(),
                "duration_ms": elapsed_ms,
            }),
        );

        // Embedding-quality diagnostics: emit per encoder so the
        // report shows per-encoder L2-norm distribution, per-dim
        // sanity stats, NaN/Inf counts, pairwise distance histogram,
        // and self-similarity check.
        crate::perf::record_diagnostic(
            "embedding_stats",
            serde_json::json!({
                "encoder_id": encoder_id,
                "stats": super::diagnostics::embedding_stats(&self.cached_images),
            }),
        );
        crate::perf::record_diagnostic(
            "pairwise_distance_distribution",
            serde_json::json!({
                "encoder_id": encoder_id,
                "stats": super::diagnostics::pairwise_distance_distribution(&self.cached_images),
            }),
        );
        crate::perf::record_diagnostic(
            "self_similarity_check",
            serde_json::json!({
                "encoder_id": encoder_id,
                "stats": super::diagnostics::self_similarity_check(&self.cached_images),
            }),
        );
    }

    /// Populate the in-memory index by SELECTing every embedding in one
    /// query (legacy path — the flat variant is
    /// `populate_from_db_for_encoder`).
    #[tracing::instrument(name = "cosine.populate_from_db", skip(self, db))]
    pub fn populate_from_db(&mut self, db: &db::ImageDatabase) {
        let start = Instant::now();
        info!("populate_from_db called");
        let rows = match db.get_all_embeddings() {
            Ok(r) => r,
            Err(e) => {
                warn!("populate_from_db: get_all_embeddings failed: {e}");
                return;
            }
        };
        let total = rows.len();
        let dim = rows.iter().find(|(_, _, e)| !e.is_empty()).map_or(0, |(_, _, e)| e.len());
        self.cached_images.clear();
        self.cached_images.reserve(total, dim);
        for (id, _path, embedding) in rows {
            if embedding.is_empty() {
                continue;
            }
            self.cached_images.push_owned(id, &embedding);
        }
        info!(
            "Population complete: {} embeddings loaded in {:?}",
            self.cached_images.len(),
            start.elapsed()
        );
    }

    /// Cosine similarity between two embeddings. Thin delegate to
    /// `super::math::cosine_similarity` so the existing
    /// `CosineIndex::cosine_similarity(&a, &b)` call path stays valid
    /// (tests, the startup sanity check, the integration test).
    pub fn cosine_similarity(a: &Array1<f32>, b: &Array1<f32>) -> f32 {
        cosine_similarity(a, b)
    }

    /// Score every cached row against `embedding` in parallel, skipping
    /// the optionally-excluded query row (matched by `image_id`).
    /// Returns `(row_idx, similarity)` in row order.
    ///
    /// **Ranking is identical to the old serial loop.** rayon's `collect`
    /// on an index range preserves order, so the returned Vec is in row
    /// order with the excluded row dropped — the downstream
    /// `select_nth_unstable_by` / `sort_unstable_by` are deterministic
    /// functions of that sequence. Each row's score is
    /// `dot(q, row) × q_inv × inv_norms[row]`, using the cached inverse
    /// norms (T1-4). `dot_slice` is the same sequential fold the serial
    /// equivalence reference uses, so scores are FP-equal to a fresh
    /// full-cosine reference within 1e-6 (see
    /// `parallel_scoring_matches_serial_reference`). `&self` scoring is
    /// what lets concurrent queries share a read lock.
    fn score_all(&self, embedding: &Array1<f32>, exclude_id: Option<i64>) -> Vec<(usize, f32)> {
        let store = &self.cached_images;
        let dim = store.dim();
        if dim == 0 {
            return Vec::new();
        }

        let owned;
        let q: &[f32] = match embedding.as_slice() {
            Some(s) => s,
            None => {
                owned = embedding.to_vec();
                &owned
            }
        };
        if q.len() != dim {
            // Cross-encoder dim mismatch — should be prevented by the
            // dispatch layer (ensure_loaded_for). Return no results
            // rather than a list of meaningless zero scores.
            warn!(
                "score_all dim mismatch: query={} cache={}; returning empty",
                q.len(),
                dim
            );
            return Vec::new();
        }

        let q_inv = inv_norm(q);
        let block = store.block();
        let ids = store.ids();
        let inv = store.inv_norms();

        (0..store.len())
            .into_par_iter()
            .filter_map(|row| {
                if Some(ids[row]) == exclude_id {
                    return None;
                }
                let c = &block[row * dim..(row + 1) * dim];
                Some((row, dot_slice(q, c) * q_inv * inv[row]))
            })
            .collect()
    }

    /// Diversity retrieval: random sample from the top ~20% by score.
    #[tracing::instrument(name = "cosine.get_similar_images", skip(self, embedding, exclude_id), fields(cached = self.cached_images.len(), top_n))]
    pub fn get_similar_images(
        &self,
        embedding: &Array1<f32>,
        top_n: usize,
        exclude_id: Option<i64>,
    ) -> Vec<(i64, f32)> {
        let mut scores = self.score_all(embedding, exclude_id);
        if scores.is_empty() {
            warn!("No similarities calculated! Returning empty result.");
            return Vec::new();
        }

        // Diversity pool: top 20% by similarity (or top_n, whichever is
        // larger). `select_nth_unstable_by` partitions around the
        // (select_count - 1)th best in O(n) average — ordering within
        // the pool doesn't matter because we random-sample.
        let base_pool = (scores.len() as f32 * 0.2).ceil() as usize;
        let select_count = base_pool.max(top_n).min(scores.len());
        if select_count > 0 && select_count < scores.len() {
            scores.select_nth_unstable_by(select_count - 1, score_cmp_desc);
            scores.truncate(select_count);
        }

        let ids = self.cached_images.ids();
        let mut rng = rand::rng();
        let take = top_n.min(scores.len());
        let sampled: Vec<&(usize, f32)> = scores.choose_multiple(&mut rng, take).collect();
        sampled
            .iter()
            .map(|(row, sim)| (ids[*row], *sim))
            .collect()
    }

    /// Exact top-N sorted by descending similarity (semantic search /
    /// modal navigation). No random sampling.
    #[tracing::instrument(name = "cosine.get_similar_sorted", skip(self, embedding, exclude_id), fields(cached = self.cached_images.len(), top_n))]
    pub fn get_similar_images_sorted(
        &self,
        embedding: &Array1<f32>,
        top_n: usize,
        exclude_id: Option<i64>,
    ) -> Vec<(i64, f32)> {
        let mut scores = self.score_all(embedding, exclude_id);
        if scores.is_empty() {
            warn!("No similarities calculated! Returning empty result.");
            return Vec::new();
        }

        // Partial-select the top_n (O(n) average) then sort just those,
        // preserving the descending-order contract callers rely on.
        let want = top_n.min(scores.len());
        if want == 0 {
            return Vec::new();
        }
        if want < scores.len() {
            scores.select_nth_unstable_by(want - 1, score_cmp_desc);
            scores.truncate(want);
        }
        scores.sort_unstable_by(score_cmp_desc);

        let ids = self.cached_images.ids();
        let result: Vec<(i64, f32)> = scores.iter().map(|(row, sim)| (ids[*row], *sim)).collect();

        if result.len() > 1 {
            debug!(
                "Score range: {:.4} (best) to {:.4} (worst in top N)",
                result.first().map(|(_, s)| *s).unwrap_or(0.0),
                result.last().map(|(_, s)| *s).unwrap_or(0.0)
            );
        }
        result
    }

    /// Tiered Pinterest-style sampling: 5 from each of the 0-5%, 5-10%,
    /// ..., 45-50% score bands.
    #[tracing::instrument(name = "cosine.get_tiered_similar", skip(self, embedding, exclude_id), fields(cached = self.cached_images.len()))]
    pub fn get_tiered_similar_images(
        &self,
        embedding: &Array1<f32>,
        exclude_id: Option<i64>,
    ) -> Vec<(i64, f32)> {
        let mut scores = self.score_all(embedding, exclude_id);
        if scores.is_empty() {
            warn!("No similarities calculated! Returning empty result.");
            return Vec::new();
        }

        // Tiers span 0-50% in 5% buckets, so a full sort is required.
        scores.sort_unstable_by(score_cmp_desc);

        let total = scores.len();
        let ids = self.cached_images.ids();
        let mut result: Vec<(i64, f32)> = Vec::new();
        let mut rng = rand::rng();
        let mut used_indices: std::collections::HashSet<usize> = std::collections::HashSet::new();

        let tiers = [
            (0.0, 0.05, 5),
            (0.05, 0.10, 5),
            (0.10, 0.15, 5),
            (0.15, 0.20, 5),
            (0.20, 0.30, 5),
            (0.30, 0.40, 5),
            (0.40, 0.50, 5),
        ];

        for (start_pct, end_pct, count) in tiers {
            let start_idx = (total as f32 * start_pct).floor() as usize;
            let end_idx = ((total as f32 * end_pct).ceil() as usize).min(total);
            if start_idx >= total {
                break;
            }
            let available: Vec<usize> = (start_idx..end_idx)
                .filter(|i| !used_indices.contains(i))
                .collect();
            let to_take = count.min(available.len());
            let sampled: Vec<usize> = available.choose_multiple(&mut rng, to_take).cloned().collect();
            for sorted_idx in sampled {
                used_indices.insert(sorted_idx);
                let (row, sim) = scores[sorted_idx];
                result.push((ids[row], sim));
            }
        }

        debug!(
            "Tiered sampling complete - returned {} images from {} total",
            result.len(),
            total
        );
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::array;

    /// Test helper: collect the store's rows as `(id, Vec<f32>)`.
    fn rows_of(index: &CosineIndex) -> Vec<(i64, Vec<f32>)> {
        let store = &index.cached_images;
        (0..store.len())
            .map(|r| (store.ids()[r], store.row(r).to_vec()))
            .collect()
    }

    #[test]
    fn test_add_image() {
        let mut index = CosineIndex::new();
        index.add_image(42, array![1.0, 2.0, 3.0]);
        assert_eq!(index.cached_images.len(), 1);
        let rows = rows_of(&index);
        assert_eq!(rows[0].0, 42);
        assert_eq!(rows[0].1, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_add_multiple_images() {
        let mut index = CosineIndex::new();
        for i in 0..10 {
            index.add_image(i as i64, Array1::from_vec(vec![i as f32; 512]));
        }
        assert_eq!(index.cached_images.len(), 10);
        assert_eq!(index.cached_images.dim(), 512);
    }

    #[test]
    fn test_get_similar_images_returns_most_similar() {
        let mut index = CosineIndex::new();
        let query_embedding = array![1.0, 0.0, 0.0];
        index.add_image(1, array![0.9, 0.1, 0.0]);
        index.add_image(2, array![0.7, 0.3, 0.0]);
        index.add_image(3, array![0.0, 0.0, 1.0]);

        let results = index.get_similar_images(&query_embedding, 2, None);
        assert_eq!(results.len(), 2);
        for (_, sim) in &results {
            assert!(*sim >= -1.0 && *sim <= 1.0, "Similarity out of bounds: {sim}");
        }
    }

    #[test]
    fn test_get_similar_images_with_many_candidates() {
        let mut index = CosineIndex::new();
        let query = Array1::from_vec(vec![1.0; 512]);
        for i in 0..100 {
            let mut vec = vec![0.0; 512];
            for slot in vec.iter_mut().take(i % 512) {
                *slot = 1.0;
            }
            index.add_image(i as i64, Array1::from_vec(vec));
        }
        let results = index.get_similar_images(&query, 10, None);
        assert_eq!(results.len(), 10);
        let ids: Vec<i64> = results.iter().map(|(id, _)| *id).collect();
        let unique = ids.iter().collect::<std::collections::HashSet<_>>().len();
        assert_eq!(unique, 10, "Returned duplicate ids");
    }

    #[test]
    fn test_get_similar_images_request_more_than_available() {
        let mut index = CosineIndex::new();
        let query = array![1.0, 0.0, 0.0];
        for i in 0..3 {
            index.add_image(i as i64, array![1.0, i as f32, 0.0]);
        }
        let results = index.get_similar_images(&query, 10, None);
        assert!(results.len() <= 3, "Returned more images than available");
    }

    #[test]
    fn test_empty_index() {
        let index = CosineIndex::new();
        let query = array![1.0, 2.0, 3.0];
        assert_eq!(index.get_similar_images(&query, 5, None).len(), 0);
    }

    #[test]
    fn clear_resets_to_empty() {
        let mut index = CosineIndex::new();
        index.add_image(1, array![1.0, 2.0]);
        index.add_image(2, array![3.0, 4.0]);
        assert_eq!(index.cached_images.len(), 2);
        index.cached_images.clear();
        assert!(index.cached_images.is_empty());
        assert_eq!(index.cached_images.dim(), 0);
    }

    #[test]
    fn parallel_scoring_matches_serial_reference() {
        // The flat rayon scan (cached-inverse-norm scoring) must produce
        // the SAME top-k score sequence as a naive serial full-cosine
        // reference. Comparing the score sequence is robust to tie
        // id-ordering — equal scores may land in a different id order
        // between a stable and an unstable sort, but the score sequence
        // is identical. This is the T3-2 flat-path equivalence guard.
        let mut index = CosineIndex::new();
        let dim = 16;
        let n = 400;
        for i in 0..n {
            let v: Vec<f32> = (0..dim)
                .map(|j| (((i * 31 + j * 7) % 13) as f32) - 6.0)
                .collect();
            index.add_image(i as i64, Array1::from_vec(v));
        }
        let query = Array1::from_vec((0..dim).map(|j| ((j % 5) as f32) - 2.0).collect());

        let top_k = 25;
        let parallel = index.get_similar_images_sorted(&query, top_k, None);

        // Serial reference: fresh full cosine per row, sort desc, take k.
        let mut ref_scores: Vec<f32> = (0..index.cached_images.len())
            .map(|r| {
                CosineIndex::cosine_similarity(
                    &query,
                    &Array1::from_vec(index.cached_images.row(r).to_vec()),
                )
            })
            .collect();
        ref_scores.sort_by(|a, b| b.partial_cmp(a).unwrap());
        ref_scores.truncate(top_k);

        let par_scores: Vec<f32> = parallel.iter().map(|(_, s)| *s).collect();
        assert_eq!(par_scores.len(), ref_scores.len());
        for (rank, (p, r)) in par_scores.iter().zip(ref_scores.iter()).enumerate() {
            assert!(
                (p - r).abs() < 1e-6,
                "rank {rank}: flat score {p} != serial reference {r}"
            );
        }
        assert!(
            par_scores.windows(2).all(|w| w[0] >= w[1] - 1e-6),
            "sorted results must be descending, got {par_scores:?}"
        );
    }

    #[test]
    fn legacy_off_unit_norm_row_scores_via_cached_norm() {
        // T3-2 legacy-row guard: pre-normalise CLIP rows are NOT unit
        // vectors, so the cached inverse norm must be the REAL norm. An
        // off-unit-norm row scored through the flat cached-norm path must
        // equal the direct full-cosine formula (which recomputes norms).
        let mut index = CosineIndex::new();
        // Deliberately large-magnitude, non-unit rows.
        index.add_image(1, array![3.0, 4.0, 0.0]); // |v| = 5
        index.add_image(2, array![10.0, 0.0, 24.0]); // |v| = 26
        index.add_image(3, array![0.0, 0.0, 7.0]); // |v| = 7
        let query = array![2.0, 1.0, 5.0]; // non-unit query too

        let flat = index.get_similar_images_sorted(&query, 3, None);
        for (id, score) in &flat {
            let row = index.cached_images.ids().iter().position(|x| x == id).unwrap();
            let direct = CosineIndex::cosine_similarity(
                &query,
                &Array1::from_vec(index.cached_images.row(row).to_vec()),
            );
            assert!(
                (score - direct).abs() < 1e-6,
                "id {id}: cached-norm score {score} != direct cosine {direct}"
            );
        }
    }

    #[test]
    fn parallel_scoring_excludes_query_id() {
        let mut index = CosineIndex::new();
        for i in 0..50 {
            index.add_image(i as i64, Array1::from_vec(vec![i as f32, (i % 7) as f32, 1.0]));
        }
        let query = array![10.0, 3.0, 1.0];
        let results = index.get_similar_images_sorted(&query, 50, Some(10));
        assert_eq!(results.len(), 49, "excluded id should drop one candidate");
        assert!(
            !results.iter().any(|(id, _)| *id == 10),
            "excluded id must not appear in results"
        );
    }
}
