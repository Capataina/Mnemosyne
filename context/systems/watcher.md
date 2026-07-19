# watcher

*Maturity: working*

## Scope / Purpose

Filesystem-watching layer for live catalog integrity. Recursively watches every enabled root and triggers an incremental rescan via the indexing pipeline whenever files change on disk. Debounces noisy event streams so a "drop 100 photos" action produces one rescan, not one per file. Starts at app startup and is rebuilt by `watcher::restart` after every root mutation (`add_root` / `remove_root` / `set_root_enabled` / `set_scan_root`), so the watch set always tracks the current enabled root list.

## Boundaries / Ownership

- **Owns:** the `notify-debouncer-mini` debouncer setup, the per-root `watcher.watch(path, RecursiveMode::Recursive)` calls, the debounce-event closure that re-spawns the indexing pipeline.
- **Does not own:** the indexing pipeline itself (delegates to `indexing::try_spawn_pipeline`), the single-flight gating (`indexing::IndexingState` provides that), the rescan logic itself, the per-encoder fusion refresh a rescan triggers (delegates to `CosineIndex::refresh_if_stale` inside the pipeline's step 7 — see `systems/multi-encoder-fusion.md`).
- **Public API:** `start(app, paths_to_watch, db_path, indexing_state, fusion) -> Option<WatcherHandle>` where `fusion: Arc<RwLock<HashMap<String, CosineIndex>>>` is the same per-encoder slot map `FusionIndexState` owns, type alias `WatcherHandle = Debouncer<notify::RecommendedWatcher>`.

> **1514a90 (2026-07 perf round):** the parameter used to be `cosine_index: Arc<Mutex<CosineIndex>>` — the single primary index the pipeline populated and every legacy search command read. That primary index (`CosineIndexState`) was removed outright; every search command borrows the fusion slots now, so `watcher::start` (and every function it forwards to: `try_spawn_pipeline` / `run_pipeline_inner` / `run_encoder_phase`) was re-typed onto `Arc<RwLock<HashMap<String, CosineIndex>>>` instead. The watcher itself does nothing with the map beyond passing it through to `try_spawn_pipeline` on each debounce fire — see "Rescan trigger" below.

## Current Implemented Reality

### Setup at app launch

```rust
// lib.rs::run::setup
let watch_paths: Vec<PathBuf> = db.list_roots()
    .unwrap_or_default()
    .into_iter()
    .filter(|r| r.enabled)
    .map(|r| PathBuf::from(r.path))
    .filter(|p| p.exists())
    .collect();

let handle = watcher::start(
    app_handle,
    watch_paths,
    db_path,
    indexing_state,
    fusion_slots,   // Arc<RwLock<HashMap<String, CosineIndex>>>, cloned from FusionIndexState
);
if let Ok(mut slot) = watcher_state.lock() {
    *slot = handle;
}
```

`watch_paths` is built from `db.list_roots()` filtered to enabled + existing-on-disk, same as always. On macOS this now runs *after* the setup callback has resolved every enabled root's security-scoped bookmark (`security_scope::start_accessing`, see `systems/multi-folder-roots.md`) — the watcher and the indexing pipeline both need that access grant open before they touch the path, and the bookmark-resolution loop runs earlier in the same `setup` block, before `watch_paths` is computed.

The handle is stashed in `Arc<Mutex<Option<WatcherHandle>>>` Tauri-managed state. Dropping the handle cancels every watch — the wrapper exists so the watcher lives the lifetime of the app process and is not garbage-collected.

### Debounce semantics

```rust
new_debouncer(
    Duration::from_secs(5),
    move |result: DebounceEventResult| {
        let _span = tracing::info_span!("watcher.event").entered();
        match result {
            Ok(events) => { /* trigger rescan */ }
            Err(e) => { warn!("watcher debounce error: {e:?}"); }
        }
    },
)
```

5 second debounce was chosen because raw notify events on macOS fire dozens of times per "save" (every metadata change, every fsync). 5s collapses a typical bulk add (dropping 100 photos into a folder, batched by Finder) into a single rescan trigger.

### Rescan trigger

Inside the closure:

```rust
let _ = indexing::try_spawn_pipeline(
    app_for_handler.clone(),
    indexing_state_for_handler.clone(),
    db_path_for_handler.clone(),
    fusion_for_handler.clone(),
);
```

The `let _ = ...` is intentional: if a pipeline is already in flight (`Err(IndexingError::AlreadyRunning)`), the second event is silently coalesced. Single-flight in `indexing` does the right thing here — the user sees a single rescan covering everything that changed in the debounce window, not stacked reindexes.

### Rescan → token-gated fusion refresh (1514a90)

A watcher-triggered rescan is a full `run_pipeline_inner` run: scan phase (new/orphaned files), thumbnail phase, encoder phase, and — this is what makes the rescan actually show up in search — **step 7, the fusion refresh**. For every enabled encoder, `run_pipeline_inner` calls `fusion.write()` then `CosineIndex::refresh_if_stale(&database, &encoder_id)` on that encoder's slot: it recomputes the embedding-generation token (an FNV fold over the enabled/orphaned JOIN) and only repopulates the slot (+ re-persists its flat store) if the token moved. An unchanged encoder costs one cheap SQL aggregate; a watcher rescan that picked up genuinely new files repopulates just the affected encoders' slots.

This is the fix for a regression the `fc6667a` → `1514a90` reroute had introduced: once every search command started reading fusion slots instead of the old primary `CosineIndexState`, a mid-session watcher rescan had no path to refresh those slots (they were only cleared by root add/remove/toggle) — so newly-appeared files were invisible to image-image / tiered / semantic search until the next app relaunch. `refresh_if_stale` closes that gap; the watcher itself is unchanged by the fix (it always just re-spawned the pipeline), the fix lives entirely in what the pipeline's step 7 now does with the `fusion` Arc it's handed. See `systems/multi-encoder-fusion.md` § Invalidation and `systems/indexing.md` for the full step-7 mechanics.

### Manual span wrapping

The debounce closure can't carry `#[tracing::instrument]` (it's not a top-level function), so the closure body opens a manual `tracing::info_span!("watcher.event").entered()` for per-batch timing. Each debounce-batch event handler shows up in the perf report as one `watcher.event` span; the surrounding `watcher.start` span (added via `#[tracing::instrument]` on the public function) covers the initial debouncer construction.

