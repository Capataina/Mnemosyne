import { useMemo, useRef } from "react";

/** The minimum an entry needs to be shuffled: identity + the pop-in
 *  gate. Both the compact manifest's `FeedItem` and a full `ImageItem`
 *  satisfy this, so the hook serves the feed and any legacy caller
 *  unchanged (T3-1 made it generic; behaviour is identical). */
type Shuffleable = { id: number; hasThumbnail: boolean };

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

/** Cache of the last computed feed, keyed by the inputs that would force
 *  a full rebuild. Powers the incremental fast path below. */
interface FeedCache<T extends Shuffleable> {
  seed: number;
  /** Input identity the cached output was computed from. */
  images: T[];
  /** The cached output (ready items in (key, id) order). */
  ready: T[];
  /** Ready-item ids as of the cached output, for newcomer detection. */
  ids: Set<number>;
}

/**
 * The single ordering model for the main feed: shuffle by stable key,
 * gated to images whose thumbnail exists so nothing pops in blank.
 *
 * T3-1 addition — the incremental fast path (the surviving half of the
 * rejected #4 "incremental shuffle" idea): when only the input array
 * changes (a feed-delta patched/inserted rows) while `seed` and
 * `sessionOrder` are unchanged, the previous output is reused —
 * patched rows are swapped in place (their position depends only on
 * id + seed, so it cannot move), removed ids are dropped, and
 * newcomers are merge-inserted at their (key, id) position. The result
 * is provably identical to a full rebuild (the comparator is a strict
 * ordering the cached array already satisfies — equivalence is
 * test-locked), it just skips the O(N log N) sort and, when nothing
 * actually changed, returns the previous array identity so downstream
 * memos (masonry pack) hold. Seed changes, session reorders, and cache
 * misses take the full rebuild exactly as before.
 *
 * @param images   the raw catalogue/manifest (backend id order);
 *                 undefined while loading
 * @param seed     re-rolled on each feed "entry" (launch, back-from-search)
 * @param sessionOrder  optional in-session manual reorder (drag-to-reorder).
 *                 A full id ordering; ids present here render in that order,
 *                 anything not listed (e.g. an image that popped in after the
 *                 drag) falls back to its shuffle key and is appended. Cleared
 *                 by the caller whenever the seed changes, so a reshuffle wipes
 *                 the manual nudge — matching "reorder is a live in-session
 *                 nudge, not persisted".
 */
export function useShuffledFeed<T extends Shuffleable>(
  images: T[] | undefined,
  seed: number,
  sessionOrder?: number[] | null,
): T[] {
  // Render-phase cache mutation is safe here: the cache is derived
  // purely from the memo's own inputs/output, so a discarded render or
  // StrictMode double-invoke just rewrites the same entry.
  const cacheRef = useRef<FeedCache<T> | null>(null);

  return useMemo(() => {
    if (!images || images.length === 0) {
      cacheRef.current = null;
      return [];
    }

    if (sessionOrder && sessionOrder.length > 0) {
      // Manual-reorder path: full rebuild, and drop the cache — the
      // output no longer reflects pure (key, id) order, so it cannot
      // seed the incremental path.
      cacheRef.current = null;
      const ready = images.filter((img) => img.hasThumbnail);
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

    const cache = cacheRef.current;
    if (cache && cache.seed === seed && cache.images !== images) {
      // ---- Incremental fast path -------------------------------------
      const nextById = new Map<number, T>();
      for (const img of images) {
        if (img.hasThumbnail) nextById.set(img.id, img);
      }

      // Patch / remove over the cached order. Positions can't change:
      // an id's key is fixed for this seed.
      let changed = false;
      const patched: T[] = [];
      for (const item of cache.ready) {
        const next = nextById.get(item.id);
        if (next === undefined) {
          changed = true; // removed (or lost its thumbnail)
          continue;
        }
        if (next !== item) changed = true;
        patched.push(next);
      }

      // Newcomers merge-insert at their (key, id) slot.
      const newcomers: { img: T; key: number }[] = [];
      for (const [id, img] of nextById) {
        if (!cache.ids.has(id)) {
          newcomers.push({ img, key: shuffleKey(id, seed) });
        }
      }

      let out: T[];
      if (newcomers.length === 0) {
        out = changed ? patched : cache.ready;
      } else {
        newcomers.sort((a, b) => a.key - b.key || a.img.id - b.img.id);
        const keys = patched.map((item) => shuffleKey(item.id, seed));
        const merged: T[] = [];
        let i = 0;
        for (const nc of newcomers) {
          while (
            i < patched.length &&
            (keys[i] < nc.key || (keys[i] === nc.key && patched[i].id < nc.img.id))
          ) {
            merged.push(patched[i]);
            i += 1;
          }
          merged.push(nc.img);
        }
        while (i < patched.length) {
          merged.push(patched[i]);
          i += 1;
        }
        out = merged;
      }

      cacheRef.current = {
        seed,
        images,
        ready: out,
        ids: new Set(nextById.keys()),
      };
      return out;
    }

    // ---- Full rebuild (launch, reshuffle, cache miss) ------------------
    const ready = images.filter((img) => img.hasThumbnail);
    const out = ready
      .map((img) => ({ img, key: shuffleKey(img.id, seed) }))
      .sort((a, b) => a.key - b.key || a.img.id - b.img.id)
      .map((x) => x.img);
    cacheRef.current = {
      seed,
      images,
      ready: out,
      ids: new Set(out.map((img) => img.id)),
    };
    return out;
  }, [images, seed, sessionOrder]);
}

/** A fresh, non-zero shuffle seed. */
export function newShuffleSeed(): number {
  return (Math.floor(Math.random() * 0x7fffffff) || 1) >>> 0;
}
