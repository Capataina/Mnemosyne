# crates/engine/src/

Engine public composition plus asset identity, paths, performance, tags, and
similarity contracts. The parent file owns the engine/product boundary and
commands; this file maps the modules and their local rules.

## Map

- `lib.rs` — crate doc (the canonical statement of what is engine-side vs
  product-side) and the module list; nothing else lives here.
- `db/` — SQLite catalogue: schema, migrations, all persistence queries
  (own CLAUDE.md).
- `cosine/` — retrieval: flat stores, cosine index, RRF fusion, filename
  matching, diagnostics (own CLAUDE.md).
- `cosine_similarity.rs` — re-export shim preserving the pre-split
  `crate::cosine_similarity::CosineIndex` import path; add nothing here.
- `content_hash.rs` — streamed BLAKE3 `hash_file` (64 KiB chunks), the
  content fingerprint behind move/rename relinking; the DB side lives in
  `db/content_hash.rs`.
- `image_struct.rs` / `root_struct.rs` / `tag_struct.rs` — serde row shapes
  the catalogue stores; a root is a user-added folder toggleable without
  losing its index.
- `paths.rs` — platform data-dir resolution (`BUNDLE_ID` fallback,
  `LYNCEUS_DATA_DIR` and `LYNCEUS_MODELS_DIR` env overrides) for DB,
  thumbnails, models, settings, and profiling exports.
- `perf.rs` — opt-in tracing Layer: per-span-name aggregates plus a recent-
  sample ringbuffer for on-demand p50/p95; one process-global enable flag set
  once at startup.
- `perf_report.rs` — pure renderer: `timeline.jsonl` + the aggregate
  snapshot → `report.md` + `raw.json` in the session's export dir.

## Invariants

- The engine stays media-agnostic: image-specific encoding, thumbnailing,
  and Tauri concerns live in Lynceus, not here.
- Asset identity is content-hash-backed so moves relink existing IDs without
  losing tags, layout, or embeddings; path normalisation happens at
  persistence boundaries.
- Retrieval state is per-encoder and ID-native. The removed primary
  `CosineIndexState` and `cosine_cache.bin` are not valid architectural
  patterns to reintroduce.

## Operating manual

- Doc comments use `//!`/`///` with left-aligned continuations on purpose
  (terminal readability); `#![allow(clippy::doc_lazy_continuation)]` in
  lib.rs exists for exactly this — match the style, don't "fix" it.
- The `cosine_similarity` shim means public-surface moves inside `cosine/`
  must keep the re-exported names compiling; the integration consumers
  (Lynceus's indexing.rs, watcher.rs) import through the shim path.

## Traps

- `paths.rs`'s module-doc layout still lists `cosine_cache.bin`, and
  `cosine_cache_path()` still exists — but nothing writes that file since
  1514a90 removed the primary index; the live per-encoder store files are
  `embstore_<encoder_id>.bin`. Legacy surface left for its file's next pass;
  don't route new persistence through it.
- `perf.rs`/`perf_report.rs` docs say `--profile`; the real flag is
  `--profiling` (see the parent CLAUDE.md's trap for why).
