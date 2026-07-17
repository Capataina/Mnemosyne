import { describe, it, expect } from "vitest";
import {
  buildPackInput,
  computeMasonryGeometry,
  computeMasonryLayout,
  heroPlacement,
  placementAt,
  type MasonryGeometry,
  type MasonryItemPlacement,
  type MasonryLayoutInput,
} from "./masonryPacking";
import { isCurrentGeneration } from "../hooks/useMasonryEngine";
import type { FeedItem } from "../types";

/**
 * T3-3 equivalence + boundary tests for the typed-array pack.
 *
 * The pack now runs in a Web Worker on numeric typed arrays
 * (`computeMasonryGeometry`) and the main thread reattaches `itemData` for
 * the visible window. These tests lock the two things that make that safe:
 *
 *  1. Reconstructing placements from geometry — exactly as the engine does
 *     (hero first, then feed order skipping the hero) — is bit-for-bit
 *     identical to the object-pack reference (`computeMasonryLayout`), across
 *     random inputs. `computeMasonryLayout` delegates to the same core, so
 *     this is really guarding the reconstruction contract + `buildPackInput`.
 *  2. The geometry survives a structured-clone (the message boundary) with no
 *     precision loss — Float64 round-trips exactly.
 *  3. A prefix pack of the first K items has identical geometry to the first
 *     K of the full pack (suffix-independence) — the property that lets the
 *     first-paint prefix swap to the full worker result with no reflow.
 */

function feedTile(
  id: number,
  w: number,
  h: number,
  manualColSpan?: number | null,
): FeedItem {
  return {
    id,
    name: `tile-${id}`,
    hasThumbnail: true,
    width: w,
    height: h,
    manualColSpan: manualColSpan ?? null,
  };
}

/** Deterministic RNG so a failing case is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reconstruct placements from geometry the way the engine's visible pass
 *  does — but over all N — so it can be compared to the object pack. */
function reconstruct(
  geo: MasonryGeometry,
  items: FeedItem[],
  selectedItem: FeedItem | null,
): MasonryItemPlacement[] {
  if (geo.columnCount === 0) return [];
  const out: MasonryItemPlacement[] = [];
  const hero = heroPlacement(geo, selectedItem);
  if (hero) out.push(hero);
  for (let i = 0; i < items.length; i++) {
    if (i === geo.selectedIndex) continue;
    out.push(placementAt(geo, items, i));
  }
  return out;
}

function expectPlacementsEqual(
  actual: MasonryItemPlacement[],
  expected: MasonryItemPlacement[],
) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    const e = expected[i];
    // itemData must be the SAME object reference the object pack attached.
    expect(a.itemData).toBe(e.itemData);
    // Geometry must be bit-for-bit equal (Float64 round-trip).
    expect(a.x).toBe(e.x);
    expect(a.y).toBe(e.y);
    expect(a.width).toBe(e.width);
    expect(a.height).toBe(e.height);
    expect(a.colSpan).toBe(e.colSpan);
    expect(a.isSelected).toBe(e.isSelected);
  }
}

