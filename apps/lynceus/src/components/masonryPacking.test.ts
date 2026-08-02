import { describe, it, expect } from "vitest";
import { computeMasonryLayout } from "./masonryPacking";
import type { ImageItem } from "../types";

/**
 * Pure layout-math tests. No DOM, no React — just shape assertions
 * on the computed placements. These catch regressions in the
 * shortest-column packing logic, the hero-card 3-column promotion,
 * and the column-count override behaviour.
 */

function tile(
  id: number,
  w: number,
  h: number,
  manualColSpan?: number,
): ImageItem {
  return {
    id,
    url: `mock://${id}`,
    hasThumbnail: true,
    width: w,
    height: h,
    name: `tile-${id}`,
    tags: [],
    manualColSpan,
  };
}

describe("computeMasonryLayout", () => {
  it("returns empty layout when container width is zero", () => {
    const out = computeMasonryLayout({
      items: [tile(1, 100, 100)],
      containerWidth: 0,
      minItemWidth: 200,
      columnGap: 16,
      verticalGap: 16,
    });
    expect(out.placements).toHaveLength(0);
    expect(out.height).toBe(0);
    expect(out.columnCount).toBe(0);
  });

  it("derives column count from container width / min item width", () => {
    // 1000px wide / 200px min = 5 cols (Math.floor)
    const out = computeMasonryLayout({
      items: [],
      containerWidth: 1000,
      minItemWidth: 200,
      columnGap: 0,
      verticalGap: 0,
    });
    expect(out.columnCount).toBe(5);
  });

  it("respects an explicit column count override", () => {
    const out = computeMasonryLayout({
      items: [],
      containerWidth: 1000,
      minItemWidth: 200,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 3,
    });
    expect(out.columnCount).toBe(3);
  });

  it("caps the column override at 12 to prevent absurd values", () => {
    const out = computeMasonryLayout({
      items: [],
      containerWidth: 1000,
      minItemWidth: 200,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 999,
    });
    expect(out.columnCount).toBe(12);
  });

  it("forces at least 1 column even when container is narrower than minItemWidth", () => {
    const out = computeMasonryLayout({
      items: [],
      containerWidth: 50,
      minItemWidth: 200,
      columnGap: 0,
      verticalGap: 0,
    });
    expect(out.columnCount).toBe(1);
  });

  it("scales auto-derived columns by tileScale", () => {
    // 1000 wide, min 200, scale 2.0 → effective min 400 → 2 cols
    const out = computeMasonryLayout({
      items: [],
      containerWidth: 1000,
      minItemWidth: 200,
      columnGap: 0,
      verticalGap: 0,
      tileScale: 2.0,
    });
    expect(out.columnCount).toBe(2);
  });

  it("places a single tile in the leftmost column at y=0", () => {
    const out = computeMasonryLayout({
      items: [tile(1, 200, 200)],
      containerWidth: 1000,
      minItemWidth: 200,
      columnGap: 16,
      verticalGap: 16,
      columnCountOverride: 5,
    });
    expect(out.placements).toHaveLength(1);
    const p = out.placements[0];
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.isSelected).toBe(false);
  });

  it("places multiple items into shortest columns", () => {
    // Equal-aspect square tiles in 3 cols. After 3 placements, every
    // column has one tile of the same height. The 4th tile lands in
    // column 0 (first shortest by argmin).
    const items = [
      tile(1, 100, 100),
      tile(2, 100, 100),
      tile(3, 100, 100),
      tile(4, 100, 100),
    ];
    const out = computeMasonryLayout({
      items,
      containerWidth: 600,
      minItemWidth: 200,
      columnGap: 0,
      verticalGap: 0,
    });
    expect(out.columnCount).toBe(3);
    expect(out.placements).toHaveLength(4);
    // Item 4 should be in column 0, below item 1.
    const p4 = out.placements[3];
    expect(p4.x).toBe(0);
    expect(p4.y).toBeGreaterThan(0);
  });

  it("promotes the selected item to the top spanning up to 3 columns", () => {
    const selected = tile(1, 1000, 500);
    const items = [selected, tile(2, 100, 100), tile(3, 100, 100)];
    const out = computeMasonryLayout({
      items,
      selectedItem: selected,
      containerWidth: 900,
      minItemWidth: 300,
      columnGap: 0,
      verticalGap: 0,
    });
    // 900 / 300 = 3 cols → hero spans all 3.
    expect(out.columnCount).toBe(3);
    const heroes = out.placements.filter((p) => p.isSelected);
    expect(heroes).toHaveLength(1);
    const hero = heroes[0];
    expect(hero.x).toBe(0);
    expect(hero.y).toBe(0);
    // Hero width should be the full container (3 cols × 300 + 0 gap).
    expect(hero.width).toBe(900);
  });

  it("hero card uses fewer columns when container is narrow", () => {
    const selected = tile(1, 1000, 500);
    const out = computeMasonryLayout({
      items: [selected],
      selectedItem: selected,
      containerWidth: 400,
      minItemWidth: 300,
      columnGap: 0,
      verticalGap: 0,
    });
    // 400 / 300 = 1 col → hero spans 1 col.
    expect(out.columnCount).toBe(1);
    const hero = out.placements[0];
    expect(hero.width).toBe(400);
  });

  it("does not duplicate the selected item when it also appears in items", () => {
    const selected = tile(1, 1000, 500);
    const items = [selected, tile(2, 100, 100)];
    const out = computeMasonryLayout({
      items,
      selectedItem: selected,
      containerWidth: 600,
      minItemWidth: 200,
      columnGap: 0,
      verticalGap: 0,
    });
    // Should have exactly 2 placements: hero + tile 2. The selected
    // item's appearance in `items` must not produce a second tile.
    expect(out.placements).toHaveLength(2);
    expect(out.placements.filter((p) => p.itemData.id === selected.id))
      .toHaveLength(1);
  });

  it("preserves aspect ratio when scaling tiles to column width", () => {
    // 200x100 tile placed in a 100-wide column should have height 50.
    const out = computeMasonryLayout({
      items: [tile(1, 200, 100), tile(2, 100, 100)],
      containerWidth: 200,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
    });
    expect(out.columnCount).toBe(2);
    // First tile in col 0 → next item lands in col 1 (since col 0 is
    // taller after the wide-aspect tile). The height field isn't
    // exposed but we can verify the y of tile 2 is less than tile 1's
    // implied bottom.
    const tile1 = out.placements.find((p) => p.itemData.id === 1)!;
    const tile2 = out.placements.find((p) => p.itemData.id === 2)!;
    expect(tile1.x).toBe(0);
    expect(tile2.x).toBe(100);
    expect(tile2.y).toBe(0);
  });

  it("returns a non-zero total height for non-empty layouts", () => {
    const out = computeMasonryLayout({
      items: [tile(1, 100, 100)],
      containerWidth: 200,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
    });
    expect(out.height).toBeGreaterThan(0);
  });

  it("emits a per-placement height matching aspect-ratio scaling", () => {
    // 200x100 source tile in a 100-wide column should render at 50px
    // tall. Used by the Masonry viewport-culling pass — see
    // Masonry.tsx and the perf-decision notes in src/components/CLAUDE.md.
    const out = computeMasonryLayout({
      items: [tile(1, 200, 100)],
      containerWidth: 100,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
    });
    expect(out.placements).toHaveLength(1);
    expect(out.placements[0].height).toBeCloseTo(50, 5);
  });

  it("emits a hero placement height scaled to its spanned width", () => {
    const selected = tile(1, 1000, 500);
    const out = computeMasonryLayout({
      items: [selected],
      selectedItem: selected,
      containerWidth: 900,
      minItemWidth: 300,
      columnGap: 0,
      verticalGap: 0,
    });
    // Hero spans all 3 cols → 900px wide → 1000:500 ratio → 450 tall.
    const hero = out.placements.find((p) => p.isSelected)!;
    expect(hero.height).toBeCloseTo(450, 5);
  });

  // ============================================================
  //  Column-span support (drag-to-resize, Phase 12g)
  // ============================================================

  it("spans a resized item across the requested number of columns", () => {
    const out = computeMasonryLayout({
      items: [tile(1, 400, 100, 2)],
      containerWidth: 600,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 3,
    });
    const p = out.placements[0];
    // 2 of 3 cols, each 200px wide → 400px placed width.
    expect(p.colSpan).toBe(2);
    expect(p.width).toBe(400);
    // Aspect ratio preserved at the spanned width: 400x100 source at
    // 400px placed width → 100px tall, unchanged.
    expect(p.height).toBeCloseTo(100, 5);
  });

  it("places a spanned item flush against the tallest column in its window", () => {
    // Column 0 already has a tile (height 50); columns 1-2 are empty.
    // A 2-span item should prefer the (1,2) window over (0,1), since
    // starting at 0 would have to clear column 0's existing height.
    const items = [tile(1, 100, 50), tile(2, 200, 100, 2)];
    const out = computeMasonryLayout({
      items,
      containerWidth: 300,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 3,
    });
    const spanned = out.placements.find((p) => p.itemData.id === 2)!;
    expect(spanned.colSpan).toBe(2);
    expect(spanned.x).toBe(100); // starts at column 1, not column 0
    expect(spanned.y).toBe(0); // columns 1-2 were both empty
  });

  it("clamps a requested span to the available column count", () => {
    const out = computeMasonryLayout({
      items: [tile(1, 100, 100, 99)],
      containerWidth: 300,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 3,
    });
    expect(out.placements[0].colSpan).toBe(3);
  });

  it("consults spanOverrides ahead of the item's persisted manualColSpan for live drag preview", () => {
    const out = computeMasonryLayout({
      items: [tile(1, 200, 100, 1)],
      containerWidth: 300,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 3,
      spanOverrides: { 1: 3 },
    });
    expect(out.placements[0].colSpan).toBe(3);
  });

  it("defaults colSpan to 1 for items with no manualColSpan set", () => {
    const out = computeMasonryLayout({
      items: [tile(1, 100, 100)],
      containerWidth: 300,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 3,
    });
    expect(out.placements[0].colSpan).toBe(1);
  });

  it("exposes columnWidth on the output for the resize handle's drag-delta math", () => {
    const out = computeMasonryLayout({
      items: [],
      containerWidth: 300,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 0,
      columnCountOverride: 3,
    });
    expect(out.columnWidth).toBe(100);
  });
});

