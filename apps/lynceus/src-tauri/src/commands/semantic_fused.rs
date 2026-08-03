//! Phase 11d — text-image RRF fusion.
//!
//! Mirrors `commands::similarity::get_fused_similar_images` but for
//! text-to-image queries. For each enabled text-supporting encoder
//! (CLIP, SigLIP-2 — DINOv2 has no text branch), encodes the query,
//! scores against the matching image-side cosine cache, and fuses
//! the resulting ranked lists via RRF.
//!
//! ## Why this exists
//!
//! The previous `semantic_search` IPC dispatched on a single user-
//! picked text encoder (Phase 4). With Phase 11c's per-encoder
//! enable/disable model + Phase 5's RRF philosophy, the picker
//! concept is obsolete: search just runs every enabled text encoder
//! and fuses. The user's "Encoders" Settings panel decides which
//! encoders are part of the ensemble.
//!
//! ## What about DINOv2?
//!
//! DINOv2 is image-only (no text branch). It is enabled-or-disabled
//! the same way as CLIP and SigLIP-2 in `enabled_encoders`, but
//! `get_fused_semantic_search` skips it implicitly because there is
//! no text encoder to invoke. DINOv2 still participates in image-
//! image fusion via `get_fused_similar_images`.
//!
//! ## Trade-offs
//!
//! - First call after launch is cold for whichever text encoders
//!   haven't been pre-warmed. CLIP gets a real-input pre-warm during
//!   indexing (R4); SigLIP-2 lazy-loads on first call here.
//! - The fused score replaces the cosine similarity score the
//!   single-encoder path returned. Like `get_fused_similar_images`,
//!   it's an unbounded RRF score (~0–0.05 for 2 encoders + k=60),
//!   not [0, 1] — frontends that present this number should label it
//!   "Fused" rather than "Cosine similarity" if surfaced in tooltips.

use ndarray::Array1;
use tauri::State;
use tracing::{info, warn};

use crate::commands::{hydrate_search_results, ApiError, ImageSearchResult};
use crate::db::ImageDatabase;
use crate::paths;
use crate::similarity_and_semantic_search::cosine::name_match::{
    rank_filenames, NameQuery, DEFAULT_NAME_MATCH_THRESHOLD,
};
use crate::similarity_and_semantic_search::cosine::rrf::{
    reciprocal_rank_fusion, RankedList, DEFAULT_K_RRF,
};
use crate::similarity_and_semantic_search::encoder_siglip2::{
    Siglip2TextEncoder, SIGLIP2_TEXT_MODEL_FILENAME, SIGLIP2_TOKENIZER_FILENAME,
};
use crate::similarity_and_semantic_search::encoder_text::ClipTextEncoder;
use crate::similarity_and_semantic_search::encoders::TextEncoder as TextEncoderTrait;
use crate::{perf, FusionIndexState, TextEncoderState};

/// Stable encoder ids for the text-side picker. Must match the values
/// in `commands::encoders::ENCODERS` and the frontend `imageEncoder` /
/// `textEncoder` localStorage entries. Moved here from the retired
/// `commands::semantic` (the legacy single-encoder dispatch) when that
/// module was deleted — this is now their only home.
pub const CLIP_TEXT_ENCODER_ID: &str = "clip_vit_b_32";
pub const SIGLIP2_TEXT_ENCODER_ID: &str = "siglip2_base";

/// Encoders that have a usable text branch. Used to filter the
/// enabled-encoder list down to those that can actually run a text
/// query. DINOv2 is image-only and therefore not eligible.
const TEXT_CAPABLE_ENCODERS: &[&str] = &[CLIP_TEXT_ENCODER_ID, SIGLIP2_TEXT_ENCODER_ID];

/// Ranked-list id for the fuzzy-filename signal — the 4th list fused
/// alongside the encoders. Not an encoder id: it maps to no model and no
/// cosine cache, it scores basenames directly (see `cosine::name_match`).
const FILENAME_SIGNAL_ID: &str = "filename";

