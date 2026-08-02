//! Code-health-audit proof (2026-08 L2 structure lane, src-tauri).
//!
//! Finding CHA-TAURI-P2: `FusionIndexState::ranked_for_encoder` and
//! `FusionIndexState::with_encoder_index` (lib.rs) hand-roll the same
//! double-checked-locking populate — fast read-lock path, write-lock
//! map-or-populate, re-read — differing only in what runs against the
//! populated index. `ranked_for_encoder(db, enc, q, k, ex)` is
//! observationally equivalent to
//! `with_encoder_index(db, enc, |idx| idx.get_similar_images_sorted(q, k, ex))`,
//! so the former can be a one-line delegation to the latter and the
//! ~40 duplicated locking lines collapse.
//!
//! This test pins that equivalence against a real temp-file DB with
//! real embedding rows (no ONNX models needed): identical ranked ids,
//! identical scores, identical ordering, on both the cold-populate path
//! and the warm path, plus the empty-encoder degenerate case.
//!
//! Runs on every `cargo test` (no models, no network). Delete it if the
//! delegation lands and lib.rs no longer carries two copies.

use lynceus_lib::db::ImageDatabase;
use lynceus_lib::FusionIndexState;
use ndarray::Array1;

/// Distinct encoder id so a developer machine's persisted
/// `embstore_<enc>.bin` for a real encoder can never be picked up by
/// `load_store_if_valid` during this test.
const ENC: &str = "cha_equiv_test_encoder";

fn seeded_db(dir: &std::path::Path) -> (ImageDatabase, Vec<i64>) {
    let db_path = dir.join("cha_equiv.sqlite");
    let db = ImageDatabase::new(db_path.to_str().unwrap()).expect("db open");
    db.initialize().expect("db init");

    // A real enabled root so the populate query's visibility predicate
    // (non-orphaned images of enabled roots) admits the rows.
    let root = db
        .add_root(dir.to_string_lossy().into_owned(), None)
        .expect("add_root");

    for i in 0..8 {
        db.add_image(
            dir.join(format!("img_{i}.jpg")).to_string_lossy().into_owned(),
            Some(root.id),
        )
        .expect("add_image");
    }
    let images = db.get_all_images().expect("get_all_images");
    let ids: Vec<i64> = images.iter().map(|im| im.id).collect();
    assert_eq!(ids.len(), 8, "seed images must all be visible");

    // Deterministic, distinct, unit-norm-ish 4-d embeddings.
    let rows: Vec<(i64, Vec<f32>)> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let t = i as f32 * 0.7;
            (*id, vec![t.cos(), t.sin(), (t * 0.5).cos(), (t * 0.5).sin()])
        })
        .collect();
    db.upsert_embeddings_batch(ENC, &rows, false)
        .expect("upsert embeddings");
    (db, ids)
}

#[test]
fn ranked_for_encoder_equals_with_encoder_index_composition() {
    let dir = std::env::temp_dir().join(format!("cha_equiv_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (db, ids) = seeded_db(&dir);

    let query = Array1::from_vec(vec![1.0_f32, 0.0, 0.0, 0.0]);
    let top_k = 5usize;
    let exclude = Some(ids[0]);

    // Two INDEPENDENT states so each takes its own cold-populate path —
    // the duplicated slow path is exactly what the finding targets.
    let state_a = FusionIndexState::new();
    let state_b = FusionIndexState::new();

    let via_ranked = state_a
        .ranked_for_encoder(&db, ENC, &query, top_k, exclude)
        .expect("ranked_for_encoder");
    let via_wrapper = state_b
        .with_encoder_index(&db, ENC, |idx| {
            idx.get_similar_images_sorted(&query, top_k, exclude)
        })
        .expect("with_encoder_index");

    assert!(!via_ranked.is_empty(), "cold populate must yield results");
    assert_eq!(via_ranked, via_wrapper, "cold paths must rank identically");

    // Warm path (slot already populated) must agree too.
    let warm_ranked = state_a
        .ranked_for_encoder(&db, ENC, &query, top_k, exclude)
        .expect("warm ranked_for_encoder");
    let warm_wrapper = state_a
        .with_encoder_index(&db, ENC, |idx| {
            idx.get_similar_images_sorted(&query, top_k, exclude)
        })
        .expect("warm with_encoder_index");
    assert_eq!(via_ranked, warm_ranked, "warm path must match cold path");
    assert_eq!(warm_ranked, warm_wrapper);

    // Exclusion honoured identically.
    assert!(via_ranked.iter().all(|(id, _)| Some(*id) != exclude));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn both_paths_degrade_to_empty_for_unknown_encoder() {
    let dir = std::env::temp_dir().join(format!("cha_equiv_empty_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (db, _ids) = seeded_db(&dir);

    let query = Array1::from_vec(vec![1.0_f32, 0.0, 0.0, 0.0]);
    let state = FusionIndexState::new();

    let via_ranked = state
        .ranked_for_encoder(&db, "cha_no_such_encoder", &query, 5, None)
        .expect("ranked_for_encoder on empty encoder");
    let via_wrapper = state
        .with_encoder_index(&db, "cha_no_such_encoder", |idx| {
            idx.get_similar_images_sorted(&query, 5, None)
        })
        .expect("with_encoder_index on empty encoder");

    assert_eq!(via_ranked, Vec::new());
    assert_eq!(via_ranked, via_wrapper, "empty-encoder degenerate must agree");

    let _ = std::fs::remove_dir_all(&dir);
}
