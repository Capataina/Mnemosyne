# docs/architecture/systems/ — the current-state subsystem authority

## Purpose

One file per subsystem, describing how that subsystem works *today*. This folder
is rank 2 in the docs trust hierarchy: only the code itself outranks it, and
everything else in `docs/` sits below it. When a decision ledger, a history file,
or a proposal disagrees with a file here, this folder wins (and the code wins over
this folder).

Note: commit `12d1712` calls this "11 real files"; the folder actually holds 22
(verified by `find`, 2026-08-02). Trust the disk.

## Conventions

Every file opens with a `*Maturity: … · Stability: …*` header — read it first; it
tells you how much to trust the body. Many files carry dated verification
callouts ("Verified 2026-07 (100k perf round): … confirmed via `git diff …`,
empty") — those are evidence, keep the pattern when updating. Files cross-refer
as `systems/<name>.md` and reach decisions as `notes/<name>.md` or
`docs/engineering/decisions/<name>.md` (both refer to the same files; `notes/` is
the pre-migration spelling surviving in prose).

## The map

```
systems/
├── clip-image-encoder.md     OpenCLIP ViT-B/32 vision branch, 512-d; CPU-only on macOS; excluded from batch inference (fixed batch-dim-1)
├── clip-text-encoder.md      CLIP text branch + BPE tokenisation; records the multilingual-distillation failure ("blue fish → Tristana")
├── cosine-similarity.md      per-encoder embedding storage + three retrieval modes; per-encoder FusionIndexState slots
├── database.md               SQLite persistence spine: roots, images, per-encoder embeddings, tags, manifest/detail split; WAL
├── dinov2-encoder.md         image-only DINOv2-Base, 768-d, the "View Similar" encoder; batched encode_batch
├── feed-protocol.md          manifest + feed-delta contract between backend and grid; kills catalogue amplification
├── filesystem-scanner.md     multi-root recursive scan + extension whitelist; unchanged core, moving insertion boundary
├── frontend-state.md         TanStack Query + useUserPreferences + per-page useState; no global store
├── gesture-timer.md          figure-drawing practice mode cycling similar images on a timer
├── indexing.md               the background pipeline: download → pre-warm → scan/relink → thumbnails → embed → fusion refresh
├── masonry-layout.md         Pinterest grid: packing, hero promotion, virtualisation, drag-reorder, four-corner resize
├── model-download.md         first-launch downloader for the seven ONNX/tokenizer files (~2.5 GB)
├── multi-encoder-fusion.md   RRF fusion across encoders; FusionIndexState is the ONLY resident embedding cache
├── multi-folder-roots.md     roots table, per-root cascade delete, toggle/remove CRUD commands
├── paths-and-state.md        paths::*_dir() helpers + Settings struct — every state path goes through here
├── profiling.md              --profiling (NOT --profile) diagnostics: PerfLayer, JSONL timeline, markdown report, PerfOverlay
├── search-routing.md         frontend priority chain similar > semantic > tag filter > all, in the catch-all route
├── siglip2-encoder.md        SigLIP-2 image+text branches, shared 768-d space, Gemma tokenizer
├── tag-system.md             tag CRUD + three UI surfaces; OR/AND/exclude filter semantics
├── tauri-commands.md         the 34-command IPC surface, ApiError union, managed state
├── thumbnail-pipeline.md     multi-resolution JPEG thumbnail buckets; grid never loads full-res
└── watcher.md                debounced recursive filesystem watching, rebuilt on every root mutation
```

## Current state (2026-08-02)

All 22 files migrated intact from `context/` and committed in `12d1712`. Most
were last verified against code during the 2026-07 100k-performance round;
Lynceus has since moved to v0.7.14 (previews, branding, store-shaping), so
stability headers reading "unstable" or "active validation" reflect July's
assessment — re-verify against code before relying on the fastest-moving files
(masonry-layout, thumbnail-pipeline, feed-protocol, cosine-similarity).

## Traps

- **`paths-and-state.md` carried the migration's one missed pointer** — a live
  reference to `notes/local-first-philosophy.md` fixed in `31217fc` to point at
  `docs/engineering/decisions/`. Migrated prose may still use the old `notes/`
  spelling for decision files; those resolve conceptually, but treat any pointer
  you follow as suspect until the file opens.
- **`profiling.md:286` mentions `context/plans/perf-diagnostics.md`** — a
  deliberate reference to a deleted historical plan, and it points follow-up
  tracking at "`notes.md` § Active work areas", a hub file that was deliberately
  *not* migrated. That tracking pointer is dead; the profiling future-work list
  has no current home.

## Place in the whole

Fed by the code (each file cites commits and file:line); feeds the root README's
architecture pointer, and is what `engineering/decisions/` files cite for current
implementation contracts.
