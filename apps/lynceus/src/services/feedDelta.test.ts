import { describe, it, expect, vi } from "vitest";
import type { FeedItem } from "../types";

/**
 * Tests for the pure feed-delta merge (T3-1). The merge is the frontend
 * half of the delta protocol: it must produce EXACTLY the array a fresh
 * manifest refetch would (membership, order, field values) while
 * preserving object identity for untouched entries — the MasonryItem
 * memo comparator and the shuffle's incremental fast path both key off
 * identity to skip work during indexing churn.
 */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `tauri://localhost/${path}`,
}));

import { mergeFeedDeltaRows, UNFILTERED_MANIFEST_KEY } from "./feedDelta";

function entry(id: number, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    name: `img_${id}.jpg`,
    hasThumbnail: false,
    width: 400,
    height: 400,
    manualColSpan: null,
    ...overrides,
  };
}

function deltaRow(id: number, w = 800, h = 600) {
  return {
    id,
    name: `img_${id}.jpg`,
    width: w,
    height: h,
    thumbnail_path: `/thumbs/thumb_${id}.jpg`,
  };
}

describe("mergeFeedDeltaRows", () => {
  it("patches an existing row in place: dims land, thumbnail gates open, position unchanged", () => {
    const current = [entry(1), entry(2), entry(3)];
    const out = mergeFeedDeltaRows(current, [deltaRow(2)]);
    expect(out.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(out[1].hasThumbnail).toBe(true);
    expect(out[1].thumbnailUrl).toContain("thumb_2.jpg");
    expect(out[1].width).toBe(800);
    expect(out[1].height).toBe(600);
  });

  it("preserves object identity for untouched entries (memo/comparator contract)", () => {
    const current = [entry(1), entry(2), entry(3)];
    const out = mergeFeedDeltaRows(current, [deltaRow(2)]);
    expect(out[0]).toBe(current[0]);
    expect(out[2]).toBe(current[2]);
    expect(out[1]).not.toBe(current[1]);
  });

  it("preserves a persisted manualColSpan through a re-thumbnail patch", () => {
    // Deltas never carry a span; a patch must not wipe a drag-resize.
    const current = [entry(5, { manualColSpan: 3 })];
    const out = mergeFeedDeltaRows(current, [deltaRow(5)]);
    expect(out[0].manualColSpan).toBe(3);
  });

  it("inserts new ids at their id-sorted position (matches a fresh refetch)", () => {
    const current = [entry(10), entry(30)];
    const out = mergeFeedDeltaRows(current, [deltaRow(20), deltaRow(5)]);
    expect(out.map((e) => e.id)).toEqual([5, 10, 20, 30]);
    expect(out.find((e) => e.id === 20)?.hasThumbnail).toBe(true);
  });

  it("handles a mixed patch+insert batch in one pass", () => {
    const current = [entry(1), entry(2)];
    const out = mergeFeedDeltaRows(current, [deltaRow(2), deltaRow(3)]);
    expect(out.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(out[0]).toBe(current[0]);
    expect(out[1].hasThumbnail).toBe(true);
  });

  it("returns the same array when the batch is empty, and seeds from undefined", () => {
    const current = [entry(1)];
    expect(mergeFeedDeltaRows(current, [])).toBe(current);
    // An unfetched cache (undefined) merges into a fresh array — the
    // reconciliation refetch remains authoritative, but nothing crashes.
    const seeded = mergeFeedDeltaRows(undefined, [deltaRow(4)]);
    expect(seeded.map((e) => e.id)).toEqual([4]);
  });

  it("targets only the unfiltered manifest key by design", () => {
    // The key constant is what useIndexingStatus patches; filtered keys
    // are invalidated instead (a delta row's tag membership is unknown
    // client-side — writing it into a filtered view could show an image
    // the filter excludes). Locking the constant's shape here keeps the
    // patch/invalidate split honest against key refactors.
    expect(UNFILTERED_MANIFEST_KEY).toEqual(["feed-manifest", [], false, []]);
  });
});
