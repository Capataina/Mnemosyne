# Performance decisions — the durable record

The `context/plans/performance-100k/` roadmap (verified 2026-07-17, `780a4f8`) was fully
implemented and the plan folder retired the same day. This note preserves what must outlive the
folder: where the work landed, what was deliberately NOT built and why, and what would reopen each
question. A future session proposing performance work should check this list first — most
"obvious" optimisations were already evaluated against the code and rejected for cause.

## Where the round landed (commit ledger)

| Commit | What |
|---|---|
| `ebe4006` | Wave 1 — nine tier-1/2 items: tile-memo fix, pill event fraction, rAF scroll + guard band, thumbnail cache, modal/timer predecode, reverse tag index, scan-insert batching, SigLIP-2/DINOv2 batch inference |
| `fc6667a` + `3b719b5` | T3-2 — ID-native search + flat mmap-persisted embedding stores (norms absorbed; memmap2 added) |
| `012012c` → `15d2476` | T3-1 + T3-3 — compact manifest + feed-delta protocol; masonry pack in a Web Worker on typed arrays |
| `1514a90` | Primary cosine index removed; pipeline token-gate-refreshes fusion slots at Ready (also fixed the latent post-index staleness the T3-2 reroute had introduced) |
| `fcad704` | (Same round, separate thread) timer UX overhaul + quick-start pill — gpt-5.6-sol executor + wiring |

## Outstanding live-pass checklist (not verifiable in a headless session)

One real session at the machine should confirm: the pill's per-phase reset feel (deliberate change
— one-line revert in IndexingStatusPill if disliked); an indexing run with the feed visible
(delta merges, pop-in cadence); a drag/resize session at scale (worker prefix→full swap, drag
smoothness); post-index search freshness (the `1514a90` fix, reasoned + unit-tested, not
e2e-driven); and the new timer panel/pill look in the WebView.

## Do not reintroduce (verified failures / wrong instincts)

- **`content-visibility: auto` on tiles** — caused disappearing tiles during fast drags (removed
  in `4dd85ba`); the grid already virtualises via the engine's viewport cull, so it was redundant
  as well as broken.
- **Approximate similarity indexes (HNSW/ANN)** — missed neighbours change which results the user
  sees; search stays exact full-corpus by product decision.
- **Route/chunk lazy-loading (`React.lazy` on Settings/modal/timer)** — web instinct that doesn't
  transfer: JS loads from local disk and JSC lazily compiles unused bodies, so the win is
  single-digit ms of pre-parse while adding a cold-shortcut await regression. Reopen only if a
  web-served build ever ships.
- **Byte-capped decode LRU / grid `fetchpriority`** — the modal/timer predecode need is a 2-deep
  ref window (shipped); formal LRU accounting is disproportionate, and `fetchpriority` support in
  WKWebView is uncertain while the grid already lazy-loads non-selected images.
- **CLIP batched inference** — the OpenCLIP `visual/model.onnx` export declares a fixed batch dim
  of 1 (documented in `encoder.rs`); batching CLIP requires a model re-export, which touches
  weights provenance (live pre-sale concern). SigLIP-2/DINOv2 batch overrides shipped instead.

## Deferred with explicit reopen triggers

- **Semantic-search cancellation (end-to-end abort protocol)** — the 300ms input debounce already
  absorbs the common case; per-query cost is ~100–400ms and text-encode-dominated. *Trigger:*
  search feels laggy during deliberate multi-word typing at real scale, after the ID-native
  search work removed the per-query catalogue join. Design sketch: request-generation `AtomicU64`
  checked between encoders and corpus chunks, never mid-lock. A cancel guard for scrolled-away
  prefetch reuses the same token.
- **Per-column binary-search range index for the scroll virtualiser** — rAF coalescing + the
  400px guard band made the O(N) visible-filter rare instead of fast, which is most of the win.
  *Trigger:* profiling still shows filter cost in scroll traces after the worker-pack work; build
  it on the worker's typed arrays, never on the object array.
