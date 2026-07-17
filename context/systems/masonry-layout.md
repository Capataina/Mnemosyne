# masonry-layout

*Maturity: comprehensive · Stability: unstable*

## Scope / Purpose

The Pinterest-style grid renderer. Computes column count from container width and a
min-item-width prop (or honours an explicit override from `useUserPreferences.columnCount`),
performs shortest-column packing for each item, promotes the currently-selected item to a
hero card spanning up to 3 columns at the top of the grid, virtualizes to the visible
viewport, and owns two live pointer gestures — drag-to-reorder and drag-to-resize.

The v2 rebuild (`b12ba46`) split the old 514-line `Masonry.tsx` monolith (packing +
virtualization + drag + resize + scroll, all in one file) into three headless hooks plus a
thin composition shell. The perf round (`012012c`, T3-3) then moved the pack itself off the
main thread into a Web Worker over typed arrays, because a 100k-image shortest-column pack
on the main thread would block every pointer frame. Nothing about the packing *algorithm*
changed between these two rebuilds — `computeMasonryLayout` (the pre-existing public
contract) is now a thin decorator over a new numeric core, `computeMasonryGeometry`, and all
21 pre-existing packing tests pass against it unchanged.

## Boundaries / Ownership

- **Owns:** column-count computation, shortest-column (or `span`-wide window) packing,
  hero promotion for the selected item, viewport virtualization (which placements
  materialise as DOM), drag-to-reorder pointer state machine, drag-to-resize pointer state
  machine, per-tile animation level honouring, the off-main-thread pack (Worker + sync
  fallback).
- **Does not own:** the image data itself (delegates to `frontend-state` / `search-routing`
  via the `items` prop — see `feed-protocol` for how that feed is assembled), modal opening
  (delegates to `pages/[...slug].tsx` via `onItemClick`), tag/notes editing (delegates to
  `tag-system` via `PinterestModal`), the quick-start timer pill's own state (renders it as
  an opaque `heroOverlay` node — see `gesture-timer`), persistence of reorder/resize (reorder
  is deliberately NOT persisted; resize commits through a route-level mutation into
  `manual_col_span` — see below).
- **Public API:** `<Masonry items={FeedItem[]} selectedItem={FeedItem | null}
  minItemWidth columnGap verticalGap onItemClick columnCountOverride? tileScale?
  animationLevel? reorderEnabled? onReorder? onResizeCommit? onItemHover? heroOverlay? />`.

## Current Implemented Reality

### Component/hook shape

```
Masonry.tsx                 — thin composition shell: owns shared refs, wires the three
                               hooks together, renders <MasonryAnchor><MasonryItem/></...>
  useMasonryEngine.ts        — packing (off-thread) + viewport virtualization
  useTileDrag.ts             — pointer-driven drag-to-reorder (live in-session)
  useTileResize.ts           — smooth pixel resize, snaps to a column span on release
  masonryPacking.ts          — pure geometry core + object-placement decorator (no React)
  masonryPacker.ts           — thin client over the Worker, with a sync fallback
  masonryWorker.ts           — Worker entry point (imports the same pure core)
  masonryReorder.ts          — pure id→index map maintenance for the drag hover-swap
MasonryItem.tsx              — per-tile renderer (dumb; memoised with a custom comparator)
MasonryAnchor.tsx            — absolute-positioned wrapper placing a tile at (x, y)
```

Source: `apps/lynceus/src/components/{Masonry.tsx,MasonryItem.tsx,MasonryAnchor.tsx,
masonryPacking.ts,masonryPacker.ts,masonryWorker.ts}`, `apps/lynceus/src/hooks/
{useMasonryEngine.ts,useTileDrag.ts,useTileResize.ts,masonryReorder.ts}`.

### The typed-array geometry core (T3-3)

`computeMasonryGeometry(input: MasonryPackInput): MasonryGeometry`
(`masonryPacking.ts:156-281`) is the one place the shortest-column algorithm lives. It takes
and returns only numbers and typed arrays — no object references — so it can (a) run inside
a Web Worker across a structured-clone/transfer boundary and (b) hold a whole 100k-image
layout as five flat typed arrays instead of 100k placement objects plus a 100k-entry Map:

