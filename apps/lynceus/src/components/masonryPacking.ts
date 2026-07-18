import type { FeedItem } from "../types";

/**
 * Pure layout calculation for the Pinterest-style masonry grid.
 *
 * Extracted out of Masonry.tsx so it's unit-testable without DOM
 * mounting. The component reads container width via a ref and feeds
 * it in here; tests provide deterministic widths and item shapes.
 *
 * Algorithm:
 *   1. Determine column count from container width / minItemWidth.
 *      An explicit override beats auto.
 *   2. If a hero item is selected, place it first spanning up to 3
 *      columns from the top-left.
 *   3. For every other item, find the window of `colSpan` adjacent
 *      columns whose current max height is smallest, place the item
 *      there flush against that max (so every spanned column's top
 *      edge lines up), and scale height to preserve aspect ratio at
 *      the spanned width. `colSpan` defaults to 1, which degenerates
 *      to the original shortest-single-column search.
 *
 * Returns the placed items plus the total grid height.
 */

export interface MasonryItemPlacement {
  itemData: FeedItem;
  x: number;
  y: number;
  width: number;
  /** Rendered height in pixels (aspect-ratio scaled to placed width). */
  height: number;
  isSelected: boolean;
  /** Number of columns this placement actually spans (1 = default). */
  colSpan: number;
}

export interface MasonryLayoutInput {
  items: FeedItem[];
  selectedItem?: FeedItem | null;
  containerWidth: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  /** 0 = auto (computed). 1..12 forces. */
  columnCountOverride?: number;
  /** Multiplier on minItemWidth in auto mode. Default 1.0. */
  tileScale?: number;
  /**
   * Discrete drag-resize footprint: item id → rounded column span,
   * consulted ahead of `itemData.manualColSpan`. Pixel-level preview is
   * intentionally absent from the packer; the shell changes this value
   * only when the pointer crosses a column boundary.
   */
  spanOverrides?: Record<number, number>;
}

export interface MasonryLayoutOutput {
  placements: MasonryItemPlacement[];
  /** O(1) active-gesture lookup, built during the pack without a second
   *  100k-item traversal in the rendering hook. */
  placementById: Map<number, MasonryItemPlacement>;
  height: number;
  columnCount: number;
  /** Pixel width of a single column — needed by the resize handle to
   *  convert a pointer-drag delta into a column-span delta. */
  columnWidth: number;
}

// ============================================================
//  Typed-array geometry core (T3-3)
// ============================================================
//
// The packing algorithm lives here, once, in a numeric-only form that
// carries no object references and so can (a) run inside a Web Worker
// across a structured-clone / transfer boundary and (b) hold a whole
// 100k-image layout as five flat typed arrays instead of 100k placement
// objects + a 100k-entry Map. `computeMasonryLayout` above is now a thin
// decorator over `computeMasonryGeometry` — the object placements are
// reattached to `itemData` for whoever needs them (the sync fallback, and
// the tests that assert on the full placement shape), while the engine
// keeps only the geometry and materialises objects for the visible window.
//
// Precision note: geometry crosses as `Float64Array`, never `Float32Array`.
// JS packing math is double throughout, so a Float64 round-trip is
// bit-for-bit equal to a direct object pack — the equivalence invariant.
// Float32 would truncate x/y/w/h and break it for a ~2 MB saving that does
// not matter at this scale.

/** Numeric, worker-crossable pack input. `widths`/`heights` are the source
 *  image dimensions in feed order; `spans` is the already-resolved
 *  requested column span per item (override ?? manualColSpan ?? 1). The
 *  three typed arrays are transferred into the worker; the scalars are
 *  cloned. The hero (selected item) is described separately because it may
 *  not appear in `items` at all — `selectedIndex` is where it does appear
 *  (to be skipped in the flow), or -1. */
