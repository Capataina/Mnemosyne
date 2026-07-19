# masonry-layout

*Maturity: comprehensive · Stability: active validation*

## Scope / Purpose

The Pinterest-style grid renderer for Lynceus. It computes the column geometry,
packs variable-aspect and multi-column images, promotes a selected image to a hero,
virtualises the catalogue, and owns drag-to-reorder plus four-corner resize.

The July 2026 gesture rebuild replaced the old scalar-frontier gesture patches with
an occupancy-aware layout transaction. Resting, all-span-1 feeds deliberately retain
the historical scalar algorithm byte-for-byte; gestures and any multi-span feed use
per-column occupied intervals so later tiles can backfill below a wide or fixed tile.
The same numeric core runs in the Web Worker and synchronous fallback.

## Boundaries / Ownership

- **Owns:** column count and width, scalar/occupancy packing, selected-hero
  placement, gesture footprints, release settling, visible-window materialisation,
  drag reorder intent, resize intent, worker request coalescing, the committed
  anchor rectangle, and the active tile's cosmetic pointer-follow delta.
- **Does not own:** feed assembly or shuffle, image metadata persistence, modal
  routing, tags/notes, or the quick-start timer. The route persists resize spans;
  reorder remains an in-session nudge.
- **Public surface:** `<Masonry items selectedItem minItemWidth columnGap
  verticalGap onItemClick columnCountOverride? tileScale? animationLevel?
  reorderEnabled? onReorder? onResizeCommit? onItemHover? heroOverlay? />`.

## Current Implemented Reality

### Component and data-flow shape

```text
Masonry.tsx
├── useTileDrag.ts ───────┐
├── useTileResize.ts ─────┼── one MasonryGestureFootprint
└── useMasonryEngine.ts ◄─┘
    ├── masonryPacker.ts ─── masonryWorker.ts
    └── masonryPacking.ts ── scalar fast path | occupancy path

visible typed geometry
  └── MasonryAnchor.tsx ── committed x + y + width + height
      └── MasonryItem.tsx ── active-only pointer ghost + content/affordances
```

`masonryReorder.ts` is now commit-time only. It derives one target from the stable
pre-gesture placement snapshot and performs one stable-ID insertion; it does not
drive the live layout. Scoring the final obstacle geometry is deliberately avoided:
the reservation has already displaced every candidate away from the drop rectangle.

Source spine:

- `apps/lynceus/src/components/{Masonry.tsx,MasonryAnchor.tsx,MasonryItem.tsx,
  masonryPacking.ts,masonryPacker.ts,masonryWorker.ts}`
- `apps/lynceus/src/hooks/{useMasonryEngine.ts,useTileDrag.ts,useTileResize.ts,
  masonryReorder.ts}`

### The dual-path numeric geometry core

`computeMasonryGeometry(input)` accepts catalogue-sized numeric typed arrays and
returns index-aligned typed arrays. `ids` is numeric too, allowing a live transaction
to resolve its stable tile ID after a delta merge or entry shuffle without retaining
an array index.

```ts
interface MasonryGestureFootprint {
  id: number;
  span: number;
  startCol: number; // always the physical LEFT column
  top: number;
}
// The old edge-reference field (left/right/centre) is gone: its centre mode
// was ambiguous for even spans and reserved the slot one column left of the
// rendered ghost — the 2026-07-19 fix round deleted the convention outright.
interface MasonryPlacementAnchor {
  startCol: number;
  top: number;
}

interface MasonryPackInput {
  ids: Float64Array;
  widths: Float64Array;
  heights: Float64Array;
  spans: Int32Array;
  // scalar layout configuration + selected hero metadata
  gestureFootprint: MasonryGestureFootprint | null;
  placementAnchors: Record<number, MasonryPlacementAnchor> | null;
}
```

The dispatch rule is structural:

