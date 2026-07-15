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
    // Masonry.tsx and context/plans/performance-analysis.md.
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
