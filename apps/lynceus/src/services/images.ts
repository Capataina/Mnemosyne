import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ImageData, ImageItem, SimilarImageItem } from "../types";
import { perfInvoke } from "./perf";
import { formatApiError } from "./apiError";

// Placeholder dimensions used when an image hasn't been thumbnailed
// yet (NULL width/height in the DB). 1:1 square is the symmetric
// least-bad choice — reflows minimally to either landscape or portrait
// when the actual aspect arrives, AND looks visually intentional as a
// loading placeholder. Was 800×600 (4:3) historically; that produced
// the visible "tall vertical placeholders next to actual 16:9 photos"
// jank during Phase 11. Phase 12a settles on 1:1.
//
// Picking the same value for both means rendered tiles default to a
// square — the masonry packer treats this the same as any other
// aspect, so the tile takes column-width × column-width pixels.
const PLACEHOLDER_WIDTH = 400;
const PLACEHOLDER_HEIGHT = 400;

export async function fetchImages(
  filterTagIds: number[] = [],
  filterString: string = "",
  matchAllTags: boolean = false,
): Promise<ImageItem[]> {
  try {
    const imagesDB: ImageData[] = await perfInvoke("get_images", {
      filterTagIds,
      filterString,
      matchAllTags,
    });

    // Backend returns stable id-ASC order. The main feed re-orders via
    // useShuffledFeed (stable-key shuffle); search / similar results keep
    // this order. `hasThumbnail` gates feed eligibility — un-thumbnailed
    // rows are held back until their thumbnail lands (nothing pops in
    // blank), which is why the placeholder width/height still matter: a
    // row can be returned here before its real dimensions are known.
    const images: ImageItem[] = imagesDB.map((img) => {
      const url = convertFileSrc(img.path);
      const hasThumbnail = !!img.thumbnail_path;
      return {
        id: img.id,
        name: img.name,
        url,
        thumbnailUrl: hasThumbnail
          ? convertFileSrc(img.thumbnail_path as string)
          : undefined,
        hasThumbnail,
        width: img.width ?? PLACEHOLDER_WIDTH,
        height: img.height ?? PLACEHOLDER_HEIGHT,
        tags: img.tags,
        manualColSpan: img.manual_col_span ?? null,
      };
    });

    return images;
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

export async function assignTagToImage(
  imageId: number,
  tagId: number
): Promise<void> {
  try {
    await invoke("add_tag_to_image", {
      imageId,
      tagId,
    });
  } catch (error) {
    console.error(`Failed to assign tag:`, error);
    throw new Error(formatApiError(error));
  }
}

export async function removeTagFromImage(
  imageId: number,
  tagId: number
): Promise<void> {
  try {
    await invoke("remove_tag_from_image", {
      imageId,
      tagId,
    });
  } catch (error) {
    console.error(`Failed to remove tag:`, error);
    throw new Error(formatApiError(error));
  }
}

// Helper to construct thumbnail path from image ID.
// Backend stores thumbnails inside app_data_dir()/thumbnails/ but the
// canonical path comes back on the ImageData / SemanticSearchResult
// objects, so this function is only a fallback when the backend didn't
// supply one (very old DB rows pre-migration). The exact filename
// pattern still matches `thumb_{id}.jpg` as defined in
// src-tauri/src/thumbnail/generator.rs.
function getThumbnailPath(imageId: number): string {
  return `thumbnails/thumb_${imageId}.jpg`;
}

/**
 * Open a native folder picker and return the selected directory path.
 * Returns null if the user cancelled the dialog.
 */
export async function pickScanFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose your image folder",
  });
  // open() returns null on cancel, a string for single selection, or an
  // array for multiple — we forced multiple: false so it's string | null.
  if (typeof selected === "string") return selected;
  return null;
}

/**
 * Resolve an adaptive-resolution thumbnail for `imageId` at least
 * `targetPx` wide. The backend snaps `targetPx` up to the nearest bucket
 * ({480, 960, 1440, 2048}), returns the original image for targets beyond
 * the ladder (or when a bucket would meet/exceed the source width), and
 * generates-then-caches the bucket on demand. Returns an absolute path to
 * convert with `convertFileSrc`.
 */
export async function getThumbnail(
  imageId: number,
  targetPx: number,
): Promise<string> {
  return await invoke<string>("get_thumbnail", { id: imageId, targetPx });
}