/**
 * Session placement anchors make the settle pack the gesture telegraph with
 * the ghost snapped in: pinned rectangles reserve first, then occupancy
 * backfills densely around them. Stale/overlapping pins fall back to the
 * pinned column's ordinary lowest-free placement, preserving non-overlap.
 */
describe("session placement anchors", () => {
  const params = {
    containerWidth: 1424,
    minItemWidth: 224,
    columnGap: 16,
    verticalGap: 16,
    columnCountOverride: 6,
  };
  const stride = 240;

  // Deterministic jitter (mulberry32) so failures reproduce run-to-run.
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function jitteredFeed(seed: number, count: number, spanTwoId: number) {
    const rand = rng(seed);
    return Array.from({ length: count }, (_, index) => {
      const id = index + 1;
      return tile(
        id,
        1280,
        640 + Math.floor(rand() * 160),
        id === spanTwoId ? 2 : undefined,
      );
    });
  }

  function overlapArea(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return Math.max(0, w) * Math.max(0, h);
  }

  function placementRect(layout: ReturnType<typeof computeMasonryLayout>, id: number) {
    const { x, y, width, height } = layout.placementById.get(id)!;
    return { x, y, width, height };
  }

  function expectNoOverlaps(layout: ReturnType<typeof computeMasonryLayout>) {
    const placements = layout.placements;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        expect(overlapArea(placements[i], placements[j])).toBeLessThanOrEqual(
          1,
        );
      }
    }
  }

  function settleMatchesTelegraph(
    items: ImageItem[],
    id: number,
    footprint: { id: number; span: number; startCol: number; top: number },
  ) {
    const telegraph = computeMasonryLayout({
      items,
      ...params,
      gestureFootprint: footprint,
    });
    const settled = computeMasonryLayout({
      items,
      ...params,
      placementAnchors: {
        [id]: { startCol: footprint.startCol, top: footprint.top },
      },
    });
    expect(placementRect(settled, id)).toEqual(placementRect(telegraph, id));
    expectNoOverlaps(settled);
  }

  function unevenFrontierFeed() {
    // Hunt2-A's uneven-frontier construct: an unrelated tall tile makes the
    // first span window materially taller than the others before the active
    // tile's old feed-order turn.
    return [
      tile(1, 224, 920),
      ...Array.from({ length: 18 }, (_, index) =>
        tile(index + 2, 224, 140),
      ),
    ];
  }

  it("keeps a grow settle pixel-exact with its telegraph rectangle", () => {
    const growId = 100;
    settleMatchesTelegraph(
      [...unevenFrontierFeed(), tile(growId, 704, 420, 3)],
      growId,
      { id: growId, span: 3, startCol: 0, top: 624 },
    );
  });

  it("keeps a shrink settle pixel-exact with its telegraph rectangle", () => {
    const shrinkId = 101;
    settleMatchesTelegraph(
      [...unevenFrontierFeed(), tile(shrinkId, 464, 274, 2)],
      shrinkId,
      { id: shrinkId, span: 2, startCol: 1, top: 936 },
    );
  });

  it("keeps a resize settle at the previewed rectangle without an order change", () => {
    const id = 7;
    const items = jitteredFeed(17, 18, id).map((item) =>
      item.id === id ? { ...item, manualColSpan: 2 } : item,
    );
    settleMatchesTelegraph(items, id, {
      id,
      span: 2,
      startCol: 1,
      top: 200,
    });
  });

  it("falls an overlapping second pin back to its column's lowest free y", () => {
    const items = [tile(1, 100, 100), tile(2, 100, 100)];
    const layout = computeMasonryLayout({
      items,
      containerWidth: 200,
      minItemWidth: 100,
      columnGap: 0,
      verticalGap: 16,
      columnCountOverride: 2,
      placementAnchors: {
        1: { startCol: 0, top: 0 },
        2: { startCol: 0, top: 0 },
      },
    });

    expect(placementRect(layout, 1)).toMatchObject({ x: 0, y: 0 });
    expect(placementRect(layout, 2)).toMatchObject({ x: 0, y: 116 });
    expectNoOverlaps(layout);
  });

  it("pins an anchored tile's full rect and holds it across input changes", () => {
    const items = jitteredFeed(7, 24, 12);
    const free = computeMasonryLayout({ items, ...params });
    const freeCol = Math.round(free.placementById.get(12)!.x / stride);
    // Anchor deliberately to a DIFFERENT column than the argmin would pick,
    // so the pin is proven to override the search rather than agree with it.
    const anchor = { startCol: (freeCol + 2) % 5, top: 480 };
    const anchors = { 12: anchor };

    const pinned = computeMasonryLayout({
      items,
      ...params,
      placementAnchors: anchors,
    });
    const pinnedRect = placementRect(pinned, 12);
    expect(pinnedRect.x).toBe(anchor.startCol * stride);
    expect(pinnedRect.y).toBe(anchor.top);

    // The settle-wobble gate: a perturbed input (one appended tile — the
    // optimistic-patch/refetch shape) must not move any edge of the anchored
    // tile. The former X-only gate missed the release-time Y divergence.
    const perturbed = computeMasonryLayout({
      items: [...items, tile(99, 1280, 700)],
      ...params,
      placementAnchors: anchors,
    });
    expect(placementRect(perturbed, 12)).toEqual(pinnedRect);
  });

  it("ignores anchors for absent ids and keeps unanchored packs byte-identical", () => {
    const items = jitteredFeed(11, 18, 9);
    const bare = computeMasonryLayout({ items, ...params });
    const staleAnchor = computeMasonryLayout({
      items,
      ...params,
      placementAnchors: { 4040: { startCol: 3, top: 480 } },
    });
    for (const item of items) {
      const a = bare.placementById.get(item.id)!;
      const b = staleAnchor.placementById.get(item.id)!;
      expect(b.x).toBe(a.x);
      expect(b.y).toBe(a.y);
    }
  });

  it("lets a live footprint win over its own id's anchor", () => {
    const items = jitteredFeed(3, 18, 9);
    const layout = computeMasonryLayout({
      items,
      ...params,
      placementAnchors: { 9: { startCol: 0, top: 0 } },
      gestureFootprint: { id: 9, span: 2, startCol: 3, top: 480 },
    });
    const placement = layout.placementById.get(9)!;
    expect(Math.round(placement.x / stride)).toBe(3);
    expect(placement.y).toBe(480);
  });

  it("never overlaps settled tiles with random rectangle pins (seeded trials)", () => {
    for (let trial = 0; trial < 40; trial++) {
      const rand = rng(1000 + trial);
      const items = Array.from({ length: 30 }, (_, index) =>
        tile(
          index + 1,
          1280,
          600 + Math.floor(rand() * 240),
          rand() < 0.2 ? 2 : undefined,
        ),
      );
      const anchors: Record<number, { startCol: number; top: number }> = {};
      for (let k = 0; k < 3; k++) {
        anchors[1 + Math.floor(rand() * 30)] = {
          startCol: Math.floor(rand() * 6),
          top: Math.floor(rand() * 12) * 48,
        };
      }
      const layout = computeMasonryLayout({
        items,
        ...params,
        placementAnchors: anchors,
      });
      expectNoOverlaps(layout);
    }
  });
  it("reserves the hero before session pins so a pin can never displace it", () => {
    // Wave-2 critique: pins-first let a {col 0, top 0} pin shove the hero
    // down for one transient frame before the lifecycle cleared the pins.
    // The hero now reserves first; the colliding pin falls back to its
    // column's lowest free y beneath it.
    const items = [tile(1, 1280, 640), tile(2, 1280, 640), tile(3, 1280, 640)];
    const layout = computeMasonryLayout({
      items,
      selectedItem: items[0],
      ...params,
      placementAnchors: { 2: { startCol: 0, top: 0 } },
    });
    const hero = layout.placementById.get(1)!;
    const pinned = layout.placementById.get(2)!;
    expect(hero.y).toBe(0);
    expect(Math.round(pinned.x / stride)).toBe(0);
    expect(pinned.y).toBeGreaterThanOrEqual(hero.height);
  });
});
