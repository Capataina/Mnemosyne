# apps/lynceus/src-tauri/src/

Desktop host composition: filesystem scope, indexing, settings, watcher, model download, and command registration. `lib.rs` re-exports the engine's media-agnostic modules (`db`, `image_struct`, `paths`, `perf`, `perf_report`, `root_struct`, `tag_struct`) at their original crate-root paths — the engine extraction was a move, not an API change; product-specific modules stay here.

## Map

```
src/
├── main.rs           entry: profiling flag (--profiling / PROFILING=1), tracing stack,
│                     opens the DB, hands off to lib.rs::run — all slow work moved to
│                     the background pipeline so the window opens immediately
├── lib.rs            run(): manages state (DB, TextEncoderState, FusionIndexState,
│                     IndexingState, watcher slot), setup callback (bundled-resource
│                     models dir, legacy scan_root migration, security scopes, pipeline
│                     + watcher spawn), spawn_cache_warm, invoke_handler registry,
│                     exit-time perf report
├── commands/         the Tauri command boundary (own CLAUDE.md)
├── indexing.rs       background pipeline: scan → relink → thumbnail → previews →
│                     encode → Ready; single-flight AtomicBool; emits indexing-progress
├── filesystem.rs     recursive scan for 7 image extensions; fail-fast std::fs walk
│                     (the CAN-USE-WALKDIR note is a documented follow-up)
├── watcher.rs        notify-debouncer-mini (5s) over enabled roots; start() at setup,
│                     restart() on every root mutation
├── settings.rs       settings.json in app data dir; effective_model_precision()
│                     (int8 default), resolved_enabled_encoders(), legacy fields kept
│                     for deserialisation
├── model_download.rs first-launch fp32 model+tokenizer download with progress; skips
│                     files whose precision variant already resolves on disk
├── security_scope.rs macOS security-scoped bookmarks (create/start/stop accessing);
│                     cfg(macos) only
├── similarity_and_semantic_search/   encoders, ORT sessions, preprocessing (own CLAUDE.md)
└── thumbnail/        adaptive JPEG bucket generator (own CLAUDE.md)
```

## The pipeline (`indexing.rs`) — phase order and why it's load-bearing

`try_spawn_pipeline` does a `compare_exchange` on `IndexingState.is_running`; a second caller gets `Err(AlreadyRunning)` and is coalesced. The spawned thread wraps its body in a `RunningGuard` whose `Drop` clears the bool, so a panic can never lock out future runs; inner errors emit `Phase::Error` with the message. Single-flight over queueing is deliberate: the user wants "latest disk state reflected", not every intermediate state replayed, and the per-encoder flat-store persistence at the end (`save_store_for` overwriting `embstore_<encoder>.bin`) is the one step two concurrent pipelines would genuinely race on. All four triggers — lib.rs setup, `set_scan_root`, `add_root`, the watcher debounce callback — go through `try_spawn_pipeline`. The thread opens its own `ImageDatabase` (Tauri-managed state is only reachable from command handlers; WAL bounds the contention).

