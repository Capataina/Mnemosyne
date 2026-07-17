//! Tauri command handlers, grouped by concern.
//!
//! Each submodule owns the `#[tauri::command]` functions for one
//! concern (images, tags, notes, roots, similarity, semantic,
//! profiling). `lib.rs::run()` registers all of them via
//! `tauri::generate_handler![...]` after re-importing them through
//! the `pub use` lines below.
//!
//! Two pieces of shared state live here rather than in any single
//! submodule because they're used across the similarity + semantic
//! commands:
//!
//! - `ImageSearchResult` — the unified return type for every
//!   cosine/semantic command (semantic_search, get_similar_images,
//!   get_tiered_similar_images). Single struct rather than a
//!   per-command shape so the frontend deserialises one type.
//! - `hydrate_search_results` — turns the cosine index's id-native
//!   `(image_id, score)` output into `ImageSearchResult`s via ONE
//!   `WHERE id IN (...)` batch query (T3-2/#6), preserving ranked order.

use crate::db::{images_query::ImageResultMeta, ImageDatabase, ID};

pub mod encoders;
pub mod error;
pub mod images;
pub mod notes;
pub mod profiling;
pub mod roots;
pub mod semantic;
pub mod semantic_fused;
pub mod similarity;
pub mod tags;

pub use error::ApiError;

pub use images::*;
pub use notes::*;
pub use profiling::*;
pub use roots::*;
pub use semantic::*;
pub use similarity::*;
pub use tags::*;

/// Unified image-search result returned by every cosine/semantic
/// command (semantic_search, get_similar_images, get_tiered_similar_images).
///
/// Audit finding: `ImageSearchResult` and `ImageSearchResult` used to be
/// two near-identical structs — only difference was that the semantic
/// variant carried thumbnail enrichment. After the
/// "dimensions-to-backend" finding lands (this commit), all three
/// commands need the same fields, so they share one type. Field
/// shape preserved across both legacy struct names — this is a strict
/// superset of what `ImageSearchResult` used to send.
#[derive(serde::Serialize)]
pub struct ImageSearchResult {
    pub id: ID,
    pub path: String,
    pub score: f32,
    /// Absolute path to the thumbnail JPEG. None for legacy DB rows
    /// that pre-date the thumbnail migration; the frontend's
    /// `getThumbnailPath(id)` fallback covers this case.
    pub thumbnail_path: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Outcome of batch-hydrating a ranked `(image_id, score)` list into
/// `ImageSearchResult`s. `missed_ids` are ranked ids with no matching
/// DB row (dropped from `results`, kept for the diagnostic — the
/// old path-resolution "misses"); `thumbnail_misses` counts results
/// whose row had no thumbnail bundle yet.
pub(crate) struct HydratedResults {
    pub results: Vec<ImageSearchResult>,
    pub missed_ids: Vec<ID>,
    pub thumbnail_misses: u32,
}

/// Turn the cosine index's id-native `(image_id, score)` output into
/// `ImageSearchResult`s in ONE `WHERE id IN (...)` query (T3-2/#6).
///
/// This replaces the old per-result `resolve_image_id_for_cosine_path`
/// + `get_image_thumbnail_info` N+1 (which also required a whole-library
/// `get_all_images()` join up front just to map paths → ids that were
/// ids to begin with). The index now hands us ids directly, so there is
/// no path to resolve — the id is the DB key. Ranked order is preserved:
/// we hydrate into a map, then walk the ranked list, so the returned
/// results are in exactly the score order the caller produced.
pub(crate) fn hydrate_search_results(
    db: &ImageDatabase,
    ranked: &[(ID, f32)],
) -> HydratedResults {
    let ids: Vec<ID> = ranked.iter().map(|(id, _)| *id).collect();
    // A DB failure here degrades to "everything missed" rather than
    // erroring the whole command — same posture the old resolver had
    // (a failed lookup dropped the row, it didn't fail the search).
    let metas = db.get_images_metadata_for_ids(&ids).unwrap_or_default();
    let mut by_id: std::collections::HashMap<ID, ImageResultMeta> =
        metas.into_iter().map(|m| (m.id, m)).collect();

    let mut results = Vec::with_capacity(ranked.len());
    let mut missed_ids = Vec::new();
    let mut thumbnail_misses = 0u32;
    for (id, score) in ranked {
        match by_id.remove(id) {
            Some(m) => {
                if m.thumbnail_path.is_none() {
                    thumbnail_misses += 1;
                }
                results.push(ImageSearchResult {
                    id: m.id,
                    path: m.path,
                    score: *score,
                    thumbnail_path: m.thumbnail_path,
                    width: m.width,
                    height: m.height,
                });
            }
            None => missed_ids.push(*id),
        }
    }

    HydratedResults {
        results,
        missed_ids,
        thumbnail_misses,
    }
}