## Key Interfaces / Data Flow

### Inputs

| Source | Provides |
|--------|----------|
| `lib.rs::run::setup` | Initial root list (enabled roots that exist on disk) |
| `db.list_roots()` (read at startup and again inside `watcher::restart` on every root mutation) | Where to watch |
| `notify::RecommendedWatcher` (per platform: `FSEvents` on macOS, `inotify` on Linux, `ReadDirectoryChangesW` on Windows) | Raw filesystem events |

### Outputs

| Destination | What |
|-------------|------|
| `indexing::try_spawn_pipeline(...)` | Rescan trigger; output is the indexing pipeline's progress events |

### State held

- `Arc<IndexingState>` — shared with the indexing pipeline (single-flight)
- `Arc<RwLock<HashMap<String, CosineIndex>>>` — the fusion per-encoder slot map, shared with `FusionIndexState` and the indexing pipeline. The watcher never reads or writes it directly; it only forwards the same Arc into every `try_spawn_pipeline` call so the pipeline's step 7 can refresh the right slots.
- `String` — the db_path for spawning a fresh `ImageDatabase` inside the pipeline thread
- `AppHandle` — for the `try_spawn_pipeline` call (the spawned thread emits events)

## Implemented Outputs / Artifacts

- One `WatcherHandle` per app process (or `None` if no roots are enabled at launch).
- Tracing spans `watcher.start` (one per launch) and `watcher.event` (one per debounce batch) for the perf report.
- No DB writes, no file writes — the watcher is purely a trigger.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| Old debouncer's in-flight callback can fire once after a restart swap | A root mutation racing a debounce window | One extra rescan attempt, coalesced by `try_spawn_pipeline`'s single-flight guard — harmless. (The former top risk here — the watcher not reconfiguring on root changes at all — was closed when `watcher::restart` landed; the root commands now rebuild the watch set live.) |
| 5s debounce window is global per debouncer | Two unrelated bulk operations on different roots that happen to overlap in time | Both batches collapse into one rescan trigger. Not a correctness issue (the rescan covers all roots anyway), just a coalescing of unrelated work. |
| Debouncer can fail to initialise on some platforms | `notify::RecommendedWatcher` returns `Err` (e.g., out of inotify watches on Linux with too many recursive subdirectories) | `start` returns `None`; the slot stays empty; the app works without live integrity. The user can still trigger rescans by switching folders or restarting. |
| Permission errors per-root are swallowed with a warn | `watcher.watch(path, RecursiveMode::Recursive)` returns `Err` | The other roots still get watched. The unwatched root logs a warn but does not block startup. |
| Symlink behaviour | A root that contains symlinks pointing into another root | Could cause double-event delivery and a single rescan covering both — harmless. Could also cause infinite descent if a symlink loops; `notify` does not loop-protect, but `ImageScanner` uses `read_dir` which also does not. Untested. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Rebuild watcher on root changes.** After `add_root` / `remove_root` / `set_root_enabled` succeeds, drop the old `WatcherHandle` from the Mutex slot and call `watcher::start(...)` again with the new enabled-root list. Today's gap is acknowledged in the source comment block at the top of `watcher.rs`. Estimated effort: small — the Mutex<Option<...>> is the right shape, just needs the swap.
- **Per-root debounce windows.** A single 5s debounce works for the common case but a heavy ingest (dropping 1000 photos) could produce one rescan trigger 5s after the last file lands; 5s is a long time to wait for "I just added a photo and want to see it." Adaptive debounce (smaller window for small bursts, larger for large) is possible but not currently warranted.
- **Filter events by extension.** Notify reports every metadata change including `.DS_Store`, `Thumbs.db`, etc. Today the filtering happens in the indexing pipeline (the scanner ignores non-image extensions). A pre-filter in the watcher closure could short-circuit the spawn-then-discard path if no image extensions changed.

## Durable Notes / Discarded Approaches

- **`notify-debouncer-mini` chosen over raw `notify`.** The mini debouncer is purpose-built for this exact use case ("collapse N events fired within W ms into one"). The full `notify-debouncer-full` adds file metadata that the rescan-everything pipeline doesn't need.
- **5s is not a tuning parameter.** It was chosen empirically: long enough to coalesce a Finder bulk-copy operation (which fires events spread over 1-3 seconds), short enough that a quick "drop one file then come back to the app" feels responsive. Reducing it would cause more rescans for the same workload; increasing it would make new images take longer to appear.
- **The `let _ = try_spawn_pipeline(...)` pattern is intentional.** The single-flight gate is the upstream contract; the watcher trusts it to do the right thing. Surfacing the `Err(AlreadyRunning)` would just trigger a UI toast that the user can't act on.

## Obsolete / No Longer Relevant

The pre-Phase-7 model had no watcher at all — the only way to refresh the catalogue was to restart the app or switch folders. Replaced by this system.
