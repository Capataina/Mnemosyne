//! Code-health audit (L3 performance lane, seat A) — diagnostic
//! benchmarks + equivalence proofs for eliminated-waste findings on the
//! indexing pipeline's DB read path.
//!
//! Every test here is an EQUIVALENCE proof first (deterministic, must
//! stay green) and a benchmark second (timings printed to stderr, never
//! asserted, so the suite cannot flake on a loaded machine). Run with
//! `cargo test -p mnemosyne --test cha_l3_db_waste -- --nocapture` to
//! see the numbers. Scale is 20k rows to keep the suite fast; the
//! findings extrapolate linearly (all query plans involved are O(rows)
//! or O(joined rows)) to the 100k design target.
//!
//! Findings covered (see the audit return artefact for full context):
//!
//! 1. `indexing.rs` step 8 computes the Ready count via
//!    `get_all_images().map(|v| v.len())` — the whole-library
//!    LEFT JOIN unroll + HashMap aggregation + materialise + sort, run
//!    on EVERY pipeline pass (including steady-state watcher rescans),
//!    where `SELECT COUNT(*) FROM images` is byte-equivalent.
//! 2. `run_encoder_phase`'s aggregate_total precompute materialises the
//!    full `Vec<(ID, String)>` needs-set per encoder just to call
//!    `.len()`; a COUNT with the identical predicate is equivalent.
//! 3. `get_images_without_thumbnails` (the pipeline's needs-thumbnails
//!    read) LEFT JOINs and aggregates tags the pipeline never reads; a
//!    plain two-column SELECT with the same WHERE is set-equivalent.
//! 4. `get_preview_eligibility` runs one full `images` scan per bucket
//!    width; a single-pass SUM(CASE) scan returns identical counts.

use std::time::{Duration, Instant};

use mnemosyne::db::ImageDatabase;

const N_IMAGES: i64 = 20_000;
const N_TAGS_PER_IMAGE: i64 = 3;

/// Minimum wall time over `reps` runs — minimum, not mean, because the
/// minimum is the least-noisy estimator for a CPU-bound query on a
/// possibly-loaded machine.
fn time_min<R>(reps: usize, mut f: impl FnMut() -> R) -> (Duration, R) {
    let mut best = Duration::MAX;
    let mut out = None;
    for _ in 0..reps {
        let t = Instant::now();
        let r = f();
        best = best.min(t.elapsed());
        out = Some(r);
    }
    (best, out.unwrap())
}

