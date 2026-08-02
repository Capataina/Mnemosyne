//! Code-health-audit proof (seat B) — finding: the thumbnail needs-set
//! query drags the whole tag join through the pipeline for rows whose
//! tags are never read.
//!
//! `get_images_without_thumbnails` (crates/engine/src/db/images_query.rs)
//! LEFT JOINs images_tags and tags, unrolls one row per (image × tag),
//! aggregates them back down in a HashMap and materialises full
//! `ImageData` values with `Vec<Tag>` attached. Its two callers —
//! `indexing.rs`'s thumbnail pass (base + eager previews) and
//! `thumbnail/generator.rs` — read only `id`, `path` and `name`
//! (`name` is derived from the path). The tuple-shaped no-join query the
//! sibling needs-sets already use (`get_images_without_embedding_for`,
//! `get_images_without_content_hash`) is the established cheaper shape.
//!
//! On a RE-index of an already-tagged library (the watcher path), every
//! image needing a re-thumbnail carries its ~3 tags through the unroll,
//! the HashMap, and the allocator for nothing.
//!
//! Proves: (1) membership equivalence — the (id, path) set of the current
//! query equals the no-join tuple query in mixed thumbnail states, with
//! tags attached; (2) the cost gap at scale (stderr; assertions are
//! equivalence-only).

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use mnemosyne::db::ImageDatabase;

fn file_db(dir: &tempfile::TempDir) -> (ImageDatabase, String) {
    let path = dir
        .path()
        .join("cha_b_thumb_needs.db")
        .to_string_lossy()
        .into_owned();
    let db = ImageDatabase::new(&path).unwrap();
    db.initialize().unwrap();
    (db, path)
}

/// The proposed tuple-shaped needs query — the exact WHERE of the
/// current implementation, no joins.
fn raw_needs(db_path: &str) -> BTreeSet<(i64, String)> {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, path FROM images
             WHERE thumbnail_path IS NULL OR thumbnail_path = ''",
        )
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<BTreeSet<(i64, String)>>>()
        .unwrap()
}

fn time_min<R>(iters: usize, mut f: impl FnMut() -> R) -> (R, Duration) {
    let mut best: Option<Duration> = None;
    let mut out = None;
    for _ in 0..iters {
        let t = Instant::now();
        let r = f();
        let d = t.elapsed();
        if best.map(|b| d < b).unwrap_or(true) {
            best = Some(d);
        }
        out = Some(r);
    }
    (out.unwrap(), best.unwrap())
}

fn tag_all_images(db_path: &str, tags: usize) {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.execute_batch("BEGIN IMMEDIATE;").unwrap();
    for t in 0..tags {
        conn.execute(
            "INSERT INTO tags (name, color) VALUES (?1, '#abc')",
            [format!("t{t}")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images_tags (image_id, tag_id) SELECT id, ?1 FROM images",
            [t as i64 + 1],
        )
        .unwrap();
    }
    conn.execute_batch("COMMIT;").unwrap();
}

#[test]
fn thumbnail_needs_membership_matches_no_join_tuple_query() {
    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(&dir);
    let root = db.add_root("/r".into(), None).unwrap();

    db.add_images_batch(&[
        ("/r/needs_null.jpg".to_string(), Some(root.id)),
        ("/r/needs_empty.jpg".to_string(), Some(root.id)),
        ("/r/has_thumb.jpg".to_string(), Some(root.id)),
    ])
    .unwrap();
    tag_all_images(&path, 2); // tags on every row, to exercise the join

    // One row gets a real thumbnail, one an explicit empty string.
    let done = db.get_image_id_by_path("/r/has_thumb.jpg").unwrap();
    db.update_image_thumbnail(done, std::path::Path::new("/t/1.jpg"), 100, 80)
        .unwrap();
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "UPDATE images SET thumbnail_path = '' WHERE path = '/r/needs_empty.jpg'",
            [],
        )
        .unwrap();
    }

    let current: BTreeSet<(i64, String)> = db
        .get_images_without_thumbnails()
        .unwrap()
        .into_iter()
        .map(|img| (img.id, img.path))
        .collect();
    let proposed = raw_needs(&path);

    assert_eq!(
        current, proposed,
        "no-join tuple query must select exactly the same (id, path) set"
    );
    assert_eq!(current.len(), 2, "NULL and '' both need thumbnails; the real one doesn't");
}

#[test]
fn thumbnail_needs_cost_joined_vs_tuple_at_scale() {
    const N: usize = 8_000;
    const TAGS: usize = 3;

    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(&dir);
    let root = db.add_root("/lib".into(), None).unwrap();
    let batch: Vec<(String, Option<i64>)> = (0..N)
        .map(|i| (format!("/lib/img_{i:06}.jpg"), Some(root.id)))
        .collect();
    db.add_images_batch(&batch).unwrap();
    tag_all_images(&path, TAGS);

    let (set_a, t_joined) = time_min(3, || {
        db.get_images_without_thumbnails()
            .unwrap()
            .into_iter()
            .map(|img| (img.id, img.path))
            .collect::<BTreeSet<_>>()
    });
    let (set_b, t_tuple) = time_min(3, || raw_needs(&path));

    assert_eq!(set_a, set_b);
    assert_eq!(set_a.len(), N);

    let ratio = t_joined.as_secs_f64() / t_tuple.as_secs_f64().max(1e-9);
    eprintln!(
        "[cha_b_thumbnail_needs] N={N} tags/image={TAGS}: joined ImageData query = \
         {t_joined:?}, tuple no-join query = {t_tuple:?}, ratio = {ratio:.1}x \
         (note: tuple side includes BTreeSet build, same as joined side)"
    );
}
