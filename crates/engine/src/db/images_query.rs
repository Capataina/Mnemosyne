//! Image-grid SELECTs + path/root lookups.
//!
//! The four "fetch a grid of images" queries (`get_images`,
//! `get_images_with_thumbnails`, `get_images_without_embeddings`,
//! `get_images_without_thumbnails`) all share the same
//! "images LEFT JOIN images_tags LEFT JOIN tags" row shape. The
//! `aggregate_image_rows` helper at the top of the file performs the
//! HashMap-keyed-by-image-id roll-up so each caller stays focused on
//! its WHERE clause.

use std::collections::HashMap;

use rusqlite::params_from_iter;
use serde::Serialize;

use super::{ID, ImageDatabase};
use crate::{image_struct::ImageData, tag_struct::Tag};

/// Minimal per-image metadata the similarity/semantic commands need to
/// assemble an `ImageSearchResult`, batch-hydrated by
/// `get_images_metadata_for_ids` (T3-2/#6). Deliberately NOT `ImageData`
/// — result assembly needs only these five fields, not the tags array
/// or manual-layout columns, so the batch query skips the tags JOIN
/// entirely.
#[derive(Debug, Clone)]
pub struct ImageResultMeta {
    pub id: ID,
    pub path: String,
    pub thumbnail_path: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Pipeline progress snapshot — counts of images at each stage.
///
/// Returned by `get_pipeline_stats` and exposed to the frontend via
/// the `get_pipeline_stats` Tauri command. Lets the user see at a
/// glance how much work the indexing pipeline has done so far per
/// encoder.
///
/// All counts come from a small number of SELECTs — one for the
/// total/thumbnail/orphaned base, one per encoder for embedding
/// counts. Acceptable cost given the typical ~3 encoder configurations.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct PipelineStats {
    /// Every row in the `images` table (including orphaned).
    pub total_images: i64,
    /// Rows with a non-empty `thumbnail_path`.
    pub with_thumbnail: i64,
    /// Per-encoder counts of (encoder_id, count). Includes the
    /// legacy CLIP from images.embedding (so users on an
    /// already-encoded library see CLIP at full count even before
    /// they re-index under the new per-encoder schema).
    pub with_embedding_per_encoder: Vec<EncoderEmbeddingCount>,
    /// Rows where the file was found missing on disk during the last
    /// orphan-detection pass.
    pub orphaned: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct EncoderEmbeddingCount {
    pub encoder_id: String,
    pub count: i64,
}

/// Aggregate the standard "images LEFT JOIN images_tags LEFT JOIN tags"
/// row shape into a Vec of `(id, path, tags, thumbnail_path, width, height)`.
///
/// Audit finding: this aggregation pattern (HashMap-keyed-by-image-id,
/// each entry collecting Tags as the LEFT JOIN unrolls) was duplicated
/// across `get_images`, `get_images_without_embeddings`,
/// `get_images_without_thumbnails`, and `get_images_with_thumbnails`.
/// Four near-identical 25-line blocks → one helper. The next change to
/// tag-aggregation logic happens in one place; ditto the thumbnail-
/// column shape.
///
/// Expected column names (the SELECT must alias accordingly):
///   img_id, img_path,
///   thumbnail_path, width, height — nullable, OK to be absent in the
///     SELECT (treated as NULL in that case via the COALESCE pattern
///     each caller uses),
///   tag_id, tag_name, tag_color — nullable LEFT JOIN columns.
///
/// Callers that don't need the thumbnail columns simply discard them
/// from the returned tuples; callers that don't include the columns in
/// their SELECT must alias `NULL AS thumbnail_path`, etc., so the
/// helper's `row.get("thumbnail_path")` resolves to `None`.
/// 6b — clippy::type_complexity. Aggregate row tuple shape is shared
/// across the four LEFT-JOIN-aggregate callers. A type alias makes the
/// shape grep-able and clippy-clean without forcing a struct (which
/// would require updating every destructure site).
type AggregatedRow = (
    ID,
    String,
    Vec<Tag>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
);
type AggregatedValue = (
    String,
    Vec<Tag>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
);

/// Source row for on-demand thumbnail resolution: `(path, root_id,
/// original width)`. A named alias keeps `get_image_source_for_thumbnail`
/// clippy-clean (clippy::type_complexity) — same reasoning as the
/// `AggregatedRow` aliases above.
type ThumbnailSource = (String, Option<ID>, Option<u32>);

fn aggregate_image_rows(
    rows: &mut rusqlite::Rows<'_>,
) -> rusqlite::Result<Vec<AggregatedRow>> {
    let mut map: HashMap<ID, AggregatedValue> = HashMap::new();
    while let Some(row) = rows.next()? {
        let img_id: ID = row.get("img_id")?;
        let img_path: String = row.get("img_path")?;
        let thumbnail_path: Option<String> = row.get("thumbnail_path")?;
        let width: Option<i64> = row.get("width")?;
        let height: Option<i64> = row.get("height")?;
        let manual_order: Option<i64> = row.get("manual_order")?;
        let manual_col_span: Option<i64> = row.get("manual_col_span")?;
        let tag_id_opt: Option<ID> = row.get("tag_id")?;

        let entry = map.entry(img_id).or_insert((
            img_path,
            Vec::new(),
            thumbnail_path,
            width,
            height,
            manual_order,
            manual_col_span,
        ));
        if let Some(tag_id) = tag_id_opt {
            entry.1.push(Tag {
                id: tag_id,
                name: row.get("tag_name")?,
                color: row.get("tag_color")?,
            });
        }
    }
    Ok(map
        .into_iter()
        .map(|(id, (path, tags, tp, w, h, mo, mcs))| (id, path, tags, tp, w, h, mo, mcs))
        .collect())
}

impl ImageDatabase {
    pub fn get_images(
        &self,
        filter_tag_ids: Vec<ID>,
        _filter_string: String,
    ) -> rusqlite::Result<Vec<ImageData>> {
        // R2 — foreground SELECT, route through the reader.
        let conn = self.read_lock();

        // Always SELECT the thumbnail columns as NULL aliases so the
        // shared `aggregate_image_rows` helper can read by name. This
        // function discards them — the legacy "no thumbnail data"
        // shape — but the helper's contract is uniform across all
        // four callers.
        let sql = if !filter_tag_ids.is_empty() {
            let placeholders = vec!["?"; filter_tag_ids.len()].join(", ");
            format!(
                "SELECT images.id AS img_id, images.path AS img_path,
                NULL AS thumbnail_path, NULL AS width, NULL AS height,
                NULL AS manual_order, NULL AS manual_col_span,
                tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
                FROM images
                LEFT JOIN images_tags ON images.id = images_tags.image_id
                LEFT JOIN tags ON tags.id = images_tags.tag_id
                WHERE EXISTS (
                    SELECT 1
                    FROM images_tags it2
                    WHERE it2.image_id = images.id
                    AND it2.tag_id IN ({})
                );",
                placeholders
            )
        } else {
            "SELECT images.id AS img_id, images.path AS img_path,
            NULL AS thumbnail_path, NULL AS width, NULL AS height,
            NULL AS manual_order, NULL AS manual_col_span,
            tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
            FROM images
            LEFT JOIN images_tags ON images.id = images_tags.image_id
            LEFT JOIN tags ON tags.id = images_tags.tag_id;"
                .to_string()
        };
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(params_from_iter(filter_tag_ids))?;
        let aggregated = aggregate_image_rows(&mut rows)?;

        let mut images: Vec<ImageData> = aggregated
            .into_iter()
            .map(|(id, path, tags, _tp, _w, _h, _mo, _mcs)| {
                ImageData::new(id, std::path::Path::new(&path), tags)
            })
            .collect();
        images.sort_by_key(|img| img.id);

        Ok(images)
    }

