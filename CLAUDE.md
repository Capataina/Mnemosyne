# Mnemosyne — monorepo root

## Mission

One engine, many asset browsers. `crates/engine/` is **Mnemosyne the engine** — a media-agnostic catalogue + retrieval core (scan, index, embed, search, thumbnails, paths). `apps/lynceus/` is **Lynceus** — the shipping local-first image browser built on it. Future siblings (Syrinx for audio, Daedalus for 3D) join as `apps/<product>/` with their own `src-tauri` crate depending on the same engine. The engine's public API is deliberately unfrozen until a second product proves the seams.

Local-first is the product thesis, not a feature: the store build bundles its AI models and makes zero network requests (verified by sealed-boot logs). The entitlement slip does carry `network.client` — WKWebView refuses to render under the sandbox without it — so the privacy claim is behavioural ("it never phones home"), not OS-structural.

## Local-first — the reasoning

The app manages personal image libraries — reference boards, personal photography, downloaded inspiration — private by nature; cloud sync would defeat the point. Privacy is by construction, not configuration: the user never opts _in_ to local, and opting _out_ should require deliberate work. That one stance decided the stack: ONNX Runtime over a hosted embeddings API, SQLite over Postgres, Tauri over Electron-with-a-server, a pure-Rust WordPiece tokenizer over the `tokenizers` crate's C dependencies. Any choice that trades single-user performance for multi-user scale (a server hop) is the wrong direction.

The one historically acceptable network call was the first-launch model download; the store build removes even that by bundling the weights (dev builds pre-fetch via `scripts/download_models.py`). Commercialisation forced a licensing pass: OpenAI's original CLIP weights are research-non-commercial and would have blocked a paid release, so a weights-only swap to OpenCLIP LAION-2B ViT-B/32 (MIT — same tokenizer, preprocessing, and 512-d output; zero code change, no embedding version bump) fixed it. All three encoders are commercially licensed: OpenCLIP (MIT), DINOv2 (Apache-2.0, Meta), SigLIP-2 (Apache-2.0, Google). Residual caveat: `clip_tokenizer.json` is mirrored from `Xenova/clip-vit-base-patch32` — the open_clip MIT vocab in practice — and is worth re-sourcing from an explicitly-MIT repo before the paid release.

One deliberate trade-off rides on the single-user assumption: the Tauri shell runs `csp: null` with asset scope `["**"]` — fine for a local one-user tool, and a named hardening target in the enhancement ledger (`apps/lynceus/CLAUDE.md`). The principle reopens only on a multi-user or hosted-inference pivot, which nothing on the roadmap suggests.

## The four-names trap

| Name | Refers to |
| --- | --- |
| Mnemosyne | the repo AND the engine crate (`crates/engine`, lib name `mnemosyne`) |
| Lynceus | the image-browser product (`apps/lynceus`, bundle `com.capataina.lynceus`) |
| "Image Browser" / PinterestStyleImageBrowser | the project's dead pre-rename name — appears only in old commit bodies and stray stale comments; never write it into anything new |

## Map

```
Mnemosyne/
├── apps/                 product tier — one app per folder (see apps/CLAUDE.md)
├── crates/
│   └── engine/           Mnemosyne the engine, v0.5.6 (own CLAUDE.md tree)
├── scripts/              Python/bash helpers: model download/quantize, test corpus, launcher
├── models/               gitignored ONNX weights, models/<modality>/ (image|audio|3d);
│                         populated by scripts/download_models.py, bundled by Tauri at build
├── justfile              command runner — thin wrappers over scripts/ and cargo/pnpm
├── Cargo.toml            Rust workspace: crates/engine + apps/lynceus/src-tauri
├── package.json          pnpm monorepo manifest (v0.2.0 — its own version line)
├── pnpm-workspace.yaml   packages: apps/*; allows esbuild's postinstall
├── README.md             public-facing summary — the one non-CLAUDE.md doc sibling
└── target/               shared workspace build dir (gitignored) — bundles land HERE,
                          target/release/bundle/macos/, not under src-tauri/
```

## Global commands (verbatim)

```
just lynceus-dev                                    # dev, hot reload, repo-local models
just lynceus-dev-telemetry                          # dev + profiling layer (PROFILING=1)
just lynceus-release                                # release .app, built and opened
just lynceus-sandbox-test                           # store-shaped build, ad-hoc signed, sandboxed
just lynceus-mas-package                            # real MAS .pkg — needs Apple identities filled in
pnpm --filter ./apps/lynceus run test               # frontend suite (vitest)
cargo test --workspace                              # engine + app-crate Rust tests
python3 scripts/download_models.py --modality image # materialise models/image/
```

## Version lockstep

Lynceus's version lives in three text manifests that move together in the same commit, with `Cargo.lock` following: `apps/lynceus/package.json`, `apps/lynceus/src-tauri/Cargo.toml`, `apps/lynceus/src-tauri/tauri.conf.json` — all `0.7.20` today. The engine (`crates/engine/Cargo.toml`, `0.5.6`) versions independently and bumps only when its own code changes. The root `package.json` (`0.2.0`) tracks monorepo-level structure, not either product.

## Invariants and traps

