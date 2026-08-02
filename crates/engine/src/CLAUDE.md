# crates/engine/src/

Engine public composition plus asset identity, paths, performance, tags, and similarity contracts. The parent file owns the engine/product boundary and commands; this file maps the modules and their local rules.

## Map

- `lib.rs` — crate doc (the canonical statement of what is engine-side vs product-side) and the module list; nothing else lives here.
- `db/` — SQLite catalogue: schema, migrations, all persistence queries (own CLAUDE.md).
- `cosine/` — retrieval: flat stores, cosine index, RRF fusion, filename matching, diagnostics (own CLAUDE.md).
- `cosine_similarity.rs` — re-export shim preserving the pre-split `crate::cosine_similarity::CosineIndex` import path; add nothing here.
- `content_hash.rs` — streamed BLAKE3 `hash_file` (64 KiB chunks), the content fingerprint behind move/rename relinking; BLAKE3 over SHA-256 for throughput, since a first index hashes the whole library. The DB side lives in `db/content_hash.rs`.
- `image_struct.rs` / `root_struct.rs` / `tag_struct.rs` — serde row shapes the catalogue stores; a root is a user-added folder toggleable without losing its index.
- `paths.rs` — platform data-dir resolution and the `Settings` struct; every state path in the app goes through here (see below).
- `perf.rs` — opt-in tracing Layer: per-span-name aggregates plus a recent- sample ringbuffer for on-demand p50/p95; one process-global enable flag set once at startup (see Profiling below).
- `perf_report.rs` — pure renderer: `timeline.jsonl` + the aggregate snapshot → `report.md` + `raw.json` in the session's export dir.

## Paths and state (`paths.rs`)

Single source of truth for every disk path — small but load-bearing: a bug in `app_data_dir()` would put state files in the wrong place silently. `ensure_dir` is the module's only filesystem mutation (called as a side effect of every `*_dir()` accessor; its failure is swallowed, so a full disk surfaces later as a confusing file-open error).

`app_data_dir()` resolution order:

1. `$LYNCEUS_DATA_DIR` if set and non-empty — the supported sandbox/test/ multi-instance override.
2. `dirs::data_dir()/<BUNDLE_ID>` — the platform default (macOS `~/Library/Application Support/com.capataina.lynceus/`).
3. `./app-data/<BUNDLE_ID>` with a warn, if the platform dir can't resolve (essentially theoretical on macOS/Linux/Windows).

Under it: `images.db` (+ WAL siblings), `settings.json`, `embstore_<encoder_id>.bin` per encoder (the live cosine store files; `cosine_cache.bin` is the orphaned legacy format), `models/`, `thumbnails/root_<id>/` (per-root subdirs so `remove_root` can `rm -rf` cleanly — the pre-Phase-9 flat layout leaked orphaned JPEGs forever; legacy NULL-root rows still use the flat path), and `exports/perf-*` for profiling sessions.

`models_dir()` alone has a two-step resolution: `$LYNCEUS_MODELS_DIR` (explicit absolute path — the dev workflow, pointing at repo-tree weights) else `<app_data_dir>/models` (the historical default the first-launch downloader still targets). Loading bundled weights from a Tauri resource dir is a productisation follow-up — the engine crate can't reach Tauri's resolver, so the product crate will have to pass the resolved path in.

Dev and release share one layout — **the `cfg(debug_assertions)` dev/release split was removed deliberately**: dev builds writing to a repo-local directory meant every build-mode switch re-downloaded ~2.5 GB of models. `LYNCEUS_DATA_DIR` is the supported replacement for anyone wanting isolation. Don't reintroduce compile-time path branching.

`Settings` (persisted `settings.json`, atomic `.tmp` + rename, every field `#[serde(default)]` so old and new binaries cross-read cleanly): `scan_root` (legacy pre-multi-folder migration target — consumed once by setup, then cleared), `priority_image_encoder` (legacy single-choice picker, kept only so old files deserialise), `enabled_encoders` (`resolved_enabled_encoders()` falls back to the full default set when None _or empty_ — empty means "default", not "disable all"; the IPC validator also rejects empty writes, so the guard is belt-and-braces). Settings is intentionally not a god-config: UI preferences live in the frontend's localStorage layer; this struct is only for state that must survive migrations or be readable before the frontend is alive. A corrupt settings.json loads as `Settings::default()` with a logged error (acceptable: worst case the legacy migration doesn't fire). The atomic save uses rename without fsync — fine on every filesystem the app realistically runs on, add fsync only if a real corruption is observed.

