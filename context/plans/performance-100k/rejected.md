# Rejected ideas — verified out, with evidence

Every idea (or half-idea) from the original 20 that verification killed, and **why**, so no
future session re-proposes it from first principles. Each entry carries its refuting evidence and
— where honest — the trigger that would reopen it. If an entry has no reopen trigger, it is dead.

---

## #4 · Incremental, allocation-light shuffle — KILLED as standalone (absorbed by T3-1/T3-3)

The headline claim ("return the 32-bit hash directly rather than converting to float") is
literally true (`useShuffledFeed.ts:27` does `(h >>> 0) / 4294967296`) but the optimisation is
**~nil**: one division per element is negligible, and JS `Array.sort` compares floats and ints
through the same path. The real costs are (a) the recurring full rebuild every 5s during indexing
— which T3-1's deltas remove at the source (the stable `hash(id, seed)` key already makes
newcomers pure insertions), and (b) a one-time launch sort of ~30–100ms — which folds into T3-3's
worker (radix-sort there) if it ever matters. No independent home remains.

## #5 · Local drag previews + async suffix repack — KILLED (replaced by T3-3 + an id→index map)

The problem is real (each hover-swap: 2× O(N) `findIndex` at `useTileDrag.ts:114-115`, O(N)
slice/splice at `:118-120`, then a full 100k repack via `Masonry.tsx:94`), but the proposed fix —
approximate visible-window reflow, exact suffix computed async in the worker, active-tile
rebasing on reconcile — is the **higher-risk option**: masonry is prefix-dependent, so the local
preview is an approximation that must be reconciled on drop, a new source of visible pop/jump.
T3-3 (pack off-thread) + an id→index `Map` capture nearly all the win with none of the bespoke
machinery. Reopen only if drag still stutters at scale **after** T3-3 ships.

## #9 · Batched/governed visible-tile prefetch — KILLED as written (sliver folded into T2-tail)

Aimed at the wrong cost. The arithmetic (20–30 visible tiles × 3 encoders = 60–90 scans) is
correct, but post-`f48241e` those scans are rayon-parallel, cache-warm, and read-locked — cheap.
What actually makes a prefetch burst expensive is that **each prefetch call fires a full
`get_all_images()` join** (`similarity.rs:164`) — 20–30 whole-library joins per settled viewport
— and that is T3-2/#6's job to kill. The proposed batch-matrix command + admission control +
generation cancellation is heavy machinery for a cost that mostly disappears with #6; its own
"one big batch monopolises CPU" risk is self-inflicted. The only surviving sliver — a cancel
guard for scrolled-away speculative prefetch — reuses T2-tail's cancellation token if that ever
gets built. Re-measure after T3-2; do not build before.

## #12-A · CLIP batch inference — BLOCKED (premise false + provenance)

The plan's premise ("CLIP has a real batched ONNX path; SigLIP/DINOv2 should catch up") is
**factually wrong**: `encode_batch` loops one `[1,3,224,224]` inference per image
(`encoder.rs:294-305`) because the OpenCLIP `visual/model.onnx` export declares a **fixed batch
dimension of 1** (`dim_value==1`, documented at `encoder.rs:258-276` — the old Xenova export was
dynamic; the commercially-licensed replacement is not). Making CLIP batch requires re-exporting
the model — which touches weights provenance, a live pre-sale checklist concern. Blocked, not
merely deprioritised. The SigLIP-2/DINOv2 half survives as T2-3 with corrected expectations
(~1.2–2× on CPU, not "32→1").

## #12-B · Decode-once fan-out — KILLED (architectural rewrite mis-sold as an override)

The redundancy is real: all three preprocessors independently `ImageReader::open(path)?.decode()`
the same file (`encoder.rs:127-130`, `encoder_siglip2.rs:123-126`, `encoder_dinov2.rs:106-109`).
But the encode phase runs **one independent thread per encoder**, each with its own DB
connection, ORT session, and its own needs-list from `get_images_without_embedding_for(...)`
(`indexing.rs:861-883`, `:1126-1128`) — the three threads walk different, possibly disjoint image
sets. Decode-once requires collapsing this into a single decode broker fanning one RGB buffer to
all three — undoing the deliberately-tuned phase separation that was built to stop rayon/ORT
contention (`indexing.rs:405-420`). A genuine restructure of the hottest concurrent path, for a
bounded win (up to 2/3 of decode I/O, only for images all three encoders need, only during
indexing — a background phase). **Reopen trigger:** indexing throughput becomes a real user
complaint at scale AND a contention re-test is budgeted. Otherwise dead.

## #13 · Materialised progress-counter table — KILLED (background win, foreground complexity)