    pub fn get_all_images(&self) -> rusqlite::Result<Vec<ImageData>> {
        self.get_images(Vec::new(), "".to_string())
    }

    // Get images that don't have embeddings yet
    pub fn get_images_without_embeddings(&self) -> rusqlite::Result<Vec<ImageData>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT images.id AS img_id, images.path AS img_path,
            NULL AS thumbnail_path, NULL AS width, NULL AS height,
            NULL AS manual_order, NULL AS manual_col_span,
            tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
            FROM images
            LEFT JOIN images_tags ON images.id = images_tags.image_id
            LEFT JOIN tags ON tags.id = images_tags.tag_id
            WHERE images.embedding IS NULL;",
        )?;
        let mut rows = stmt.query([])?;
        let aggregated = aggregate_image_rows(&mut rows)?;

        let mut images: Vec<ImageData> = aggregated
            .into_iter()
            .map(|(id, path, tags, _tp, _w, _h, _mo, _mcs)| {
                ImageData::new(id, std::path::Path::new(&path), tags)
            })
            .collect();
        images.sort_by_key(|img| img.id);

        Ok(images)
    }

    /// Get images that don't have thumbnails yet
    pub fn get_images_without_thumbnails(&self) -> rusqlite::Result<Vec<ImageData>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT images.id AS img_id, images.path AS img_path,
            images.thumbnail_path, images.width, images.height,
            NULL AS manual_order, NULL AS manual_col_span,
            tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
            FROM images
            LEFT JOIN images_tags ON images.id = images_tags.image_id
            LEFT JOIN tags ON tags.id = images_tags.tag_id
            WHERE images.thumbnail_path IS NULL OR images.thumbnail_path = '';",
        )?;
        let mut rows = stmt.query([])?;
        let aggregated = aggregate_image_rows(&mut rows)?;

        // This function returns images that need thumbnails — by
        // definition the thumbnail columns are NULL/empty, so we
        // discard them when materialising into ImageData. The helper
        // returns them anyway because its contract is uniform.
        let mut images: Vec<ImageData> = aggregated
            .into_iter()
            .map(|(id, path, tags, _tp, _w, _h, _mo, _mcs)| {
                ImageData::new(id, std::path::Path::new(&path), tags)
            })
            .collect();
        images.sort_by_key(|img| img.id);

        Ok(images)
    }

    /// Get images with their thumbnail info included.
    ///
    /// Filters out:
    /// - rows whose root is disabled (multi-folder, Phase 6)
    /// - rows marked orphaned (file removed from disk, Phase 7)
    ///
    /// Rows with NULL root_id are kept — those are legacy un-migrated
    /// rows from before multi-folder support and should still display.
    ///
    /// `match_all_tags` controls multi-tag semantics for the INCLUDE set:
    /// false (default) matches images with ANY of the selected tags (OR),
    /// true requires ALL of them (AND). Threaded through from the user's
    /// tagFilterMode preference via the get_images Tauri command.
    ///
    /// `exclude_tag_ids` is the library drawer's exclude filter: an image
    /// survives only if it carries NONE of these tags (a `NOT EXISTS`
    /// clause), applied on top of the include filter and the visibility
    /// predicate. An empty `exclude_tag_ids` adds no clause, so it is
    /// exactly the pre-exclude behaviour — existing callers pass `vec![]`.
    pub fn get_images_with_thumbnails(
        &self,
        filter_tag_ids: Vec<ID>,
        _filter_string: String,
        match_all_tags: bool,
        exclude_tag_ids: Vec<ID>,
    ) -> rusqlite::Result<Vec<ImageData>> {
        // Sub-span instrumentation for the `get_images` IPC path.
        //
        // Context: `context/plans/performance-analysis.md` shows
        // `ipc.get_images` is normally 70-125ms but produced two
        // ~22-second outliers during heavy SigLIP-2 phases. The raw
        // SQL runs in ~58ms on a quiet system, so the 22s is
        // contention rather than query plan. To attribute correctly
        // we split the handler into named sub-spans that surface in
        // the on-exit perf report under their own row:
        //
        //   get_images.lock_wait    — time blocked on the DB Mutex.
        //                             If this dominates, the fix is
        //                             connection-pool / write-batching.
        //   get_images.sql_prepare  — time in `conn.prepare(...)`.
        //   get_images.row_iter     — time walking `query` rows
        //                             (covers the SQLite execute and
        //                             the per-row cursor work).
        //   get_images.aggregate    — time in `aggregate_image_rows`,
        //                             i.e. HashMap roll-up of the
        //                             LEFT JOIN unrolls.
        //   get_images.materialise  — time mapping the aggregated
        //                             tuples into ImageData + sort.
        //
        // Each subspan is opened with `info_span!(...).entered()` to
        // match the existing pattern in indexing.rs / watcher.rs.
        // R2 — route the foreground IPC SELECT through the read-only
        // secondary connection. The encoder pipeline holds the writer
        // mutex for the duration of each batch transaction; without
        // this routing the foreground get_images would queue behind
        // every batch commit. With the read-only connection, the SELECT
        // contends only with itself.
        let conn = {
            let _lock_span =
                tracing::info_span!("get_images.lock_wait").entered();
            self.read_lock()
        };

        // Common WHERE for root-and-orphan filtering. Used both with
        // and without tag-filter SQL.
        let root_filter = "(
            images.orphaned = 0
            AND (
                images.root_id IS NULL
                OR images.root_id IN (SELECT id FROM roots WHERE enabled = 1)
            )
        )";

        // Exclude filter (library drawer). Empty when no exclude tags are
        // given, so the appended-into-every-branch SQL is a no-op and the
        // behaviour matches the pre-exclude query exactly. The `?`
        // placeholders here bind AFTER the include placeholders, so the
        // param iterator below is `filter_tag_ids` then `exclude_tag_ids`.
        let exclude_clause = if exclude_tag_ids.is_empty() {
            String::new()
        } else {
            let ex_placeholders = vec!["?"; exclude_tag_ids.len()].join(", ");
            format!(
                "AND NOT EXISTS (
                    SELECT 1 FROM images_tags ex
                    WHERE ex.image_id = images.id
                    AND ex.tag_id IN ({ex_placeholders})
                )"
            )
        };

        let sql = if !filter_tag_ids.is_empty() {
            let placeholders = vec!["?"; filter_tag_ids.len()].join(", ");
            if match_all_tags {
                // AND semantic: image must have EVERY selected tag.
                // GROUP BY image_id with HAVING COUNT = number of distinct
                // selected tags. Note we COUNT(DISTINCT tag_id) so a tag
                // appearing twice for the same image (impossible given
                // the PK but defensive) doesn't satisfy the constraint
                // for two different selected tags.
                let n = filter_tag_ids.len();
                format!(
                    "SELECT images.id AS img_id, images.path AS img_path,
                    images.thumbnail_path, images.width, images.height,
                    images.manual_order, images.manual_col_span,
                    tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
                    FROM images
                    LEFT JOIN images_tags ON images.id = images_tags.image_id
                    LEFT JOIN tags ON tags.id = images_tags.tag_id
                    WHERE {root_filter}
                    AND images.id IN (
                        SELECT it2.image_id
                        FROM images_tags it2
                        WHERE it2.tag_id IN ({placeholders})
                        GROUP BY it2.image_id
                        HAVING COUNT(DISTINCT it2.tag_id) = {n}
                    )
                    {exclude_clause};"
                )
            } else {
                // OR semantic: image must have ANY selected tag.
                format!(
                    "SELECT images.id AS img_id, images.path AS img_path,
                    images.thumbnail_path, images.width, images.height,
                    images.manual_order, images.manual_col_span,
                    tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
                    FROM images
                    LEFT JOIN images_tags ON images.id = images_tags.image_id
                    LEFT JOIN tags ON tags.id = images_tags.tag_id
                    WHERE {root_filter}
                    AND EXISTS (
                        SELECT 1
                        FROM images_tags it2
                        WHERE it2.image_id = images.id
                        AND it2.tag_id IN ({placeholders})
                    )
                    {exclude_clause};"
                )
            }
        } else {
            format!(
                "SELECT images.id AS img_id, images.path AS img_path,
                images.thumbnail_path, images.width, images.height,
                images.manual_order, images.manual_col_span,
                tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
                FROM images
                LEFT JOIN images_tags ON images.id = images_tags.image_id
                LEFT JOIN tags ON tags.id = images_tags.tag_id
                WHERE {root_filter}
                {exclude_clause};"
            )
        };
        let mut stmt = {
            let _prepare_span =
                tracing::info_span!("get_images.sql_prepare").entered();
            conn.prepare(&sql)?
        };

        // `row_iter` and `aggregate` are interleaved in practice:
        // `aggregate_image_rows` pulls the next row, builds the
        // HashMap entry, repeats. We split them into two spans by
        // doing the SQLite execute under one and the HashMap roll-up
        // under the next, accepting that row-pull cost shows up on
        // the aggregate span (it's the cost of consuming the cursor).
        // The split still tells us whether the dominant cost is in
        // SQLite kernel work (prepare + execute) or in our roll-up.
        // Params bind in placeholder order: the include set first (the
        // tag-filter subqueries above), then the exclude set (the NOT
        // EXISTS clause). Either may be empty.
        let mut bind_params: Vec<ID> = filter_tag_ids;
        bind_params.extend(exclude_tag_ids);
        let mut rows = {
            let _row_iter_span =
                tracing::info_span!("get_images.row_iter").entered();
            stmt.query(params_from_iter(bind_params))?
        };
        let aggregated = {
            let _aggregate_span =
                tracing::info_span!("get_images.aggregate").entered();
            aggregate_image_rows(&mut rows)?
        };

        // This function is the only one that USES the thumbnail
        // columns — the helper provides them uniformly; we read them
        // here when materialising into ImageData.
        let images = {
            let _materialise_span =
                tracing::info_span!("get_images.materialise").entered();
            let mut images: Vec<ImageData> = aggregated
                .into_iter()
                .map(|(id, path, tags, thumbnail_path, width, height, manual_order, manual_col_span)| {
                    let mut img = ImageData::new(id, std::path::Path::new(&path), tags);
                    img.thumbnail_path = thumbnail_path;
                    img.width = width.map(|w| w as u32);
                    img.height = height.map(|h| h as u32);
                    img.manual_order = manual_order;
                    img.manual_col_span = manual_col_span;
                    img
                })
                .collect();

            // Stable order by id (oldest first). The previous "shuffle on
            // every read" caused the visible "entire app refreshes"
            // behaviour during indexing — every refetch (every ~2s while
            // thumbnails were generating) reordered the grid, making
            // tiles jump around. Sort modes are now controlled via the
            // user's `sortMode` preference and applied frontend-side
            // when needed (the frontend can apply a deterministic
            // shuffle with a session seed if the user picks "shuffle").
            images.sort_by_key(|i| i.id);
            images
        };

        Ok(images)
    }

    /// Return a map from every image's path to its root_id (or None
    /// for legacy un-migrated rows) in a single SELECT.
    ///
    /// Replaces the indexing pipeline's previous N+1 pattern (one
    /// `get_root_id_by_path` per image-needing-thumbnail, holding the
    /// DB Mutex 1500 times in rapid succession on a typical first
    /// run). Aligned with the existing `get_all_embeddings` shape —
    /// "fetch the whole table in one SELECT, the caller filters in
    /// memory" is the established pattern in this module.
    ///
    /// Used by `indexing::run_pipeline_inner` to route each generated
    /// thumbnail into its per-root subfolder.
    pub fn get_paths_to_root_ids(&self) -> rusqlite::Result<HashMap<String, Option<ID>>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare("SELECT path, root_id FROM images")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<ID>>(1)?))
        })?;
        rows.collect()
    }

    pub fn get_image_id_by_path(&self, path: &str) -> rusqlite::Result<ID> {
        // R2 — foreground lookup, no need to contend with the writer.
        let conn = self.read_lock();
        let mut stmt = conn.prepare("SELECT id FROM images WHERE path = ?1 LIMIT 1")?;
        let mut rows = stmt.query([path])?;
        if let Some(row) = rows.next()? {
            Ok(row.get("id")?)
        } else {
            Err(rusqlite::Error::QueryReturnedNoRows)
        }
    }

    /// Batch-hydrate result metadata for a set of image ids in ONE
    /// query (T3-2/#6). The similarity/semantic commands used to run
    /// `get_all_images()` (the whole-library LEFT JOIN) plus a
    /// per-result `get_image_thumbnail_info` + path→id resolution — an
    /// N+1 fired 20–30× per settled viewport by the prefetch burst.
    /// Now the cosine index returns ids directly, so one
    /// `WHERE id IN (...)` fetch replaces the join and the N+1.
    ///
    /// Returns exactly what `ImageSearchResult` assembly needs. The
    /// thumbnail triple is all-or-nothing, matching the old
    /// `get_image_thumbnail_info` bundle semantics: a row missing its
    /// thumbnail path or dimensions hydrates to `(None, None, None)`
    /// rather than a partial. Ids with no matching row are silently
    /// dropped (same as an old resolution miss); the caller re-orders
    /// by the ranked-result order, so the SQL row order is irrelevant.
    pub fn get_images_metadata_for_ids(
        &self,
        ids: &[ID],
    ) -> rusqlite::Result<Vec<ImageResultMeta>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        // R2 — foreground IPC read, route through the reader connection.
        let conn = self.read_lock();
        // ids are our own i64 primary keys — safe to interpolate as
        // placeholders and bind via params_from_iter (no injection
        // surface, and it keeps SQLite's parameter cache effective).
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!(
            "SELECT id, path, thumbnail_path, width, height \
             FROM images WHERE id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
            let id: ID = row.get(0)?;
            let path: String = row.get(1)?;
            let thumbnail_path: Option<String> = row.get(2)?;
            let width: Option<i64> = row.get(3)?;
            let height: Option<i64> = row.get(4)?;
            // All-or-nothing bundle: identical to get_image_thumbnail_info
            // + the command's `.unwrap_or((None, None, None))`.
            let (thumbnail_path, width, height) = match (
                thumbnail_path.filter(|p| !p.is_empty()),
                width,
                height,
            ) {
                (Some(tp), Some(w), Some(h)) => {
                    (Some(tp), Some(w as u32), Some(h as u32))
                }
                _ => (None, None, None),
            };
            Ok(ImageResultMeta {
                id,
                path,
                thumbnail_path,
                width,
                height,
            })
        })?;
        rows.collect()
    }

    /// Generation token for one encoder's flat embedding store (T3-2/#8).
    ///
    /// Derived from the EXACT filtered population the store holds — the
    /// same `enabled/orphaned` JOIN as `get_all_embeddings_for` — so the
    /// token moves whenever that population changes, which is strictly
    /// more than "the embeddings table changed": a root enable/disable
    /// toggle changes which rows pass the filter without touching the
    /// embeddings rows at all. `(count, sum(rowid), max(rowid))` folded
    /// to a u64 catches insertions (max/sum/count↑), deletions
    /// (sum/count↓), and rows entering/leaving the enabled/orphaned set.
    /// This is the replacement for `cache.rs`'s bare-mtime freshness
    /// check, which cannot survive at 100k scale.
    pub fn embedding_generation_token(
        &self,
        encoder_id: &str,
    ) -> rusqlite::Result<u64> {
        let conn = self.read_lock();
        let mut stmt = conn.prepare(
            "SELECT COUNT(*), COALESCE(SUM(e.rowid), 0), COALESCE(MAX(e.rowid), 0)
             FROM embeddings e
             JOIN images i ON i.id = e.image_id
             WHERE e.encoder_id = ?1
               AND i.orphaned = 0
               AND (
                   i.root_id IS NULL
                   OR i.root_id IN (SELECT id FROM roots WHERE enabled = 1)
               )",
        )?;
        let (count, sum, max): (i64, i64, i64) =
            stmt.query_row([encoder_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?;
        // FNV-1a over the three little-endian i64s. Collisions on a
        // monotonic-rowid table are astronomically unlikely for this use.
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for field in [count, sum, max] {
            for byte in field.to_le_bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        Ok(hash)
    }

    /// Everything the `get_thumbnail` command needs to resolve (and, if
    /// necessary, generate) a thumbnail for an image id in one read:
    /// its original file `path`, its `root_id` (which per-root folder the
    /// thumbnail lives in, `None` for legacy un-rooted rows), and the
    /// original image `width` recorded during base-thumbnail generation.
    ///
    /// `width` is `None` when the row hasn't been through the thumbnail
    /// phase yet; the command treats an unknown width as "can't take the
    /// no-upscale shortcut" and generates the bucket instead (the resize
    /// caps at the source width regardless, so this is safe — just not
    /// free).
    ///
    /// Returns `Ok(None)` when no row has that id, so the command can map
    /// it to a typed `NotFound` rather than a panic.
    pub fn get_image_source_for_thumbnail(
        &self,
        id: ID,
    ) -> rusqlite::Result<Option<ThumbnailSource>> {
        // R2 — foreground IPC read, route through the reader connection.
        let conn = self.read_lock();
        let mut stmt =
            conn.prepare("SELECT path, root_id, width FROM images WHERE id = ?1 LIMIT 1")?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            let path: String = row.get(0)?;
            let root_id: Option<ID> = row.get(1)?;
            let width: Option<i64> = row.get(2)?;
            Ok(Some((path, root_id, width.map(|w| w as u32))))
        } else {
            Ok(None)
        }
    }

    /// Snapshot of the pipeline's progress — base counts plus
    /// per-encoder embedding counts.
    ///
    /// Base counts come from one SELECT over `images` (total /
    /// with_thumbnail / with_legacy_clip_embedding / orphaned). Then
    /// one COUNT per encoder over the `embeddings` table for the
    /// per-encoder breakdown the Settings UI shows.
    ///
    /// The per-encoder list always includes `clip_vit_b_32` (sourced
    /// from the legacy `images.embedding` column for users who
    /// haven't re-indexed under the new schema yet — `OR` the
    /// embeddings table if they have), `siglip2_base`, and
    /// `dinov2_base`. Adding new encoders means appending to this list.
    pub fn get_pipeline_stats(&self) -> rusqlite::Result<PipelineStats> {
        // R2 — read-only secondary connection. get_pipeline_stats is
        // polled at 1Hz by the frontend during indexing, so it's
        // exactly the kind of foreground SELECT that must not queue
        // behind encoder write batches.
        let conn = self.read_lock();

        // Base counts: total + thumbnail + legacy-CLIP + orphaned.
        let mut stmt = conn.prepare(
            "SELECT
                COUNT(*) AS total,
                SUM(CASE
                    WHEN thumbnail_path IS NOT NULL AND thumbnail_path != ''
                    THEN 1 ELSE 0
                END) AS with_thumbnail,
                SUM(CASE
                    WHEN embedding IS NOT NULL AND length(embedding) > 0
                    THEN 1 ELSE 0
                END) AS with_legacy_clip,
                SUM(CASE WHEN orphaned = 1 THEN 1 ELSE 0 END) AS orphaned
            FROM images",
        )?;
        let (total, thumb, legacy_clip, orphaned) = stmt.query_row([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            ))
        })?;
        drop(stmt);

        // Per-encoder counts from the new embeddings table. The legacy
        // `dinov2_small` ID is intentionally NOT in this list — the
        // pipeline-version 2 migration deletes any rows under that ID
        // on first launch, so listing it here just produced a permanent
        // "DINOv2 0/N" duplicate row in the Settings drawer.
        let known_encoders = ["clip_vit_b_32", "siglip2_base", "dinov2_base"];
        let mut counts: Vec<EncoderEmbeddingCount> = Vec::with_capacity(known_encoders.len());
        for encoder_id in known_encoders {
            let mut stmt = conn.prepare(
                "SELECT COUNT(*) FROM embeddings WHERE encoder_id = ?1",
            )?;
            let new_count: i64 =
                stmt.query_row(rusqlite::params![encoder_id], |row| row.get(0))?;
            // For the CLIP entry, prefer the larger of (legacy column,
            // new table). Users who haven't re-indexed under the new
            // schema have non-zero legacy_clip and 0 new_count; users
            // who have re-indexed have both columns populated.
            let count = if encoder_id == "clip_vit_b_32" {
                new_count.max(legacy_clip)
            } else {
                new_count
            };
            counts.push(EncoderEmbeddingCount {
                encoder_id: encoder_id.to_string(),
                count,
            });
        }

        Ok(PipelineStats {
            total_images: total,
            with_thumbnail: thumb,
            with_embedding_per_encoder: counts,
            orphaned,
        })
    }
}

