//! Persistence for drag-to-reorder and drag-to-resize on the masonry
//! grid — `images.manual_order` and `images.manual_col_span` (added by
//! `schema_migrations::migrate_add_manual_order_columns`).
//!
//! `set_manual_order` takes the WHOLE currently-visible ordering and
//! rewrites every row's position as a fresh 0..N-1 sequence, rather
//! than trying to splice one moved item between fractional neighbours.
//! That sidesteps the classic fractional-indexing problem (float
//! precision exhaustion, renumbering races) at the cost of one UPDATE
//! per visible image per drag — fine at the sizes this grid runs at,
//! and it means a previously-untouched image (`manual_order` NULL)
//! joins the explicit sequence the first time ANY reorder happens,
//! rather than needing its own special-cased merge with the untouched
//! rows' implicit id-order position.

use rusqlite::params;

use super::{ID, ImageDatabase};

impl ImageDatabase {
    /// Rewrite `manual_order` for every id in `ordered_ids`, in the
    /// given order, as a single transaction. Ids not present in the
    /// list are left untouched.
    pub fn set_manual_order(&self, ordered_ids: &[ID]) -> rusqlite::Result<()> {
        let mut conn = self.connection.lock().unwrap();
        let tx = conn.transaction()?;
        for (position, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE images SET manual_order = ?1 WHERE id = ?2",
                params![position as i64, id],
            )?;
        }
        tx.commit()
    }

    /// Persist a single image's manual column span (drag-resize
    /// result). `None` clears it back to the default single-column
    /// width — the masonry packer falls back to 1 whenever this is
    /// NULL.
    pub fn set_manual_col_span(&self, id: ID, col_span: Option<i64>) -> rusqlite::Result<()> {
        let conn = self.connection.lock().unwrap();
        conn.execute(
            "UPDATE images SET manual_col_span = ?1 WHERE id = ?2",
            params![col_span, id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::fresh_db;

    #[test]
    fn set_manual_order_rewrites_positions_for_listed_ids() {
        let db = fresh_db();
        db.add_image("/a.jpg".into(), None).unwrap();
        db.add_image("/b.jpg".into(), None).unwrap();
        db.add_image("/c.jpg".into(), None).unwrap();
        let imgs = db.get_all_images().unwrap();
        let id_a = imgs.iter().find(|i| i.path.ends_with("a.jpg")).unwrap().id;
        let id_b = imgs.iter().find(|i| i.path.ends_with("b.jpg")).unwrap().id;
        let id_c = imgs.iter().find(|i| i.path.ends_with("c.jpg")).unwrap().id;

        // New order: c, a, b.
        db.set_manual_order(&[id_c, id_a, id_b]).unwrap();

        let with_thumbs = db
            .get_images_with_thumbnails(vec![], "".into(), false)
            .unwrap();
        let order_of = |id: i64| with_thumbs.iter().find(|i| i.id == id).unwrap().manual_order;
        assert_eq!(order_of(id_c), Some(0));
        assert_eq!(order_of(id_a), Some(1));
        assert_eq!(order_of(id_b), Some(2));
    }

    #[test]
    fn set_manual_col_span_persists_and_clears() {
        let db = fresh_db();
        db.add_image("/a.jpg".into(), None).unwrap();
        let id = db.get_all_images().unwrap()[0].id;

        db.set_manual_col_span(id, Some(2)).unwrap();
        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false)
            .unwrap();
        assert_eq!(imgs.iter().find(|i| i.id == id).unwrap().manual_col_span, Some(2));

        db.set_manual_col_span(id, None).unwrap();
        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false)
            .unwrap();
        assert_eq!(imgs.iter().find(|i| i.id == id).unwrap().manual_col_span, None);
    }

    #[test]
    fn untouched_images_keep_null_manual_order_and_span() {
        let db = fresh_db();
        db.add_image("/a.jpg".into(), None).unwrap();
        let imgs = db
            .get_images_with_thumbnails(vec![], "".into(), false)
            .unwrap();
        assert_eq!(imgs[0].manual_order, None);
        assert_eq!(imgs[0].manual_col_span, None);
    }
}
