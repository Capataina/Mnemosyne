# src/queries/

TanStack Query adapters for roots, images, tags, and semantic/similarity
search. This layer owns cache identity and optimistic-mutation shape; the raw
IPC calls live in `services/`.

## Map

```
queries/
├── queryClient.ts       The one shared client: staleTime Infinity, no refetch-on-*,
│                        retry false — the backend pushes changes (events/deltas), the
│                        frontend never polls by default.
├── useImages.ts         The T3-1 entity model: ["feed-manifest", tagIds, matchAllTags,
│                        excludeTagIds] → compact FeedItem[]; ["image-detail", id] → one
│                        hydrated ImageItem (stored ONCE, batch-seeded via
│                        prefetchImageDetails). Also manual-span mutations,
│                        usePreviewBreakdown (enabled only while expanded),
│                        usePurgeOrphanedImages.
├── useRoots.ts          Root list + add/remove/enable mutations in the canonical
│                        optimistic shape (cancelQueries → snapshot → setQueriesData →
│                        rollback on error).
├── useTags.ts           Tags + create/delete with optimistic placeholder (id: -1).
├── useSimilarImages.ts  useTieredSimilarImages — name kept for caller stability; now
│                        multi-encoder rank fusion. encoderId is a hint but stays in the
│                        key (switching invalidates).
└── useSemanticSearch.ts Fused text search, ["fused-semantic-search", trimmedQuery, topN].
```

## Invariants

- Query keys encode authoritative cache identity, including thumbnail bucket, feed seed/version, tag include/exclude filters, and enabled encoder state.
- Optimistic changes must reconcile against host events or invalidation — never assume mutation success as final state.

## Operating notes

- Feed-manifest invalidation uses prefix matching (`["feed-manifest"]`, exact:
  false) to hit every filter combination; the unfiltered key constant lives in
  `services/feedDelta.ts` because deltas patch only that cache.
- The `["thumbnail", id, bucket]` key family is owned by
  `hooks/useAdaptiveThumbnail.ts`, not this folder — it still obeys the key
  invariant above.
- Known accepted gap (documented in useSemanticSearch.ts): the enabled-encoder
  set is process-global on the backend, so toggling encoders does not
  invalidate fused search results — a retype/restart refreshes them.
