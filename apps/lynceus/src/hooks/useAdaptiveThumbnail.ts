import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageItem } from "../types";
import { getThumbnail } from "../services/images";

/**
 * Frontend mirror of the backend bucket ladder. Kept in sync with
 * `THUMBNAIL_BUCKETS` in src-tauri/src/commands/images.rs. A tile picks
 * the smallest bucket whose width is >= its own rendered device-pixel
 * width; anything wider than the top bucket uses the original image.
 */
const THUMBNAIL_BUCKETS = [480, 960, 1440, 2048] as const;

/** The bucket that covers `targetPx`, or `null` for "use the original". */
function bucketFor(targetPx: number): number | null {
  return THUMBNAIL_BUCKETS.find((b) => b >= targetPx) ?? null;
}

/**
 * Pick the right-resolution thumbnail for a tile given how wide it's
 * actually being rendered.
 *
 * The base thumbnail (`item.thumbnailUrl`, the 480 bucket) is generated
 * at index time and covers a 1-column tile on a retina display with zero
 * IPC. Only when a tile is stretched past that — a 2/3-column resize —
 * does this request a larger bucket, which the backend generates from the
 * original and caches. Crucially it keys on the *discrete bucket*, not the
 * raw pixel width, so a smooth resize drag only refetches when it crosses
 * a bucket boundary (base 480 stays on screen, upscaled, until the sharper
 * bucket arrives — the "keep current, sharpen on release" behaviour).
 *
 * @param item          the image
 * @param renderedWidth the tile's current CSS width in px (0 to skip)
 */
export function useAdaptiveThumbnail(
  item: ImageItem,
  renderedWidth: number,
): string | undefined {
  const base = item.thumbnailUrl ?? item.url;

  const dpr =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const bucket =
    renderedWidth > 0 ? bucketFor(Math.ceil(renderedWidth * dpr)) : 480;

  const [src, setSrc] = useState<string | undefined>(base);

  useEffect(() => {
    // Beyond the ladder → the backend returns the original anyway, but we
    // can go straight there without a round-trip.
    if (bucket === null) {
      setSrc(item.url);
      return;
    }
    // The base thumbnail already IS the 480 bucket and is loaded — no IPC.
    if (bucket <= THUMBNAIL_BUCKETS[0] || !item.hasThumbnail) {
      setSrc(base);
      return;
    }
    // A larger bucket: fetch on demand, keeping the base on screen until
    // it arrives so there's no blank flash mid-resize.
    let cancelled = false;
    setSrc(base);
    getThumbnail(item.id, bucket)
      .then((path) => {
        if (!cancelled) setSrc(convertFileSrc(path));
      })
      .catch(() => {
        if (!cancelled) setSrc(base);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.url, item.hasThumbnail, base, bucket]);

  return src;
}