```ts
interface MasonryPackInput {
  widths: Float64Array; heights: Float64Array; spans: Int32Array;   // per-item, feed order
  containerWidth: number; minItemWidth: number; columnGap: number; verticalGap: number;
  columnCountOverride: number; tileScale: number;
  hasHero: boolean; selectedIndex: number;                          // -1 = no hero
  selectedWidth: number; selectedHeight: number;
}
interface MasonryGeometry {
  xs: Float64Array; ys: Float64Array; widths: Float64Array; heights: Float64Array;
  spans: Int32Array;                       // index-aligned to the input feed order
  selectedIndex: number; hero: MasonryHeroGeometry | null;
  height: number; columnCount: number; columnWidth: number; count: number;
}
```

Precision note: geometry crosses as `Float64Array`, never `Float32Array` — JS packing math
is double throughout, so a Float64 round-trip is bit-for-bit equal to a direct object pack
(the equivalence invariant a 200-trial randomised test in `masonryGeometry.test.ts` locks:
`matches computeMasonryLayout bit-for-bit across random inputs`). Float32 would truncate
x/y/w/h for a ~2 MB saving at 100k that doesn't matter at this scale.

Packing algorithm (unchanged since before the split): for each item, find the window of
`colSpan` adjacent columns whose current max height is smallest (a plain shortest-column
search when `colSpan === 1`), place the item flush against that max, and scale height to
preserve aspect ratio at the spanned width. The hero (selected item) is placed first,
spanning `min(colCount, 3)` columns at the top-left, before the loop runs — `masonryPacking.ts:210-228`.

