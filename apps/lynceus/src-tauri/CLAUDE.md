# apps/lynceus/src-tauri/

The Lynceus product crate — Cargo bin `lynceus` v0.7.14, the Tauri v2 desktop host
around the media-agnostic Mnemosyne engine (`crates/engine/`, path dependency, no
frozen API). Everything image-specific lives here: the ONNX image/text encoders, the
thumbnailer, the indexing pipeline, the filesystem watcher, and the Tauri command
surface the React frontend (`../src/`) invokes. The engine owns DB, paths, perf,
cosine/RRF; this crate re-exports those modules at their old crate-root paths
(`lib.rs`) so `crate::db::…` call sites survived the extraction unchanged.

## Map

```
src-tauri/
├── Cargo.toml            crate manifest v0.7.14; platform-gated ort (CoreML on macOS,
│                         CUDA elsewhere), fast_image_resize, blake3 via engine,
│                         objc2/objc2-foundation for security-scoped bookmarks
├── tauri.conf.json       product identity + bundle config — see the pairing trap below
├── Entitlements.plist    the sandbox contract: exactly three grants, no network
├── build.rs              stock tauri-build shim
├── capabilities/         Tauri v2 permission manifest for the main window (own CLAUDE.md)
├── src/                  the crate source (own CLAUDE.md)
├── tests/                integration + audit-diagnostic suites (own CLAUDE.md)
├── gen/                  Tauri-generated schemas — never edit, no CLAUDE.md
├── icons/                generated icon set from the ringed-almond eye — no CLAUDE.md
└── target/               build output
```

## Current state — 2026-08-02

Store-shaped and repo-side release-ready (commits 5968d2e, f14aaa8). Sandbox
entitlements wired and empirically tested with ad-hoc seals on fresh containers:
container created, DB initialised inside it, zero network attempts. Bundle slimmed
2.9GB → 674MB by naming exactly seven resource files (five int8 models + two
tokenizers) instead of the whole models directory. Bundle ID is
`com.capataina.lynceus` (Apple rejects personal-looking IDs; CAP-79 closed repo-side).
Tests: 44 lib tests plus the integration suites, all green. What remains for release
is outside this repo: Apple Developer enrolment, then the five-minute live
folder-persistence pass (ad-hoc bookmark identity does not survive rebuilds, so that
half can only be proven on a stable signed build).

## The sandbox and entitlements story

`Entitlements.plist` grants exactly three things: the App Sandbox master switch,
`files.user-selected.read-only` (Lynceus never writes into user folders — DB,
previews, models all live in the app container), and `files.bookmarks.app-scope` so
granted folders persist across relaunches (`src/security_scope.rs` creates/resolves
them). **Deliberately absent: `com.apple.security.network.client`.** The store build
bundles its models as resources, so the OS itself enforces the "nothing ever leaves
your Mac" pitch. Do not add the network entitlement to fix a download failure — a
sandboxed build attempting a model download is a bug in precision/presence resolution
(see the int8 trap), not a missing entitlement.

## Traps

- **tauri.conf.json `identifier` ↔ engine `BUNDLE_ID` have no compile-time check.**
  The identifier here and the release-fallback constant in
  `crates/engine/src/paths.rs` must match or release builds resolve app-data paths
  into a different container than Tauri runs in. Both moved together in f14aaa8.
  Any future rename moves both plus every doc path reference, and orphans the
  previous install's library on disk (accepted twice already).
- **`bundle.resources` names files, not the directory.** Mapping the whole
  `models/image/` dir re-creates the 2.9GB bundle (fp32 originals ride along). The
  seven-entry list is the diet; keep it a list.
- **int8 is the effective default precision.** `Settings::effective_model_precision()`
  defaults to `"int8"` across all call sites (indexing, semantic, fused, downloader).
  The old `unwrap_or_default()` → empty string → fp32 path made a fresh store install
  look for fp32 files that don't ship, and the first-launch presence check then
  attempted a full fp32 download on every launch — blocked by the sandbox, but noisy
  and wrong. Presence is judged via `paths::model_path_for_in` (precision-variant
  resolution against an explicit dir) — the same rule the loaders use. Never test
  bare fp32 filenames for presence.
- **`--profiling`, not `--profile`.** Tauri 2's CLI owns `--profile <NAME>` for cargo
  profile selection; the binary's flag is `--profiling` (or `PROFILING=1`).
- **Bundle output lands in the workspace-level `target/`,** not under
  `apps/lynceus/` — the justfile recipes encode the corrected paths.

## Runnable commands

From the repo root:

```
just lynceus-sandbox-test   # free local sandbox loop: pnpm tauri build --bundles app,
                            # codesign ad-hoc with Entitlements.plist, verify, open
just lynceus-mas-package    # the real MAS artifact: Apple Distribution + Installer
                            # identities (fill APP_IDENTITY/PKG_IDENTITY from Keychain
                            # after enrolment), productbuild wraps .app into the .pkg
                            # Transporter uploads
cargo test                  # from apps/lynceus/src-tauri — 44 lib + integration suites
```

The plain-English release runbook (every term defined for a first-time Mac
publisher) is `design/store/release-runbook.md`; the listing spec is
`design/store/listing.md`.

## Place in the whole

Sits between `crates/engine/` (all media-agnostic persistence and retrieval — the
foundation shared with any future Mnemosyne vertical) and `apps/lynceus/src/` (the
React frontend, other agents' surface). Version moves with the work: `Cargo.toml`,
`tauri.conf.json`, and the frontend `package.json` bump in lockstep per the
repo convention.
