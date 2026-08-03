import { useQuery } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FeedItem } from "../types";
import { getThumbnail } from "../services/images";

/**
 * Frontend mirror of the backend bucket ladder. Kept in sync with
 * `THUMBNAIL_BUCKETS` in src-tauri/src/commands/images.rs. A tile picks
 * the smallest bucket whose width is >= its own rendered device-pixel
 * width; anything wider than the top bucket uses the original image.
 */
const THUMBNAIL_BUCKETS = [480, 960, 1440, 2048] as const;

/**
 * How long a resolved bucket path lingers in the react-query cache after the
 * last tile using it unmounts. The cached value is a short path string, so
 * memory is negligible; the cap simply bounds the idle working set to what's
 * been scrolled through recently. Active (mounted) tiles are never evicted —
 * `gcTime` only applies to queries with no observers. Five minutes keeps a
 * scroll-back within a session instant while letting long-gone tiles evict.
 */
const THUMBNAIL_GC_MS = 5 * 60 * 1000;

/**
 * How many `get_thumbnail` IPC calls may be in flight at once. `get_thumbnail`
 * is a deliberately SYNC Tauri command (src-tauri/src/commands/CLAUDE.md's
 * "attribute-less commands run on the main thread" trap) — when the bucket
 * isn't cached yet it decodes the original, resizes and re-encodes on that
 * same thread. A column-count change (e.g. auto -> 1/2) widens every
 * currently-mounted tile at once (masonry keeps the pre-repack visible set
 * force-mounted across a non-scroll reflow, hooks/CLAUDE.md), so dozens of
 * tiles can simultaneously want a larger bucket. Firing them unthrottled
 * queues that many synchronous decodes back-to-back with no yield back to
 * the webview between them — the same class of freeze
 * `Masonry.tsx`'s PREFETCH_PREWARM_CAP already exists to prevent for the
 * similar-search fan-out (133 concurrent searches logged there). Gating
 * admission here staggers dispatch one small batch at a time instead of a
 * blocking flood.
 */
const MAX_CONCURRENT_BUCKET_REQUESTS = 4;
let activeBucketRequests = 0;
const bucketRequestQueue: Array<() => void> = [];

/** Run `task` once fewer than `MAX_CONCURRENT_BUCKET_REQUESTS` are in
 * flight; otherwise queue it FIFO. `signal` lets a query TanStack Query has
 * already abandoned (component unmounted, bucket recalculated) drop out of
 * the queue instead of spending a turn on wasted work. */
function runThumbnailRequest<T>(
  task: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeBucketRequests++;
      task().then(resolve, reject).finally(() => {
        activeBucketRequests--;
        const next = bucketRequestQueue.shift();
        next?.();
      });
    };

    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    if (activeBucketRequests < MAX_CONCURRENT_BUCKET_REQUESTS) {
      run();
      return;
    }

    const queued = () => run();
    bucketRequestQueue.push(queued);
    signal?.addEventListener(
      "abort",
      () => {
        const idx = bucketRequestQueue.indexOf(queued);
        if (idx !== -1) {
          bucketRequestQueue.splice(idx, 1);
          reject(signal.reason);
        }
      },
      { once: true },
    );
  });
}

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
  item: FeedItem,
  renderedWidth: number,
): string | undefined {
  const base = item.thumbnailUrl ?? item.url;

  const dpr =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const bucket =
    renderedWidth > 0 ? bucketFor(Math.ceil(renderedWidth * dpr)) : 480;

  // Only buckets larger than the base 480 (already loaded as `base`) need an
  // IPC round-trip. `null` (beyond the ladder) and images without a
  // pre-generated thumbnail resolve without a fetch below.
  const needsLargerBucket =
    bucket !== null && bucket > THUMBNAIL_BUCKETS[0] && item.hasThumbnail;

  // Cache resolution per (id, bucket) across remounts with in-flight dedup.
  // `staleTime: Infinity` — a bucket file is immutable for a given id until
  // re-index (which invalidates the `["thumbnail"]` prefix; see WIDND). A
  // cached result resolves synchronously on mount, so a scrolled-back tile
  // renders sharp with no base flash.
  const { data } = useQuery({
    queryKey: ["thumbnail", item.id, bucket],
    queryFn: ({ signal }) =>
      runThumbnailRequest(
        () => getThumbnail(item.id, bucket as number).then(convertFileSrc),
        signal,
      ),
    enabled: needsLargerBucket,
    staleTime: Infinity,
    gcTime: THUMBNAIL_GC_MS,
  });

  // Beyond the ladder → the original, no round-trip.
  if (bucket === null) return item.url;
  // The base thumbnail already IS the 480 bucket (or there's no thumbnail to
  // sharpen) — show it directly, no IPC.
  if (!needsLargerBucket) return base;
  // Larger bucket: base stays on screen until the query resolves (no blank
  // flash mid-resize); a cached/failed query keeps `base` too (`data`
  // undefined on error mirrors the old catch→base fallback).
  return data ?? base;
}
