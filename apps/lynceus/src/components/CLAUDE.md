# src/components/

Presentation components plus the masonry layout core. The masonry files live here (not in `hooks/`) because the pure packing algorithm, the worker, and the anchor/tile renderers form one unit; the stateful engine/gesture hooks that drive them live in `hooks/` and import from here.

## Map

```
components/
├── Masonry.tsx                    Grid host: wires useMasonryEngine + useTileDrag +
│                                  useTileResize into anchors/tiles; caps settle-time
│                                  prewarm to a few tiles (uncapped prewarm caused
│                                  click-freezes — 133 concurrent searches logged).
├── MasonryAnchor.tsx              Positioned wrapper per tile. Takes motion="live"|"settle",
│                                  settling, placeholder; inline transition tokens from
│                                  masonryMotion; will-change latched only to anchors a
│                                  settle actually moved. Mutates data-masonry-* attrs the
│                                  layout monitor observes.
├── MasonryItem.tsx                The tile itself (memoised): adaptive thumbnail, selection,
│                                  four corner resize grips.
├── masonryPacking.ts              Pure packing domain: occupancy packer, MasonryGestureFootprint
│                                  ({id, span, startCol, top} — startCol is always the physical
│                                  LEFT column), MasonryPlacementAnchor (placement pins),
│                                  buildPackInput/computeMasonryGeometry. Shared verbatim by
│                                  worker and sync fallback — outputs bit-identical.
│                                  `lowestFreeY` is module-private (3 intra-file callers).
├── resizeGeometry.ts              Pure resize-corner geometry (anchorStartColFor,
│                                  resizePreviewForSpan, resizeVisualForPointer), mirroring
│                                  masonryReorder.ts's split from its stateful hook.
│                                  `hooks/useTileResize.ts` re-exports it verbatim.
├── masonryWorker.ts               Web Worker entry; caches input per base revision, pointer
│                                  frames reuse cached arrays.
├── masonryPacker.ts               Worker client: one in-flight computation + one replaceable
│                                  queued request; typed-array transfer; sync fallback
│                                  (offThread=false) when Worker is unavailable.
├── masonryMotion.ts               THE single motion source for the grid: SETTLE_MS 260 /
│                                  ease-out-expo, LIVE_REFLOW_MS 200, SETTLE_CLEANUP_SLACK_MS.
├── masonryGeometry.test.ts        Packer geometry gates.
├── masonryPacker.test.ts          Worker-client queueing/transfer behaviour.
├── masonryPacking.test.ts         Pure pack correctness incl. fuzz-style cases.
├── masonryGestureAnchor.test.ts   Footprint/pin anchor arithmetic.
├── masonryGestureRegression.test.tsx  End-to-end pack regressions for the closed gesture saga.
├── MasonryAnchor.test.tsx         Motion-mode transition tokens + will-change latch states.
├── MasonryItem.test.tsx           Tile render/resize-grip contract.
├── BootSplash.tsx                 z-[300] branded boot overlay; 600ms min display, 5s hard cap,
│                                  hides when the first feed-manifest query settles (success OR
│                                  error). Its role="status" aria-label="Loading Lynceus" node is
│                                  a PUBLIC handshake — see Traps.
├── BootSplash.test.tsx            Locks min-display/hard-cap/late-settle contract (855f4f2).
├── LynceusMark.tsx                Ringed-almond eye SVG (from design/mark/); gradient ids
│                                  prefixed so instances coexist.
├── IndexingStatusPill.tsx         Top-right pipeline pill; all numbers from useIndexingStatus'
│                                  DB-backed snapshot, never raw events; knows the "previews"
│                                  phase ("Preparing larger previews").
├── IndexingStatusPill.test.tsx    Visibility/rendering rules via mocked hook.
├── SearchBar.tsx                  Controlled tag-chips + text input. Parent owns BOTH tag set
│                                  and text (one filter state shared with the library drawer);
│                                  raw untrimmed text goes up, trim happens at point of use.
├── TagDropdown.tsx (+test)        Tag assign/create/delete combobox over ui/command + popover.
├── PinterestModal.tsx             Fullscreen inspector (z-[100]): nav arrows with neighbour
│                                  predecode, tags, notes, gesture-timer entry (auto-start via
│                                  config object identity).
├── SelectedImageTimerPill.tsx     Timer quick-start pill overlapping the selected hero's bottom
│                                  edge; App.css owns its hover/focus reveal.
├── PerfOverlay.tsx                ⌘⇧P diagnostics panel (z-[80/81]); polls perf snapshot 2s.
├── library-drawer/                Library bubble panel (non-modal, hover/pin, z-[200]):
│                                  tag folders + include/exclude filters — see its file.
├── settings/                      Settings bubble panel (non-modal, hover/pin, z-[200]),
│                                  one file per section — see its file.
└── ui/                            shadcn-style primitives; dialog.tsx documents the z-ladder — see its file.
```

