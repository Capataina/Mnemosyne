import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { FeedItem, ImageItem, Tag } from "../types";
import {
  assignTagToImage,
  clearAllManualSpans,
  fetchFeedManifest,
  fetchImageDetails,
  removeTagFromImage,
  setManualColSpan,
} from "../services/images";

/**
 * T3-1 entity model, replacing the legacy `["images"]` full-catalogue
 * caches (which duplicated a complete `ImageItem[]` per filter combo):
 *
 *   ["feed-manifest", tagIds, matchAllTags, excludeTagIds]
 *       → compact `FeedItem[]` — everything the shuffle/pack/tile
 *         layers read; per-filter duplication is id+geometry only.
 *   ["image-detail", id]
 *       → one hydrated `ImageItem` (tags, full-res url) per id —
 *         entities stored ONCE, consumed by the selection/inspector
 *         surfaces and seeded in batches via `prefetchImageDetails`.
 */
export function useFeedManifest(filters?: {
  tagIds?: number[];
  /** When true, match images that have ALL selected tags (AND).
   *  When false (default), match images with ANY selected tag (OR). */
  matchAllTags?: boolean;
  /** Tags an image must NOT carry (the drawer's "must not have" filter). */
  excludeTagIds?: number[];
}) {
  const tagIds = filters?.tagIds ?? [];
  const matchAllTags = filters?.matchAllTags ?? false;
  const excludeTagIds = filters?.excludeTagIds ?? [];

  return useQuery<FeedItem[]>({
    // Ordering (shuffle) and thumbnail-gating happen client-side in
    // useShuffledFeed, keyed by a seed the route owns — so this query is
    // just the compact filtered manifest in stable id order. During the
    // thumbnail phase the UNFILTERED instance of this key is patched in
    // place by `feed-delta` events (see useIndexingStatus); because the
    // shuffle key is derived per-image, existing tiles never move —
    // only newly-thumbnailed images pop into the feed.
    queryKey: ["feed-manifest", tagIds, matchAllTags, excludeTagIds],
    queryFn: () => fetchFeedManifest(tagIds, matchAllTags, excludeTagIds),
    enabled: true,
  });
}

/**
 * Hydrated full detail for one image — the inspector/selection surface.
 * The per-id key is the single home of each entity; batch prefetches
 * seed these same keys, so a click after a hover/neighbour prefetch
 * resolves synchronously from cache.
 *
 * `null` means "backend has no visible row for this id" (unknown,
 * orphaned, or under a disabled root) — callers fall back to the active
 * display list, exactly as the old catalogue `find` used to miss.
 */
export function useImageDetail(id: number | undefined) {
  return useQuery<ImageItem | null>({
    queryKey: ["image-detail", id],
    queryFn: async () => {
      const details = await fetchImageDetails([id as number]);
      return details[0] ?? null;
    },
    enabled: id !== undefined,
  });
}

/**
 * Batch-hydrate detail for `ids` in ONE IPC round-trip, seeding each
 * `["image-detail", id]` key. Ids already cached (fresh) are skipped, so
 * calling this on every modal open / neighbour change costs nothing
 * once the entities are in.
 */
export async function prefetchImageDetails(
  queryClient: QueryClient,
  ids: number[],
): Promise<void> {
  const missing = ids.filter(
    (id) =>
      queryClient.getQueryData<ImageItem | null>(["image-detail", id]) ===
      undefined,
  );
  if (missing.length === 0) return;
  const details = await fetchImageDetails(missing);
  const byId = new Map(details.map((d) => [d.id, d] as const));
  for (const id of missing) {
    queryClient.setQueryData<ImageItem | null>(
      ["image-detail", id],
      byId.get(id) ?? null,
    );
  }
}

export function useAssignTagToImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { imageId: number; tagId: number }) =>
      assignTagToImage(params.imageId, params.tagId),

    onMutate: async (params) => {
      await queryClient.cancelQueries({
        queryKey: ["image-detail", params.imageId],
      });

      const prevDetail = queryClient.getQueryData<ImageItem | null>([
        "image-detail",
        params.imageId,
      ]);

      // Get the tag from tags cache
      const tags = queryClient.getQueryData<Tag[]>(["tags"]);
      const tagToAdd = tags?.find((t) => t.id === params.tagId);

      // Optimistically stamp the tag onto the hydrated entity (the
      // inspector reads it from here). The manifest carries no tags, so
      // there is nothing to patch grid-side.
      if (tagToAdd && prevDetail) {
        const next: ImageItem = {
          ...prevDetail,
          tags: [...prevDetail.tags, tagToAdd],
        };
        queryClient.setQueryData<ImageItem | null>(
          ["image-detail", params.imageId],
          () => next,
        );
      }

      return { prevDetail };
    },

    onError: (_err, params, context) => {
      if (context?.prevDetail !== undefined) {
        queryClient.setQueryData(
          ["image-detail", params.imageId],
          context.prevDetail,
        );
      }
    },

    // Assigning a tag can change folder membership (a filtered view must
    // gain the newly-matching image / lose a de-matched one) and bumps that
    // folder's count in the drawer. Invalidate the manifest, the counts,
    // and the entity: the optimistic tag stamp already gave instant
    // feedback, and useShuffledFeed's stable keys mean a filtered-manifest
    // refetch only pops the membership-changed image in or out — not a
    // whole-grid reshuffle.
    onSettled: (_data, _err, params) => {
      queryClient.invalidateQueries({ queryKey: ["feed-manifest"] });
      queryClient.invalidateQueries({ queryKey: ["tagCounts"] });
      queryClient.invalidateQueries({
        queryKey: ["image-detail", params.imageId],
      });
    },
  });
}

