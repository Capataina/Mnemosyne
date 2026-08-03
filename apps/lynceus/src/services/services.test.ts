import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the IPC service layer.
 *
 * The real `invoke` function calls into the Rust backend. Under
 * vitest there's no Rust backend running, so we mock
 * @tauri-apps/api/core wholesale and inject the desired return value
 * (or rejection) per test. This catches regressions in:
 *   - argument shape passed to invoke
 *   - response handling and shape mapping
 *   - error propagation
 */

const mockInvoke = vi.fn();
const mockOpen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: (path: string) => `tauri://localhost/${path}`,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mockOpen,
}));

beforeEach(() => {
  mockInvoke.mockReset();
  mockOpen.mockReset();
});

describe("services/roots", () => {
  it("listRoots passes through the backend response", async () => {
    const { listRoots } = await import("./roots");
    mockInvoke.mockResolvedValueOnce([
      { id: 1, path: "/a", enabled: true, added_at: 100 },
      { id: 2, path: "/b", enabled: false, added_at: 200 },
    ]);
    const roots = await listRoots();
    expect(mockInvoke).toHaveBeenCalledWith("list_roots");
    expect(roots).toHaveLength(2);
    expect(roots[0].path).toBe("/a");
  });

  it("addRoot sends the path argument and returns the new root", async () => {
    const { addRoot } = await import("./roots");
    mockInvoke.mockResolvedValueOnce({
      id: 3,
      path: "/new",
      enabled: true,
      added_at: 300,
    });
    const root = await addRoot("/new");
    expect(mockInvoke).toHaveBeenCalledWith("add_root", { path: "/new" });
    expect(root.id).toBe(3);
  });

  it("removeRoot sends only the id argument", async () => {
    const { removeRoot } = await import("./roots");
    mockInvoke.mockResolvedValueOnce(undefined);
    await removeRoot(7);
    expect(mockInvoke).toHaveBeenCalledWith("remove_root", { id: 7 });
  });

  it("setRootEnabled sends both id and enabled", async () => {
    const { setRootEnabled } = await import("./roots");
    mockInvoke.mockResolvedValueOnce(undefined);
    await setRootEnabled(5, false);
    expect(mockInvoke).toHaveBeenCalledWith("set_root_enabled", {
      id: 5,
      enabled: false,
    });
  });

  it("listRoots wraps backend errors in an Error with context", async () => {
    const { listRoots } = await import("./roots");
    mockInvoke.mockRejectedValueOnce("backend exploded");
    await expect(listRoots()).rejects.toThrow(/Failed to list roots/);
  });
});

describe("services/notes", () => {
  it("getImageNotes passes the imageId arg and returns the string", async () => {
    const { getImageNotes } = await import("./notes");
    mockInvoke.mockResolvedValueOnce("a personal note");
    const notes = await getImageNotes(42);
    expect(mockInvoke).toHaveBeenCalledWith("get_image_notes", {
      imageId: 42,
    });
    expect(notes).toBe("a personal note");
  });

  it("setImageNotes sends both imageId and notes", async () => {
    const { setImageNotes } = await import("./notes");
    mockInvoke.mockResolvedValueOnce(undefined);
    await setImageNotes(42, "updated");
    expect(mockInvoke).toHaveBeenCalledWith("set_image_notes", {
      imageId: 42,
      notes: "updated",
    });
  });

  it("setImageNotes wraps errors", async () => {
    const { setImageNotes } = await import("./notes");
    mockInvoke.mockRejectedValueOnce("DB locked");
    await expect(setImageNotes(1, "x")).rejects.toThrow(/Failed to save notes/);
  });
});