/// Text-image rank-fusion search across every enabled text-capable
/// encoder.
///
/// Each enabled encoder encodes the query into its own embedding
/// space, scores against the matching image-side cache, takes top-K.
/// RRF fuses the (up to 2) ranked lists into one final ordering.
#[tauri::command]
#[tracing::instrument(
    name = "ipc.get_fused_semantic_search",
    skip(db, fusion_state, text_encoder_state),
    fields(query_len = query.len(), top_n, per_encoder_top_k)
)]
pub fn get_fused_semantic_search(
    db: State<'_, ImageDatabase>,
    fusion_state: State<'_, FusionIndexState>,
    text_encoder_state: State<'_, TextEncoderState>,
    query: String,
    top_n: usize,
    per_encoder_top_k: Option<usize>,
) -> Result<Vec<ImageSearchResult>, ApiError> {
    let per_encoder_top_k = per_encoder_top_k.unwrap_or(top_n.saturating_mul(5).max(50));
    let started = std::time::Instant::now();

    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    // Filter enabled encoders down to those that can actually run text
    // queries. The intersection of TEXT_CAPABLE_ENCODERS and
    // enabled_encoders is what we'll fuse over.
    let enabled = crate::settings::Settings::load().resolved_enabled_encoders();
    let text_encoders: Vec<&str> = TEXT_CAPABLE_ENCODERS
        .iter()
        .copied()
        .filter(|tc| enabled.iter().any(|e| e == tc))
        .collect();

    // No early return when text_encoders is empty anymore: the filename
    // signal below needs no encoder, so a query still resolves by name
    // even with every text encoder disabled. Only when NOTHING (name or
    // encoder) produces a list do we return empty (the check further down).

    info!(
        "get_fused_semantic_search query='{query}' top_n={top_n} \
         text_encoders={text_encoders:?}"
    );

    // +1 slot for the filename list fused alongside the encoders.
    let mut ranked_lists: Vec<RankedList> = Vec::with_capacity(text_encoders.len() + 1);
    let mut per_encoder_diag: Vec<serde_json::Value> = Vec::new();

    // Signal 4 — fuzzy filename match. Built BEFORE the encoder loop but
    // fed into the SAME RRF fusion, so it weighs in as a peer of the
    // encoders rather than a separate path. Two properties matter:
    //   - It needs no embedding, so it can surface an image no encoder
    //     has embedded yet (fresh index mid-encode, re-enabled encoder).
    //   - When it matches nothing the list is empty and never pushed, so
    //     an encoder-only fusion is byte-identical to the pre-signal
    //     behaviour (the equivalence the task requires; RRF adds
    //     contributions only for images a list actually ranks).
    // Order in `ranked_lists` does not affect fused scores (RRF sums
    // per-image contributions regardless of list order); it only sets the
    // per-encoder evidence order, which is diagnostic.
    let mut filename_matched = 0usize;
    if let Some(name_query) = NameQuery::new(query) {
        let name_started = std::time::Instant::now();
        // A DB hiccup here degrades the filename signal to "no match"
        // rather than failing the whole search — the encoders can still
        // answer. unwrap_or_default is the deliberate soft-fail.
        let names = match db.get_image_names_for_search() {
            Ok(v) => v,
            Err(e) => {
                warn!("filename signal: name query failed ({e}); skipping name match");
                Vec::new()
            }
        };
        let scanned = names.len();
        let name_ranked = rank_filenames(
            &name_query,
            &names,
            DEFAULT_NAME_MATCH_THRESHOLD,
            per_encoder_top_k,
        );
        filename_matched = name_ranked.len();
        let top5: Vec<serde_json::Value> = name_ranked
            .iter()
            .take(5)
            .map(|(id, s)| serde_json::json!({ "image_id": id, "score": *s }))
            .collect();
        if !name_ranked.is_empty() {
            ranked_lists.push(RankedList {
                encoder_id: FILENAME_SIGNAL_ID.to_string(),
                items: name_ranked,
            });
        }
        per_encoder_diag.push(serde_json::json!({
            "encoder_id": FILENAME_SIGNAL_ID,
            "status": if filename_matched > 0 { "ok" } else { "no_match" },
            "scanned": scanned,
            "matched": filename_matched,
            "threshold": DEFAULT_NAME_MATCH_THRESHOLD,
            "top5_ids": top5,
            "elapsed_ms": name_started.elapsed().as_millis() as u64,
        }));
    }

    if text_encoders.is_empty() {
        // Every text-capable encoder is disabled — text-image fusion
        // cannot contribute (image-image fusion still works via
        // get_fused_similar_images / DINOv2). The filename signal above
        // may still have produced a list.
        warn!(
            "get_fused_semantic_search: no enabled text-capable encoders \
             (enabled = {enabled:?}); relying on the filename signal only"
        );
    }

    for &enc in &text_encoders {
        let enc_started = std::time::Instant::now();

        let q_emb = match encode_query(enc, &text_encoder_state, query) {
            Ok(v) => v,
            Err(e) => {
                per_encoder_diag.push(serde_json::json!({
                    "encoder_id": enc,
                    "status": "encode_failed",
                    "error": e.to_string(),
                    "elapsed_ms": enc_started.elapsed().as_millis() as u64,
                }));
                continue;
            }
        };

        let q_array = Array1::from_vec(q_emb);
        // The image-side cache key matches the text encoder id (CLIP
        // text vectors compare against CLIP image vectors etc.). The
        // FusionIndexState lazy-populates per encoder.
        let ranked = fusion_state
            .ranked_for_encoder(&db, enc, &q_array, per_encoder_top_k, None)
            .map_err(ApiError::Cosine)?;

        let count = ranked.len();
        if count == 0 {
            per_encoder_diag.push(serde_json::json!({
                "encoder_id": enc,
                "status": "empty_image_cache",
                "elapsed_ms": enc_started.elapsed().as_millis() as u64,
            }));
            continue;
        }

        ranked_lists.push(RankedList {
            encoder_id: enc.to_string(),
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
        info!("get_fused_semantic_search: no encoder produced a ranked list — returning empty");
        return Ok(Vec::new());
    }

    let fused = reciprocal_rank_fusion(&ranked_lists, DEFAULT_K_RRF, top_n);

    // Batch-hydrate fused ids → ImageSearchResult in one WHERE id IN (...)
    // query, preserving fused-score order.
    let ranked: Vec<(i64, f32)> = fused.iter().map(|f| (f.image_id, f.fused_score)).collect();
    let hydrated = hydrate_search_results(&db, &ranked);
    let results = hydrated.results;
    let resolution_misses = hydrated.missed_ids;
    let thumb_misses = hydrated.thumbnail_misses;

    perf::record_diagnostic(
        "search_query",
        serde_json::json!({
            "type": "fused_semantic",
            "query_text": query,
            "top_n": top_n,
            "per_encoder_top_k": per_encoder_top_k,
            "k_rrf": DEFAULT_K_RRF,
            "encoders_used": ranked_lists
                .iter()
                .map(|r| r.encoder_id.clone())
                .collect::<Vec<_>>(),
            // Encoder lists only — exclude the filename list, which is not
            // an encoder, so the skipped count stays "text encoders that
            // produced nothing" and can never underflow.
            "encoders_skipped": text_encoders
                .len()
                .saturating_sub(ranked_lists.len() - usize::from(filename_matched > 0)),
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
        "get_fused_semantic_search returning {} results (used {} encoders, {} ms)",
        results.len(),
        ranked_lists.len(),
        started.elapsed().as_millis(),
    );

    Ok(results)
}

/// Internal helper: lazy-load the right text encoder, run encode,
/// return the embedding. Returns Box<dyn Error> via the encoder's
/// own error type so the caller can stuff it into a diagnostic.
fn encode_query(
    encoder_id: &str,
    state: &TextEncoderState,
    query: &str,
) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    match encoder_id {
        id if id == CLIP_TEXT_ENCODER_ID => {
            let mut lock = state
                .encoder
                .lock()
                .map_err(|e| format!("CLIP text encoder mutex poisoned: {e}"))?;
            if lock.is_none() {
                let models_dir = paths::models_dir();
                let model_precision = crate::settings::Settings::load()
                    .effective_model_precision();
                let model_path = paths::model_path_for(
                    crate::model_download::CLIP_TEXT_FILENAME,
                    &model_precision,
                );
                let tokenizer_path =
                    models_dir.join(crate::model_download::CLIP_TOKENIZER_FILENAME);
                *lock = Some(ClipTextEncoder::new(&model_path, &tokenizer_path)?);
            }
            let encoder = lock.as_mut().unwrap();
            Ok(encoder.encode(query)?)
        }
        id if id == SIGLIP2_TEXT_ENCODER_ID => {
            let mut lock = state
                .siglip2_encoder
                .lock()
                .map_err(|e| format!("SigLIP-2 text encoder mutex poisoned: {e}"))?;
            if lock.is_none() {
                let models_dir = paths::models_dir();
                let model_precision = crate::settings::Settings::load()
                    .effective_model_precision();
                let model_path =
                    paths::model_path_for(SIGLIP2_TEXT_MODEL_FILENAME, &model_precision);
                let tokenizer_path = models_dir.join(SIGLIP2_TOKENIZER_FILENAME);
                *lock = Some(Siglip2TextEncoder::new(&model_path, &tokenizer_path)?);
            }
            let encoder = lock.as_mut().unwrap();
            Ok(encoder.encode(query)?)
        }
        other => Err(format!("Unknown text encoder id: {other}").into()),
    }
}
