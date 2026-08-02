//! CHA resolver proof — C4: single-copy BLOB extraction in
//! `get_all_embeddings_for` (db/embeddings.rs:290-308).
//!
//! Current shape: each row extracts `Vec<u8>` (allocation + copy out of
//! SQLite's record buffer) and then `cast_slice(..).to_vec()` (second
//! allocation + copy into the `Vec<f32>`). Candidate: `row.get_ref(2)`
//! borrows the SQLite-owned bytes for the duration of the row callback,
//! and one `bytemuck::pod_collect_to_vec` copies them straight into the
//! `Vec<f32>` — half the copy volume, one allocation per row instead of
//! two.
//!
//! Two proof obligations from the brief:
//!  1. The borrow forces no behavioural change — Ok output identical on
//!     real data (including the empty-BLOB and malformed-length rows the
//!     current loop special-cases), and the error path on a type
//!     mismatch identical (same `rusqlite::Error` variant, index, column
//!     name, and detected type — asserted on Debug equality against the
//!     production error).
//!  2. The win is measured (min-of-3, `--release --test-threads=1`).
//!
//! Alignment note (load-bearing for the fix shape): production casts
//! from a `Vec<u8>`, whose heap allocation happens to be ≥4-aligned; a
//! borrowed `sqlite3_column_blob` pointer offsets into SQLite's record
//! buffer with NO alignment guarantee, so the single-copy form must copy
//! via the (always-aligned) destination — allocate the `Vec<f32>` and
//! `copy_from_slice` into its byte view — never
//! `cast_slice::<u8, f32>(bytes).to_vec()`, which panics on a misaligned
//! borrow. Same bytes, same output, no panic surface.
//!
//! Setup uses the engine's own schema (`ImageDatabase::new` +
//! `initialize`), rows inserted through the public API; the replica runs
//! the EXACT production SQL over a second plain rusqlite connection to
//! the same file (WAL allows this), so the only variable is the
//! extraction shape.

use mnemosyne::db::ImageDatabase;
use std::time::Instant;

const ENC: &str = "clip_vit_b_32";

#[cfg(debug_assertions)]
const N_ROWS: usize = 500; // keep the default (debug) suite fast
#[cfg(not(debug_assertions))]
const N_ROWS: usize = 10_000;
const DIM: usize = 512;

/// The exact production SQL (db/embeddings.rs:280-289).
const PROD_SQL: &str = "SELECT i.id, i.path, e.embedding
             FROM embeddings e
             JOIN images i ON i.id = e.image_id
             WHERE e.encoder_id = ?1
               AND i.orphaned = 0
               AND (
                   i.root_id IS NULL
                   OR i.root_id IN (SELECT id FROM roots WHERE enabled = 1)
               )";

fn min_of_3_ms<F: FnMut()>(mut f: F) -> f64 {
    (0..3)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .fold(f64::INFINITY, f64::min)
}

/// Engine DB at a real file path (the read-only secondary and a replica
/// connection both need a shared file; `:memory:` is per-connection).
fn file_db(dir: &std::path::Path) -> (ImageDatabase, String) {
    let path = dir.join("cha_res_ret.db");
    let path_str = path.to_str().unwrap().to_string();
    let db = ImageDatabase::new(&path_str).expect("open engine db");
    db.initialize().expect("initialize schema");
    (db, path_str)
}

fn seed(db: &ImageDatabase, rows: usize, dim: usize) -> Vec<i64> {
    let mut ids = Vec::with_capacity(rows);
    for r in 0..rows {
        let p = format!("/lib/img_{r:06}.jpg");
        db.add_image(p.clone(), None).unwrap();
        ids.push(db.get_image_id_by_path(&p).unwrap());
    }
    // Deterministic non-trivial embeddings, batched for setup speed.
    for chunk in ids.chunks(1000).collect::<Vec<_>>().iter().enumerate() {
        let (ci, chunk) = chunk;
        let batch: Vec<(i64, Vec<f32>)> = chunk
            .iter()
            .enumerate()
            .map(|(i, &id)| {
                let base = (ci * 1000 + i) as f32;
                (id, (0..dim).map(|d| (base * 0.001 + d as f32 * 0.017).sin()).collect())
            })
            .collect();
        db.upsert_embeddings_batch(ENC, &batch, false).unwrap();
    }
    ids
}

