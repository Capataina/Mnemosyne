use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
use tracing::{debug, info, warn};

use crate::commands::{hydrate_search_results, ApiError, ImageSearchResult};
use crate::db::ImageDatabase;
use crate::perf;
use crate::similarity_and_semantic_search::cosine::rrf::{
    reciprocal_rank_fusion, RankedList, DEFAULT_K_RRF,
};
use crate::FusionIndexState;

/// Has the once-per-session cross-encoder comparison fired yet?
/// Cross-encoder comparison is expensive (builds a temporary
/// CosineIndex per other encoder) — we only want one snapshot per
/// session to compare encoder rankings side-by-side. Subsequent
/// View-Similar calls skip the comparison cost.
static CROSS_ENCODER_RAN: AtomicBool = AtomicBool::new(false);

/// Run the cross-encoder comparison diagnostic for an image-image
/// query. For each *other* available encoder, builds a temporary
/// CosineIndex from that encoder's embeddings, runs top-5 against
/// the query image's embedding in that encoder's space, and emits
/// a single diagnostic with all encoders' top-5 results side-by-side.
///
/// Lets the user answer "would DINOv2 have ranked these images
/// differently than CLIP did?" without manually switching encoders
/// and re-running the search.
fn run_cross_encoder_comparison(
    db: &ImageDatabase,
    image_id: i64,
    active_encoder: &str,
) {
    use crate::similarity_and_semantic_search::cosine::CosineIndex;
    use ndarray::Array1;

    let started = std::time::Instant::now();
    // Active encoders only — `dinov2_small` is the legacy 384-d ID
    // that was migrated away in pipeline-version 2 (rows wiped). Including
    // it here would log a noise `cosine_cache_populated: count=0` per
    // "View Similar" click and waste a populate roundtrip.
    let all_encoders = ["clip_vit_b_32", "dinov2_base", "siglip2_base"];
    // ID-native exclusion (T3-2/#6): the query image is the clicked id
    // itself — no path lookup needed.
    let exclude_id = Some(image_id);

    let mut per_encoder: Vec<serde_json::Value> = Vec::new();
    for enc in all_encoders {
        if enc == active_encoder {
            // Active encoder's results are already in the main
            // search_query diagnostic — no need to duplicate.
            continue;
        }
        let enc_started = std::time::Instant::now();
        // Pull this encoder's embedding for the query image. Falls
        // back gracefully — empty embeddings table for an encoder
        // means we just record "no embeddings".
        let q_emb = if enc == "clip_vit_b_32" {
            db.get_image_embedding(image_id).ok()
        } else {
            db.get_embedding(image_id, enc).ok()
        };
        let q_emb = match q_emb.filter(|v| !v.is_empty()) {
            Some(v) => v,
            None => {
                per_encoder.push(serde_json::json!({
                    "encoder_id": enc,
                    "status": "no_embedding_for_query_image",
                }));
                continue;
            }
        };

        let mut tmp = CosineIndex::new();
        tmp.populate_from_db_for_encoder(db, enc);
        let cache_size = tmp.cached_images.len();
        if cache_size == 0 {
            per_encoder.push(serde_json::json!({
                "encoder_id": enc,
                "status": "no_cache_embeddings",
            }));
            continue;
        }
        let q = Array1::from_vec(q_emb);
        let results = tmp.get_similar_images_sorted(&q, 5, exclude_id);
        per_encoder.push(serde_json::json!({
            "encoder_id": enc,
            "status": "ok",
            "cache_size": cache_size,
            "top5": results.iter().map(|(id, s)| serde_json::json!({
                "image_id": id,
                "score": *s,
            })).collect::<Vec<_>>(),
            "elapsed_ms": enc_started.elapsed().as_millis() as u64,
        }));
    }

    perf::record_diagnostic(
        "cross_encoder_comparison",
        serde_json::json!({
            "fired_for_image_id": image_id,
            "active_encoder": active_encoder,
            "comparison_results": per_encoder,
            "total_elapsed_ms": started.elapsed().as_millis() as u64,
            "note": "Fires once per session — first View-Similar after launch. Subsequent searches skip the cross-encoder cost.",
        }),
    );
}

