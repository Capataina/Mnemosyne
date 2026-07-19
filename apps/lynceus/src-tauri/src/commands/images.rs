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
use crate::FusionIndexState;

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

/// One row of the settings drawer's collapsible preview breakdown.
#[derive(serde::Serialize, Clone, Debug)]
pub struct PreviewBucketStat {
    /// Bucket width in px (480 = the base thumbnail).
    pub width: u32,
    /// Files that actually exist for this bucket (base: DB-tracked;
    /// larger buckets: counted on disk, where the generator writes them).
    pub done: i64,
    /// How many visible images can ever have this bucket: everything
    /// for the base, `width > bucket` for the larger sizes (the
    /// generator skips buckets at/above the source width — the original
    /// serves those requests directly).
    pub eligible: i64,
}

/// Per-tier preview coverage for the settings drawer's collapsible
/// "Images with previews" breakdown. The base tier reads the DB
/// (`thumbnail_path`, the same source as `with_thumbnail`); the larger
/// tiers are counted from the files on disk, because bucket files are
/// deliberately not DB-tracked (the eager pass and the on-demand
/// `get_thumbnail` fallback both write them stat-first). A ~5k-file
/// directory walk costs single-digit milliseconds; the frontend only
/// calls this while the breakdown is expanded, on a slow poll.
///
/// `(async)`: the walk is filesystem I/O and a 100k-image library's
/// walk should not run on the main thread.
#[tauri::command(async)]
#[tracing::instrument(name = "ipc.get_preview_breakdown", skip(db))]
pub fn get_preview_breakdown(
    db: State<'_, ImageDatabase>,
) -> Result<Vec<PreviewBucketStat>, ApiError> {
    let stats = db.get_pipeline_stats()?;
    let eligibility = db.get_preview_eligibility(&THUMBNAIL_BUCKETS[1..])?;

    // Count bucket files across the flat legacy dir and every root_*
    // subdir in one walk: filenames are thumb_<id>.jpg (base) or
    // thumb_<id>_<width>.jpg (bucket).
    let mut on_disk: std::collections::HashMap<u32, i64> = std::collections::HashMap::new();
    let thumb_root = paths::thumbnails_dir();
    let mut dirs: Vec<std::path::PathBuf> = vec![thumb_root.clone()];
    if let Ok(entries) = std::fs::read_dir(&thumb_root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                dirs.push(p);
            }
        }
    }
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let Some(stem) = name.strip_prefix("thumb_").and_then(|s| s.strip_suffix(".jpg"))
            else {
                continue;
            };
            // stem is "<id>" (base) or "<id>_<width>".
            if let Some((_, width)) = stem.split_once('_') {
                if let Ok(w) = width.parse::<u32>() {
                    *on_disk.entry(w).or_insert(0) += 1;
                }
            }
        }
    }

    let visible = stats.total_images - stats.orphaned;
    let mut out = Vec::with_capacity(THUMBNAIL_BUCKETS.len());
    out.push(PreviewBucketStat {
        width: THUMBNAIL_BUCKETS[0],
        done: stats.with_thumbnail,
        eligible: visible,
    });
    for (width, eligible) in eligibility {
        // Cap at eligible: an on-demand file for a row that later became
        // orphaned would otherwise report done > eligible.
        let done = on_disk.get(&width).copied().unwrap_or(0).min(eligible);
        out.push(PreviewBucketStat { width, done, eligible });
    }
    Ok(out)
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

/// Clear every image's drag-resize span in one shot — the "reset all
/// resizes" bulk action. Returns the number of spans actually cleared so
/// the caller can surface "reset N tiles". The single-row counterpart is
/// `set_manual_col_span(id, None)`.
#[tauri::command]
#[tracing::instrument(name = "ipc.clear_all_manual_spans", skip(db))]
pub fn clear_all_manual_spans(db: State<'_, ImageDatabase>) -> Result<usize, ApiError> {
    Ok(db.clear_all_manual_col_spans()?)
}

/// Best-effort on-disk thumbnail cleanup for one purged image. Mirrors
/// the exact naming `ThumbnailGenerator` writes — the base bucket as
/// `thumb_<id>.jpg` (`generator.rs::generate_thumbnail`) and the eager
/// extra buckets as `thumb_<id>_<width>.jpg` (`generator.rs::ensure_variant`) —
/// so a row with only the base thumbnail generated simply no-ops on the
/// three bucket variants it never had. Errors are swallowed: a stale
/// thumbnail file left behind after a purge is cosmetic disk usage,
/// never worth failing the whole purge over — the same posture
/// `remove_root`'s per-root `remove_dir_all` takes for the same reason.
fn remove_thumbnail_files(id: ID, root_id: Option<ID>) {
    let dir = match root_id {
        Some(rid) => paths::thumbnails_dir_for_root(rid),
        None => paths::thumbnails_dir(),
    };
    let _ = std::fs::remove_file(dir.join(format!("thumb_{id}.jpg")));
    for bucket in &THUMBNAIL_BUCKETS[1..] {
        let _ = std::fs::remove_file(dir.join(format!("thumb_{id}_{bucket}.jpg")));
    }
}

/// Permanently delete every orphaned image row — the explicit "clean up
/// missing files" affordance next to the orphan count in Settings
/// (remedy option 2 in
/// context/notes/image-identity-orphan-lifecycle.md; option 1,
/// content-hash relinking, would additionally *preserve* tags/placement/
/// embeddings across a restructure instead of just discarding the
/// debris, but that's a bigger structural change tracked separately).
///
/// `images_tags` and `embeddings` rows for the purged ids cascade away
/// inside `db.purge_orphaned()` itself (`ON DELETE CASCADE`, verified
/// by its unit test in `db/notes_orphans.rs`); this command's own job
/// is (1) best-effort cleanup of the thumbnail files those rows leave
/// behind on disk — collected via `list_orphaned_locations` BEFORE the
/// rows are deleted, since the paths are derived from `id` + `root_id`,
/// not read back from the row afterwards — and (2) dropping the fusion
/// caches so a purged id already resident there (from a similarity
/// query that ran before this cleanup) can never surface again, same
/// reasoning as `remove_root` / `set_root_enabled`.
///
/// There is no per-root `remove_dir_all` shortcut available here the
/// way `remove_root` has one: orphaned rows from many different roots
/// (or none) can be purged in the same call, so cleanup is necessarily
/// per-file rather than per-directory.
///
/// `(async)`: a large library can have thousands of orphaned rows — the
/// DELETE plus per-row thumbnail-file removal must not block the main
/// thread.
#[tauri::command(async)]
#[tracing::instrument(name = "ipc.purge_orphaned_images", skip(db, fusion_state))]
pub fn purge_orphaned_images(
    db: State<'_, ImageDatabase>,
    fusion_state: State<'_, FusionIndexState>,
) -> Result<usize, ApiError> {
    let locations = db.list_orphaned_locations()?;
    let deleted = db.purge_orphaned()?;
    for (id, root_id) in locations {
        remove_thumbnail_files(id, root_id);
    }
    // The purged ids may still be resident in the fusion caches from a
    // similarity query that ran before this cleanup; clear so the next
    // query cold-populates against the now-smaller DB.
    fusion_state.invalidate_all();
    tracing::info!("purge_orphaned_images removed {} orphaned rows", deleted);
    Ok(deleted)
}
