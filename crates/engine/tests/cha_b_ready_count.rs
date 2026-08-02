//! Code-health-audit proof (seat B) — finding: the pipeline's Ready-phase
//! image count is computed by materialising the whole library.
//!
//! `apps/lynceus/src-tauri/src/indexing.rs` step 8 runs
//! `database.get_all_images().map(|v| v.len())` purely to put a number in
//! the `Phase::Ready` message. `get_all_images` routes through
//! `get_images(vec![], "")`, whose no-filter branch is the full
//! images × images_tags × tags LEFT JOIN unroll, aggregated back down in
//! a HashMap, materialised into `ImageData` (one heap path + one `Vec<Tag>`
//! per image) and sorted — all discarded except `.len()`.
//!
//! This suite proves the two halves of the finding:
//!   1. EQUIVALENCE — `get_all_images().len()` equals a bare
//!      `SELECT COUNT(*) FROM images` in every visibility state
//!      (plain, orphaned rows present, disabled roots present), because
//!      the no-filter branch of `get_images` carries no WHERE clause and
//!      `img_id` is the PK, so distinct-aggregation count == row count.
//!   2. COST — at a scale a real library reaches, the join+aggregate path
//!      is orders of magnitude slower than COUNT(*). Timings print to
//!      stderr (run with `--nocapture`); the assertion is on equivalence
//!      only, never on wall time, so the test cannot flake on a busy CI.

use std::time::{Duration, Instant};

use mnemosyne::db::ImageDatabase;

/// File-backed fixture DB — a real file so a sibling raw connection can
/// run the comparison SQL against the same data.
fn file_db(dir: &tempfile::TempDir) -> (ImageDatabase, String) {
    let path = dir
        .path()
        .join("cha_b_ready_count.db")
        .to_string_lossy()
        .into_owned();
    let db = ImageDatabase::new(&path).unwrap();
    db.initialize().unwrap();
    (db, path)
}

fn raw_count(db_path: &str) -> i64 {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
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

#[test]
fn ready_count_equals_bare_count_star_in_every_visibility_state() {
    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(&dir);

    let enabled = db.add_root("/enabled".into(), None).unwrap();
    let disabled = db.add_root("/disabled".into(), None).unwrap();

    // Rows across states: alive-enabled, alive-disabled-root, legacy
    // NULL-root, and an orphaned row.
    let batch: Vec<(String, Option<i64>)> = vec![
        ("/enabled/a.jpg".into(), Some(enabled.id)),
        ("/enabled/b.jpg".into(), Some(enabled.id)),
        ("/disabled/c.jpg".into(), Some(disabled.id)),
        ("/legacy/d.jpg".into(), None),
    ];
    db.add_images_batch(&batch).unwrap();
    db.set_root_enabled(disabled.id, false).unwrap();
    // Orphan one of the enabled root's rows (only a.jpg stays alive).
    db.mark_orphaned(enabled.id, &["/enabled/a.jpg".to_string()])
        .unwrap();

    // The current Ready-count implementation counts EVERYTHING —
    // get_images's no-filter branch has no visibility WHERE — so the
    // equivalent cheap query is a bare COUNT(*), not the grid predicate.
    let via_materialise = db.get_all_images().unwrap().len() as i64;
    let via_count = raw_count(&path);
    assert_eq!(
        via_materialise, via_count,
        "get_all_images().len() must equal SELECT COUNT(*) FROM images"
    );
    assert_eq!(via_count, 4, "fixture sanity: all four rows counted");
}

#[test]
fn ready_count_cost_materialise_vs_count_star_at_scale() {
    const N_IMAGES: usize = 8_000;
    const TAGS_PER_IMAGE: usize = 3;

    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(&dir);
    let root = db.add_root("/lib".into(), None).unwrap();

    let batch: Vec<(String, Option<i64>)> = (0..N_IMAGES)
        .map(|i| {
            (
                format!("/lib/subfolder/photo_export_{i:06}.jpg"),
                Some(root.id),
            )
        })
        .collect();
    db.add_images_batch(&batch).unwrap();

    // Tag fixture written through a sibling connection in one
    // transaction — fixture setup only, not part of the measurement.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("BEGIN IMMEDIATE;").unwrap();
        for t in 0..TAGS_PER_IMAGE {
            conn.execute(
                "INSERT INTO tags (name, color) VALUES (?1, '#fff')",
                [format!("tag{t}")],
            )
            .unwrap();
        }
        let mut link = conn
            .prepare("INSERT INTO images_tags (image_id, tag_id) SELECT id, ?1 FROM images")
            .unwrap();
        for t in 0..TAGS_PER_IMAGE {
            link.execute([t as i64 + 1]).unwrap();
        }
        drop(link);
        conn.execute_batch("COMMIT;").unwrap();
    }

    // Warm both paths once, then take the best of 3.
    let (len_a, t_materialise) = time_min(3, || db.get_all_images().unwrap().len());
    let (len_b, t_count) = time_min(3, || raw_count(&path) as usize);

    assert_eq!(
        len_a, len_b,
        "materialised length and COUNT(*) must agree at scale"
    );
    assert_eq!(len_a, N_IMAGES);

    let ratio = t_materialise.as_secs_f64() / t_count.as_secs_f64().max(1e-9);
    eprintln!(
        "[cha_b_ready_count] N={N_IMAGES} tags/image={TAGS_PER_IMAGE}: \
         get_all_images().len() = {:?}, SELECT COUNT(*) = {:?}, ratio = {ratio:.0}x \
         (joined rows unrolled: {})",
        t_materialise,
        t_count,
        N_IMAGES * TAGS_PER_IMAGE
    );
}
