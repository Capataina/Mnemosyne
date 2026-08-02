# crates/engine/ — Mnemosyne, the media-agnostic engine

## Purpose and boundary

Mnemosyne (Cargo lib `mnemosyne`) is the reusable substrate for every asset-browser product in this monorepo: Lynceus (images, live) today; Syrinx (audio) and Daedalus (3D assets) as the intended future consumers. The design bet is that most of an asset browser does not care what the assets _are_ — so this crate owns the media-blind parts and stays image-free in behaviour even where names are still image-flavoured.

The boundary against `apps/lynceus` is the sharpest line in the repo:

- **Engine-side (here):** SQLite/WAL catalogue, flat mmap embedding stores, cosine ranking + RRF fusion, content hashing, domain row types, on-disk path resolution, and the opt-in profiling layer.
- **Product-side (Lynceus, never here):** encoders and model inference, thumbnail generation, the indexing pipeline that wires them, the filesystem watcher, and the entire Tauri command surface.

Domain types are named `Image*` for the image vertical for now; the recorded decision (lib.rs) is to generalise to `Asset` when the second product lands, not before — don't pre-generalise, and don't add anything image-specific deeper than a name.

## Map

```
engine/
├── Cargo.toml   package `mnemosyne` v0.5.4; notable deps: rusqlite (bundled), memmap2
│                (mmap stores, confined to cosine/cache.rs), blake3 (relink hashing),
│                rayon, ndarray, tracing. Dep comments carry rationale.
└── src/         the whole implementation; see `src/CLAUDE.md` for the module map.
```

## Current state — 2026-08-02

- v0.5.4, 141 tests passing (`cargo test -p mnemosyne`, 1.2s), clean tree.
- The last engine code change was f14aaa8 (2026-08-02): the `BUNDLE_ID` fallback constant in `paths.rs` renamed to `com.capataina.lynceus` for the App Store gate (CAP-79). Before that, the July perf round (fc6667a, 1514a90) landed ID-native search and the flat mmap stores, and 6eb05b8 landed BLAKE3 content-hash relinking.
- Aspiration vs truth: Syrinx and Daedalus do not exist; media-agnosticism is enforced by the boundary discipline above, not yet proven by a second consumer.

## Commands

```
cargo test -p mnemosyne          # full engine suite (141 tests)
cargo check --workspace          # what release commits verify against
cargo clippy -p mnemosyne -- -D warnings
```

## Traps

- **BUNDLE_ID has no compile-time pairing check.** `paths.rs`'s `BUNDLE_ID` release fallback and `apps/lynceus/src-tauri/tauri.conf.json`'s `identifier` must match by hand; a mismatch silently splits the app's data directory in two. Any rename touches both in one commit (f14aaa8 is the template, including the doc sweep).
- **Bundle-id renames orphan existing libraries.** The data dir is `<platform_data_dir>/<bundle id>/`, so a rename strands the old install's DB and thumbnails on disk — accepted twice already (no external users, cheap re-index), but it is a real user-facing cost the day there are users.
- **The profiling flag is `--profiling`, not `--profile`.** Doc comments in `perf.rs`/`perf_report.rs` still say `--profile`; the real Lynceus flag was renamed because cargo swallows `--profile` as its own flag (apps/lynceus/src-tauri/src/main.rs documents the collision).
- **No end-to-end pipeline harness exists.** The live Tauri startup/rescan path is reasoned-not-driven from this crate; 1514a90's latent staleness regression is the proof that engine unit tests alone can miss integration-level freshness bugs. Trace invalidation paths by hand when touching store/index lifecycle.

## Place in the whole

`apps/lynceus/src-tauri` is the only consumer; it depends on this crate by path and re-exposes engine behaviour through Tauri commands. Engine knowledge lives in the per-folder CLAUDE.md files under `src/` — on disagreement about current state the code wins and the file gets fixed, but a recorded decision (a rejected alternative, a reopen trigger) stays true as a decision even after the code moves on.
