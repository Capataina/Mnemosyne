//! Compact feed manifest + id-batch detail hydration (T3-1).
//!
//! Split out of `images_query.rs` at the T3-1 seam, address-only
//! [code-health-audit 2026-08-02]: `FeedManifestRow`, `basename_of`, and
//! the `impl ImageDatabase` block below moved verbatim.
//! `aggregate_image_rows` stays in `images_query.rs` (it also serves the
//! legacy grid queries there) and widens to `pub(super)` so
//! `get_image_details_by_ids` below can still reach it; `basename_of`
//! moves here and widens to `pub(super)` the other way, since
//! `images_query.rs`'s `get_images_without_thumbnails` derives the same
//! display name for its `feed-delta` rows.

use rusqlite::params_from_iter;
use serde::Serialize;

use super::{ImageDatabase, ID};
use crate::image_struct::ImageData;

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
pub(super) fn basename_of(path: &str) -> String {
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

    /// Every visible image's `(id, basename)`, for the fuzzy-filename
    /// search signal (`cosine::name_match`). Applies the SAME orphan /
    /// disabled-root visibility predicate as `get_feed_manifest`'s
    /// `root_filter`, so the name signal ranks over exactly the catalogue
    /// the user can see — no more, no less.
    ///
    /// Deliberately carries NO tag filter: search spans the whole visible
    /// library (the frontend applies its own view filtering on top of the
    /// results, per the coherence pass), and it joins nothing — one plain
    /// SELECT of two columns, id-ascending. Crucially it reads `path`, not
    /// any embedding, so it also covers images that have never been
    /// encoded — the filename signal surfaces them where the encoders
    /// cannot.
    pub fn get_image_names_for_search(&self) -> rusqlite::Result<Vec<(ID, String)>> {
        let conn = self.read_lock();
        let mut stmt = conn.prepare(
            "SELECT images.id, images.path
             FROM images
             WHERE images.orphaned = 0
               AND (
                   images.root_id IS NULL
                   OR images.root_id IN (SELECT id FROM roots WHERE enabled = 1)
               )
             ORDER BY images.id;",
        )?;
        let rows = stmt.query_map([], |row| {
            let path: String = row.get(1)?;
            Ok((row.get::<_, ID>(0)?, basename_of(&path)))
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
            let aggregated = super::images_query::aggregate_image_rows(&mut rows)?;
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
