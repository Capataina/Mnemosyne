//! Background indexing pipeline.
//!
//! Owns the scan → thumbnail → encode flow that previously ran inside
//! main(). Now spawned from a background thread so the Tauri window
//! opens immediately and the user sees progress over the IPC event
//! channel rather than staring at a blank terminal.
//!
//! Two trigger paths:
//!
//! 1. App startup (`run` in lib.rs) — if settings.json has a scan_root
//!    and the model files exist on disk, the setup callback spawns
//!    `run_pipeline` immediately so the catalog refreshes whenever the
//!    user reopens the app.
//! 2. Root mutations — `set_scan_root` (replace-all, wipes every
//!    existing root), `add_root`, and the watcher's debounced rescan —
//!    all route through `try_spawn_pipeline` to repopulate the catalog
//!    against the current root table. Roots are a table now, not a
//!    single scan_root; see `apps/lynceus/CLAUDE.md`'s multi-root
//!    semantics for the full replace-all vs granular split.
//!
//! Concurrency model: a single AtomicBool guards "one indexing run at
//! a time". Trying to start a second run while one is in flight returns
//! `Err(IndexingError::AlreadyRunning)` to the caller. This is a
//! deliberately simple single-flight policy — Pass 5b's UI surfaces
//! the rejection cleanly. A future pass can add cooperative
//! cancellation (cancel-and-restart on rapid root switches) once we
//! see the need.
//!
//! Events: every state change emits a `indexing-progress` Tauri event
//! with an `IndexingProgress` payload. The frontend hook in Pass 5b
//! listens and renders a status pill.
//!
//! Module layout: this file owns orchestration (`try_spawn_pipeline`,
//! `run_pipeline_inner`), the event/progress payload types, and the
//! shared `emit`/cadence/bounded-pool helpers those phases lean on.
//! The `encode` submodule owns the per-encoder phase (`run_encoder_phase`,
//! `run_trait_encoder`) and the monotonic `EncodeProgress` aggregate —
//! address-only split of what was previously one 1746-line file
//! [code-health-audit 2026-08-02].

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tracing::{error, info, warn};

use crate::db::content_hash::RelinkOutcome;
use crate::db::ImageDatabase;
use crate::filesystem::ImageScanner;
// The top-level file-hashing module is not re-exported at the app crate
// root (only `db`/`paths`/… are), so it is reached via the engine crate
// directly — the same module the DB-side relink methods build on.
use mnemosyne::content_hash;
use crate::model_download;
use crate::paths;
use crate::similarity_and_semantic_search::cosine_similarity::CosineIndex;
use crate::similarity_and_semantic_search::encoder_text::ClipTextEncoder;
use crate::thumbnail::ThumbnailGenerator;
// FusionSlots is the crate-shared managed-state alias (state.rs); the
// pipeline refreshes these slots at Ready so post-index search — which
// borrows the fusion slots (T3-2/#8) — reflects the newly-encoded
// images, and persists each encoder's flat store as it does so.
use crate::FusionSlots;
use crate::TextEncoderState;

mod encode;
use encode::EncodeProgress;

/// The single-flight guard. Wrap in Arc and stash in a Tauri state
/// struct so commands and the setup callback can both reach it.
#[derive(Default)]
pub struct IndexingState {
    pub is_running: AtomicBool,
}

impl IndexingState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Tauri event payload broadcast as the pipeline progresses.
#[derive(Serialize, Clone, Debug)]
pub struct IndexingProgress {
    pub phase: Phase,
    /// How many units of the current phase have been processed.
    pub processed: usize,
    /// Total units in the current phase. Zero means "indeterminate".
    pub total: usize,
    /// Optional human-readable message — paths, error strings, etc.
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    /// Recursively walking the scan root.
    Scan,
    /// Downloading missing model files.
    ModelDownload,
    /// Generating base thumbnails for new images.
    Thumbnail,
    /// Pre-generating the larger preview buckets (960/1440/2048) after
    /// search is already ready. Split from Thumbnail so the status pill
    /// and the settings "Images with previews" count can never look out
    /// of sync: with_thumbnail tracks BASE thumbnails, which are all
    /// done before this phase begins.
    Previews,
    /// Producing CLIP image embeddings batch by batch.
    Encode,
    /// Pipeline complete; cosine index repopulated; UI may refresh.
    Ready,
    /// A non-recoverable error stopped the pipeline. `message` carries
    /// a human-readable string. `is_running` has already been cleared
    /// — the user can retry by switching folders or restarting.
    Error,
}

/// One compact row of a `feed-delta` event (T3-1) — "this image is now
/// thumbnailed, with these dimensions". Mirrors the manifest row shape
/// the frontend feeds its `["feed-manifest"]` cache with, minus
/// `manual_col_span`: a delta never carries a span, and the frontend
/// merge preserves any existing span on patch, so a re-thumbnail can
/// never wipe a persisted resize.
#[derive(Serialize, Clone, Debug)]
pub struct FeedDeltaRow {
    pub id: i64,
    /// File basename — same derivation as the manifest's.
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub thumbnail_path: String,
}

/// Batched `feed-delta` payload. Rows are flushed every
/// [`FEED_DELTA_BATCH`] completions (and once at the end of the
/// thumbnail pass, BEFORE the terminal `Phase::Thumbnail` progress emit,
/// so any frontend phase-transition handling always runs after the last
/// delta has been delivered).
#[derive(Serialize, Clone, Debug)]
pub struct FeedDeltaBatch {
    pub rows: Vec<FeedDeltaRow>,
}

/// Rows per `feed-delta` event. At 100k images this yields ~1.5k events
/// across the whole thumbnail phase — the frontend additionally
/// throttles cache application to a ~5s cadence, so event count is not
/// a render-frequency concern, only an IPC-payload-size one.
const FEED_DELTA_BATCH: usize = 64;

