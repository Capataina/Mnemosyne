# indexing

*Maturity: comprehensive · Stability: stable phase spine, actively-tuned encode/refresh internals (batch inference, per-encoder parallelism, and the fusion-refresh step all landed in the 100k performance round)*

## Scope / Purpose

The background pipeline that turns a freshly-launched (or freshly-triggered) app into a usable catalogue. Owns the orchestration of: model download (if needed), text-encoder pre-warm (CLIP + SigLIP-2), multi-root scan (content-hash relink — a moved/renamed file is matched back to its orphaned row instead of re-indexed as new), orphan detection, parallel thumbnail generation (base + eager higher-resolution buckets), per-encoder parallel embedding (SigLIP-2/DINOv2 batched inference, CLIP per-image), and per-encoder fusion-cache refresh + persistence. Runs on a dedicated thread spawned from the Tauri `setup` callback (or from any command that mutates the root list) and emits structured `IndexingProgress` events plus batched `feed-delta` events so the frontend renders both a live progress pill and live-updating feed tiles during a run.

This system is what made the Phase 5 transition from "blocking pre-Tauri startup" to "window opens immediately and progress shows in the UI" possible, and the 100k performance round is what made a 100k-image first index behave — batched scan inserts, a reverse tag index, batch inference for two of the three encoders, and per-image progress emits all trace back to this file or its call sites.

## Boundaries / Ownership