`buildPackInput` flattens a `FeedItem[]` + selection into the numeric shape (resolves each
item's span as `override ?? item.manualColSpan ?? 1`), and `placementAt`/`heroPlacement`
reattach one placement object's worth of `{itemData, x, y, width, height, isSelected,
colSpan}` from the geometry — the single call site both the object-decorator path and the
engine's visible-window pass share, so the placement shape can't drift between them.

### Off-thread packing (`masonryPacker.ts` + `masonryWorker.ts`)

`createMasonryPacker()` constructs a Vite module Worker (`new Worker(new URL("./
masonryWorker.ts", import.meta.url), { type: "module" })`). `pack(gen, input)` transfers the
three input typed arrays into the worker (`postMessage(..., [widths.buffer, heights.buffer,
spans.buffer])` — zero-copy); the worker runs `computeMasonryGeometry` (the identical pure
function, imported verbatim — worker output is bit-for-bit identical to the sync path by
construction, not just by test) and transfers the five result arrays back the same way. If
the Worker fails to construct (unsupported environment) or errors at runtime, the packer
tears it down and every subsequent `pack()` call computes `computeMasonryGeometry` inline on
the calling thread instead — **the grid is never dependent on Worker availability.**

### `useMasonryEngine` — packing orchestration + viewport virtualization

Generation-tagged requests. Every `requestPack()` call increments a module-local `genRef`;
`isCurrentGeneration(resultGen, currentGen)` (pure, unit-tested) discards any worker result
whose generation has been superseded by a newer filter/resize/reorder input — a rapid input
sequence converges to the latest, never an interleaved stale one.

First paint / large-expansion prefix. `PREFIX_PACK_COUNT = 240`: when there is nothing
committed yet, or the incoming item count dwarfs the committed one by `RESET_EXPANSION_RATIO
= 4` (the filter-clear / return-to-full-feed case), the engine packs the first 240 items
*synchronously* on the calling thread before the full off-thread pack even starts. This
works because the packing order is prefix-independent — the first K items get exactly the
geometry the full pack would give them, so the worker's eventual full result swaps in with
no visible reflow (locked by `masonryGeometry.test.ts`'s "prefix pack — suffix-independence"
suite). An incremental delta (100k → 100k + tens of new items) never trips the 4× ratio, so
the feed keeps its committed geometry and only swaps once the full off-thread result lands.

Committed height never shrinks under a partial (prefix) commit — `commit()` takes
`max(prefixHeight, committedHeightRef.current)` — so a small first-paint prefix can never
clamp scroll under a scrolled-down position.

Viewport virtualization with a guard band. `VIEWPORT_OVERSCAN_PX = 800`, `VIEWPORT_GUARD_BAND_PX
= 400`. Scroll updates coalesce through one `requestAnimationFrame`; `isWithinGuardBand`
(pure, unit-tested) suppresses re-committing the visible-placements memo while the on-screen
window still sits inside the previously-committed ±800px overscan window with at least a
400px margin — so a scroll only re-runs the visible-set filter roughly once per 400px of
travel, not per scroll event. Placement *objects* materialise only for the items inside
`[viewport.top, viewport.bottom]` (plus the hero, which always renders, and the actively
dragged tile, which is force-included even off-screen) — full-catalogue geometry stays as
flat typed arrays the whole time; the O(visible) materialisation is the only place placement
objects get built for anything beyond the 240-item prefix.

Shared refs, not React state, for gesture reads. `placementsRef`, `placementByIdRef`,
`columnWidthRef`, `columnCountRef` are written during the visible-placements `useMemo` and
read directly by `useTileDrag`/`useTileResize` — this is what lets a pointer-move handler
look up the active tile's current placement without re-subscribing to a render on every
frame.

### `useTileDrag` — drag-to-reorder

A pointer-event state machine (native HTML5 DnD fights Framer Motion's `layout` animation,
so this is hand-rolled). `DRAG_THRESHOLD_PX = 6` gates a drag from a click. While dragging,
the dragged tile's continuous x/y is an imperative `translate3d` write on its DOM wrapper
node — coalesced to at most one `requestAnimationFrame` per pointer-move burst — and React
only receives a `workingOrder` state update when the pointer enters a *different rendered
tile* (a hover swap), because that discrete event is the only moment the pack actually needs
to change.

Hover-swap hit-testing walks `document.elementsFromPoint(x, y)` and picks the first
`[data-masonry-id]` ancestor that isn't the dragged tile itself (the dragged wrapper has
`pointer-events: none` during the drag so the browser reports what's underneath) — this
stays proportional to the tiny overlap stack at the pointer, never to the library's total
placement count.

O(1) reorder via a maintained id→index map (`masonryReorder.ts`). `buildIndexMap` builds the
map once, lazily, on the *first* swap of a drag (not at pointer-down — a plain click never
pays for it, and the drag threshold means the tile hasn't moved yet). `reorderWithinList`
then moves one id to another's slot and patches only the touched `[min(from,to),
max(from,to)]` window of the map in place — this replaces what used to be two O(N)
`findIndex` scans per hover-swap.

On drop: if the tile actually moved, `onReorder(orderedIds)` fires once with the complete
new id ordering, and the click that naturally follows the pointerup is suppressed
(`suppressClick`) so it doesn't also select/navigate the tile.

### `useTileResize` — drag-to-resize

Continuous pixel tracking, not quantized. `applyPointerX` computes a continuous
`previewPx` from the raw pointer delta (sign-flipped for a left-hand corner grab so
"dragging away from the tile" always grows it) and writes `width` + a compensating
`translate3d` directly to the tile's DOM node every animation frame — this is the fix for
the pre-split bug where resize only visibly moved once the pointer crossed a whole column
boundary ("jumps a column"). React only sees a state update (`previewSpan`) when the
continuous width crosses a *rounded column-span* boundary — the only moment the rest of the
grid's footprint (and therefore the pack) actually needs to change.

On release, `onResizeCommit(id, previewSpan === 1 ? null : previewSpan)` fires once. The
route (`pages/[...slug].tsx:481-487`, `handleResizeCommit`) persists this via
`setManualColSpanMutation` into the DB `manual_col_span` column — **resize persists;
reorder does not** (see Durable Notes).

### `Masonry.tsx` — the composition shell

Owns the refs shared by all three hooks (`containerRef`, `placementsRef`,
`placementByIdRef`, `tileElementsRef`, `columnWidthRef`, `columnCountRef`) and the
`suppressNextClickRef` that lets a drag/resize pointerup swallow the click that would
otherwise follow it. `effectiveItems = drag.workingOrder ?? props.items` — the packer sees
the live in-session reorder the instant a hover-swap happens. `spanOverrides` is built as a
single-entry `{ [id]: previewSpan }` object only while a resize is live *and* the preview
span differs from the base span — so dozens of pointer events within one column never change
this object's identity and never retrigger a pack; only a genuine span-boundary crossing
does. A `useLayoutEffect` re-syncs both hooks' imperative visuals against a fresh pack
*after* React has committed (a discrete pack can move the active tile's anchor beneath its
own imperative transform — this rebases it before paint so the resize edge or dragged tile
never visibly jumps).

Also prefetches the similar-set of every visible tile 200ms after the viewport settles
(`onItemHover`, debounced) — see `search-routing` for the query this feeds.

### Hero promotion

Unchanged in spirit from before the split: when `selectedItem` is non-null and present in
`items`, it renders first, at the top of the grid, spanning `min(colCount, 3)` columns. The
hero always renders regardless of scroll position (never flickers out from under the
modal) — `useMasonryEngine`'s visible-placements pass explicitly includes it ahead of the
viewport filter. The hero tile is also the one mount point for the quick-start timer pill
(`heroOverlay` prop — see `gesture-timer`).

### v2 visual layer (accent corner brackets, no 3D tilt)

`MasonryItem.tsx` renders four corner resize grips at a 32×32px hit-zone (`h-8 w-8`, up from
20px pre-v2) with an accent-coloured `L`-shaped border bracket (`border-l border-t
rounded-tl-[5px]` per corner) that fades in on tile hover and highlights on active resize —
replacing the pre-v2 amber corner-bracket handles. The 3D-tilt hover transform is gone
entirely: `motion.div`'s `layout` prop still animates position/size reflow (suppressed to a
plain 1:1 tracking transform only while *this* tile is being dragged or resized —
`gestureActive`), but there is no longer any hover-triggered 3D rotation. Both removals were
because the tilt caused a "yellow line" edge flare (the global focus outline catching light
through the 3D transform) and both read as visually cheap (see Durable Notes).

### `MasonryItem` memo comparator

`propsAreEqual` (a custom comparator, not the default shallow compare) compares `item`'s
pixel-affecting fields by value (`id, url, thumbnailUrl, hasThumbnail, width, height, name`)
and everything else (callbacks, `heroOverlay`, scalars) by reference. This exists because
react-query hands back a fresh `item` object on every catalogue refetch even when the values
are identical — without this comparator, every visible tile re-renders on every background
refetch during an indexing run. `heroOverlay` is compared by reference deliberately: the
route memoises the pill element so its identity only changes when its actual inputs change.

### Tile keying

`MasonryAnchor` is keyed by `id` alone in `Masonry.tsx`, never `id + url`. Keying by URL too
made a thumbnail-URL change (base→sharp bucket swap, or a re-index) unmount/remount the
whole anchor+item subtree, dropping `useAdaptiveThumbnail`'s query state and re-triggering
the pop-in animation. The comparator above handles the URL change as a cheap prop update
instead.

## Key Interfaces / Data Flow

### Inputs

| Source | Provides |
|--------|----------|
| `pages/[...slug].tsx` | `items` (the shuffled/session-ordered feed — see `feed-protocol` and `frontend-state`), `selectedItem`, `columnCountOverride`, `tileScale`, `animationLevel`, `onItemClick`, `reorderEnabled`, `onReorder`, `onResizeCommit`, `onItemHover`, `heroOverlay` |
| Container `ref` (via the engine's own scroll-container discovery) | Container width for auto column count; nearest scrolling ancestor for scroll-driven virtualization |
| `useUserPreferences` | `columnCount` override, `tileScale`, `animationLevel` (see `frontend-state`) |

### Outputs

| Destination | What |
|-------------|------|
| Container DOM | Absolute-positioned `<MasonryAnchor>` wrappers around each `<MasonryItem>`, visible-window only |
| `onItemClick(item)` | Fired on tile click (suppressed if a drag/resize just ended); `pages/[...slug].tsx` opens the inspector |
| `onReorder(orderedIds)` | Fired once on drop; route holds it as in-session `sessionOrder` state — never persisted |
| `onResizeCommit(id, colSpan \| null)` | Fired once on release; route persists via a mutation into `manual_col_span` |
| `onItemHover(id)` | Fired ~200ms after the viewport settles, once per visible tile — feeds the similar-set prefetch |

## Implemented Outputs / Artifacts

- 3 components (`Masonry`, `MasonryItem`, `MasonryAnchor`) + 3 hooks (`useMasonryEngine`,
  `useTileDrag`, `useTileResize`) + 1 pure reorder helper module (`masonryReorder.ts`).
- Pure geometry core (`masonryPacking.ts`) with 21 pre-existing object-placement tests
  (`masonryPacking.test.ts`) plus a dedicated geometry/equivalence/prefix/generation-discard
  suite (`masonryGeometry.test.ts`).
- Off-main-thread packer (`masonryPacker.ts` + `masonryWorker.ts`) with a synchronous
  fallback path exercised by the same test suite.
- Live in-session drag-to-reorder (route state, no round-trip) and drag-to-resize (persists
  `manual_col_span` per image) with a 300-swap invariant test on the id→index map patching.
- Hero promotion, viewport virtualization with a guard band, and the v2 accent
  corner-bracket resize affordance.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| The `#1-B` range index for viewport culling remains deferred | Very large libraries where per-item `ys` aren't globally sorted post-pack | The visible-window filter is a linear scan over `geometry.count` on every viewport commit (not per scroll pixel, thanks to the guard band) — not measured as a bottleneck yet at 100k, and no post-guard-band profiling exists to justify building the index (per `012012c`'s own note). |
| `RESET_EXPANSION_RATIO = 4` prefix-adoption heuristic is a fixed constant | An unusual feed-size transition that happens to sit just under 4× | Would keep showing a comparatively small stale set under a larger new feed for one extra pack cycle rather than repainting the prefix immediately — cosmetic, self-correcting the moment the full off-thread pack lands. |
| Resize persists per-image (`manual_col_span`); reorder does not persist at all | User expectation mismatch — a user might expect a drag-reorder to "stick" across sessions the way a resize does | This is a deliberate design decision (see Durable Notes), not a bug, but is worth flagging because it is asymmetric and easy to assume otherwise. |
| `set_manual_order` (the backend command + DB path for persisted custom order) still exists but has no frontend caller | Reading the Rust command surface without reading the frontend | A maintainer could assume persisted reorder is still live; it is backend-orphaned (registered in `lib.rs`, implemented in `commands/images.rs` and `db/manual_layout.rs`, callerless from `apps/lynceus/src`) — the same "left in place, caller-less" pattern as `CosineIndex::save_to_disk`/`paths::cosine_cache_path` from the search-side removal. |
| Framer Motion's `layout` reflow runs for every non-gesture-active tile on every pack | Many tiles simultaneously changing position (a large reorder swap, a big resize) | Each affected tile eases into its new position/size independently; not measured as a problem at typical viewport tile counts (~20-30 visible), but a large simultaneous reflow of the *visible* set could feel busy on a slower machine. |

## Partial / In Progress

None currently tracked — the perf-round follow-up items for this subsystem (the range
index above) are speculative future work, not in-flight.

## Planned / Missing / Likely Changes

- **The `#1-B` sorted range index**, if a profiling pass at real 100k scale post-guard-band
  ever shows the linear visible-window scan as a measured bottleneck (currently not the
  case — see Known Issues).
- **Apply `tileScale` to fixed-column mode** so the density slider has a visible effect even
  when `columnCountOverride` is set (a pre-existing gap that survived the split — not
  reverified against the current code in this pass; flagged as inherited, unconfirmed).

## Durable Notes / Discarded Approaches

- **Headless-hooks split over a monolithic component.** The pre-v2 `Masonry.tsx` did
  packing, virtualization, drag, resize, and scroll all in one 514-line file. Splitting into
  `useMasonryEngine` + `useTileDrag` + `useTileResize` behind a thin shell fixed two real
  bugs as a side effect of the rework (quantized resize, snap-back reorder — see below) and
  makes each concern independently testable.
- **Continuous pixel resize over quantized column-jump resize.** The old handler set
  `span = round(dx / columnWidth)` on every pointer move, so nothing visibly happened until
  the pointer crossed a whole column ("only resizes when I cross the next column, looks
  weird"). The fix renders the active tile at a continuous pixel width tracking the pointer
  1:1, with the span (and therefore the rest of the grid's reflow) committing only on
  release.
- **Live in-session reorder, not a persisted round-trip.** The old drag-reorder round-tripped
  through the backend and only surfaced in a "custom" sort mode — the refetched order would
  revert the drop the instant it landed ("snaps back"). Reorder is now held as
  `sessionOrder` in the route (the "shuffle position, keep sizes" decision): the drop sticks
  immediately with zero round-trip, and a reshuffle (new seed) clears it. `set_manual_order`
  and its whole frontend persist path were removed as a consequence — size still persists
  per-image (`manual_col_span`); order does not.
- **The typed-array geometry core over forking the algorithm for the Worker.**
  `computeMasonryGeometry` is the one place the pack runs; `computeMasonryLayout` is a thin
  decorator reattaching object identities for whoever needs them (the sync fallback, and the
  21 pre-existing tests). One algorithm, no fork to drift, is why every pre-existing test
  passed unchanged.
- **Float64, not Float32, for the transferred geometry.** JS packing math is double
  throughout; a Float64 round-trip is bit-for-bit equal to the object-pack path (proven by a
  200-trial equivalence test). Float32 would save roughly half the ~3.6 MB the geometry
  occupies at 100k images, but would truncate x/y/w/h and break the equivalence invariant for
  a saving that doesn't matter at this scale.
- **A synchronous prefix pack for first paint, not a loading spinner.** Because the packing
  order is prefix-independent, packing the first 240 items synchronously gives them the
  *exact* geometry the full off-thread pack will eventually produce — so the worker's result
  arriving later is a seamless suffix swap, never a visible re-layout of what's already on
  screen.
- **DOM hit-testing over a maintained placement-array scan for drag hover-swaps.**
  `document.elementsFromPoint` costs is proportional to the small overlap stack under the
  pointer, not to the library's total placement count — this is what keeps the drag frame
  path independent of catalogue size.
- **3D-tilt hover and amber corner-bracket handles removed, not reskinned.** They were the
  source of the "yellow line" edge flare (the global focus outline catching light through
  the 3D transform) and both read as cheap; the v2 pass replaced them with the plainer,
  functional accent corner brackets rather than attempting to fix the tilt's visual bug.
- **Tile keying by `id` alone, not `id + url`.** Keying by URL made a thumbnail-URL change
  (base→sharp bucket swap) remount the whole tile subtree and drop
  `useAdaptiveThumbnail`'s query state; the custom memo comparator absorbs the URL change as
  a cheap prop update instead.

## Obsolete / No Longer Relevant

- The monolithic 514-line `Masonry.tsx` (packing + virtualization + drag + resize + scroll
  in one file) — replaced by the shell + three hooks above (`b12ba46`).
- The 3D-tilt hover animation and the amber corner-bracket resize handles — removed, not
  reskinned (see Durable Notes).
- `set_manual_order`'s frontend call path (the "custom" sort mode's persisted reorder) — the
  backend command and DB columns still exist but are callerless from the frontend (see Known
  Issues).
- The old quantized (`round(dx / columnWidth)`) resize handler — replaced by continuous
  pixel tracking with span-boundary-only React updates.
- Placement objects for the *entire* catalogue on every pack — replaced by flat typed-array
  geometry, with objects materialised only for the visible window (plus the 240-item
  first-paint prefix).
- The `getImageSize(url)` DOM helper and `waitForAllInnerImages()` patterns from the
  pre-audit era (backend-supplied `width`/`height` on every `FeedItem` replaced them well
  before this rewrite, and remain unchanged by it).

Cross-link: `items` arrives already compacted, hydrated, shuffled, and session-ordered —
that assembly lives in `systems/feed-protocol.md`. `useUserPreferences` (`columnCount`,
`tileScale`, `animationLevel`) and the shuffle seed are owned by `systems/frontend-state.md`.
The similar-set prefetch `onItemHover` feeds, and the selection/inspector flow `onItemClick`
opens into, are owned by `systems/search-routing.md`. The adaptive-bucket thumbnail URL each
`MasonryItem` requests via `useAdaptiveThumbnail` is owned by `systems/thumbnail-pipeline.md`.
The quick-start timer pill mounted as `heroOverlay` on the hero tile only is owned by
`systems/gesture-timer.md`.
