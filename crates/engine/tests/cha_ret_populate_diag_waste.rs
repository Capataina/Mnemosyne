//! CHA retrieval-path diagnostic benchmark: what does a populate actually
//! spend its time on?
//!
//! Two measurements, both against `populate_from_db_for_encoder` — the call
//! that runs under the fusion write lock at Phase::Ready (the documented
//! ~0.5-1 s window at 100k):
//!
//! 1. **Eager diagnostics cost.** `populate_from_db_for_encoder` passes
//!    `diagnostics::embedding_stats(..)` / `pairwise_distance_distribution(..)`
//!    / `self_similarity_check(..)` as *arguments* to
//!    `perf::record_diagnostic`, so they are computed before the profiling
//!    gate can discard them — every populate pays three full passes over the
//!    store (norms + NaN scan, per-dim means, per-dim vars) even when
//!    profiling is off. This test times the diagnostics alone against the
//!    whole populate, giving the share of the write-lock window that is
//!    provably discardable when `perf::is_profiling_enabled()` is false.
//!
//! 2. **Discarded path column cost.** `get_all_embeddings_for` SELECTs and
//!    allocates `i.path` for every row; the populate loop destructures it as
//!    `(id, _path, embedding)` and drops it (index.rs). Comparing the same
//!    fetch over short vs long paths bounds the per-populate cost of
//!    extracting a column nobody reads.
//!
//! These are measurements, not pass/fail thresholds: the assertions pin only
//! functional equivalence (row counts, ids, dims match across variants), so
//! the test stays green on any machine. Numbers print with `--nocapture`.

use mnemosyne::cosine::{diagnostics, CosineIndex};
use mnemosyne::db::ImageDatabase;
use std::time::Instant;

const N: usize = 10_000;
const DIM: usize = 512;
const ENC: &str = "clip_vit_b_32";

/// Deterministic non-degenerate embedding, no RNG-crate dependency.
fn emb(i: usize) -> Vec<f32> {
    (0..DIM)
        .map(|j| ((((i * 31 + j * 7) % 13) as f32) - 6.0) * 0.1 + 0.01)
        .collect()
}

/// Seed an in-memory DB with N images (path length controlled by `prefix`)
/// and one embedding per image for ENC. In-memory keeps the seeding fast and
/// the read path identical in shape (reads fall back to the writer for
/// `:memory:`, as documented in db/CLAUDE.md).
fn seed_db(prefix: &str) -> ImageDatabase {
    let db = ImageDatabase::new(":memory:").unwrap();
    db.initialize().unwrap();
    let mut batch: Vec<(i64, Vec<f32>)> = Vec::with_capacity(N);
    for i in 0..N {
        let path = format!("{prefix}/img_{i}.jpg");
        db.add_image(path.clone(), None).unwrap();
        let id = db.get_image_id_by_path(&path).unwrap();
        batch.push((id, emb(i)));
    }
    db.upsert_embeddings_batch(ENC, &batch, false).unwrap();
    db
}

fn median_ms<F: FnMut()>(reps: usize, mut f: F) -> f64 {
    let mut times: Vec<f64> = (0..reps)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    times[times.len() / 2]
}

#[test]
fn populate_cost_breakdown_diagnostics_share_and_path_column() {
    // --- seed two DBs differing only in path length -------------------
    let short_db = seed_db("/a"); // ~14-char paths
    let long_prefix = format!("/Users/someone/{}", "very_long_directory_name/".repeat(6));
    let long_db = seed_db(&long_prefix); // ~170-char paths

    // Functional equivalence across the variants: identical row counts,
    // identical embedding payload shape — path length is the only delta.
    let rows_short = short_db.get_all_embeddings_for(ENC).unwrap();
    let rows_long = long_db.get_all_embeddings_for(ENC).unwrap();
    assert_eq!(rows_short.len(), N);
    assert_eq!(rows_long.len(), N);
    assert_eq!(rows_short[0].2.len(), DIM);
    assert_eq!(rows_long[0].2.len(), DIM);
    let ids_short: Vec<i64> = rows_short.iter().map(|r| r.0).collect();
    let ids_long: Vec<i64> = rows_long.iter().map(|r| r.0).collect();
    assert_eq!(ids_short, ids_long, "path length must not change the row set");
    drop(rows_short);
    drop(rows_long);

    // --- measurement 1: full populate (fetch + push + eager diagnostics)
    let mut idx = CosineIndex::new();
    let populate_ms = median_ms(5, || {
        idx.populate_from_db_for_encoder(&short_db, ENC);
    });
    assert_eq!(idx.cached_images.len(), N);

    // --- measurement 2: the three diagnostics alone, on the same store
    let store = &idx.cached_images;
    let stats_ms = median_ms(5, || {
        let v = diagnostics::embedding_stats(store);
        assert_eq!(v["count"], N);
    });
    let pairwise_ms = median_ms(5, || {
        let v = diagnostics::pairwise_distance_distribution(store);
        assert!(v["pair_count"].as_u64().unwrap() > 0);
    });
    let selfsim_ms = median_ms(5, || {
        let v = diagnostics::self_similarity_check(store);
        assert_eq!(v["passes"], true);
    });
    let diag_ms = stats_ms + pairwise_ms + selfsim_ms;

    // --- measurement 3: the DB fetch alone, short vs long paths ---------
    let fetch_short_ms = median_ms(5, || {
        let r = short_db.get_all_embeddings_for(ENC).unwrap();
        assert_eq!(r.len(), N);
    });
    let fetch_long_ms = median_ms(5, || {
        let r = long_db.get_all_embeddings_for(ENC).unwrap();
        assert_eq!(r.len(), N);
    });

    println!("=== cha_ret populate breakdown (N={N}, dim={DIM}) ===");
    println!("populate_from_db_for_encoder (total): {populate_ms:.2} ms");
    println!(
        "eager diagnostics (embedding_stats {stats_ms:.2} + pairwise {pairwise_ms:.2} + selfsim {selfsim_ms:.3}): {diag_ms:.2} ms  ({:.0}% of populate)",
        100.0 * diag_ms / populate_ms
    );
    println!("get_all_embeddings_for, ~14-char paths: {fetch_short_ms:.2} ms");
    println!("get_all_embeddings_for, ~170-char paths: {fetch_long_ms:.2} ms");
    println!(
        "path-column delta (discarded by the populate loop): {:.2} ms",
        fetch_long_ms - fetch_short_ms
    );
}
