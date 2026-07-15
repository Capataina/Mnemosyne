//! Tag catalogue + image↔tag association table.
//!
//! Tags themselves live in the `tags` table; the many-to-many link to
//! images lives in `images_tags`. Queries that JOIN those two for the
//! grid live in `images_query.rs`; the methods here are the small
//! mutation surface for managing the catalogue.

use rusqlite::fallible_iterator::FallibleIterator;

use super::{ID, ImageDatabase};
use crate::tag_struct::{Tag, TagCount};

impl ImageDatabase {
    pub fn create_tag(&self, name: String, color: String) -> rusqlite::Result<Tag> {
        let conn = self.connection.lock().unwrap();
        conn.execute(
            "INSERT INTO tags (name, color) VALUES (?1, ?2)",
            [name.clone(), color.clone()],
        )?;
        Ok(Tag::new(conn.last_insert_rowid(), name, color))
    }

    pub fn delete_tag(&self, tag_id: ID) -> rusqlite::Result<()> {
        self.connection
            .lock()
            .unwrap()
            .execute("DELETE FROM tags WHERE id = ?1", [tag_id])?;
        Ok(())
    }

    pub fn remove_tag_from_image(&self, image_id: ID, tag_id: ID) -> rusqlite::Result<()> {
        self.connection.lock().unwrap().execute(
            "DELETE FROM images_tags WHERE image_id = ?1 AND tag_id = ?2",
            [image_id, tag_id],
        )?;
        Ok(())
    }

    pub fn add_tag_to_image(&self, image_id: ID, tag_id: ID) -> rusqlite::Result<()> {
        // INSERT OR IGNORE so duplicate (image_id, tag_id) assignments are
        // a no-op rather than a UNIQUE-constraint error. The frontend
        // pre-checks selection state, but a future caller that doesn't
        // shouldn't have to.
        self.connection.lock().unwrap().execute(
            "INSERT OR IGNORE INTO images_tags (image_id, tag_id) VALUES (?1, ?2)",
            [image_id, tag_id],
        )?;
        Ok(())
    }

    pub fn get_tags(&self) -> rusqlite::Result<Vec<Tag>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM tags ORDER BY id;")?;

        let rows = stmt.query([])?;

        rows
            .map(|r| Ok(Tag::new(r.get("id")?, r.get("name")?, r.get("color")?)))
            .collect()
    }

    /// Per-tag count of VISIBLE images, using the SAME visibility
    /// predicate the grid query applies (`get_images_with_thumbnails`):
    /// not orphaned, and in an enabled root (or a legacy NULL root). So
    /// the library drawer's folder counts match exactly what opening that
    /// folder shows — an image that's orphaned or lives under a disabled
    /// root is counted by neither.
    ///
    /// Returns a row for EVERY tag, including tags with zero visible
    /// images (count 0), so the drawer never has to guess a missing
    /// tag's count. `COUNT(vis.id)` counts only the LEFT-JOIN rows where
    /// the tagged image both exists and passes the predicate; the
    /// `images_tags` PK guarantees one row per (image, tag), so there's
    /// no double counting.
    pub fn get_tag_counts(&self) -> rusqlite::Result<Vec<TagCount>> {
        // R2 — foreground read (the drawer polls this), route through the
        // read-only secondary connection so it never queues behind the
        // encoder pipeline's write batches.
        let conn = self.read_lock();
        let mut stmt = conn.prepare(
            "SELECT t.id AS tag_id, COUNT(vis.id) AS cnt
             FROM tags t
             LEFT JOIN images_tags it ON it.tag_id = t.id
             LEFT JOIN images vis ON vis.id = it.image_id
                 AND vis.orphaned = 0
                 AND (
                     vis.root_id IS NULL
                     OR vis.root_id IN (SELECT id FROM roots WHERE enabled = 1)
                 )
             GROUP BY t.id
             ORDER BY t.id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TagCount {
                tag_id: row.get("tag_id")?,
                count: row.get("cnt")?,
            })
        })?;
        rows.collect()
    }
}
