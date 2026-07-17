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

  // ------------------------------------------------------------------
  // T3-1 incremental fast path. Same rendered hook, changing input
  // identity (how a feed-delta cache patch arrives) — the incremental
  // result must be indistinguishable from a cold full rebuild.
  // ------------------------------------------------------------------

  it("incremental newcomer insertion is identical to a full rebuild", () => {
    const seed = 1337;
    const { result, rerender } = renderHook(
      ({ list }: { list: ImageItem[] }) => useShuffledFeed(list, seed),
      { initialProps: { list: items } },
    );
    const before = ids(result.current);

    // Delta arrives: two newcomers pop in (fresh array identity, as a
    // react-query setQueryData merge produces).
    const grown = [...items, tile(99), tile(50)];
    rerender({ list: grown });
    const incremental = ids(result.current);

    // A cold mount over the same input is the ground truth.
    const rebuilt = ids(
      renderHook(() => useShuffledFeed(grown, seed)).result.current,
    );
    expect(incremental).toEqual(rebuilt);
    // And the pop-in invariant holds through the fast path too.
    expect(incremental.filter((id) => id !== 99 && id !== 50)).toEqual(before);
  });

  it("incremental patch swaps the object in place without moving anything", () => {
    const seed = 21;
    const { result, rerender } = renderHook(
      ({ list }: { list: ImageItem[] }) => useShuffledFeed(list, seed),
      { initialProps: { list: items } },
    );
    const before = result.current;

    // Patch tile 3 (same id, new object — a delta updating dimensions);
    // everything else keeps identity, as the merge guarantees.
    const patched3 = { ...tile(3), width: 999 };
    const patchedList = items.map((i) => (i.id === 3 ? patched3 : i));
    rerender({ list: patchedList });
    const after = result.current;

    expect(ids(after)).toEqual(ids(before));
    expect(after.find((i) => i.id === 3)).toBe(patched3);
    // Untouched entries flow through by identity (masonry memo contract).
    for (const item of after) {
      if (item.id !== 3) expect(item).toBe(before[ids(before).indexOf(item.id)]);
    }
  });

  it("incremental thumbnail-gate flip inserts exactly like a rebuild", () => {
    const seed = 8;
    const gated = [tile(1), tile(2, false), tile(3)];
    const { result, rerender } = renderHook(
      ({ list }: { list: ImageItem[] }) => useShuffledFeed(list, seed),
      { initialProps: { list: gated } },
    );
    expect(ids(result.current)).not.toContain(2);

    // Tile 2's thumbnail lands (hasThumbnail flips true) — it must pop
    // in exactly where a cold rebuild would place it.
    const ungated = [tile(1), tile(2, true), tile(3)];
    rerender({ list: ungated });
    const rebuilt = ids(
      renderHook(() => useShuffledFeed(ungated, seed)).result.current,
    );
    expect(ids(result.current)).toEqual(rebuilt);
  });

  it("incremental removal drops the row and keeps the rest in place", () => {
    const seed = 4;
    const { result, rerender } = renderHook(
      ({ list }: { list: ImageItem[] }) => useShuffledFeed(list, seed),
      { initialProps: { list: items } },
    );
    const before = ids(result.current);

    const shrunk = items.filter((i) => i.id !== 5);
    rerender({ list: shrunk });
    expect(ids(result.current)).toEqual(before.filter((id) => id !== 5));
  });

  it("returns the previous array identity when a new input changes nothing", () => {
    const seed = 3;
    const { result, rerender } = renderHook(
      ({ list }: { list: ImageItem[] }) => useShuffledFeed(list, seed),
      { initialProps: { list: items } },
    );
    const before = result.current;

    // Same entries, fresh array wrapper — e.g. an idempotent cache write.
    rerender({ list: [...items] });
    expect(result.current).toBe(before);
  });

  it("a seed change after incremental updates still rebuilds from scratch", () => {
    const { result, rerender } = renderHook(
      ({ list, seed }: { list: ImageItem[]; seed: number }) =>
        useShuffledFeed(list, seed),
      { initialProps: { list: items, seed: 1 } },
    );
    rerender({ list: [...items, tile(42)], seed: 1 }); // prime the cache
    rerender({ list: [...items, tile(42)], seed: 2 }); // reshuffle
    const rebuilt = ids(
      renderHook(() => useShuffledFeed([...items, tile(42)], 2)).result
        .current,
    );
    expect(ids(result.current)).toEqual(rebuilt);
  });
});
