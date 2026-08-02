# src/queries/

TanStack Query adapters for roots, images, tags, and semantic/similarity search. This layer owns cache identity and optimistic-mutation shape; the raw IPC calls live in `services/`.

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

## Why the cache policy is this aggressive

`staleTime: Infinity`, no refetch-on-anything, `retry: false` — because this is a desktop app (no "navigate away and come back"), IPC is local (no network cost to retry), and the backend is the single source of truth: staleness happens deterministically (on `Phase::Ready`, or on the feed-delta cadence during indexing) and is handled with explicit invalidation, never a background poll of the catalogue. `["pipelineStats"]` is the one polling query, 1.5s and only while a run is active. `useSemanticSearch` overrides to a 5-min staleTime — deterministic per input, but the user rarely repeats the exact query in-session.

## The manifest/detail entity model (T3-1, 012012c)

Replaced the monolithic `["images", tagIds, searchText, matchAllTags, sortMode, shuffleSeed]` query: that shape joined tags onto every row (200-300k joined rows at 100k images) and duplicated a full `ImageItem[]` per filter combination, refetched whole-library on a ~5s cadence during indexing. Now:

```
["feed-manifest", tagIds, matchAllTags, excludeTagIds] → FeedItem[]  (geometry only)
["image-detail", id]                                   → ImageItem | null (hydrated)
```

- A visible tile reads nothing beyond the manifest fields (id, name, dims, thumbnail path, manual span) — tags/notes/full-res are inspector-only, which is what makes the split lossless for the grid. `url` is absent until hydrated; dims placeholder 400×400 until thumbnailed.
- **The manifest carries no tag information at all** — even tag _ids_ would pay the `LEFT JOIN` that was the actual cost driver. Tag membership is expressed by which filtered manifest query is active (the backend re-runs the predicate), never by a client-side field per row.
- `prefetchImageDetails(queryClient, ids)` batch-hydrates in ONE IPC round trip, skips fresh ids, and seeds each `["image-detail", id]` key individually; called on hover, click, and modal-neighbour resolution so arrow-nav lands on warm detail. The backend chunks at 500 ids but the frontend only ever passes 1-2 — the design size has never been driven live; time it before a bulk-select feature relies on it.
- **Rejected alternative — `get_changes_since(version)`**: needs a persisted monotonic version source (schema migration, or a restart-fragile in-memory counter). The shipped design (best-effort batched delta events + the `Phase::Ready` full reconcile in `hooks/useIndexingStatus.ts`) gets losslessness free: the terminal reconcile is the correctness guarantee, not the events.
- **Deferred — semantic-search cancellation**: the 300ms route debounce absorbs the common case at ~100-400ms/query, text-encode-dominated. Trigger: search feels laggy during deliberate multi-word typing at real scale. Sketch: request-generation `AtomicU64` checked between encoders and corpus chunks, never mid-lock.

Cache-key inventory:

| Key | Patched by delta? | Invalidated on ready? |
| --- | --- | --- |
| `["feed-manifest", [], false, []]` (unfiltered) | Yes — in-place merge | Yes (backstop) |
| `["feed-manifest", …]` (any filter) | No — invalidated instead | Yes |
| `["image-detail", id]` | Never | No — hydration is orthogonal to membership |
| `["fused-similar-images", …]` / `["fused-semantic-search", …]` | — | Yes |
| `["thumbnail", id, bucket]` | — | Yes (prefix) |

## Invariants

- Query keys encode authoritative cache identity, including thumbnail bucket, feed seed/version, tag include/exclude filters, and enabled encoder state. `matchAllTags` lives in the key deliberately: toggling AND/OR must refetch with fresh SQL semantics, never serve cached OR rows.
- Optimistic changes must reconcile against host events or invalidation — never assume mutation success as final state. The canonical shape every mutation follows: `cancelQueries → snapshot → optimistic set → onError rollback → onSettled/onSuccess invalidate`. Note the asymmetry it accepts: rollback restores the snapshot but doesn't refetch, so a staleness-caused rejection can restore an obsolete entry — only the success path invalidates.
- Tag mutations patch the hydrated `["image-detail", id]` entity, never the manifest (it carries no tags), and invalidate `["feed-manifest"]` + `["tagCounts"]` + the touched detail on settle.

## Operating notes

- Feed-manifest invalidation uses prefix matching (`["feed-manifest"]`, exact: false) to hit every filter combination; the unfiltered key constant lives in `services/feedDelta.ts` because deltas patch only that cache.
- The `["thumbnail", id, bucket]` key family is owned by `hooks/useAdaptiveThumbnail.ts`, and `["tagCounts"]` is an inline `useQuery` in the route (no dedicated hook file) — both still obey the key invariant above.
- `useTieredSimilarImages` and `useSemanticSearch` kept their pre-fusion names when they moved to the `get_fused_*` commands so call sites never needed an import-rename wave.
- Known accepted gap (documented in useSemanticSearch.ts): the enabled-encoder set is process-global on the backend, so toggling encoders does not invalidate fused search results — a retype/restart refreshes them.