/// One compact row of the feed's layout manifest (T3-1).
///
/// Everything the masonry grid needs to shuffle, pack, and render a
/// tile — and nothing more: no tags array (the LEFT JOIN unroll was the
/// dominant cost of `get_images_with_thumbnails` at scale), no notes,
/// and no original path (the thumbnail path is the only path a feed
/// tile genuinely renders; the full-resolution original is hydrated per
/// id via `get_image_details_by_ids` when an image is selected).
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct FeedManifestRow {
    pub id: ID,
    /// File basename, derived Rust-side so the full path never travels.
    pub name: String,
    /// Original dimensions; `None` until the thumbnail phase records them.
    pub width: Option<i64>,
    pub height: Option<i64>,
    /// `None`/empty until a thumbnail exists — the frontend derives its
    /// `hasThumbnail` pop-in gate from this.
    pub thumbnail_path: Option<String>,
    /// Persisted drag-resize span; `None` = default single column.
    pub manual_col_span: Option<i64>,
}

/// Derive the display name (file basename) from a stored image path,
/// matching `ImageData::new`'s behaviour ("unknown" when the path has
/// no extractable file name) so manifest rows and hydrated detail rows
/// agree on the same name for the same image.
fn basename_of(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// T3-1 additions: the compact feed manifest + id-batch detail hydration.
///
/// Kept in a separate `impl` block (rather than extending the block
/// above) so this change stays purely additive next to the parallel
/// search-layer rework that also lands additive queries in this file.
impl ImageDatabase {
    /// Compact layout manifest for the feed — one row per visible image,
    /// no tags join, id-ascending.
    ///
    /// The WHERE surface is a faithful copy of
    /// `get_images_with_thumbnails`' predicate — same root/orphan
    /// visibility, same include OR/AND semantics, same exclude
    /// NOT EXISTS — so the manifest's membership is byte-identical to
    /// the legacy catalogue's for every filter combination (test-locked
    /// below in `manifest_membership_matches_legacy_query`). What
    /// changed is the SELECT list and the missing LEFT JOINs: at 100k
    /// images the legacy query unrolls to 200–300k joined rows that get
    /// HashMap-aggregated; this one reads exactly N rows straight into
    /// the result Vec.
    pub fn get_feed_manifest(
        &self,
        filter_tag_ids: Vec<ID>,
        match_all_tags: bool,
        exclude_tag_ids: Vec<ID>,
    ) -> rusqlite::Result<Vec<FeedManifestRow>> {
        // Foreground SELECT — same reader-connection routing as the
        // legacy grid query (R2).
        let conn = self.read_lock();

        let root_filter = "(
            images.orphaned = 0
            AND (
                images.root_id IS NULL
                OR images.root_id IN (SELECT id FROM roots WHERE enabled = 1)
            )
        )";

        let include_clause = if filter_tag_ids.is_empty() {
            String::new()
        } else {
            let placeholders = vec!["?"; filter_tag_ids.len()].join(", ");
            if match_all_tags {
                let n = filter_tag_ids.len();
                format!(
                    "AND images.id IN (
                        SELECT it2.image_id
                        FROM images_tags it2
                        WHERE it2.tag_id IN ({placeholders})
                        GROUP BY it2.image_id
                        HAVING COUNT(DISTINCT it2.tag_id) = {n}
                    )"
                )
            } else {
                format!(
                    "AND EXISTS (
                        SELECT 1
                        FROM images_tags it2
                        WHERE it2.image_id = images.id
                        AND it2.tag_id IN ({placeholders})
                    )"
                )
            }
        };

        let exclude_clause = if exclude_tag_ids.is_empty() {
            String::new()
        } else {
            let ex_placeholders = vec!["?"; exclude_tag_ids.len()].join(", ");
            format!(
                "AND NOT EXISTS (
                    SELECT 1 FROM images_tags ex
                    WHERE ex.image_id = images.id
                    AND ex.tag_id IN ({ex_placeholders})
                )"
            )
        };

        let sql = format!(
            "SELECT images.id, images.path, images.thumbnail_path,
                    images.width, images.height, images.manual_col_span
             FROM images
             WHERE {root_filter}
             {include_clause}
             {exclude_clause}
             ORDER BY images.id;"
        );

        let mut stmt = conn.prepare(&sql)?;
        // Placeholder order matches clause order: include set, then exclude.
        let mut bind_params: Vec<ID> = filter_tag_ids;
        bind_params.extend(exclude_tag_ids);
        let rows = stmt.query_map(params_from_iter(bind_params), |row| {
            let path: String = row.get(1)?;
            Ok(FeedManifestRow {
                id: row.get(0)?,
                name: basename_of(&path),
                thumbnail_path: row.get(2)?,
                width: row.get(3)?,
                height: row.get(4)?,
                manual_col_span: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    /// Full detail records (tags aggregated, all columns) for an explicit
    /// id batch — the hydration half of the manifest/detail split. Used
    /// by the `get_image_details` command for the selected image and its
    /// arrow-nav neighbours.
    ///
    /// Applies the same visibility predicate as the grid/manifest, so an
    /// orphaned or disabled-root id hydrates to nothing (the frontend
    /// falls back to the active result list, exactly as the old
    /// catalogue `find` used to miss). Unknown ids are silently skipped.
    /// Chunked at 500 ids to stay clear of SQLite's bind-variable limit;
    /// results are id-sorted across chunks.
    pub fn get_image_details_by_ids(&self, ids: &[ID]) -> rusqlite::Result<Vec<ImageData>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.read_lock();

        let root_filter = "(
            images.orphaned = 0
            AND (
                images.root_id IS NULL
                OR images.root_id IN (SELECT id FROM roots WHERE enabled = 1)
            )
        )";

        let mut images: Vec<ImageData> = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(500) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT images.id AS img_id, images.path AS img_path,
                images.thumbnail_path, images.width, images.height,
                images.manual_order, images.manual_col_span,
                tags.id AS tag_id, tags.name AS tag_name, tags.color AS tag_color
                FROM images
                LEFT JOIN images_tags ON images.id = images_tags.image_id
                LEFT JOIN tags ON tags.id = images_tags.tag_id
                WHERE {root_filter}
                AND images.id IN ({placeholders});"
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut rows = stmt.query(params_from_iter(chunk.iter().copied()))?;
            let aggregated = aggregate_image_rows(&mut rows)?;
            images.extend(aggregated.into_iter().map(
                |(id, path, tags, thumbnail_path, width, height, manual_order, manual_col_span)| {
                    let mut img = ImageData::new(id, std::path::Path::new(&path), tags);
                    img.thumbnail_path = thumbnail_path;
                    img.width = width.map(|w| w as u32);
                    img.height = height.map(|h| h as u32);
                    img.manual_order = manual_order;
                    img.manual_col_span = manual_col_span;
                    img
                },
            ));
        }
        images.sort_by_key(|img| img.id);
        Ok(images)
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::fresh_db;
    use super::*;

    #[test]
    fn metadata_for_ids_hydrates_and_bundles_thumbnail() {
        // T3-2/#6 batch hydration: one WHERE id IN (...) returns exactly
        // the five fields result assembly needs, with the thumbnail
        // triple all-or-nothing.
        let db = fresh_db();
        db.add_image("/a.jpg".into(), None).unwrap();
        db.add_image("/b.jpg".into(), None).unwrap();
        let id_a = db.get_image_id_by_path("/a.jpg").unwrap();
        let id_b = db.get_image_id_by_path("/b.jpg").unwrap();
        // Only /a.jpg gets a thumbnail; /b.jpg stays bundle-less.
        db.update_image_thumbnail(id_a, std::path::Path::new("/t_a.jpg"), 640, 480)
            .unwrap();

        let metas = db.get_images_metadata_for_ids(&[id_a, id_b]).unwrap();
        let by_id: std::collections::HashMap<ID, ImageResultMeta> =
            metas.into_iter().map(|m| (m.id, m)).collect();

        let a = &by_id[&id_a];
        assert_eq!(a.path, "/a.jpg");
        assert_eq!(a.thumbnail_path.as_deref(), Some("/t_a.jpg"));
        assert_eq!(a.width, Some(640));
        assert_eq!(a.height, Some(480));

        let b = &by_id[&id_b];
        assert_eq!(b.path, "/b.jpg");
        // No thumbnail row → the whole bundle is None, never a partial.
        assert_eq!(b.thumbnail_path, None);
        assert_eq!(b.width, None);
        assert_eq!(b.height, None);
    }

    #[test]
    fn metadata_for_ids_empty_and_missing() {
        let db = fresh_db();
        db.add_image("/a.jpg".into(), None).unwrap();
        let id_a = db.get_image_id_by_path("/a.jpg").unwrap();

        // Empty request short-circuits to an empty vec (no malformed SQL).
        assert!(db.get_images_metadata_for_ids(&[]).unwrap().is_empty());

        // A non-existent id is silently dropped (an old "resolution miss");
        // present ids still hydrate.
        let metas = db
            .get_images_metadata_for_ids(&[id_a, 999_999])
            .unwrap();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].id, id_a);
    }

    #[test]
    fn generation_token_moves_on_population_change() {
        // The token must change whenever the store's filtered population
        // changes — including a root toggle that touches no embedding row.
        let db = fresh_db();
        let root = db.add_root("/r".into(), None).unwrap();
        db.add_image("/r/a.jpg".into(), Some(root.id)).unwrap();
        db.add_image("/r/b.jpg".into(), Some(root.id)).unwrap();
        let id_a = db.get_image_id_by_path("/r/a.jpg").unwrap();
        let id_b = db.get_image_id_by_path("/r/b.jpg").unwrap();

        let enc = "clip_vit_b_32";
        let empty = db.embedding_generation_token(enc).unwrap();

        db.upsert_embedding(id_a, enc, &[0.1, 0.2, 0.3]).unwrap();
        let after_a = db.embedding_generation_token(enc).unwrap();
        assert_ne!(empty, after_a, "adding an embedding must move the token");

        db.upsert_embedding(id_b, enc, &[0.4, 0.5, 0.6]).unwrap();
        let after_b = db.embedding_generation_token(enc).unwrap();
        assert_ne!(after_a, after_b, "a second embedding must move the token");

        // Disabling the root removes both rows from the filtered set
        // without deleting any embedding — the token must still move.
        db.set_root_enabled(root.id, false).unwrap();
        let disabled = db.embedding_generation_token(enc).unwrap();
        assert_ne!(after_b, disabled, "a root toggle must move the token");
        // With every row filtered out, the token returns to the empty value.
        assert_eq!(empty, disabled, "no filtered rows ⇒ empty-population token");

        // Re-enabling restores the exact prior token (deterministic).
        db.set_root_enabled(root.id, true).unwrap();
        assert_eq!(
            after_b,
            db.embedding_generation_token(enc).unwrap(),
            "re-enabling restores the identical population token"
        );
    }

    #[test]
    fn test_database_operations() {
        let db = fresh_db();

        let test_image_path = "/path/to/image.jpg";
        db.add_image(test_image_path.to_owned(), None).unwrap();

        let images = db.get_images(vec![], "".to_string()).unwrap();
        assert_eq!(images.len(), 1);
    }

    #[test]
    fn pipeline_stats_empty_db() {
        let db = fresh_db();
        let stats = db.get_pipeline_stats().unwrap();
        assert_eq!(stats.total_images, 0);
        assert_eq!(stats.with_thumbnail, 0);
        for ec in &stats.with_embedding_per_encoder {
            assert_eq!(ec.count, 0, "encoder {} should be 0", ec.encoder_id);
        }
        assert_eq!(stats.orphaned, 0);
    }

    #[test]
    fn pipeline_stats_counts_each_stage_independently() {
        let db = fresh_db();

        // 3 images total: img_a has both thumbnail + embedding,
        // img_b has only thumbnail, img_c has neither.
        db.add_image("/img_a.jpg".into(), None).unwrap();
        db.add_image("/img_b.jpg".into(), None).unwrap();
        db.add_image("/img_c.jpg".into(), None).unwrap();

        // Add a thumbnail to img_a + img_b
        let id_a = db.get_image_id_by_path("/img_a.jpg").unwrap();
        let id_b = db.get_image_id_by_path("/img_b.jpg").unwrap();
        db.update_image_thumbnail(id_a, std::path::Path::new("/thumb_a.jpg"), 100, 200)
            .unwrap();
        db.update_image_thumbnail(id_b, std::path::Path::new("/thumb_b.jpg"), 100, 200)
            .unwrap();

        // Add an embedding to img_a only
        db.update_image_embedding(id_a, vec![0.1, 0.2, 0.3])
            .unwrap();

        let stats = db.get_pipeline_stats().unwrap();
        assert_eq!(stats.total_images, 3);
        assert_eq!(stats.with_thumbnail, 2, "thumbnail count");
        // CLIP comes from the legacy column (or new table) — img_a has it
        let clip = stats
            .with_embedding_per_encoder
            .iter()
            .find(|e| e.encoder_id == "clip_vit_b_32")
            .unwrap();
        assert_eq!(clip.count, 1, "CLIP embedding count");
        assert_eq!(stats.orphaned, 0);
    }

    #[test]
    fn pipeline_stats_counts_orphaned_separately() {
        let db = fresh_db();
        let r = db.add_root("/root".into(), None).unwrap();
        db.add_image("/root/alive.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/root/dead.jpg".into(), Some(r.id)).unwrap();
        // Mark dead.jpg as orphan (not in alive set).
        db.mark_orphaned(r.id, &["/root/alive.jpg".to_string()])
            .unwrap();

        let stats = db.get_pipeline_stats().unwrap();
        assert_eq!(stats.total_images, 2);
        assert_eq!(stats.orphaned, 1);
    }

    #[test]
    fn test_prevent_duplicate_images() {
        let db = fresh_db();

        let test_image_path = "/path/to/image.jpg";
        db.add_image(test_image_path.to_owned(), None).unwrap();
        db.add_image(test_image_path.to_owned(), None).unwrap();

        let images = db.get_images(vec![], "".to_string()).unwrap();
        assert_eq!(images.len(), 1); // Should still be only one image
    }

    #[test]
    fn test_empty_database() {
        let db = fresh_db();

        let images = db.get_images(vec![], "".to_string()).unwrap();
        assert_eq!(images.len(), 0); // No images should be present
    }

    // ============================================================
    //  Phase 6: get_images_with_thumbnails — multi-folder filter
    // ============================================================

    #[test]
    fn grid_query_excludes_disabled_root_images() {
        let db = fresh_db();
        let a = db.add_root("/a".into(), None).unwrap();
        let b = db.add_root("/b".into(), None).unwrap();
        db.add_image("/a/x.jpg".into(), Some(a.id)).unwrap();
        db.add_image("/b/y.jpg".into(), Some(b.id)).unwrap();

        // Both enabled → both in the grid.
        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(imgs.len(), 2);

        // Disable root b.
        db.set_root_enabled(b.id, false).unwrap();
        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(imgs.len(), 1);
        assert_eq!(imgs[0].path, "/a/x.jpg");
    }

    #[test]
    fn grid_query_includes_null_root_id_images() {
        let db = fresh_db();
        // Legacy un-migrated rows (root_id = NULL) should still appear.
        db.add_image("/legacy.jpg".into(), None).unwrap();
        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(imgs.len(), 1);
    }

    // ============================================================
    //  Phase 6: get_images_with_thumbnails — AND vs OR tag filter
    // ============================================================

    fn setup_tagged_images(db: &ImageDatabase) -> (i64, i64, i64, i64) {
        let r = db.add_root("/r".into(), None).unwrap();
        // 3 images: A has tag-1, B has tag-2, C has both.
        db.add_image("/r/a.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/r/b.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/r/c.jpg".into(), Some(r.id)).unwrap();
        let imgs = db.get_all_images().unwrap();
        let id_a = imgs.iter().find(|i| i.path == "/r/a.jpg").unwrap().id;
        let id_b = imgs.iter().find(|i| i.path == "/r/b.jpg").unwrap().id;
        let id_c = imgs.iter().find(|i| i.path == "/r/c.jpg").unwrap().id;
        let t1 = db.create_tag("one".into(), "#fff".into()).unwrap().id;
        let t2 = db.create_tag("two".into(), "#000".into()).unwrap().id;
        db.add_tag_to_image(id_a, t1).unwrap();
        db.add_tag_to_image(id_b, t2).unwrap();
        db.add_tag_to_image(id_c, t1).unwrap();
        db.add_tag_to_image(id_c, t2).unwrap();
        (id_a, id_b, id_c, t1)
    }

    #[test]
    fn or_filter_matches_any_selected_tag() {
        let db = fresh_db();
        let (id_a, id_b, id_c, t1) = setup_tagged_images(&db);
        let _ = id_b;

        // Filter by t1 alone — should return A and C (both have t1).
        let imgs = db
            .get_images_with_thumbnails(vec![t1], "".into(), false, vec![])
            .unwrap();
        let ids: Vec<i64> = imgs.iter().map(|i| i.id).collect();
        assert!(ids.contains(&id_a));
        assert!(ids.contains(&id_c));
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn and_filter_requires_all_selected_tags() {
        let db = fresh_db();
        let (id_a, id_b, id_c, t1) = setup_tagged_images(&db);
        let _ = id_a;
        let _ = id_b;
        // Re-fetch t2 since setup returns only t1
        let tags = db.get_tags().unwrap();
        let t2 = tags.iter().find(|t| t.name == "two").unwrap().id;

        // OR semantic: t1 + t2 → A, B, C all match.
        let or_match = db
            .get_images_with_thumbnails(vec![t1, t2], "".into(), false, vec![])
            .unwrap();
        assert_eq!(or_match.len(), 3);

        // AND semantic: only C has BOTH tags.
        let and_match = db
            .get_images_with_thumbnails(vec![t1, t2], "".into(), true, vec![])
            .unwrap();
        assert_eq!(and_match.len(), 1);
        assert_eq!(and_match[0].id, id_c);
    }

    // ============================================================
    //  Library drawer: exclude-tag filter + per-tag visible counts
    // ============================================================

    #[test]
    fn exclude_tag_filter_removes_images_carrying_an_excluded_tag() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        db.add_image("/r/a.jpg".into(), Some(r.id)).unwrap(); // tag red
        db.add_image("/r/b.jpg".into(), Some(r.id)).unwrap(); // tag blue
        db.add_image("/r/c.jpg".into(), Some(r.id)).unwrap(); // no tags
        let id_a = db.get_image_id_by_path("/r/a.jpg").unwrap();
        let id_b = db.get_image_id_by_path("/r/b.jpg").unwrap();
        let red = db.create_tag("red".into(), "#f00".into()).unwrap().id;
        let blue = db.create_tag("blue".into(), "#00f".into()).unwrap().id;
        db.add_tag_to_image(id_a, red).unwrap();
        db.add_tag_to_image(id_b, blue).unwrap();

        // Empty exclude = pre-drawer behaviour: all three visible.
        let all = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(all.len(), 3, "empty exclude must be back-compatible");

        // Exclude red, no include → red image dropped, the other two kept.
        let excl = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![red])
            .unwrap();
        let paths: Vec<&str> = excl.iter().map(|i| i.path.as_str()).collect();
        assert_eq!(excl.len(), 2);
        assert!(!paths.contains(&"/r/a.jpg"), "excluded-red image must be gone");
        assert!(paths.contains(&"/r/b.jpg"));
        assert!(paths.contains(&"/r/c.jpg"));

        // Include blue AND exclude red → only the blue image.
        let both = db
            .get_images_with_thumbnails(vec![blue], "".into(), false, vec![red])
            .unwrap();
        assert_eq!(both.len(), 1);
        assert_eq!(both[0].path, "/r/b.jpg");
    }

    #[test]
    fn get_tag_counts_matches_grid_visibility_predicate() {
        let db = fresh_db();
        let r_on = db.add_root("/on".into(), None).unwrap();
        let r_off = db.add_root("/off".into(), None).unwrap();
        // Tag "t" spans three images: one plainly visible, one that will
        // be orphaned, one under a root we'll disable.
        db.add_image("/on/a.jpg".into(), Some(r_on.id)).unwrap();
        db.add_image("/on/b.jpg".into(), Some(r_on.id)).unwrap();
        db.add_image("/off/c.jpg".into(), Some(r_off.id)).unwrap();
        let id_a = db.get_image_id_by_path("/on/a.jpg").unwrap();
        let id_b = db.get_image_id_by_path("/on/b.jpg").unwrap();
        let id_c = db.get_image_id_by_path("/off/c.jpg").unwrap();
        let t = db.create_tag("t".into(), "#fff".into()).unwrap().id;
        let empty = db.create_tag("empty".into(), "#000".into()).unwrap().id;
        db.add_tag_to_image(id_a, t).unwrap();
        db.add_tag_to_image(id_b, t).unwrap();
        db.add_tag_to_image(id_c, t).unwrap();

        // Orphan b (not in the alive set) and disable r_off.
        db.mark_orphaned(r_on.id, &["/on/a.jpg".to_string()]).unwrap();
        db.set_root_enabled(r_off.id, false).unwrap();

        let counts = db.get_tag_counts().unwrap();
        let count_of = |tag_id| counts.iter().find(|c| c.tag_id == tag_id).map(|c| c.count);

        // Only /on/a.jpg is visible: b is orphaned, c is under a disabled
        // root — exactly the two the grid also drops. So the count is 1,
        // matching what opening that folder would show.
        assert_eq!(count_of(t), Some(1), "count must match the grid's visible set");
        // A tag with no images still gets a row, with count 0.
        assert_eq!(count_of(empty), Some(0), "zero-image tag returns 0, not a missing row");
        // Every tag is represented.
        assert_eq!(counts.len(), 2);
    }

    // ============================================================
    //  T3-1: compact feed manifest + id-batch detail hydration
    // ============================================================

    /// The manifest's membership must be identical to the legacy
    /// catalogue query's for every filter combination — the feed's
    /// visible set is a hard invariant of the manifest/detail split.
    #[test]
    fn manifest_membership_matches_legacy_query() {
        let db = fresh_db();
        let r_on = db.add_root("/on".into(), None).unwrap();
        let r_off = db.add_root("/off".into(), None).unwrap();
        db.add_image("/on/a.jpg".into(), Some(r_on.id)).unwrap();
        db.add_image("/on/b.jpg".into(), Some(r_on.id)).unwrap();
        db.add_image("/on/c.jpg".into(), Some(r_on.id)).unwrap();
        db.add_image("/on/dead.jpg".into(), Some(r_on.id)).unwrap();
        db.add_image("/off/hidden.jpg".into(), Some(r_off.id)).unwrap();
        db.add_image("/legacy.jpg".into(), None).unwrap();
        let id_a = db.get_image_id_by_path("/on/a.jpg").unwrap();
        let id_b = db.get_image_id_by_path("/on/b.jpg").unwrap();
        let id_c = db.get_image_id_by_path("/on/c.jpg").unwrap();
        let t1 = db.create_tag("one".into(), "#fff".into()).unwrap().id;
        let t2 = db.create_tag("two".into(), "#000".into()).unwrap().id;
        db.add_tag_to_image(id_a, t1).unwrap();
        db.add_tag_to_image(id_b, t2).unwrap();
        db.add_tag_to_image(id_c, t1).unwrap();
        db.add_tag_to_image(id_c, t2).unwrap();
        // dead.jpg orphaned; /off disabled.
        db.mark_orphaned(
            r_on.id,
            &[
                "/on/a.jpg".to_string(),
                "/on/b.jpg".to_string(),
                "/on/c.jpg".to_string(),
            ],
        )
        .unwrap();
        db.set_root_enabled(r_off.id, false).unwrap();

        // Filter combinations to cross-check: none, include-OR,
        // include-AND, exclude-only, include+exclude.
        let cases: Vec<(Vec<i64>, bool, Vec<i64>)> = vec![
            (vec![], false, vec![]),
            (vec![t1], false, vec![]),
            (vec![t1, t2], false, vec![]),
            (vec![t1, t2], true, vec![]),
            (vec![], false, vec![t1]),
            (vec![t2], false, vec![t1]),
        ];
        for (include, match_all, exclude) in cases {
            let legacy: Vec<i64> = db
                .get_images_with_thumbnails(
                    include.clone(),
                    "".into(),
                    match_all,
                    exclude.clone(),
                )
                .unwrap()
                .iter()
                .map(|i| i.id)
                .collect();
            let manifest: Vec<i64> = db
                .get_feed_manifest(include.clone(), match_all, exclude.clone())
                .unwrap()
                .iter()
                .map(|r| r.id)
                .collect();
            assert_eq!(
                manifest, legacy,
                "manifest id-set diverged from legacy for include={include:?} match_all={match_all} exclude={exclude:?}"
            );
        }
    }

    #[test]
    fn manifest_includes_unthumbnailed_rows_and_carries_thumbnail_fields() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        db.add_image("/r/raw.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/r/thumbed.png".into(), Some(r.id)).unwrap();
        let id_t = db.get_image_id_by_path("/r/thumbed.png").unwrap();
        db.update_image_thumbnail(id_t, std::path::Path::new("/thumbs/t.jpg"), 640, 480)
            .unwrap();
        db.set_manual_col_span(id_t, Some(2)).unwrap();

        let rows = db.get_feed_manifest(vec![], false, vec![]).unwrap();
        assert_eq!(
            rows.len(),
            2,
            "un-thumbnailed rows must stay in the manifest (empty-state + pop-in gating live frontend-side)"
        );
        let raw = rows.iter().find(|r| r.name == "raw.jpg").unwrap();
        assert_eq!(raw.thumbnail_path, None);
        assert_eq!(raw.width, None);
        assert_eq!(raw.height, None);
        assert_eq!(raw.manual_col_span, None);
        let thumbed = rows.iter().find(|r| r.name == "thumbed.png").unwrap();
        assert_eq!(thumbed.thumbnail_path.as_deref(), Some("/thumbs/t.jpg"));
        assert_eq!(thumbed.width, Some(640));
        assert_eq!(thumbed.height, Some(480));
        assert_eq!(thumbed.manual_col_span, Some(2));
        // id-ascending order (stable backend order the shuffle builds on).
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        assert_eq!(ids, sorted, "manifest must be id-ascending");
    }

    #[test]
    fn details_by_ids_hydrates_tags_and_respects_visibility() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        db.add_image("/r/a.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/r/b.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/r/gone.jpg".into(), Some(r.id)).unwrap();
        let id_a = db.get_image_id_by_path("/r/a.jpg").unwrap();
        let id_b = db.get_image_id_by_path("/r/b.jpg").unwrap();
        let id_gone = db.get_image_id_by_path("/r/gone.jpg").unwrap();
        let t = db.create_tag("t".into(), "#123".into()).unwrap().id;
        db.add_tag_to_image(id_a, t).unwrap();
        db.update_image_thumbnail(id_a, std::path::Path::new("/thumbs/a.jpg"), 800, 600)
            .unwrap();
        // gone.jpg is orphaned → must not hydrate.
        db.mark_orphaned(r.id, &["/r/a.jpg".to_string(), "/r/b.jpg".to_string()])
            .unwrap();

        // Empty input → empty output, no SQL fired.
        assert!(db.get_image_details_by_ids(&[]).unwrap().is_empty());

        // Unknown id (99999) silently skipped; orphaned id dropped by the
        // visibility predicate; the rest come back id-sorted with full
        // detail.
        let details = db
            .get_image_details_by_ids(&[id_b, id_gone, id_a, 99_999])
            .unwrap();
        let ids: Vec<i64> = details.iter().map(|d| d.id).collect();
        assert_eq!(ids, {
            let mut expect = vec![id_a, id_b];
            expect.sort_unstable();
            expect
        });
        let a = details.iter().find(|d| d.id == id_a).unwrap();
        assert_eq!(a.tags.len(), 1, "tags must aggregate on hydration");
        assert_eq!(a.tags[0].name, "t");
        assert_eq!(a.thumbnail_path.as_deref(), Some("/thumbs/a.jpg"));
        assert_eq!(a.width, Some(800));
        assert_eq!(a.height, Some(600));
        let b = details.iter().find(|d| d.id == id_b).unwrap();
        assert!(b.tags.is_empty(), "zero-tag image hydrates with an empty tags array");
    }

    #[test]
    fn details_by_ids_chunks_batches_beyond_the_bind_limit() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        // 600 images crosses the 500-id chunk boundary.
        for i in 0..600 {
            db.add_image(format!("/r/img_{i:04}.jpg"), Some(r.id)).unwrap();
        }
        let all_ids: Vec<i64> = db
            .get_feed_manifest(vec![], false, vec![])
            .unwrap()
            .iter()
            .map(|row| row.id)
            .collect();
        assert_eq!(all_ids.len(), 600);
        let details = db.get_image_details_by_ids(&all_ids).unwrap();
        assert_eq!(details.len(), 600, "both chunks must land");
        let ids: Vec<i64> = details.iter().map(|d| d.id).collect();
        assert_eq!(ids, all_ids, "id-sorted across chunk boundaries");
    }
}