describe("services/images", () => {
  it("fetchFeedManifest threads matchAllTags through to invoke", async () => {
    const { fetchFeedManifest } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFeedManifest([1, 2], true);
    expect(mockInvoke).toHaveBeenCalledWith("get_feed_manifest", {
      filterTagIds: [1, 2],
      matchAllTags: true,
      excludeTagIds: [],
    });
  });

  it("fetchFeedManifest defaults matchAllTags to false (OR semantic)", async () => {
    const { fetchFeedManifest } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFeedManifest([1]);
    expect(mockInvoke).toHaveBeenCalledWith("get_feed_manifest", {
      filterTagIds: [1],
      matchAllTags: false,
      excludeTagIds: [],
    });
  });

  it("fetchFeedManifest threads excludeTagIds through to invoke", async () => {
    const { fetchFeedManifest } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    // Include tag 1, exclude tags 2 and 3 — the library drawer's
    // "must have" / "must not have" split reaches the backend intact.
    await fetchFeedManifest([1], false, [2, 3]);
    expect(mockInvoke).toHaveBeenCalledWith("get_feed_manifest", {
      filterTagIds: [1],
      matchAllTags: false,
      excludeTagIds: [2, 3],
    });
  });

  it("fetchFeedManifest maps compact rows (thumbnail URL, span, real dims)", async () => {
    const { fetchFeedManifest } = await import("./images");
    mockInvoke.mockResolvedValueOnce([
      {
        id: 1,
        name: "photo.jpg",
        thumbnail_path: "/tmp/thumb.jpg",
        width: 800,
        height: 600,
        manual_col_span: 2,
      },
    ]);
    const items = await fetchFeedManifest();
    expect(items).toHaveLength(1);
    expect(items[0].thumbnailUrl).toContain("thumb.jpg");
    expect(items[0].hasThumbnail).toBe(true);
    expect(items[0].width).toBe(800);
    expect(items[0].height).toBe(600);
    expect(items[0].manualColSpan).toBe(2);
    // Compact row carries no original path — no full-res URL grid-side.
    expect(items[0].url).toBeUndefined();
  });

  it("fetchFeedManifest gates un-thumbnailed rows and applies placeholder dims", async () => {
    // The feed is thumbnail-gated on `hasThumbnail`, so an un-thumbnailed
    // row must report false and carry no thumbnail URL (it's held back
    // from the grid until its thumbnail lands, then pops in). Its NULL
    // dimensions become the 400×400 square placeholder.
    const { fetchFeedManifest } = await import("./images");
    mockInvoke.mockResolvedValueOnce([
      { id: 1, name: "photo.jpg", width: null, height: null },
    ]);
    const items = await fetchFeedManifest();
    expect(items[0].hasThumbnail).toBe(false);
    expect(items[0].thumbnailUrl).toBeUndefined();
    expect(items[0].width).toBe(400);
    expect(items[0].height).toBe(400);
  });

  it("sanitises literal-zero manifest dimensions before they reach masonry", async () => {
    const { fetchFeedManifest } = await import("./images");
    mockInvoke.mockResolvedValueOnce([
      {
        id: 1,
        name: "broken-metadata.jpg",
        thumbnail_path: "/tmp/thumb.jpg",
        width: 0,
        height: 0,
      },
    ]);
    const items = await fetchFeedManifest();
    expect(items[0].width).toBe(400);
    expect(items[0].height).toBe(400);
  });

  it("fetchImageDetails hydrates a batch in one invoke and maps full detail", async () => {
    const { fetchImageDetails } = await import("./images");
    mockInvoke.mockResolvedValueOnce([
      {
        id: 7,
        path: "/tmp/photo.jpg",
        name: "photo.jpg",
        thumbnail_path: "/tmp/thumb.jpg",
        width: 800,
        height: 600,
        tags: [{ id: 1, name: "t", color: "#fff" }],
        manual_col_span: 2,
      },
    ]);
    const items = await fetchImageDetails([7, 8]);
    expect(mockInvoke).toHaveBeenCalledWith("get_image_details", {
      ids: [7, 8],
    });
    expect(items).toHaveLength(1);
    expect(items[0].url).toContain("photo.jpg");
    expect(items[0].thumbnailUrl).toContain("thumb.jpg");
    expect(items[0].tags).toHaveLength(1);
    expect(items[0].manualColSpan).toBe(2);
  });

  it("fetchImageDetails short-circuits an empty id batch without an IPC call", async () => {
    const { fetchImageDetails } = await import("./images");
    const items = await fetchImageDetails([]);
    expect(items).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "get_image_details",
      expect.anything(),
    );
  });

  it("pickScanFolder returns the selected path", async () => {
    const { pickScanFolder } = await import("./images");
    mockOpen.mockResolvedValueOnce("/picked/path");
    const result = await pickScanFolder();
    expect(result).toBe("/picked/path");
    expect(mockOpen).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Choose your image folder",
    });
  });

  it("pickScanFolder returns null when user cancels", async () => {
    const { pickScanFolder } = await import("./images");
    mockOpen.mockResolvedValueOnce(null);
    const result = await pickScanFolder();
    expect(result).toBeNull();
  });
});

