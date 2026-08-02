//! Code-health-audit proof (seat B) — finding: the encoder phase's
//! aggregate-progress denominator materialises every needs-row to count it.
//!
//! `apps/lynceus/src-tauri/src/indexing.rs::run_encoder_phase` computes
//! `aggregate_total` by calling `get_images_without_embedding_for(id)`
//! per enabled encoder and taking `.len()` — materialising a
//! `Vec<(ID, String)>` with one heap-allocated path per row, immediately
//! discarded. On a fresh 100k index with 3 encoders that is ~300k path
//! allocations for three integers, and the same three queries run AGAIN
//! moments later inside each encoder thread to drive the actual loop.
//!
//! The equivalent cheap form is
//! `SELECT COUNT(*) FROM images i WHERE i.orphaned = 0 AND NOT EXISTS
//!  (SELECT 1 FROM embeddings e WHERE e.image_id = i.id AND
//!   e.encoder_id = ?1)` — the same predicate, no materialisation.
//!
//! Proves: (1) equivalence of the count across embedded / partially
//! embedded / orphaned states; (2) the cost gap at scale (stderr,
//! `--nocapture`; assertions are equivalence-only).

use std::time::{Duration, Instant};

use mnemosyne::db::ImageDatabase;

fn file_db(dir: &tempfile::TempDir) -> (ImageDatabase, String) {
    let path = dir
        .path()
        .join("cha_b_needs_count.db")
        .to_string_lossy()
        .into_owned();
    let db = ImageDatabase::new(&path).unwrap();
    db.initialize().unwrap();
    (db, path)
}

fn raw_needs_count(db_path: &str, encoder_id: &str) -> i64 {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.query_row(
        "SELECT COUNT(*) FROM images i
         WHERE i.orphaned = 0
         AND NOT EXISTS (
             SELECT 1 FROM embeddings e
             WHERE e.image_id = i.id AND e.encoder_id = ?1
         )",
        [encoder_id],
        |r| r.get(0),
    )
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
fn needs_count_equals_materialised_len_across_states() {
    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(&dir);
    let root = db.add_root("/r".into(), None).unwrap();

    db.add_images_batch(&[
        ("/r/embedded.jpg".to_string(), Some(root.id)),
        ("/r/pending_a.jpg".to_string(), Some(root.id)),
        ("/r/pending_b.jpg".to_string(), Some(root.id)),
        ("/r/gone.jpg".to_string(), Some(root.id)),
    ])
    .unwrap();

    // One row embedded for clip, none for siglip2; one row orphaned.
    let embedded = db.get_image_id_by_path("/r/embedded.jpg").unwrap();
    db.upsert_embedding(embedded, "clip_vit_b_32", &[1.0, 0.0])
        .unwrap();
    db.mark_orphaned(
        root.id,
        &[
            "/r/embedded.jpg".to_string(),
            "/r/pending_a.jpg".to_string(),
            "/r/pending_b.jpg".to_string(),
        ],
    )
    .unwrap();

    for encoder in ["clip_vit_b_32", "siglip2_base", "dinov2_base"] {
        let via_len = db
            .get_images_without_embedding_for(encoder)
            .unwrap()
            .len() as i64;
        let via_count = raw_needs_count(&path, encoder);
        assert_eq!(
            via_len, via_count,
            "COUNT(*) form must equal materialised len for {encoder}"
        );
    }
    // Spot-check the fixture semantics: clip has 2 pending (embedded and
    // orphaned rows excluded), siglip2 has 3 (only the orphan excluded).
    assert_eq!(raw_needs_count(&path, "clip_vit_b_32"), 2);
    assert_eq!(raw_needs_count(&path, "siglip2_base"), 3);
}

#[test]
fn needs_count_cost_materialise_vs_count_at_scale() {
    const N: usize = 10_000;

    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(&dir);
    let root = db.add_root("/lib".into(), None).unwrap();
    let batch: Vec<(String, Option<i64>)> = (0..N)
        .map(|i| {
            (
                format!("/lib/deep/nested/export/img_{i:06}.jpg"),
                Some(root.id),
            )
        })
        .collect();
    db.add_images_batch(&batch).unwrap();

    let (len_a, t_materialise) = time_min(3, || {
        db.get_images_without_embedding_for("clip_vit_b_32")
            .unwrap()
            .len()
    });
    let (len_b, t_count) = time_min(3, || raw_needs_count(&path, "clip_vit_b_32") as usize);

    assert_eq!(len_a, len_b);
    assert_eq!(len_a, N);

    let ratio = t_materialise.as_secs_f64() / t_count.as_secs_f64().max(1e-9);
    eprintln!(
        "[cha_b_needs_count] N={N}: materialise+len = {t_materialise:?}, \
         COUNT(*) = {t_count:?}, ratio = {ratio:.1}x"
    );
}
