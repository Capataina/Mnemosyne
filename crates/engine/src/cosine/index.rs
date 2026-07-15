use super::math::{cosine_similarity, score_cmp_desc};
use crate::db;
use ndarray::Array1;
use rand::prelude::*;
use rayon::prelude::*;
use std::path::PathBuf;
use std::time::Instant;
use tracing::{debug, info, warn};

pub struct CosineIndex {
    pub cached_images: Vec<(PathBuf, Array1<f32>)>,
}

impl Default for CosineIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl CosineIndex {
    pub fn new() -> Self {
        CosineIndex {
            cached_images: Vec::new(),
        }
    }

    pub fn add_image(&mut self, path: PathBuf, embedding: Array1<f32>) {
        self.cached_images.push((path, embedding));
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
    pub fn populate_from_db_for_encoder(
        &mut self,
        db: &db::ImageDatabase,
        encoder_id: &str,
    ) {
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
        self.cached_images.clear();
        self.cached_images.reserve(total);
        for (_id, path, embedding) in rows {
            if embedding.is_empty() {
                continue;
            }
            self.cached_images
                .push((PathBuf::from(path), Array1::from_vec(embedding)));
        }
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
        // and self-similarity check. The pairwise calculation samples
        // up to 50 embeddings (1225 cosine ops) — fast even on CPU.
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
    /// query.
    ///
    /// Replaces the previous N+1 implementation (one SELECT per image)
    /// which was ~30x slower for libraries of 1000+ images. Also takes
    /// `&ImageDatabase` rather than a `db_path: &str` so the cosine
    /// module no longer opens its own second SQLite connection.
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
        self.cached_images.clear();
        self.cached_images.reserve(total);
        for (_id, path, embedding) in rows {
            if embedding.is_empty() {
                continue;
            }
            self.cached_images
                .push((PathBuf::from(path), Array1::from_vec(embedding)));
        }
        info!(
            "Population complete: {} embeddings loaded in {:?}",
            self.cached_images.len(),
            start.elapsed()
        );
    }

    // Function to compute cosine similarity between two embeddings
    //
    // Thin delegate to `super::math::cosine_similarity` so the existing
    // `CosineIndex::cosine_similarity(&a, &b)` call path stays valid
    // for callers (notably `tests/similarity_integration_test.rs`).
    pub fn cosine_similarity(a: &Array1<f32>, b: &Array1<f32>) -> f32 {
        cosine_similarity(a, b)
    }

    /// Score every cached image against `embedding` in parallel, skipping
    /// the optionally-excluded query image. Returns `(cache_idx,
    /// similarity)` tuples.
    ///
    /// This is the shared hot loop behind all three retrieval methods.
    /// Each per-image cosine score is independent, so rayon fans the scan
    /// across the thread pool — the throughput win at 100k-image scale,
    /// where a serial 100k-dot-product scan was the bottleneck.
    ///
    /// **Ranking is identical to the old serial loop.** rayon's `collect`
    /// on a slice-derived parallel iterator preserves element order, so
    /// the returned Vec is in `cached_images` order with excluded rows
    /// dropped — byte-for-byte the same sequence the serial `for` loop
    /// produced. The downstream `select_nth_unstable_by` / `sort_unstable_by`
    /// are deterministic functions of that sequence, so tie-ordering and
    /// the final top-k match the serial reference exactly (see
    /// `parallel_scoring_matches_serial_reference`). Taking `&self` (no
    /// shared scratch buffer) is also what lets concurrent queries score
    /// under a shared read lock instead of serialising on a write lock.
    fn score_all(
        &self,
        embedding: &Array1<f32>,
        exclude_path: Option<&PathBuf>,
    ) -> Vec<(usize, f32)> {
        self.cached_images
            .par_iter()
            .enumerate()
            .filter_map(|(idx, (path, emb))| {
                if let Some(exclude) = exclude_path {
                    if path == exclude {
                        return None;
                    }
                }
                Some((idx, cosine_similarity(embedding, emb)))
            })
            .collect()
    }

    // write the return images function. This function is going to take an embedding and return the top n most similar images from the cached_images vector
    // the images that ir returns will be a top x percent of the cached images based on cosine similarity to encourage diversity
    // exclude_path: optional path to exclude from results (e.g., the query image itself)
    #[tracing::instrument(name = "cosine.get_similar_images", skip(self, embedding, exclude_path), fields(cached = self.cached_images.len(), top_n))]
    pub fn get_similar_images(
        &self,
        embedding: &Array1<f32>,
        top_n: usize,
        exclude_path: Option<&PathBuf>,
    ) -> Vec<(PathBuf, f32)> {
        debug!(
            "get_similar_images called - cached_images: {}, top_n: {}, exclude_path: {:?}",
            self.cached_images.len(),
            top_n,
            exclude_path
        );

        // Step 1: score every cached image (except the optionally-excluded
        // query) in parallel. `scores` holds (cache_idx, similarity) in
        // cached_images order — no PathBuf clones in the hot loop; we only
        // clone the paths that survive into the final result.
        let mut scores = self.score_all(embedding, exclude_path);

        debug!(
            "Calculated similarities for {} images, query embedding length: {}",
            scores.len(),
            embedding.len()
        );

        if scores.is_empty() {
            warn!("No similarities calculated! Returning empty result.");
            return Vec::new();
        }

        // Diversity pool: top 20% by similarity (or top_n, whichever is
        // larger). Random sampling within the pool produces diversity
        // without sacrificing relevance.
        //
        // We use `select_nth_unstable_by` to partition around the
        // (select_count - 1)th best score in O(n) average — only the
        // pool needs to end up at the front of the buffer; ordering
        // *within* the pool doesn't matter because we random-sample.
        // This is the algorithm pinned by
        // tests/cosine_topk_partial_sort_diagnostic.rs.
        let base_pool = (scores.len() as f32 * 0.2).ceil() as usize;
        let select_count = base_pool.max(top_n).min(scores.len());
        if select_count > 0 && select_count < scores.len() {
            scores.select_nth_unstable_by(select_count - 1, score_cmp_desc);
            scores.truncate(select_count);
        }

        debug!(
            "Diversity pool - base_pool: {}, select_count: {}, pool size: {}",
            base_pool,
            select_count,
            scores.len()
        );

        // Random sample top_n from the pool. We sample indices into the
        // (now trimmed) score list, then materialise the surviving paths
        // exactly once each.
        let mut rng = rand::rng();
        let take = top_n.min(scores.len());
        let sampled: Vec<&(usize, f32)> = scores.choose_multiple(&mut rng, take).collect();
        let selected: Vec<(PathBuf, f32)> = sampled
            .iter()
            .map(|(cache_idx, sim)| (self.cached_images[*cache_idx].0.clone(), *sim))
            .collect();

        debug!("Final selected results: {} images", selected.len());
        for (i, (path, sim)) in selected.iter().enumerate() {
            debug!(
                "  {}. {:?} - score: {:.4}",
                i + 1,
                path.file_name().unwrap_or_default(),
                sim
            );
        }

        selected
    }

    /// Get the top N most similar images sorted by similarity score (descending).
    /// Unlike get_similar_images, this does NOT randomly sample - it returns
    /// results in exact order of similarity. Best for semantic search where
    /// ranking accuracy matters.
    #[tracing::instrument(name = "cosine.get_similar_sorted", skip(self, embedding, exclude_path), fields(cached = self.cached_images.len(), top_n))]
    pub fn get_similar_images_sorted(
        &self,
        embedding: &Array1<f32>,
        top_n: usize,
        exclude_path: Option<&PathBuf>,
    ) -> Vec<(PathBuf, f32)> {
        debug!(
            "get_similar_images_sorted called - cached_images: {}, top_n: {}, exclude_path: {:?}",
            self.cached_images.len(),
            top_n,
            exclude_path
        );

        // Step 1: parallel score list of (cache_idx, similarity) for every
        // non-excluded image. No PathBuf clones in the hot loop.
        let mut scores = self.score_all(embedding, exclude_path);

        if scores.is_empty() {
            warn!("No similarities calculated! Returning empty result.");
            return Vec::new();
        }

        // Step 2: top-N selection. Partition around the (top_n - 1)th
        // best score using `select_nth_unstable_by` (O(n) average) so we
        // only pay the O(n log n) sort cost on the surviving top_n
        // elements. For top_n=50 over 1500 images this is the 2.53×
        // speedup measured in tests/cosine_topk_partial_sort_diagnostic.rs.
        //
        // The sort *after* the partial-select preserves the
        // descending-order contract that semantic-search and the modal
        // navigation rely on.
        let want = top_n.min(scores.len());
        if want == 0 {
            return Vec::new();
        }
        if want < scores.len() {
            scores.select_nth_unstable_by(want - 1, score_cmp_desc);
            scores.truncate(want);
        }
        scores.sort_unstable_by(score_cmp_desc);

        // Step 3: materialise the surviving top_n into the return shape.
        // This is the only PathBuf clone — `want` clones, not `n`.
        let result: Vec<(PathBuf, f32)> = scores
            .iter()
            .map(|(cache_idx, sim)| (self.cached_images[*cache_idx].0.clone(), *sim))
            .collect();

        debug!(
            "Returning {} results sorted by similarity",
            result.len()
        );

        if !result.is_empty() {
            debug!("Top 5 results:");
            for (i, (path, sim)) in result.iter().take(5).enumerate() {
                debug!(
                    "  {}. {:?} - score: {:.4}",
                    i + 1,
                    path.file_name().unwrap_or_default(),
                    sim
                );
            }
            if result.len() > 1 {
                debug!(
                    "Score range: {:.4} (best) to {:.4} (worst in top N)",
                    result.first().map(|(_, s)| *s).unwrap_or(0.0),
                    result.last().map(|(_, s)| *s).unwrap_or(0.0)
                );
            }
        }

        result
    }

    /// Get tiered similar images - Pinterest style
    /// Samples images from progressively less similar tiers:
    /// - 5 random from top 5%
    /// - 5 random from top 5-10%
    /// - 5 random from top 10-15%
    /// ... and so on until top 50%
    #[tracing::instrument(name = "cosine.get_tiered_similar", skip(self, embedding, exclude_path), fields(cached = self.cached_images.len()))]
    pub fn get_tiered_similar_images(
        &self,
        embedding: &Array1<f32>,
        exclude_path: Option<&PathBuf>,
    ) -> Vec<(PathBuf, f32)> {
        debug!(
            "get_tiered_similar_images called - cached_images: {}, exclude_path: {:?}",
            self.cached_images.len(),
            exclude_path
        );

        // Step 1: parallel score list (index-keyed, no PathBuf clones in
        // the hot loop).
        let mut scores = self.score_all(embedding, exclude_path);

        if scores.is_empty() {
            warn!("No similarities calculated! Returning empty result.");
            return Vec::new();
        }

        // Tiered sampling needs a fully-sorted list because tiers span
        // 0-50% in 5% buckets. Partial-sort can't help here without
        // restructuring the tier definitions, so we keep the full sort
        // — the index-keyed score list still wins by skipping the per-item
        // PathBuf clone.
        scores.sort_unstable_by(score_cmp_desc);

        let total = scores.len();
        let mut result: Vec<(PathBuf, f32)> = Vec::new();
        let mut rng = rand::rng();
        let mut used_indices: std::collections::HashSet<usize> =
            std::collections::HashSet::new();

        // Sample from each tier: 0-5%, 5-10%, 10-15%, ..., 45-50%
        let tiers = [
            (0.0, 0.05, 5),  // top 5%: pick 5
            (0.05, 0.10, 5), // 5-10%: pick 5
            (0.10, 0.15, 5), // 10-15%: pick 5
            (0.15, 0.20, 5), // 15-20%: pick 5
            (0.20, 0.30, 5), // 20-30%: pick 5
            (0.30, 0.40, 5), // 30-40%: pick 5
            (0.40, 0.50, 5), // 40-50%: pick 5
        ];

        for (start_pct, end_pct, count) in tiers {
            let start_idx = (total as f32 * start_pct).floor() as usize;
            let end_idx = (total as f32 * end_pct).ceil() as usize;
            let end_idx = end_idx.min(total);

            if start_idx >= total {
                break;
            }

            // Get scratch-indices in this tier that haven't been used
            let available: Vec<usize> = (start_idx..end_idx)
                .filter(|i| !used_indices.contains(i))
                .collect();

            let to_take = count.min(available.len());
            let sampled: Vec<usize> = available
                .choose_multiple(&mut rng, to_take)
                .cloned()
                .collect();

            // Resolve sorted-list index → cache index → (PathBuf, f32)
            // here. Only sampled items pay the clone cost.
            for sorted_idx in sampled {
                used_indices.insert(sorted_idx);
                let (cache_idx, sim) = scores[sorted_idx];
                result.push((self.cached_images[cache_idx].0.clone(), sim));
            }
        }

        debug!(
            "Tiered sampling complete - returned {} images from {} total",
            result.len(),
            total
        );

        // Log score ranges
        if !result.is_empty() {
            let scores: Vec<f32> = result.iter().map(|(_, s)| *s).collect();
            let min_score = scores.iter().cloned().fold(f32::INFINITY, f32::min);
            let max_score = scores.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            debug!(
                "Score range: {:.4} to {:.4}",
                min_score, max_score
            );
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::array;

    #[test]
    fn test_add_image() {
        let mut index = CosineIndex::new();
        let path = PathBuf::from("/test/image.jpg");
        let embedding = array![1.0, 2.0, 3.0];

        index.add_image(path.clone(), embedding.clone());

        assert_eq!(index.cached_images.len(), 1);
        assert_eq!(index.cached_images[0].0, path);
        assert_eq!(index.cached_images[0].1, embedding);
    }

    #[test]
    fn test_add_multiple_images() {
        let mut index = CosineIndex::new();

        for i in 0..10 {
            let path = PathBuf::from(format!("/test/image_{}.jpg", i));
            let embedding = Array1::from_vec(vec![i as f32; 512]);
            index.add_image(path, embedding);
        }

        assert_eq!(index.cached_images.len(), 10);
    }

    #[test]
    fn test_get_similar_images_returns_most_similar() {
        let mut index = CosineIndex::new();

        // Add a query image
        let query_embedding = array![1.0, 0.0, 0.0];

        // Add several images with varying similarity
        let very_similar = array![0.9, 0.1, 0.0]; // Very close
        let somewhat_similar = array![0.7, 0.3, 0.0]; // Moderately close
        let dissimilar = array![0.0, 0.0, 1.0]; // Orthogonal

        index.add_image(PathBuf::from("/images/very_similar.jpg"), very_similar);
        index.add_image(
            PathBuf::from("/images/somewhat_similar.jpg"),
            somewhat_similar,
        );
        index.add_image(PathBuf::from("/images/dissimilar.jpg"), dissimilar);

        // Search for images similar to query
        let results = index.get_similar_images(&query_embedding, 2, None);

        // Should return 2 results
        assert_eq!(results.len(), 2);

        // The very_similar image should have higher similarity than somewhat_similar
        // (though order might vary due to random sampling from top 20%)
        let similarities: Vec<f32> = results.iter().map(|(_, sim)| *sim).collect();

        // All returned similarities should be reasonable (between -1 and 1)
        for sim in &similarities {
            assert!(
                *sim >= -1.0 && *sim <= 1.0,
                "Similarity out of bounds: {}",
                sim
            );
        }

        println!("Returned similarities: {:?}", similarities);
    }

    #[test]
    fn test_get_similar_images_with_many_candidates() {
        let mut index = CosineIndex::new();

        // Create a query embedding
        let query = Array1::from_vec(vec![1.0; 512]);

        // Add 100 images with random embeddings
        for i in 0..100 {
            let mut vec = vec![0.0; 512];
            // Make some components match the query for varying similarity
            // 6b — clippy::needless_range_loop. iter_mut().take() is
            // the idiomatic form when the index isn't needed in the body.
            for slot in vec.iter_mut().take(i % 512) {
                *slot = 1.0;
            }
            let embedding = Array1::from_vec(vec);
            index.add_image(PathBuf::from(format!("/images/img_{}.jpg", i)), embedding);
        }

        // Request top 10
        let results = index.get_similar_images(&query, 10, None);

        assert_eq!(results.len(), 10);

        // All paths should be unique
        let paths: Vec<&PathBuf> = results.iter().map(|(path, _)| path).collect();
        let unique_count = paths.iter().collect::<std::collections::HashSet<_>>().len();
        assert_eq!(unique_count, 10, "Returned duplicate paths");
    }

    #[test]
    fn test_get_similar_images_request_more_than_available() {
        let mut index = CosineIndex::new();
        let query = array![1.0, 0.0, 0.0];

        // Add only 3 images
        for i in 0..3 {
            let embedding = array![1.0, i as f32, 0.0];
            index.add_image(PathBuf::from(format!("/images/img_{}.jpg", i)), embedding);
        }

        // Request 10 (more than available)
        let results = index.get_similar_images(&query, 10, None);

        // Should return only what's available (3 or fewer due to 20% sampling)
        assert!(results.len() <= 3, "Returned more images than available");
    }

    #[test]
    fn test_empty_index() {
        // The retrieval methods now take &self (parallel-scored into a
        // local buffer, no shared scratch).
        let index = CosineIndex::new();
        let query = array![1.0, 2.0, 3.0];

        let results = index.get_similar_images(&query, 5, None);

        assert_eq!(results.len(), 0, "Empty index should return no results");
    }

    #[test]
    fn parallel_scoring_matches_serial_reference() {
        // The rayon-parallel scan must produce the SAME top-k ranking as a
        // serial reference. We compare the score *sequence* (the ranking
        // in score terms), which is robust to tie path-ordering — equal
        // scores may land in a different path order between a stable and
        // an unstable sort, but the sequence of scores is identical.
        let mut index = CosineIndex::new();
        let dim = 16;
        let n = 400;
        for i in 0..n {
            // Deterministic, varied embeddings (with some intentional
            // ties, since scores repeat under this modular fill).
            let v: Vec<f32> = (0..dim)
                .map(|j| (((i * 31 + j * 7) % 13) as f32) - 6.0)
                .collect();
            index.add_image(PathBuf::from(format!("/img_{i}.jpg")), Array1::from_vec(v));
        }
        let query = Array1::from_vec((0..dim).map(|j| ((j % 5) as f32) - 2.0).collect());

        let top_k = 25;
        let parallel = index.get_similar_images_sorted(&query, top_k, None);

        // Serial reference: score every candidate, sort desc, take top_k.
        let mut ref_scores: Vec<f32> = index
            .cached_images
            .iter()
            .map(|(_, e)| CosineIndex::cosine_similarity(&query, e))
            .collect();
        ref_scores.sort_by(|a, b| b.partial_cmp(a).unwrap());
        ref_scores.truncate(top_k);

        let par_scores: Vec<f32> = parallel.iter().map(|(_, s)| *s).collect();

        assert_eq!(
            par_scores.len(),
            ref_scores.len(),
            "parallel returned {} results, serial reference {}",
            par_scores.len(),
            ref_scores.len()
        );
        for (rank, (p, r)) in par_scores.iter().zip(ref_scores.iter()).enumerate() {
            assert!(
                (p - r).abs() < 1e-6,
                "rank {rank}: parallel score {p} != serial reference {r}"
            );
        }
        // And the sorted contract holds: strictly non-increasing.
        assert!(
            par_scores.windows(2).all(|w| w[0] >= w[1] - 1e-6),
            "sorted results must be descending, got {par_scores:?}"
        );
    }

    #[test]
    fn parallel_scoring_excludes_query_path() {
        // Exclusion must still work under the parallel scan — the excluded
        // path never appears, and the result count reflects one fewer
        // candidate.
        let mut index = CosineIndex::new();
        for i in 0..50 {
            let v = vec![i as f32, (i % 7) as f32, 1.0];
            index.add_image(PathBuf::from(format!("/img_{i}.jpg")), Array1::from_vec(v));
        }
        let query = array![10.0, 3.0, 1.0];
        let exclude = PathBuf::from("/img_10.jpg");
        let results = index.get_similar_images_sorted(&query, 50, Some(&exclude));
        assert_eq!(results.len(), 49, "excluded path should drop one candidate");
        assert!(
            !results.iter().any(|(p, _)| p == &exclude),
            "excluded path must not appear in results"
        );
    }
}
