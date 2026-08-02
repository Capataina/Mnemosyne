# apps/lynceus/src-tauri/src/

Desktop host composition: filesystem scope, indexing, settings, watcher, model
download, and command registration. `lib.rs` re-exports the engine's media-agnostic
modules (`db`, `image_struct`, `paths`, `perf`, `perf_report`, `root_struct`,
`tag_struct`) at their original crate-root paths — the engine extraction was a move,
not an API change; product-specific modules stay here.

## Map

```
src/
├── main.rs           entry: profiling flag (--profiling / PROFILING=1), tracing stack,
│                     opens the DB, hands off to lib.rs::run — all slow work moved to
│                     the background pipeline so the window opens immediately
├── lib.rs            run(): manages state (DB, TextEncoderState, FusionIndexState,
│                     IndexingState, watcher slot), setup callback (bundled-resource
│                     models dir, legacy scan_root migration, security scopes, pipeline
│                     + watcher spawn), invoke_handler registry, exit-time perf report
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

## Invariants

- Indexing batches database inserts, runs enabled encoders in parallel, emits
  per-image progress and feed-delta events, then token-gates per-encoder
  fusion-store refresh at `Phase::Ready`.
- Watcher and root mutations clear or refresh fusion slots; there is no primary
  cosine index to invalidate.
- Preserve local-first operation and bounded asset scope. Model download is the only
  expected post-install network boundary — and the sandboxed store build never
  reaches it, because the bundled int8 resources satisfy the presence check.
- The scan pipeline runs `mark_orphaned` **before** the BLAKE3 relink pass
  (6eb05b8) — reversing that order makes a move within a single rescan undetectable
  (the source row would not yet be flagged). The orphan pass skips any root whose
  scan has no entry (failed scan), while an Ok-but-empty scan still orphans; without
  that guard a failed scan would orphan the whole root and relink could silently
  steal its rows' tags and placements for byte-identical files elsewhere.
- `FusionIndexState.per_encoder` is `RwLock`, not `Mutex`, so warm concurrent fused
  queries score under shared read locks; populate uses double-checked locking.
  `invalidate_all()` is what keeps disabled-root images out of search results.
- Security scopes for enabled roots are opened in setup **before** the watcher or
  pipeline touch the paths, and deliberately never closed mid-session — released
  only on root disable/remove or process exit.

## Traps

- **Sync commands run on the Tauri main thread** (v2 behaviour, verified against
  live docs — 244b87a). Anything doing multi-second work (cascade deletes,
  `remove_dir_all`, directory walks) must be `#[tauri::command(async)]` or it
  freezes the UI. The functions stay plain `fn`s — only the macro attribute flips,
  which sidesteps the borrowed-State restriction on true async fns.
- **Tauri resolves managed state by exact type** (2c07add). The `WatcherSlot` alias
  must match lib.rs's declaration flavour (`std::sync::Mutex`) — a mismatch compiles
  clean and panics at first invoke.
- `watcher::restart()` swaps a fresh debouncer into the managed
  `Arc<Mutex<Option<WatcherHandle>>>` slot; the old one drops and cancels its
  threads. An in-flight debounce callback can fire one last rescan — harmless, the
  single-flight guard coalesces it. Restart needs no security-scope handling: an
  added root's picker grant covers the current process; remove_root releases its own.
- Dev builds have no bundle, so `resolve("models", Resource)` failing in setup is
  the expected silent no-op — `LYNCEUS_MODELS_DIR` (dev) or app-data fallback still
  resolve `models_dir()`. Don't "fix" that Err path into an error.
- The profiling flag is `--profiling`; Tauri's CLI owns `--profile`. The exit-time
  report renders on `RunEvent::Exit`, deliberately not `ExitRequested` (cancellable,
  windows still up).

## Stale-doc notes (module docs vs code, recorded not fixed)

- `settings.rs` header still says "just the scan root / Pass 4 will populate" —
  the struct long since carries precision, encoders, and more.
- `indexing.rs` header's trigger 2 still narrates the single-folder "DB is wiped"
  set_scan_root era; roots are a table now.
- `watcher.rs` header cites "lib.rs Phase 7" for the orphan column — the pass lives
  in the scan phase of `indexing.rs` today.

## Place in the whole

Everything here composes engine primitives (`crates/engine/`) for the image
vertical and is exposed to the frontend only through `commands/`. The shared
foundation with the frontend is the `indexing-progress` event payload
(`IndexingProgress`/`Phase`) and the command names in lib.rs's
`invoke_handler` — both are cross-language contracts; change them only with the
matching TypeScript.
