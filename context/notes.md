# Notes

Project-level rationale, conventions, and durable lessons. One bullet per note file; full content in the linked file.

## Active work areas

Version is **0.5.0**. Two large rounds landed back to back: the **v2 UI overhaul** (shuffle
feed, masonry split into headless hooks + a Web Worker, one progress source of truth,
adaptive-resolution thumbnails, the v2 design-token visual layer, the library drawer, the
gesture-drawing timer — bumped to 0.4.0) and the **100k performance round** (compact feed
manifest + delta protocol, ID-native search over a flat mmap-persisted embedding store, the
primary cosine index removed entirely in favour of fusion-only state, the masonry pack moved
off-thread — bumped to 0.5.0). `notes/performance-decisions.md` is the durable record of the
perf round: its commit ledger, every rejected idea with the evidence that killed it, and the
full deferred/residual list with reopen triggers. Read it before proposing perf work — most
"obvious" wins were already evaluated against the code and rejected for cause.

Open follow-ups carried out of that round, each with its trigger:

- **Post-index write-lock window** — a changed encoder's fusion-slot refresh at `Phase::Ready`
  holds that slot's write lock ~0.5-1s/encoder (a 3-encoder import blocks searches ~3s).
  *Trigger:* the pause is felt in real use. Build-outside-lock-then-swap is the shape.
- **Search cancellation** — no end-to-end abort protocol yet; the 300ms debounce absorbs the
  common case. *Trigger:* search feels laggy during deliberate multi-word typing at real scale.
- **Per-column range index for the scroll virtualiser** — deferred; rAF coalescing + the 400px
  guard band already made the O(N) visible-filter rare rather than fast. *Trigger:* profiling
  still shows filter cost in scroll traces after the worker-pack work.
- **CLIP batched inference** — blocked on weights provenance: the OpenCLIP `visual/model.onnx`
  export has a fixed batch dim of 1, so batching it needs a re-export, which touches the
  pre-sale tokenizer-provenance question in `notes/clip-preprocessing-decisions.md`.
  SigLIP-2/DINOv2 already batch (`ebe4006`).
- **`indexing.rs` phase-module split** — hygiene item, pre-dates the perf round; the code-health
  audit recommends a 4-file split into pipeline/encoder_phase/etc. Schedule for a
  hygiene-focused session.
- **`[...slug].tsx` route extraction** — same hygiene category; pulls route-state hooks out of
  the route component (grew further with the v2 feed/masonry rewiring).
- **Watcher rebuild on root mutations** — `add_root` / `remove_root` after launch don't
  reconfigure the watcher until next restart. Documented in `systems/watcher.md`.
- **Path normalisation at insert time** — closes the second half of
  `notes/path-and-state-coupling.md`; the 3-strategy path→id fallback it motivated is now
  moot for search (search went ID-native this round) but still guards the remaining
  path-keyed call sites.

Lower-priority threads tracked in their own notes rather than duplicated here: the CLIP
tokenizer-provenance pre-sale flag and FP16/INT8/MobileCLIP research bets
(`notes/clip-preprocessing-decisions.md`, `references/m2-perf-options-2026-04.md`), the 4th-encoder
decision rule (`notes/encoder-additions-considered.md`), and smart per-query encoder routing
(`notes/preprocessing-spatial-coverage.md`).

## Index

- [local-first-philosophy](notes/local-first-philosophy.md) — every byte stays on the user's machine; the only network call is first-launch model download from HuggingFace.
- [clip-preprocessing-decisions](notes/clip-preprocessing-decisions.md) — history of CLIP preprocessing: previous Nearest + ImageNet-stats shortcut now replaced by canonical bicubic + CLIP-native; embedding-pipeline migration handles invalidation; spatial-coverage concern remains open.
- [preprocessing-spatial-coverage](notes/preprocessing-spatial-coverage.md) — open architectural concern: CLIP/DINOv2 center-crop drops edge content (problematic for splash arts / scenery / color queries); SigLIP-2 sees the full image; possible direction is smart per-query encoder routing.
- [conventions](notes/conventions.md) — tracing instrumentation prefixes, Mutex acquire-then-execute, `?`-via-From-impls for ApiError, optimistic mutation pattern, `paths::*_dir()` as the single disk-path source, submodule layout, RAII guards for atomics, defensive `lock_result.is_ok()` in setup, naming, `record_diagnostic` pattern.
- [path-and-state-coupling](notes/path-and-state-coupling.md) — the audit closed the cosine-DB-coupling half (now `&ImageDatabase`) and extracted `paths::strip_windows_extended_prefix`; normalise-at-insert is still the deeper fix.
- [random-shuffle-as-feature](notes/random-shuffle-as-feature.md) — the stable per-image `hash(id, seed)` key is now the feed's only ordering mechanism (v2's single shuffle feed replaced the four sort modes); in-cosine diversity sampling and tiered within-tier randomness remain intentional.
- [dead-code-inventory](notes/dead-code-inventory.md) — the perf round's removals (primary `CosineIndexState`, `zustand`/`atropos`, the `setIsInspecting` verification) closed most of the previous residual; new orphans are `cosine_cache_path`/`save_to_disk`, left in place post-flat-store. Residual: 4 backend, 0 frontend, 1 dependency.
- [mutex-poisoning](notes/mutex-poisoning.md) — fusion state collapsed to one `RwLock` (the primary cosine index and its separate lock are gone); typed-error migration surfaces poisoning as `ApiError::Cosine` instead of opaque strings.
- [fusion-architecture](notes/fusion-architecture.md) — end-to-end model of the now fusion-only search state (the primary index was removed this round): the flat mmap `FlatStore` per encoder, indexing-vs-search loops, why RRF over score-fusion, lifecycle table, performance shape.
- [encoder-additions-considered](notes/encoder-additions-considered.md) — research-grade inventory of candidate 4th-encoder additions (OpenCLIP-LAION, EVA-CLIP, MobileCLIP, perceptual hashes); decision rule + threshold for when to add one.
- [performance-decisions](notes/performance-decisions.md) — durable record of the 100k performance round: commit ledger, rejected ideas with refuting evidence, deferred items with reopen triggers, standing constraints (ranking-equivalence gates, versioned cache headers, never paginate the grid, cached-not-assumed norms).
