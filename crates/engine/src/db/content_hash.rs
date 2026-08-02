//! Content-hash relink: match a moved/renamed file back to its orphaned
//! row instead of stranding its attached data.
//!
//! Image identity is the filesystem path (`images.path UNIQUE`), so a
//! moved file's old row is orphaned forever and its new path is inserted
//! fresh — losing the tags, masonry placement (`manual_order` /
//! `manual_col_span`), and embeddings keyed on the old id. The
//! content-hash relink (the orphan-lifecycle diagnosis's first remedy —
//! this folder's CLAUDE.md carries the lifecycle and its limits) fixes this by
//! giving every image a full-content BLAKE3 hash: when the scan pass
//! finds a genuinely-new path, it first looks for an orphaned row whose
//! stored `(size, content_hash)` matches and, if found, UPDATEs that
//! row's path in place. The id survives, so all attached data survives.
//!
//! The hashing itself lives in `crate::content_hash::hash_file`; this
//! submodule is the DB side — storing the hash and the relink lookup.

use rusqlite::params;

use super::{ID, ImageDatabase};

/// Result of `relink_or_insert`: whether a genuinely-new path was matched
/// back to an existing orphaned row (`Relinked`) or was truly new and
/// inserted as a fresh row (`Inserted`). Either way the caller gets the
/// row id that now owns the path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelinkOutcome {
    /// The path's bytes matched an orphaned row; that row was updated in
    /// place (path + root + un-orphaned) and keeps its id and everything
    /// attached to it.
    Relinked { id: ID },
    /// No orphaned row matched; a brand-new row was inserted with the
    /// hash and size stored.
    Inserted { id: ID },
}

impl ImageDatabase {
    /// Store a computed content hash + byte size on an existing row.
    /// Used by the backfill pass to populate the columns for images that
    /// were indexed before content hashing existed (both columns NULL).
    pub fn set_content_hash(&self, id: ID, hash: &[u8], size: i64) -> rusqlite::Result<()> {
        let conn = self.connection.lock().unwrap();
        conn.execute(
            "UPDATE images SET content_hash = ?1, size = ?2 WHERE id = ?3",
            params![hash, size, id],
        )?;
        Ok(())
    }

