# Mnemosyne — monorepo root

## Mission

One engine, many asset browsers. `crates/engine/` is **Mnemosyne the engine** — a
media-agnostic catalogue + retrieval core (scan, index, embed, search, thumbnails,
paths). `apps/lynceus/` is **Lynceus** — the shipping local-first image browser built
on it. Future siblings (Syrinx for audio, Daedalus for 3D) join as
`apps/<product>/` with their own `src-tauri` crate depending on the same engine. The
engine's public API is deliberately unfrozen until a second product proves the seams.

Local-first is the product thesis, not a feature: the store build bundles its AI
models, requests no network entitlement, and the OS itself enforces "nothing ever
leaves your Mac".

## The four-names trap

| Name | Refers to |
|---|---|
| Mnemosyne | the repo AND the engine crate (`crates/engine`, lib name `mnemosyne`) |
| Lynceus | the image-browser product (`apps/lynceus`, bundle `com.capataina.lynceus`) |
| "Image Browser" / PinterestStyleImageBrowser | the project's dead pre-rename name — appears only in old commit bodies, `docs/history/`, and stray stale comments; never write it into anything new |

## Map

```
apps/                 product tier — one app per folder (see apps/CLAUDE.md)
crates/
  engine/             Mnemosyne the engine, v0.5.4 (own CLAUDE.md tree)
docs/                 long-form knowledge base (own CLAUDE.md tree)
  architecture/       system descriptions (systems/ holds 22 per-subsystem files)
  engineering/        decisions, conventions, profiling evidence
  history/            dated records — never "fixed" to current names
  proposals/          design proposals
  research/           research artefacts
scripts/              Python/bash helpers: model download/quantize, test corpus, launcher
models/               gitignored ONNX weights, models/<modality>/ (image|audio|3d);
                      populated by scripts/download_models.py, bundled by Tauri at build
justfile              command runner — thin wrappers over scripts/ and cargo/pnpm
Cargo.toml            Rust workspace: crates/engine + apps/lynceus/src-tauri
package.json          pnpm monorepo manifest (v0.2.0 — its own version line)
pnpm-workspace.yaml   packages: apps/*; allows esbuild's postinstall
README.md             public-facing summary — the one non-CLAUDE.md doc sibling
target/               shared workspace build dir (gitignored) — bundles land HERE,
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

Lynceus's version lives in three text manifests that move together in the same
commit, with `Cargo.lock` following: `apps/lynceus/package.json`,
`apps/lynceus/src-tauri/Cargo.toml`, `apps/lynceus/src-tauri/tauri.conf.json` — all
`0.7.14` today. The engine (`crates/engine/Cargo.toml`, `0.5.4`) versions
independently and bumps only when its own code changes. The root `package.json`
(`0.2.0`) tracks monorepo-level structure, not either product.

## Invariants and traps

- **`--profiling`, not `--profile`** — the Lynceus CLI flag; `PROFILING=1` env is
  equivalent and is what `lynceus-dev-telemetry` uses, because of the next trap.
- **pnpm does not strip `--`** the way npm does — it forwards the separator
  literally, and Tauri's CLI reads a bare `--` after `build` as "rest goes to
  cargo", corrupting flags like `--bundles`. Pass flags directly, no `--`.
- **`LYNCEUS_MODELS_DIR`** overrides the model search path (dev workflow;
  `start_lynceus.sh` points it at repo `models/image/`). **`LYNCEUS_DATA_DIR`**
  overrides the app-data dir for ad-hoc testing.
- **Bundle ID lives in two unlinked places**: `tauri.conf.json` `identifier` and
  the `BUNDLE_ID` fallback constant in `crates/engine/src/paths.rs` — no
  compile-time check that they match; rename them together (f14aaa8 did).
- **.gitignore ate CLAUDE.md files until 31217fc** — a personality-era rule
  silently untracked every per-folder CLAUDE.md. The rule is gone; if a memory
  file ever fails to show in `git status`, suspect .gitignore first.
- **.gitignore's iCloud-dedup globs** (`* [0-9].md` etc.) silently swallow any
  file whose name ends in a space plus a digit.
- **`docs/architecture/architecture.md` never existed** — a confabulated Hermes
  reference (12d1712); the real entry point is `docs/architecture/systems/`.

## docs/ vs CLAUDE.md — division of labour

Per-folder `CLAUDE.md` files are the operating memory: purpose, invariants, traps,
current state — what an agent needs to work in that folder now. `docs/` holds the
long-form record: architecture system descriptions, engineering decision notes,
dated history, proposals, research. A CLAUDE.md points into docs/ for depth; it
never duplicates it, and docs/ never carries a folder's live operating state.

## Current state (2026-08-02)

Lynceus 0.7.14, engine 0.5.4. Packaging is done: sandbox entitlements wired, the
store-shaped bundle slimmed 2.9GB → 674MB (int8 models only), ad-hoc-sealed app
boots clean with zero network attempts (5968d2e), bundle ID renamed to
`com.capataina.lynceus` (f14aaa8). Tests green: engine 141/141, frontend 250/250.
The sole release blocker is the founder's Apple Developer enrolment; repo-side the
remaining item is the 5-minute live folder-persistence test described in
`apps/lynceus/design/store/release-runbook.md`. The docs layer just finished a
recovery arc: a stranded 24-July Hermes migration (`context/` → `docs/`, 51
AGENTS.md stubs deleted, ten invariant folders converted to CLAUDE.md) was audited
and committed nine days late (12d1712, 31217fc).
