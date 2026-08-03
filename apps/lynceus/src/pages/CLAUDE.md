# src/pages/

`[...slug].tsx`, the single catch-all route (vite-plugin-pages via `~react-pages`), plus four route-private presentational components split out of it (2026-08-03 modularisation). The route is the app's composition root: owns the one filter state shared by SearchBar and LibraryDrawer, selection/hero state, the inspector's nav list, and wires the feed manifest → shuffle → Masonry pipeline plus all drawers/overlays. There is no second page; navigation state lives in this component, not the URL — except the selected image id, which the URL slug owns as source of truth.

## Map

```
pages/
├── [...slug].tsx       The catch-all route: all state, all handlers, the render
│                       tree composing TopBar/EmptyState/SimilarHeader/
│                       SemanticStatus below, plus the still-inline
│                       PinterestModal/LibraryDrawer/drawers.
├── TopBar.tsx          Header: library-drawer toggle, wordmark, SearchBar,
│                       add-folder + settings buttons. onSearchChange
│                       (leave-first invariant) and onAddFolder (duplicate-
│                       folder confirm flow) are prebuilt callbacks passed
│                       down — never rebuilt inside this component.
├── EmptyState.tsx      Indexing / no-images-yet hint. `manifestCount: number |
│                       undefined` is the tri-state read of manifest.data?.length.
├── SimilarHeader.tsx   "More like this" section: similarity breadcrumb trail
│                       + back controls. Self-contained AnimatePresence,
│                       gated on `selectedItem`.
└── SemanticStatus.tsx  Semantic search status: loading/results title, count,
                        error. Self-contained AnimatePresence, gated on `visible`.
```

Each extracted component is route-private (lives beside the route, not in `components/`) because the router convention is its only consumer — no other page exists to share it with.

## The priority chain — what the grid shows

```
1. Similar (selectedItem set)        → useTieredSimilarImages drives displayImages
2. Semantic (text, non-#, no selection) → useSemanticSearch(query, 50)
3. All / tag-or-exclude-filtered     → useShuffledFeed(useFeedManifest({tagIds,
                                       matchAllTags, excludeTagIds}), seed, sessionOrder)
```

Three tiers, not four: "tag filter" and "all images" are the SAME `useFeedManifest` call at different argument values, not separate code paths. The hooks don't run strictly in order — each carries its own `enabled` guard so unused branches short-circuit at the query-client level while their caches stay warm for an instant flip back. Arrow-nav (`handleNavigate`) and the modal's neighbour predecode both iterate `displayImages` — the active tier — so prev/next inside a search or similar set walks that set.

## The one-filter invariant set (coherence passes 0534bfb..447e557)

`searchTags` (include) is ONE state shared by the SearchBar's chips and the LibraryDrawer's folder selection; `excludeTags` is drawer-only. Three invariants keep it coherent:

- **The active-folder highlight is derived, not stored**: `activeFolderId = searchTags.length === 1 ? searchTags[0].id : null`. A second synced-by-effects array was considered and rejected — "kept in sync via effects" is exactly the bug class these passes were fixing.
- **Include and exclude stay disjoint**: each filter handler removes a tag from the other set before adding — a tag simultaneously required and forbidden would make a highlighted folder permanently empty.
- **A filter always acts on what you can see**: `exitToFeed()` clears `searchText` and navigates home before any filter mutation lands. Without it, toggling a filter under a similar/semantic view refetches silently beneath the visible grid and the filter looks dead until the user exits. The same invariant governs why feed-deltas invalidate rather than patch filtered manifests (`services/feedDelta.ts`).

## Selection: seed-then-upgrade, and the load-bearing guard

The manifest carries no tags or full-res URL, so selection is two-phase: **seed** synchronously from the `FeedItem` in `displayImages` (`seedSelectionItem` — thumbnail stands in for full-res, `tags: []`), then **upgrade** in place when `useImageDetail` hydrates (usually same-tick, given hover/click prefetch). The early-return guard (`selectedItem?.id.toString() === pathId → return`) is load-bearing, not an optimisation: `displayImages` and `selectedItem` are mutually dependent by design — selecting an image swaps the grid to its similar-set, which structurally excludes the image itself, so a naive re-derivation per `displayImages` change would null the selection, flip the grid back, find the id again, and oscillate to "Maximum update depth exceeded". The guard admits only seed→hydrated (and hydrated→refreshed) transitions for a same id, which terminates because detail data is referentially stable between fetches. This preserves the 656abc5/9d04f69 anti-oscillation lineage through the manifest/detail rework. Known consequence: the guard is opaque to same-id changes, so a future "force re-seed this id" action needs a different mechanism (e.g. a key bump), not this effect.

## Shuffle seed, session order, reorder gate

`shuffleSeed` re-rolls only on genuine feed entry: launch (lazy initializer) and the results-view → plain-feed transition (`isResultsView` edge effect) — never on renders or indexing refetches. `sessionOrder` (the drag-reorder nudge) clears at the same moment, and separately whenever `reorderEnabled` goes false: `reorderEnabled = !selectedItem && !shouldUseSemanticSearch && searchTags.length === 0 && excludeTags.length === 0` — a reorder rank is meaningless once a filter or search narrows the set. No sort mode gates any of this; the shuffle is unconditional (mechanism in `hooks/CLAUDE.md`).

## Other route-owned behaviour

- **300ms semantic debounce** — empirical feel number, unchanged through the fusion migration (it was never about backend load). Typing while a similar set is open exits that view immediately rather than silently queueing — same leave-first discipline as the filter handlers.
- **`#` prefix branches to tag autocomplete**, and `shouldUseSemanticSearch` excludes `#`-prefixed text, so picking a tag can't fire a 50-result vector search mid-selection. Literal `#` search is deliberately unsupported.
- **Shortcuts**: `⌘,` toggles settings always; `⌘⇧P` toggles the perf overlay only when profiling resolved true at mount (the overlay also auto-opens under `--profiling` — a user who launched with the flag wanted to see it).
- **`simTrail`** — diving deeper into a similarity cascade pushes the previous selection; back-one-hop and rewind-to-index render as a thumbnail strip; the trail clears on returning to the feed root — a cascade doesn't survive leaving it, by design.
- **Lazy notes loader** — fetches on selection with a `cancelled` flag so a slow IPC can't clobber a fast follow-up during rapid prev/next.
- **`recordAction` breadcrumbs** fire at user-action sites throughout (fire-and-forget; no-op when profiling is off). The `Profiler` wrapper around Masonry runs its callback in production too — it short-circuits internally, minor overhead accepted.

## Gaps and known limits

- **No route-level React test harness**: the seed→upgrade effect and worker swap behaviours are unit/trace-verified, never mounted. Trigger to invest in a harness rather than more tracing: route regressions recurring.
- Selection can briefly render seeded (empty tags, thumbnail as full-res) while detail is mid-flight — correct-but-incomplete, self-heals within one round trip.
- Planned, still unimplemented: a programmatic model re-download trigger using `isMissingModelError` (toast button → a hypothetical `force_reindex`); multi-select batch tag/notes (needs the 500-id detail-hydration chunk driven at real size first — see `queries/CLAUDE.md`); drag-and-drop folder add.
