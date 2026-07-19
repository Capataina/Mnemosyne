import type { FeedItem } from "../types";

/** One authoritative, worker-crossable rectangle transaction for a live
 * gesture. `id` is deliberately stable across feed reorder/delta merges;
 * `span` resolves the live width without a second index-keyed override.
 * `startCol` is always the physical LEFT column of the reserved rectangle —
 * the old edge-reference convention (left/right/centre) is gone because its
 * centre mode was ambiguous for even spans and reserved the slot one column
 * away from the rendered ghost. */
export interface MasonryGestureFootprint {
  id: number;
  span: number;
  /** Physical left column of the reserved rectangle. */
  startCol: number;
  /** Exact top edge of the reserved and rendered rectangle, in grid pixels. */
  top: number;
}

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
  /** Compatibility surface for non-gesture callers/tests. A live footprint's
   * span wins for its stable id. */
  spanOverrides?: Record<number, number>;
  gestureFootprint?: MasonryGestureFootprint;
  /** Session column pins (tile id → left column) for tiles a gesture placed.
   * An anchored tile keeps its column at its feed-order turn instead of
   * re-deriving it by global argmin, so a release/settle pack cannot relocate
   * what the user just positioned. A live footprint wins over its own id's
   * anchor; unknown ids are ignored. */
  columnAnchors?: Record<number, number>;
}

export interface MasonryLayoutOutput {
  placements: MasonryItemPlacement[];
  placementById: Map<number, MasonryItemPlacement>;
  height: number;
  columnCount: number;
  columnWidth: number;
}

/** Numeric, worker-crossable pack input. All catalogue-sized fields are typed
 * arrays; the footprint is five numeric scalars. The arrays are cached in the
 * worker and gesture frames subsequently cross as footprint-only messages. */
export interface MasonryPackInput {
  ids: Float64Array;
  widths: Float64Array;
  heights: Float64Array;
  spans: Int32Array;
  containerWidth: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  columnCountOverride: number;
  tileScale: number;
  hasHero: boolean;
  selectedIndex: number;
  selectedWidth: number;
  selectedHeight: number;
  gestureFootprint: MasonryGestureFootprint | null;
  columnAnchors: Record<number, number> | null;
}

export interface MasonryHeroGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  colSpan: number;
}

/** Index-aligned geometry. The selected feed entry is unwritten because the
 * separately-described hero owns it. */
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

/** First request for a base revision. Its typed arrays are transferred once
 * and retained by the worker for subsequent gesture-only requests. */
export interface MasonryFullPackRequest {
  kind: "full";
  gen: number;
  revision: number;
  input: MasonryPackInput;
}

/** O(1) pointer-frame request against catalogue arrays already in the worker. */
export interface MasonryReusePackRequest {
  kind: "reuse";
  gen: number;
  revision: number;
  gestureFootprint: MasonryGestureFootprint | null;
}

export type MasonryPackRequest = MasonryFullPackRequest | MasonryReusePackRequest;

export interface MasonryPackResponse {
  gen: number;
  revision: number;
  geometry: MasonryGeometry;
}

/** Clamp a footprint's left column so the complete span fits the grid. This
 * is horizontal interpretation only; the footprint's `top` remains exact and
 * never comes from a column frontier. */
export function resolveFootprintLeft(
  startCol: number,
  span: number,
  colCount: number,
): number {
  return Math.max(0, Math.min(startCol, colCount - span));
}

/** Invalid source dimensions degrade to a square rather than introducing
 * Infinity/NaN into a column. The mapping boundary also sanitises literal 0;
 * this guard protects direct/core callers and legacy data. */
function scaledHeight(
  sourceWidth: number,
  sourceHeight: number,
  placedWidth: number,
): number {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return placedWidth;
  }
  return sourceHeight * (placedWidth / sourceWidth);
}

/** Return the bottom edge of the first interval intersecting [top,bottom),
 * or null. Each column is a flat, sorted numeric sequence
 * [top0,bottom0,top1,bottom1,...], so there are no object references in the
 * occupancy core. */
