import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageItem, Tag } from "../types";
import { createTag, deleteTag, fetchTags } from "@/services/tags";

export function useTags() {
  return useQuery<Tag[]>({
    queryKey: ["tags"],
    queryFn: fetchTags,
    enabled: true,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { name: string; color: string }) =>
      createTag(params.name, params.color),

    onMutate: async (newTag) => {
      await queryClient.cancelQueries({ queryKey: ["tags"] });

      const prevTags = queryClient.getQueryData(["tags"]);

      queryClient.setQueryData(["tags"], (old: Tag[] = []) => [
        ...old,
        { ...newTag, id: -1, optimistic: true },
      ]);

      return { prevTags };
    },

    onError: (_err, _newTodo, context) => {
      if (context?.prevTags) {
        queryClient.setQueryData(["tags"], context.prevTags);
      }
    },

    onSuccess: (newTag) => {
      queryClient.setQueryData<Tag[]>(["tags"], (old = []) =>
        old.map((tag) => (tag.id === -1 ? newTag : tag))
      );
    },

    // A new tag is a new (zero-count) folder in the library drawer — refresh
    // the counts so it appears there without a manual reload.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tagCounts"] });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tagId: number) => deleteTag(tagId),

    onMutate: async (tagId) => {
      await queryClient.cancelQueries({ queryKey: ["tags"] });
      await queryClient.cancelQueries({ queryKey: ["image-detail"] });

      const prevTags = queryClient.getQueryData<Tag[]>(["tags"]);

      // Optimistically remove from tags catalog
      queryClient.setQueryData<Tag[]>(["tags"], (old = []) =>
        old.filter((t) => t.id !== tagId)
      );

      // Also strip the tag from any hydrated image entity that has it
      // (the DB does this via ON DELETE CASCADE on images_tags; we mirror
      // it in the cache so the inspector doesn't show ghost tags until
      // the next refetch). The compact manifest carries no tags, so
      // there's nothing to strip grid-side.
      queryClient.setQueriesData<ImageItem | null>(
        { queryKey: ["image-detail"], exact: false },
        (old) =>
          old
            ? { ...old, tags: old.tags.filter((t) => t.id !== tagId) }
            : old
      );

      return { prevTags };
    },

    onError: (_err, _vars, context) => {
      if (context?.prevTags) {
        queryClient.setQueryData(["tags"], context.prevTags);
      }
      // Entity + manifest caches self-correct on refetch; we don't
      // snapshot every per-id entity because there can be many keys.
      queryClient.invalidateQueries({ queryKey: ["image-detail"] });
      queryClient.invalidateQueries({ queryKey: ["feed-manifest"] });
    },

    // The deleted tag's folder (and its count row) vanishes from the drawer.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tagCounts"] });
    },
  });
}
