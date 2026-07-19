/**
 * Pure commit-time reorder helpers. Gesture-time layout is spatial: the
 * active tile is an occupancy obstacle, not a repeatedly-spliced array.
 * Exactly one insertion is derived from the final rectangle on release.
 *
 * A hover-swap needs the from/to indices of two ids in the working order.
 * The old path paid two O(N) `findIndex` scans per swap; here the indices
 * come from a maintained `Map<id, index>` in O(1). The map is built once
 * (`buildIndexMap`) and patched incrementally after each swap
 * (`reorderWithinList`) over only the touched window — every index outside
 * `[min(from,to), max(from,to)]` is provably unchanged, because the
 * remove-then-insert shifts cancel to zero there.
 */

/** Build the id→index map for a working order. O(N), paid once at drag
 *  start (not per swap). */
export function buildIndexMap<T extends { id: number }>(
  items: readonly T[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < items.length; i++) map.set(items[i].id, i);
  return map;
}

/**
 * Move `fromId` to `toId`'s slot in `base`, returning the new order and
 * patching `indexMap` in place to match it.
 *
 * Returns `null` (and leaves the map untouched) when the move is a no-op or
 * either id is absent — the caller keeps its current order. The array
 * `.slice()` is retained deliberately: the new identity is what triggers
 * the off-thread repack downstream; only the two O(N) `findIndex` scans are
 * what this replaces.
 */
export function reorderWithinList<T extends { id: number }>(
  base: T[],
  indexMap: Map<number, number>,
  fromId: number,
  toId: number,
): T[] | null {
  const fromIndex = indexMap.get(fromId);
  const toIndex = indexMap.get(toId);
  if (
    fromIndex === undefined ||
    toIndex === undefined ||
    fromIndex === toIndex
  ) {
    return null;
  }

  const next = base.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  // Only the occupants of [lo, hi] changed index; patch just that window.
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  for (let k = lo; k <= hi; k++) indexMap.set(next[k].id, k);

  return next;
}

export interface SpatialPlacement {
  itemData: { id: number };
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersectionArea(a: SpatialRect, b: SpatialRect): number {
  const width = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const height = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  return width * height;
}

/** Pick the release target from geometry, independent of DOM overlap and
 * feed-index distance. Maximum rectangle overlap wins; when the rect sits
 * over empty space, nearest centre wins. The active tile is NEVER a
 * candidate: its own pre-gesture rectangle out-overlaps every smaller
 * neighbour for any move shorter than its own width (a span-2 tile moved one
 * column keeps a full column of self-overlap), which silently discarded
 * every small multi-span move. The deliberate "dropped at its own slot is a
 * no-op" semantic lives in the caller's source-slot guard, where it compares
 * committed slots instead of overlap areas. */
export function spatialTargetId(
  placements: readonly SpatialPlacement[],
  activeId: number,
  rect: SpatialRect,
): number | null {
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  let bestId: number | null = null;
  let bestOverlap = -1;
  let bestDistance = Infinity;

  for (const placement of placements) {
    const id = placement.itemData.id;
    if (id === activeId) continue;
    const overlap = intersectionArea(rect, placement);
    const dx = centreX - (placement.x + placement.width / 2);
    const dy = centreY - (placement.y + placement.height / 2);
    const distance = dx * dx + dy * dy;
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && distance < bestDistance) ||
      (overlap === bestOverlap &&
        distance === bestDistance &&
        id < (bestId ?? Infinity))
    ) {
      bestId = id;
      bestOverlap = overlap;
      bestDistance = distance;
    }
  }
  return bestId;
}

/** Move the active id once, at release, to the slot selected by its final
 * spatial rectangle. The stable-id lookup naturally survives index shifts. */
export function reorderAtSpatialTarget<T extends { id: number }>(
  items: T[],
  placements: readonly SpatialPlacement[],
  activeId: number,
  rect: SpatialRect,
): T[] | null {
  const targetId = spatialTargetId(placements, activeId, rect);
  if (targetId === null) return null;
  return reorderWithinList(items, buildIndexMap(items), activeId, targetId);
}