export interface MasonryPackInput {
  widths: Float64Array;
  heights: Float64Array;
  spans: Int32Array;
  containerWidth: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  /** 0 = auto (computed). 1..12 forces. */
  columnCountOverride: number;
  tileScale: number;
  hasHero: boolean;
  /** Index of the selected item within the feed, or -1 (absent / none). */
  selectedIndex: number;
  selectedWidth: number;
  selectedHeight: number;
  /**
   * Column pin for the one tile under an active gesture. The feed index at
   * `anchorIndex` is placed at `anchorStartCol` (clamped so its span fits the
   * grid) instead of the shortest-column search. A resize uses it so a
   * widening tile stays in place (shifting its start column left as needed to
   * fit) instead of wrapping to a fresh row; a drag-reorder uses it so the
   * dragged tile's reserved slot sits in the column under the pointer instead
   * of drifting to whatever column the greedy search finds shortest (with
   * slightly-varying tile heights the greedy choice can land a column off the
   * cursor — the "hole appears one column over" reorder artefact). `-1` when
   * no gesture is pinning a tile.
   */
  anchorIndex: number;
  anchorStartCol: number;
  /**
   * How `anchorStartCol` names the pinned tile's horizontal position, so one
   * numeric anchor covers every gesture without the caller pre-resolving a
   * left column. `0` (left edge) = `anchorStartCol` is the left column, grow
   * right (a right-corner resize, or the idle default); `1` (right edge) =
   * `anchorStartCol` is the right edge, so the left column walks left as the
   * span grows (a left-corner resize); `2` (centre) = `anchorStartCol` is the
   * column under the pointer and the footprint centres on it (a drag, so a
   * 2×2/3×3 tile reaches its true edges instead of losing `(span-1)/colCount`
   * of range to the old left-only clamp). Inert when `anchorIndex < 0`.
   */
  anchorEdge: number;
  /**
   * Coherence seed: the column each feed-index tile held in the PREVIOUS
   * gesture pack (`-1` for the dragged tile and for newcomers with no prior
   * placement), or `null` when no gesture is live. Used only as a tie-break —
   * when two candidate windows are within a sub-pixel epsilon, the tile keeps
   * its previous column, so a resting tile can't shimmer between equal columns
   * on float noise. It never overrides a decisively-shorter column, so a real
   * cascade is untouched. `null` in steady state → the search is byte-identical
   * to the pre-anchor greedy pack.
   */
  prevCols: Int32Array | null;
}

export interface MasonryHeroGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  colSpan: number;
}

/** Index-aligned geometry output. `xs`/`ys`/`widths`/`heights`/`spans`
 *  are parallel to the input feed order; the entry at `selectedIndex` is
 *  left unwritten (the hero carries that item's geometry instead) and
 *  callers skip it. `columnCount === 0` is the sole marker of the
 *  degenerate zero-width layout. */
export interface MasonryGeometry {
  xs: Float64Array;
  ys: Float64Array;
  widths: Float64Array;
  heights: Float64Array;
  spans: Int32Array;
  selectedIndex: number;
  hero: MasonryHeroGeometry | null;
  height: number;
  columnCount: number;
  columnWidth: number;
  count: number;
}

/** Generation-tagged pack request sent to the worker. The `gen` tags the
 *  request so the engine can discard results superseded by a newer
 *  filter/resize/reorder input. */
export interface MasonryPackRequest {
  gen: number;
  input: MasonryPackInput;
}

/** Geometry for a tagged request, returned by the worker (or produced by
 *  the synchronous fallback). */
export interface MasonryPackResponse {
  gen: number;
  geometry: MasonryGeometry;
}

/**
 * Sub-pixel width within which two candidate columns count as tied for the
 * coherence tie-break. Small enough that it never overrides a visible
 * height difference (a real cascade), large enough to absorb the float noise
 * that would otherwise flip a resting tile between two equal-height columns.
 */
const COHERENCE_EPS = 0.5;

