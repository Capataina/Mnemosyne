import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShuffledFeed } from "./useShuffledFeed";
import type { ImageItem } from "../types";

function tile(id: number, hasThumbnail = true): ImageItem {
  return {
    id,
    url: `u${id}`,
    hasThumbnail,
    width: 100,
    height: 100,
    name: `t${id}`,
    tags: [],
  };
}

const items = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => tile(id));
const ids = (arr: ImageItem[]) => arr.map((i) => i.id);

describe("useShuffledFeed", () => {
  it("is deterministic for a given seed and loses no images", () => {
    const a = ids(renderHook(() => useShuffledFeed(items, 42)).result.current);
    const b = ids(renderHook(() => useShuffledFeed(items, 42)).result.current);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps existing tiles in place when a new image pops in", () => {
    const seed = 7;
    const before = ids(
      renderHook(() => useShuffledFeed(items, seed)).result.current,
    );
    const after = ids(
      renderHook(() => useShuffledFeed([...items, tile(99)], seed)).result
        .current,
    );
    // The original ids keep their relative order; 99 just slots into a gap.
    // This is the whole point of the stable-key model (no reshuffle flicker).
    expect(after.filter((id) => id !== 99)).toEqual(before);
    expect(after).toContain(99);
  });

  it("re-seeding reshuffles the order", () => {
    const a = ids(renderHook(() => useShuffledFeed(items, 1)).result.current);
    const b = ids(renderHook(() => useShuffledFeed(items, 2)).result.current);
    expect(a).not.toEqual(b);
  });

  it("gates out images that have no thumbnail yet", () => {
    const mixed = [tile(1, true), tile(2, false), tile(3, true)];
    const out = ids(renderHook(() => useShuffledFeed(mixed, 5)).result.current);
    expect(out).not.toContain(2);
    expect([...out].sort((x, y) => x - y)).toEqual([1, 3]);
  });

  it("applies an in-session reorder ahead of the shuffle", () => {
    const out = ids(
      renderHook(() => useShuffledFeed(items, 5, [4, 2, 7])).result.current,
    );
    expect(out.slice(0, 3)).toEqual([4, 2, 7]);
    // The rest still follow, none lost.
    expect([...out].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
