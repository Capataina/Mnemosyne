# Masonry gesture bugs — root-cause diagnosis (2026-07-18)

Diagnosis from a 14-agent + cross-family (GPT, Gemini) swarm over the live-test
telemetry (`perf-1784395290`, the 2026-07-18 drag/resize pass). Every root cause
below is backed by a standalone repro over the pure packer; every disagreement
between hunters was adjudicated by evidence, not assertion. This note is the brief
for the base-cause rework that follows it.

## The three reported bugs

1. Dragging a 3×3 (colSpan 3) tile is completely broken.
2. Diagonal drags (top-left / top-right — crossing columns AND rows) break the layout; pure up/down slides fine.
3. Resizing bigger from a TOP corner drops the tile ~2 rows on release.

## Base cause (the one structural root)

The packer's **only** per-gesture stability primitive is a single scalar column pin
(`anchorIndex` + `anchorStartCol`) — X-only, span-unaware, one tile — bolted onto a
**global, sequential, order-dependent greedy re-pack**.

- `masonryPacking.ts:251-300` — one pass, `colHeights` walked strictly left-to-right through array order for every non-anchored tile. No locality: a tile's column/row is a function of everything before it in the array, every pack.
- `masonryPacking.ts:259-272` — the anchor branch pins the ONE gestured tile; everything else (and the anchored tile's own Y) still comes from the unstabilised greedy walk.
- `masonryPacking.ts:297-299` — `colHeights[k] = bestMax + itemHeight + verticalGap`, the cumulative mutation that lets one perturbation propagate through the rest of the pack with no resync point.

**Blast radius ∝ array-index distance of the edit** (NOT gesture direction). Telemetry
proof: an 80px cursor nudge produced a 1209px (5-column) relocation of 6 unrelated
tiles — zero input/output proportionality. Diagonal only *looks* worse because the
feed is row-major indexed (`index = row·colCount + col`), so a diagonal hover-swap is
inherently a large index delta; a same-magnitude vertical splice ripples just as hard
(matched-magnitude repro: vertical 18.5 avg vs diagonal 17.2 avg tiles moved).

Each bug is a different uncovered gap in that one pin:

| Bug | Gap in the pin | Primary mechanism (file:line) | Secondary / compounding |
|-----|----------------|-------------------------------|-------------------------|
| 1 — 3×3 drag | clamp not span-aware | **debounce guard starves the anchor updater** (`useTileDrag.ts:155-162`): a 3-wide footprint covers 50% of the grid, keeps voting the same neighbour or its own vacated hole (`over:EMPTY`), so `setDragAnchorCol` (`:173`) stops firing → anchor column FREEZES. Telemetry: colSpan 2→3 then 0 tiles move for 5.37s of cursor travel. | span-scaled clamp `masonryPacking.ts:268` mis-places when a swap *does* fire (loses `(span-1)/colCount` of range; freezes at col 0 when `colCount ≤ span`). GPT: "the clamp is correct — fix the *meaning* of `anchorStartCol`, not the clamp." |
| 2 — diagonal | pin can't contain the neighbour ripple | **greedy ripple** from a large-index-distance 1D splice (`masonryReorder.ts:50-57` + `masonryPacking.ts:273-299`). Telemetry: 47 real overlaps at settle. | none — async-worker-race amplifier was **refuted** (worker is FIFO + generation-gated; the "~750ms stale" was a telemetry attribution artefact, see below). |
| 3 — resize-up | pin is X-only (no Y axis) | **(a) upward-growth illusion** (`useTileResize.ts:139-144`): `offsetY` is a pure CSS translate never in packed geometry; the real Y sinks (correct top-down masonry); `pointerup` clears it instantly on a wrapper with NO CSS transition. `offsetY` at span 3 = 2.07 rows — exact match to "~2 rows". Bottom corners hard-code `offsetY=0` → no drop. | **(b) anchor discarded on commit** (`useTileResize.ts:279-297` → `Masonry.tsx:138-146`): `handleUp` fires the commit + `setResizeState(null)` synchronously, so the next pack runs the new PERMANENT span with NO anchor → greedy shortest-column → the tile can jump COLUMN. Telemetry: 57-tile, 1199px repack 64ms after release. Cannot be fixed by gesture math — the anchor is *discarded*, not miscomputed. |

## Why the fix must be structural, not three patches

Patching Bug 1 (anchor meaning) and Bug 3 (illusion + anchor hold) individually
leaves Bug 2 — the *other* tiles' ripple — completely untouched, because that one is
about neighbours, not the gestured tile's own pin. Both foreign families converged on
the same fix class: replace "single-tile-X-pin on a global greedy repack" with either
(a) a **stable / incremental local pack** that recomputes only the touched region, or
(b) a **two-axis (X+Y), span-aware anchor + an explicit neighbour-locality contract**.

Hard constraint on any rework: the STEADY-STATE (non-gesture) pack must stay
bit-identical to today's greedy output — the 21 packing equivalence tests assert it,
and it must remain worker-crossable (numeric typed arrays, Float64) and 100k-scale.
The change is specifically about GESTURE-TIME stability.

## Bycatch — 4 unrelated latent bugs + a memory leak (each repro-backed)

1. **HIGH** — one drag-reorder buries every future newcomer (`useShuffledFeed.ts:107-110`): `listed` outranks the shuffle key, so after a single tile nudge every subsequently-indexed image drops to the bottom for the rest of the session. Breaks the shuffle invariant in ordinary use.
2. **HIGH-if-hit** — `RangeError` crash on `tileScale=0` / `minItemWidth=0` (`masonryPacking.ts:216-224`): `Infinity` column count. UI slider guards it; localStorage/migration would not.
3. **MED** — a `width:0` image poisons its column with `Infinity` forever and breaks scroll height (`masonryPacking.ts:289-299`).
4. **MED, data-loss** — a drag freezes `workingOrder` after the first hover-swap and never resyncs with a mid-drag feed delta (`useTileDrag.ts:176-195`, guard dead after swap #1); drags >1.5s during indexing silently drop newly-indexed images from the committed order. Found by two independent hunters.
5. **MED-dormant** — hero tile has no drag guard at the component level (`MasonryItem.tsx:207` vs `:254`); dormant because the page gates reorder off whenever anything is selected, but the invariant lives in the wrong layer.
6. **Memory** — RSS jumps +1.45 GB in ~1s at the first colSpan resize, then climbs monotonically to 5.9 GB (6.6× session start) with no recovery. Consistent with detached-DOM retention downstream of the layout corruption; timing-correlation only, wants a heap snapshot.

## Telemetry trust caveats (for the next diagnostic pass)

The layout monitor is usable but distorted — verify before trusting a scalar:
- `teleportCount` is ~59% mount-settle noise (`classifyMove`'s 60%-of-distance threshold trivially fires on sub-frame jitter). Trust individual `teleports[]` entries carrying `transDur:'0s'`, not the count.
- `trigger` attribution has a confirmed race (`telemetry.ts:608-630`): the 600ms context-clear timer isn't cancelled on re-grab, so a fast repro can mis-tag a drag reflow as `"other"`. Didn't misfire this session; thin margin.
- Most `overlap`/`mismatched` snapshots during a resize are the *intended* live preview (the monitor never tracks width), not corruption.
- `gaps` `{above, below}` are tile IDs, not y-coordinates (a prior session's misread).
