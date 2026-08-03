use tauri::State;
use tracing::info;

use crate::commands::{hydrate_search_results, ApiError, ImageSearchResult};
use crate::db::ImageDatabase;
use crate::perf;
use crate::similarity_and_semantic_search::cosine::rrf::{
    reciprocal_rank_fusion, RankedList, DEFAULT_K_RRF,
};
use crate::FusionIndexState;

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