Phases, in order (`Phase` serialises kebab-case; the frontend's phase map is a **closed set** — an unknown variant blanks and hides the status pill, so reuse an existing phase + message rather than adding variants casually):

1. **model-download** — `download_models_if_missing` with a byte-progress callback (the only `Phase::ModelDownload` event source; silent skip when files exist). Failure is `warn!` + continue: thumbnails still run, search stays unavailable until models arrive (typed `TextModelMissing` from the lazy path prompts re-download). Then pre-warm **both** text encoders (CLIP + SigLIP-2 slots in `TextEncoderState`) if their files exist — not a phase event; saves 1-2s (CLIP) / ~2.4s (SigLIP-2) off the first search. Lazy init in `commands::semantic` remains the fallback when pre-warm raced the download.
2. **scan** — four sub-steps whose order is the correctness story: A. `get_paths_to_root_ids()` (one SELECT) diffed against all scanned paths → `new_paths`, the only relink/insert candidates. Read _before_ B (safe: `mark_orphaned` flips `orphaned`, never `path`). B. `mark_orphaned(root_id, alive)` per root — **before** C, because relink only matches `orphaned = 1` rows and a moved file's source row is flagged here (reversed order = moves within one rescan undetectable). Skips a root whose scan _failed_ (an Ok-but-empty scan still orphans) — without that guard a failed scan would orphan the whole root and relink could steal its rows' tags/placements for byte-identical files elsewhere (6eb05b8). C. rayon-parallel BLAKE3 `hash_file`, then **serial in-order** `relink_or_insert` — serial is load-bearing: two identical moved files must drain two distinct orphaned rows, lowest id first, which only holds if each call commits before the next SELECTs. Hash failure (unreadable, deleted mid-scan) falls back to NULL-hash `add_image`. Empty `new_paths` = steady-state fast path, no hashing at all. D. Content-hash backfill for pre-upgrade NULL-hash rows, bounded rayon pool (half the cores, clamped 2-4); reuses `Phase::Scan` with message "Hashing existing images" per the closed-set rule. Per-root scan errors `warn!` and continue with the other roots; per-root path lists are kept so orphan detection can't cross-contaminate roots.
3. **thumbnail** — see `thumbnail/CLAUDE.md` for the two-pass design. Pipeline-side contract: only rows whose DB write landed become `feed-delta` rows (batches of 64, buffered under the same high-water-mark Mutex as progress), and the terminal delta flush runs **before** the terminal `Phase::Thumbnail` emit so frontend phase-transition handling always sees every delta. Progress interval is `total/4000`-scaled: per-image up to 4000 images, capped ≈4000 emits above (the fixed every-25 bucket it replaced fired so rarely the bar looked stuck).
4. **encode** — one thread **per enabled encoder**, concurrent; `intra_threads = DEFAULT_INTRA_THREADS / enabled.len()` so N ORT sessions never oversubscribe the 4-thread M2 P-cluster budget. Progress is the shared `EncodeProgress` monotonic counter (aggregate total computed up front from the same per-encoder needs queries): per-encoder emits are _provably wrong_ under concurrency — a just-started thread's `0/N` lands after another's real progress and the pill snaps backward (the sticky-0/21 bug). Each thread is independently fail-soft (missing model = `warn!` + skip); every thread joins before the phase returns, first error surfaced. Needs-sets come from `get_images_without_embedding_for(encoder_id)` — never the legacy `images.embedding` column, which R8 stopped writing (the legacy query returns the whole library and silently re-encodes everything). Writes are `upsert_embeddings_batch` per 32-chunk + `checkpoint_passive` to drain WAL. CLIP runs one ONNX call per image; SigLIP-2/DINOv2 batch — why, in `similarity_and_semantic_search/CLAUDE.md`. No priority-encoder ordering exists anymore: RRF fusion uses every enabled encoder equally.
5. **fusion refresh** (not a Phase variant) — per enabled encoder: `CosineIndex::refresh_if_stale` recomputes the embedding-generation token and repopulates + `save_store_for`-persists only on mismatch (a no-op rescan costs one SQL aggregate). One write lock taken **per encoder**, released between, so concurrent fused queries slip in — but a query against the encoder being refreshed blocks ~0.5-1s at 100k (named follow-up: build outside the lock, swap under a brief one). This step is what makes a watcher rescan visible to search — mid-session slots are otherwise only cleared by root mutations.
6. **ready** — total count in the message.

Launch-time cache warm lives in `lib.rs::spawn_cache_warm`, not the pipeline: it mmaps each enabled encoder's persisted flat store into the `FusionIndexState` slots on its own thread at `run()`, DB-populating and writing the store back on a miss. The pipeline's only cache duty is step 5.

**Known risks** (recorded, accepted): a panic while holding the fusion write lock poisons the one shared `RwLock` and fails _every_ encoder's search until restart; model downloads are not resumable (`.part` + rename, next launch restarts from byte 0); `mark_orphaned` chunks UPDATEs at 500 ids (SQLite parameter limit, not perf); a root deleted from disk logs `warn!` per missing root and continues.

## Scanner (`filesystem.rs`)

`ImageScanner::scan_directory(&Path) -> Result<Vec<String>>` — plain recursive `std::fs::read_dir`, extension whitelist of 7 (`jpg jpeg png gif bmp tiff webp`, lowercased before compare), `to_string_lossy` (never `.to_str().unwrap()` — Windows non-UTF-8 paths). Deliberately knows nothing about hashing, relinking, or the DB: idempotency lives in the pipeline's path-diff, not here. Fail-fast: any `read_dir` error mid-tree fails that whole root's scan (partial work discarded); symlink loops would hang (`read_dir` doesn't loop-protect — the in-source CAN-USE-WALKDIR note is the acknowledged fix if that ever bites). Byte-for-byte unchanged across the perf rounds; everything that moved was on the insertion side.

## Watcher (`watcher.rs`)

`notify-debouncer-mini` (chosen over raw `notify` — purpose-built collapse-N-events; over `-full` — the rescan-everything pipeline doesn't need per-event metadata) at a 5s window: empirical, long enough to coalesce a Finder bulk-copy (events spread over 1-3s), short enough that a single drop feels responsive. The debounce closure just calls `try_spawn_pipeline` with `let _ =` — an in-flight pipeline coalesces the event, and surfacing `AlreadyRunning` would only produce an unactionable toast. The window is global per debouncer, so overlapping bursts on different roots merge into one rescan (fine — a rescan covers all roots). `start` returning `None` (e.g. out of inotify watches) leaves the slot empty: the app works without live integrity, rescans still trigger on root changes/restart. Per-root `watch()` failures `warn!` and the other roots still get watched. The closure opens a manual `tracing::info_span!("watcher.event")` (closures can't carry `#[instrument]`).

## Multi-root semantics (`lib.rs` setup + engine `roots` table)

Two UX semantics: `set_scan_root` = **replace-all** (removes every root, CASCADE wipes their images, wipes legacy NULL-root rows, adds the new one) — no frontend caller since the "Choose folder"→"Add folder" fix, retained for a future "Reset library"; `add_root`/`remove_root`/`set_root_enabled` = granular. Disable is instant and cheap: the grid SQL filters on enabled roots, no re-encode. Both paths preserve `tags`/`images_tags`. `images.root_id IS NULL` rows are legacy pre-multi-root imports, kept visible. `PRAGMA foreign_keys = ON` in `initialize` is what makes the CASCADE real. Command-side lifecycles (bookmark timing, fusion-invalidation wiring, watcher restart) live in `commands/CLAUDE.md`.

Legacy migration: setup runs `migrate_legacy_scan_root(settings.scan_root)` once — idempotent (`Ok(None)` if the path already has a row), backfills NULL-root_id rows under the legacy path, then clears `settings.scan_root` so later launches skip it.

macOS security scopes: setup resolves every enabled root's bookmark (`start_accessing`) **before** `watch_paths` is computed and before the pipeline spawns — both need the grant open first. Scopes are deliberately never closed mid-session; released only on `remove_root` or process exit (disable keeps the grant). A `NULL` bookmark means "no persisted grant, plain filesystem access" — normal for non-macOS and unsandboxed dev builds, not an error. Sandbox-build trap: a root whose `create_bookmark` silently failed indexes fine this session but silently stops resolving after relaunch.

## Model download (`model_download.rs`)

Fallback path, not the dev primary (`scripts/download_models.py` + `LYNCEUS_MODELS_DIR` cover dev; the store build bundles int8 resources and never downloads). Seven files, ~2.5GB fp32, HuggingFace: CLIP vision/text from `immich-app/ViT-B-32__laion2b-s34b-b79k` (the 2026-07 MIT-licence swap), `clip_tokenizer.json` still from Xenova (provenance flag — see `similarity_and_semantic_search/CLAUDE.md`), DINOv2 from `Xenova/dinov2-base`, SigLIP-2 trio from `onnx-community/siglip2-base-patch16-256-ONNX`. CLIP filename constants live here; DINOv2/SigLIP-2 constants live in their encoder modules. The Python script keeps its URL list in lock-step **by convention, not shared code**. Two-phase execution: HEAD preflight aggregates Content-Length so the progress bar is determinate before the first GET; then chunked GET → `.part` → rename (`.part` over a hidden tmpfile so a mid-download directory listing reads as "in progress"; gitignored). Per-file fail-soft: a 404/timeout logs the URL and the aggregate counter still advances by the failed file's size so the bar doesn't stall. `ureq` over `reqwest`: sync matches the pipeline, smaller tree. No retry, no resume, no checksum verification — accepted gaps.

## Invariants

- Indexing batches database inserts, runs enabled encoders in parallel, emits per-image progress and feed-delta events, then token-gates per-encoder fusion-store refresh at `Phase::Ready`.
- Watcher and root mutations clear or refresh fusion slots; there is no primary cosine index to invalidate.
- Preserve local-first operation and bounded asset scope. Model download is the only expected post-install network boundary — and the sandboxed store build never reaches it, because the bundled int8 resources satisfy the presence check.
- The scan pipeline runs `mark_orphaned` **before** the BLAKE3 relink pass — see the phase walkthrough above for the full mechanism.
- `FusionIndexState.per_encoder` is `RwLock`, not `Mutex`, so warm concurrent fused queries score under shared read locks; populate uses double-checked locking. `invalidate_all()` is what keeps disabled-root images out of search results.
- Security scopes for enabled roots are opened in setup **before** the watcher or pipeline touch the paths, and deliberately never closed mid-session — released only on root disable/remove or process exit.

## Traps

- **Sync commands run on the Tauri main thread** (v2 behaviour, verified against live docs — 244b87a). Anything doing multi-second work (cascade deletes, `remove_dir_all`, directory walks) must be `#[tauri::command(async)]` or it freezes the UI. The functions stay plain `fn`s — only the macro attribute flips, which sidesteps the borrowed-State restriction on true async fns.
- **Tauri resolves managed state by exact type** (2c07add). The `WatcherSlot` alias must match lib.rs's declaration flavour (`std::sync::Mutex`) — a mismatch compiles clean and panics at first invoke.
- `watcher::restart()` swaps a fresh debouncer into the managed `Arc<Mutex<Option<WatcherHandle>>>` slot; the old one drops and cancels its threads. An in-flight debounce callback can fire one last rescan — harmless, the single-flight guard coalesces it. Restart needs no security-scope handling: an added root's picker grant covers the current process; remove_root releases its own.
- Dev builds have no bundle, so `resolve("models", Resource)` failing in setup is the expected silent no-op — `LYNCEUS_MODELS_DIR` (dev) or app-data fallback still resolve `models_dir()`. Don't "fix" that Err path into an error.
- The profiling flag is `--profiling`; Tauri's CLI owns `--profile`. The exit-time report renders on `RunEvent::Exit`, deliberately not `ExitRequested` (cancellable, windows still up).

## Stale-doc notes (module docs vs code, recorded not fixed)

- `settings.rs` header still says "just the scan root / Pass 4 will populate" — the struct long since carries precision, encoders, and more.
- `indexing.rs` header's trigger 2 still narrates the single-folder "DB is wiped" set_scan_root era; roots are a table now.
- `watcher.rs` header cites "lib.rs Phase 7" for the orphan column — the pass lives in the scan phase of `indexing.rs` today.

## Place in the whole

Everything here composes engine primitives (`crates/engine/`) for the image vertical and is exposed to the frontend only through `commands/`. The shared foundation with the frontend is the `indexing-progress` event payload (`IndexingProgress`/`Phase`) and the command names in lib.rs's `invoke_handler` — both are cross-language contracts; change them only with the matching TypeScript.
