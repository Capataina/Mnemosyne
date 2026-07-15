use tauri::State;

use crate::commands::ApiError;
use crate::db::{images_query::PipelineStats, ImageDatabase, ID};
use crate::image_struct::ImageData;

#[tauri::command]
#[tracing::instrument(name = "ipc.get_images", skip(db), fields(tag_count = filter_tag_ids.len()))]
pub fn get_images(
    db: State<'_, ImageDatabase>,
    filter_tag_ids: Vec<ID>,
    filter_string: String,
    match_all_tags: Option<bool>,
) -> Result<Vec<ImageData>, ApiError> {
    // match_all_tags is Option so older frontend builds (or tests)
    // can call without specifying — defaults to false (OR semantic).
    let match_all = match_all_tags.unwrap_or(false);
    Ok(db.get_images_with_thumbnails(filter_tag_ids, filter_string, match_all)?)
}

/// Snapshot of pipeline progress — counts of images at each stage
/// (total / with-thumbnail / with-embedding / orphaned). Surfaced in
/// the SettingsDrawer so the user can see how much work the indexing
/// pipeline has done; also useful for verifying the (planned) parallel
/// thumbnail+encoding worker design is making progress on both queues.
///
/// Single SELECT — one DB Mutex acquire regardless of library size.
#[tauri::command]
#[tracing::instrument(name = "ipc.get_pipeline_stats", skip(db))]
pub fn get_pipeline_stats(db: State<'_, ImageDatabase>) -> Result<PipelineStats, ApiError> {
    Ok(db.get_pipeline_stats()?)
}

/// Persist a drag-reorder. The frontend sends the FULL new ordering of
/// whatever it currently has in view (only offered in the "custom"
/// sort mode on the unfiltered catalogue — see masonryPacking's
/// consumer for why a partial/filtered reorder isn't exposed), and
/// this rewrites every row's `manual_order` as a fresh 0..N-1
/// sequence in one transaction.
#[tauri::command]
#[tracing::instrument(name = "ipc.set_manual_order", skip(db), fields(count = ordered_ids.len()))]
pub fn set_manual_order(
    db: State<'_, ImageDatabase>,
    ordered_ids: Vec<ID>,
) -> Result<(), ApiError> {
    Ok(db.set_manual_order(&ordered_ids)?)
}

/// Persist a drag-resize. `col_span` of `None` clears back to the
/// default single-column width.
#[tauri::command]
#[tracing::instrument(name = "ipc.set_manual_col_span", skip(db))]
pub fn set_manual_col_span(
    db: State<'_, ImageDatabase>,
    id: ID,
    col_span: Option<i64>,
) -> Result<(), ApiError> {
    Ok(db.set_manual_col_span(id, col_span)?)
}
