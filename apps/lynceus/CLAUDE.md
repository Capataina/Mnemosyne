# apps/lynceus/ — Lynceus, the image browser

## What it is

The shipping product: a local-first macOS image browser — masonry board with
drag-to-reorder/resize, semantic search over on-device encoders (OpenCLIP,
SigLIP-2, DINOv2), similarity trails, tags-as-folders with must/must-not filters,
a gesture-drawing timer, folder watching with BLAKE3 content-hash relinking, and a
replayable skeleton-demo onboarding. Tauri 2 + React 19 frontend over a Rust app
crate that wraps `crates/engine`.

Version **0.7.14** — kept in lockstep across `package.json`,
`src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` (the root CLAUDE.md owns
the lockstep rule).

## The three-way split

- `src/` — the React frontend (own CLAUDE.md tree). Vitest suite, 250/250.
- `src-tauri/` — the Rust app crate `lynceus` (lib `lynceus_lib`): Tauri commands,
  thumbnail pipeline, search orchestration, `Entitlements.plist`, `tauri.conf.json`
  (own CLAUDE.md files under `src-tauri/src/`).
- `design/` — non-code product artefacts: brand mark and store listing (own
  CLAUDE.md).

## Map

```
design/            brand mark + App Store materials (see design/CLAUDE.md)
src/               React frontend (see src/CLAUDE.md)
src-tauri/         Rust app crate; Entitlements.plist, tauri.conf.json, icons/
public/            static assets served by Vite — only the vite.svg scaffold file today
dist/              built frontend (gitignored output), what src-tauri bundles
index.html         Vite entry
package.json       lynceus-ui manifest, v0.7.14; dev/build/test/tauri scripts
vite.config.ts     Vite + React + Tailwind 4 + vite-plugin-pages
vitest.config.ts   happy-dom test environment
components.json    shadcn/ui generator config
tsconfig.json / tsconfig.node.json
```

## Commands

Day-to-day launches go through the root justfile (`just lynceus-dev`,
`just lynceus-release`, `just lynceus-sandbox-test`) so `LYNCEUS_MODELS_DIR` is set
for you. Locally scoped:

```
pnpm run test         # vitest run (from this folder)
pnpm run test:watch
pnpm tauri build --bundles app   # store-shaped .app — lands in the WORKSPACE
                                 # target/release/bundle/macos/, not under src-tauri/
```

## Release posture (2026-08-02)

Store-shaped and waiting on the founder's Apple Developer enrolment. Sandbox
entitlements are wired (read-only user-selected folders + security-scoped
bookmarks, deliberately no network), the 674MB bundle ships five int8 models plus
two tokenizers, and the ad-hoc-sealed app boots clean in the sandbox with zero
network attempts (5968d2e). Repo-side gates cleared: real icon (b5005e4), bundle
ID `com.capataina.lynceus` (f14aaa8), listing copy drafted. Outstanding:
`design/store/release-runbook.md`'s 5-minute live folder-persistence test, the
pricing decision, and enrolment itself.