/// Replica A — the CURRENT extraction shape, verbatim: `Vec<u8>` out of
/// the row, then `cast_slice(..).to_vec()`. Control: must equal the
/// production function's output AND its timing class.
fn fetch_double_copy(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<Vec<(i64, String, Vec<f32>)>> {
    let mut stmt = conn.prepare(PROD_SQL)?;
    let rows = stmt.query_map(rusqlite::params![ENC], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Vec<u8>>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, path, bytes) = row?;
        if bytes.len() % 4 != 0 {
            continue;
        }
        let embedding: Vec<f32> = bytemuck::cast_slice::<u8, f32>(&bytes).to_vec();
        out.push((id, path, embedding));
    }
    Ok(out)
}

/// Replica B — the CANDIDATE: borrow the blob via `get_ref`, one
/// alignment-free copy straight into the `Vec<f32>`. The malformed-length
/// skip moves inside the closure as an Option (a closure cannot
/// `continue`), preserving skip semantics exactly.
fn fetch_single_copy(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<Vec<(i64, String, Vec<f32>)>> {
    let mut stmt = conn.prepare(PROD_SQL)?;
    let rows = stmt.query_map(rusqlite::params![ENC], |row| {
        let id: i64 = row.get(0)?;
        let path: String = row.get(1)?;
        let vr = row.get_ref(2)?;
        let bytes = vr.as_blob().map_err(|_| {
            // Reproduce EXACTLY what `row.get::<_, Vec<u8>>` produces on a
            // type mismatch: InvalidColumnType(index, column name, actual
            // type). Asserted against the production error below.
            rusqlite::Error::InvalidColumnType(2, "embedding".into(), vr.data_type())
        })?;
        let emb = if bytes.len() % 4 == 0 {
            // One memcpy into a fresh Vec<f32>, correct for ANY source
            // alignment: the DESTINATION Vec<f32> is always 4-aligned, so
            // viewing it as bytes (`cast_slice_mut::<f32, u8>`) is
            // infallible, while casting the borrowed SQLite record-buffer
            // pointer to f32 (`cast_slice::<u8, f32>`) could panic —
            // sqlite guarantees no alignment. (`pod_collect_to_vec` would
            // read the same but needs bytemuck's `extern_crate_alloc`
            // feature, which the engine doesn't enable.)
            let mut v = vec![0f32; bytes.len() / 4];
            bytemuck::cast_slice_mut::<f32, u8>(&mut v).copy_from_slice(bytes);
            Some(v)
        } else {
            None // malformed row: skipped, same as the current loop
        };
        Ok((id, path, emb))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, path, emb) = row?;
        if let Some(embedding) = emb {
            out.push((id, path, embedding));
        }
    }
    Ok(out)
}

/// Ok-path equivalence over real data, including the malformed-length
/// row the current loop special-cases (11-byte BLOB, len % 4 != 0 →
/// silently skipped). The empty-BLOB input is deliberately NOT in this
/// corpus — the current production code panics on it (see the dedicated
/// test below), so there is no Ok output to be identical to.
#[test]
fn single_copy_output_is_identical() {
    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(dir.path());
    let ids = seed(&db, 64, 16);

    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute(
        "UPDATE embeddings SET embedding = X'0102030405060708090A0B'
         WHERE image_id = ?1 AND encoder_id = ?2",
        rusqlite::params![ids[1], ENC], // 11 bytes → malformed, skipped
    )
    .unwrap();

    let prod = db.get_all_embeddings_for(ENC).unwrap();
    let double = fetch_double_copy(&raw).unwrap();
    let single = fetch_single_copy(&raw).unwrap();

    assert_eq!(prod, double, "double-copy replica must anchor to production");
    assert_eq!(prod, single, "single-copy candidate must equal production");
    // The malformed row really was exercised and skipped.
    assert!(!prod.iter().any(|(id, _, _)| *id == ids[1]));
    assert_eq!(prod.len(), 63);
}

/// Error-path equivalence on a type mismatch: a TEXT value in the
/// embedding column must produce the SAME error from the candidate as
/// from the production function — variant, column index, column name,
/// detected type (compared on Debug output, which encodes all four).
///
/// NULL is NOT tested because it is unreachable: the embeddings table
/// carries a NOT NULL constraint on the column — a poison attempt fails
/// with SQLITE_CONSTRAINT_NOTNULL (extended code 1299), asserted below
/// so the unreachability claim is itself pinned.
#[test]
fn single_copy_error_path_is_identical() {
    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(dir.path());
    let ids = seed(&db, 3, 8);
    let raw = rusqlite::Connection::open(&path).unwrap();

    // NULL unreachability pin.
    let null_err = raw
        .execute(
            "UPDATE embeddings SET embedding = NULL WHERE image_id = ?1",
            rusqlite::params![ids[1]],
        )
        .expect_err("schema must forbid NULL embeddings");
    assert!(
        format!("{null_err:?}").contains("1299"),
        "expected SQLITE_CONSTRAINT_NOTNULL, got {null_err:?}"
    );

    // TEXT mismatch: reachable in principle (SQLite BLOB affinity does
    // not coerce), must error identically in both shapes.
    raw.execute(
        "UPDATE embeddings SET embedding = 'not-a-blob' WHERE image_id = ?1",
        rusqlite::params![ids[1]],
    )
    .unwrap();

    let prod_err = db
        .get_all_embeddings_for(ENC)
        .expect_err("production must error on a type-mismatched row");
    let single_err = fetch_single_copy(&raw)
        .expect_err("candidate must error on a type-mismatched row");
    assert_eq!(
        format!("{prod_err:?}"),
        format!("{single_err:?}"),
        "TEXT mismatch: error must be identical (variant, index, name, type)"
    );
}

/// Knowledge finding surfaced by this resolution, pinned so it stays
/// true: the CURRENT extraction shape PANICS on an empty BLOB.
/// `rusqlite` returns an empty `Vec<u8>` whose dangling pointer is
/// 1-aligned, and `bytemuck::cast_slice::<u8, f32>` checks pointer
/// alignment even for length 0 → `TargetAlignmentGreaterAndInputNotAligned`.
/// Unreachable through the product's encoders (fixed-dim outputs, never
/// empty) but reachable through the public `upsert_embedding` API. The
/// single-copy candidate handles the same input cleanly (its copy goes
/// through the always-aligned destination), returning the row with an
/// empty vector — a strict improvement, recorded here as the one
/// deliberate behaviour delta, on an input the product cannot produce.
#[test]
fn empty_blob_panics_in_current_shape_but_not_in_candidate() {
    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(dir.path());
    let ids = seed(&db, 2, 8);
    db.upsert_embedding(ids[0], ENC, &[]).unwrap(); // empty BLOB
    let raw = rusqlite::Connection::open(&path).unwrap();

    // Current shape (replica of the production extraction): panics.
    let current =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| fetch_double_copy(&raw)));
    assert!(
        current.is_err(),
        "the current cast_slice shape must panic on an empty BLOB"
    );
    // Candidate: same input, clean result including the empty row.
    let single = fetch_single_copy(&raw).unwrap();
    assert!(single.iter().any(|(id, _, e)| *id == ids[0] && e.is_empty()));
    assert_eq!(single.len(), 2);
}