/**
 * Resolve a gesture anchor's `startCol` + edge mode into the tile's actual
 * left column, then clamp it into `[0, colCount - span]` so the footprint
 * always fits. This is the single place the "meaning of anchorStartCol"
 * lives, so a drag, a left-corner resize, and a right-corner resize all feed
 * one numeric anchor and differ only by `edge`:
 *   0 (left)   → startCol is the left column; grow right (right-corner resize / default).
 *   1 (right)  → startCol is the right edge; left column walks left as span grows (left-corner resize).
 *   2 (centre) → startCol is the pointer column; centre the footprint on it (drag).
 * The clamp is unchanged from the old single-anchor path — it now only bites
 * at the true geometric edge, so a span-3 drag reaches its full range instead
 * of losing `(span-1)/colCount` of it to a left-only interpretation.
 */
export function resolveAnchorLeft(
  startCol: number,
  edge: number,
  span: number,
  colCount: number,
): number {
  const raw =
    edge === 1
      ? startCol - (span - 1) // right edge pinned
      : edge === 2
        ? startCol - (span >> 1) // centred on the pointer column
        : startCol; // left edge pinned (default)
  return Math.max(0, Math.min(raw, colCount - span));
}

export function computeMasonryGeometry(
  input: MasonryPackInput,
): MasonryGeometry {
  const {
    widths,
    heights,
    spans,
    containerWidth,
    minItemWidth,
    columnGap,
    verticalGap,
    columnCountOverride,
    tileScale,
    hasHero,
    selectedIndex,
    selectedWidth,
    selectedHeight,
    anchorIndex,
    anchorStartCol,
    anchorEdge,
    prevCols,
  } = input;

  const n = widths.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const outWidths = new Float64Array(n);
  const outHeights = new Float64Array(n);
  const outSpans = new Int32Array(n);

  if (containerWidth <= 0) {
    return {
      xs,
      ys,
      widths: outWidths,
      heights: outHeights,
      spans: outSpans,
      selectedIndex: -1,
      hero: null,
      height: 0,
      columnCount: 0,
      columnWidth: 0,
      count: n,
    };
  }

  // Column count derivation: explicit override beats auto. Auto uses
  // tile-scaled minimum width. We cap at 12 to prevent absurd values.
  const effectiveMin = minItemWidth * tileScale;
  const autoCount = Math.max(1, Math.floor(containerWidth / effectiveMin));
  const colCount =
    columnCountOverride && columnCountOverride > 0
      ? Math.min(columnCountOverride, 12)
      : autoCount;

  const columnWidth = (containerWidth - (colCount - 1) * columnGap) / colCount;
  const colHeights: number[] = new Array(colCount).fill(0);

  // Hero placement: selected item spans up to 3 columns at the top.
  let hero: MasonryHeroGeometry | null = null;
  if (hasHero) {
    const selectedCols = Math.min(colCount, 3);
    const heroWidth =
      columnWidth * selectedCols + columnGap * (selectedCols - 1);
    const ratio = heroWidth / selectedWidth;
    const heroHeight = selectedHeight * ratio;
    hero = {
      x: 0,
      y: 0,
      width: heroWidth,
      height: heroHeight,
      colSpan: selectedCols,
    };
    for (let i = 0; i < selectedCols; i++) {
      colHeights[i] = heroHeight + verticalGap;
    }
  }

  // Place remaining items. For a single-column item this is the
  // original shortest-column search; for a spanned item it's the
  // same search widened to a `span`-column sliding window, placed
  // flush against the tallest column in that window so every spanned
  // column's top edge lines up (no jagged mid-tile offsets).
  for (let i = 0; i < n; i++) {
    if (i === selectedIndex) continue;

    const requestedSpan = spans[i];
    const span = Math.max(1, Math.min(requestedSpan, colCount));

    let bestStart: number;
    let bestMax: number;
    if (i === anchorIndex) {
      // The tile under an active gesture keeps its column anchor rather than
      // jumping to the shortest window: `resolveAnchorLeft` turns its
      // startCol + edge into the left column (span-aware, so a wide footprint
      // reaches its true edges), shifted left only as far as needed to fit.
      // A resize grows in place instead of wrapping onto a new row; a drag
      // keeps its reserved slot under the pointer. It sits flush below the
      // tallest column in its pinned window, so nothing overlaps above it.
      bestStart = resolveAnchorLeft(anchorStartCol, anchorEdge, span, colCount);
      bestMax = colHeights[bestStart];
      for (let k = bestStart + 1; k < bestStart + span; k++) {
        bestMax = Math.max(bestMax, colHeights[k]);
      }
    } else {
      // Shortest-column search (single tile) or shortest span-wide window. The
      // primary comparison is unchanged (strict `<`), so with `prevCols` null
      // this loop is byte-identical to the pre-anchor greedy pack. The added
      // else-if is the coherence tie-break: only when a gesture supplies
      // `prevCols` AND this window ties (within a sub-pixel epsilon) the
      // window the tile held last frame, keep it there — a resting tile can't
      // shimmer between equal-height columns on float noise, but a decisively
      // shorter column still wins, so a real cascade is never suppressed.
      bestStart = 0;
      bestMax = Infinity;
      const prevCol = prevCols ? prevCols[i] : -1;
      for (let start = 0; start <= colCount - span; start++) {
        let windowMax = colHeights[start];
        for (let k = start + 1; k < start + span; k++) {
          windowMax = Math.max(windowMax, colHeights[k]);
        }
        if (windowMax < bestMax) {
          bestMax = windowMax;
          bestStart = start;
        } else if (
          prevCol === start &&
          windowMax <= bestMax + COHERENCE_EPS
        ) {
          // Adopt the previous column and its real frontier — using `bestMax`
          // here would seat the tile above this (equal-or-taller) column's
          // top and overlap it; the sub-pixel delta is invisible.
          bestStart = start;
          bestMax = windowMax;
        }
      }
    }

    const placedWidth = columnWidth * span + columnGap * (span - 1);
    const ratio = placedWidth / widths[i];
    const itemHeight = heights[i] * ratio;
    xs[i] = bestStart * (columnWidth + columnGap);
    ys[i] = bestMax;
    outWidths[i] = placedWidth;
    outHeights[i] = itemHeight;
    outSpans[i] = span;
    for (let k = bestStart; k < bestStart + span; k++) {
      colHeights[k] = bestMax + itemHeight + verticalGap;
    }
  }

  const height = colHeights.length > 0 ? Math.max(...colHeights, 0) : 0;
  return {
    xs,
    ys,
    widths: outWidths,
    heights: outHeights,
    spans: outSpans,
    selectedIndex,
    hero,
    height,
    columnCount: colCount,
    columnWidth,
    count: n,
  };
}