fn emit_feed_delta(app: &AppHandle, rows: Vec<FeedDeltaRow>) {
    if rows.is_empty() {
        return;
    }
    if let Err(e) = app.emit("feed-delta", FeedDeltaBatch { rows }) {
        warn!("failed to emit feed-delta event: {e}");
    }
}

#[derive(Debug)]
pub enum IndexingError {
    AlreadyRunning,
}

impl std::fmt::Display for IndexingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexingError::AlreadyRunning => {
                write!(f, "Indexing is already in progress; wait for it to finish")
            }
        }
    }
}

impl std::error::Error for IndexingError {}

/// Try to start a background indexing run.
///
/// Returns `Ok(())` immediately if a thread was spawned. Returns
/// `Err(AlreadyRunning)` without doing anything if a run is already in
/// flight.
///
/// The spawned thread:
/// 1. Sets `is_running = true` (already done before spawn — see below).
/// 2. Runs scan, model download, thumbnail, encode in order, emitting
///    events between phases and periodically inside long phases.
/// 3. Repopulates the cosine index from the DB so similarity search
///    works without waiting for the next user-triggered query.
/// 4. Emits `Phase::Ready` with the final image count.
/// 5. Sets `is_running = false`.
///
/// On any error inside the pipeline, the thread emits `Phase::Error`
/// with a message and clears `is_running`.
pub fn try_spawn_pipeline(
    app: AppHandle,
    state: Arc<IndexingState>,
    db_path: String,
    fusion: FusionSlots,
) -> Result<(), IndexingError> {
    // Acquire the single-flight slot atomically.
    if state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(IndexingError::AlreadyRunning);
    }

    thread::spawn(move || {
        // RAII guard ensures is_running gets cleared even if the body
        // panics, so a panic doesn't leave the app permanently locked.
        struct RunningGuard(Arc<IndexingState>);
        impl Drop for RunningGuard {
            fn drop(&mut self) {
                self.0.is_running.store(false, Ordering::SeqCst);
            }
        }
        let _guard = RunningGuard(state.clone());

        if let Err(e) = run_pipeline_inner(&app, &db_path, &fusion) {
            error!("pipeline error: {e}");
            emit(
                &app,
                Phase::Error,
                0,
                0,
                Some(format!("Indexing failed: {e}")),
            );
        }
    });

    Ok(())
}

