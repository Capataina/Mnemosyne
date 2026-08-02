# apps/lynceus/ — Lynceus, the image browser

## What it is

The shipping product: a local-first macOS image browser — masonry board with drag-to-reorder/resize, semantic search over on-device encoders (OpenCLIP, SigLIP-2, DINOv2), similarity trails, tags-as-folders with must/must-not filters, a gesture-drawing timer, folder watching with BLAKE3 content-hash relinking, and a replayable skeleton-demo onboarding. Tauri 2 + React 19 frontend over a Rust app crate that wraps `crates/engine`.

Version **0.7.14** — kept in lockstep across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` (the root CLAUDE.md owns the lockstep rule).

## The three-way split

- `src/` — the React frontend (own CLAUDE.md tree). Vitest suite, 250/250.
- `src-tauri/` — the Rust app crate `lynceus` (lib `lynceus_lib`): Tauri commands, thumbnail pipeline, search orchestration, `Entitlements.plist`, `tauri.conf.json` (own CLAUDE.md files under `src-tauri/src/`).
- `design/` — non-code product artefacts: brand mark and store listing (own CLAUDE.md).

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

Day-to-day launches go through the root justfile (`just lynceus-dev`, `just lynceus-release`, `just lynceus-sandbox-test`) so `LYNCEUS_MODELS_DIR` is set for you. Locally scoped:

```
pnpm run test         # vitest run (from this folder)
pnpm run test:watch
pnpm tauri build --bundles app   # store-shaped .app — lands in the WORKSPACE
                                 # target/release/bundle/macos/, not under src-tauri/
```

## Release posture (2026-08-02)

Store-shaped and waiting on the founder's Apple Developer enrolment. Sandbox entitlements are wired (read-only user-selected folders + security-scoped bookmarks, deliberately no network), the 674MB bundle ships five int8 models plus two tokenizers, and the ad-hoc-sealed app boots clean in the sandbox with zero network attempts (5968d2e). Repo-side gates cleared: real icon (b5005e4), bundle ID `com.capataina.lynceus` (f14aaa8), listing copy drafted. Outstanding: `design/store/release-runbook.md`'s 5-minute live folder-persistence test, the pricing decision, and enrolment itself.

## Gaps and planned work

- **April 2026 audit's unresolved top-3 — re-audit planned.** Legacy single-encoder commands and their frontend wrappers, unreachable from the UI (~600 Rust + ~80 TS lines); `Settings::priority_image_encoder`'s "deprecated; ignored" docstring contradicting its live read; `db.get_embedding` on the writer mutex instead of `read_lock()`. Last verified unresolved 2026-07-15 — re-check against current code before acting.

### Enhancement ideas ledger (Hermes-era research, 2026-07, unverified)

Full recommendation texts live in git history (deleted with the docs/ dissolution, 2026-08-02). Provenance is Hermes-era and unverified — one confabulated citation on record (a source doc that never existed) — so these are ideas needing re-validation against current code, never ready plans.

Unshipped:

- **01 Encoder + VectorIndex trait abstractions** — three small traits the existing types implement behind; the prerequisite that would make 02/05/07 additive.
- **02 HNSW index behind the trait** — `instant-distance` HNSW as an opt-in second index, with a recall-vs-QPS benchmark.
- **05 MMR + k-DPP retrieval modes** — two diversity-aware retrieval modes alongside the existing 7-tier sampler, with a comparison audit.
- **07 Encrypted vector search MVP (TFHE-rs)** — an opt-in FHE-backed index, plaintext path stays default; by far the largest item (est. 8-12 weeks then).
- **08 CSP + asset-scope hardening** — replace `csp: null` + `scope: ["**"]` with a restrictive CSP and dynamic per-root scope; the config still carries both today (verified 2026-08-02).
- **10 OTLP tracing export** — an optional second tracing Layer exporting the existing PerfLayer spans via OTLP.
- **11 Auto-tagging + dedup** — CLIP zero-shot auto-tagging and perceptual-hash duplicate finding over existing encoder infra.

Already landed through other routes, never via this corpus: 03 (SigLIP-2, now a shipped encoder), 04 (DINOv2 as View Similar, shipped), 06 (int8 quantisation — the store build's real default), and part of 09 (the typed `ApiError` union exists; its `parking_lot` mutex-swap half did not land). Two candidates were considered and never drafted: an embedded vector-DB swap (LanceDB/Qdrant, judged not to dominate the SQLite+cosine design) and an MCP/agent wrapper (judged pure hype).