- **Owns:** the pipeline lifecycle, single-flight gating (`AtomicBool`), the `IndexingProgress` event payload shape, the `feed-delta` batched event shape (`FeedDeltaRow`/`FeedDeltaBatch`), the per-phase tracing instrumentation (`pipeline.scan_phase`, `pipeline.content_hash_backfill`, `pipeline.thumbnail_phase`, `pipeline.eager_bucket_pass`, `pipeline.fusion_refresh`; each encoder's own `run_clip_encoder`/`run_trait_encoder` span covers the encode phase — see below), the shared monotonic `EncodeProgress` aggregate that keeps three concurrent encoder threads' progress emits coherent.
- **Does not own:** any SQL (delegates to `db/`), any encoder math (delegates to `similarity_and_semantic_search::encoder`/`encoder_siglip2`/`encoder_dinov2`/`encoder_text`), any cosine retrieval or the per-encoder fusion caches themselves (delegates to `similarity_and_semantic_search::cosine_similarity::CosineIndex` and `FusionIndexState` — see `systems/multi-encoder-fusion.md`), the watcher itself (delegates to `watcher.rs`), the feed manifest's frontend-side merge/cache logic (delegates to `systems/feed-protocol.md`), content-hash computation itself (delegates to the engine crate's `content_hash::hash_file`, consumed via `db::content_hash::relink_or_insert` — see `systems/database.md`'s "Content-hash relink" section).
- **Public API:** `IndexingState::new()`, `try_spawn_pipeline(app, state, db_path, fusion) -> Result<(), IndexingError>` — `fusion` is `FusionIndexState.per_encoder` (`Arc<RwLock<HashMap<String, CosineIndex>>>`), replacing the pre-100k-round `cosine_index: Arc<Mutex<CosineIndex>>` primary-index parameter now that the primary `CosineIndexState` is gone (`1514a90`) — `IndexingProgress { phase, processed, total, message }`, `Phase` enum (kebab-case serialised), `FeedDeltaRow` / `FeedDeltaBatch` (T3-1).

## Current Implemented Reality

### Spawn lifecycle

```rust
// commands::roots::set_scan_root + add_root, lib.rs setup callback,
// watcher::start callback all call:
indexing::try_spawn_pipeline(app, indexing_state.clone(), db_path, cosine_index.clone())?;
```

The function does an atomic `compare_exchange(false, true)` on `IndexingState.is_running`. On failure (a pipeline already in flight) it returns `Err(IndexingError::AlreadyRunning)` without spawning anything. Callers map this to `ApiError::Internal(...)` for the IPC return.

On success the spawned thread:

1. Wraps the body in a `RunningGuard(Arc<IndexingState>)` whose `Drop` clears the bool — even a panic in the pipeline body cannot leave `is_running = true` and lock out future runs.
2. Calls `run_pipeline_inner(&app, &db_path, &cosine_index)` which is fully `tracing::instrument`-ed.
3. On `Err(_)` from the inner body, emits `Phase::Error` with the message string. The user sees the error in the indexing pill and can retry by switching folders or restarting.

### Phase ordering

```text
Phase::ModelDownload (from cache check + downloads)
    ──► download_models_if_missing(progress_cb)
        Progress callback emits Phase::ModelDownload events with
        bytes processed / bytes total + filename in message.
    ──► Pre-warm CLIP text encoder if model + tokenizer exist (NOT a phase event)
    ──► Pre-warm SigLIP-2 text encoder if model + tokenizer exist (NOT a phase event, Phase 12d)

Phase::Scan
    ──► Open second ImageDatabase (rusqlite supports concurrent connections; WAL keeps it cheap)
    ──► db.list_roots() → filter enabled
    ──► For every enabled root:
            ImageScanner::scan_directory(root_path) → Vec<String>
            collect into all_paths + paths_per_root
    ──► A. db.get_paths_to_root_ids() (single SELECT) → diff against all_paths →
            new_paths (the only ones needing a hash + relink/insert; everything
            else the DB already knows by path is either alive or an orphan that
            step B un-orphans at the SAME path — neither is a relink candidate).
            Read BEFORE step B: mark_orphaned only flips `orphaned`, never
            `path`, so the diff is unaffected by ordering.
    ──► B. For every enabled root:
            db.mark_orphaned(root_id, alive_paths_for_that_root) — diff in Rust + chunked UPDATE
            MUST run BEFORE step C: relink matches `orphaned = 1`, and a moved
            file's SOURCE row is only flagged orphaned here — relinking first
            would still see that row as orphaned = 0 and never match it
            (content-hash relink — see `systems/database.md`).
    ──► C. new_paths is empty → emit Phase::Scan(total, total) and skip to D
            (steady-state fast path: a no-op rescan hashes and inserts
            nothing). Otherwise:
              rayon par_iter: content_hash::hash_file(path) → (hash, size) —
                parallel, decode/IO-bound
              SERIALLY, in order: db.relink_or_insert(path, root_id, hash, size)
                → Relinked{id} (moved file, matched an orphaned row's
                  (size, content_hash)) or Inserted{id} (genuinely new).
                Serial is load-bearing: two identical moved files must drain
                two distinct orphaned rows, lowest id first — only holds if
                each call commits before the next runs its SELECT.
              db.add_image(path, root_id) — NULL-hash fallback for any file
                whose hash_file() call failed (unreadable, deleted mid-scan)
              emit Phase::Scan(processed, new_count) at a total/4000-scaled interval
    ──► D. Content-hash backfill (runs after the scan/relink pass above, still
            before the thumbnail phase): db.get_images_without_content_hash()
              → hash each via content_hash::hash_file → db.set_content_hash(...)
            on a bounded rayon pool (half the cores, clamped 2-4)
            empty/no-op on a fresh index or steady-state rescan — every row
              already hashed; does real work only on the first launch after
              upgrading (pre-existing rows backfilled once)
            reuses Phase::Scan, message "Hashing existing images" — NOT a new
              Phase variant (the frontend's phase map is a closed set; an
              unknown phase blanks the status pill and hides it)

Phase::Thumbnail
    ──► db.get_paths_to_root_ids() → HashMap<path, Option<root_id>>  (single SELECT, audit fix)
    ──► db.get_images_without_thumbnails() → Vec<ImageData>
    ──► rayon par_iter (base 480px thumbnail — pop-in pass):
            ThumbnailGenerator::generate_thumbnail(path, image.id, root_id)
            db.update_image_thumbnail(image.id, &thumb_path, w, h)
            → on success, buffer a FeedDeltaRow; flush as a batched `feed-delta`
              event every 64 rows (T3-1 — see below)
            emit Phase::Thumbnail at ~per-image granularity up to 4000 images,
              capped above that (AtomicUsize + high-water-mark Mutex keeps
              concurrent rayon workers monotonic on the wire)
    ──► terminal feed-delta flush (BEFORE the terminal Phase::Thumbnail emit,
          so any frontend phase-transition handling always runs after every
          delta has been delivered)
    ──► rayon par_iter (eager higher-resolution buckets — second pass, SEPARATE
          from the pop-in pass so the base 480 thumbnail's decode never waits on
          a heavier one):
            ThumbnailGenerator::generate_buckets(path, id, root_id, [960, 1440, 2048])
            (no progress events — this pass is invisible to the pill by design)

Phase::Encode — one thread PER enabled encoder, running CONCURRENTLY (Phase 11e/12c)
    ──► Precompute an aggregate workload total across every encoder that will
          actually run (enabled AND model present), from the SAME per-encoder
          query each thread's own loop uses — this is what lets three
          concurrently-emitting threads share ONE coherent, monotonic counter
          instead of each emitting its own processed/total (the "sticky 0/21"
          bug this design replaces — see EncodeProgress below).
    ──► intra_threads is dynamic (Phase 12c): DEFAULT_INTRA_THREADS / enabled.len(),
          so N concurrent ORT sessions never oversubscribe past the fixed
          per-machine thread budget (4 on the M2 P-cluster) regardless of how
          many encoders are enabled.
    ──► Thread 1 — CLIP via run_clip_encoder_with_intra (clip_vision.onnx):
            db.get_images_without_embedding_for("clip_vit_b_32")
            For every chunk of 32: preprocess in chunks of 32, but run ONE
              ONNX inference PER IMAGE ([1,3,224,224]) — the OpenCLIP vision
              export has a FIXED batch dim of 1; batching the ONNX call itself
              produced a silent "Got invalid dimensions" failure that zeroed
              CLIP's embeddings while the other two encoders encoded fine.
              Re-export would touch model weights provenance (a live pre-sale
              concern), so CLIP stays per-image at the inference boundary.
            db.upsert_embeddings_batch("clip_vit_b_32", &batch_rows, false)  — R1
            db.checkpoint_passive()  — R3, drains WAL between batches
            progress.advance(chunk.len(), |done| emit Phase::Encode(done, aggregate_total))
    ──► Thread 2 — SigLIP-2 via run_trait_encoder("siglip2_base", ...) (if siglip2_vision.onnx exists):
            db.get_images_without_embedding_for("siglip2_base")
            encoder.encode_batch(&paths) — TRUE batched inference: one
              [N,3,256,256] ONNX call per chunk (capped at 32 internally),
              because the SigLIP-2 vision export declares dynamic batch dims.
              ~1.2-2x win on the inference portion on CPU-only ORT (not a
              GPU-style N-calls-to-1 collapse).
            same R1 batch write + R3 checkpoint + progress.advance as CLIP
    ──► Thread 3 — DINOv2-Base via run_trait_encoder("dinov2_base", ...) (if dinov2_base_image.onnx exists):
            same shape as SigLIP-2 — dynamic-batch export, true [N,3,H,W] inference
    ──► Each encoder thread is independently fail-soft: a missing model file
          or a session-creation error skips that encoder with `warn` and the
          other threads proceed unaffected. Every thread joins before the
          phase returns; the FIRST error is surfaced but every thread is
          waited on so a fast-failing CLIP can't leave SigLIP-2/DINOv2 mid-encode.
    ──► Per-encoder "encoder_run_summary" diagnostic at the end of each pass:
          { encoder_id, attempted, succeeded, failed, elapsed_ms,
            mean_per_image_ms, failed_sample[≤10] }
    ──► There is no more "priority encoder runs first" ordering — Phase 5's
          RRF fusion uses every enabled encoder, so no single encoder's
          completion is more valuable than another's, and there is no longer
          a single primary cache to hot-populate as one pass finishes.

Step 7 — refresh + persist the per-encoder fusion caches (NOT a Phase:: variant;
          runs between Encode and Ready, replacing the old "cosine repopulate")
    ──► For every enabled encoder:
            CosineIndex::refresh_if_stale(&database, encoder_id) — recomputes
              db.embedding_generation_token(encoder_id) and repopulates the
              fusion slot ONLY on a token mismatch (a no-op rescan costs one
              SQL aggregate, no repopulate)
            on repopulate, persist that encoder's flat store (save_store_for)
    ──► One write lock taken PER ENCODER, released between encoders — not one
          lock held across all three — so a concurrent fused query can slip in
          between. See systems/multi-encoder-fusion.md for the flat-store
          format and systems/database.md for embedding_generation_token.

Phase::Ready (db.get_all_images().len() in the message)
```

Source: `indexing.rs:230-969` (`run_pipeline_inner`; the scan-phase reorder — steps A-D above — lives at `indexing.rs:411-622`), `indexing.rs:1058-1290` (`run_encoder_phase`), `indexing.rs:1302-1433` (CLIP, `run_clip_encoder_with_intra`) / `indexing.rs:1437-` (`run_trait_encoder`, shared by SigLIP-2 + DINOv2). The phase enum is serialised kebab-case (`#[serde(rename_all = "kebab-case")]`) so the frontend `useIndexingProgress`/`useIndexingStatus` hook keys on `"model-download" | "scan" | "thumbnail" | "encode" | "ready" | "error"`.

### `EncodeProgress` — the shared monotonic counter (fixes the sticky-`0/21` bug)

Before per-encoder parallelism, each encoder thread emitted its OWN `processed/total` on the `encode` phase. With threads interleaving, a thread that had just started emitted `0/N` right after another thread had already reported real progress — the pill visibly snapped backward and stuck, even while the DB-backed `get_pipeline_stats` correctly climbed. `EncodeProgress` is one shared counter every encoder thread increments: `processed` is completions summed across every *running* encoder, `total` is the fixed sum of each running encoder's workload computed up front, and `advance()` guards wire ordering so the emitted value only ever climbs. This is the same "high-water-mark lock held across mutation + emit" discipline the thumbnail phase's `last_emit` Mutex uses.

### `feed-delta` events — batched, per-thumbnail, T3-1

```rust
pub struct FeedDeltaRow {
    pub id: i64,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub thumbnail_path: String,
}
pub struct FeedDeltaBatch { pub rows: Vec<FeedDeltaRow> }
const FEED_DELTA_BATCH: usize = 64;
```

`indexing.rs:99-138` (types + `emit_feed_delta`), buffered and flushed inside the thumbnail phase's rayon loop (`indexing.rs:714-769` — shifted down from the scan phase's pre-reorder line numbers by the content-hash relink round's insertions ahead of it). Every successfully-thumbnailed image becomes a delta row — buffered under the same Mutex discipline as the progress high-water mark, flushed as a Tauri `feed-delta` event every 64 rows, with a terminal flush before the phase-ending `Phase::Thumbnail` progress emit (so any frontend phase-transition logic always runs after the last delta). At 100k images this yields ~1.5k events across the whole thumbnail phase; the frontend additionally throttles cache application to a ~5s cadence, so event count is an IPC-payload-size concern, not a render-frequency one. Only rows whose DB write actually landed become deltas — the manifest cache must never claim a thumbnail the DB doesn't know about (a later `Phase::Ready` reconcile would visibly un-pop the tile). This event, together with `get_feed_manifest`, is what killed the every-5s full `["images"]` refetch cycle — see `systems/feed-protocol.md` and `systems/database.md`'s "T3-1" section for the consuming/producing halves.

### Single-flight semantics

The `AtomicBool` guarantee is "at most one pipeline running at any time across the whole app." Why:

- Watcher events arrive in 5s-debounced batches (`watcher.rs`). A bulk file drop produces one event, but two near-simultaneous user actions (set_scan_root + watcher event) could otherwise spawn two pipelines. Single-flight makes both safe — the second spawn returns `Err(AlreadyRunning)` and is silently coalesced.
- The DB writes are idempotent under WAL (`INSERT OR IGNORE`, `UPDATE WHERE id = ?`), so two concurrent pipelines wouldn't corrupt anything — they'd just waste CPU.
- The per-encoder flat-store persistence (step 7, `save_store_for`) is the most write-sensitive step (overwrites `embstore_<encoder>.bin` per enabled encoder); two simultaneous pipelines would race and one would lose. Single-flight prevents this.
- The on-spawn call site is consistent across `set_scan_root`, `add_root`, the watcher debounce callback, and the lib.rs setup callback — every trigger goes through `try_spawn_pipeline`.

### Fusion-cache warm at launch lives OUTSIDE this file now

Pre-100k-round, `run_pipeline_inner` had a "step 0" that opportunistically loaded a cached cosine index from disk before the rest of the pipeline ran. That logic has moved: `lib.rs::spawn_cache_warm` (spawned once at `run()`, independent of `try_spawn_pipeline`) now maps each enabled encoder's persisted flat store (`embstore_<encoder>.bin`, zero-copy mmap) into the `FusionIndexState` slots right at launch, on its own thread, before the indexing pipeline even starts. On a miss or stale file it DB-populates and writes the store back so the *next* launch maps it. This means the indexing pipeline (this file) no longer does any cache-loading of its own on entry — its only cosine-cache responsibility is step 7's `refresh_if_stale` + persist, after encoding. See `systems/multi-encoder-fusion.md` for `spawn_cache_warm`'s full contract and the flat-store format.

### Pre-warm text encoders — both CLIP and SigLIP-2 (Phase 12d)

```rust
let text_encoder_state: tauri::State<'_, TextEncoderState> = app.state::<TextEncoderState>();

// CLIP English text encoder — unchanged from earlier phases.
if let Ok(mut lock) = text_encoder_state.encoder.lock() {
    if lock.is_none() {
        match ClipTextEncoder::new(&clip_model_path, &clip_tokenizer_path) {
            Ok(encoder) => *lock = Some(encoder),
            Err(e) => warn!("CLIP text encoder pre-warm failed: {e}"),
        }
    }
}
// SigLIP-2 (Gemma SentencePiece) text encoder — mirrors the CLIP path.
if let Ok(mut lock) = text_encoder_state.siglip2_encoder.lock() {
    if lock.is_none() {
        match Siglip2TextEncoder::new(&siglip2_model_path, &siglip2_tokenizer_path) {
            Ok(encoder) => *lock = Some(encoder),
            Err(e) => warn!("SigLIP-2 text encoder pre-warm failed: {e}"),
        }
    }
}
```

`indexing.rs:276-339`. `TextEncoderState` holds two slots — `encoder` (CLIP, 512-d) and `siglip2_encoder` (SigLIP-2 Base 256, 768-d, Gemma SentencePiece tokenizer) — because the text-encoder picker can switch mid-session without re-paying model-load cost. Pre-warming both means the user's first semantic search doesn't pay 1-2s (CLIP) or ~2.4s (SigLIP-2, the perf-1777226449 outlier #8 this was added to fix) of model-load latency regardless of which text encoder they land on. The lazy-init path in `commands::semantic` is preserved for either encoder in case pre-warm failed (e.g., model still downloading on first launch) — the lock check `if lock.is_none()` short-circuits when pre-warm already succeeded. DINOv2 has no text branch (image-only), so there is no third slot.

### Model download UX

`model_download::download_models_if_missing(progress_cb)` is wrapped in a closure that:
- Receives `(processed_bytes, total_bytes, current_file: Option<&str>)`
- Builds a human-readable message ("Downloading model_image.onnx — 245 / 1153 MB")
- Calls `emit(app, Phase::ModelDownload, processed, total, msg)`

The progress callback is the only `Phase::ModelDownload` event source. If models already exist on disk (subsequent launches), the download is skipped silently and no events fire — the pipeline jumps straight to the pre-warm.

## Key Interfaces / Data Flow

### Inputs

| Source | Provides |
|--------|----------|
| `lib.rs::run::setup` | First call (`try_spawn_pipeline` at app startup) |
| `commands::roots::set_scan_root` | After `wipe_images_for_new_root` + `add_root` for the new path |
| `commands::roots::add_root` | After `db.add_root(path)?` for an additional root |
| `watcher::start` (via debounce callback) | Whenever filesystem changes are debounced |
| `db: ImageDatabase` (constructed inside the thread) | Every read + write the pipeline does |
| `paths::models_dir()` | Where to look for ONNX files |
| `paths::thumbnails_dir()` (via `thumbnails_dir_for_root`) | Where to write thumbnails |

### Outputs

| Destination | What |
|-------------|------|
| `app.emit("indexing-progress", &payload)` | Per-phase progress payloads — see below |
| `app.emit("feed-delta", &FeedDeltaBatch)` | Batched per-thumbnail feed patches (T3-1) — see above |
| Database `images` table | Per-file `relink_or_insert` (UPDATE on a moved-file match, else INSERT) for genuinely-new paths, with an `add_image` NULL-hash fallback on hash failure; `set_content_hash` UPDATE for the backfill pass; UPDATE thumbnail_path/width/height; UPDATE manual layout untouched by this pipeline |
| Database `embeddings` table | `upsert_embeddings_batch(encoder_id, rows, false)` per encode chunk, one row per (image, encoder) |
| Database `images` table (orphan column) | UPDATE orphaned = 0/1 per `mark_orphaned` |
| Filesystem `<app_data_dir>/thumbnails/root_<id>/thumb_<id>.jpg` | Base 480px JPEG per image |
| Filesystem `<app_data_dir>/thumbnails/root_<id>/thumb_<id>_{960,1440,2048}.jpg` | Eager higher-resolution buckets, second thumbnail pass |
| Filesystem `<app_data_dir>/models/*.onnx`, `tokenizer.json` | Downloaded if missing |
| Filesystem `<app_data_dir>/embstore_<encoder_id>.bin` | Written via `CosineIndex::save_store_for(encoder_id)` — step 7, only for encoders whose generation token moved this run |
| `FusionIndexState.per_encoder` (`Arc<RwLock<HashMap<String, CosineIndex>>>`) | Refreshed per-encoder via `refresh_if_stale` at step 7 — the primary `CosineIndexState` this table used to name is gone entirely (`1514a90`) |
| `TextEncoderState.encoder` / `.siglip2_encoder` | Both pre-warmed if their model files exist |

### `IndexingProgress` payload

```rust
#[derive(Serialize, Clone, Debug)]
pub struct IndexingProgress {
    pub phase: Phase,            // serialised kebab-case
    pub processed: usize,
    pub total: usize,            // 0 = indeterminate
    pub message: Option<String>,
}
```

Wire JSON example (model-download mid-flight):

```json
{
  "phase": "model-download",
  "processed": 245803520,
  "total": 1153023488,
  "message": "Downloading model_image.onnx — 234 / 1099 MB"
}
```

Frontend `useIndexingProgress` hook subscribes to the `"indexing-progress"` event and updates React state; `IndexingStatusPill` renders accordingly.

## Implemented Outputs / Artifacts

- 6 phases visible to the frontend: scan, model-download, thumbnail, encode, ready, error.
- One emit per phase boundary plus periodic throttled emits within long phases (every 100 images during scan, every 25 thumbnails, after each encode batch).
- Every successful pipeline run leaves: a complete `images` table (paths + thumbnails + embeddings), a populated cosine cache (in-memory + on-disk), and a pre-warmed text encoder.
- 7 unit tests covering single-flight semantics, IndexingError display, kebab-case Phase serialisation. Source: `indexing.rs:497-601`.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| Model download is not resumable | Network failure mid-1 GB download | The partial file is left on disk; the next launch sees it and re-downloads from scratch. Verify by checking whether `download_to_file` writes to a `.part` file (it does — gitignore covers `*.part`) and renames on completion. |
| Post-index write-lock window per changed encoder | Step 7's `refresh_if_stale` repopulate + persist for a CHANGED encoder holds that encoder's fusion write lock for the duration (~0.5-1s per encoder at 100k) | A full three-encoder import blocks searches on those encoders' slots for ~3s total in that window. An unchanged encoder is unaffected (token-gate skips it for the cost of one SQL aggregate). Named follow-up: build the refreshed index outside the lock, swap under a brief write lock. See `context/notes/performance-decisions.md`. |
| Fusion RwLock poisoning | Any panic inside `refresh_if_stale`, `populate_from_db_for_encoder`, or `save_store_for` while holding `FusionIndexState.per_encoder`'s write lock | The `RwLock` becomes poisoned; every subsequent search command's `.read()`/`.write()` (via `ApiError`'s generic `PoisonError<T> → Cosine` mapping) fails for every encoder, not just the one that panicked, because there is one shared map. Recovery requires app restart. Supersedes the pre-100k-round primary-`CosineIndexState`-Mutex version of this risk. |
| Watcher rebuild on root change is missing | Adding a root after launch then dropping a file in it | The new root is not watched until the next app launch. The `add_root` command's `try_spawn_pipeline` covers the immediate rescan, so the file appears in the catalogue, but subsequent additions to that root require a manual refresh via `set_scan_root` or restart. |
| `mark_orphaned` chunks at 500 ids per UPDATE | Libraries with >500 newly-orphaned images in one rescan | Multiple sequential UPDATEs run; not parallelised. The chunking is to stay under SQLite's parameter limit, not for performance. |
| Empty roots (configured root no longer exists on disk) | User pointed at a folder, then deleted/moved it | The pipeline logs a `warn` per missing root and continues with whatever exists. If every root is missing, `Phase::Ready` is emitted with `total = 0` and an empty-state message. |
| CLIP cannot batch its ONNX inference | The OpenCLIP `visual/model.onnx` export has a fixed batch dim of 1 | CLIP's encode throughput trails SigLIP-2/DINOv2's on the same hardware; a re-export would fix it but touches model weights provenance (live pre-sale concern), so this is accepted rather than worked around. See `context/notes/clip-preprocessing-decisions.md` and `context/notes/performance-decisions.md`. |

## Partial / In Progress

None — the pipeline is feature-complete for the current scope. Per-encoder parallelism shipped in Phase 11e, made oversubscription-safe via dynamic `intra_threads` in Phase 12c; pipeline stats UI shipped as the StatsSection in the Settings drawer (Phase 8c4 / commit `8c55aa4`); scan-insert batching (T2-2), the reverse tag index, batch inference for SigLIP-2/DINOv2, and the feed-delta protocol all shipped in the 100k performance round (`ebe4006`, `012012c`).

## Planned / Missing / Likely Changes

- **Watcher rebuild on root changes**: drop the existing `WatcherHandle` and re-call `watcher::start` after `add_root` / `remove_root` / `set_root_enabled`. Today's gap is documented in `systems/watcher.md`.
- **Cancellation token for cooperative pipeline cancel**: today the only way to abort a running pipeline is to wait for it. A future "cancel-and-restart on rapid root switches" UX would need a `Arc<AtomicBool>` cancel flag checked between phases.
- **Resumable downloads**: `model_download` could honour HTTP `Range` headers to resume partial downloads instead of restarting from byte 0.
- **Build-outside-lock-then-swap for step 7's fusion refresh** — the named follow-up to the post-index write-lock window risk above.
- **Decode-once fan-out across the three encoder threads** — each thread currently decodes its own copy of every image it needs to embed; deliberately deferred because it would collapse the tuned one-thread-per-encoder phase design into a decode broker, reopening a contention question already tuned twice (Phase 11e/12b). *Trigger:* indexing throughput becomes a real complaint at scale AND a contention re-test is budgeted. See `context/notes/performance-decisions.md`.

## Durable Notes / Discarded Approaches

- **CLIP's batch inference attempt failed silently, not loudly — the fix was to stop trying, not to fix the batching.** An earlier pass tried giving CLIP the same `[N,3,224,224]` treatment SigLIP-2/DINOv2 now get. The OpenCLIP vision export declares a fixed batch dim of 1, so ORT returned "Got invalid dimensions for input: image" — but `encode_batch` swallowed that into `failed_paths`, so CLIP silently produced zero embeddings for a whole run while the other two encoders (dynamic-batch exports) encoded normally, with nothing surfacing past a batch-summary diagnostic that only writes under `--profiling`. The fix was architectural, not a bug fix: run one `[1,3,224,224]` inference per image (same shape `encode()` already used successfully), keep preprocessing batched at 32 to bound peak memory, and accept that CLIP's ONNX call itself never batches. Re-exporting the model to accept dynamic batch would fix this properly but touches weights provenance — a live pre-sale concern — so it's parked, not pursued.
- **The shared `EncodeProgress` counter replaces per-encoder progress emits, not by convention but because per-encoder emits are provably wrong under concurrency.** Three interleaving encoder threads each reporting their own `processed/total` means a just-started thread's `0/N` can land on the wire strictly after another thread's real progress — the pill visibly snaps backward. There is no per-encoder fix for this; the counter has to be shared, and its `advance()` has to run under a lock that also gates the emit, exactly like the thumbnail phase's high-water-mark Mutex.
- **Cache-warm-at-launch moved out of this file entirely, not just reordered.** Pre-100k-round, "load the cosine cache from disk if fresh" was step 0 of `run_pipeline_inner`. It is now `lib.rs::spawn_cache_warm`, spawned independently at `run()` before the indexing pipeline is even invoked. The reason wasn't cosmetic: the primary `CosineIndexState` this step used to warm doesn't exist anymore (`1514a90`), and the per-encoder `FusionIndexState` slots it warms instead are shared with three other subsystems (fused search, single-encoder search, and this pipeline's own step 7) — giving the warm logic its own home in `lib.rs` keeps `indexing.rs` from having to know about launch-time concerns that aren't actually about indexing.
- **Single-flight via `AtomicBool` + RAII guard, not via channel-based queueing.** The trade-off: a queue would let bursts accumulate and eventually all be processed; single-flight coalesces them into one rescan. For filesystem watch events this is the right choice — the user wants "the latest state of the disk reflected in the catalogue," not "every intermediate state replayed." For user-driven multi-root operations (clicking Add three times in a row) it's also right because each `add_root` does its own `db.add_root` synchronously before spawning the pipeline; the pipeline just needs to run once after all the roots land.
- **Why a second `ImageDatabase` connection in the indexing thread, not borrowing the Tauri-managed one?** Because the Tauri-managed `ImageDatabase` lives behind `tauri::State<'_, ImageDatabase>` which is only accessible from inside command handlers, not from a background thread. Opening a second connection is the simplest way; WAL means the contention is bounded to a few μs per write.
- **The cosine cache is invalidated by file mtime, not by an explicit version number.** This works because every successful encode pass touches the DB (writing embeddings) right before saving the cache. If a future change writes embeddings in a different sequence, the freshness check would need updating. See `cache.rs::load_from_disk_if_fresh`.
- **Thumbnail-progress emit granularity moved from a fixed ~25-per-emit bucket to a `total/4000`-scaled interval.** The original `/10` (clamped to every 25) fired only ~10-60 events for a whole library, so the bar sat visibly still between big jumps — the "feels like no progress" complaint. The replacement stays per-image (interval 1) up to 4000 images — comfortably covering fresh small/medium libraries — and caps the event rate to ≈4000 emits above that so a 100k-image index doesn't fire 100k Tauri events. The same `total/4000` shape is reused for the encode phase's `EncodeProgress` interval.
- **Pre-warm + lazy init coexistence is intentional.** Pre-warm covers the common case (user starts the app, models exist, by the time they search the encoder is loaded). Lazy init covers the edge cases (pre-warm failed silently because models were still downloading; user upgraded the binary and the model files have been deleted; model files corrupt). The double init protection costs nothing because the lock check `if encoder_lock.is_none()` short-circuits when pre-warm succeeded.

## Obsolete / No Longer Relevant

The previous architecture where indexing ran inside `main()` before Tauri started (visible as "blank window for 30 seconds, then the app appears with everything ready") is gone. `main.rs` now does only `db_path` + `ImageDatabase::new` + `initialize`; the heavy lifting moved into the spawned thread.
