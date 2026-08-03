//! The per-encoder phase of the indexing pipeline (step 6 of
//! `super::run_pipeline_inner`) — the monotonic `EncodeProgress`
//! aggregate, `run_encoder_phase` (spawns one thread per enabled
//! encoder), and the generic per-encoder loop `run_trait_encoder`.
//!
//! Address-only split out of `indexing.rs` [code-health-audit
//! 2026-08-02]: `EncodeProgress` and `run_encoder_phase` are `pub(super)`
//! because `super::run_pipeline_inner` calls into them (backfill/
//! thumbnail/preview progress and the encode-phase call site); `emit`,
//! `emit_cadence`, `Phase`, and `ImageDatabase` are used here as
//! ancestor-private items visible from `super` without any widening.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use tauri::AppHandle;
use tracing::{error, info, warn};

use crate::db::ImageDatabase;
use crate::paths;
use crate::similarity_and_semantic_search::encoder::ClipImageEncoder;

use super::{emit, emit_cadence, Phase};

/// Shared, monotonic aggregate for any concurrent, high-volume pass that
/// needs a single coherent `processed/total` counter on the wire —
/// originally built for the concurrent encode phase, now shared by the
/// content-hash backfill, base thumbnail, and eager-preview passes too
/// (audit finding: four near-identical completed/last_emit/emit_every
/// triples, one per pass).
///
/// The bug this replaces on the encode phase: each of the (up to three)
/// encoder threads used to emit its OWN `processed/total` on the
/// `encode` phase. With the threads interleaving, a thread that had only
/// just started would emit `0/N` right after another thread had already
/// reported real progress, so the top-right status pill snapped back to
/// `0/21` and stuck there even while `get_pipeline_stats` (DB-backed)
/// correctly climbed to `21/21`. There was no single coherent counter
/// the frontend could trust, and no clean terminal `encode` value before
/// `Phase::Ready`. The other three passes never had that specific bug
/// (they're not multi-encoder), but they carried the same
/// completed-Atomic + last-emit-Mutex + emit_every triple by hand; folding
/// them onto this type is a pure de-duplication, and adopting
/// `advance`'s `SeqCst` (over their previous `Relaxed`) is a strengthening
/// with no behaviour change — the emitted value set is decided entirely
/// under the mutex either way, pinned by this type's own unit tests below.
///
/// Now every caller increments one shared counter. `processed` is the
/// number of completions summed across every *running* concurrent
/// worker; `total` is the fixed denominator, computed up front so the
/// counter climbs monotonically to exactly `total`. `advance` guards
/// wire ordering: the emits run under `last_emitted`, so with several
/// workers reporting concurrently the pill only ever climbs — a batch
/// whose whole range is below an already-emitted value (a slower worker
/// landing after a faster one) emits nothing. (Doing the emit *outside*
/// the lock would reopen the race: two threads could each decide to
/// emit, then fire in reverse.)
///
/// Emit granularity is decoupled from the batch size: the encode phase's
/// `encode_batch` processes 32 images at once for throughput, but
/// `advance` emits each crossed cadence value (per-image by default) so
/// the aggregate bar climbs smoothly instead of jumping a whole batch of
/// 32 at a time.
pub(super) struct EncodeProgress {
    /// Cumulative encodes completed across all running encoders. Atomic
    /// so the count itself never loses an increment even though the emit
    /// decision is mutex-guarded.
    processed: AtomicUsize,
    /// Last value actually emitted, guarding both the "only climb" test
    /// and the emit ordering (the emit happens while this is locked).
    last_emitted: std::sync::Mutex<usize>,
    /// Fixed denominator: sum of every running encoder's workload.
    total: usize,
    /// Emit cadence: a cumulative unit is emitted when it is a multiple of
    /// this (plus always the terminal `total`). 1 = per-image, the smooth
    /// default for a fresh small/medium library; larger caps the Tauri
    /// event rate at very large scales (see run_encoder_phase).
    emit_interval: usize,
}

impl EncodeProgress {
    pub(super) fn new(total: usize, emit_interval: usize) -> Self {
        Self {
            processed: AtomicUsize::new(0),
            last_emitted: std::sync::Mutex::new(0),
            total,
            emit_interval: emit_interval.max(1),
        }
    }