function firstOverlapBottom(
  intervals: readonly number[],
  top: number,
  bottom: number,
): number | null {
  let lo = 0;
  let hi = intervals.length >> 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (intervals[mid * 2 + 1] <= top) lo = mid + 1;
    else hi = mid;
  }
  const offset = lo * 2;
  if (offset < intervals.length && intervals[offset] < bottom) {
    return intervals[offset + 1];
  }
  return null;
}

/** Lowest y where a span-wide rectangle fits. A collision advances y to the
 * furthest colliding bottom; because every advance is monotonic and interval
 * lists are sorted, the loop terminates without scanning the catalogue. */
export function lowestFreeY(
  occupied: readonly (readonly number[])[],
  start: number,
  span: number,
  heightWithGap: number,
): number {
  if (!Number.isFinite(heightWithGap) || heightWithGap <= 0) return 0;
  let y = 0;
  for (;;) {
    let nextY = y;
    for (let col = start; col < start + span; col++) {
      const collisionBottom = firstOverlapBottom(
        occupied[col],
        y,
        y + heightWithGap,
      );
      if (collisionBottom !== null) nextY = Math.max(nextY, collisionBottom);
    }
    if (nextY === y) return y;
    y = nextY;
  }
}

/** Insert and merge one unavailable range into a flat sorted interval list. */
function occupy(intervals: number[], top: number, bottom: number): void {
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return;

  let first = 0;
  while (first < intervals.length && intervals[first + 1] < top) first += 2;
  let last = first;
  let mergedTop = top;
  let mergedBottom = bottom;
  while (last < intervals.length && intervals[last] <= mergedBottom) {
    mergedTop = Math.min(mergedTop, intervals[last]);
    mergedBottom = Math.max(mergedBottom, intervals[last + 1]);
    last += 2;
  }
  intervals.splice(first, last - first, mergedTop, mergedBottom);
}

function emptyGeometry(count: number): MasonryGeometry {
  return {
    xs: new Float64Array(count),
    ys: new Float64Array(count),
    widths: new Float64Array(count),
    heights: new Float64Array(count),
    spans: new Int32Array(count),
    selectedIndex: -1,
    hero: null,
    height: 0,
    columnCount: 0,
    columnWidth: 0,
    count,
  };
}

/**
 * Numeric masonry solver with two deliberately separate paths:
 *
 * - all-span-1 + no gesture: the historical scalar-frontier algorithm,
 *   retained statement-for-statement so resting layouts stay bit-identical;
 * - any span or gesture: per-column occupancy intervals, allowing later
 *   tiles to backfill below wide/fixed rectangles.
 */
