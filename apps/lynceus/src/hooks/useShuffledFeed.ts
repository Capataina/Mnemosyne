import { useMemo } from "react";
import type { ImageItem } from "../types";

/**
 * Deterministic per-image sort key in [0, 1) derived from (id, seed).
 *
 * This is the heart of the "shuffle position, keep sizes, pop-in" model.
 * Because the key is a pure function of the image id and the current
 * seed, an image's position depends ONLY on its own id — never on how
 * many other images are in the list. So when new images finish
 * thumbnailing mid-session and enter the feed, every existing tile keeps
 * its exact key (and therefore its exact slot) while each newcomer drops
 * into whatever gap its own key lands in. That's the difference from a
 * plain Fisher-Yates over the whole array, which would re-place every
 * existing tile the moment the array length changed — the "entire app
 * refreshes" flicker that got shuffle demoted on 2026-04-26.
 *
 * A fresh shuffle is a fresh seed: bump the seed and every key recomputes.
 */
function shuffleKey(id: number, seed: number): number {
  let h = Math.imul(id ^ seed, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae3d) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The single ordering model for the main feed: shuffle by stable key,
 * gated to images whose thumbnail exists so nothing pops in blank.
 *
 * @param images   the raw catalogue (backend order); undefined while loading
 * @param seed     re-rolled on each feed "entry" (launch, back-from-search)
 * @param sessionOrder  optional in-session manual reorder (drag-to-reorder).
 *                 A full id ordering; ids present here render in that order,
 *                 anything not listed (e.g. an image that popped in after the
 *                 drag) falls back to its shuffle key and is appended. Cleared
 *                 by the caller whenever the seed changes, so a reshuffle wipes
 *                 the manual nudge — matching "reorder is a live in-session
 *                 nudge, not persisted".
 */
export function useShuffledFeed(
  images: ImageItem[] | undefined,
  seed: number,
  sessionOrder?: number[] | null,
): ImageItem[] {
  return useMemo(() => {
    if (!images || images.length === 0) return [];
    const ready = images.filter((img) => img.hasThumbnail);

    if (sessionOrder && sessionOrder.length > 0) {
      const rank = new Map(sessionOrder.map((id, i) => [id, i]));
      // Listed ids sort by their manual rank; unlisted newcomers sort
      // after them by shuffle key so they still pop in somewhere stable.
      return ready
        .map((img) => ({
          img,
          listed: rank.has(img.id),
          order: rank.get(img.id) ?? shuffleKey(img.id, seed),
        }))
        .sort((a, b) => {
          if (a.listed !== b.listed) return a.listed ? -1 : 1;
          return a.order - b.order || a.img.id - b.img.id;
        })
        .map((x) => x.img);
    }

    return ready
      .map((img) => ({ img, key: shuffleKey(img.id, seed) }))
      .sort((a, b) => a.key - b.key || a.img.id - b.img.id)
      .map((x) => x.img);
  }, [images, seed, sessionOrder]);
}

/** A fresh, non-zero shuffle seed. */
export function newShuffleSeed(): number {
  return (Math.floor(Math.random() * 0x7fffffff) || 1) >>> 0;
}