describe("computeMasonryGeometry — equivalence with the object pack", () => {
  it("matches computeMasonryLayout bit-for-bit across random inputs", () => {
    const rng = mulberry32(0xc0ffee);
    for (let trial = 0; trial < 200; trial++) {
      const n = Math.floor(rng() * 40); // 0..39 items
      const items: FeedItem[] = [];
      for (let i = 0; i < n; i++) {
        const span =
          rng() < 0.25 ? 1 + Math.floor(rng() * 4) : null; // sometimes spanned
        items.push(
          feedTile(
            i + 1,
            20 + Math.floor(rng() * 1980),
            20 + Math.floor(rng() * 1980),
            span,
          ),
        );
      }

      // Selection: sometimes none, sometimes one of the items, sometimes an
      // outsider (selected but absent from the feed).
      let selectedItem: FeedItem | null = null;
      const selRoll = rng();
      if (n > 0 && selRoll < 0.4) {
        selectedItem = items[Math.floor(rng() * n)];
      } else if (selRoll < 0.55) {
        selectedItem = feedTile(9999, 800, 400);
      }

      // Live drag span overrides on a couple of ids.
      let spanOverrides: Record<number, number> | undefined;
      if (n > 0 && rng() < 0.3) {
        spanOverrides = {};
        const id = items[Math.floor(rng() * n)].id;
        spanOverrides[id] = 1 + Math.floor(rng() * 4);
      }

      const input: MasonryLayoutInput = {
        items,
        selectedItem,
        containerWidth: rng() < 0.08 ? 0 : 200 + Math.floor(rng() * 1800),
        minItemWidth: 80 + Math.floor(rng() * 260),
        columnGap: Math.floor(rng() * 24),
        verticalGap: Math.floor(rng() * 24),
        columnCountOverride: rng() < 0.3 ? 1 + Math.floor(rng() * 14) : 0,
        tileScale: rng() < 0.3 ? 0.5 + rng() * 2 : 1.0,
        spanOverrides,
      };

      const reference = computeMasonryLayout(input);
      const geo = computeMasonryGeometry(
        buildPackInput(items, selectedItem, input),
      );
      const rebuilt = reconstruct(geo, items, selectedItem);

      expectPlacementsEqual(rebuilt, reference.placements);
      expect(geo.height).toBe(reference.height);
      expect(geo.columnCount).toBe(reference.columnCount);
      expect(geo.columnWidth).toBe(reference.columnWidth);
    }
  });

  it("survives a structured-clone message boundary with no precision loss", () => {
    const rng = mulberry32(0x5eed);
    const items = Array.from({ length: 60 }, (_, i) =>
      feedTile(i + 1, 20 + Math.floor(rng() * 1980), 20 + Math.floor(rng() * 1980)),
    );
    const input: MasonryLayoutInput = {
      items,
      selectedItem: items[3],
      containerWidth: 1337,
      minItemWidth: 213,
      columnGap: 16,
      verticalGap: 16,
    };
    const geo = computeMasonryGeometry(buildPackInput(items, items[3], input));
    // structuredClone models the worker's postMessage copy; transfer is even
    // more lossless. Reconstruct from the clone and compare to the original.
    const cloned = structuredClone(geo);
    expectPlacementsEqual(
      reconstruct(cloned, items, items[3]),
      reconstruct(geo, items, items[3]),
    );
    expect(cloned.height).toBe(geo.height);
  });
});

describe("prefix pack — suffix-independence (first-paint seamless swap)", () => {
  it("gives the first K tiles the same geometry as the full pack", () => {
    const rng = mulberry32(0x1234);
    const items = Array.from({ length: 500 }, (_, i) =>
      feedTile(i + 1, 20 + Math.floor(rng() * 1980), 20 + Math.floor(rng() * 1980)),
    );
    const params = {
      containerWidth: 1200,
      minItemWidth: 236,
      columnGap: 16,
      verticalGap: 16,
    };
    const full = computeMasonryGeometry(buildPackInput(items, null, params));

    const K = 240;
    const prefixItems = items.slice(0, K);
    const prefix = computeMasonryGeometry(
      buildPackInput(prefixItems, null, params),
    );

    expect(prefix.columnCount).toBe(full.columnCount);
    expect(prefix.columnWidth).toBe(full.columnWidth);
    for (let i = 0; i < K; i++) {
      expect(prefix.xs[i]).toBe(full.xs[i]);
      expect(prefix.ys[i]).toBe(full.ys[i]);
      expect(prefix.widths[i]).toBe(full.widths[i]);
      expect(prefix.heights[i]).toBe(full.heights[i]);
      expect(prefix.spans[i]).toBe(full.spans[i]);
    }
    // The prefix is a genuine prefix: its height never exceeds the full grid.
    expect(prefix.height).toBeLessThanOrEqual(full.height);
  });
});

describe("isCurrentGeneration — stale-result discard", () => {
  it("accepts only the current generation", () => {
    expect(isCurrentGeneration(5, 5)).toBe(true);
    expect(isCurrentGeneration(4, 5)).toBe(false);
    expect(isCurrentGeneration(6, 5)).toBe(false);
  });

  it("drops every superseded result in a rapid input sequence", () => {
    // Model the engine: gen bumps per request; results arrive out of order;
    // only the one carrying the latest gen is applied → converges to latest.
    let currentGen = 0;
    const request = () => ++currentGen;
    const g1 = request();
    const g2 = request();
    const g3 = request(); // latest filter/resize input wins

    const applied: number[] = [];
    // Results arrive in a scrambled order.
    for (const g of [g1, g3, g2, g1]) {
      if (isCurrentGeneration(g, currentGen)) applied.push(g);
    }
    expect(applied).toEqual([g3]);
  });
});
