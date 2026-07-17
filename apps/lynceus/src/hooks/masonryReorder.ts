/**
 * Pure reorder + id→index map maintenance for drag-to-reorder (T3-3,
 * absorbing rejected #5's drag-swap cost).
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