The cost is real and was actually understated: ~9,000 events/run (thumbnail ~4k + encode ~4k +
scan ~1k — `indexing.rs:482`, `:846`, `:379-380`), each triggering `invalidateQueries` →
`get_pipeline_stats` → a full images-table `COUNT/SUM(CASE)` scan (`images_query.rs:562-574`; the
three embedding counts are indexed and are NOT the cost). But it is **background DB work during
indexing, not user-facing latency** — the user-visible problems are the pill (fixed by T1-1,
frontend-only) and the render storm (fixed by T2-1). The counter table buys reduced background
contention at the price of crash-drift + a startup reconcile path — a correctness surface the
current scan-the-truth approach doesn't have. **Reopen trigger:** profiling during a real 100k
index shows the stats scans measurably starving the pipeline's own DB writes.

## #14-B · Grid query split (compact rows + separate tag hydration) — KILLED (absorbed by T3-1)

Real but wrongly homed: the ~300k discarded per-row `String` allocations
(`aggregate_image_rows`, `images_query.rs:103-137` extracts `img_path` per joined row and keeps
only the first) die naturally when T3-1's manifest reshapes what the grid query returns. Building
the two-query hydration separately means paying its correctness surface (zero-tag images,
deterministic merge) twice. The index half survived as T1-2.

## #15's full external store — KILLED (lighter fix delivers the same win)

An external store/provider with selector subscriptions is defensible but adds a new
state-management surface for a win that three smaller moves already capture: `useCallback` on the
three route handlers (stops the grid storm on its own), the `usePipelineStats`/`useIndexingPhase`
hook split (Home renders per-phase, not per-event), and Tauri-listener dedup. See T2-1. Reopen
only if a fourth+ consumer with genuinely different field needs appears.

## #16-A · Single animation owner — REJECTED (visible-behaviour risk, bounded win)

The duplication is real (anchor: CSS `transition-transform duration-400 ease-in-out`,
`MasonryAnchor.tsx:22,29`; child: Framer `motion.div layout`, `MasonryItem.tsx:118-119`) but
**bounded to O(visible) tiles, not O(100k)** — a modest cost ceiling. Against it: the two engines
have deliberately different curves (CSS ease-in-out 400ms position vs spring
stiffness-350/damping-35 reflow+pop-in), so "choose one engine" **will change the motion feel**
unless painstakingly retuned — colliding with the hard same-animations constraint — and it
tensions directly with `889b765`'s three-layer transform separation (imperative gesture wrapper /
motion.div layout / CSS anchor), which exists to prevent two writers on one transform. The safe
half (stable `id` key + scalar comparator) survived into T2-1. **Reopen trigger:** a dedicated
experiment with before/after animation capture, as its own project, never bundled.

## #18-B · Formal byte-capped LRU + grid fetchpriority — KILLED (web instinct, 2-deep need)

A strict LRU with `width×height×4` byte accounting is decode-cache management for a web app; the
actual need is a 1–2 image lookahead window in the modal/timer (T1-6): decode next+prev, drop the
rest. The grid half (`fetchpriority`/overscan classes) has uncertain WKWebView support and the
grid already lazy-loads non-selected images (`MasonryItem.tsx:155`). Reopen only if predecode
provably causes memory pressure — the fix would still be a smaller window, not an LRU.

## #19 · Lazy-load non-critical surfaces — KILLED (net negative in a Tauri app)

Every factual claim is true (static imports at `[...slug].tsx:22-25`; chunks measured
324,855 B main + 301,334 B route, matching the plan exactly) and the idea is still wrong: **JS
loads from local disk, not a network**, and JSC lazily compiles unused function bodies — code for
surfaces that aren't opened (Settings, modal, timer) is cheaply pre-parsed, not compiled. The
saving is single-digit milliseconds of startup pre-parse on an M2; the cost is `React.lazy` +
Suspense + prefetch plumbing **plus a new failure mode that doesn't exist today** (a cold ⌘,
awaiting the Settings chunk). Strictly worse. Reopen only if Lynceus ever ships a web-served
build — it is Tauri-only.

## #11-B · Thumbnail-write batching — KILLED (the code already documents why)

`indexing.rs:429-433` says it directly: the per-thumbnail DB write is "microseconds vs ~100ms
decode/encode". Decode dominates the phase's wall-clock; routing rayon results through a
single-writer channel to batch the negligible part is plumbing for an invisible win. The scan
half survived as T2-2. Dead — no trigger.

## #1-B · Per-column binary-search range index — DEFERRED-UNTIL-MEASURED (not killed)

Valid (per-column `bottom` is monotonic — the packer appends downward,
`masonryPacking.ts:139-174`; multi-column tiles need multi-column entries + dedup; the hero and
drag-tile escape hatches at `useMasonryEngine.ts:219` must be reproduced). But T1-3's rAF + guard
band removes ~80% of the scroll cost by making the O(N) filter *rare* instead of *fast*; after
that, cutting each surviving filter from 100k to tens is marginal. Lives on as T3-3's completion
criterion: build it on the worker's typed arrays **if** post-T1-3 profiling still shows filter
cost. Do not build it on today's object array.