| Input shape | Solver | Reason |
|---|---|---|
| No gesture, no placement anchors, and every ordinary tile spans one column | Historical `colHeights` scalar frontier | Preserves the resting layout bit-for-bit, including strict leftmost ties |
| Any session placement anchor present | Occupancy path for the rest of the session (until the anchors' lifecycle clears them) | An anchored rectangle needs the interval model; measured ~2.3× the fast path at 48k items in a worker — a real but invisible tax, recorded deliberately |
| A gesture exists or any tile spans more than one column | Per-column sorted occupied intervals | Can represent and backfill free space below wide/fixed rectangles |

The occupancy path stores each column as a flat numeric sequence
`[top0,bottom0,top1,bottom1,…]`. `lowestFreeY` probes all columns in a candidate
span, advances to the furthest colliding bottom, and repeats until the rectangle
fits. Intervals include the configured trailing vertical gap.

For a gesture, the solver resolves the stable ID, computes the active tile's exact
aspect-scaled rectangle, inserts it into every covered column first, and skips that
feed entry in the ordinary loop. The hero is reserved through the same occupancy
mechanism. Every other item starts its search at `y=0`, so a short tile can occupy a
free interval below a wider obstacle instead of inheriting an irreversibly raised
column frontier.

Settled placement anchors use the same priority model. After the live footprint
(if any), anchored tiles present in the feed reserve their complete
`{startCol, top}` rectangles first, in feed order, before the hero and ordinary
loop. The live footprint always owns its own ID. If a stale or overlapping pin's
`[top, top + height + verticalGap)` window is not free in every covered column, it
does not reserve first; that tile returns to its feed-order turn, keeps the pinned
left column, and uses `lowestFreeY`. This collision fallback preserves the
structural zero-overlap guarantee while valid pins make settle pixel-identical to
the telegraph and let later tiles backfill densely around them.

Invalid/non-positive source dimensions degrade to a square in the core. The image
mapping boundary independently converts `0`, negative, non-finite, `null`, and
`undefined` dimensions to the 400×400 placeholder, preventing `Infinity` from
poisoning a column even when callers bypass normal data loading.

### Worker protocol and 100k behaviour

The first request for a base revision transfers `ids`, `widths`, `heights`, and
`spans` once. The worker retains those arrays; subsequent pointer frames for the
same revision send only `{gen, revision, gestureFootprint}`. A changed feed,
selection, width, or packing setting creates a new revision and transfers fresh
arrays.

Queueing is bounded rather than FIFO:

```text
one in flight ── result ──► latest pending only
      ▲                         │
      └──── intermediate pointer requests replace one another
```

Full recomputes remain worker-side. Generation checks reject results superseded by
a newer pointer or authoritative feed input. On the main thread, changing the
footprint does not invalidate the O(N) visible-window scan: culling depends only on
the stable active ID, while an ordinary pointer frame writes one active wrapper and
sends an O(1) reuse message. The synchronous fallback retains correctness if Worker
construction or execution fails.

### `useMasonryEngine` — orchestration, release, and virtualisation

The engine caches one flattened input per base revision, owns the committed typed
geometry, and materialises placement objects only for the visible window. It retains
the existing 240-item synchronous prefix for first paint/large expansion and the
800px overscan plus 400px guard band for scroll virtualisation.

Gesture release is an explicit state machine:

```text
idle ── footprint appears ──► active
active ── final obstacle geometry commits and footprint clears ──► settling
settling ── final dense pack or any newer authoritative pack commits ──► idle
```

There is no geometry-adoption branch. Clearing an obstacle always requests a real
dense pack. A superseding authoritative generation is allowed to finish settling,
so a discarded final generation cannot strand transitions permanently.

Visible IDs are kept mounted across gesture and non-scroll repacks. Anchors render
in stable ID order even though placements remain in feed order; React therefore
updates persistent nodes instead of relocating them in the child list, preserving
the CSS transition start frame for displaced tiles.

### `useTileDrag` — one spatial transaction

A 6px threshold separates click from drag. Each animation frame converts the
pointer delta into a stable-ID footprint:

- X is the ghost rectangle's nearest left column, clamped span-aware — the
  reserved slot is the column-quantised ghost itself.
- Y is the desired top stepped to a 48px quantum (the ghost stays pixel-exact;
  packs fire per step crossing rather than per pointer pixel).
- One inner wrapper receives the exact pointer delta outside React. There is no DOM
  hit test, hover swap, or repeated array splice.

Pointer-up flushes the exact final coordinate and keeps that footprint active until
the engine confirms that exact generation. Release is WYSIWYG: the COMMITTED
footprint rectangle from the gesture pack (the slot the preview displaced
neighbours around) — never the raw pixel ghost — is scored by
`reorderAtSpatialTarget` against the pre-gesture snapshot with the active tile
EXCLUDED, selecting the maximum-overlap/nearest-centre neighbour for one
ID-based insertion, and the footprint's `{startCol, top}` travels up as a
session placement pin.
The one genuine no-op is a slot comparison in the hook (same start column, top
within half a tile height of the source): the earlier self-inclusive overlap
scoring made every one-column multi-span move a silent no-op, because a wide
tile out-overlaps any smaller neighbour on its own vacated rect (the
2026-07-19 snap-back diagnosis). The active anchor renders a drop placeholder
in the reserved slot, which otherwise paints as bare background while the
tile's pixels float with the pointer. The ghost stays at the literal drop
rectangle while the worker computes the dense layout; once that geometry
commits, its transform animates to zero over the snapped anchor. Concurrent
feed deltas are merged by stable ID; no interaction state stores a feed index.

### `useTileResize` — all four corners and atomic span authority

The grip determines both moving edges; the diagonally opposite corner remains fixed:

| Grip | Fixed corner | Vertical behaviour |
|---|---|---|
| `br` | top-left | top remains fixed; grows down |
| `bl` | top-right | top remains fixed; grows down |
| `tr` | bottom-left | bottom remains fixed; grows up |
| `tl` | bottom-right | bottom remains fixed; grows up |

Left grips derive a new start column from the fixed right edge. Top grips derive a
new exact top from the fixed bottom and clamp whole-span growth before crossing
`y=0`. The active wrapper follows the exact aspect-locked pixel rectangle on every
animation frame, while React and the worker see only the nearest whole-span
footprint. The footprint reserves structural space before neighbours are packed, so
upward growth is real solver geometry rather than a CSS offset illusion.

On pointer-up, the exact final span remains in phase `committing` while the route's
`mutateAsync` performs its optimistic manifest update and persistence. The footprint
clears only after that Promise settles. There is therefore no render in which the
preview has vanished but the feed still describes the old 1×1 span, and no geometry
from such a gap can be adopted. It then enters `settling`: the dense pack commits
behind the retained pixel ghost, whose transform, width, and height animate to the
committed anchor before local gesture state clears. The commit callback carries
the previewed `{startCol, top}`, which the route stores as a session placement
anchor only after mutation success. The settle pack therefore reserves the exact
rectangle the resize preview showed instead of re-deriving X by global argmin or
Y from the maximum frontier across its new span (the two pre-fix release jumps).

Resize uses the same view-level enable gate as drag. Opening a selected hero hides
all neighbour grips, prevents new pointer-down transactions, and cancels an active
resize if the gate closes concurrently. No gesture footprint can therefore reserve
space before and displace the top-left hero.

### Rendering and telemetry geometry

`MasonryAnchor` writes the complete committed rectangle: transform X/Y plus explicit
width and height. The active tile alone may carry a temporary child-wrapper
transform/size delta. This cosmetic layer gives pointer-exact drag and resize without
changing the occupancy rectangle, worker protocol, or any neighbour placement. The
image fills that wrapper with `h-full w-full object-cover`.

The anchor also publishes committed numeric data attributes. Geometry telemetry and
the layout monitor read those values for x/y/w/h rather than a descendant's live
visual transform; animation or a future cosmetic effect can no longer be misreported
as a settled pack overlap.

## Key Interfaces / Data Flow

| Source | Provides | Consumer/effect |
|---|---|---|
| Route | Feed, selection, preferences, callbacks | Masonry composition shell |
| Drag/resize hook | One stable-ID 2D footprint | Engine occupancy reservation |
| Active gesture hook | Pointer-exact wrapper delta | Cosmetic direct-manipulation preview |
| Engine | Visible `MasonryItemPlacement[]`, total height | Anchors and container |
| Drag release | Reordered ID sequence + `{startCol, top}` pin | Route's `sessionOrder` + `placementAnchors` |
| Resize release | ID, persisted span, previewed `{startCol, top}` | `useSetManualColSpan().mutateAsync` + `placementAnchors` |
| Anchor data attributes | Committed x/y/w/h | Profiling-only layout monitor |

## Verification Surface

The regression surface now includes:

- the 21 historical `masonryPacking.test.ts` cases;
- typed-array/object equivalence and prefix suffix-independence;
- grow/shrink and reorder-free resize settles that are pixel-identical to the
  committed telegraph, full-rectangle stability across a perturbed re-pack,
  overlapping-pin fallback, and 40 seeded random rectangle-pin non-overlap trials;
- occupancy backfill, fixed-top resize displacement, release gap monotonicity,
  stable-ID shuffle survival, and non-intersection checks across the recorded
  `perf-1784401362`/`perf-1784401528` cursor paths at spans 1, 2, and 3;
- all four opposite-corner resize invariants and the async commit hold;
- drag's exact-final-generation release barrier and pre-gesture drop targeting;
- active wrapper pointer-follow/pixel-resize writes plus committed-geometry telemetry assertions;
- resize gesture/handle gating while a selected hero is open;
- worker one-in-flight/latest-pending and base-revision reuse;
- finite 100k-item gesture geometry plus literal-zero dimension hardening.

The former diagnosis-only `*.repro.test.ts[x]` files are gone; their durable
behavioural claims live in the ordinary suites above.

## Known Issues / Active Risks

| Risk | Trigger | Consequence / verification path |
|---|---|---|
| Full occupancy recomputation is still O(N), although worker-side and coalesced | Continuous gestures in a real 100k catalogue | No main-thread catalogue transfer or FIFO backlog remains, but pointer feel still needs live WebView profiling at the full scale |
| Visible-window materialisation scans committed geometry when a new authoritative layout lands | Frequent accepted worker results at 100k | Pointer-only renders no longer trigger it; build the deferred y-range index only if profiling shows accepted-result scans are material |
| Resize persists; reorder does not | User expects both gestures to survive restart | Deliberate product asymmetry; reorder is session state and reshuffle clears it |
| Placement-anchor tops are absolute pixels | Container width, column count, or `tileScale` changes | Pins CLEAR automatically when the pack's coordinate basis changes (`onGeometryBasisChanged` → the route empties the map), so a stale-space pin can never reserve a void; the arrangement is simply released on a reflow of the space it was made in |
| Overlapping pins can swap priority | Two pins whose rects overlap plus a later feed reorder between them | Feed order decides which reserves first, so the pair can exchange slots across packs — a feel nit in a corner state, never an overlap or void |
| Backend `set_manual_order` remains callerless | Reading Rust commands without the frontend path | Can be mistaken for live persisted reorder; no frontend uses it |
| EXIF orientation is not normalised | A phone image stores rotated pixels plus orientation metadata | WebKit may display a different aspect from stored dimensions; separate latent image-pipeline issue, not a masonry intersection cause |

## Durable Notes / Discarded Approaches

- **Occupancy for structural rectangles; scalar frontier only for the proven
  equivalence case.** A scalar `colHeights[]` cannot represent a free interval
  below a wide tile. Repeated tie-breaks, column-only pins, and anchor perturbations
  cannot repair information the model discarded.
- **Structural geometry and cosmetic motion have different owners.** The anchor owns
  every committed rectangle used by occupancy and telemetry. A single active child
  wrapper owns only the transient pointer delta, then animates that delta to zero
  after the dense release pack. Treating worker-paced structural geometry as the
  direct-manipulation visual made drag snap by columns and resize jump by spans.
- **A spatial obstacle, not hover-order churn.** DOM hit-testing and repeated
  feed splices produced global ripple from diagonal motion. The packer now reacts
  to one 2D footprint; ordering is a single release-time tie-break.
- **Real repack, not commit-adopt.** Holding the entire preview geometry preserved
  every neighbour's transient state. Release now replaces the live obstacle with
  one settled placement pin and solves density around it under a non-stranding
  state machine.
- **Stable ID, never gesture index.** The feed can delta-merge and shuffle while
  a gesture is alive; numeric `ids` resolve the live row at each base revision.
- **Promise-held resize preview.** Clearing local state in the same tick as an
  async mutation created a stale-span frame. Persistence becomes authoritative
  before the preview is allowed to disappear.
- **Bounded worker queue.** Generation checks alone discarded stale answers but
  still computed every stale request. One in-flight plus latest pending bounds
  both memory and lag.
- **Float64 across the worker boundary.** JavaScript layout arithmetic is double;
  Float64 preserves bit identity while typed arrays keep the transfer compact.
- **Stable-ID DOM order.** Visual placement is transform-driven, so sorting
  anchors by ID prevents React child relocation from destroying transition
  continuity during an otherwise valid reorder.

## Obsolete / No Longer Relevant

- `anchorIndex`, `anchorStartCol`, `anchorEdge`, `prevCols`, `columnAnchor`,
  `justEnded`, `ordersAligned`, and commit-adopt geometry.
- Imperative geometry as a second structural truth. The restored wrapper writes are
  active-only cosmetic deltas; packed anchors remain authoritative.
- Pointer hover-swap and the spurious final pointer-up swap.
- CSS-only top-corner `offsetY` growth and the assumption that top/bottom grips
  share vertical semantics.
- FIFO worker dispatch of every pointer generation.
- Framer Motion `layout` as a second geometry animator.
- Full-catalogue placement objects; committed geometry remains typed arrays and
  visible placements materialise on demand.

Cross-links: feed assembly, shuffle, and delta merge live in
`systems/feed-protocol.md`; user preferences and session order live in
`systems/frontend-state.md`; image dimension provenance lives in
`systems/thumbnail-pipeline.md`; selection and similar-prefetch routing live in
`systems/search-routing.md`; the hero overlay is owned by
`systems/gesture-timer.md`.
