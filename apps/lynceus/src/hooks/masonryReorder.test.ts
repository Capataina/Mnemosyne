import { describe, it, expect } from "vitest";
import {
  buildIndexMap,
  reorderAtSpatialTarget,
  reorderWithinList,
  spatialTargetId,
} from "./masonryReorder";

/**
 * Commit-time reorder tests.
 *
 * `reorderWithinList` remains the insertion primitive. Gesture frames no
 * longer call it; `reorderAtSpatialTarget` invokes it once at release from
 * the final occupancy rectangle. These tests lock the reordered
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

describe("spatial release target", () => {
  const placements = [
    { itemData: { id: 1 }, x: 0, y: 0, width: 100, height: 100 },
    { itemData: { id: 2 }, x: 100, y: 0, width: 100, height: 100 },
    { itemData: { id: 3 }, x: 0, y: 100, width: 100, height: 100 },
  ];

  it("uses maximum rectangle overlap, not feed-index distance", () => {
    expect(
      spatialTargetId(placements, 1, {
        x: 115,
        y: 10,
        width: 80,
        height: 80,
      }),
    ).toBe(2);
  });

  it("performs exactly one stable-id insertion at release", () => {
    const base = list(3);
    expect(
      reorderAtSpatialTarget(base, placements, 1, {
        x: 5,
        y: 115,
        width: 80,
        height: 80,
      })?.map((item) => item.id),
    ).toEqual([2, 3, 1]);
  });

  it("keeps the order when the tile is dropped over its source slot", () => {
    const base = list(3);
    expect(
      reorderAtSpatialTarget(base, placements, 1, {
        x: 10,
        y: 10,
        width: 80,
        height: 80,
      }),
    ).toBeNull();
  });

  it("targets the pre-gesture slot rather than a neighbour displaced by the reservation", () => {
    const base = list(3);
    const dropRect = { x: 130, y: 10, width: 80, height: 80 };
    const displaced = [
      placements[0],
      { ...placements[1], x: 300 },
      { ...placements[2], x: 200, y: 0 },
    ];

    expect(spatialTargetId(placements, 1, dropRect)).toBe(2);
    // Once the obstacle moves id 2 away, scoring the preview geometry picks
    // id 3 even though the user dropped on id 2's original slot.
    expect(spatialTargetId(displaced, 1, dropRect)).toBe(3);
    expect(
      reorderAtSpatialTarget(base, placements, 1, dropRect)?.map(
        (item) => item.id,
      ),
    ).toEqual([2, 1, 3]);
  });
});