## Current state — 2026-08-02

Masonry is post-milestone stable: occupancy packer + placement pins + two-layer gesture model (live footprint / settle commit), motion unified in masonryMotion.ts. No open masonry defects. Deferred with a named trigger: optimistic pre-pack settling stays unbuilt because it crosses the just-stabilised release handoff — reopen only if a release build still shows release dead-time, proven by the ghost remaining visibly frozen between pointer-up and the authoritative dense-pack commit (the aspect-scaling test in masonryPacking.test.ts cites this deferral).

## The packing core

`computeMasonryGeometry(input)` takes catalogue-sized numeric typed arrays (`ids`/`widths`/`heights`/`spans` as Float64/Int32 — Float64 because JS layout arithmetic is double, so bit identity survives the worker boundary) and returns index-aligned typed arrays. `ids` being numeric lets a live gesture resolve its stable tile ID after a delta merge or shuffle without holding an array index. Solver dispatch is structural:

| Input shape | Solver | Why |
| --- | --- | --- |
| No gesture, no pins, every tile span-1 | Historical scalar `colHeights` frontier | Resting layout preserved byte-for-byte, strict leftmost ties (21 equivalence tests) |
| Any session placement pin present | Occupancy, for the rest of the session | An anchored rectangle needs the interval model; measured ~2.3× the fast path at 48k items, in-worker, near-linear — a real but invisible tax, recorded deliberately |
| A gesture, or any span > 1 | Per-column sorted occupied intervals | Only model that can represent and backfill free space below a wide/fixed rectangle |

Occupancy stores each column as a flat `[top0,bottom0,top1,bottom1,…]` sequence; `lowestFreeY` probes every column in a candidate span, advances to the furthest colliding bottom, and repeats until the rectangle fits (intervals include the trailing vertical gap). Reservation priority: the live gesture footprint first (it always owns its own ID), then settled placement pins in feed order, then the hero, then the ordinary loop — every ordinary item starts its search at y=0 so short tiles backfill below wide obstacles. A stale or overlapping pin whose `[top, top+height+gap)` window is not free in every covered column loses its reserve-first turn: that tile falls back to feed order, keeps its pinned left column, and uses `lowestFreeY` — the collision fallback that keeps zero settled overlaps structural while valid pins make the settle pixel-identical to the telegraph. Invalid/non-positive dimensions degrade to a square in the core; the image-mapping boundary independently converts 0/negative/non-finite/null to the 400×400 placeholder so `Infinity` can't poison a column even when callers bypass normal loading.

Worker protocol: the first request for a base revision transfers the arrays once; subsequent pointer frames for that revision send only `{gen, revision, gestureFootprint}`. Queueing is bounded, not FIFO — one in flight plus latest-pending-only (intermediate pointer requests replace each other), which bounds both memory and lag where generation checks alone would still compute every stale request. The synchronous fallback keeps correctness when Worker construction/execution fails. `MasonryAnchor` publishes committed numeric `data-masonry-*` attributes; telemetry and the layout monitor read those — never a descendant's live visual transform — so animation can't be misreported as a settled overlap.

## The gesture decision ledger (saga closed 2026-07-19, live-verified)

Distilled at the close of the 2026-07-15→19 gesture saga (six fix rounds, four independent hunter swarms; commit arc `889b765 → 6ac208a → f7f3e4b → 0d42833 → c3c18e7 → 102d1ad`, closed at 4009be0). What a future session must not re-derive:

| Decision | Rejected alternative | Why it lost |
| --- | --- | --- |
| Occupancy packer | Skyline/scalar frontier + anchor patches (3 rounds of them) | A scalar frontier structurally cannot represent free space beneath a wide tile; every anchor patch circled the wrong layer |
| Reserve-first placement pins | Column-only pins | A column pin steers one axis; settle Y re-derived as max-of-N-frontiers landed span≥2 one cell off, 6/6 live |
| Reserve-first placement pins | Joint release solve (search insertions for densest match to the drop rect) | Pins reach the same WYSIWYG outcome with a fraction of the machinery; joint-solve remains the escalation if pins ever prove insufficient |
| Pins reserved BEFORE the ordinary loop | Anchored placement at column top / at feed turn | Feed-turn `lowestFreeY` was the round-2 bug itself; column-top placement teleports mid-grid tiles |
| Release targeting excludes self + source-drop slot guard | Self-inclusive max-overlap ("dropping on your own slot no-ops naturally") | Self-overlap scales with tile width: a span-2 one-column move could NEVER commit (68.7k px² self vs 31.8k best neighbour) |
| Delete the edge-reference convention (`startCol` = physical left, always) | Fix the centre formula for even spans | An absent mechanism cannot disagree with its caller again; the range concern motivating centre-reference applied to pointer-reads, not rectangle-reads |
| Real repack on release + pins | commit-adopt (freeze the last gesture geometry) | Adopt froze non-dense states and required racy guards (5e829dc/8fa6288 era); pins keep the ONE intentional rectangle and re-solve density around it |
| Origin-relative 48px top quantum | Raw pointer Y per frame / absolute grid quantum | Raw Y re-solved the grid per pixel (mid-drag chaos); the absolute quantum phase-shifted the first footprint ±24px |
| Clear pins on geometry-basis change | Rescale pins proportionally | Pins are px in a specific basis; rescaling is speculative machinery for a rare event — releasing the arrangement is honest and cheap |

