//! Guards for the AUTOINCREMENT id contract established 2026-08-03.
//!
//! Ids are identity: thumbnail asset URLs embed `root_{id}` and
//! `thumb_{image_id}`, and the frontend keys its caches on image id. A
//! recycled id therefore resurrects a dead item's cached bytes — observed
//! live as a removed wallpapers root's thumbnails appearing on a freshly
//! added museum library (the webview served its HTTP cache for the
//! byte-identical URL; the disk files were correct). These tests pin the
//! two halves of the fix: fresh DBs hand out strictly increasing ids
//! across deletion, and old DBs are rebuilt to do the same with data
//! intact.

use mnemosyne::db::ImageDatabase;

/// Image ids observed through the public needs-set API (fresh images have
/// no thumbnails, so every row added here appears in it).
fn image_ids(db: &ImageDatabase) -> Vec<i64> {
    db.get_images_without_thumbnails()
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect()
}

#[test]
fn ids_are_never_recycled_after_root_removal() {
    let db = ImageDatabase::new(":memory:").unwrap();
    db.initialize().unwrap();

    let first_root = db.add_root("/tmp/idreuse/wallpapers".into(), None).unwrap();
    for i in 0..5 {
        db.add_image(format!("/tmp/idreuse/wallpapers/{i}.jpg"), Some(first_root.id))
            .unwrap();
    }
    let old_max = image_ids(&db).into_iter().max().unwrap();

    db.remove_root(first_root.id).unwrap();
    assert!(
        image_ids(&db).is_empty(),
        "cascade should have removed the first root's images"
    );

    let second_root = db.add_root("/tmp/idreuse/museum".into(), None).unwrap();
    assert!(
        second_root.id > first_root.id,
        "root id recycled: new root got {} after root {} was deleted",
        second_root.id,
        first_root.id
    );
    db.add_image("/tmp/idreuse/museum/monet.jpg".into(), Some(second_root.id))
        .unwrap();
    let new_id = image_ids(&db).into_iter().max().unwrap();
    assert!(
        new_id > old_max,
        "image id recycled: new image got {new_id}, old max was {old_max}"
    );
}

#[test]
fn old_schema_db_is_rebuilt_with_data_and_relations_intact() {
    let dir = std::env::temp_dir().join(format!("id_migration_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("old.db");
    let _ = std::fs::remove_file(&db_path);

    // Hand-build the pre-migration schema: plain INTEGER PRIMARY KEY
    // (rowid-recycling) tables, one root, two images, a tag relation —
    // the shape a real user DB had before this migration existed.
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE roots (
                 id INTEGER PRIMARY KEY,
                 path TEXT NOT NULL UNIQUE,
                 enabled INTEGER NOT NULL DEFAULT 1,
                 added_at INTEGER NOT NULL,
                 bookmark BLOB
             );
             CREATE TABLE images (
                 id INTEGER PRIMARY KEY,
                 path TEXT NOT NULL UNIQUE,
                 embedding BLOB,
                 thumbnail_path TEXT,
                 width INTEGER,
                 height INTEGER,
                 root_id INTEGER REFERENCES roots(id) ON DELETE CASCADE,
                 notes TEXT,
                 orphaned INTEGER NOT NULL DEFAULT 0,
                 manual_order INTEGER,
                 manual_col_span INTEGER,
                 content_hash BLOB,
                 size INTEGER
             );
             CREATE TABLE tags (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL UNIQUE,
                 color TEXT NOT NULL
             );
             CREATE TABLE images_tags (
                 image_id INTEGER NOT NULL,
                 tag_id INTEGER NOT NULL,
                 PRIMARY KEY (image_id, tag_id),
                 FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
                 FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
             );
             INSERT INTO roots (id, path, enabled, added_at) VALUES (1, '/old/root', 1, 0);
             INSERT INTO images (id, path, root_id, notes) VALUES
                 (1, '/old/root/a.jpg', 1, 'keep-me'),
                 (2, '/old/root/b.jpg', 1, NULL);
             INSERT INTO tags (id, name, color) VALUES (1, 'ref', '#fff');
             INSERT INTO images_tags (image_id, tag_id) VALUES (2, 1);",
        )
        .unwrap();
    }

    let db = ImageDatabase::new(db_path.to_str().unwrap()).unwrap();
    db.initialize().unwrap();

    // New ids must clear the seeded safety margins even though history is
    // unknowable — this is what makes historically-cached URLs unreachable.
    let new_root = db.add_root("/new/root".into(), None).unwrap();
    assert!(
        new_root.id > 1000,
        "root sequence not margin-seeded: next id was {}",
        new_root.id
    );
    db.add_image("/new/root/c.jpg".into(), Some(new_root.id))
        .unwrap();

    // Assert schema + preserved data through a sidecar read connection
    // (the engine API has no raw-SQL surface, deliberately).
    let side = rusqlite::Connection::open(&db_path).unwrap();
    for table in ["roots", "images"] {
        let sql: String = side
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            sql.to_uppercase().contains("AUTOINCREMENT"),
            "{table} not rebuilt: {sql}"
        );
    }
    let (notes, tag_count): (String, i64) = side
        .query_row(
            "SELECT i.notes, (SELECT COUNT(*) FROM images_tags it WHERE it.image_id = 2)
             FROM images i WHERE i.id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(notes, "keep-me");
    assert_eq!(tag_count, 1, "images_tags relation lost in rebuild");

    let new_image_id: i64 = side
        .query_row(
            "SELECT id FROM images WHERE path = '/new/root/c.jpg'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        new_image_id > 100_000,
        "image sequence not margin-seeded: next id was {new_image_id}"
    );

    drop(side);
    let _ = std::fs::remove_file(&db_path);
}
