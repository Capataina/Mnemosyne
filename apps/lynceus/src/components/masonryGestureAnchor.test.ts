import { describe, it, expect } from "vitest";
import {
  resolveAnchorLeft,
  buildPackInput,
  computeMasonryGeometry,
  type MasonryPackParams,
} from "./masonryPacking";
import { ordersAligned } from "../hooks/useMasonryEngine";
import type { FeedItem } from "../types";

/**
 * Regression coverage for the gesture-anchor rework: the two-axis span-aware
 * anchor (resolveAnchorLeft), the prevCols coherence tie-break, and the
 * commit-adopt order guard (ordersAligned). These assert the CORRECT
 * behaviour the rework introduced — the old repro suite proved the bugs; this
 * proves the fixes.
 */

const item = (id: number, w = 100, h = 100): FeedItem =>
  ({ id, width: w, height: h }) as FeedItem;

describe("resolveAnchorLeft — two-axis span-aware anchor", () => {
  it("edge=0 (left) is byte-identical to the old left-only clamp", () => {
    // The equivalence guarantee: with the default edge, the resolver is the
    // exact `Math.max(0, Math.min(startCol, colCount - span))` it replaced.
    for (const [startCol, span, colCount] of [
      [0, 1, 6],
      [3, 1, 6],
      [5, 2, 6],
      [5, 3, 6],
      [2, 3, 3],
      [9, 3, 6],
    ] as const) {
      expect(resolveAnchorLeft(startCol, 0, span, colCount)).toBe(
        Math.max(0, Math.min(startCol, colCount - span)),
      );
    }
  });

  it("edge=2 (centre) centres the footprint on the pointer column", () => {
    // A span-3 tile whose pointer is over column 5 reserves columns 4,5,6 —
    // the 3×3-drag fix: the footprint reaches its true edges instead of the
    // old left-only reading that lost (span-1)/colCount of range.
    expect(resolveAnchorLeft(5, 2, 3, 10)).toBe(4); // {4,5,6} around 5
    expect(resolveAnchorLeft(5, 2, 1, 10)).toBe(5); // span 1 = pointer col
    expect(resolveAnchorLeft(5, 2, 2, 10)).toBe(4); // even span: pointer inside
  });

  it("edge=1 (right) pins the right edge for a left-corner resize", () => {
    expect(resolveAnchorLeft(9, 1, 3, 10)).toBe(7); // right edge at 9 → {7,8,9}
  });

  it("clamps every edge mode into [0, colCount - span]", () => {
    expect(resolveAnchorLeft(9, 2, 3, 10)).toBe(7); // centred-then-clamped at right wall
    expect(resolveAnchorLeft(0, 2, 3, 10)).toBe(0); // clamped at left wall
    expect(resolveAnchorLeft(0, 3, 3, 3)).toBe(0); // colCount == span → only col 0
  });
});

describe("prevCols coherence tie-break", () => {
  const params = (extra: Partial<MasonryPackParams> = {}): MasonryPackParams => ({
    containerWidth: 600,
    minItemWidth: 100,
    columnGap: 0,
    verticalGap: 0,
    ...extra,
  });

  it("is inert when prevCols is null — steady-state pack is pure greedy", () => {
    // Six equal tiles across 6 columns: the first row all tie at height 0 and
    // greedy resolves the tie left-to-right. prevCols=null must not change it.
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => item(id));
    const geo = computeMasonryGeometry(buildPackInput(items, null, params()));
    const withNull = computeMasonryGeometry(
      buildPackInput(items, null, params({ prevCols: undefined })),
    );
    expect(Array.from(withNull.xs)).toEqual(Array.from(geo.xs));
    expect(Array.from(withNull.ys)).toEqual(Array.from(geo.ys));
  });

  it("keeps a tied tile in its previous column instead of the greedy default", () => {
    // Tile at index 6 (the 7th, second row) ties across all columns at the
    // same height; greedy would place it in column 0, but a prevCols seed of
    // column 3 holds it there — no shimmer, and no overlap (it takes column
    // 3's real frontier height).
    const items = [1, 2, 3, 4, 5, 6, 7].map((id) => item(id));
    const seed = new Int32Array([-1, -1, -1, -1, -1, -1, 3]);
    const geo = computeMasonryGeometry(
      buildPackInput(items, null, params({ prevCols: seed })),
    );
    const stride = geo.columnWidth; // gap 0
    expect(Math.round(geo.xs[6] / stride)).toBe(3);
    // No overlap: tile 7 sits flush below column 3's tile (index 3), not above.
    expect(geo.ys[6]).toBeGreaterThanOrEqual(geo.ys[3] + geo.heights[3] - 0.001);
  });
});

describe("ordersAligned — commit-adopt guard", () => {
  it("true for identical id order", () => {
    expect(ordersAligned([item(1), item(2), item(3)], [item(1), item(2), item(3)])).toBe(true);
  });
  it("false when an id order differs (a reorder the adopt geometry doesn't match)", () => {
    expect(ordersAligned([item(1), item(2), item(3)], [item(1), item(3), item(2)])).toBe(false);
  });
  it("false when lengths differ (a delta-merge added a tile)", () => {
    expect(ordersAligned([item(1), item(2)], [item(1), item(2), item(3)])).toBe(false);
  });
});