Two-layer gesture model, restated as the invariant: the ACTIVE tile's pixels follow the pointer 1:1 via an imperative `translate3d` on an inner wrapper; its anchor owns the committed slot and renders the drop placeholder; NEIGHBOURS pack around the reserved footprint. Two writers never share one transform — treating worker-paced structural geometry as the direct-manipulation visual is what made drag snap by columns and resize jump by spans.

Accepted costs (deliberate, not oversights): any pin retires the scalar fast path for the session (~2.3× above); two pins with overlapping rects can swap priority across packs via feed order (corner state, never an overlap or void); a pinned tile can leave a small gap when no later tile is short enough to backfill (inherent to honouring user placement); mid-flight tiles can cross during the 200ms live reflow or 260ms settle (painter-order flip, sub-second, accepted since 91564f0 — deliberate-collision choreography was never built because stable pack targets made it unnecessary). Also accepted: live-mode transitions are transform-only, so a mid-gesture window resize or feed-delta that changes an already-resized neighbour's dimensions snaps that tile's width for one frame — rare, invisible against an active gesture, and cheaper than layout-property transitions on the live path.

The three process lessons, hard-won:

1. **Telemetry is evidence only after its own measurement is verified.** Transform-inflated "overlaps", gap `above`/`below` misread as coordinates, and phantom "306px gaps" (span-2 tiles invisible to a left-edge-binned gap detector) each cost a wrong diagnosis.
2. **Green tests measure what they assert, nothing more.** 179/179 coexisted with a broken feature because no test moved a tile by less than its own width, tested even spans on edge modes, or asserted cross-pack position stability — the suite now carries those gates (WYSIWYG settle equality, sign-flip variants, collision fallback, rect-pin fuzz, basis sweep).
3. **Blind swarms converge when the bug is real.** Independent hunters with shared evidence and no shared hypotheses agreed on one mechanism both rounds — the convergence itself was the confidence measure.

## Do not reintroduce (verified failures)

- **`content-visibility: auto` on tiles** — caused disappearing tiles during fast drags (removed in 4dd85ba); redundant anyway, the engine already viewport-culls.
- **Byte-capped decode LRU / grid `fetchpriority`** — the modal/timer predecode need is a 2-deep ref window (shipped); formal LRU accounting is disproportionate and `fetchpriority` support in WKWebView is uncertain while the grid already lazy-loads non-selected images.
- **Animation-engine unification** (anchor CSS vs Framer layout) — bounded to O(visible) cost; merging risks the motion feel and the deliberate transform separation. Only as a dedicated experiment with before/after animation capture, never bundled into other work.
- **Framer Motion `layout` as a second geometry animator**, imperative geometry as a second structural truth, DOM hit-testing/hover-swap reorder, and full-catalogue placement objects — all removed for cause during the saga; committed geometry stays typed arrays, visible placements materialise on demand.

## Traps

- **BootSplash's status node is load-bearing.** `OnboardingProvider` MutationObserves `[role="status"][aria-label="Loading Lynceus"]` and auto-opens onboarding only after it unmounts. Renaming that role/label silently breaks first-boot onboarding; the coupling is commented on both sides — keep both in sync.
- **Never re-hardcode motion numbers.** Durations/easings come from `masonryMotion.ts`; tests import the tokens. A literal `duration-400` or a ms constant in a component reintroduces the drift 3d72951 killed.
- **Stale worker results.** Pack responses are generation-tagged; a late response for an old generation must be dropped, and a worker FAILURE must not overwrite an adopted layout (8fa6288). Don't "simplify" the guard away.
- **Prewarm fan-out.** Each prewarmed tile costs a 3-encoder fused search plus a detail hydrate. The cap in Masonry.tsx exists because uncapped prewarm froze clicks under indexing load; hover still warms any tile on intent.
- **Footprint convention.** `startCol` is the physical left column, always. The old left/right/centre edge-reference convention was removed because centre was ambiguous for even spans — don't reintroduce it.

## Key findings

- Settle curves that accelerate from zero read as lag even at perfect frame rate; the grid decelerates into place (ease-out-expo) by decision (3d72951).
- A starved measurement loop manufactures teleport evidence — the layout monitor is armed-when-active precisely because free-running measurement both cost frames and faked the jank it reported.
