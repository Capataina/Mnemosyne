import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeedItem } from "../types";
import { MasonryAnchor } from "./MasonryAnchor";
import {
  buildPackInput,
  computeMasonryGeometry,
  type MasonryGeometry,
  type MasonryPackInput,
  type MasonryPackParams,
} from "./masonryPacking";

function tile(
  id: number,
  width: number,
  height: number,
  manualColSpan: number | null = null,
): FeedItem {
  return {
    id,
    name: `tile-${id}`,
    width,
    height,
    hasThumbnail: true,
    manualColSpan,
  };
}

interface Rect {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function rects(geometry: MasonryGeometry, items: FeedItem[]): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < geometry.count; i++) {
    if (i === geometry.selectedIndex) continue;
    out.push({
      id: items[i].id,
      x: geometry.xs[i],
      y: geometry.ys[i],
      width: geometry.widths[i],
      height: geometry.heights[i],
    });
  }
  if (geometry.hero) {
    out.push({
      id: -1,
      x: geometry.hero.x,
      y: geometry.hero.y,
      width: geometry.hero.width,
      height: geometry.hero.height,
    });
  }
  return out;
}

function intersects(a: Rect, b: Rect): boolean {
  const epsilon = 1e-7;
  return (
    a.x < b.x + b.width - epsilon &&
    a.x + a.width > b.x + epsilon &&
    a.y < b.y + b.height - epsilon &&
    a.y + a.height > b.y + epsilon
  );
}

function expectNoIntersections(geometry: MasonryGeometry, items: FeedItem[]) {
  const boxes = rects(geometry, items);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(
        intersects(boxes[i], boxes[j]),
        `${boxes[i].id} intersects ${boxes[j].id}`,
      ).toBe(false);
    }
  }
}

function gapCount(geometry: MasonryGeometry): number {
  const columns: Array<Array<[number, number]>> = Array.from(
    { length: geometry.columnCount },
    () => [],
  );
  const stride = geometry.columnWidth;
  for (let i = 0; i < geometry.count; i++) {
    if (i === geometry.selectedIndex) continue;
    const start = Math.round(geometry.xs[i] / stride);
    for (let col = start; col < start + geometry.spans[i]; col++) {
      columns[col].push([geometry.ys[i], geometry.ys[i] + geometry.heights[i]]);
    }
  }
  let count = 0;
  for (const intervals of columns) {
    intervals.sort((a, b) => a[0] - b[0]);
    let frontier = 0;
    for (const [top, bottom] of intervals) {
      if (top > frontier + 1e-7) count += 1;
      frontier = Math.max(frontier, bottom);
    }
  }
  return count;
}

const fourColumnParams: MasonryPackParams = {
  containerWidth: 400,
  minItemWidth: 100,
  columnGap: 0,
  verticalGap: 0,
  columnCountOverride: 4,
};

