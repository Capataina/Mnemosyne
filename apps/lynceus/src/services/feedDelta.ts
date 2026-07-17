import type { FeedItem, FeedManifestRowDTO } from "../types";
import { mapFeedManifestRow } from "./images";

/**
 * T3-1 — pure merge of a batch of `feed-delta` rows into a cached feed
 * manifest. The delta path exists so the every-~5s indexing refresh
 * moves tens of records instead of re-fetching, re-shuffling and
 * re-packing the whole catalogue.
 *
 * Wire payload of the `feed-delta` Tauri event (mirrors
 * `FeedDeltaBatch` in src-tauri/src/indexing.rs).
 */
export interface FeedDeltaBatch {
  rows: FeedDeltaRowDTO[];
}

/** A delta row is a manifest row without `manual_col_span` — a delta
 *  only ever says "this image is now thumbnailed with these dims", and
 *  the merge below preserves any span the cached entry already carries,
 *  so a re-thumbnail can never wipe a persisted resize. */
export type FeedDeltaRowDTO = Omit<FeedManifestRowDTO, "manual_col_span">;

/** The exact query key of the UNFILTERED feed manifest — the only cache
 *  deltas are merged into directly. A delta row's tag membership is
 *  unknown, so filtered manifests are invalidated (their refetch is the
 *  compact no-join query) rather than patched; that is what keeps "a
 *  filter always acts on what you can see" honest during indexing. */
export const UNFILTERED_MANIFEST_KEY = [
  "feed-manifest",
  [] as number[],
  false,
  [] as number[],
] as const;

/**
 * Merge delta rows into the current manifest, upserting by id.
 *
 * Contract (each clause is load-bearing for a wave-1 or v2 invariant):
 * - **Identity-preserving**: entries untouched by the batch keep their
 *   exact object identity, so the MasonryItem memo comparator and the
 *   shuffle's incremental fast path see them as unchanged.
 * - **Patch in place**: an id already present is replaced at its index
 *   (position in the id-sorted manifest is unchanged by construction),
 *   with `manualColSpan` carried over from the existing entry.
 * - **Insert sorted**: a new id is inserted at its id-sorted position,
 *   matching the backend's id-ASC manifest order, so a delta-patched
 *   cache and a fresh refetch produce the same array.
 * - Returns `current` itself when the batch changes nothing.
 */
export function mergeFeedDeltaRows(
  current: FeedItem[] | undefined,
  rows: FeedDeltaRowDTO[],
): FeedItem[] {
  const base = current ?? [];
  if (rows.length === 0) return base;

  const indexById = new Map<number, number>();
  base.forEach((item, i) => indexById.set(item.id, i));

  let next: FeedItem[] | null = null;
  const inserts: FeedItem[] = [];

  for (const row of rows) {
    const mapped = mapFeedManifestRow(row);
    const existingIndex = indexById.get(row.id);
    if (existingIndex !== undefined) {
      next ??= base.slice();
      // Preserve the persisted resize — deltas never carry a span.
      mapped.manualColSpan = next[existingIndex].manualColSpan ?? null;
      next[existingIndex] = mapped;
    } else {
      inserts.push(mapped);
    }
  }

  if (inserts.length === 0) return next ?? base;

  // Insert newcomers at their id-sorted positions. Sorting the (small)
  // insert batch then splicing via a single linear merge keeps this
  // O(N + k log k) instead of k × O(N) splices.
  inserts.sort((a, b) => a.id - b.id);
  const source = next ?? base;
  const merged: FeedItem[] = [];
  let i = 0;
  for (const ins of inserts) {
    while (i < source.length && source[i].id < ins.id) merged.push(source[i++]);
    merged.push(ins);
  }
  while (i < source.length) merged.push(source[i++]);
  return merged;
}