    /// Count `n` completed encodes (a whole batch really did finish
    /// together), then emit each newly-crossed cadence value — plus the
    /// terminal `total` — so the aggregate bar climbs per-image rather
    /// than jumping a batch of 32 at once. The values emit in increasing
    /// order under `last_emitted`, so with three encoders reporting
    /// concurrently the wire is strictly monotonic; the `done > *last`
    /// guard drops any range already surpassed by a faster encoder, which
    /// keeps the bar from blipping backwards.
    pub(super) fn advance<F: FnMut(usize)>(&self, n: usize, mut emit_fn: F) {
        let base = self.processed.fetch_add(n, Ordering::SeqCst);
        let mut last = self.last_emitted.lock().unwrap();
        for done in (base + 1)..=(base + n) {
            let due = done.is_multiple_of(self.emit_interval) || done == self.total;
            if due && done > *last {
                *last = done;
                emit_fn(done);
            }
        }
    }
}

/// Encoder phase — runs every enabled image encoder (CLIP, and
/// SigLIP-2/DINOv2 where their models are present) over the rows that
/// don't yet have an embedding, in batches of 32. Called from
/// `run_pipeline_inner` strictly AFTER the thumbnail phase completes
/// (Phase 12b reverted the earlier "thumbnails + encoders in parallel"
/// overlap — see the phase-order note at the thumbnail call site above
/// for why: per-encoder parallel execution turned that overlap into
/// rayon workers fighting ORT threads for the same cores).
///
/// Each per-encoder thread opens its own `ImageDatabase` (separate
/// SQLite connection) so it doesn't contend with the other encoder
/// threads for the same Mutex; WAL mode (`initialize()` pragmas) makes
/// their concurrent writes safe — every encoder writes only its own rows
/// in the `embeddings` table, keyed by `encoder_id`, and SQLite's WAL
/// serialises commits at the page level without blocking readers.
pub(super) fn run_encoder_phase(
    app: &AppHandle,
    db_path: &str,
    image_model_path: &Path,
) -> Result<(), String> {
    // Phase 11c + 11e — encode through every USER-ENABLED image
    // encoder, in parallel.
    //
    // Each enabled encoder gets its own thread. Each thread opens its
    // own ImageDatabase (separate writer + reader connections; SQLite
    // WAL handles concurrent commits) so the encoder loops don't
    // contend on a single Mutex<Connection>. The R1 batched writes
    // mean each encoder commits relatively few times even under heavy
    // load, and SQLite's WAL serialises commits at the file layer
    // without blocking readers.
    //
    // Why no priority concept anymore: the Phase 5 RRF fusion uses
    // every enabled encoder, so "which one runs first" no longer maps
    // to user-visible benefit. The cosine cache hot-populate that
    // used to be paired with the priority encoder is also retired —
    // the FusionIndexState lazy-populates per encoder on first fusion
    // call, and there's no single "active" encoder cache to warm.
    //
    // Why no `_encode_phase` span: neither `run_trait_encoder` nor the
    // encoders it drives carry any `#[instrument]`/span of their own
    // (audit-verified — this comment previously claimed otherwise), so a
    // parent span here would only capture join wait time, not actual
    // work. The per-encoder `encoder_run_summary` diagnostic
    // (`crate::perf::record_diagnostic`) is the real per-encoder timing
    // signal in the perf report.
    //
    // Oversubscription note: each encoder still uses the shared
    // `ort_session.rs` builder with `intra_threads(4)` (set for the
    // M2 4-perf-core cluster). With 3 encoders concurrent that's 12
    // ORT threads on 8 cores — some oversubscription. The OS
    // scheduler handles this OK in practice (matmul-bound work
    // doesn't suffer linearly from oversubscription), but if a
    // future perf report shows it bites, the fix is to make
    // `intra_threads` dynamic in `ort_session.rs`: pass
    // `4 / enabled_count` as a parameter.

    // Enabled-encoder list from settings. Default = every supported
    // encoder if the user hasn't picked anything yet.
    let settings = crate::settings::Settings::load();
    let enabled = settings.resolved_enabled_encoders();
    info!("encoder phase: enabled = {enabled:?}");
    let model_precision = settings.effective_model_precision();

    let siglip2_path = paths::model_path_for(
        crate::similarity_and_semantic_search::encoder_siglip2::SIGLIP2_IMAGE_MODEL_FILENAME,
        &model_precision,
    );
    let dinov2_path = paths::model_path_for(
        crate::similarity_and_semantic_search::encoder_dinov2::DINOV2_IMAGE_MODEL_FILENAME,
        &model_precision,
    );

    // Phase 12c — dynamic intra_threads. Total ORT thread budget across
    // all enabled encoders stays at 4 (M2 P-cluster). With N=1, each
    // encoder gets 4 threads. With N=3, each gets 1. Avoids the perf-
    // 1777226449 12-threads-on-8-cores oversubscription.
    let intra_per_encoder = (crate::similarity_and_semantic_search::ort_session::DEFAULT_INTRA_THREADS
        / enabled.len().max(1))
        .max(1);
    info!(
        "encoder phase: spawning {} threads, intra_threads={} each",
        enabled.len(),
        intra_per_encoder
    );

    // Precompute the aggregate encode workload so the `encode` phase can
    // emit one coherent, monotonic counter instead of three interleaving
    // per-encoder ones (the sticky-`0/21` bug). `total` is the sum, over
    // every encoder that will actually run (enabled AND its model
    // present), of the rows that encoder still has to embed. We count
    // with the SAME predicate each encoder drives its loop from
    // (`count_images_without_embedding_for` mirrors
    // `get_images_without_embedding_for`'s WHERE exactly), so the shared
    // counter climbs to exactly `total` and no further; a missing-model
    // or already-complete encoder contributes 0 and never moves it. Each
    // encoder is the sole writer of its own embeddings, so its count is
    // stable between this precompute and the thread's own requery — no
    // double-count risk.
    //
    // Audit finding: this used to materialise each encoder's needs-set
    // (`Vec<(ID, String)>`, one heap path per row) just to call `.len()`
    // — on a fresh 100k×3-encoder index, ~300k discarded path
    // allocations for three integers, immediately requeried for real
    // inside each encoder thread. `count_images_without_embedding_for`
    // is the COUNT(*) form of the same predicate; equivalence-proven,
    // the honest win is allocation churn only (release-serial ~1.25%,
    // the 2.5x headline was debug-profile). Proof: cha_b_needs_count.rs.
    let aggregate_total = {
        let counts_db = ImageDatabase::new(db_path).map_err(|e| e.to_string())?;
        counts_db.initialize().map_err(|e| e.to_string())?;
        enabled
            .iter()
            .map(|id| match id.as_str() {
                // CLIP's model presence is guaranteed by the caller (it
                // only invokes run_encoder_phase when image_model_path
                // exists). It counts via the SAME predicate its loop now
                // uses (`get_images_without_embedding_for`), so a
                // fully-indexed launch contributes 0 here → total 0 → no
                // encode phase → the pill doesn't flash.
                "clip_vit_b_32" => counts_db
                    .count_images_without_embedding_for("clip_vit_b_32")
                    .unwrap_or(0),
                "siglip2_base" if siglip2_path.exists() => counts_db
                    .count_images_without_embedding_for("siglip2_base")
                    .unwrap_or(0),
                "dinov2_base" if dinov2_path.exists() => counts_db
                    .count_images_without_embedding_for(
                        crate::similarity_and_semantic_search::encoder_dinov2::DINOV2_ENCODER_ID,
                    )
                    .unwrap_or(0),
                _ => 0,
            })
            .sum::<i64>()
            .max(0) as usize
    };

    // Emit at per-image granularity for typical libraries so the bar
    // climbs smoothly rather than jumping a batch of 32; cap the Tauri
    // event rate at very large scales so a 100k×3-encoder index doesn't
    // fire ~300k events. `emit_cadence` keeps it per-image (interval 1)
    // up to 4000 encode-units — comfortably covering the fresh
    // small/medium libraries the "feels stuck" complaint is about — and
    // bounds the phase to ≈4000 emits above that.
    let progress = Arc::new(EncodeProgress::new(aggregate_total, emit_cadence(aggregate_total)));
    // Prime the pill with a coherent 0/total the instant the phase
    // starts, so it shows the real denominator rather than lingering on
    // the previous phase's numbers. Skip entirely when there's nothing to
    // encode (the phase does no work and Phase::Ready follows directly).
    if aggregate_total > 0 {
        emit(app, Phase::Encode, 0, aggregate_total, Some("Encoding".into()));
    }

    // Spawn one thread per enabled encoder. Each thread is independent
    // (own DB connection, own ORT session) but all share the one
    // `progress` aggregate above so their emits stay coherent.
    let mut handles: Vec<thread::JoinHandle<Result<(), String>>> = Vec::new();

    for encoder_id in &enabled {
        let encoder_id = encoder_id.clone();
        let app = app.clone();
        let db_path = db_path.to_string();
        let image_model_path = image_model_path.to_path_buf();
        let siglip2_path = siglip2_path.clone();
        let dinov2_path = dinov2_path.clone();
        let intra = intra_per_encoder;
        let progress = progress.clone();

        handles.push(thread::spawn(move || -> Result<(), String> {
            // Per-thread DB. Two connections (writer + read-only
            // secondary) per encoder — at 3 enabled encoders that's
            // 6 SQLite connections to the same WAL'd file. That's well
            // within SQLite's healthy concurrency envelope.
            let database = ImageDatabase::new(&db_path).map_err(|e| e.to_string())?;
            // Initialise so the read-only secondary opens. Schema-create
            // is idempotent (`CREATE TABLE IF NOT EXISTS`) so racing
            // initialise() calls across threads don't corrupt anything;
            // the first one in the WAL wins, the rest no-op.
            database.initialize().map_err(|e| e.to_string())?;

            match encoder_id.as_str() {
                "clip_vit_b_32" => run_trait_encoder(
                    &app,
                    &database,
                    "clip_vit_b_32",
                    || ClipImageEncoder::new_with_intra(&image_model_path, intra),
                    &progress,
                ),
                "siglip2_base" => {
                    if siglip2_path.exists() {
                        run_trait_encoder(
                            &app,
                            &database,
                            "siglip2_base",
                            || crate::similarity_and_semantic_search::encoder_siglip2::Siglip2ImageEncoder::new_with_intra(&siglip2_path, intra),
                            &progress,
                        )
                    } else {
                        warn!(
                            "SigLIP-2 image model missing at {}; skipping",
                            siglip2_path.display()
                        );
                        Ok(())
                    }
                }
                "dinov2_base" => {
                    if dinov2_path.exists() {
                        run_trait_encoder(
                            &app,
                            &database,
                            crate::similarity_and_semantic_search::encoder_dinov2::DINOV2_ENCODER_ID,
                            || crate::similarity_and_semantic_search::encoder_dinov2::Dinov2ImageEncoder::new_with_intra(&dinov2_path, intra),
                            &progress,
                        )
                    } else {
                        warn!(
                            "DINOv2 image model missing at {}; skipping",
                            dinov2_path.display()
                        );
                        Ok(())
                    }
                }
                other => {
                    warn!("encoder phase: ignoring unknown enabled id '{other}'");
                    Ok(())
                }
            }
        }));
    }

    // Join every thread. We surface the first error encountered but
    // wait for the others to finish so a fast-failing CLIP doesn't
    // leave SigLIP-2 / DINOv2 mid-encode.
    let mut first_err: Option<String> = None;
    for h in handles {
        match h.join() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                if first_err.is_none() {
                    first_err = Some(e.clone());
                }
                error!("encoder thread failed: {e}");
            }
            Err(panic) => {
                let msg = format!("encoder thread panicked: {panic:?}");
                if first_err.is_none() {
                    first_err = Some(msg.clone());
                }
                error!("{msg}");
            }
        }
    }
    if let Some(e) = first_err {
        return Err(e);
    }

    // No cache work here: the fusion slots (the caches every search reads)
    // are refreshed + persisted once at the end of run_pipeline_inner
    // (step 7), which is token-gated so it only touches encoders this run
    // actually changed. Doing it here per-encoder would race with
    // concurrent foreground search calls on the same slot.
    Ok(())
}