describe("services/images (fused semantic search)", () => {
  it("fetchFusedSemanticSearch calls get_fused_semantic_search with query + topN + perEncoderTopK", async () => {
    // Phase 11d — text-image RRF mirrors the image-image fusion.
    // Backend reads the enabled-encoder list from settings.json and
    // fuses across every text-supporting encoder in it.
    const { fetchFusedSemanticSearch } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFusedSemanticSearch("cyberpunk", 50);
    expect(mockInvoke).toHaveBeenCalledWith("get_fused_semantic_search", {
      query: "cyberpunk",
      topN: 50,
      perEncoderTopK: undefined,
    });
  });

  it("fetchFusedSemanticSearch defaults topN to 50", async () => {
    const { fetchFusedSemanticSearch } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFusedSemanticSearch("street");
    expect(mockInvoke).toHaveBeenCalledWith("get_fused_semantic_search", {
      query: "street",
      topN: 50,
      perEncoderTopK: undefined,
    });
  });

  it("fetchFusedSemanticSearch forwards perEncoderTopK when set", async () => {
    const { fetchFusedSemanticSearch } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFusedSemanticSearch("street", 50, 200);
    expect(mockInvoke).toHaveBeenCalledWith("get_fused_semantic_search", {
      query: "street",
      topN: 50,
      perEncoderTopK: 200,
    });
  });
});

describe("services/images (fused similar images)", () => {
  it("fetchFusedSimilarImages calls get_fused_similar_images with imageId + topN + perEncoderTopK", async () => {
    // Phase 5 — replaces the tiered random-sampling system. Backend
    // calls all three encoders (CLIP, SigLIP-2, DINOv2) and fuses
    // the rankings via Reciprocal Rank Fusion.
    const { fetchFusedSimilarImages } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFusedSimilarImages(42, 30);
    expect(mockInvoke).toHaveBeenCalledWith("get_fused_similar_images", {
      imageId: 42,
      topN: 30,
      perEncoderTopK: undefined,
    });
  });

  it("fetchFusedSimilarImages defaults topN to 30 when not supplied", async () => {
    const { fetchFusedSimilarImages } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFusedSimilarImages(7);
    expect(mockInvoke).toHaveBeenCalledWith("get_fused_similar_images", {
      imageId: 7,
      topN: 30,
      perEncoderTopK: undefined,
    });
  });

  it("fetchFusedSimilarImages forwards perEncoderTopK when set", async () => {
    const { fetchFusedSimilarImages } = await import("./images");
    mockInvoke.mockResolvedValueOnce([]);
    await fetchFusedSimilarImages(7, 30, 200);
    expect(mockInvoke).toHaveBeenCalledWith("get_fused_similar_images", {
      imageId: 7,
      topN: 30,
      perEncoderTopK: 200,
    });
  });
});

describe("services/tags", () => {
  it("createTag uses default colour when none provided", async () => {
    const { createTag } = await import("./tags");
    mockInvoke.mockResolvedValueOnce({
      id: 1,
      name: "test",
      color: "#3B82F6",
    });
    await createTag("test");
    expect(mockInvoke).toHaveBeenCalledWith("create_tag", {
      name: "test",
      color: "#3B82F6",
    });
  });

  it("createTag respects a custom colour", async () => {
    const { createTag } = await import("./tags");
    mockInvoke.mockResolvedValueOnce({ id: 1, name: "x", color: "#ff0000" });
    await createTag("x", "#ff0000");
    expect(mockInvoke).toHaveBeenCalledWith("create_tag", {
      name: "x",
      color: "#ff0000",
    });
  });

  it("deleteTag passes only the id", async () => {
    const { deleteTag } = await import("./tags");
    mockInvoke.mockResolvedValueOnce(undefined);
    await deleteTag(99);
    expect(mockInvoke).toHaveBeenCalledWith("delete_tag", { tagId: 99 });
  });

  it("fetchTags returns the backend list", async () => {
    const { fetchTags } = await import("./tags");
    mockInvoke.mockResolvedValueOnce([
      { id: 1, name: "a", color: "#fff" },
      { id: 2, name: "b", color: "#000" },
    ]);
    const tags = await fetchTags();
    expect(tags).toHaveLength(2);
  });
});