/// Phase 5 — multi-encoder rank fusion for image-image similarity.
///
/// Replaces the tiered "1 of top 5, 5 of top 25" sampling strategy
/// with Reciprocal Rank Fusion across every available encoder. The
/// fused output naturally surfaces images that *all three* encoders
/// agree are similar (CLIP for concept overlap + DINOv2 for visual
/// structure + SigLIP-2 for descriptive content), which is both more
/// accurate AND more diverse than any single-encoder ranking.
///
/// The user no longer pays the "we randomly skipped some good results
/// to get diversity" tax — diversity emerges from inter-encoder
/// disagreement on what counts as similar.
///
/// Implementation:
/// 1. For each encoder family (CLIP, SigLIP-2, DINOv2): pull the
///    query image's per-encoder embedding from the DB. Skip encoders
///    that don't have an embedding for this image yet (graceful
///    fallback — fusion still works with whichever encoders are
///    indexed).
/// 2. Score the query against that encoder's per-image embeddings
///    via FusionIndexState.ranked_for_encoder, getting top-K.
/// 3. Apply RRF over the 1-3 ranked lists to produce one fused list.
/// 4. Resolve paths → image ids + thumbnails like the other similarity
///    commands.
///
/// `top_n`: how many fused results to return.
/// `per_encoder_top_k`: how many top results from each encoder to
///   feed into the fusion. Defaults to `5 * top_n` (~150 for top_n=30)
///   so the fusion has enough candidate diversity from each encoder.
#[tauri::command]
#[tracing::instrument(
    name = "ipc.get_fused_similar_images",
    skip(db, fusion_state),
    fields(image_id, top_n, per_encoder_top_k)
)]
pub fn get_fused_similar_images(
    db: State<'_, ImageDatabase>,
    fusion_state: State<'_, FusionIndexState>,
    image_id: i64,
    top_n: usize,
    per_encoder_top_k: Option<usize>,
) -> Result<Vec<ImageSearchResult>, ApiError> {
    use ndarray::Array1;

    let per_encoder_top_k = per_encoder_top_k.unwrap_or(top_n.saturating_mul(5).max(50));
    info!(
        "get_fused_similar_images - image_id: {image_id}, top_n: {top_n}, \
         per_encoder_top_k: {per_encoder_top_k}"
    );

    let started = std::time::Instant::now();
    // ID-native exclusion (T3-2/#6): exclude the clicked image by id —
    // the old whole-library get_all_images() join purely to find its
    // path is gone.
    let exclude_id = Some(image_id);

    // Phase 11c — fusion only iterates over user-enabled encoders.
    // settings.json's `enabled_encoders` is the source of truth;
    // disabled encoders' embeddings stay in the DB (so re-enabling
    // is instant) but they don't contribute to fusion. Always at
    // least one encoder per the IPC validator.
    let enabled = crate::settings::Settings::load().resolved_enabled_encoders();
    let fusion_encoders: Vec<&str> = enabled.iter().map(|s| s.as_str()).collect();

    let mut ranked_lists: Vec<RankedList> = Vec::with_capacity(fusion_encoders.len());
    let mut per_encoder_diag: Vec<serde_json::Value> = Vec::new();

    for &enc in &fusion_encoders {
        let enc_started = std::time::Instant::now();
        // Pull this encoder's embedding for the query image.
        let q_emb = db.get_embedding(image_id, enc).ok();
        let q_emb = match q_emb.filter(|v| !v.is_empty()) {
            Some(v) => v,
            None => {
                per_encoder_diag.push(serde_json::json!({
                    "encoder_id": enc,
                    "status": "no_embedding_for_query_image",
                    "elapsed_ms": enc_started.elapsed().as_millis() as u64,
                }));
                continue;
            }
        };
        let q = Array1::from_vec(q_emb);
        let ranked = fusion_state
            .ranked_for_encoder(&db, enc, &q, per_encoder_top_k, exclude_id)
            .map_err(ApiError::Cosine)?;
        let count = ranked.len();
        if count == 0 {
            per_encoder_diag.push(serde_json::json!({
                "encoder_id": enc,
                "status": "empty_ranked_list_for_encoder",
                "elapsed_ms": enc_started.elapsed().as_millis() as u64,
            }));
            continue;
        }
        ranked_lists.push(RankedList {
            encoder_id: (*enc).to_string(),
            items: ranked.clone(),
        });
        per_encoder_diag.push(serde_json::json!({
            "encoder_id": enc,
            "status": "ok",
            "ranked_count": count,
            "top5_ids": ranked.iter().take(5)
                .map(|(id, s)| serde_json::json!({"image_id": id, "score": *s}))
                .collect::<Vec<_>>(),
            "elapsed_ms": enc_started.elapsed().as_millis() as u64,
        }));
    }

    if ranked_lists.is_empty() {
        info!("Fusion: no encoder produced a ranked list — returning empty");
        return Ok(Vec::new());
    }

    let fused = reciprocal_rank_fusion(&ranked_lists, DEFAULT_K_RRF, top_n);

    // Batch-hydrate fused ids → ImageSearchResult in one WHERE id IN (...)
    // query, preserving fused-score order. The "score" surfaced to the
    // frontend is the fused RRF score (roughly 0 .. N_encoders/(k+1),
    // not the [0,1] cosine range) — frontends should label it "Fused".
    let ranked: Vec<(i64, f32)> = fused.iter().map(|f| (f.image_id, f.fused_score)).collect();
    let hydrated = hydrate_search_results(&db, &ranked);
    let results = hydrated.results;
    let resolution_misses = hydrated.missed_ids;
    let thumb_misses = hydrated.thumbnail_misses;

    perf::record_diagnostic(
        "search_query",
        serde_json::json!({
            "type": "fused",
            "top_n": top_n,
            "per_encoder_top_k": per_encoder_top_k,
            "k_rrf": DEFAULT_K_RRF,
            "query_image_id": image_id,
            "encoders_used": ranked_lists
                .iter()
                .map(|r| r.encoder_id.clone())
                .collect::<Vec<_>>(),
            "encoders_skipped": fusion_encoders.len() - ranked_lists.len(),
            "fused_result_count": fused.len(),
            "resolved_count": results.len(),
            "thumbnail_misses": thumb_misses,
            "missed_ids_sample":
                resolution_misses.iter().take(10).copied().collect::<Vec<_>>(),
            "per_encoder": per_encoder_diag,
            "fused_top10_with_evidence": fused.iter().take(10).map(|f| serde_json::json!({
                "image_id": f.image_id,
                "fused_score": f.fused_score,
                "per_encoder_evidence": f.per_encoder.iter().map(|(e, r, s)| serde_json::json!({
                    "encoder_id": e,
                    "rank": r,
                    "encoder_score": s,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "total_elapsed_ms": started.elapsed().as_millis() as u64,
        }),
    );

    info!(
        "get_fused_similar_images returning {} results (used {} encoders, {} ms)",
        results.len(),
        ranked_lists.len(),
        started.elapsed().as_millis(),
    );

    Ok(results)
}

#[tauri::command]
#[tracing::instrument(name = "ipc.get_tiered_similar_images", skip(db, fusion_state), fields(image_id, encoder_id = ?encoder_id))]
pub fn get_tiered_similar_images(
    db: State<'_, ImageDatabase>,
    fusion_state: State<'_, FusionIndexState>,
    image_id: i64,
    encoder_id: Option<String>,
) -> Result<Vec<ImageSearchResult>, ApiError> {
    use ndarray::Array1;

    // Default to CLIP-ViT-B/32 if frontend hasn't migrated to passing
    // the param yet. After the picker UI ships, callers always pass
    // the user's selected image encoder ID.
    let encoder_id = encoder_id.unwrap_or_else(|| "clip_vit_b_32".to_string());

    info!(
        "get_tiered_similar_images - image_id: {} encoder: {}",
        image_id, encoder_id
    );

    // ID-native exclusion (T3-2/#6): exclude the clicked image by id.
    let exclude_id = Some(image_id);

    // Read the chosen encoder's embedding for the clicked image.
    // Falls back to legacy `images.embedding` for the CLIP case
    // (where that column is the source of truth).
    let embedding = if encoder_id == "clip_vit_b_32" {
        db.get_image_embedding(image_id)?
    } else {
        db.get_embedding(image_id, &encoder_id)?
    };

    let query = Array1::from_vec(embedding);
    // Borrow the warm fusion slot for this encoder (T3-2/#8) — the primary
    // CosineIndexState no longer holds a duplicate. `with_encoder_index`
    // maps/populates on a cold slot and scores under a shared read lock on
    // a warm one, so the prefetch burst stays parallel.
    let (raw_results, cache_size) = fusion_state
        .with_encoder_index(&db, &encoder_id, |idx| {
            (
                idx.get_tiered_similar_images(&query, exclude_id),
                idx.cached_images.len(),
            )
        })
        .map_err(ApiError::Cosine)?;
    let raw_scores: Vec<f32> = raw_results.iter().map(|(_, s)| *s).collect();

    // Batch-hydrate ids → ImageSearchResult in one WHERE id IN (...)
    // query (dimensions included, so the result lands fully-populated in
    // one IPC round-trip — the frontend no longer runs N parallel
    // getImageSize DOM loads). Ranked order preserved.
    let hydrated = hydrate_search_results(&db, &raw_results);
    let results = hydrated.results;
    let resolution_misses = hydrated.missed_ids;
    let thumb_misses = hydrated.thumbnail_misses;

    // Diagnostic: dump the FULL cosine result list (ids + scores) plus
    // score-distribution stats and hydration outcomes. Lets the user
    // audit whether bad search results are an encoder-quality issue
    // (cosine returned the wrong things), a hydration miss (right ids
    // returned but no DB row), or a thumbnail-enrichment issue.
    perf::record_diagnostic(
        "search_query",
        serde_json::json!({
            "type": "tiered_similar",
            "encoder_id": encoder_id,
            "query_image_id": image_id,
            "cosine_cache_size": cache_size,
            "raw_results": raw_results.iter().map(|(id, s)| serde_json::json!({
                "image_id": id,
                "score": *s,
            })).collect::<Vec<_>>(),
            "raw_result_count": raw_results.len(),
            "score_distribution":
                crate::similarity_and_semantic_search::cosine::diagnostics::score_distribution_stats(&raw_scores),
            "path_resolution_outcomes": {
                "raw_count": raw_results.len(),
                "resolved_count": results.len(),
                "missed_count": resolution_misses.len(),
                "thumbnail_misses": thumb_misses,
                "missed_ids_sample": resolution_misses.iter().take(10).copied().collect::<Vec<_>>(),
            },
        }),
    );

    info!(
        "get_tiered_similar_images returning {} results",
        results.len()
    );

    // Fire the cross-encoder comparison diagnostic once per session.
    // compare_exchange ensures only the first arriving View-Similar
    // call pays the cost (~50-200 ms × number of other encoders). The
    // comparison builds its own temporary indexes and holds no fusion
    // lock, so there is nothing to release first.
    if perf::is_profiling_enabled()
        && CROSS_ENCODER_RAN
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    {
        run_cross_encoder_comparison(&db, image_id, &encoder_id);
    }

    Ok(results)
}

#[tauri::command]
#[tracing::instrument(name = "ipc.get_similar_images", skip(db, fusion_state), fields(image_id, top_n, encoder_id = ?encoder_id))]
pub fn get_similar_images(
    db: State<'_, ImageDatabase>,
    fusion_state: State<'_, FusionIndexState>,
    image_id: i64,
    top_n: usize,
    encoder_id: Option<String>,
) -> Result<Vec<ImageSearchResult>, ApiError> {
    use ndarray::Array1;
    let encoder_id = encoder_id.unwrap_or_else(|| "clip_vit_b_32".to_string());

    info!(
        "get_similar_images - image_id: {}, top_n: {}, encoder: {}",
        image_id, top_n, encoder_id
    );

    // ID-native exclusion (T3-2/#6): exclude the clicked image by id.
    let exclude_id = Some(image_id);

    debug!("Fetching embedding for image_id: {} via {}", image_id, encoder_id);
    let embedding = if encoder_id == "clip_vit_b_32" {
        db.get_image_embedding(image_id)?
    } else {
        db.get_embedding(image_id, &encoder_id)?
    };
    debug!("Retrieved embedding - length: {}", embedding.len());

    let query = Array1::from_vec(embedding);
    // Borrow the warm fusion slot for this encoder (T3-2/#8).
    let (raw_results, cache_size) = fusion_state
        .with_encoder_index(&db, &encoder_id, |idx| {
            (
                idx.get_similar_images(&query, top_n, exclude_id),
                idx.cached_images.len(),
            )
        })
        .map_err(ApiError::Cosine)?;
    let raw_scores: Vec<f32> = raw_results.iter().map(|(_, s)| *s).collect();
    debug!(
        "index.get_similar_images returned {} results",
        raw_results.len()
    );

    // Batch-hydrate ids → ImageSearchResult (dimensions + thumbnail in
    // one WHERE id IN (...) query, preserving ranked order).
    let hydrated = hydrate_search_results(&db, &raw_results);
    let results = hydrated.results;
    let resolution_misses = hydrated.missed_ids;
    let thumb_misses = hydrated.thumbnail_misses;

    // Diagnostic — same shape as the tiered version's diagnostic.
    perf::record_diagnostic(
        "search_query",
        serde_json::json!({
            "type": "similar",
            "encoder_id": encoder_id,
            "top_n": top_n,
            "query_image_id": image_id,
            "cosine_cache_size": cache_size,
            "raw_results": raw_results.iter().map(|(id, s)| serde_json::json!({
                "image_id": id,
                "score": *s,
            })).collect::<Vec<_>>(),
            "raw_result_count": raw_results.len(),
            "score_distribution":
                crate::similarity_and_semantic_search::cosine::diagnostics::score_distribution_stats(&raw_scores),
            "path_resolution_outcomes": {
                "raw_count": raw_results.len(),
                "resolved_count": results.len(),
                "missed_count": resolution_misses.len(),
                "thumbnail_misses": thumb_misses,
                "missed_ids_sample": resolution_misses.iter().take(10).copied().collect::<Vec<_>>(),
            },
        }),
    );

    info!("Final results count: {}", results.len());

    // Cross-encoder comparison — once per session (see top of file).
    if perf::is_profiling_enabled()
        && CROSS_ENCODER_RAN
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    {
        run_cross_encoder_comparison(&db, image_id, &encoder_id);
    }

    Ok(results)
}
