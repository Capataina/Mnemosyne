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
//! 2. `set_scan_root` IPC command — the user picks a new folder; the
//!    DB is wiped and the same pipeline is spawned to populate it.
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

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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
use crate::similarity_and_semantic_search::encoder::ClipImageEncoder;
use crate::similarity_and_semantic_search::encoder_text::ClipTextEncoder;
use crate::thumbnail::ThumbnailGenerator;
use crate::TextEncoderState;

/// The per-encoder fusion caches (`FusionIndexState.per_encoder`). The
/// pipeline refreshes these at Ready so post-index search — which borrows
/// the fusion slots (T3-2/#8) — reflects the newly-encoded images, and
/// persists each encoder's flat store as it does so.
type FusionSlots = Arc<std::sync::RwLock<std::collections::HashMap<String, CosineIndex>>>;

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
            .model_precision
            .unwrap_or_default();
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
        let backfill_threads = std::thread::available_parallelism()
            .map(|n| (n.get() / 2).clamp(2, 4))
            .unwrap_or(2);

        // Reuse Phase::Scan — NOT a new Phase variant. The frontend's phase
        // map is a closed set owned by another agent; an unknown phase
        // blanks the status pill and hides it. This is the same reason the
        // eager-preview pass reuses Phase::Thumbnail; the message carries
        // the honest label into the pill.
        emit(
            app,
            Phase::Scan,
            0,
            total_backfill,
            Some("Hashing existing images".into()),
        );

        let completed = AtomicUsize::new(0);
        // High-water mark guarding monotonic emits — the same discipline
        // the thumbnail and eager-preview passes use (emit under the lock so
        // concurrent workers report strictly increasing values).
        let last_emit = std::sync::Mutex::new(0usize);
        let emit_every = (total_backfill / 4000).max(1);

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

                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done.is_multiple_of(emit_every) || done == total_backfill {
                    let mut last = last_emit.lock().unwrap();
                    if done > *last {
                        *last = done;
                        emit(
                            app,
                            Phase::Scan,
                            done,
                            total_backfill,
                            Some("Hashing existing images".into()),
                        );
                    }
                }
            });
        };

        match rayon::ThreadPoolBuilder::new()
            .num_threads(backfill_threads)
            .thread_name(|i| format!("backfill-{i}"))
            .build()
        {
            Ok(pool) => pool.install(run_backfill),
            Err(e) => {
                warn!("backfill thread pool build failed ({e}); using the global pool");
                run_backfill();
            }
        }
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
        .model_precision
        .unwrap_or_default();
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

        let completed = AtomicUsize::new(0);
        // High-water mark of the last value emitted. A Mutex (not an
        // atomic) because the emit happens WHILE it is held, so concurrent
        // rayon workers report in strictly increasing order and the bar
        // never blips backwards — the same discipline the encode phase's
        // EncodeProgress uses.
        let last_emit = std::sync::Mutex::new(0usize);
        // Emit at per-image granularity for typical libraries so the
        // thumbnail bar climbs continuously on a fresh index rather than
        // jumping in coarse buckets. The old `/10` (clamped to every 25)
        // fired only ~10-60 events for a whole library, so the bar sat
        // still between big jumps — the "feels like no progress" complaint.
        // `/4000` stays per-image (interval 1) up to 4000 images and caps
        // the event rate to ≈4000 emits above that so a 100k index is sane.
        let emit_every = (total_thumbs / 4000).max(1);

        // T3-1 delta buffer: each successfully thumbnailed image becomes a
        // compact `feed-delta` row so the frontend can patch its manifest
        // cache in place instead of refetching the whole catalogue every
        // ~5s. Flushed at FEED_DELTA_BATCH under the lock (the same
        // "mutate-and-emit while held" discipline as `last_emit`), with a
        // terminal flush after the pass.
        let delta_buffer = std::sync::Mutex::new(Vec::<FeedDeltaRow>::new());

        needs_thumbs.par_iter().for_each(|image| {
            let root_id = path_to_root.get(&image.path).copied().flatten();
            match thumbnail_generator.generate_thumbnail(
                Path::new(&image.path),
                image.id,
                root_id,
            ) {
                Ok(result) => {
                    if let Err(e) = database.update_image_thumbnail(
                        image.id,
                        &result.thumbnail_path,
                        result.original_width,
                        result.original_height,
                    ) {
                        warn!("DB update for thumbnail of image {} failed: {e}", image.id);
                    } else {
                        // Only rows whose DB write landed become deltas —
                        // the manifest cache must never claim a thumbnail
                        // the DB doesn't know about (a Ready reconcile
                        // would visibly un-pop the tile).
                        let row = FeedDeltaRow {
                            id: image.id,
                            name: image.name.clone(),
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
                    warn!("thumbnail generation failed for {}: {e}", image.path);
                }
            }

            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            // Emit on every `emit_every`-th image, plus always the final
            // one so the bar lands exactly on total. The emit runs under
            // the high-water lock so concurrent workers stay monotonic on
            // the wire.
            if done.is_multiple_of(emit_every) || done == total_thumbs {
                let mut last = last_emit.lock().unwrap();
                if done > *last {
                    *last = done;
                    emit(app, Phase::Thumbnail, done, total_thumbs, None);
                }
            }
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
        if let Err(e) = run_encoder_phase(app, db_path, &image_model_path) {
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
        let preview_threads = std::thread::available_parallelism()
            .map(|n| (n.get() / 2).clamp(2, 4))
            .unwrap_or(2);
        info!(
            "eager preview pass: {} threads over {} images",
            preview_threads, total_thumbs
        );

        let completed = AtomicUsize::new(0);
        // High-water mark guarding monotonic emits — same discipline as the
        // base thumbnail and encode phases (emit while the lock is held so
        // concurrent workers report strictly increasing values).
        let last_emit = std::sync::Mutex::new(0usize);
        let emit_every = (total_thumbs / 4000).max(1);
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
            needs_thumbs.par_iter().for_each(|image| {
                let root_id = path_to_root.get(&image.path).copied().flatten();
                match thumbnail_generator.generate_buckets(
                    Path::new(&image.path),
                    image.id,
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
                        warn!("eager bucket generation failed for {}: {e}", image.path);
                    }
                }

                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done.is_multiple_of(emit_every) || done == total_thumbs {
                    let mut last = last_emit.lock().unwrap();
                    if done > *last {
                        *last = done;
                        emit(
                            app,
                            Phase::Previews,
                            done,
                            total_thumbs,
                            Some("Preparing larger previews".into()),
                        );
                    }
                }
            });
        };

        // Run on a dedicated bounded pool so the memory cap actually holds
        // (the global rayon pool is core-wide). If the pool fails to build
        // — unexpected — fall back to the global pool rather than skipping
        // previews, which would only cost the on-demand fallback later.
        match rayon::ThreadPoolBuilder::new()
            .num_threads(preview_threads)
            .thread_name(|i| format!("preview-{i}"))
            .build()
        {
            Ok(pool) => pool.install(run_preview),
            Err(e) => {
                warn!("preview thread pool build failed ({e}); using the global pool");
                run_preview();
            }
        }

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
    let final_count = database.get_all_images().map(|v| v.len()).unwrap_or(0);
    emit(
        app,
        Phase::Ready,
        final_count,
        final_count,
        Some(format!("{final_count} images indexed")),
    );

    Ok(())
}

/// Shared, monotonic aggregate for the concurrent encode phase.
///
/// The bug this replaces: each of the (up to three) encoder threads used
/// to emit its OWN `processed/total` on the `encode` phase. With the
/// threads interleaving, a thread that had only just started would emit
/// `0/N` right after another thread had already reported real progress,
/// so the top-right status pill snapped back to `0/21` and stuck there
/// even while `get_pipeline_stats` (DB-backed) correctly climbed to
/// `21/21`. There was no single coherent counter the frontend could
/// trust, and no clean terminal `encode` value before `Phase::Ready`.
///
/// Now every encoder increments one shared counter. `processed` is the
/// number of image-encode completions summed across every *running*
/// encoder; `total` is the fixed sum of each running encoder's workload,
/// computed up front so the counter climbs monotonically to exactly
/// `total`. `advance` guards wire ordering: the emits run under
/// `last_emitted`, so with three encoder threads reporting concurrently
/// the pill only ever climbs — a batch whose whole range is below an
/// already-emitted value (a slower encoder landing after a faster one)
/// emits nothing. (Doing the emit *outside* the lock would reopen the
/// race: two threads could each decide to emit, then fire in reverse.)
///
/// Emit granularity is decoupled from the batch size: `encode_batch`
/// processes 32 images at once for throughput, but `advance` emits each
/// crossed cadence value (per-image by default) so the aggregate bar
/// climbs smoothly instead of jumping a whole batch of 32 at a time.
struct EncodeProgress {
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
    fn new(total: usize, emit_interval: usize) -> Self {
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
    fn advance<F: FnMut(usize)>(&self, n: usize, mut emit_fn: F) {
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

/// Encoder phase — runs the CLIP image encoder over every row that
/// doesn't yet have an embedding, in batches of 32. Lives on its own
/// thread (spawned from `run_pipeline_inner` in parallel with the
/// thumbnail rayon loop) so its single-threaded ONNX inference doesn't
/// block the multi-core JPEG codec work that happens alongside.
///
/// Opens its own `ImageDatabase` (separate SQLite connection) so it
/// doesn't contend with the thumbnail thread for the same Mutex.
/// WAL mode (initialise() pragmas) makes the concurrent writes safe —
/// thumbnails write the `thumbnail_path/width/height` columns, this
/// writes `embedding`; no row-level conflict because the columns are
/// disjoint and SQLite's WAL serialises commits at the page level
/// without blocking readers.
fn run_encoder_phase(
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
    // Why no `_encode_phase` span: each encoder thread opens its own
    // span via `run_clip_encoder` / `run_trait_encoder`'s tracing
    // instrumentation, so a parent span here would mostly capture
    // join wait time, not actual work. Leaving it omitted keeps the
    // perf report's per-encoder timings clean.
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
    let model_precision = settings.model_precision.unwrap_or_default();

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
    let intra_per_encoder = (super::similarity_and_semantic_search::ort_session::DEFAULT_INTRA_THREADS
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
    // with the SAME query each encoder drives its loop from, so the
    // shared counter climbs to exactly `total` and no further; a
    // missing-model or already-complete encoder contributes 0 and never
    // moves it. Each encoder is the sole writer of its own embeddings, so
    // its count is stable between this precompute and the thread's own
    // requery — no double-count risk.
    let aggregate_total = {
        let counts_db = ImageDatabase::new(db_path).map_err(|e| e.to_string())?;
        counts_db.initialize().map_err(|e| e.to_string())?;
        enabled
            .iter()
            .map(|id| match id.as_str() {
                // CLIP's model presence is guaranteed by the caller (it
                // only invokes run_encoder_phase when image_model_path
                // exists). It counts via the SAME per-encoder query its
                // loop now uses (`get_images_without_embedding_for`), so a
                // fully-indexed launch contributes 0 here → total 0 → no
                // encode phase → the pill doesn't flash.
                "clip_vit_b_32" => counts_db
                    .get_images_without_embedding_for("clip_vit_b_32")
                    .map(|v| v.len())
                    .unwrap_or(0),
                "siglip2_base" if siglip2_path.exists() => counts_db
                    .get_images_without_embedding_for("siglip2_base")
                    .map(|v| v.len())
                    .unwrap_or(0),
                "dinov2_base" if dinov2_path.exists() => counts_db
                    .get_images_without_embedding_for(
                        crate::similarity_and_semantic_search::encoder_dinov2::DINOV2_ENCODER_ID,
                    )
                    .map(|v| v.len())
                    .unwrap_or(0),
                _ => 0,
            })
            .sum::<usize>()
    };

    // Emit at per-image granularity for typical libraries so the bar
    // climbs smoothly rather than jumping a batch of 32; cap the Tauri
    // event rate at very large scales so a 100k×3-encoder index doesn't
    // fire ~300k events. `/ 4000` keeps it per-image (interval 1) up to
    // 4000 encode-units — comfortably covering the fresh small/medium
    // libraries the "feels stuck" complaint is about — and bounds the
    // phase to ≈4000 emits above that.
    let emit_interval = (aggregate_total / 4000).max(1);
    let progress = Arc::new(EncodeProgress::new(aggregate_total, emit_interval));
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
                "clip_vit_b_32" => {
                    run_clip_encoder_with_intra(&app, &database, &image_model_path, intra, &progress)
                }
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

/// CLIP encoder phase — writes BOTH the legacy `images.embedding`
/// column (kept for backward-compat with semantic_search's existing
/// reader) AND the new `embeddings` table row keyed by encoder_id.
/// This double-write goes away in a future migration once everyone
/// has re-indexed.
/// Phase 12c — CLIP encoder loop. Takes an explicit intra-thread
/// count so the indexing pipeline can size each parallel encoder's
/// ORT pool appropriately. See `ort_session.rs::build_tuned_session_with_intra`.
/// (The previous `run_clip_encoder(app, db, path)` wrapper was
/// dropped — every caller goes through the with-intra form now.)
fn run_clip_encoder_with_intra(
    app: &AppHandle,
    database: &ImageDatabase,
    model_path: &Path,
    intra_threads: usize,
    progress: &EncodeProgress,
) -> Result<(), String> {
    // Needs-set from the PER-ENCODER embeddings store (encoder_id
    // "clip_vit_b_32"), exactly as SigLIP-2 / DINOv2 do — NOT the legacy
    // `images.embedding IS NULL` column. Under R8 (legacy_clip_too =
    // false) that legacy column is never written, so the old query
    // returned the entire library on every launch and CLIP re-encoded
    // everything, flashing "Encoding 100%" in the pill even on a
    // fully-indexed library. Reading the per-encoder table means an
    // already-encoded image is correctly skipped (fully-indexed launch →
    // empty set → no encode work), and it also excludes orphaned rows
    // (deleted files) the way the legacy query did not. Returns
    // `Vec<(ID, String)>` rather than `Vec<ImageData>`, so the loop below
    // is tuple-shaped like run_trait_encoder.
    let needs_embed = database
        .get_images_without_embedding_for("clip_vit_b_32")
        .map_err(|e| e.to_string())?;
    let total = needs_embed.len();
    if total == 0 {
        return Ok(());
    }
    // No per-encoder start emit here anymore — the phase-level 0/total is
    // emitted once by run_encoder_phase, and every chunk below reports the
    // shared aggregate counter, so three concurrent encoders can never
    // stomp each other back to 0.

    let run_started = std::time::Instant::now();
    let mut encoder = ClipImageEncoder::new_with_intra(model_path, intra_threads)
        .map_err(|e| e.to_string())?;
    const BATCH_SIZE: usize = 32;
    let mut processed = 0usize;
    let mut succeeded = 0usize;
    let mut failed_paths: Vec<String> = Vec::new();
    let mut sample_emitted = false;
    for chunk in needs_embed.chunks(BATCH_SIZE) {
        let batch_paths: Vec<&Path> = chunk.iter().map(|(_, p)| Path::new(p)).collect();
        match encoder.encode_batch(&batch_paths) {
            Ok(embeddings) => {
                // Preprocessing/embedding sample diagnostic — fires
                // once per encoder run on the first successful batch.
                // Captures dim, L2 norm, range, NaN count of the first
                // embedding so the report can show "CLIP first encoded
                // image: 512-d, norm=1.000, range [-0.18, 0.21], no
                // NaNs" — pinpoints encoder breakage early.
                if !sample_emitted {
                    if let (Some((_, first_path)), Some(first_emb)) =
                        (chunk.first(), embeddings.first())
                    {
                        emit_preprocessing_sample("clip_vit_b_32", first_path, first_emb);
                        sample_emitted = true;
                    }
                }
                // R1 — single-transaction batch write of every row in
                // this chunk. R8 — legacy_clip_too = false: we no
                // longer double-write to the legacy images.embedding
                // column. The schema bump to pipeline version 3 wipes
                // any stale legacy data, so the cosine populate
                // fallback path (cosine/index.rs) just sees an empty
                // legacy column on first re-index and reads from the
                // per-encoder embeddings table only.
                let batch_rows: Vec<(crate::db::ID, Vec<f32>)> = chunk
                    .iter()
                    .zip(embeddings.iter())
                    .map(|((id, _), emb)| (*id, emb.clone()))
                    .collect();
                let row_count = batch_rows.len();
                match database.upsert_embeddings_batch(
                    "clip_vit_b_32",
                    &batch_rows,
                    false,
                ) {
                    Ok(()) => succeeded += row_count,
                    Err(e) => {
                        // Whole batch failed at the DB level — record
                        // every row as a write failure rather than
                        // pretending some succeeded.
                        let err_str = e.to_string();
                        for (_, path) in chunk.iter() {
                            failed_paths.push(format!("{path}: db batch — {err_str}"));
                        }
                    }
                }
            }
            Err(e) => {
                // Whole batch failed — record each path as a failure
                // with the shared error rather than aborting indexing.
                let err_str = e.to_string();
                for (_, path) in chunk.iter() {
                    failed_paths.push(format!("{path}: encode_batch — {err_str}"));
                }
            }
        }
        processed += chunk.len();
        // Report against the shared aggregate at per-image granularity so
        // the bar climbs smoothly rather than jumping this batch of 32 at
        // once. Emits fire only while locked and only as the value climbs,
        // so a slower encoder can never blip the pill backwards.
        progress.advance(chunk.len(), |done| {
            emit(app, Phase::Encode, done, progress.total, Some("Encoding".into()));
        });
        // R3 — drain the WAL between batches so it can't grow without
        // bound under wal_autocheckpoint=0. PASSIVE never blocks
        // foreground readers; it just folds whatever pages are clean
        // back into the main DB.
        let _ = database.checkpoint_passive();
    }

    // Emit a per-encoder run summary so the report shows
    // "CLIP attempted 1842, succeeded 1840, failed 2 (sample paths
    // ...), mean 12.3 ms/image". Failed-path samples turn an opaque
    // 0.1% failure rate into something a user can diagnose.
    let elapsed_ms = run_started.elapsed().as_millis() as u64;
    let mean_per_image_ms = if processed > 0 { elapsed_ms as f64 / processed as f64 } else { 0.0 };
    crate::perf::record_diagnostic(
        "encoder_run_summary",
        serde_json::json!({
            "encoder_id": "clip_vit_b_32",
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

/// Generic per-encoder loop using the ImageEncoder trait. Used for
/// SigLIP-2 + DINOv2; each writes only to the new embeddings table.
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
    // No per-encoder start emit — see run_clip_encoder_with_intra: the
    // phase-level 0/total and the shared aggregate below replace the old
    // per-encoder counter that produced the sticky-0/21 bug.

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
                // R1 — same BEGIN IMMEDIATE batch write as the CLIP
                // path. legacy_clip_too = false because only CLIP
                // double-writes to the legacy column.
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

    // Per-encoder run summary diagnostic — same shape as the CLIP
    // path. Lets the report show side-by-side cost + failure rates
    // across CLIP / SigLIP-2 / DINOv2.
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
