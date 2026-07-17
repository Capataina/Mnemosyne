import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAdaptiveThumbnail } from "./useAdaptiveThumbnail";
import type { ImageItem } from "../types";

/**
 * Tests for the adaptive-thumbnail resolution cache (T1-5).
 *
 * The hook picks a bucket from the tile's rendered device-pixel width and,
 * for buckets above the base 480, resolves the path via a react-query
 * `["thumbnail", id, bucket]` query. The behaviour to protect:
 *   - the no-IPC fast paths (base 480, no thumbnail, beyond the ladder),
 *   - base-first display that swaps to the sharp bucket on resolve,
 *   - a CACHED bucket resolving with no base flash (the whole point of the
 *     cache — a scrolled-back tile renders sharp immediately),
 *   - one query per (id, bucket): a remount doesn't re-fire the IPC.
 */

const mockGetThumbnail = vi.fn();

vi.mock("../services/images", () => ({
  getThumbnail: (id: number, targetPx: number) =>
    mockGetThumbnail(id, targetPx),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://localhost/${path}`,
}));

function makeItem(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 1,
    url: "tauri://localhost/original.jpg",
    thumbnailUrl: "tauri://localhost/thumb-480.jpg",
    hasThumbnail: true,
    width: 4000,
    height: 3000,
    name: "photo.jpg",
    tags: [],
    ...overrides,
  };
}

// A fresh QueryClient per test so cache state doesn't leak between cases.
// A shared one within a test is how we prove cross-remount caching.
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

beforeEach(() => {
  mockGetThumbnail.mockReset();
  // dpr is 1 under happy-dom, so renderedWidth maps straight to the bucket.
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
});

describe("useAdaptiveThumbnail", () => {
  it("returns the base thumbnail for a base-bucket tile with no IPC", () => {
    const { wrapper } = makeWrapper();
    const item = makeItem();
    const { result } = renderHook(() => useAdaptiveThumbnail(item, 200), {
      wrapper,
    });
    expect(result.current).toBe(item.thumbnailUrl);
    expect(mockGetThumbnail).not.toHaveBeenCalled();
  });

  it("returns the base for renderedWidth 0 (unmeasured tile)", () => {
    const { wrapper } = makeWrapper();
    const item = makeItem();
    const { result } = renderHook(() => useAdaptiveThumbnail(item, 0), {
      wrapper,
    });
    expect(result.current).toBe(item.thumbnailUrl);
    expect(mockGetThumbnail).not.toHaveBeenCalled();
  });

  it("returns the base (no IPC) when the image has no generated thumbnail", () => {
    const { wrapper } = makeWrapper();
    // Wide enough to want a larger bucket, but nothing to sharpen to.
    const item = makeItem({ hasThumbnail: false, thumbnailUrl: undefined });
    const { result } = renderHook(() => useAdaptiveThumbnail(item, 960), {
      wrapper,
    });
    expect(result.current).toBe(item.url);
    expect(mockGetThumbnail).not.toHaveBeenCalled();
  });

  it("returns the original (no IPC) beyond the top bucket", () => {
    const { wrapper } = makeWrapper();
    const item = makeItem();
    // 3000 dp > 2048 → bucketFor returns null → original.
    const { result } = renderHook(() => useAdaptiveThumbnail(item, 3000), {
      wrapper,
    });
    expect(result.current).toBe(item.url);
    expect(mockGetThumbnail).not.toHaveBeenCalled();
  });

  it("shows base first, then swaps to the fetched larger bucket", async () => {
    const { wrapper } = makeWrapper();
    const item = makeItem();
    mockGetThumbnail.mockResolvedValue("/cache/1-960.jpg");
    const { result } = renderHook(() => useAdaptiveThumbnail(item, 960), {
      wrapper,
    });
    // Base is on screen while the query is in flight.
    expect(result.current).toBe(item.thumbnailUrl);
    await waitFor(() =>
      expect(result.current).toBe("tauri://localhost//cache/1-960.jpg"),
    );
    expect(mockGetThumbnail).toHaveBeenCalledWith(1, 960);
  });

  it("keeps the base when the fetch fails (matches the old catch fallback)", async () => {
    const { wrapper } = makeWrapper();
    const item = makeItem();
    mockGetThumbnail.mockRejectedValue(new Error("no bucket"));
    const { result } = renderHook(() => useAdaptiveThumbnail(item, 960), {
      wrapper,
    });
    await waitFor(() => expect(mockGetThumbnail).toHaveBeenCalled());
    expect(result.current).toBe(item.thumbnailUrl);
  });

  it("serves a cached bucket immediately on remount — no base flash, no second IPC", async () => {
    // Shared client across both mounts is what proves the cache.
    const { wrapper } = makeWrapper();
    const item = makeItem();
    mockGetThumbnail.mockResolvedValue("/cache/1-960.jpg");

    const first = renderHook(() => useAdaptiveThumbnail(item, 960), {
      wrapper,
    });
    await waitFor(() =>
      expect(first.result.current).toBe("tauri://localhost//cache/1-960.jpg"),
    );
    first.unmount();

    // Remount (same client): the sharp bucket is present on the first render.
    const second = renderHook(() => useAdaptiveThumbnail(item, 960), {
      wrapper,
    });
    expect(second.result.current).toBe("tauri://localhost//cache/1-960.jpg");
    expect(mockGetThumbnail).toHaveBeenCalledTimes(1);
  });
});