/** Scalar packing parameters shared by `buildPackInput` and the layout
 *  decorator — everything the pack needs that is not per-item. */
export interface MasonryPackParams {
  containerWidth: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  columnCountOverride?: number;
  tileScale?: number;
  spanOverrides?: Record<number, number>;
  /** The one tile under an active gesture, pinned so the packer places it
   *  instead of running its shortest-column search. `edge` says how `startCol`
   *  names the tile's horizontal position (0=left/default, 1=right edge,
   *  2=centred — see `MasonryPackInput.anchorEdge`). Drag and resize never run
   *  at once, so one pin covers both. Absent when idle. */
  columnAnchor?: { id: number; startCol: number; edge?: number };
  /** Per-feed-index coherence seed — the column each tile held in the previous
   *  gesture pack (`-1` = none), or absent when no gesture is live. Feeds the
   *  packer's tie-break (see `MasonryPackInput.prevCols`); absent in steady
   *  state keeps the pack byte-identical to the greedy reference. */
  prevCols?: Int32Array;
}

/** Flatten a feed slice into the numeric pack input. Resolves each item's
 *  requested span (live drag override ahead of the persisted footprint) and
 *  locates the selected item's index in one O(N) pass, so the geometry core
 *  and the worker stay purely numeric. */
export function buildPackInput(
  items: FeedItem[],
  selectedItem: FeedItem | null,
  params: MasonryPackParams,
): MasonryPackInput {
  const n = items.length;
  const widths = new Float64Array(n);
  const heights = new Float64Array(n);
  const spans = new Int32Array(n);
  const overrides = params.spanOverrides;
  const selectedId = selectedItem ? selectedItem.id : -1;
  const anchorId = params.columnAnchor?.id ?? -1;
  let selectedIndex = -1;
  let anchorIndex = -1;

  for (let i = 0; i < n; i++) {
    const item = items[i];
    widths[i] = item.width;
    heights[i] = item.height;
    spans[i] = overrides?.[item.id] ?? item.manualColSpan ?? 1;
    if (selectedItem && item.id === selectedId) selectedIndex = i;
    if (item.id === anchorId) anchorIndex = i;
  }

  return {
    widths,
    heights,
    spans,
    containerWidth: params.containerWidth,
    minItemWidth: params.minItemWidth,
    columnGap: params.columnGap,
    verticalGap: params.verticalGap,
    columnCountOverride: params.columnCountOverride ?? 0,
    tileScale: params.tileScale ?? 1.0,
    hasHero: !!selectedItem,
    selectedIndex,
    selectedWidth: selectedItem ? selectedItem.width : 0,
    selectedHeight: selectedItem ? selectedItem.height : 0,
    anchorIndex,
    anchorStartCol: params.columnAnchor?.startCol ?? 0,
    anchorEdge: params.columnAnchor?.edge ?? 0,
    prevCols: params.prevCols ?? null,
  };
}