describe("occupancy-aware gesture packing", () => {
  it("backfills the free interval below a fixed wide footprint", () => {
    const items = [
      tile(1, 200, 100),
      tile(2, 100, 90),
      tile(3, 100, 90),
      tile(4, 100, 90),
    ];
    const geometry = computeMasonryGeometry(
      buildPackInput(items, null, {
        containerWidth: 300,
        minItemWidth: 100,
        columnGap: 0,
        verticalGap: 0,
        columnCountOverride: 3,
        gestureFootprint: {
          id: 1,
          span: 2,
          startCol: 1,
          top: 100,
        },
      }),
    );

    const active = items.findIndex((item) => item.id === 1);
    expect(geometry.ys[active]).toBe(100);
    // Items placed after the obstacle occupy both 0..90 vacancies beneath
    // it. A scalar frontier seeded to 200 could never produce these y=0s.
    expect(geometry.ys[items.findIndex((item) => item.id === 3)]).toBe(0);
    expect(geometry.ys[items.findIndex((item) => item.id === 4)]).toBe(0);
    expectNoIntersections(geometry, items);
  });

  it("keeps a resized tile's top while displacing a taller neighbour", () => {
    const items = [
      tile(1, 100, 300),
      tile(2, 100, 100),
      tile(3, 100, 250),
      tile(4, 100, 50),
      tile(5, 100, 80),
    ];
    const before = computeMasonryGeometry(
      buildPackInput(items, null, fourColumnParams),
    );
    const target = items.findIndex((item) => item.id === 5);
    const tallerNeighbour = items.findIndex((item) => item.id === 3);
    expect(before.ys[target]).toBe(50);
    expect(before.xs[tallerNeighbour]).toBe(200);

    const preview = computeMasonryGeometry(
      buildPackInput(items, null, {
        ...fourColumnParams,
        gestureFootprint: {
          id: 5,
          span: 2,
          startCol: 2,
          top: before.ys[target],
        },
      }),
    );
    expect(preview.ys[target]).toBe(before.ys[target]);
    expect(preview.xs[target]).toBe(200);
    // The neighbour that occupied this rectangle is solved elsewhere; the
    // resized tile is never pushed to that neighbour's old frontier.
    expect(preview.xs[tallerNeighbour]).not.toBe(before.xs[tallerNeighbour]);
    expectNoIntersections(preview, items);
  });

  it("a real release repack cannot increase the settled gap count", () => {
    const items = [
      tile(1, 100, 300),
      tile(2, 100, 100),
      tile(3, 100, 250),
      tile(4, 100, 50),
      tile(5, 100, 80, 2),
      tile(6, 100, 40),
      tile(7, 100, 60),
    ];
    const preview = computeMasonryGeometry(
      buildPackInput(items, null, {
        ...fourColumnParams,
        gestureFootprint: {
          id: 5,
          span: 2,
          startCol: 2,
          top: 50,
        },
      }),
    );
    const released = computeMasonryGeometry(
      buildPackInput(items, null, fourColumnParams),
    );
    expect(gapCount(released)).toBeLessThanOrEqual(
      gapCount(preview),
    );
    expectNoIntersections(released, items);
  });

  it("replays the recorded fast diagonal pointer paths for 1x1, 2x2, and 3x3 without intersections", () => {
    // Frozen from perf-1784401362/video1 and perf-1784401528/video2. Those
    // sessions used a six-column 1,424px grid: 224px tiles, 16px column gap,
    // and a grid origin at screen (40,109). Keeping the source data inline
    // makes this regression reproducible after the local telemetry export is
    // rotated away.
    const telemetryCursors = [
      [734, 575],
      [857, 438],
      [874, 433],
      [1152, 668],
      [686, 503],
      [601, 668],
      [885, 409],
      [525, 520],
      [377, 665],
      [356, 698],
      [709, 544],
      [796, 482],
      [1269, 251],
      [1051, 403],
      [869, 502],
      [780, 540],
      [763, 427],
      [568, 405],
      [786, 408],
      [838, 404],
      [764, 374],
      [762, 494],
    ] as const;
    // startCol is the footprint's physical LEFT column (the current
    // contract); the cursor column doubles as that reference here, clamped
    // per-span inside the packer.
    const paths = telemetryCursors.map(([screenX, screenY]) => ({
      startCol: Math.floor(Math.max(0, screenX - 40) / 240),
      top: Math.max(0, screenY - 109),
    }));
    const activeId = 1612;
    const items = Array.from({ length: 63 }, (_, index) =>
      tile(
        index === 20 ? activeId : 3000 + index,
        224,
        index % 11 === 0 ? 126 : 132,
      ),
    );
    for (const span of [1, 2, 3]) {
      for (const point of paths) {
        const geometry = computeMasonryGeometry(
          buildPackInput(items, null, {
            containerWidth: 1424,
            minItemWidth: 224,
            columnGap: 16,
            verticalGap: 16,
            columnCountOverride: 6,
            gestureFootprint: {
              id: activeId,
              span,
              startCol: point.startCol,
              top: point.top,
            },
          }),
        );
        expectNoIntersections(geometry, items);
      }
    }
  });

  it("packs a 100k-item active gesture with finite typed-array geometry", () => {
    const count = 100_000;
    const ids = new Float64Array(count);
    const widths = new Float64Array(count);
    const heights = new Float64Array(count);
    const spans = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      ids[i] = i + 1;
      widths[i] = 400;
      heights[i] = 220 + (i % 17);
      spans[i] = 1;
    }
    const input: MasonryPackInput = {
      ids,
      widths,
      heights,
      spans,
      containerWidth: 1440,
      minItemWidth: 224,
      columnGap: 16,
      verticalGap: 16,
      columnCountOverride: 6,
      tileScale: 1,
      hasHero: false,
      selectedIndex: -1,
      selectedWidth: 0,
      selectedHeight: 0,
      gestureFootprint: {
        id: 50_001,
        span: 3,
        startCol: 3,
        top: 12_345,
      },
      columnAnchors: null,
    };
    const geometry = computeMasonryGeometry(input);
    expect(geometry.count).toBe(count);
    expect(geometry.ys[50_000]).toBe(12_345);
    expect(geometry.spans[50_000]).toBe(3);
    expect(Number.isFinite(geometry.height)).toBe(true);
  });
});

describe("reserved rectangle is the rendered rectangle", () => {
  it("MasonryAnchor applies all four packed geometry fields", () => {
    const { container } = render(
      <MasonryAnchor
        id={42}
        x={123.5}
        y={87.25}
        width={240.75}
        height={135.5}
        onTop={false}
      >
        <div className="h-full w-full" />
      </MasonryAnchor>,
    );
    const anchor = container.firstElementChild as HTMLElement;
    expect(anchor.style.transform).toBe("translate(123.5px, 87.25px)");
    expect(anchor.style.width).toBe("240.75px");
    expect(anchor.style.height).toBe("135.5px");
    expect(anchor.dataset.masonryX).toBe("123.5");
    expect(anchor.dataset.masonryY).toBe("87.25");
    expect(anchor.dataset.masonryWidth).toBe("240.75");
    expect(anchor.dataset.masonryHeight).toBe("135.5");
  });

  it("non-positive dimensions degrade to finite square geometry", () => {
    const items = [tile(1, 0, 300), tile(2, 100, 0)];
    const geometry = computeMasonryGeometry(
      buildPackInput(items, null, {
        containerWidth: 200,
        minItemWidth: 100,
        columnGap: 0,
        verticalGap: 0,
        columnCountOverride: 2,
      }),
    );
    expect(Number.isFinite(geometry.height)).toBe(true);
    expect(Array.from(geometry.heights).every(Number.isFinite)).toBe(true);
    expect(Array.from(geometry.heights)).toEqual([100, 100]);
  });
});
