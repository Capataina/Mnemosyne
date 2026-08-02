//! CHA retrieval-path benchmark: the hot-scan collect shape and the tiered
//! sort shape.
//!
//! **1. `score_all`'s rayon collect goes through the unindexed path.**
//! `(0..n).into_par_iter().filter_map(..).collect()` loses the indexed
//! length at `filter_map`, so rayon collects per-thread Vecs into a linked
//! list and concatenates — extra allocation + a full copy per query —
//! instead of `collect_into_vec`'s single pre-sized write-in-place (rayon
//! docs: unindexed collect is chunk-Vecs merged via LinkedList;
//! `collect_into_vec` "allocates efficiently with precise knowledge").
//! This test replays both shapes over identical data with the *same
//! sequential fold* the engine uses (summation order untouched — the
//! dot_slice bit-identity boundary is respected) and asserts the outputs
//! are exactly equal, element for element, including row order — the
//! ranking-equivalence precondition. The alternative keeps the excluded
//! row via a post-pass `retain`, so exclusion semantics are identical too.
//!
//! **2. `get_tiered_similar_images` full-sorts N scores to use only the top
//! 50%.** The candidate shape partitions at the 50% mark first
//! (`select_nth_unstable_by`, O(n)) and sorts only that half. On tie-free
//! scores the sorted top half is provably identical; on *tied* scores the
//! boundary membership can differ between the shapes, which is why this
//! stays a CANDIDATE (rankings-are-contract) — the benchmark here is the
//! settling measurement for the tie-free case.
//!
//! Assertions pin equivalence only; timings print with `--nocapture`.

use mnemosyne::cosine::CosineIndex;
use ndarray::Array1;
use rayon::prelude::*;
use std::time::Instant;

const N: usize = 20_000;
const DIM: usize = 512;

fn emb(i: usize) -> Vec<f32> {
    (0..DIM)
        .map(|j| ((((i * 31 + j * 7) % 13) as f32) - 6.0) * 0.1 + 0.01)
        .collect()
}

/// The engine's sequential fold, replicated verbatim so scores are
/// bit-identical between the two collect shapes under test.
#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[inline]
fn inv_norm(v: &[f32]) -> f32 {
    let sq = dot(v, v);
    if sq == 0.0 { 0.0 } else { 1.0 / sq.sqrt() }
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
fn scan_collect_filter_map_vs_indexed_collect_into_vec() {
    // Flat store replica: one row-major block + ids + cached inverse norms,
    // the same layout score_all reads.
    let mut block: Vec<f32> = Vec::with_capacity(N * DIM);
    let mut inv: Vec<f32> = Vec::with_capacity(N);
    let ids: Vec<i64> = (0..N as i64).collect();
    for i in 0..N {
        let e = emb(i);
        inv.push(inv_norm(&e));
        block.extend_from_slice(&e);
    }
    let q = emb(N / 2);
    let q_inv = inv_norm(&q);
    let exclude_id: i64 = 7;

    // Shape A — the current score_all shape: filter_map → unindexed collect.
    let shape_a = || -> Vec<(usize, f32)> {
        (0..N)
            .into_par_iter()
            .filter_map(|row| {
                if ids[row] == exclude_id {
                    return None;
                }
                let c = &block[row * DIM..(row + 1) * DIM];
                Some((row, dot(&q, c) * q_inv * inv[row]))
            })
            .collect()
    };

    // Shape B — indexed map → collect_into_vec (pre-sized, write-in-place),
    // exclusion applied as a serial post-pass. Same fold, same scores, same
    // row order, same excluded row.
    let mut reuse: Vec<(usize, f32)> = Vec::new();
    let shape_b = |buf: &mut Vec<(usize, f32)>| {
        (0..N)
            .into_par_iter()
            .map(|row| {
                let c = &block[row * DIM..(row + 1) * DIM];
                (row, dot(&q, c) * q_inv * inv[row])
            })
            .collect_into_vec(buf);
        buf.retain(|(row, _)| ids[*row] != exclude_id);
    };

    // Equivalence: exact equality — same rows, same order, bit-identical
    // scores (identical summation order by construction).
    let a = shape_a();
    let mut b_buf = Vec::new();
    shape_b(&mut b_buf);
    assert_eq!(a.len(), N - 1);
    assert_eq!(a, b_buf, "collect shapes must be rank-equivalent, bit for bit");

    let a_ms = median_ms(9, || {
        let r = shape_a();
        assert_eq!(r.len(), N - 1);
    });
    let b_ms = median_ms(9, || {
        shape_b(&mut reuse);
        assert_eq!(reuse.len(), N - 1);
    });

    println!("=== cha_ret scan collect shape (N={N}, dim={DIM}) ===");
    println!("A filter_map -> unindexed collect (current): {a_ms:.2} ms");
    println!("B indexed collect_into_vec + retain:          {b_ms:.2} ms");
    println!("delta: {:.2} ms ({:+.0}%)", b_ms - a_ms, 100.0 * (b_ms - a_ms) / a_ms);

    // Context: the same scan through the public API (includes top-k select).
    let mut idx = CosineIndex::new();
    for i in 0..N {
        idx.add_image(i as i64, Array1::from_vec(emb(i)));
    }
    let query = Array1::from_vec(q.clone());
    let api_ms = median_ms(9, || {
        let r = idx.get_similar_images_sorted(&query, 30, Some(exclude_id));
        assert_eq!(r.len(), 30);
    });
    println!("public get_similar_images_sorted(top 30):     {api_ms:.2} ms");
}

#[test]
fn tiered_full_sort_vs_partial_select_half() {
    // Tie-free score vector (strictly distinct by construction) at scan
    // scale: the shape comparison is exact only without ties, which is why
    // the production swap remains a candidate, not a proven finding.
    let scores: Vec<(usize, f32)> = (0..N)
        .map(|i| (i, ((i * 2654435761usize) % N) as f32 + (i as f32) * 1e-9))
        .collect();
    let cmp = |a: &(usize, f32), b: &(usize, f32)| b.1.partial_cmp(&a.1).unwrap();

    let half = (N as f32 * 0.5).ceil() as usize;

    // Shape A — current: full sort, tiers index into the first half.
    let mut a = scores.clone();
    let a_ms = median_ms(9, || {
        a.copy_from_slice(&scores);
        a.sort_unstable_by(cmp);
    });

    // Shape B — candidate: partition at the 50% mark, sort only that half.
    let mut b = scores.clone();
    let b_ms = median_ms(9, || {
        b.copy_from_slice(&scores);
        b.select_nth_unstable_by(half - 1, cmp);
        b[..half].sort_unstable_by(cmp);
    });

    // Equivalence on tie-free data: the region the tiers actually read
    // (the sorted first half) is identical.
    assert_eq!(&a[..half], &b[..half], "sorted top half must match exactly");

    println!("=== cha_ret tiered sort shape (N={N}, tiers read top 50%) ===");
    println!("A full sort_unstable_by:                {a_ms:.2} ms");
    println!("B select_nth(50%) + sort half:          {b_ms:.2} ms");
    println!("delta: {:.2} ms ({:+.0}%)", b_ms - a_ms, 100.0 * (b_ms - a_ms) / a_ms);
}