/**
 * Materialise one placement object from index-aligned geometry. Used by
 * the layout decorator (all N) and by the engine's visible-window pass
 * (O(visible)); the single call site keeps the placement shape in one
 * place. `index` must not be the hero's `selectedIndex` (that entry is
 * unwritten — use `heroPlacement`).
 */
export function placementAt(
  geo: MasonryGeometry,
  items: FeedItem[],
  index: number,
): MasonryItemPlacement {
  return {
    itemData: items[index],
    x: geo.xs[index],
    y: geo.ys[index],
    width: geo.widths[index],
    height: geo.heights[index],
    isSelected: false,
    colSpan: geo.spans[index],
  };
}

/** The hero placement for a geometry that has one, reattaching the
 *  selected item as its `itemData`. Returns null when there is no hero. */
export function heroPlacement(
  geo: MasonryGeometry,
  selectedItem: FeedItem | null,
): MasonryItemPlacement | null {
  if (!geo.hero || !selectedItem) return null;
  return {
    itemData: selectedItem,
    x: geo.hero.x,
    y: geo.hero.y,
    width: geo.hero.width,
    height: geo.hero.height,
    isSelected: true,
    colSpan: geo.hero.colSpan,
  };
}

/**
 * Object-placement layout — the original public contract, now a thin
 * decorator over the numeric geometry core. Behaviour is identical to the
 * pre-T3-3 implementation (the 21 packing tests assert on this output):
 * the placements array is hero-first, then feed order skipping the hero,
 * each carrying its `itemData` ref. This path is the synchronous fallback
 * and the reference the worker's output is equivalence-tested against.
 */
export function computeMasonryLayout(
  input: MasonryLayoutInput,
): MasonryLayoutOutput {
  const { items, selectedItem, ...params } = input;
  const geo = computeMasonryGeometry(
    buildPackInput(items, selectedItem ?? null, params),
  );

  // Degenerate zero-width layout: no columns, no placements (matches the
  // pre-T3-3 early return exactly).
  if (geo.columnCount === 0) {
    return {
      placements: [],
      placementById: new Map(),
      height: 0,
      columnCount: 0,
      columnWidth: 0,
    };
  }

  const placements: MasonryItemPlacement[] = [];
  const placementById = new Map<number, MasonryItemPlacement>();

  const hero = heroPlacement(geo, selectedItem ?? null);
  if (hero) {
    placements.push(hero);
    placementById.set(hero.itemData.id, hero);
  }
  for (let i = 0; i < items.length; i++) {
    if (i === geo.selectedIndex) continue;
    const placement = placementAt(geo, items, i);
    placements.push(placement);
    placementById.set(items[i].id, placement);
  }

  return {
    placements,
    placementById,
    height: geo.height,
    columnCount: geo.columnCount,
    columnWidth: geo.columnWidth,
  };
}