export function computeMasonryGeometry(input: MasonryPackInput): MasonryGeometry {
  const {
    ids,
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
    gestureFootprint,
    columnAnchors,
  } = input;

  const n = widths.length;
  if (containerWidth <= 0) return emptyGeometry(n);
  const hasAnchors =
    columnAnchors !== null && Object.keys(columnAnchors).length > 0;

  const effectiveMin = minItemWidth * tileScale;
  const safeEffectiveMin =
    Number.isFinite(effectiveMin) && effectiveMin > 0
      ? effectiveMin
      : containerWidth;
  const autoCount = Math.max(1, Math.floor(containerWidth / safeEffectiveMin));
  const colCount =
    columnCountOverride && columnCountOverride > 0
      ? Math.min(columnCountOverride, 12)
      : autoCount;
  const columnWidth = (containerWidth - (colCount - 1) * columnGap) / colCount;
  const stride = columnWidth + columnGap;

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const outWidths = new Float64Array(n);
  const outHeights = new Float64Array(n);
  const outSpans = new Int32Array(n);

  let gestureIndex = -1;
  if (gestureFootprint) {
    for (let i = 0; i < n; i++) {
      if (ids[i] === gestureFootprint.id) {
        gestureIndex = i;
        break;
      }
    }
    // The UI forbids hero gestures. Treat a malformed selected-id footprint
    // as inert rather than duplicating the hero or leaving its feed slot blank.
    if (gestureIndex === selectedIndex) gestureIndex = -1;
  }

  const resolvedSpan = (index: number): number => {
    const requested =
      index === gestureIndex && gestureFootprint
        ? gestureFootprint.span
        : spans[index];
    return Math.max(1, Math.min(requested, colCount));
  };

  let allSpanOne = gestureIndex < 0 && !hasAnchors;
  if (allSpanOne) {
    for (let i = 0; i < n; i++) {
      if (i !== selectedIndex && resolvedSpan(i) !== 1) {
        allSpanOne = false;
        break;
      }
    }
  }

  // Historical fast path. For valid dimensions and ordinary all-span-1
  // inputs this is the old loop, preserving every arithmetic operation and
  // strict-leftmost tie break used by the 21 equivalence assertions.
  if (allSpanOne) {
    const colHeights: number[] = new Array(colCount).fill(0);
    let hero: MasonryHeroGeometry | null = null;
    if (hasHero) {
      const heroSpan = Math.min(colCount, 3);
      const heroWidth = columnWidth * heroSpan + columnGap * (heroSpan - 1);
      const heroHeight = scaledHeight(selectedWidth, selectedHeight, heroWidth);
      hero = { x: 0, y: 0, width: heroWidth, height: heroHeight, colSpan: heroSpan };
      for (let col = 0; col < heroSpan; col++) {
        colHeights[col] = heroHeight + verticalGap;
      }
    }

    for (let i = 0; i < n; i++) {
      if (i === selectedIndex) continue;
      let bestStart = 0;
      let bestMax = Infinity;
      for (let start = 0; start < colCount; start++) {
        const windowMax = colHeights[start];
        if (windowMax < bestMax) {
          bestMax = windowMax;
          bestStart = start;
        }
      }
      const placedWidth = columnWidth;
      const itemHeight = scaledHeight(widths[i], heights[i], placedWidth);
      xs[i] = bestStart * stride;
      ys[i] = bestMax;
      outWidths[i] = placedWidth;
      outHeights[i] = itemHeight;
      outSpans[i] = 1;
      colHeights[bestStart] = bestMax + itemHeight + verticalGap;
    }

    return {
      xs,
      ys,
      widths: outWidths,
      heights: outHeights,
      spans: outSpans,
      selectedIndex,
      hero,
      height: colHeights.length > 0 ? Math.max(...colHeights, 0) : 0,
      columnCount: colCount,
      columnWidth,
      count: n,
    };
  }

  // Occupancy path. Every column stores sorted [top,bottom) ranges including
  // the configured trailing gap. The active footprint is inserted first and
  // skipped in feed order, so every neighbour solves around its exact 2D rect.
  const occupied: number[][] = Array.from({ length: colCount }, () => []);
  let extent = 0;
  const reserve = (start: number, span: number, top: number, height: number) => {
    const bottom = top + height + verticalGap;
    for (let col = start; col < start + span; col++) {
      occupy(occupied[col], top, bottom);
    }
    extent = Math.max(extent, bottom);
  };

  if (gestureIndex >= 0 && gestureFootprint) {
    const span = resolvedSpan(gestureIndex);
    const placedWidth = columnWidth * span + columnGap * (span - 1);
    const itemHeight = scaledHeight(
      widths[gestureIndex],
      heights[gestureIndex],
      placedWidth,
    );
    const start = resolveFootprintLeft(
      gestureFootprint.startCol,
      span,
      colCount,
    );
    const top =
      Number.isFinite(gestureFootprint.top) && gestureFootprint.top > 0
        ? gestureFootprint.top
        : 0;
    xs[gestureIndex] = start * stride;
    ys[gestureIndex] = top;
    outWidths[gestureIndex] = placedWidth;
    outHeights[gestureIndex] = itemHeight;
    outSpans[gestureIndex] = span;
    reserve(start, span, top, itemHeight);
  }

  let hero: MasonryHeroGeometry | null = null;
  if (hasHero) {
    const heroSpan = Math.min(colCount, 3);
    const heroWidth = columnWidth * heroSpan + columnGap * (heroSpan - 1);
    const heroHeight = scaledHeight(selectedWidth, selectedHeight, heroWidth);
    const heroTop = lowestFreeY(
      occupied,
      0,
      heroSpan,
      heroHeight + verticalGap,
    );
    hero = {
      x: 0,
      y: heroTop,
      width: heroWidth,
      height: heroHeight,
      colSpan: heroSpan,
    };
    reserve(0, heroSpan, heroTop, heroHeight);
  }

  for (let i = 0; i < n; i++) {
    if (i === selectedIndex || i === gestureIndex) continue;
    const span = resolvedSpan(i);
    const placedWidth = columnWidth * span + columnGap * (span - 1);
    const itemHeight = scaledHeight(widths[i], heights[i], placedWidth);
    const heightWithGap = itemHeight + verticalGap;

    // A column-anchored tile keeps its gesture-placed column and takes that
    // window's natural y at its feed-order turn; only unanchored tiles run
    // the global argmin start-search.
    const anchorCol = hasAnchors ? columnAnchors![ids[i]] : undefined;
    let bestStart: number;
    let bestTop: number;
    if (anchorCol !== undefined) {
      bestStart = resolveFootprintLeft(anchorCol, span, colCount);
      bestTop = lowestFreeY(occupied, bestStart, span, heightWithGap);
    } else {
      bestStart = 0;
      bestTop = Infinity;
      for (let start = 0; start <= colCount - span; start++) {
        const top = lowestFreeY(occupied, start, span, heightWithGap);
        if (top < bestTop) {
          bestTop = top;
          bestStart = start;
        }
      }
    }

    xs[i] = bestStart * stride;
    ys[i] = bestTop;
    outWidths[i] = placedWidth;
    outHeights[i] = itemHeight;
    outSpans[i] = span;
    reserve(bestStart, span, bestTop, itemHeight);
  }

  return {
    xs,
    ys,
    widths: outWidths,
    heights: outHeights,
    spans: outSpans,
    selectedIndex,
    hero,
    height: extent,
    columnCount: colCount,
    columnWidth,
    count: n,
  };
}