/// The settling benchmark: production vs double-copy control vs
/// single-copy candidate, same DB file, same SQL, min-of-3 after warmup.
#[test]
fn single_copy_bench() {
    let dir = tempfile::tempdir().unwrap();
    let (db, path) = file_db(dir.path());
    seed(&db, N_ROWS, DIM);
    let raw = rusqlite::Connection::open(&path).unwrap();

    // Warm the page cache / statement paths once.
    let expect = db.get_all_embeddings_for(ENC).unwrap();
    assert_eq!(expect.len(), N_ROWS);
    assert_eq!(fetch_single_copy(&raw).unwrap(), expect);

    let prod_ms = min_of_3_ms(|| {
        std::hint::black_box(db.get_all_embeddings_for(ENC).unwrap());
    });
    let double_ms = min_of_3_ms(|| {
        std::hint::black_box(fetch_double_copy(&raw).unwrap());
    });
    let single_ms = min_of_3_ms(|| {
        std::hint::black_box(fetch_single_copy(&raw).unwrap());
    });

    let mb = (N_ROWS * DIM * 4) as f64 / 1e6;
    println!("=== cha_res_ret C4: BLOB extraction ({N_ROWS} rows x {DIM}d, {mb:.0} MB of embeddings) ===");
    println!("production (Vec<u8> + cast.to_vec, 2 copies): {prod_ms:.2} ms");
    println!("replica double-copy control (same shape):     {double_ms:.2} ms");
    println!("get_ref single-copy candidate:                {single_ms:.2} ms ({:+.0}% vs production)", 100.0 * (single_ms - prod_ms) / prod_ms);
    println!("redundant copy volume eliminated: {mb:.0} MB per populate per encoder at this scale");
}