/// The actual pipeline body. Errors propagate up and become a
/// `Phase::Error` event in the spawning closure.
///
/// `fusion` is `FusionIndexState.per_encoder` — the pipeline refreshes
/// the per-encoder slots at Ready (step 7) so post-index search reflects
/// the images this run encoded, and persists each flat store. There is no
/// longer a primary `CosineIndexState` to keep in sync: every search
/// command borrows the fusion slots (T3-2/#8), so the fusion caches are
/// the single source of truth the pipeline maintains.
#[tracing::instrument(name = "pipeline.run", skip(app, fusion))]
fn run_pipeline_inner(
    app: &AppHandle,
    db_path: &str,
    fusion: &FusionSlots,
) -> Result<(), Box<dyn std::error::Error>> {

    // 1. Make sure the model files are on disk. The download function
    //    now reports progress via callback so the UI's status pill can
    //    render a real determinate bar across the ~1 GB of downloads
    //    instead of the previous "Checking models..." flash followed
    //    by a multi-minute silent stretch.
    emit(app, Phase::ModelDownload, 0, 0, Some("Checking models...".into()));
    let app_for_progress = app.clone();
    let progress_cb = move |processed: u64, total: u64, current_file: Option<&str>| {
        let msg = current_file.map(|f| {
            if total > 0 {
                format!(
                    "Downloading {f} — {} / {} MB",
                    processed / 1_048_576,
                    total / 1_048_576
                )
            } else {
                format!("Downloading {f} — {} MB", processed / 1_048_576)
            }
        });
        // Tauri events take usize; cast carefully. The download is
        // capped at ~1.2 GB so usize::MAX is not in play even on 32-bit.
        let processed = processed.min(usize::MAX as u64) as usize;
        let total = total.min(usize::MAX as u64) as usize;
        emit(&app_for_progress, Phase::ModelDownload, processed, total, msg);
    };
    if let Err(e) = model_download::download_models_if_missing(progress_cb) {
        // Non-fatal: scan + thumbnail still work without models. Encode
        // gets skipped further down.
        warn!("model download skipped: {e}");
        emit(
            app,
            Phase::ModelDownload,
            0,
            0,
            Some(format!("Model download skipped: {e}")),
        );
    }

    // 1b. Pre-warm the text encoder so the user's first semantic search
    //     doesn't pause for ~1-2 seconds while the ONNX session and
    //     tokenizer load. We're already on a background thread inside
    //     the pipeline; absorbing the load cost here is invisible to
    //     the user (the indexing pill is already showing), whereas
    //     paying it later means the user types a query and stares at
    //     a spinner.
    {
        let models_dir = paths::models_dir();
        let model_precision = crate::settings::Settings::load()
            .effective_model_precision();
        // Bind the State separately so its lifetime extends across
        // the full block. Inlining `app.state::<TextEncoderState>()
        // .encoder.lock()` produces a temporary that the borrow
        // checker drops too early.
        let text_encoder_state: tauri::State<'_, TextEncoderState> =
            app.state::<TextEncoderState>();

        // CLIP text encoder pre-warm (was here before — unchanged).
        // Tokenizer path stays unquantized — it's vocab/merges data,
        // not model weights, so precision doesn't apply to it.
        let clip_model_path = paths::model_path_for(
            crate::model_download::CLIP_TEXT_FILENAME,
            &model_precision,
        );
        let clip_tokenizer_path =
            models_dir.join(crate::model_download::CLIP_TOKENIZER_FILENAME);
        if clip_model_path.exists() && clip_tokenizer_path.exists() {
            let lock_result = text_encoder_state.encoder.lock();
            if let Ok(mut lock) = lock_result {
                if lock.is_none() {
                    info!("pre-warming CLIP text encoder");
                    match ClipTextEncoder::new(&clip_model_path, &clip_tokenizer_path) {
                        Ok(encoder) => *lock = Some(encoder),
                        Err(e) => warn!("CLIP text encoder pre-warm failed: {e}"),
                    }
                }
            }
        }

        // Phase 12d — SigLIP-2 text encoder pre-warm. Mirrors the CLIP
        // path. Without this, the first text-image fusion query pays
        // ~2.4s of model-load cost (perf-1777226449 outlier #8) for
        // SigLIP-2 — visible to the user as a spinner. The CLIP text
        // encoder gets a real-input pre-warm via encode("warmup")
        // inside its own `new`; SigLIP-2 inherits the same on its own
        // construction path, so loading the encoder here is enough to
        // collapse the user-visible cold-start.
        let siglip2_model_path = paths::model_path_for(
            crate::similarity_and_semantic_search::encoder_siglip2::SIGLIP2_TEXT_MODEL_FILENAME,
            &model_precision,
        );
        let siglip2_tokenizer_path = models_dir.join(
            crate::similarity_and_semantic_search::encoder_siglip2::SIGLIP2_TOKENIZER_FILENAME,
        );
        if siglip2_model_path.exists() && siglip2_tokenizer_path.exists() {
            let lock_result = text_encoder_state.siglip2_encoder.lock();
            if let Ok(mut lock) = lock_result {
                if lock.is_none() {
                    info!("pre-warming SigLIP-2 text encoder");
                    match crate::similarity_and_semantic_search::encoder_siglip2::Siglip2TextEncoder::new(
                        &siglip2_model_path,
                        &siglip2_tokenizer_path,
                    ) {
                        Ok(encoder) => *lock = Some(encoder),
                        Err(e) => warn!("SigLIP-2 text encoder pre-warm failed: {e}"),
                    }
                }
            }
        }
    }

    // 2. Open a fresh DB handle. Mutex<Connection> coexists with the
    //    Tauri-managed one (rusqlite supports multiple connections to
    //    the same file).
    let database = ImageDatabase::new(db_path)?;
    database.initialize()?;

    // 3. Resolve the list of roots to scan. Multi-folder support means
    //    we walk every enabled root and tag each image with its source.
    let all_roots = database.list_roots()?;
    let enabled_roots: Vec<_> = all_roots.iter().filter(|r| r.enabled).collect();
    if enabled_roots.is_empty() {
        // Nothing to do — empty-state UI covers this case.
        emit(
            app,
            Phase::Ready,
            0,
            0,
            Some("No folders configured".into()),
        );
        return Ok(());
    }

    // 4. Scan every enabled root. We aggregate paths across roots so
    //    progress reflects total work, not per-folder progress.
    let _scan_phase = tracing::info_span!("pipeline.scan_phase").entered();
    emit(
        app,
        Phase::Scan,
        0,
        0,
        Some(format!("Scanning {} folder(s)", enabled_roots.len())),
    );
    let scanner = ImageScanner::new();

    // First pass: walk every enabled root, collect (path, root_id)
    // tuples. We keep per-root path sets so we can run the orphan
    // detection pass per-root in a moment.
    let mut all_paths: Vec<(String, i64)> = Vec::new();
    let mut paths_per_root: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    for root in &enabled_roots {
        let root_path = std::path::Path::new(&root.path);
        if !root_path.exists() {
            warn!(
                "configured root {} no longer exists; skipping",
                root.path
            );
            continue;
        }
        match scanner.scan_directory(root_path) {
            Ok(paths) => {
                let entry = paths_per_root.entry(root.id).or_default();
                for p in paths {
                    entry.push(p.clone());
                    all_paths.push((p, root.id));
                }
            }
            Err(e) => {
                warn!("scan of {} failed: {e}", root.path);
            }
        }
    }
    let total_found = all_paths.len();

    // A. Compute the genuinely-new paths — the only ones that need
    //    hashing and a relink/insert. Everything the DB already knows by
    //    path is either alive (nothing to do) or an orphan that
    //    mark_orphaned (step B) un-orphans if its file returned at the
    //    same path; neither case is a relink candidate. Read the current
    //    path set BEFORE mark_orphaned — it flips `orphaned` flags, not
    //    paths, so the set is unaffected by ordering. In steady state
    //    this collapses to empty, so a no-op rescan hashes and inserts
    //    nothing (the fast path below).
    let existing_paths_map = database.get_paths_to_root_ids()?;
    let existing_paths: std::collections::HashSet<&str> =
        existing_paths_map.keys().map(String::as_str).collect();
    let new_paths: Vec<(String, i64)> = all_paths
        .iter()
        .filter(|(p, _)| !existing_paths.contains(p.as_str()))
        .cloned()
        .collect();
    let new_count = new_paths.len();

    // B. Orphan-detection — MOVED AHEAD of the relink/insert below (it
    //    used to run AFTER insertion). Relink matches on `orphaned = 1`,
    //    and a moved file's SOURCE row (its old path) is only flagged
    //    orphaned here. So this MUST run before the relink pass, or a move
    //    is never detected: the source row would still read orphaned = 0
    //    at relink time and fail the (size, content_hash) match. The
    //    engine's relink tests assume exactly this order (orphan a row,
    //    THEN relink). The loop body is otherwise the pre-existing one.
    for root in &enabled_roots {
        // Only orphan a root that actually SCANNED. `paths_per_root` gets an
        // entry (possibly empty) for every root whose scan returned Ok, and NO
        // entry for a root that failed to scan (scan_directory is fail-fast —
        // one unreadable file or subdir aborts the whole root) or whose folder
        // is currently missing (the `!exists` skip above). That distinction is
        // load-bearing now that relink exists: falling through to an empty
        // alive-set here would orphan the WHOLE root on a transient I/O hiccup,
        // and step C would then relink those rows onto byte-identical files in
        // OTHER enabled roots — silently migrating their tags/placement/
        // embeddings and stranding the originals. So skip un-scanned roots
        // entirely; their rows are left untouched and recover on the next
        // successful scan. A root that scanned Ok-but-empty (folder genuinely
        // emptied) still has an entry, so real deletions are still detected.
        let Some(alive) = paths_per_root.remove(&root.id) else {
            continue;
        };
        match database.mark_orphaned(root.id, &alive) {
            Ok(n) if n > 0 => {
                info!("orphan-detection: {} rows marked orphaned in root {}", n, root.path);
            }
            Ok(_) => {}
            Err(e) => warn!("orphan-detection for root {} failed: {e}", root.path),
        }
    }

    // C. Hash the new files in PARALLEL, then relink/insert them SERIALLY.
    //    Hashing is decode/IO-bound and embarrassingly parallel; the
    //    relink is serial because determinism depends on each call
    //    committing before the next runs its SELECT — that is what makes
    //    two identical moved files drain two distinct orphaned rows,
    //    lowest id first. Do not parallelise the relink calls.
    if new_count == 0 {
        // Steady-state fast path: nothing new. Emit one coherent
        // scan-complete so the bar lands on 100% and skip hash/relink.
        emit(app, Phase::Scan, total_found, total_found, None);
    } else {
        // Re-prime the bar with the real work total so it climbs on a
        // first index (where every path is new).
        emit(app, Phase::Scan, 0, new_count, None);

        // Parallel hash. A hash failure (unreadable file, deleted mid-scan)
        // is recorded so the file still enters the catalog NULL-hashed via
        // the fallback below and gets picked up by the backfill pass or a
        // later scan; it is never silently dropped.
        enum HashResult {
            Hashed(String, i64, [u8; 32], u64),
            Failed(String, i64),
        }
        let hash_results: Vec<HashResult> = new_paths
            .par_iter()
            .map(|(path, root_id)| {
                match content_hash::hash_file(std::path::Path::new(path)) {
                    Ok((hash, size)) => HashResult::Hashed(path.clone(), *root_id, hash, size),
                    Err(e) => {
                        warn!("content hash failed for {path}: {e}");
                        HashResult::Failed(path.clone(), *root_id)
                    }
                }
            })
            .collect();

        let mut hashed: Vec<(String, i64, [u8; 32], u64)> = Vec::new();
        let mut unhashed: Vec<(String, i64)> = Vec::new();
        for result in hash_results {
            match result {
                HashResult::Hashed(p, rid, h, sz) => hashed.push((p, rid, h, sz)),
                HashResult::Failed(p, rid) => unhashed.push((p, rid)),
            }
        }

        // Serial relink/insert over the successfully-hashed files. Progress
        // climbs against new_count as each file lands. A single file's
        // failure is logged and skipped rather than aborting the pipeline.
        let mut relinked = 0usize;
        let mut inserted = 0usize;
        let mut processed = 0usize;
        let emit_every = (new_count / 4000).max(1);
        for (path, root_id, hash, size) in &hashed {
            match database.relink_or_insert(path, Some(*root_id), hash, *size as i64) {
                Ok(RelinkOutcome::Relinked { .. }) => relinked += 1,
                Ok(RelinkOutcome::Inserted { .. }) => inserted += 1,
                Err(e) => warn!("relink/insert failed for {path}: {e}"),
            }
            processed += 1;
            if processed.is_multiple_of(emit_every) || processed == new_count {
                emit(app, Phase::Scan, processed, new_count, None);
            }
        }
        info!(
            "content-hash relink: {relinked} moved file(s) relinked, {inserted} new file(s) inserted"
        );

        // Fallback for hash failures: insert with a NULL hash so the file
        // still shows in the grid; the backfill pass (step D) or a later
        // scan will hash it.
        if !unhashed.is_empty() {
            let mut fallback = 0usize;
            for (path, root_id) in &unhashed {
                match database.add_image(path.clone(), Some(*root_id)) {
                    Ok(()) => fallback += 1,
                    Err(e) => warn!("fallback add_image failed for {path}: {e}"),
                }
            }
            info!("content-hash relink: {fallback} file(s) inserted NULL-hash after hash failure");
        }

        // Terminal emit — land the bar exactly on new_count (the serial
        // loop above may stop short of it if some inserts errored, so pin
        // the final value explicitly).
        emit(app, Phase::Scan, new_count, new_count, None);
    }

    drop(_scan_phase);

    // D. Content-hash backfill — hash existing rows that predate content
    //    hashing (NULL hash). On a fresh index this is EMPTY (every row
    //    inserted above already carries its hash), so it is a no-op in
    //    steady state and on first indexes. It does real work only on the
    //    first launch AFTER upgrading: those rows already own thumbnails
    //    and embeddings, so hashing them here is that launch's main work
    //    and is what lets a future move relink them. A row whose hash
    //    fails stays NULL and is retried next run (idempotent —
    //    get_images_without_content_hash still returns it).
    let needs_hash = database.get_images_without_content_hash()?;
    if !needs_hash.is_empty() {
        let _backfill_span =
            tracing::info_span!("pipeline.content_hash_backfill").entered();
        let total_backfill = needs_hash.len();
        info!("content-hash backfill: hashing {total_backfill} existing row(s)");

        // Bounded pool — mirrors the eager-preview pass (step 7b). Hashing
        // reads whole files, so an all-cores par_iter would saturate I/O
        // against foreground use. Half the cores (min 2, max 4) keeps most
        // of the throughput while leaving headroom; fall back to the global
        // pool if the dedicated pool fails to build.
        let backfill_threads = bounded_pool_size();

        // Reuse Phase::Scan — a deliberate choice, not the old closed-set
        // constraint (that died when the phase map reopened and the
        // eager-preview pass got its own Phase::Previews). The hash
        // backfill is a one-time, scan-adjacent catch-up after the
        // content-hash upgrade; a dedicated phase for it would outlive
        // its single firing. The message carries the honest label into
        // the pill.
        emit(
            app,
            Phase::Scan,
            0,
            total_backfill,
            Some("Hashing existing images".into()),
        );

        // Shared monotonic progress — the same EncodeProgress the encode
        // phase uses, generalised to every bounded/high-water pass in this
        // pipeline (audit finding: three near-identical
        // completed/last_emit/emit_every triples, one per pass). `advance`
        // already does the "emit under the lock so concurrent workers stay
        // strictly increasing" discipline these passes need.
        let progress = EncodeProgress::new(total_backfill, emit_cadence(total_backfill));

        let run_backfill = || {
            needs_hash.par_iter().for_each(|(id, path)| {
                match content_hash::hash_file(std::path::Path::new(path)) {
                    Ok((hash, size)) => {
                        if let Err(e) = database.set_content_hash(*id, &hash, size as i64) {
                            warn!("backfill set_content_hash for image {id} failed: {e}");
                        }
                    }
                    Err(e) => warn!("backfill hash failed for {path}: {e}"),
                }

                progress.advance(1, |done| {
                    emit(
                        app,
                        Phase::Scan,
                        done,
                        total_backfill,
                        Some("Hashing existing images".into()),
                    );
                });
            });
        };

        run_on_bounded_pool("backfill", backfill_threads, run_backfill);
    }

    // 5. Thumbnails phase (rayon-parallel, runs to completion before
    //    encoder phase begins).
    //
    // Phase 12b reverted the previous "thumbnails + encoder in parallel"
    // overlap. That was a sound design when the encoder phase was
    // single-threaded — adding it to the rayon pool was tolerable. With
    // Phase 11e's per-encoder parallel execution (3 encoder threads,
    // each with its own ORT pool of 4 intra threads = 12 ORT threads
    // total) the thumbnail rayon workers were fighting 12 ORT threads
    // for the M2's 8 cores. The perf-1777226449 report showed CLIP
    // batches ballooning from 1.36s to ~12s under that contention, AND
    // the thumbnail wallclock per image rose from 19ms to 222ms.
    //
    // Doing thumbnails first exclusively (rayon owns the CPU) and then
    // encoders (parallel encoder threads own the CPU) gives each phase
    // a clean run at the hardware. We trade "user sees partial grid
    // earlier" for "everything finishes faster overall" — and the user
    // already sees thumbnails as they generate via the foreground
    // get_images polling, so the latency cost is small.
    let model_precision = crate::settings::Settings::load()
        .effective_model_precision();
    let image_model_path =
        paths::model_path_for(crate::model_download::CLIP_VISION_FILENAME, &model_precision);

    let _thumb_phase = tracing::info_span!("pipeline.thumbnail_phase").entered();
    //
    //    Per-image cost is dominated by JPEG decode+encode, which is
    //    embarrassingly parallel. The DB write under the mutex is
    //    microseconds vs ~100ms decode/encode, so contention there is
    //    negligible. On an M-series chip with 8-12 cores this gives
    //    a ~6-10x speedup vs the previous serial loop.
    // Base thumbnails are produced at the first bucket width (480). A
    // 1-column masonry tile is ~480 CSS px, so on a retina display the
    // base needs 480 real px to stay crisp. The wider buckets
    // (960/1440/2048) are pre-generated in a SECOND pass below, after
    // every base has landed — see the eager-bucket pass for why the split.
    let thumbnail_generator = ThumbnailGenerator::new(
        &paths::thumbnails_dir(),
        crate::commands::images::THUMBNAIL_BUCKETS[0],
    )?;
    let needs_thumbs = database.get_images_without_thumbnails()?;
    let total_thumbs = needs_thumbs.len();

    // Build a map from path -> root_id so each thumbnail lands in the
    // right per-root subfolder. Single SELECT — was N+1 before (audit
    // finding): `get_root_id_by_path` per image-needing-thumbnail held
    // the DB Mutex 1500 times in rapid succession on a typical first run.
    // The new `get_paths_to_root_ids` returns the entire (path, root_id)
    // map in one query, matching the pattern `populate_from_db` already
    // uses for embeddings. Shared by BOTH thumbnail passes (base + eager
    // buckets) so we run the query once, not per pass.
    //
    // unwrap_or_default preserves the previous failure semantic: if the
    // SELECT fails, downstream `generate_thumbnail` falls back to the
    // legacy flat thumbnail directory (root_id None). Skip the query
    // entirely when there's nothing to thumbnail.
    let path_to_root = if total_thumbs > 0 {
        database.get_paths_to_root_ids().unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    if total_thumbs > 0 {
        emit(app, Phase::Thumbnail, 0, total_thumbs, None);

        // EncodeProgress is the same monotonic-emit primitive the encode
        // phase uses, generalised here (audit finding: three near-
        // identical completed/last_emit/emit_every triples across the
        // pipeline). Emit at per-image granularity for typical libraries
        // so the thumbnail bar climbs continuously on a fresh index rather
        // than jumping in coarse buckets — the old `/10` (clamped to every
        // 25) fired only ~10-60 events for a whole library, so the bar sat
        // still between big jumps — the "feels like no progress" complaint.
        // `emit_cadence`'s `/4000` stays per-image (interval 1) up to 4000
        // images and caps the event rate to ≈4000 emits above that so a
        // 100k index is sane.
        let progress = EncodeProgress::new(total_thumbs, emit_cadence(total_thumbs));

        // T3-1 delta buffer: each successfully thumbnailed image becomes a
        // compact `feed-delta` row so the frontend can patch its manifest
        // cache in place instead of refetching the whole catalogue every
        // ~5s. Flushed at FEED_DELTA_BATCH under the lock (the same
        // "mutate-and-emit while held" discipline as `last_emit`), with a
        // terminal flush after the pass.
        let delta_buffer = std::sync::Mutex::new(Vec::<FeedDeltaRow>::new());

        needs_thumbs.par_iter().for_each(|need| {
            let crate::db::images_query::ThumbnailNeedRow { id, path, name } = need;
            let root_id = path_to_root.get(path).copied().flatten();
            match thumbnail_generator.generate_thumbnail(
                Path::new(path),
                *id,
                root_id,
            ) {
                Ok(result) => {
                    if let Err(e) = database.update_image_thumbnail(
                        *id,
                        &result.thumbnail_path,
                        result.original_width,
                        result.original_height,
                    ) {
                        warn!("DB update for thumbnail of image {} failed: {e}", id);
                    } else {
                        // Only rows whose DB write landed become deltas —
                        // the manifest cache must never claim a thumbnail
                        // the DB doesn't know about (a Ready reconcile
                        // would visibly un-pop the tile).
                        let row = FeedDeltaRow {
                            id: *id,
                            name: name.clone(),
                            width: result.original_width,
                            height: result.original_height,
                            thumbnail_path: result
                                .thumbnail_path
                                .to_string_lossy()
                                .into_owned(),
                        };
                        let mut buf = delta_buffer.lock().unwrap();
                        buf.push(row);
                        if buf.len() >= FEED_DELTA_BATCH {
                            let rows = std::mem::take(&mut *buf);
                            emit_feed_delta(app, rows);
                        }
                    }
                }
                Err(e) => {
                    warn!("thumbnail generation failed for {}: {e}", path);
                }
            }

            // Emit on every cadence-th image, plus always the final one so
            // the bar lands exactly on total. `advance` runs the emit under
            // its own high-water lock so concurrent workers stay monotonic
            // on the wire.
            progress.advance(1, |done| {
                emit(app, Phase::Thumbnail, done, total_thumbs, None);
            });
        });

        // Terminal delta flush — before the terminal Thumbnail progress
        // emit below, so the frontend's flush-on-phase-transition always
        // fires after every delta row has been delivered.
        let remaining = std::mem::take(&mut *delta_buffer.lock().unwrap());
        emit_feed_delta(app, remaining);
    }
    emit(app, Phase::Thumbnail, total_thumbs, total_thumbs, None);
    // The thumbnail span closes with the base pass. The eager high-res
    // preview pass (the wider 960/1440/2048 buckets) used to run HERE,
    // silently, between base thumbnails and encoding — which both hid its
    // progress and gated the encoder phase behind minutes of bucket work.
    // It has moved to step 7b below: after encoding and the fusion
    // refresh, with visible progress and a bounded-memory pool. See there
    // for the full rationale.
    drop(_thumb_phase);

    // 6. Encoder phase (Phase 12b: now strictly after thumbnails). The
    //    inside of `run_encoder_phase` still spawns one thread per
    //    enabled encoder via Phase 11e, so multiple encoders run
    //    concurrently — they just don't overlap with the thumbnail
    //    rayon loop above. Phase 12c also tunes intra_threads
    //    dynamically based on how many encoders are enabled, so the
    //    total ORT thread count stays at 4 regardless of N.
    if image_model_path.exists() {
        if let Err(e) = encode::run_encoder_phase(app, db_path, &image_model_path) {
            warn!("encoder phase failed: {e}");
        }
    } else {
        warn!(
            "{} missing; embeddings will be empty until next launch.",
            crate::model_download::CLIP_VISION_FILENAME
        );
    }

    // 7. Refresh + persist the per-encoder fusion caches.
    //
    //    Every search command borrows the fusion slots (T3-2/#8), so THIS
    //    is where post-index freshness is established: for each enabled
    //    encoder, if its slot's generation token no longer matches the DB
    //    (i.e. this run encoded new embeddings for it), repopulate the
    //    slot from the DB and re-persist its flat store so the next launch
    //    maps a current file. `refresh_if_stale` is token-gated, so an
    //    encoder this run didn't change is skipped for the cost of one
    //    cheap SQL aggregate — a no-op rescan does no repopulates.
    //
    //    This replaces the old primary `CosineIndexState` populate +
    //    save_to_disk: that primary cache had no readers after the search
    //    reroute (its ~205 MB owned block was pure waste), and refreshing
    //    it left the fusion slots — the caches searches actually read —
    //    stale after an index. One write lock per encoder (not one held
    //    across all) so a concurrent fused query can slip in between.
    let _cosine_phase = tracing::info_span!("pipeline.fusion_refresh").entered();
    for enc in crate::settings::Settings::load().resolved_enabled_encoders() {
        if let Ok(mut map) = fusion.write() {
            let entry = map.entry(enc.clone()).or_insert_with(CosineIndex::new);
            if entry.refresh_if_stale(&database, &enc) && !entry.cached_images.is_empty() {
                entry.save_store_for(&enc);
            }
        }
    }
    drop(_cosine_phase);

    // 7b. Eager high-res preview pass (formerly the silent "second
    //     thumbnail pass" between base thumbnails and encoding). It
    //     pre-generates the wider buckets (960/1440/2048) for every
    //     base-thumbnailed image so the masonry smooth-resize is instant
    //     from the first stretch instead of paying an on-demand
    //     decode+resize mid-gesture. Three things changed from the old
    //     inline pass, each fixing a confirmed live-telemetry problem:
    //
    //   (a) VISIBILITY. It emits real per-image progress under its own
    //       Phase::Previews (the frontend's phase map knows it), so the
    //       pill says "Preparing larger previews" while the settings
    //       drawer's base-thumbnail count sits — correctly — at 100%.
    //       It originally reused Phase::Thumbnail because the phase map
    //       was a closed set owned by a concurrently-working agent; that
    //       constraint is gone, and the reuse produced exactly the
    //       "pill says generating thumbnails but the previews count
    //       doesn't move" desync a live pass reported.
    //   (b) ORDERING. It runs AFTER the encoder phase (step 6) AND the
    //       fusion refresh (step 7), not before them. Encoding is core
    //       functionality and search readiness is established at step 7;
    //       high-res buckets are a resize nicety and get_thumbnail is the
    //       on-demand fallback for any bucket not yet generated. So a
    //       fresh index now does base → encode → search-ready → previews,
    //       which directly fixes the "stuck at thumbnails 100%, encoding
    //       not starting" report: the eager pass no longer gates
    //       encoding. The invariant the old pass protected still holds
    //       (base thumbnails land before any bucket), and the
    //       CPU-exclusivity intent is naturally satisfied — ORT is done
    //       by the time this runs, so buckets never fight encoder threads.
    //   (c) MEMORY. It runs on a bounded rayon pool so only a few
    //       full-resolution decodes are resident at once, capping the
    //       peak the unbounded all-cores par_iter caused (telemetry: RSS
    //       924 → 5,575 MiB at 2122 images).
    //
    //     Cost shape is otherwise unchanged: one decode per image at the
    //     largest bucket width (generate_buckets downscales every bucket
    //     from that single buffer), each bucket capped at the source
    //     width, sub-960 sources writing nothing. A fully-cached image
    //     (re-index) costs only stat calls and no decode.
    if total_thumbs > 0 {
        let _preview_span = tracing::info_span!("pipeline.eager_preview_pass").entered();
        let eager_buckets = &crate::commands::images::THUMBNAIL_BUCKETS[1..];

        // Bound peak memory: cap concurrent full-res decodes. Each preview
        // decode targets up to 2048px, versus the base pass's ~480px
        // (~1 MiB) — which is exactly why only THIS pass needs a cap and
        // the base pass does not. A large source's decode buffer plus its
        // resize scratch runs tens of MiB; at all-cores that footprint
        // scaled with core count and in-flight count, the 5.5 GiB spike.
        // Half the cores (min 2, max 4) keeps most of the throughput —
        // bucket work is decode/resize-bound, not perfectly core-scaling —
        // while bounding resident full-res decodes to ≤4, i.e. a few
        // hundred MiB of transient peak rather than multi-GiB. Not
        // serialised to 1 thread: that would roughly quarter throughput on
        // the M2 for no extra safety past the ≤4 bound.
        let preview_threads = bounded_pool_size();
        info!(
            "eager preview pass: {} threads over {} images",
            preview_threads, total_thumbs
        );

        // Same EncodeProgress monotonic-emit primitive as the backfill and
        // base thumbnail passes above (emit under its own lock so
        // concurrent workers report strictly increasing values).
        let progress = EncodeProgress::new(total_thumbs, emit_cadence(total_thumbs));
        // Prime the pill with a coherent 0/total under the honest message.
        emit(
            app,
            Phase::Previews,
            0,
            total_thumbs,
            Some("Preparing larger previews".into()),
        );

        // Per-bucket written totals, aggregated across workers and logged
        // at pass end — the "how many of each size did this run actually
        // produce" evidence a live desync report needed and couldn't get.
        let bucket_totals =
            std::sync::Mutex::new(std::collections::BTreeMap::<u32, usize>::new());
        let run_preview = || {
            needs_thumbs.par_iter().for_each(|need| {
                let crate::db::images_query::ThumbnailNeedRow { id, path, .. } = need;
                let root_id = path_to_root.get(path).copied().flatten();
                match thumbnail_generator.generate_buckets(
                    Path::new(path),
                    *id,
                    root_id,
                    eager_buckets,
                ) {
                    Ok(widths) => {
                        if !widths.is_empty() {
                            let mut totals = bucket_totals.lock().unwrap();
                            for w in widths {
                                *totals.entry(w).or_insert(0) += 1;
                            }
                        }
                    }
                    Err(e) => {
                        warn!("eager bucket generation failed for {}: {e}", path);
                    }
                }

                progress.advance(1, |done| {
                    emit(
                        app,
                        Phase::Previews,
                        done,
                        total_thumbs,
                        Some("Preparing larger previews".into()),
                    );
                });
            });
        };

        // Run on a dedicated bounded pool so the memory cap actually holds
        // (the global rayon pool is core-wide). If the pool fails to build
        // — unexpected — fall back to the global pool rather than skipping
        // previews, which would only cost the on-demand fallback later.
        run_on_bounded_pool("preview", preview_threads, run_preview);

        let totals = bucket_totals.lock().unwrap();
        if totals.is_empty() {
            info!("eager preview pass wrote nothing — every bucket already cached or capped");
        } else {
            info!(
                "eager preview pass wrote {}",
                totals
                    .iter()
                    .map(|(w, c)| format!("{c}×{w}px"))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }

    // 8. Done — total image count is what the user sees in the grid.
    // Audit finding: this used to be `get_all_images().map(|v| v.len())`
    // — the whole tag-join unroll + HashMap aggregation + materialise +
    // sort, run on EVERY pipeline pass including steady-state watcher
    // rescans, for one integer. `get_all_images` carries no WHERE, so
    // `get_pipeline_stats().total_images` (a bare `COUNT(*) FROM images`,
    // same writer connection) is byte-identical including orphaned and
    // disabled-root rows. Proofs: cha_l3_db_waste.rs, cha_b_ready_count.rs.
    let final_count = database
        .get_pipeline_stats()
        .map(|s| s.total_images.max(0) as usize)
        .unwrap_or(0);
    emit(
        app,
        Phase::Ready,
        final_count,
        final_count,
        Some(format!("{final_count} images indexed")),
    );

    Ok(())
}

fn emit(
    app: &AppHandle,
    phase: Phase,
    processed: usize,
    total: usize,
    message: Option<String>,
) {
    let payload = IndexingProgress {
        phase,
        processed,
        total,
        message,
    };
    if let Err(e) = app.emit("indexing-progress", &payload) {
        // Don't crash on emit failure — just log. Receivers may have
        // disconnected (closing window mid-pipeline).
        warn!("failed to emit event: {e}");
    }
}

/// Cadence divisor shared by every high-water progress emitter in this
/// pipeline (backfill, base thumbnails, eager previews, encode): per-item
/// (interval 1) up to 4000 items, capping the Tauri event rate to ≈4000
/// emits above that so a 100k-image pass doesn't fire ~100k events. The
/// old fixed-`/10`-clamped-to-25 cadence fired only ~10-60 events for a
/// whole library, which read as "stuck" between jumps.
const EMIT_CADENCE_DIVISOR: usize = 4000;

/// `(total / EMIT_CADENCE_DIVISOR).max(1)` — named once so every pass
/// computing an `EncodeProgress` cadence shares the same rule instead of
/// re-deriving the divisor at each call site. Ancestor-private: both this
/// file's own phases and the `encode` submodule's `run_encoder_phase`
/// call it, and a private item defined here is visible to that submodule
/// (a descendant) without any widening.
fn emit_cadence(total: usize) -> usize {
    (total / EMIT_CADENCE_DIVISOR).max(1)
}

/// Half the available cores, clamped 2-4 — the bounded-pool size shared
/// by the content-hash backfill and eager-preview passes. Both are
/// decode/IO-bound bulk work that would otherwise saturate all cores
/// against foreground use; half keeps most of the throughput while
/// leaving headroom (preview's fuller rationale: bounding peak memory,
/// see step 7b above).
fn bounded_pool_size() -> usize {
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).clamp(2, 4))
        .unwrap_or(2)
}

/// Run `f` on a dedicated rayon pool of `threads` workers named
/// `<prefix>-<i>`, falling back to the global pool if the dedicated pool
/// fails to build (unexpected, but real work should never be skipped for
/// a pool-creation error). Shared by the backfill and eager-preview
/// passes — audit finding: the two pool-build blocks were identical
/// except for the thread-name prefix.
fn run_on_bounded_pool<F: FnOnce() + Send>(prefix: &'static str, threads: usize, f: F) {
    match rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(move |i| format!("{prefix}-{i}"))
        .build()
    {
        Ok(pool) => pool.install(f),
        Err(e) => {
            warn!("{prefix} thread pool build failed ({e}); using the global pool");
            f();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexing_state_default_not_running() {
        let s = IndexingState::new();
        assert!(!s.is_running.load(Ordering::SeqCst));
    }

    #[test]
    fn phase_serialises_kebab_case() {
        let progress = IndexingProgress {
            phase: Phase::ModelDownload,
            processed: 1,
            total: 3,
            message: None,
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(
            json.contains("\"phase\":\"model-download\""),
            "expected kebab-case phase, got {json}"
        );
    }

    #[test]
    fn ready_phase_serialises() {
        let progress = IndexingProgress {
            phase: Phase::Ready,
            processed: 42,
            total: 42,
            message: Some("done".into()),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"phase\":\"ready\""));
        assert!(json.contains("\"processed\":42"));
        assert!(json.contains("\"message\":\"done\""));
    }

    #[test]
    fn single_flight_first_acquire_succeeds() {
        // Direct test of the AtomicBool gate semantics that
        // try_spawn_pipeline relies on. We don't actually spawn the
        // pipeline (it'd need a Tauri app handle) — just exercise
        // the compare_exchange behaviour.
        let state = IndexingState::new();
        let acquired = state
            .is_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst);
        assert!(acquired.is_ok());
        // Now the slot is held; second attempt should fail.
        let denied = state
            .is_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst);
        assert!(denied.is_err());
    }

    #[test]
    fn single_flight_releases_after_clear() {
        let state = IndexingState::new();
        state.is_running.store(true, Ordering::SeqCst);
        // Simulate the RAII guard's drop behaviour.
        state.is_running.store(false, Ordering::SeqCst);
        // The slot is open again.
        let reacquired = state
            .is_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst);
        assert!(reacquired.is_ok());
    }

    #[test]
    fn indexing_error_displays_human_readable_message() {
        let err = IndexingError::AlreadyRunning;
        let msg = format!("{err}");
        assert!(
            msg.contains("already in progress"),
            "expected human-readable AlreadyRunning message, got {msg}"
        );
    }

    #[test]
    fn all_phases_serialise_to_kebab_case() {
        for (variant, expected_str) in [
            (Phase::Scan, "scan"),
            (Phase::ModelDownload, "model-download"),
            (Phase::Thumbnail, "thumbnail"),
            (Phase::Previews, "previews"),
            (Phase::Encode, "encode"),
            (Phase::Ready, "ready"),
            (Phase::Error, "error"),
        ] {
            let progress = IndexingProgress {
                phase: variant,
                processed: 0,
                total: 0,
                message: None,
            };
            let json = serde_json::to_string(&progress).unwrap();
            let needle = format!("\"phase\":\"{}\"", expected_str);
            assert!(
                json.contains(&needle),
                "Phase {expected_str:?} did not serialise as expected: {json}"
            );
        }
    }
}
