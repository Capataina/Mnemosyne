//! CHA retrieval-path benchmark: is RRF fusion itself worth optimising?
//!
//! The fused commands run `reciprocal_rank_fusion` over at most 4 lists
//! (3 encoders + the filename signal) × `per_encoder_top_k` (default
//! 5×top_n, min 50 — realistically 150). This measures that exact shape,
//! plus a 10× stress shape, to settle whether the HashMap aggregation,
//! the per-item `encoder_id.clone()` (one String clone per ranked item
//! per list), and the unreserved map deserve any attention relative to
//! the multi-ms encoder scans that feed it.
//!
//! Assertions pin output shape only; timings print with `--nocapture`.

use mnemosyne::cosine::rrf::{reciprocal_rank_fusion, RankedList, DEFAULT_K_RRF};
use std::time::Instant;

fn lists(per_list: usize, n_lists: usize) -> Vec<RankedList> {
    (0..n_lists)
        .map(|l| RankedList {
            encoder_id: format!("encoder_{l}"),
            // ~50% id overlap between lists so the entry() path exercises
            // both insert and update.
            items: (0..per_list)
                .map(|r| (((l * per_list / 2) + r) as i64, 1.0 - r as f32 * 1e-3))
                .collect(),
        })
        .collect()
}

fn median_us<F: FnMut()>(reps: usize, mut f: F) -> f64 {
    let mut times: Vec<f64> = (0..reps)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1e6
        })
        .collect();
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    times[times.len() / 2]
}

#[test]
fn rrf_fusion_cost_at_production_shape() {
    // Production shape: 4 lists × 150 items, top_n 30.
    let prod = lists(150, 4);
    let prod_us = median_us(50, || {
        let fused = reciprocal_rank_fusion(&prod, DEFAULT_K_RRF, 30);
        assert_eq!(fused.len(), 30);
    });

    // Stress shape: 4 lists × 1500 items, top_n 300.
    let stress = lists(1500, 4);
    let stress_us = median_us(20, || {
        let fused = reciprocal_rank_fusion(&stress, DEFAULT_K_RRF, 300);
        assert_eq!(fused.len(), 300);
    });

    println!("=== cha_ret RRF fusion cost ===");
    println!("4 lists x 150 (production default): {prod_us:.0} us");
    println!("4 lists x 1500 (10x stress):        {stress_us:.0} us");
}