/// Generic per-encoder loop using the ImageEncoder trait. Used for CLIP,
/// SigLIP-2, and DINOv2; each writes only to the new embeddings table.
///
/// Audit finding: CLIP used to have its own near-identical loop
/// (`run_clip_encoder_with_intra`) predating the `ImageEncoder` trait.
/// Every line that looked CLIP-specific was already parameterised here —
/// `ClipImageEncoder::new_with_intra` builds through the same
/// `encode_batch` the trait forwards to (`encoder.rs`'s `impl
/// ImageEncoder for ClipImageEncoder` delegates to the inherent method),
/// and CLIP's batch-1 ONNX constraint lives inside that inherent method,
/// invisible here. Deleting the duplicate needed no behaviour change —
/// same needs-set predicate, same per-chunk write/emit/checkpoint
/// sequence, same diagnostic shape — token-diffed equal against the
/// deleted function before removal.
fn run_trait_encoder<F, E>(
    app: &AppHandle,
    database: &ImageDatabase,
    encoder_id: &str,
    make_encoder: F,
    progress: &EncodeProgress,
) -> Result<(), String>
where
    F: FnOnce() -> Result<E, Box<dyn std::error::Error>>,
    E: crate::similarity_and_semantic_search::encoders::ImageEncoder,
{
    use std::path::Path as StdPath;
    let needs = database
        .get_images_without_embedding_for(encoder_id)
        .map_err(|e| e.to_string())?;
    let total = needs.len();
    if total == 0 {
        return Ok(());
    }
    // No per-encoder start emit — the phase-level 0/total and the shared
    // aggregate below replace the old per-encoder counter that produced
    // the sticky-0/21 bug.

    let run_started = std::time::Instant::now();
    let mut encoder = make_encoder().map_err(|e| e.to_string())?;
    let mut processed = 0usize;
    let mut succeeded = 0usize;
    let mut failed_paths: Vec<String> = Vec::new();
    let mut sample_emitted = false;
    // Trait default `encode_batch` falls back to one-by-one. Future:
    // override per encoder if batching is faster.
    for chunk in needs.chunks(32) {
        let paths: Vec<&StdPath> = chunk.iter().map(|(_, p)| StdPath::new(p)).collect();
        match encoder.encode_batch(&paths) {
            Ok(embeddings) => {
                if !sample_emitted {
                    if let (Some((_, first_path)), Some(first_emb)) =
                        (chunk.first(), embeddings.first())
                    {
                        emit_preprocessing_sample(encoder_id, first_path, first_emb);
                        sample_emitted = true;
                    }
                }
                // R1 — one BEGIN IMMEDIATE batch write per chunk, every
                // encoder including CLIP. legacy_clip_too = false: no
                // encoder double-writes the legacy column any more.
                let batch_rows: Vec<(crate::db::ID, Vec<f32>)> = chunk
                    .iter()
                    .zip(embeddings.iter())
                    .map(|((id, _), emb)| (*id, emb.clone()))
                    .collect();
                let row_count = batch_rows.len();
                match database.upsert_embeddings_batch(
                    encoder_id,
                    &batch_rows,
                    false,
                ) {
                    Ok(()) => succeeded += row_count,
                    Err(e) => {
                        let err_str = e.to_string();
                        for (_, path) in chunk.iter() {
                            failed_paths
                                .push(format!("{path}: db batch — {err_str}"));
                        }
                    }
                }
            }
            Err(e) => {
                let err_str = e.to_string();
                for (_, path) in chunk.iter() {
                    failed_paths.push(format!("{}: encode_batch — {}", path, err_str));
                }
            }
        }
        processed += chunk.len();
        // Report against the shared aggregate at per-image granularity
        // (see the CLIP path).
        progress.advance(chunk.len(), |done| {
            emit(app, Phase::Encode, done, progress.total, Some("Encoding".into()));
        });
        // R3 — drain WAL between batches under wal_autocheckpoint=0.
        let _ = database.checkpoint_passive();
    }

    // Per-encoder run summary diagnostic, one shape for every encoder.
    // Lets the report show side-by-side cost + failure rates across
    // CLIP / SigLIP-2 / DINOv2.
    let elapsed_ms = run_started.elapsed().as_millis() as u64;
    let mean_per_image_ms = if processed > 0 { elapsed_ms as f64 / processed as f64 } else { 0.0 };
    crate::perf::record_diagnostic(
        "encoder_run_summary",
        serde_json::json!({
            "encoder_id": encoder_id,
            "attempted": processed,
            "succeeded": succeeded,
            "failed": failed_paths.len(),
            "elapsed_ms": elapsed_ms,
            "mean_per_image_ms": mean_per_image_ms,
            "failed_sample": failed_paths.iter().take(10).cloned().collect::<Vec<_>>(),
        }),
    );
    Ok(())
}