/** Persist a drag-resize. Optimistically stamps `manualColSpan` on every
 *  cached manifest entry for the image (identity-preserving for all
 *  other entries) so the resized tile keeps its new width immediately
 *  instead of snapping back for one frame while the mutation round-trips.
 *  Resize is the only manual layout property that persists (position is
 *  re-rolled per feed entry). */
export function useSetManualColSpan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { imageId: number; colSpan: number | null }) =>
      setManualColSpan(params.imageId, params.colSpan),

    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["feed-manifest"] });
      const prevManifests = queryClient.getQueriesData<FeedItem[]>({
        queryKey: ["feed-manifest"],
      });

      queryClient.setQueriesData<FeedItem[]>(
        { queryKey: ["feed-manifest"], exact: false },
        (old = []) =>
          old.map((item) =>
            item.id === params.imageId
              ? { ...item, manualColSpan: params.colSpan }
              : item,
          ),
      );
      // Keep the hydrated entity coherent too, if it's cached.
      const prevDetail = queryClient.getQueryData<ImageItem | null>([
        "image-detail",
        params.imageId,
      ]);
      if (prevDetail) {
        const next: ImageItem = { ...prevDetail, manualColSpan: params.colSpan };
        queryClient.setQueryData<ImageItem | null>(
          ["image-detail", params.imageId],
          () => next,
        );
      }

      return { prevManifests, prevDetail };
    },

    onError: (_err, params, context) => {
      for (const [key, data] of context?.prevManifests ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (context?.prevDetail !== undefined) {
        queryClient.setQueryData(
          ["image-detail", params.imageId],
          context.prevDetail,
        );
      }
    },
  });
}

/** Clear every image's manual column span at once (the settings
 *  "reset all resizes" control). Optimistically strips `manualColSpan`
 *  from every cached manifest entry so the grid re-packs to default
 *  widths immediately, mirroring the single-image `useSetManualColSpan`
 *  path; the settle-time invalidation reconciles against the DB. */
export function useClearAllManualSpans() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => clearAllManualSpans(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["feed-manifest"] });
      const prevManifests = queryClient.getQueriesData<FeedItem[]>({
        queryKey: ["feed-manifest"],
      });

      queryClient.setQueriesData<FeedItem[]>(
        { queryKey: ["feed-manifest"], exact: false },
        (old = []) =>
          old.map((item) =>
            item.manualColSpan == null
              ? item
              : { ...item, manualColSpan: null },
          ),
      );

      return { prevManifests };
    },

    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.prevManifests ?? []) {
        queryClient.setQueryData(key, data);
      }
    },

    // Reconcile the manifest (and any hydrated entities) against the DB
    // once the bulk clear round-trips.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["feed-manifest"] });
      queryClient.invalidateQueries({ queryKey: ["image-detail"] });
    },
  });
}

export function useRemoveTagFromImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { imageId: number; tagId: number }) =>
      removeTagFromImage(params.imageId, params.tagId),

    onMutate: async (params) => {
      await queryClient.cancelQueries({
        queryKey: ["image-detail", params.imageId],
      });

      const prevDetail = queryClient.getQueryData<ImageItem | null>([
        "image-detail",
        params.imageId,
      ]);

      // Optimistically remove the tag from the hydrated entity.
      if (prevDetail) {
        const next: ImageItem = {
          ...prevDetail,
          tags: prevDetail.tags.filter((t) => t.id !== params.tagId),
        };
        queryClient.setQueryData<ImageItem | null>(
          ["image-detail", params.imageId],
          () => next,
        );
      }

      return { prevDetail };
    },

    onError: (_err, params, context) => {
      if (context?.prevDetail !== undefined) {
        queryClient.setQueryData(
          ["image-detail", params.imageId],
          context.prevDetail,
        );
      }
    },

    // Removing a tag can change folder membership (a filtered view must drop
    // the now-unmatching image) and drops that folder's count in the drawer.
    // Same reasoning as assign: stable shuffle keys keep the refetch to a
    // single pop-out, not a reshuffle.
    onSettled: (_data, _err, params) => {
      queryClient.invalidateQueries({ queryKey: ["feed-manifest"] });
      queryClient.invalidateQueries({ queryKey: ["tagCounts"] });
      queryClient.invalidateQueries({
        queryKey: ["image-detail", params.imageId],
      });
    },
  });
}