/// One shared fixture: an on-disk DB (so the reader secondary opens,
/// matching production topology) with 20k images — half thumbnailed,
/// half not — 3 tags each, half CLIP-embedded, a width distribution for
/// the preview buckets, one orphaned row, and one disabled-root row.
/// Built through a second raw connection in one transaction so setup
/// stays under a second.
fn build_fixture(dir: &tempfile::TempDir) -> (ImageDatabase, String) {
    let db_path = dir
        .path()
        .join("cha_l3.db")
        .to_string_lossy()
        .into_owned();
    let db = ImageDatabase::new(&db_path).unwrap();
    db.initialize().unwrap();

    // Roots through the public API so bookkeeping is realistic.
    let enabled_root = db.add_root("/enabled".into(), None).unwrap();
    let disabled_root = db.add_root("/disabled".into(), None).unwrap();
    db.set_root_enabled(disabled_root.id, false).unwrap();

    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.pragma_update(None, "busy_timeout", 5000).unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    {
        let mut img = tx
            .prepare(
                "INSERT INTO images (path, root_id, thumbnail_path, width, height)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .unwrap();
        for i in 0..N_IMAGES {
            // Half the rows are thumbnailed with a realistic width
            // distribution; half are pre-thumbnail (NULL thumbnail_path,
            // NULL width) so the needs-thumbnails set is non-trivial.
            let (thumb, width): (Option<String>, Option<i64>) = if i % 2 == 0 {
                let w = match i % 8 {
                    0 => 700,
                    2 => 1200,
                    4 => 1600,
                    _ => 2400,
                };
                (Some(format!("/thumbs/img{i}.jpg")), Some(w))
            } else {
                (None, None)
            };
            img.execute(rusqlite::params![
                format!("/enabled/img{i:06}.jpg"),
                enabled_root.id,
                thumb,
                width,
                width.map(|w| w * 2 / 3),
            ])
            .unwrap();
        }
        // One orphaned row and one disabled-root row: the legacy
        // whole-library queries carry NO visibility filter, so both must
        // be counted by the proposed COUNT(*) replacement too — that is
        // part of the equivalence being proven.
        img.execute(rusqlite::params![
            "/enabled/orphan.jpg",
            enabled_root.id,
            Option::<String>::None,
            Option::<i64>::None,
            Option::<i64>::None,
        ])
        .unwrap();
        img.execute(rusqlite::params![
            "/disabled/hidden.jpg",
            disabled_root.id,
            Option::<String>::None,
            Option::<i64>::None,
            Option::<i64>::None,
        ])
        .unwrap();

        let mut tag = tx
            .prepare("INSERT INTO tags (name, color) VALUES (?1, '#fff')")
            .unwrap();
        for t in 0..N_TAGS_PER_IMAGE {
            tag.execute(rusqlite::params![format!("tag{t}")]).unwrap();
        }
        let mut link = tx
            .prepare("INSERT INTO images_tags (image_id, tag_id) VALUES (?1, ?2)")
            .unwrap();
        for i in 1..=N_IMAGES {
            for t in 1..=N_TAGS_PER_IMAGE {
                link.execute(rusqlite::params![i, t]).unwrap();
            }
        }

        // CLIP embeddings for the even half — the needs-encode set is the
        // odd half plus the two extra rows (minus the orphan, which the
        // needs query excludes).
        let blob: Vec<u8> = vec![0u8; 16]; // 4 f32s — size is irrelevant to the count
        let mut emb = tx
            .prepare(
                "INSERT INTO embeddings (image_id, encoder_id, embedding)
                 VALUES (?1, 'clip_vit_b_32', ?2)",
            )
            .unwrap();
        for i in (2..=N_IMAGES).step_by(2) {
            emb.execute(rusqlite::params![i, blob]).unwrap();
        }
    }
    tx.commit().unwrap();
    conn.execute(
        "UPDATE images SET orphaned = 1 WHERE path = '/enabled/orphan.jpg'",
        [],
    )
    .unwrap();

    (db, db_path)
}

// ── Finding 1: Ready count — full materialisation vs COUNT(*) ─────────

#[test]
fn ready_count_full_materialisation_equals_count_star() {
    let dir = tempfile::tempdir().unwrap();
    let (db, db_path) = build_fixture(&dir);
    let raw = rusqlite::Connection::open(&db_path).unwrap();

    // Equivalence. `get_all_images` carries no visibility filter and its
    // HashMap aggregation collapses the tag unroll back to one entry per
    // image id, so its length is exactly COUNT(*) FROM images — orphaned
    // and disabled-root rows included on both sides.
    let (t_full, materialised_len) =
        time_min(3, || db.get_all_images().unwrap().len());
    let (t_count, counted): (Duration, i64) = time_min(3, || {
        raw.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap()
    });
    assert_eq!(materialised_len as i64, counted);
    // The fixture pins the exact expected population so a silent setup
    // bug can't produce a vacuous 0 == 0 pass.
    assert_eq!(counted, N_IMAGES + 2);

    // `get_pipeline_stats().total_images` is the already-public COUNT(*)
    // the pipeline could use as a drop-in replacement.
    let (t_stats, stats) = time_min(3, || db.get_pipeline_stats().unwrap());
    assert_eq!(stats.total_images, counted);

    eprintln!(
        "[cha-F1] ready count at {} images x {} tags: \
         get_all_images().len() = {:?}, SELECT COUNT(*) = {:?}, \
         get_pipeline_stats() = {:?}",
        N_IMAGES + 2,
        N_TAGS_PER_IMAGE,
        t_full,
        t_count,
        t_stats
    );
}

// ── Finding 2: encode-needs precompute — materialise-then-len vs COUNT ─

#[test]
fn needs_encode_count_equals_materialised_len() {
    let dir = tempfile::tempdir().unwrap();
    let (db, db_path) = build_fixture(&dir);
    let raw = rusqlite::Connection::open(&db_path).unwrap();

    let (t_full, materialised_len) = time_min(3, || {
        db.get_images_without_embedding_for("clip_vit_b_32")
            .unwrap()
            .len()
    });
    // The proposed count uses the byte-identical predicate of
    // `get_images_without_embedding_for` (db/embeddings.rs) with the
    // SELECT list swapped for COUNT(*).
    let (t_count, counted): (Duration, i64) = time_min(3, || {
        raw.query_row(
            "SELECT COUNT(*)
             FROM images i
             WHERE i.orphaned = 0
             AND NOT EXISTS (
                 SELECT 1 FROM embeddings e
                 WHERE e.image_id = i.id AND e.encoder_id = ?1
             )",
            ["clip_vit_b_32"],
            |r| r.get(0),
        )
        .unwrap()
    });
    assert_eq!(materialised_len as i64, counted);
    // Odd half un-embedded (10k) + the disabled-root row; the orphan is
    // excluded by the predicate. Pinned so the equivalence isn't vacuous.
    assert_eq!(counted, N_IMAGES / 2 + 1);

    eprintln!(
        "[cha-F2] needs-encode at {} images ({} un-embedded): \
         materialise-then-len = {:?}, COUNT(*) same predicate = {:?}",
        N_IMAGES + 2,
        counted,
        t_full,
        t_count
    );
}

// ── Finding 3: needs-thumbnails — tags join+aggregate vs plain SELECT ─

#[test]
fn needs_thumbnails_plain_select_is_set_equivalent_to_join_query() {
    let dir = tempfile::tempdir().unwrap();
    let (db, db_path) = build_fixture(&dir);
    let raw = rusqlite::Connection::open(&db_path).unwrap();

    let (t_join, mut via_join): (Duration, Vec<(i64, String)>) =
        time_min(3, || {
            db.get_images_without_thumbnails()
                .unwrap()
                .into_iter()
                .map(|img| (img.id, img.path))
                .collect()
        });
    let (t_plain, mut via_plain): (Duration, Vec<(i64, String)>) =
        time_min(3, || {
            let mut stmt = raw
                .prepare(
                    "SELECT id, path FROM images
                     WHERE thumbnail_path IS NULL OR thumbnail_path = ''",
                )
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        });

    via_join.sort();
    via_plain.sort();
    assert_eq!(
        via_join, via_plain,
        "the plain two-column SELECT must return exactly the id/path set \
         of the join query — the pipeline consumes nothing else from it \
         (FeedDeltaRow.name is derived from path)"
    );
    // Odd half un-thumbnailed (10k) + orphan + disabled-root row.
    assert_eq!(via_join.len() as i64, N_IMAGES / 2 + 2);

    eprintln!(
        "[cha-F3] needs-thumbnails at {} rows needing thumbs, {} tags/image: \
         LEFT JOIN + HashMap aggregate = {:?}, plain SELECT id,path = {:?}",
        via_join.len(),
        N_TAGS_PER_IMAGE,
        t_join,
        t_plain
    );
}

// ── Finding 4: preview eligibility — per-bucket scans vs one pass ─────

#[test]
fn preview_eligibility_single_pass_matches_per_bucket_scans() {
    let dir = tempfile::tempdir().unwrap();
    let (db, db_path) = build_fixture(&dir);
    let raw = rusqlite::Connection::open(&db_path).unwrap();
    let buckets = [960u32, 1440, 2048];

    let (t_loop, per_bucket) =
        time_min(3, || db.get_preview_eligibility(&buckets).unwrap());
    // Proposed single pass: same predicate, one scan, one SUM(CASE) per
    // bucket. COALESCE pins the empty-table case to 0, matching COUNT.
    let (t_single, single_pass): (Duration, Vec<(u32, i64)>) =
        time_min(3, || {
            raw.query_row(
                "SELECT
                    COALESCE(SUM(CASE WHEN width > 960  THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN width > 1440 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN width > 2048 THEN 1 ELSE 0 END), 0)
                 FROM images
                 WHERE orphaned = 0 AND width IS NOT NULL",
                [],
                |r| {
                    Ok(vec![
                        (960u32, r.get::<_, i64>(0)?),
                        (1440u32, r.get::<_, i64>(1)?),
                        (2048u32, r.get::<_, i64>(2)?),
                    ])
                },
            )
            .unwrap()
        });
    assert_eq!(per_bucket, single_pass);
    // Sanity: the 1200/1600/2400 thirds of the thumbnailed half are
    // strictly wider than 960, so the 960 bucket must be non-zero — the
    // equivalence must not be a 0 == 0 tautology.
    assert!(per_bucket[0].1 > 0);

    // Empty-table edge: SUM over zero rows is NULL, COUNT is 0 — prove
    // the COALESCE closes that gap.
    let empty = ImageDatabase::new(
        &dir.path().join("empty.db").to_string_lossy(),
    )
    .unwrap();
    empty.initialize().unwrap();
    assert_eq!(
        empty.get_preview_eligibility(&buckets).unwrap(),
        vec![(960, 0), (1440, 0), (2048, 0)]
    );

    eprintln!(
        "[cha-F4] preview eligibility over {} rows: \
         3 per-bucket scans = {:?}, single SUM(CASE) pass = {:?}",
        N_IMAGES + 2,
        t_loop,
        t_single
    );
}