export interface MasonryPackParams {
  containerWidth: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  columnCountOverride?: number;
  tileScale?: number;
  spanOverrides?: Record<number, number>;
  gestureFootprint?: MasonryGestureFootprint;
  columnAnchors?: Record<number, number>;
}

/** Flatten catalogue state once per base revision. The stable id array is the
 * bridge that lets a footprint survive reorders without holding an index. */
export function buildPackInput(
  items: FeedItem[],
  selectedItem: FeedItem | null,
  params: MasonryPackParams,
): MasonryPackInput {
  const n = items.length;
  const ids = new Float64Array(n);
  const widths = new Float64Array(n);
  const heights = new Float64Array(n);
  const spans = new Int32Array(n);
  const overrides = params.spanOverrides;
  const selectedId = selectedItem?.id ?? -1;
  let selectedIndex = -1;

  for (let i = 0; i < n; i++) {
    const item = items[i];
    ids[i] = item.id;
    widths[i] = item.width;
    heights[i] = item.height;
    spans[i] = overrides?.[item.id] ?? item.manualColSpan ?? 1;
    if (item.id === selectedId) selectedIndex = i;
  }

  return {
    ids,
    widths,
    heights,
    spans,
    containerWidth: params.containerWidth,
    minItemWidth: params.minItemWidth,
    columnGap: params.columnGap,
    verticalGap: params.verticalGap,
    columnCountOverride: params.columnCountOverride ?? 0,
    tileScale: params.tileScale ?? 1,
    hasHero: !!selectedItem,
    selectedIndex,
    selectedWidth: selectedItem?.width ?? 0,
    selectedHeight: selectedItem?.height ?? 0,
    gestureFootprint: params.gestureFootprint ?? null,
    columnAnchors: params.columnAnchors ?? null,
  };
}

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

/** Object decorator retained for public callers and equivalence tests. */
export function computeMasonryLayout(
  input: MasonryLayoutInput,
): MasonryLayoutOutput {
  const { items, selectedItem, ...params } = input;
  const geometry = computeMasonryGeometry(
    buildPackInput(items, selectedItem ?? null, params),
  );
  if (geometry.columnCount === 0) {
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
  const hero = heroPlacement(geometry, selectedItem ?? null);
  if (hero) {
    placements.push(hero);
    placementById.set(hero.itemData.id, hero);
  }
  for (let i = 0; i < items.length; i++) {
    if (i === geometry.selectedIndex) continue;
    const placement = placementAt(geometry, items, i);
    placements.push(placement);
    placementById.set(items[i].id, placement);
  }

  return {
    placements,
    placementById,
    height: geometry.height,
    columnCount: geometry.columnCount,
    columnWidth: geometry.columnWidth,
  };
}