    /// Return (id, path) for every live row still missing a content hash.
    /// Drives the backfill pass, which hashes each path and writes it
    /// back via `set_content_hash`. Mirrors `get_images_without_embedding_for`:
    /// tuple return, no tag join, and `orphaned = 0` so debris rows (whose
    /// files are gone and can never be hashed) are never enqueued.
    pub fn get_images_without_content_hash(&self) -> rusqlite::Result<Vec<(ID, String)>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path
             FROM images
             WHERE orphaned = 0 AND content_hash IS NULL",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, ID>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect()
    }

    /// Relink a genuinely-new path to an orphaned row of identical bytes,
    /// or insert it fresh if none matches.
    ///
    /// The caller (the scan pipeline) only invokes this for paths not
    /// already in the DB, so the target `path` never collides with the
    /// `UNIQUE(path)` constraint. `hash` is a 32-byte BLAKE3 digest; it is
    /// stored (and compared) as a BLOB, `size` as an INTEGER byte count.
    ///
    /// Match rule: the lowest-id orphaned row whose `(size, content_hash)`
    /// equals the request. On a hit the row is updated in place — new
    /// path, new root, `orphaned = 0` — but `content_hash`/`size` are left
    /// untouched, since they already match by construction (the file's
    /// bytes are identical). On a miss a new row is inserted carrying the
    /// hash and size.
    ///
    /// **Determinism.** This is called serially, once per new file. Each
    /// call runs its own SELECT inside its own committed transaction, so a
    /// second identical new file sees the first call's relink and consumes
    /// the *next* lowest-id orphan rather than re-consuming the same one —
    /// two identical moved files therefore drain two distinct orphaned
    /// rows, lowest id first. That invariant depends on the per-call
    /// commit; do not batch the SELECTs across calls.
    pub fn relink_or_insert(
        &self,
        path: &str,
        root_id: Option<ID>,
        hash: &[u8],
        size: i64,
    ) -> rusqlite::Result<RelinkOutcome> {
        let mut conn = self.connection.lock().unwrap();
        // IMMEDIATE, matching insert_image_chunk: take the write lock at
        // BEGIN so the SELECT-then-UPDATE/INSERT runs without a reader-race
        // upgrade window under WAL. The whole method holds the writer mutex
        // once, so nothing else in-process can interleave regardless.
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

        // Lowest-id orphaned row whose bytes match. `content_hash IS NULL`
        // rows can never match here: SQL `NULL = ?` is NULL, not true, so
        // an un-hashed orphan is correctly skipped.
        let existing: Option<ID> = {
            let mut stmt = tx.prepare(
                "SELECT id FROM images
                 WHERE orphaned = 1 AND size = ?1 AND content_hash = ?2
                 ORDER BY id ASC LIMIT 1",
            )?;
            let mut rows = stmt.query(params![size, hash])?;
            match rows.next()? {
                Some(row) => Some(row.get::<_, ID>(0)?),
                None => None,
            }
        };

        let outcome = match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE images SET path = ?1, root_id = ?2, orphaned = 0 WHERE id = ?3",
                    params![path, root_id, id],
                )?;
                RelinkOutcome::Relinked { id }
            }
            None => {
                tx.execute(
                    "INSERT INTO images (path, root_id, content_hash, size)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![path, root_id, hash, size],
                )?;
                RelinkOutcome::Inserted {
                    id: tx.last_insert_rowid(),
                }
            }
        };

        tx.commit()?;
        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::fresh_db;
    use super::super::{ID, ImageDatabase};
    use super::RelinkOutcome;

    /// A synthetic 32-byte "hash" — the DB layer stores and compares
    /// whatever bytes it is handed; it does not hash files itself, so the
    /// relink logic can be exercised with distinct constant digests
    /// without touching the filesystem.
    fn hash_bytes(seed: u8) -> [u8; 32] {
        [seed; 32]
    }

    /// Direct read of the stored (content_hash, size) for one row, straight
    /// from the writer connection — bypasses every read-path filter so the
    /// raw persisted bytes are what gets asserted.
    fn stored_hash_and_size(db: &ImageDatabase, id: ID) -> (Option<Vec<u8>>, Option<i64>) {
        let conn = db.connection.lock().unwrap();
        conn.query_row(
            "SELECT content_hash, size FROM images WHERE id = ?1",
            [id],
            |r| Ok((r.get::<_, Option<Vec<u8>>>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .unwrap()
    }

    fn orphaned_flag(db: &ImageDatabase, id: ID) -> i64 {
        let conn = db.connection.lock().unwrap();
        conn.query_row("SELECT orphaned FROM images WHERE id = ?1", [id], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap()
    }

    fn root_id_of(db: &ImageDatabase, id: ID) -> Option<ID> {
        let conn = db.connection.lock().unwrap();
        conn.query_row("SELECT root_id FROM images WHERE id = ?1", [id], |r| {
            r.get::<_, Option<ID>>(0)
        })
        .unwrap()
    }

    fn tag_ids_for(db: &ImageDatabase, id: ID) -> Vec<ID> {
        let conn = db.connection.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT tag_id FROM images_tags WHERE image_id = ?1 ORDER BY tag_id")
            .unwrap();
        stmt.query_map([id], |r| r.get::<_, ID>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    fn embedding_encoder_ids_for(db: &ImageDatabase, id: ID) -> Vec<String> {
        let conn = db.connection.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT encoder_id FROM embeddings WHERE image_id = ?1 ORDER BY encoder_id")
            .unwrap();
        stmt.query_map([id], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    #[test]
    fn move_detected_and_relinked_preserves_row_and_attachments() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        let h = hash_bytes(1);
        const S: i64 = 4096;

        // Insert a real row via relink_or_insert (stores hash + size).
        let id = match db
            .relink_or_insert("/r/old.jpg", Some(r.id), &h, S)
            .unwrap()
        {
            RelinkOutcome::Inserted { id } => id,
            other => panic!("first insert should be Inserted, got {other:?}"),
        };

        // Attach a tag, an embedding, and a manual span — the data a move
        // must not lose.
        let tag = db.create_tag("keep".into(), "#fff".into()).unwrap();
        db.add_tag_to_image(id, tag.id).unwrap();
        db.upsert_embedding(id, "clip_vit_b_32", &[0.5, 0.5]).unwrap();
        db.set_manual_col_span(id, Some(3)).unwrap();

        // The file "moves": this scan no longer sees the old path, so the
        // row is orphaned.
        db.mark_orphaned(r.id, &[]).unwrap();
        assert_eq!(orphaned_flag(&db, id), 1, "row must be orphaned pre-relink");

        // The file reappears at a new path with identical bytes.
        let outcome = db
            .relink_or_insert("/r/new.jpg", Some(r.id), &h, S)
            .unwrap();
        assert_eq!(
            outcome,
            RelinkOutcome::Relinked { id },
            "identical bytes must relink to the same row id"
        );

        // The row is visible again (un-orphaned), at the new path, with its
        // manual span intact.
        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(imgs.len(), 1);
        assert_eq!(imgs[0].id, id, "the id must survive the move");
        assert_eq!(imgs[0].path, "/r/new.jpg", "path must be the new location");
        assert_eq!(
            imgs[0].manual_col_span,
            Some(3),
            "manual placement must survive the move"
        );

        // The tag link and embedding still hang off the surviving id.
        assert_eq!(tag_ids_for(&db, id), vec![tag.id], "tag must survive");
        assert_eq!(
            embedding_encoder_ids_for(&db, id),
            vec!["clip_vit_b_32".to_string()],
            "embedding must survive"
        );
    }

    #[test]
    fn cross_root_move_relinks_and_updates_root_id() {
        let db = fresh_db();
        let a = db.add_root("/a".into(), None).unwrap();
        let b = db.add_root("/b".into(), None).unwrap();
        let h = hash_bytes(2);
        const S: i64 = 2048;

        let id = match db.relink_or_insert("/a/x.jpg", Some(a.id), &h, S).unwrap() {
            RelinkOutcome::Inserted { id } => id,
            other => panic!("expected Inserted, got {other:?}"),
        };
        db.mark_orphaned(a.id, &[]).unwrap();

        // The file moved to a different root entirely.
        let outcome = db.relink_or_insert("/b/x.jpg", Some(b.id), &h, S).unwrap();
        assert_eq!(outcome, RelinkOutcome::Relinked { id });
        assert_eq!(
            root_id_of(&db, id),
            Some(b.id),
            "a cross-root relink must move the row to the new root"
        );
    }

    #[test]
    fn duplicate_hash_picks_lowest_id_deterministically() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        let h = hash_bytes(3);
        const S: i64 = 512;

        // Two rows with identical bytes. The second insert does NOT relink
        // to the first because the first is not yet orphaned.
        let i1 = match db.relink_or_insert("/r/1.jpg", Some(r.id), &h, S).unwrap() {
            RelinkOutcome::Inserted { id } => id,
            other => panic!("expected Inserted, got {other:?}"),
        };
        let i2 = match db.relink_or_insert("/r/2.jpg", Some(r.id), &h, S).unwrap() {
            RelinkOutcome::Inserted { id } => id,
            other => panic!("expected Inserted, got {other:?}"),
        };
        assert!(i1 < i2, "ids must be ordered for the lowest-id assertion");

        // Both files vanish → both orphaned.
        db.mark_orphaned(r.id, &[]).unwrap();

        // Two identical new files arrive: they must consume i1 then i2,
        // lowest id first, deterministically.
        assert_eq!(
            db.relink_or_insert("/r/a.jpg", Some(r.id), &h, S).unwrap(),
            RelinkOutcome::Relinked { id: i1 },
            "first duplicate must take the lowest-id orphan"
        );
        assert_eq!(
            db.relink_or_insert("/r/b.jpg", Some(r.id), &h, S).unwrap(),
            RelinkOutcome::Relinked { id: i2 },
            "second duplicate must take the next-lowest orphan"
        );

        // No orphans with this hash remain → a third is a fresh insert.
        match db.relink_or_insert("/r/c.jpg", Some(r.id), &h, S).unwrap() {
            RelinkOutcome::Inserted { .. } => {}
            other => panic!("third must be Inserted, got {other:?}"),
        }
    }

    #[test]
    fn null_hash_orphan_is_never_relinked() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();

        // A row that never got a content hash (indexed before hashing).
        db.add_image("/r/legacy.jpg".into(), Some(r.id)).unwrap();
        let legacy_id = db.get_image_id_by_path("/r/legacy.jpg").unwrap();
        db.mark_orphaned(r.id, &[]).unwrap();
        assert_eq!(orphaned_flag(&db, legacy_id), 1);

        // A new file arrives. The NULL-hash orphan must NOT be matched.
        let h = hash_bytes(4);
        match db.relink_or_insert("/r/new.jpg", Some(r.id), &h, 100).unwrap() {
            RelinkOutcome::Inserted { .. } => {}
            other => panic!("must not relink a NULL-hash orphan, got {other:?}"),
        }
        assert_eq!(
            orphaned_flag(&db, legacy_id),
            1,
            "the NULL-hash orphan must be left untouched"
        );
    }

    #[test]
    fn relink_or_insert_stores_hash_on_insert() {
        let db = fresh_db();
        let h = hash_bytes(5);
        const S: i64 = 7777;

        let id = match db.relink_or_insert("/only.jpg", None, &h, S).unwrap() {
            RelinkOutcome::Inserted { id } => id,
            other => panic!("expected Inserted, got {other:?}"),
        };

        let (stored_hash, stored_size) = stored_hash_and_size(&db, id);
        assert_eq!(
            stored_hash,
            Some(h.to_vec()),
            "the exact hash bytes must be persisted on insert"
        );
        assert_eq!(stored_size, Some(S), "the exact size must be persisted");
    }

    #[test]
    fn backfill_is_idempotent() {
        let db = fresh_db();
        db.add_image("/img.jpg".into(), None).unwrap();
        let id = db.get_image_id_by_path("/img.jpg").unwrap();

        // The un-hashed row is enqueued for backfill.
        let pending = db.get_images_without_content_hash().unwrap();
        assert_eq!(pending, vec![(id, "/img.jpg".to_string())]);

        // After hashing, the queue is empty.
        let h = hash_bytes(6);
        db.set_content_hash(id, &h, 3210).unwrap();
        assert!(
            db.get_images_without_content_hash().unwrap().is_empty(),
            "a hashed row must not re-appear in the backfill queue"
        );

        // Re-running the backfill is a no-op: the queue is still empty.
        db.set_content_hash(id, &h, 3210).unwrap();
        assert!(db.get_images_without_content_hash().unwrap().is_empty());
    }

    #[test]
    fn purge_and_relink_coexist() {
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        let h = hash_bytes(7);
        const S: i64 = 1024;

        // A moved file that gets relinked, carrying a tag.
        let moved_id = match db.relink_or_insert("/r/moved.jpg", Some(r.id), &h, S).unwrap() {
            RelinkOutcome::Inserted { id } => id,
            other => panic!("expected Inserted, got {other:?}"),
        };
        let tag = db.create_tag("keep".into(), "#fff".into()).unwrap();
        db.add_tag_to_image(moved_id, tag.id).unwrap();

        // A genuinely-gone file: added, never hashed, and it stays gone.
        db.add_image("/r/gone.jpg".into(), Some(r.id)).unwrap();
        let gone_id = db.get_image_id_by_path("/r/gone.jpg").unwrap();

        // Orphan the moved file, then relink it to its new path.
        db.mark_orphaned(r.id, &[]).unwrap();
        assert_eq!(
            db.relink_or_insert("/r/moved-new.jpg", Some(r.id), &h, S)
                .unwrap(),
            RelinkOutcome::Relinked { id: moved_id }
        );

        // Now a scan sees only the relinked file; the gone file is orphaned.
        db.mark_orphaned(r.id, &["/r/moved-new.jpg".to_string()])
            .unwrap();
        assert_eq!(orphaned_flag(&db, gone_id), 1, "the gone file must be orphaned");
        assert_eq!(
            orphaned_flag(&db, moved_id),
            0,
            "the relinked file must not be orphaned"
        );

        // Purge removes only the gone row; the relinked row is not collateral.
        let purged = db.purge_orphaned().unwrap();
        assert_eq!(purged, 1, "only the genuinely-gone row should be purged");

        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false, vec![])
            .unwrap();
        assert_eq!(imgs.len(), 1);
        assert_eq!(imgs[0].id, moved_id, "the relinked row must survive the purge");
        assert_eq!(imgs[0].path, "/r/moved-new.jpg");
        assert_eq!(tag_ids_for(&db, moved_id), vec![tag.id], "its tag must survive");
    }

    #[test]
    fn size_participates_in_the_relink_match() {
        // Defensive: a hash collision is astronomically unlikely, but the
        // size column is in the WHERE clause, so prove it actually gates
        // the match — an orphan of (H, S1) must not satisfy a request for
        // (H, S2).
        let db = fresh_db();
        let r = db.add_root("/r".into(), None).unwrap();
        let h = hash_bytes(8);
        const S1: i64 = 100;
        const S2: i64 = 200;

        let id = match db.relink_or_insert("/r/orig.jpg", Some(r.id), &h, S1).unwrap() {
            RelinkOutcome::Inserted { id } => id,
            other => panic!("expected Inserted, got {other:?}"),
        };
        db.mark_orphaned(r.id, &[]).unwrap();

        // Same hash, different size → no match, fresh insert.
        match db.relink_or_insert("/r/other.jpg", Some(r.id), &h, S2).unwrap() {
            RelinkOutcome::Inserted { .. } => {}
            other => panic!("differing size must not relink, got {other:?}"),
        }
        assert_eq!(
            orphaned_flag(&db, id),
            1,
            "the (H, S1) orphan must be untouched by a (H, S2) request"
        );
    }
}
