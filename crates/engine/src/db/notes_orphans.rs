//! Image insert + per-image notes + orphan-detection lifecycle.
//!
//! Grouped together because all three concerns mutate the `images`
//! table directly outside the read-paths in `images_query.rs`:
//!   * `add_image` is the single insertion point used by the indexing
//!     pipeline.
//!   * `get_image_notes` / `set_image_notes` manage the Phase-11 free
//!     text annotations column.
//!   * `mark_orphaned` is the Phase-7 deleted-from-disk lifecycle —
//!     called by the indexing pipeline's orphan-detection pass.

use std::collections::HashSet;

use rusqlite::{params, params_from_iter};

use super::{ID, ImageDatabase};

impl ImageDatabase {
    /// Set or clear the orphaned flag on every image in a given root.
    /// Used by the indexing pipeline's orphan-detection pass — after a
    /// scan we know exactly which paths exist on disk, and any DB row
    /// for that root whose path isn't in the live set gets marked
    /// orphaned. The grid query filters orphaned rows out so the user
    /// doesn't see deleted images.
    ///
    /// Returns the number of rows updated.
    pub fn mark_orphaned(&self, root_id: ID, alive_paths: &[String]) -> rusqlite::Result<usize> {
        let conn = self.connection.lock().unwrap();

        // Re-mark every row from this root as not-orphaned first.
        // Necessary because a previously-orphaned row whose file came
        // back (rename, restore from trash) should re-appear in the grid.
        conn.execute(
            "UPDATE images SET orphaned = 0 WHERE root_id = ?1",
            [root_id],
        )?;

        if alive_paths.is_empty() {
            // Edge case: empty scan (e.g. user pointed at a now-empty
            // folder). Mark every row from this root orphaned.
            let n = conn.execute(
                "UPDATE images SET orphaned = 1 WHERE root_id = ?1",
                [root_id],
            )?;
            return Ok(n);
        }

        // Two-pass approach without temp tables: load all paths from the
        // root, diff against the alive set in Rust, then UPDATE the
        // diff. This avoids constructing a multi-thousand-element IN
        // clause that would blow past SQLite's parameter limits on
        // large libraries.
        let mut stmt = conn.prepare("SELECT id, path FROM images WHERE root_id = ?1")?;
        let rows: Vec<(ID, String)> = stmt
            .query_map([root_id], |r| Ok((r.get::<_, ID>(0)?, r.get::<_, String>(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        let alive_set: HashSet<&str> = alive_paths.iter().map(|s| s.as_str()).collect();
        let to_orphan: Vec<ID> = rows
            .iter()
            .filter(|(_, p)| !alive_set.contains(p.as_str()))
            .map(|(id, _)| *id)
            .collect();

        if to_orphan.is_empty() {
            return Ok(0);
        }

        let mut updated = 0;
        for chunk in to_orphan.chunks(500) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "UPDATE images SET orphaned = 1 WHERE id IN ({placeholders})"
            );
            updated += conn.execute(&sql, params_from_iter(chunk))?;
        }
        Ok(updated)
    }

    /// (id, root_id) for every orphaned row, ordered by id. Read-only —
    /// callers that need to clean up on-disk artefacts tied to an
    /// orphaned row (e.g. its cached thumbnail files) must snapshot this
    /// BEFORE calling `purge_orphaned`, since the row those paths would
    /// be derived from is gone once that runs.
    pub fn list_orphaned_locations(&self) -> rusqlite::Result<Vec<(ID, Option<ID>)>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, root_id FROM images WHERE orphaned = 1 ORDER BY id")?;
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, ID>(0)?, r.get::<_, Option<ID>>(1)?)))?;
        rows.collect()
    }

    /// Permanently delete every orphaned image row — remedy option 2 from
    /// the orphan-lifecycle diagnosis ledger
    /// (docs/engineering/decisions/image-identity-orphan-lifecycle.md): a scoped
    /// DELETE for rows whose backing file vanished from disk and never
    /// came back (`mark_orphaned` above only un-marks a row if the SAME
    /// path reappears, so without this these rows are permanent debris).
    /// `images_tags` and `embeddings` rows for the deleted ids cascade
    /// away via the `ON DELETE CASCADE` FKs declared in mod.rs's schema —
    /// `PRAGMA foreign_keys = ON` is set once on this writer connection
    /// in `initialize()` and, being a per-connection (not per-file)
    /// SQLite setting, holds for the connection's whole lifetime, so
    /// every DELETE through it actually cascades.
    ///
    /// Returns the number of rows deleted. Callers that also want to
    /// clean up the purged rows' cached thumbnail files must call
    /// `list_orphaned_locations` first — this method's contract is
    /// intentionally a bare count, not the rows it removed.
    pub fn purge_orphaned(&self) -> rusqlite::Result<usize> {
        self.connection
            .lock()
            .unwrap()
            .execute("DELETE FROM images WHERE orphaned = 1", [])
    }

    /// Insert an image path. With multi-folder support each row remembers
    /// which root it came from. Idempotent via `INSERT OR IGNORE` on the
    /// path uniqueness constraint — a re-scan never duplicates rows.
    pub fn add_image(&self, path: String, root_id: Option<ID>) -> rusqlite::Result<()> {
        let conn = self.connection.lock().unwrap();
        match root_id {
            Some(rid) => {
                conn.execute(
                    "INSERT OR IGNORE INTO images (path, root_id) VALUES (?1, ?2)",
                    params![path, rid],
                )?;
            }
            None => {
                conn.execute(
                    "INSERT OR IGNORE INTO images (path) VALUES (?1)",
                    [path],
                )?;
            }
        }
        Ok(())
    }

    /// Batched form of `add_image` for the scan pass. Runs one prepared
    /// `INSERT OR IGNORE` inside a single `BEGIN IMMEDIATE` transaction
    /// per `BATCH_SIZE` paths instead of one autocommit statement per
    /// path — a 100k first scan collapses ~100k mutex-taking autocommits
    /// into ~400 transactions (~250× fewer). Nothing else competes for
    /// the CPU during scan, so the mutex/statement overhead saved is
    /// visible even though WAL + `synchronous = NORMAL` mean the old
    /// autocommits were WAL appends without per-commit fsync.
    ///
    /// Semantics are identical to calling `add_image` in a loop:
    ///
    /// * A `None` root binds `root_id` to SQL NULL, exactly what
    ///   `add_image`'s single-column `INSERT OR IGNORE INTO images
    ///   (path)` produces (the column has no DEFAULT, so it lands NULL
    ///   either way). One statement covers both cases.
    /// * `INSERT OR IGNORE` dedup on the path uniqueness constraint is
    ///   preserved, so a re-scan still never duplicates rows.
    /// * **Partial-failure fallback is mandatory, not optional.** If a
    ///   batch transaction fails (a row hits a constraint the prepared
    ///   statement can't IGNORE), the transaction rolls back and the
    ///   chunk is retried one row at a time through `add_image`, so a
    ///   single bad row can never sink its batch-mates — byte-identical
    ///   to today's per-path loop, including error propagation on the
    ///   offending row.
    pub fn add_images_batch(&self, images: &[(String, Option<ID>)]) -> rusqlite::Result<()> {
        const BATCH_SIZE: usize = 256;
        for chunk in images.chunks(BATCH_SIZE) {
            if self.insert_image_chunk(chunk).is_err() {
                // Fallback: the transaction already rolled back, so no
                // partial chunk landed. Replay each row individually —
                // this is exactly the old code path, so per-row success
                // and per-row error propagation are preserved.
                for (path, root_id) in chunk {
                    self.add_image(path.clone(), *root_id)?;
                }
            }
        }
        Ok(())
    }

    /// One `BEGIN IMMEDIATE` transaction inserting a chunk of paths via a
    /// single prepared statement. Split out from `add_images_batch` so
    /// the transaction guard is dropped before the per-row fallback runs
    /// (both take the connection mutex; nesting them would deadlock).
    fn insert_image_chunk(&self, chunk: &[(String, Option<ID>)]) -> rusqlite::Result<()> {
        let mut conn = self.connection.lock().unwrap();
        // IMMEDIATE, matching upsert_embeddings_batch: take the write
        // lock at BEGIN rather than letting DEFERRED upgrade on the first
        // INSERT, which closes the reader-race window under WAL.
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO images (path, root_id) VALUES (?1, ?2)",
            )?;
            for (path, root_id) in chunk {
                stmt.execute(params![path, root_id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Read the free-text annotation for an image. Returns Ok(None)
    /// when the row exists but the column is NULL (default).
    pub fn get_image_notes(&self, image_id: ID) -> rusqlite::Result<Option<String>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare("SELECT notes FROM images WHERE id = ?1")?;
        let mut rows = stmt.query([image_id])?;
        match rows.next()? {
            Some(row) => row.get::<_, Option<String>>(0),
            None => Err(rusqlite::Error::QueryReturnedNoRows),
        }
    }

    /// Set / clear the free-text annotation. Pass an empty string or
    /// "" to clear; we don't bother distinguishing "" from NULL because
    /// the user-facing semantic is the same ("no annotation").
    pub fn set_image_notes(&self, image_id: ID, notes: &str) -> rusqlite::Result<()> {
        let cleaned = notes.trim();
        let val: Option<&str> = if cleaned.is_empty() { None } else { Some(cleaned) };
        self.connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE images SET notes = ?1 WHERE id = ?2",
                params![val, image_id],
            )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::fresh_db;
    use super::super::{ID, ImageDatabase};

    /// Raw (path, root_id) dump straight from the images table, ordered
    /// by path — the ground-truth row set, independent of any read-path
    /// filtering (orphaned, root enablement) that `get_all_images` layers
    /// on top. Used to prove the batch insert lands exactly the same rows
    /// the per-row loop would.
    fn dump_paths(db: &ImageDatabase) -> Vec<(String, Option<ID>)> {
        let conn = db.connection.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT path, root_id FROM images ORDER BY path")
            .unwrap();
        stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<ID>>(1)?))
        })
        .unwrap()
        .filter_map(|x| x.ok())
        .collect()
    }

    // ============================================================
    //  T2-2: batched scan-phase inserts
    // ============================================================

    #[test]
    fn add_images_batch_matches_per_row_inserts() {
        // Same inputs through the batched path and the old per-row loop
        // must produce byte-identical row sets. Cross the 256 batch
        // boundary (300 rows), mix Some/None roots to exercise both the
        // two-column and NULL-root branches, and include a duplicate path
        // to prove INSERT OR IGNORE dedup survives batching.
        let db_batch = fresh_db();
        let db_row = fresh_db();
        let rb = db_batch.add_root("/root".into(), None).unwrap();
        let rr = db_row.add_root("/root".into(), None).unwrap();
        assert_eq!(rb.id, rr.id, "roots should get the same id in fresh DBs");

        let mut batch: Vec<(String, Option<ID>)> = Vec::new();
        for i in 0..300 {
            let root = if i % 2 == 0 { Some(rb.id) } else { None };
            batch.push((format!("/root/{i}.jpg"), root));
        }
        // Duplicate of an earlier path — must be ignored, not duplicated
        // and not error the batch.
        batch.push(("/root/0.jpg".into(), Some(rb.id)));

        db_batch.add_images_batch(&batch).unwrap();
        for (p, root) in &batch {
            db_row.add_image(p.clone(), *root).unwrap();
        }

        let batched = dump_paths(&db_batch);
        let per_row = dump_paths(&db_row);
        assert_eq!(
            batched, per_row,
            "batched inserts must land the same rows as the per-row loop"
        );
        assert_eq!(
            batched.len(),
            300,
            "300 unique paths, the duplicate deduped away"
        );
    }

    #[test]
    fn add_images_batch_falls_back_per_row_on_batch_failure() {
        // A foreign-key violation (root_id with no matching roots row) is
        // NOT swallowed by INSERT OR IGNORE — it fails the transaction.
        // The mandatory fallback must then replay the chunk per row so
        // the rows before the bad one still land (a naive rollback-only
        // path would lose them), while the error still propagates on the
        // offending row exactly as today's per-row `add_image(..)?` loop
        // does — so rows after the failure do NOT land.
        let db = fresh_db();
        let r = db.add_root("/root".into(), None).unwrap();
        const MISSING_ROOT: ID = 9999;

        let batch: Vec<(String, Option<ID>)> = vec![
            ("/root/a.jpg".into(), Some(r.id)),
            ("/root/b.jpg".into(), Some(r.id)),
            ("/root/bad.jpg".into(), Some(MISSING_ROOT)),
            ("/root/c.jpg".into(), Some(r.id)),
        ];

        let result = db.add_images_batch(&batch);
        assert!(
            result.is_err(),
            "the FK-violating row must propagate an error, matching add_image"
        );

        let landed = dump_paths(&db);
        let paths: Vec<&str> = landed.iter().map(|(p, _)| p.as_str()).collect();
        assert!(
            paths.contains(&"/root/a.jpg") && paths.contains(&"/root/b.jpg"),
            "rows before the failure must survive via the per-row fallback"
        );
        assert!(
            !paths.contains(&"/root/bad.jpg"),
            "the FK-violating row must not land"
        );
        assert!(
            !paths.contains(&"/root/c.jpg"),
            "rows after the propagated error must not land, matching the old `?` loop"
        );
    }

    // ============================================================
    //  Phase 7: orphan detection
    // ============================================================

    #[test]
    fn mark_orphaned_marks_missing_paths() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        db.add_image("/r/keep.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/r/lost.jpg".into(), Some(r.id)).unwrap();

        // Only "keep" is in the alive set.
        let alive = vec!["/r/keep.jpg".to_string()];
        let n = db.mark_orphaned(r.id, &alive).unwrap();
        assert_eq!(n, 1, "exactly one image should have been orphaned");

        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(imgs.len(), 1, "orphaned row should be filtered out");
        assert_eq!(imgs[0].path, "/r/keep.jpg");
    }

    #[test]
    fn mark_orphaned_unmarks_returned_files() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        db.add_image("/r/file.jpg".into(), Some(r.id)).unwrap();
        // First scan: file is alive.
        db.mark_orphaned(r.id, &["/r/file.jpg".into()]).unwrap();
        // Second scan: file disappeared.
        db.mark_orphaned(r.id, &[]).unwrap();
        let visible = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert!(visible.is_empty());
        // Third scan: file returned.
        db.mark_orphaned(r.id, &["/r/file.jpg".into()]).unwrap();
        let visible = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(visible.len(), 1);
    }

    #[test]
    fn mark_orphaned_empty_alive_set_orphans_everything_in_root() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        for i in 0..3 {
            db.add_image(format!("/r/{i}.jpg"), Some(r.id)).unwrap();
        }
        let n = db.mark_orphaned(r.id, &[]).unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn mark_orphaned_does_not_affect_other_roots() {
        let db = fresh_db();
        let a = db.add_root("/a".into(), None).unwrap();
        let b = db.add_root("/b".into(), None).unwrap();
        db.add_image("/a/1.jpg".into(), Some(a.id)).unwrap();
        db.add_image("/b/1.jpg".into(), Some(b.id)).unwrap();

        // Empty alive set for root a should orphan a's images, not b's.
        db.mark_orphaned(a.id, &[]).unwrap();
        let visible = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].path, "/b/1.jpg");
    }

    #[test]
    fn purge_orphaned_deletes_rows_and_cascades_tags_and_embeddings() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        db.add_image("/r/alive.jpg".into(), Some(r.id)).unwrap();
        db.add_image("/r/dead.jpg".into(), Some(r.id)).unwrap();
        let alive_id = db.get_image_id_by_path("/r/alive.jpg").unwrap();
        let dead_id = db.get_image_id_by_path("/r/dead.jpg").unwrap();

        // Attach a tag + embedding to BOTH rows, so the assertions below
        // prove the cascade removes exactly the orphaned row's dependents
        // and leaves the alive row's untouched.
        let tag = db.create_tag("keep".into(), "#fff".into()).unwrap();
        db.add_tag_to_image(alive_id, tag.id).unwrap();
        db.add_tag_to_image(dead_id, tag.id).unwrap();
        db.upsert_embedding(alive_id, "clip_vit_b_32", &[1.0, 0.0])
            .unwrap();
        db.upsert_embedding(dead_id, "clip_vit_b_32", &[0.0, 1.0])
            .unwrap();

        // Only alive.jpg survives the scan → dead.jpg gets orphaned.
        db.mark_orphaned(r.id, &["/r/alive.jpg".to_string()])
            .unwrap();

        // list_orphaned_locations must see exactly the orphaned row,
        // with its root_id, before anything is deleted.
        let locations = db.list_orphaned_locations().unwrap();
        assert_eq!(locations, vec![(dead_id, Some(r.id))]);

        let deleted = db.purge_orphaned().unwrap();
        assert_eq!(deleted, 1, "exactly the one orphaned row should be purged");

        let conn = db.connection.lock().unwrap();
        let remaining_ids: Vec<ID> = conn
            .prepare("SELECT id FROM images ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get::<_, ID>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            remaining_ids,
            vec![alive_id],
            "the alive row must survive untouched"
        );

        let tag_image_ids: Vec<ID> = conn
            .prepare("SELECT image_id FROM images_tags ORDER BY image_id")
            .unwrap()
            .query_map([], |r| r.get::<_, ID>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            tag_image_ids,
            vec![alive_id],
            "the dead row's images_tags link must cascade away, alive's must survive"
        );

        let embedding_image_ids: Vec<ID> = conn
            .prepare("SELECT image_id FROM embeddings ORDER BY image_id")
            .unwrap()
            .query_map([], |r| r.get::<_, ID>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            embedding_image_ids,
            vec![alive_id],
            "the dead row's embeddings must cascade away, alive's must survive"
        );
        drop(conn);

        // Idempotent: nothing left to purge on a second call.
        assert_eq!(db.purge_orphaned().unwrap(), 0);
    }

    #[test]
    fn purge_orphaned_is_a_no_op_when_nothing_is_orphaned() {
        let db = fresh_db();
        db.add_image("/only.jpg".into(), None).unwrap();
        assert!(db.list_orphaned_locations().unwrap().is_empty());
        assert_eq!(db.purge_orphaned().unwrap(), 0);
        assert_eq!(db.get_all_images().unwrap().len(), 1);
    }

    #[test]
    fn mark_orphaned_chunks_handle_large_libraries() {
        // The chunked-IN logic kicks in above 500 ids. Stress with 1200
        // to exercise the chunk boundary.
        let db = fresh_db();
        let r = db.add_root("/big".into(), None).unwrap();
        for i in 0..1200 {
            db.add_image(format!("/big/{i}.jpg"), Some(r.id)).unwrap();
        }
        // Empty alive set => all 1200 orphan.
        let n = db.mark_orphaned(r.id, &[]).unwrap();
        assert_eq!(n, 1200);
    }

    // ============================================================
    //  Phase 11: notes
    // ============================================================

    #[test]
    fn notes_round_trip() {
        let db = fresh_db();
        db.add_image("/img.jpg".into(), None).unwrap();
        let id = db.get_image_id_by_path("/img.jpg").unwrap();
        // Initially NULL.
        assert_eq!(db.get_image_notes(id).unwrap(), None);

        db.set_image_notes(id, "a personal note").unwrap();
        assert_eq!(
            db.get_image_notes(id).unwrap(),
            Some("a personal note".to_string())
        );

        // Setting empty / whitespace should clear the field.
        db.set_image_notes(id, "   ").unwrap();
        assert_eq!(db.get_image_notes(id).unwrap(), None);
    }

    #[test]
    fn notes_get_returns_none_when_unset() {
        let db = fresh_db();
        db.add_image("/img.jpg".into(), None).unwrap();
        let id = db.get_image_id_by_path("/img.jpg").unwrap();
        assert!(db.get_image_notes(id).unwrap().is_none());
    }

    #[test]
    fn notes_persist_across_reads() {
        let db = fresh_db();
        db.add_image("/img.jpg".into(), None).unwrap();
        let id = db.get_image_id_by_path("/img.jpg").unwrap();
        db.set_image_notes(id, "first").unwrap();
        // Second read should still see the value.
        for _ in 0..5 {
            assert_eq!(
                db.get_image_notes(id).unwrap(),
                Some("first".to_string())
            );
        }
    }
}
