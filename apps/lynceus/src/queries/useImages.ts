import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageItem, Tag } from "../types";
import {
  assignTagToImage,
  fetchImages,
  removeTagFromImage,
  setManualColSpan,
} from "../services/images";

export function useImages(filters?: {
  tagIds?: number[];
  searchText?: string;
  /** When true, match images that have ALL selected tags (AND).
   *  When false (default), match images with ANY selected tag (OR). */
  matchAllTags?: boolean;
}) {
  const tagIds = filters?.tagIds ?? [];
  // searchText is intentionally NOT in the queryKey: the backend ignores
  // it (filtering happens via tagIds + the separate semantic_search command),
  // so keying on it would produce a cache miss per keystroke for identical
  // data. We still pass it through to fetchImages for future-proofing.
  const searchText = filters?.searchText ?? "";
  const matchAllTags = filters?.matchAllTags ?? false;

  return useQuery<ImageItem[]>({
    // Ordering (shuffle) and thumbnail-gating happen client-side in
    // useShuffledFeed, keyed by a seed the route owns — so this query is
    // just the raw filtered catalogue in stable id order. Indexing-
    // progress invalidations refetch this same key; because the shuffle
    // key is derived per-image, existing tiles never move — only
    // newly-thumbnailed images pop into the feed.
    queryKey: ["images", tagIds, matchAllTags],
    queryFn: () => fetchImages(tagIds, searchText, matchAllTags),
    enabled: true,
  });
}

export function useAssignTagToImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { imageId: number; tagId: number }) =>
      assignTagToImage(params.imageId, params.tagId),

    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["images"] });

      const prevImages = queryClient.getQueryData(["images"]);

      // Get the tag from tags cache
      const tags = queryClient.getQueryData<Tag[]>(["tags"]);
      const tagToAdd = tags?.find((t) => t.id === params.tagId);

      console.log(params.tagId);

      // Optimistically update images
      if (tagToAdd) {
        queryClient.setQueriesData<ImageItem[]>(
          { queryKey: ["images"], exact: false },
          (old = []) =>
            old.map((img) =>
              img.id === params.imageId
                ? { ...img, tags: [...img.tags, tagToAdd] }
                : img
            )
        );
      }

      return { prevImages };
    },

    onError: (_err, _vars, context) => {
      if (context?.prevImages) {
        queryClient.setQueryData(["images"], context.prevImages);
      }
    },
  });
}

/** Persist a drag-resize. Optimistically stamps `manualColSpan` on the
 *  cached images so the resized tile keeps its new width immediately
 *  instead of snapping back for one frame while the mutation round-trips.
 *  Resize is the only manual layout property that persists (position is
 *  re-rolled per feed entry). */
export function useSetManualColSpan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { imageId: number; colSpan: number | null }) =>
      setManualColSpan(params.imageId, params.colSpan),

    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["images"] });
      const prevImages = queryClient.getQueryData(["images"]);

      queryClient.setQueriesData<ImageItem[]>(
        { queryKey: ["images"], exact: false },
        (old = []) =>
          old.map((img) =>
            img.id === params.imageId
              ? { ...img, manualColSpan: params.colSpan }
              : img,
          ),
      );

      return { prevImages };
    },

    onError: (_err, _vars, context) => {
      if (context?.prevImages) {
        queryClient.setQueryData(["images"], context.prevImages);
      }
    },
  });
}

export function useRemoveTagFromImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { imageId: number; tagId: number }) =>
      removeTagFromImage(params.imageId, params.tagId),

    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["images"] });

      const prevImages = queryClient.getQueryData(["images"]);

      // Optimistically remove the tag from the image
      queryClient.setQueriesData<ImageItem[]>(
        { queryKey: ["images"], exact: false },
        (old = []) =>
          old.map((img) =>
            img.id === params.imageId
              ? { ...img, tags: img.tags.filter((t) => t.id !== params.tagId) }
              : img
          )
      );

      return { prevImages };
    },

    onError: (_err, _vars, context) => {
      if (context?.prevImages) {
        queryClient.setQueryData(["images"], context.prevImages);
      }
    },
  });
}
