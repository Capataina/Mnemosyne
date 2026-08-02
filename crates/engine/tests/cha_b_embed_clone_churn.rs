//! Code-health-audit sizing probe (seat B) — candidate: the encoder
//! loops clone every embedding to build the batch-write rows.
//!
//! `indexing.rs::run_clip_encoder_with_intra` / `run_trait_encoder` build
//! `Vec<(ID, Vec<f32>)>` via `emb.clone()` per row (32 × 512-f32 ≈ 64 KiB
//! heap churn per batch; ~600 MB cumulative across a 100k × 3-encoder
//! index) because `upsert_embeddings_batch` takes `&[(ID, Vec<f32>)]`.
//! A borrow-shaped signature (`&[(ID, &[f32])]`) would erase the clones
//! with zero behaviour change.
//!
//! This test SIZES the candidate rather than assuming it matters: it
//! measures the clone-and-collect cost against the real batched DB write
//! it accompanies. If the clone is a trivial fraction of the write, the
//! candidate is LOW/noise and the number recorded here is the evidence
//! either way. (The ONNX inference the loop also contains is orders of
//! magnitude above both — this probe bounds the finding's ceiling.)

use std::time::{Duration, Instant};

use mnemosyne::db::ImageDatabase;

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
fn clone_cost_is_measured_against_the_batch_write_it_feeds() {
    const BATCH: usize = 32;
    const DIM: usize = 512;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("churn.db").to_string_lossy().into_owned();
    let db = ImageDatabase::new(&path).unwrap();
    db.initialize().unwrap();
    let root = db.add_root("/r".into(), None).unwrap();
    let batch: Vec<(String, Option<i64>)> = (0..BATCH)
        .map(|i| (format!("/r/{i}.jpg"), Some(root.id)))
        .collect();
    db.add_images_batch(&batch).unwrap();

    // The shape the encoder produces: one Vec<f32> per image.
    let embeddings: Vec<Vec<f32>> = (0..BATCH)
        .map(|i| (0..DIM).map(|d| (i * DIM + d) as f32 * 1e-4).collect())
        .collect();
    let ids: Vec<i64> = (1..=BATCH as i64).collect();

    // (a) The clone-and-collect the production loop performs per batch.
    let (rows, t_clone) = time_min(20, || {
        ids.iter()
            .zip(embeddings.iter())
            .map(|(id, emb)| (*id, emb.clone()))
            .collect::<Vec<(i64, Vec<f32>)>>()
    });

    // (b) The batched DB write those rows feed.
    let (_, t_write) = time_min(20, || {
        db.upsert_embeddings_batch("clip_vit_b_32", &rows, false)
            .unwrap();
    });

    let pct = 100.0 * t_clone.as_secs_f64() / t_write.as_secs_f64().max(1e-9);
    eprintln!(
        "[cha_b_embed_clone_churn] batch={BATCH}x{DIM}f32: clone+collect = \
         {t_clone:?}, upsert_embeddings_batch = {t_write:?} \
         (clone is {pct:.2}% of the DB write it feeds; ~{} KiB churned/batch)",
        BATCH * DIM * 4 / 1024
    );

    // Equivalence side: the write with cloned rows landed every row.
    for id in &ids {
        let stored = db.get_embedding(*id, "clip_vit_b_32").unwrap();
        assert_eq!(stored.len(), DIM);
    }
}