/// Emit a `preprocessing_sample` diagnostic for the first image
/// encoded by an encoder. Captures embedding-side stats (dim, L2
/// norm, value range, NaN/Inf counts) — these reflect both the
/// preprocessing pipeline AND the encoder's output health in one
/// shot. Cheap (microseconds).
fn emit_preprocessing_sample(encoder_id: &str, image_path: &str, embedding: &[f32]) {
    let dim = embedding.len();
    let nan_count = embedding.iter().filter(|x| x.is_nan()).count();
    let inf_count = embedding.iter().filter(|x| x.is_infinite()).count();
    let finite: Vec<f32> = embedding.iter().filter(|x| x.is_finite()).copied().collect();
    let (min, max, mean, l2_norm) = if finite.is_empty() {
        (0.0, 0.0, 0.0, 0.0)
    } else {
        let min = finite.iter().cloned().fold(f32::INFINITY, f32::min);
        let max = finite.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let mean = finite.iter().sum::<f32>() / finite.len() as f32;
        let l2 = finite.iter().map(|x| x * x).sum::<f32>().sqrt();
        (min, max, mean, l2)
    };
    let interpretation = if nan_count > 0 || inf_count > 0 {
        "BROKEN — NaN/Inf in embedding (preprocessing or encoder bug)"
    } else if l2_norm < 0.01 {
        "WARNING — near-zero norm; encoder produced degenerate output"
    } else if (l2_norm - 1.0).abs() < 0.01 {
        "OK — L2-normalised unit vector"
    } else {
        "Non-normalised — cosine still works since math divides by norms"
    };
    crate::perf::record_diagnostic(
        "preprocessing_sample",
        serde_json::json!({
            "encoder_id": encoder_id,
            "first_image_path": image_path,
            "embedding_dim": dim,
            "l2_norm": l2_norm,
            "min": min,
            "max": max,
            "mean": mean,
            "nan_count": nan_count,
            "inf_count": inf_count,
            "first_8_dims": embedding.iter().take(8).copied().collect::<Vec<f32>>(),
            "interpretation": interpretation,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn encode_progress_emits_per_image_at_interval_one() {
        // Emit granularity is decoupled from the batch size: a single
        // batch of 100 at interval 1 emits every value 1..=100, so the bar
        // climbs per-image rather than jumping the whole batch at once.
        let p = EncodeProgress::new(100, 1);
        let mut emitted = Vec::new();
        p.advance(100, |done| emitted.push(done));
        assert_eq!(emitted, (1..=100).collect::<Vec<_>>());
        assert_eq!(p.processed.load(Ordering::SeqCst), 100);
        assert_eq!(*p.last_emitted.lock().unwrap(), 100);
    }

    #[test]
    fn encode_progress_interval_caps_emits_but_hits_terminal() {
        // A coarser interval (the large-library cap) emits only multiples
        // of the interval — PLUS always the final unit, so the bar still
        // lands exactly on total even when total isn't a multiple.
        let p = EncodeProgress::new(95, 10);
        let mut emitted = Vec::new();
        p.advance(95, |done| emitted.push(done));
        assert_eq!(emitted, vec![10, 20, 30, 40, 50, 60, 70, 80, 90, 95]);
        assert_eq!(*p.last_emitted.lock().unwrap(), 95);
    }

    #[test]
    fn encode_progress_never_regresses_under_concurrent_encoders() {
        // Mirror the real phase: three encoders, each a 500-image workload
        // processed in batches of 32, summed into one per-image aggregate.
        let total = 3 * 500;
        let progress = Arc::new(EncodeProgress::new(total, 1));
        let observed = Arc::new(std::sync::Mutex::new(Vec::<usize>::new()));

        let mut handles = Vec::new();
        for _ in 0..3 {
            let progress = Arc::clone(&progress);
            let observed = Arc::clone(&observed);
            handles.push(thread::spawn(move || {
                let mut remaining = 500usize;
                while remaining > 0 {
                    let n = remaining.min(32);
                    progress.advance(n, |done| observed.lock().unwrap().push(done));
                    remaining -= n;
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        let observed = observed.lock().unwrap();
        // Every increment is counted exactly once — no lost updates.
        assert_eq!(progress.processed.load(Ordering::SeqCst), total);
        // The counter reached exactly total, never past it.
        assert_eq!(*observed.last().unwrap(), total);
        assert_eq!(*progress.last_emitted.lock().unwrap(), total);
        // Emits run under the lock in increasing order, so the observed
        // wire sequence is strictly increasing — never a backwards blip,
        // even though a slower encoder's batch can land after a faster
        // one's (its already-surpassed range simply isn't emitted, which
        // is why we don't assert every value appears).
        assert!(
            observed.windows(2).all(|w| w[0] < w[1]),
            "emitted progress must be strictly increasing, got {observed:?}"
        );
    }
}
