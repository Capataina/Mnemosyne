use std::path::Path;

use tauri::State;

use crate::commands::ApiError;
use crate::db::{
    images_query::{FeedManifestRow, PipelineStats},
    ImageDatabase, ID,
};
use crate::image_struct::ImageData;
use crate::paths;
use crate::thumbnail::ThumbnailGenerator;

/// Bucket ladder of thumbnail widths the adaptive masonry grid requests.
/// `get_thumbnail` snaps a caller's `target_px` up to the smallest of
/// these, so a tile stretched across two or three columns pulls a
/// sharper file instead of upscaling the 480px base thumbnail. The first
/// entry (480) is the base bucket produced at index time; the rest are
/// pre-generated eagerly by the index-time bucket pass (see
/// `indexing::run_pipeline_inner`) and re-generated on demand here as a
/// fallback. This is the single source of truth for the ladder — the
/// indexing pass slices `[0]` for the base width and `[1..]` for the
/// eager extras.
pub const THUMBNAIL_BUCKETS: [u32; 4] = [480, 960, 1440, 2048];

#[tauri::command]
#[tracing::instrument(name = "ipc.get_images", skip(db), fields(tag_count = filter_tag_ids.len()))]
pub fn get_images(
    db: State<'_, ImageDatabase>,
    filter_tag_ids: Vec<ID>,
    filter_string: String,
    match_all_tags: Option<bool>,
    exclude_tag_ids: Option<Vec<ID>>,
) -> Result<Vec<ImageData>, ApiError> {
    // match_all_tags and exclude_tag_ids are Option so an older frontend
    // build (or a test) can call without them — defaulting to OR
    // semantics and no exclude, i.e. exactly the pre-drawer behaviour.
    // The library drawer passes `excludeTagIds` to drive the exclude
    // filter (images carrying NONE of the given tags).
    let match_all = match_all_tags.unwrap_or(false);
    let exclude = exclude_tag_ids.unwrap_or_default();
    Ok(db.get_images_with_thumbnails(filter_tag_ids, filter_string, match_all, exclude)?)
}

/// T3-1 — the compact layout manifest that replaces the full-catalogue
/// `get_images` fetch for the main feed. Same filter surface and the
/// same visibility membership as `get_images` (test-locked engine-side),
/// but each row is a handful of scalars plus one thumbnail path: no
/// tags join, no notes, no original path. Full detail is hydrated per
/// id-batch via `get_image_details`.
#[tauri::command]
#[tracing::instrument(name = "ipc.get_feed_manifest", skip(db), fields(tag_count = filter_tag_ids.len()))]
pub fn get_feed_manifest(
    db: State<'_, ImageDatabase>,
    filter_tag_ids: Vec<ID>,
    match_all_tags: Option<bool>,
    exclude_tag_ids: Option<Vec<ID>>,
) -> Result<Vec<FeedManifestRow>, ApiError> {
    // Optional args mirror `get_images` so both commands accept the same
    // call shapes during the transition.
    let match_all = match_all_tags.unwrap_or(false);
    let exclude = exclude_tag_ids.unwrap_or_default();
    Ok(db.get_feed_manifest(filter_tag_ids, match_all, exclude)?)
}

/// T3-1 — id-batch hydration of full image detail (tags, notes-adjacent
/// metadata, original path, manual layout columns). One `WHERE id IN`
/// SELECT per ≤500-id chunk; unknown or currently-invisible ids are
/// silently absent from the result, matching how the old catalogue
/// `find` simply missed them.
#[tauri::command]
#[tracing::instrument(name = "ipc.get_image_details", skip(db), fields(id_count = ids.len()))]
pub fn get_image_details(
    db: State<'_, ImageDatabase>,
    ids: Vec<ID>,
) -> Result<Vec<ImageData>, ApiError> {
    Ok(db.get_image_details_by_ids(&ids)?)
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

/// Resolve — generating and caching on demand — a thumbnail whose width
/// is at least `target_px`, returning an absolute filesystem path the
/// frontend hands to `convertFileSrc`.
///
/// Sizing contract:
/// - Snap `target_px` up to the smallest bucket in [`THUMBNAIL_BUCKETS`].
/// - If `target_px` exceeds the largest bucket, or the chosen bucket is
///   at least the source image's own width, return the **original**
///   image path (full-res, on disk, never moved) — we never upscale.
/// - The 480 bucket IS the base `thumb_<id>.jpg` produced at index time;
///   larger buckets are cached as `thumb_<id>_<bucket>.jpg` beside it and
///   generated lazily on first request.
///
/// A missing DB row yields `NotFound`; a source file deleted from disk
/// yields `NotFound` rather than a panic or an opaque decode error.
#[tauri::command]
#[tracing::instrument(name = "ipc.get_thumbnail", skip(db))]
pub fn get_thumbnail(
    db: State<'_, ImageDatabase>,
    id: ID,
    target_px: u32,
) -> Result<String, ApiError> {
    let (source_path, root_id, source_width) = db
        .get_image_source_for_thumbnail(id)?
        .ok_or_else(|| ApiError::NotFound(format!("image with id {id}")))?;

    // Snap up to the smallest bucket that covers the request. `None`
    // means the request is larger than the top bucket.
    let bucket = THUMBNAIL_BUCKETS.iter().copied().find(|b| *b >= target_px);

    // Above the top bucket → hand back the full-res original rather than
    // upscale a bucket beyond the ladder.
    let Some(bucket) = bucket else {
        return Ok(source_path);
    };

    // The bucket meets or exceeds the source's own width → the original
    // is already the best available; never upscale. An unknown source
    // width (row not yet through the thumbnail phase) falls through: the
    // generator caps at the real width anyway, so we simply lose the
    // shortcut, not correctness.
    if let Some(src_w) = source_width {
        if bucket >= src_w {
            return Ok(source_path);
        }
    }

    // Guard a deleted original up front so we return a typed NotFound
    // instead of surfacing an opaque decode error from the generator.
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err(ApiError::NotFound(format!(
            "source image for id {id} missing on disk: {source_path}"
        )));
    }

    // A base-width generator drives both paths — the base thumbnail via
    // `generate_thumbnail`, larger buckets via `ensure_variant`, which
    // takes the bucket width explicitly.
    let generator = ThumbnailGenerator::new(&paths::thumbnails_dir(), THUMBNAIL_BUCKETS[0])
        .map_err(|e| ApiError::Io(e.to_string()))?;

    if bucket == THUMBNAIL_BUCKETS[0] {
        // 480: the base thumb_<id>.jpg. Return it, generating on demand
        // (and recording path + original dims in the DB) if the thumbnail
        // phase hasn't reached this row yet — keeps the grid query and
        // get_pipeline_stats consistent with what's now on disk.
        let base_dir = match root_id {
            Some(rid) => paths::thumbnails_dir_for_root(rid),
            None => paths::thumbnails_dir(),
        };
        let base_path = base_dir.join(format!("thumb_{id}.jpg"));
        if base_path.exists() {
            return Ok(base_path.to_string_lossy().into_owned());
        }
        let result = generator
            .generate_thumbnail(source, id, root_id)
            .map_err(|e| ApiError::Io(e.to_string()))?;
        let _ = db.update_image_thumbnail(
            id,
            &result.thumbnail_path,
            result.original_width,
            result.original_height,
        );
        return Ok(result.thumbnail_path.to_string_lossy().into_owned());
    }

    // 960 / 1440 / 2048 — an on-demand higher-resolution bucket.
    let path = generator
        .ensure_variant(source, id, root_id, bucket)
        .map_err(|e| ApiError::Io(e.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
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