- **`--profiling`, not `--profile`** — the Lynceus CLI flag; `PROFILING=1` env is equivalent and is what `lynceus-dev-telemetry` uses, because of the next trap.
- **pnpm does not strip `--`** the way npm does — it forwards the separator literally, and Tauri's CLI reads a bare `--` after `build` as "rest goes to cargo", corrupting flags like `--bundles`. Pass flags directly, no `--`.
- **`LYNCEUS_MODELS_DIR`** overrides the model search path (dev workflow; `start_lynceus.sh` points it at repo `models/image/`). **`LYNCEUS_DATA_DIR`** overrides the app-data dir for ad-hoc testing.
- **Bundle ID lives in two unlinked places**: `tauri.conf.json` `identifier` and the `BUNDLE_ID` fallback constant in `crates/engine/src/paths.rs` — no compile-time check that they match; rename them together (f14aaa8 did).
- **.gitignore ate CLAUDE.md files until 31217fc** — a personality-era rule silently untracked every per-folder CLAUDE.md. The rule is gone; if a memory file ever fails to show in `git status`, suspect .gitignore first.
- **.gitignore's iCloud-dedup globs** (`* [0-9].md` etc.) silently swallow any file whose name ends in a space plus a digit.
- **There is no `docs/` folder, deliberately** — it was dissolved into the per-folder CLAUDE.md layer on 2026-08-02; its full texts live in git history (last tree at the pre-dissolution commit). Never recreate it, and treat any surviving `docs/...` pointer as drift. Related Hermes confabulation on record: a `docs/architecture/architecture.md` that never existed at all.

## Conventions (repo-wide)

Only the rules a stranger could not infer from the surrounding code. Pure Rust-side patterns live in the `crates/engine/` and `apps/lynceus/src-tauri/` CLAUDE.md trees; pure frontend patterns in the `apps/lynceus/src/` tree.

- **Tauri command names are `snake_case`, identical to the Rust fn.** Components never call `invoke` directly — hooks call `src/services/` wrappers. Errors cross the IPC boundary as the typed `ApiError` union, mirrored in `src/services/apiError.ts`.
- **Tracing, never `println!`.** Every command, pipeline phase, and long-running op carries a span; span names are `dotted.snake_case` with a subsystem prefix (`ipc.`, `pipeline.`, `cosine.`, `model_download.`, `watcher.`), which is what gives new code free perf attribution under `--profiling`.
- **Tests live beside the code**: Rust `#[cfg(test)] mod tests` per submodule, frontend `*.test.ts(x)` next to the source. Cross-module Rust integration tests sit in `apps/lynceus/src-tauri/tests/`; the real-weights ones are `#[ignore]`d by default.
- **Numbered-plan traceability.** Code landed against a numbered plan carries the plan's task ID as an inline-comment prefix (`R<n>` was the 2026-04 perf bundle, `T<n>-<n>` the 100k round); each new plan picks a fresh non-colliding prefix. No numbered tags on ad-hoc fixes — plan traceability is what pays for the visual cost. Audit-derived code cites its finding in a comment.
- **Generation tokens, never timestamps.** Anything cached or computed off-thread trusts a result only when a cheap token derived from the actual inputs-that-matter still matches (the engine's embedding store, the masonry worker). An `mtime` check or boolean dirty flag is the anti-pattern this replaced — it cannot see input changes that leave the file untouched.
- **Persisted binary caches carry a versioned header** (magic + format version + content-identifying fields + freshness token), written temp-file + atomic rename, each header field with its own rejection test so foreign or stale files fail closed.
- **Stable identity keys.** Per-item keys derive from the item's own id, never from its position in the current array or a derived value like a URL — a refetch or sharpen must not read as a new identity.

## Where knowledge lives

The per-folder `CLAUDE.md` layer is the repository's single documentation layer: each folder's file carries its purpose, architecture, invariants, decisions, traps, and current state, at whatever length the folder earns. The root `README.md` is the one sibling — a public summary, never a parallel source. Long-form narrative (the story of a change, its dead ends, its evidence) lives in commit bodies; product/design artefacts with a life of their own (store listing, release runbook, brand SVGs) live under `apps/lynceus/design/`. There is no separate docs tree, and none should be created.

## Current state (2026-08-03)

Lynceus 0.7.20, engine 0.5.6. The onboarding's six scenes were rebuilt v2 in a six-agent parallel pass after a live founder review (causal motion throughout, edge-panel/history-strip app truth, retimed durations). Packaging is done: sandbox entitlements wired, the store-shaped bundle slimmed 2.9GB → 674MB (int8 models only), bundle ID renamed to `com.capataina.lynceus` (f14aaa8). The 5968d2e "boots clean" claim was log-verified only — the sealed webview was actually blank until `network.client` was added on 2026-08-03 (sandboxed WKWebView requires it to render; caught by the founder on a live look). Tests green: engine 143/143, frontend 294/294. The sole release blocker is the founder's Apple Developer enrolment; repo-side the remaining item is the 5-minute live folder-persistence test described in `apps/lynceus/design/store/release-runbook.md`. The knowledge layer settled today: the stranded 24-July Hermes migration was recovered (12d1712, 31217fc), every folder gained a CLAUDE.md, and the `docs/` tree was dissolved into those files — per-folder CLAUDE.md is now the only documentation layer.