export async function getScanRoot(): Promise<string | null> {
  try {
    return (await invoke<string | null>("get_scan_root")) ?? null;
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

/**
 * Persist the chosen scan root and wipe the existing image index.
 *
 * Pass 4a behaviour: the backend persists the path and clears image
 * rows. Re-indexing happens on the next app launch — Pass 5 will
 * trigger it live and emit progress events.
 */
export async function setScanRoot(path: string): Promise<void> {
  try {
    await invoke("set_scan_root", { path });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

/**
 * Persist a drag-resize. `colSpan` of `null` clears back to the
 * default single-column width. Resize is the one manual layout property
 * that survives a reshuffle (position is re-rolled per entry; size is
 * a per-image property).
 */
export async function setManualColSpan(
  imageId: number,
  colSpan: number | null,
): Promise<void> {
  try {
    await invoke("set_manual_col_span", { id: imageId, colSpan });
  } catch (error) {
    throw new Error(formatApiError(error));
  }
}

/**
 * Map a backend ImageSearchResult into the frontend's SimilarImageItem
 * shape. All three search commands (semantic, similar, tiered) now
 * return the same struct (audit consolidation), so this single helper
 * covers every call site.
 *
 * Backend supplies thumbnail_path/width/height when the image was
 * thumbnailed at indexing time. Legacy DB rows may lack them; fall
 * back to the canonical thumb_{id}.jpg path + default dimensions.
 */
function mapImageSearchResult(res: {
  id: number;
  path: string;
  score: number;
  thumbnail_path?: string;
  width?: number;
  height?: number;
}): SimilarImageItem {
  return {
    id: res.id,
    path: res.path,
    url: convertFileSrc(res.path),
    thumbnailUrl: res.thumbnail_path
      ? convertFileSrc(res.thumbnail_path)
      : convertFileSrc(getThumbnailPath(res.id)),
    width: res.width ?? PLACEHOLDER_WIDTH,
    height: res.height ?? PLACEHOLDER_HEIGHT,
    score: res.score,
    name: res.path.split(/[\\/]/).pop() ?? res.path,
  };
}

export async function fetchSimilarImages(
  imageId: number,
  topN: number = 8,
  encoderId?: string,
) {
  try {
    // Backend now returns the unified ImageSearchResult shape
    // (thumbnail_path/width/height included). Audit Performance
    // finding: dimensions used to be fetched frontend-side via
    // N parallel `getImageSize` DOM image loads — gone now,
    // a single IPC round-trip carries the full payload.
    //
    // encoderId picks which embedding family to query against
    // (CLIP / SigLIP-2 / DINOv2). Backend defaults to clip if
    // omitted, but in practice the frontend always passes the
    // user's chosen encoder from useUserPreferences.imageEncoder.
    const results: Parameters<typeof mapImageSearchResult>[0][] = await perfInvoke(
      "get_similar_images",
      { imageId, topN, encoderId }
    );
    return results.map(mapImageSearchResult);
  } catch (error) {
    console.error("[Frontend] Error in fetchSimilarImages:", error);
    throw new Error(formatApiError(error));
  }
}

export async function fetchTieredSimilarImages(imageId: number, encoderId?: string) {
  try {
    const results: Parameters<typeof mapImageSearchResult>[0][] = await perfInvoke(
      "get_tiered_similar_images",
      { imageId, encoderId }
    );
    return results.map(mapImageSearchResult);
  } catch (error) {
    console.error("[Frontend] Error in fetchTieredSimilarImages:", error);
    throw new Error(formatApiError(error));
  }
}

/**
 * Phase 5 — multi-encoder rank-fusion similarity.
 *
 * Calls every available encoder (CLIP + SigLIP-2 + DINOv2), gets each
 * encoder's top-K similarity ranking, and fuses them via Reciprocal
 * Rank Fusion. The fused output is naturally diverse (different
 * encoders disagree about what's "similar") AND naturally relevant
 * (consensus across encoders surfaces the genuinely best matches),
 * which makes the previous tiered-random-sampling redundant.
 *
 * `topN` is how many fused results to return. The backend defaults
 * `perEncoderTopK` to ~5×topN so each encoder contributes enough
 * candidates to the fusion pool.
 */
export async function fetchFusedSimilarImages(
  imageId: number,
  topN: number = 30,
  perEncoderTopK?: number
) {
  try {
    const results: Parameters<typeof mapImageSearchResult>[0][] = await perfInvoke(
      "get_fused_similar_images",
      { imageId, topN, perEncoderTopK }
    );
    return results.map(mapImageSearchResult);
  } catch (error) {
    console.error("[Frontend] Error in fetchFusedSimilarImages:", error);
    throw new Error(formatApiError(error));
  }
}

/**
 * Phase 11d — text-image multi-encoder rank-fusion.
 *
 * Calls every enabled text-supporting encoder (CLIP English + SigLIP-2;
 * DINOv2 is image-only and is implicitly skipped), encodes the query
 * through each, scores against each encoder's image cache, fuses the
 * resulting ranked lists via Reciprocal Rank Fusion. Mirrors the
 * image-image fusion path in `fetchFusedSimilarImages`.
 *
 * The list of "enabled" encoders comes from the backend
 * (settings.json::enabled_encoders) — toggled via the EncoderSection
 * Settings panel.
 *
 * `topN` defaults to 50 to match the previous semantic_search default.
 */
export async function fetchFusedSemanticSearch(
  query: string,
  topN: number = 50,
  perEncoderTopK?: number
): Promise<SimilarImageItem[]> {
  try {
    const results: Parameters<typeof mapImageSearchResult>[0][] = await perfInvoke(
      "get_fused_semantic_search",
      { query, topN, perEncoderTopK }
    );
    return results.map(mapImageSearchResult);
  } catch (error) {
    console.error("[Frontend] Error in fetchFusedSemanticSearch:", error);
    throw new Error(formatApiError(error));
  }
}

/**
 * LEGACY (Phase 4 single-encoder dispatch). Preserved as an internal
 * fallback so anything that imports `semanticSearch` directly keeps
 * working. New consumers should use `fetchFusedSemanticSearch` so they
 * benefit from text-side rank fusion across enabled text encoders.
 *
 * @param query - The search text
 * @param topN - Maximum number of results to return (default: 50)
 */
export async function semanticSearch(
  query: string,
  topN: number = 50,
  textEncoderId?: string
): Promise<SimilarImageItem[]> {
  try {
    const results: Parameters<typeof mapImageSearchResult>[0][] = await perfInvoke(
      "semantic_search",
      { query, topN, textEncoderId }
    );
    return results.map(mapImageSearchResult);
  } catch (error) {
    console.error("[Frontend] Error in semanticSearch:", error);
    throw new Error(formatApiError(error));
  }
}