- **Decode-once fan-out across the three encoders** — real redundancy (three decodes of the same
  file) but requires collapsing the deliberately-tuned one-thread-per-encoder phase design into a
  decode broker, re-opening a contention question that was already tuned once (Phase 11e/12b).
  *Trigger:* indexing throughput becomes a real user complaint at scale AND a contention re-test
  is budgeted.
- **Materialised progress-counter table** — ~9k full-table stats scans per 100k run are real but
  background-only; a counter table adds crash-drift + a startup reconcile path. *Trigger:*
  profiling during a real 100k index shows the stats scans starving the pipeline's own writes.
- **Thumbnail-write batching** — the write is microseconds against a ~100ms decode/encode
  (documented in `indexing.rs`); no trigger, considered dead.
- **Animation-engine unification (anchor CSS vs Framer layout)** — bounded to O(visible) cost, and
  merging engines risks both the motion feel (different curves) and `889b765`'s deliberate
  three-layer transform separation. *Trigger:* only as a dedicated experiment with before/after
  animation capture, never bundled into other work.
- **Gesture-timer random-tail predecode** — in continuous+repeat mode the next image is picked
  randomly at advance time, so it cannot be predecoded without restructuring the selection logic;
  accepted as a known limit of the shipped predecode.

## Residuals from the implementation round (each with its trigger)

- **Post-index write-lock window** — at Phase::Ready a *changed* encoder's fusion-slot
  refresh (populate + persist) holds that slot's write lock ~0.5–1s per encoder at 100k; a full
  three-encoder import blocks searches ~3s in that window. Token-gating makes incremental rescans
  free. *Follow-up shape:* build the fresh index outside the lock, swap under a brief write lock.
  *Trigger:* the post-import pause is felt in real use.
- **`save_to_disk` and `paths::cosine_cache_path` are caller-less** — left in place (public engine
  method; unowned tested surface). Clean up when their files are next touched.
- **Store files are native-little-endian** — zero-copy casts are inherently native-endian; fine for
  this desktop-only app, a landmine if the format ever ships cross-arch.
- **Timer continuous+repeat random tail** — picks its next image at advance time; cannot be
  predecoded without restructuring selection. Accepted limit.
- **No route-level React test harness** — the seed→upgrade selection effect and worker swap
  behaviours are unit/trace-verified, not mounted. *Trigger:* if route regressions recur, invest in
  a harness rather than more tracing.

## Standing constraints this work established

- Rankings are contract: any change to scoring/storage must pass ranking-equivalence diagnostics
  (serial-reference pattern, deterministic id tie-breaks) — FP-order effects near ties are the
  known hazard class.
- Embedding-cache invalidation must be header-versioned (schema version, encoder id/dim, row
  count, generation token); a bare mtime check silently serves wrong vectors.
- The masonry grid is never paginated — packing is prefix-dependent and shuffle order is global;
  scaling the feed means compact manifests + deltas, not pages.
- Cached norms, not assumed unit norms: legacy CLIP rows predate encode-time L2-normalisation.

## Telemetry architecture (decided 2026-07-17)

The profiling system is deliberately split: the **sink lives in the engine**
(`crates/engine/src/perf.rs` + `perf_report.rs` — timeline, JSONL flush, on-exit report), the
**capture layer is app-local** (`apps/lynceus/src/services/perf.ts` + `PerfOverlay.tsx`), and the
**event vocabulary is per-app by design** (breadcrumb names live at call sites). Decision: do NOT
extract the TS capture layer into a shared workspace package while it has one consumer —
*trigger:* the session that scaffolds Syrinx lifts `perf.ts` + `PerfOverlay` into `packages/` in
the same pass (pnpm workspace was adopted partly for this). Disciplines until then: keep
`perf.ts` free of app-specific logic, and use a consistent event-naming scheme when
instrumenting new surfaces (timer setup panel and pill controls are currently uninstrumented).
Boundary: this is local, opt-in diagnostics written to the user's own disk — never conflate
with phone-home product analytics, which would be a separate consented system.
