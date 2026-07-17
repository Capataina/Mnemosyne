import { describe, it, expect } from "vitest";
import { buildIndexMap, reorderWithinList } from "./masonryReorder";

/**
 * T3-3 drag-swap reorder tests.
 *
 * `reorderWithinList` replaces the two O(N) `findIndex` scans a hover-swap
 * used to pay with an O(1) map lookup, and patches the map incrementally so
 * a whole drag builds it once. These tests lock two things: the reordered
 * output matches a `findIndex`-based reference, and the incrementally-patched
 * map stays correct across an arbitrary sequence of swaps (the property that
 * makes reusing it instead of rebuilding safe).
 */

interface Item {
  id: number;
}

function list(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
}

/** The pre-T3-3 reorder, kept here as the equivalence reference. */
function referenceReorder(base: Item[], fromId: number, toId: number): Item[] | null {
  const fromIndex = base.findIndex((x) => x.id === fromId);
  const toIndex = base.findIndex((x) => x.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
  const next = base.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function freshMapMatches(order: Item[], map: Map<number, number>): boolean {
  const fresh = buildIndexMap(order);
  if (fresh.size !== map.size) return false;
  for (const [id, idx] of fresh) if (map.get(id) !== idx) return false;
  return true;
}

describe("reorderWithinList", () => {
  it("matches the findIndex reference for a single swap (both directions)", () => {
    const base = list(8);
    // Move down: id 2 → id 6's slot.
    expect(
      reorderWithinList(base.slice(), buildIndexMap(base), 2, 6)?.map((x) => x.id),
    ).toEqual(referenceReorder(base, 2, 6)?.map((x) => x.id));
    // Move up: id 7 → id 3's slot.
    expect(
      reorderWithinList(base.slice(), buildIndexMap(base), 7, 3)?.map((x) => x.id),
    ).toEqual(referenceReorder(base, 7, 3)?.map((x) => x.id));
  });

  it("returns null for a no-op or an absent id, leaving the map untouched", () => {
    const base = list(5);
    const map = buildIndexMap(base);
    expect(reorderWithinList(base, map, 3, 3)).toBeNull(); // same id
    expect(reorderWithinList(base, map, 3, 999)).toBeNull(); // absent target
    expect(reorderWithinList(base, map, 999, 3)).toBeNull(); // absent source
    expect(freshMapMatches(base, map)).toBe(true);
  });

  it("keeps the patched map correct across a long random swap sequence", () => {
    // Drive many swaps through the SAME incrementally-patched map and assert,
    // after each, that the map still equals a from-scratch rebuild — the
    // invariant that lets a drag reuse the map instead of rebuilding it.
    let a = 0x9e3779b1;
    const rand = (max: number) => {
      a = (Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 1) >>> 0;
      return a % max;
    };

    let order = list(30);
    const map = buildIndexMap(order);
    for (let swap = 0; swap < 300; swap++) {
      const fromId = order[rand(order.length)].id;
      const toId = order[rand(order.length)].id;
      const reference = referenceReorder(order, fromId, toId);
      const next = reorderWithinList(order, map, fromId, toId);

      if (reference === null) {
        expect(next).toBeNull();
        continue;
      }
      expect(next).not.toBeNull();
      expect(next!.map((x) => x.id)).toEqual(reference.map((x) => x.id));
      // The map must now describe `next` exactly, with no rebuild.
      expect(freshMapMatches(next!, map)).toBe(true);
      order = next!;
    }
  });
});