## Profiling (`perf.rs` + `perf_report.rs` — the engine-owned sink)

The profiling system is deliberately split: the **sink lives here** (span aggregation, timeline, JSONL flush, on-exit report), the capture layer and event vocabulary are app-local by design (breadcrumb names live at product call sites). Boundary rule: this is local, opt-in diagnostics written to the user's own disk — never conflate with phone-home analytics, which would be a separate consented system.

- Activation is one process-global `OnceLock` flag set at startup from the product's `--profiling` flag / `PROFILING=1` env. Dormant cost is a single tracing dispatch per instrumented call (few hundred ns) — which is also why the absolute hottest paths (the cosine inner loop) deliberately carry no `#[instrument]`.
- `PerfLayer` intercepts span close and accumulates per-name `SpanStats` (count / total / min / max + a 200-sample ringbuffer for on-demand p50/p95) in a global `OnceLock<Mutex<HashMap>>`; nested spans count independently, no roll-up. ~50 span names × 1.6 KB ≈ 80 KB peak.
- Every span close also pushes a `RawEvent`; a background thread flushes the log to `exports/perf-<ts>/timeline.jsonl` every 5 s (a crash loses at most the 5 s tail — accepted over per-event IO). A plain thread, not async, because the codebase is sync. `record_user_action` (product IPC) and `record_diagnostic(name, json)` write to the same log — diagnostics are the "what was the system doing" channel (embedding stats, score distributions, encoder run summaries), richer than span fields, no-ops when profiling is off; their `interpretation` field ("OK" / "WARNING…" / "BROKEN…") is the read-this-first verdict convention.
- On exit `render_session_report` produces `report.md` (correlating span activity to the user action ≤500 ms before it — a heuristic window: tighter misses slow machines, looser fabricates attributions) and `raw.json` (the aggregate snapshot, diffable across sessions). It reports via `eprintln!`, not tracing, because the subscriber may already be tearing down. `init_session` failure is non-fatal: aggregates still work in memory, only the on-disk artefacts are lost.
- Session-scoped directories (one per run) over a single append-only log: easy deletion, shareable runs, no cross-session contention. `OnceLock` over `lazy_static`/`RwLock`: write-once-at-init is exactly its idiom.

## Invariants

- The engine stays media-agnostic: image-specific encoding, thumbnailing, and Tauri concerns live in Lynceus, not here.
- Asset identity is content-hash-backed so moves relink existing IDs without losing tags, layout, or embeddings; path normalisation happens at persistence boundaries.
- Retrieval state is per-encoder and ID-native. The removed primary `CosineIndexState` and `cosine_cache.bin` are not valid architectural patterns to reintroduce.

## Operating manual

- Doc comments use `//!`/`///` with left-aligned continuations on purpose (terminal readability); `#![allow(clippy::doc_lazy_continuation)]` in lib.rs exists for exactly this — match the style, don't "fix" it.
- The `cosine_similarity` shim means public-surface moves inside `cosine/` must keep the re-exported names compiling; the integration consumers (Lynceus's indexing.rs, watcher.rs) import through the shim path.

## Traps

- `paths.rs`'s module-doc layout still lists `cosine_cache.bin`, and `cosine_cache_path()` still exists — but nothing writes that file since 1514a90 removed the primary index; the live per-encoder store files are `embstore_<encoder_id>.bin`. Legacy surface left for its file's next pass; don't route new persistence through it.
- `strip_windows_extended_prefix` is equally orphaned: its only consumer was the path→id search resolver that died in the ID-native rewrite. Grep-confirmed zero callers; the `Cow` zero-alloc design stays right if a path-normalisation need ever returns, but don't treat it as live.
- `.gitignore` covers `cosine_cache.bin` but has no `embstore_*.bin` rule — harmless while `app_data_dir()` defaults outside the repo, a leak the day anyone points `LYNCEUS_DATA_DIR` at a repo-local fixture path.
- `perf.rs`/`perf_report.rs` docs say `--profile`; the real flag is `--profiling` (see the parent CLAUDE.md's trap for why).
- The on-exit report only fires on a clean window close (Tauri `RunEvent::Exit`); Ctrl+C in a dev terminal skips it — `timeline.jsonl` still holds everything up to the last 5 s flush.
