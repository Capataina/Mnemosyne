# search-routing

*Maturity: comprehensive · Stability: stable*

## Scope / Purpose

The frontend's "what should the grid show right now?" decision layer. Lives in `apps/lynceus/src/pages/[...slug].tsx` (the single catch-all route) and resolves a priority chain — similar > semantic > tag/exclude filter > all — into the `displayImages` set that drives Masonry. Owns the URL ↔ selectedItem reconciliation (now seed-then-upgrade against the manifest/detail split), the debounced semantic-search trigger, the library drawer + search bar's shared filter state (they are **one filter**, not two), the global keyboard shortcuts, the lazy notes-load on selection, the similarity breadcrumb trail, and the typed-error catch-and-format chain.

## Boundaries / Ownership

- **Owns:** the priority resolution over `displayImages` (similar / semantic / tag-or-exclude-filtered feed / all), the URL-slug → selectedItem reconciliation (seed synchronously from the active display list, upgrade to hydrated detail when it lands), the 300 ms debounce for semantic search, the "leave any competing view before a filter lands" contract (`exitToFeed`), the cmd+, settings shortcut, the cmd+shift+P perf-overlay shortcut (profiling-only), the lazy notes loader, the similarity breadcrumb trail (`simTrail`), the per-action `recordAction` calls.
- **Does not own:** any IPC (delegates to `apps/lynceus/src/services/*`), the cache policy or entity model (delegates to `apps/lynceus/src/queries/*` and `systems/frontend-state.md`), the manifest/delta wire contract (delegates to `systems/feed-protocol.md`), the actual search SQL/fusion (delegates to backend `commands::*` and `systems/multi-encoder-fusion.md`), the shuffle ordering (delegates to `useShuffledFeed`, `notes/random-shuffle-as-feature.md`), the Masonry layout (delegates to `Masonry.tsx`, `systems/masonry-layout.md`), per-tile rendering (delegates to `MasonryItem.tsx`), the library drawer's own folder/tag-count UI (delegates to `components/library-drawer/`).
- **Public API:** the page component default export `Home`. No exported helpers besides the module-level `seedSelectionItem` — the file is a self-contained route.

## Current Implemented Reality

### State held in the page component

```ts
const [selectedItem, setSelectedItem] = useState<ImageItem | null>(null);
const [isInspecting, setIsInspecting] = useState(false);
const [pendingTimerStart, setPendingTimerStart] = useState<GestureTimerConfig | null>(null);
const [searchTags, setSearchTags] = useState<Tag[]>([]);          // include filter — shared with search bar
const [searchText, setSearchText] = useState("");
const [settingsOpen, setSettingsOpen] = useState(false);
const [profiling, setProfiling] = useState(false);
const [perfOpen, setPerfOpen] = useState(false);
const [shuffleSeed, setShuffleSeed] = useState<number>(() => newShuffleSeed());
const [sessionOrder, setSessionOrder] = useState<number[] | null>(null);   // in-session drag reorder
const [simTrail, setSimTrail] = useState<ImageItem[]>([]);                 // similarity breadcrumb trail
const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
const [excludeTags, setExcludeTags] = useState<Tag[]>([]);        // exclude filter — drawer-only
const [activeNotes, setActiveNotes] = useState<string>("");
const { prefs } = useUserPreferences();
```

`pages/[...slug].tsx:60-152`. Plus the URL slug (parsed inline against `useLocation`, `[...slug].tsx:336-341`) is the source of truth for which image is selected.

### The manifest is now the base of the priority chain, not `useImages`

```ts
const manifest = useFeedManifest({
  tagIds: searchTags.map((t) => t.id),
  matchAllTags: prefs.tagFilterMode === "all",
  excludeTagIds: excludeTags.map((t) => t.id),
});
const feed = useShuffledFeed(manifest.data, shuffleSeed, sessionOrder);
```

`[...slug].tsx:157-165`. Everything downstream of "the all-images tier" reads `feed` (the shuffled, thumbnail-gated, session-reorder-applied manifest), not a raw `useImages()` result — that hook no longer exists. See `systems/feed-protocol.md` for what the manifest fetches and `notes/random-shuffle-as-feature.md` for the shuffle applied here.

### Priority chain

```text
1. Similar (highest priority): selectedItem !== null
   ──► useTieredSimilarImages(selectedItem.id, prefs.imageEncoder) drives displayImages
       (ID-native, multi-encoder RRF fusion — see systems/multi-encoder-fusion.md)

2. Semantic: searchText non-empty AND not "#"-prefixed AND no selectedItem
   ──► useSemanticSearch(query, 50) drives displayImages
       (ID-native, fused across enabled text encoders)

3. All / tag-or-exclude-filtered (default): no selection, no text
   ──► feed (useShuffledFeed over useFeedManifest({tagIds, matchAllTags, excludeTagIds}))
       drives displayImages — the tag/exclude sets scope the manifest's SQL,
       so "tag filter" and "all images" are the SAME tier, not two.
```

`[...slug].tsx:364-401` (`displayImages` memo). The three-tier collapse (down from the pre-perf-round four-tier description, which separated "tag filter" from "all") reflects that both are the *same* `useFeedManifest` call — an empty `tagIds`/`excludeTagIds` pair is simply the no-filter case of the same query, not a different code path. The hooks don't run strictly in priority order — `useTieredSimilarImages` and `useSemanticSearch` both carry their own `enabled` guard (`!!imageId`, `shouldUseSemanticSearch` respectively) so unused branches short-circuit at the query-client level while their cache stays warm for an instant flip back.

### The search bar and the library drawer are ONE filter

`searchTags` (include set) is shared state between the `SearchBar`'s tag-autocomplete chips and the `LibraryDrawer`'s folder selection — there is no second copy. `excludeTags` (the drawer's "must not have" set) is drawer-only. Three invariants keep this coherent (landed across the `0534bfb..447e557` coherence passes):

- **The active-folder highlight is derived, not stored.** `const activeFolderId = searchTags.length === 1 ? searchTags[0].id : null` (`[...slug].tsx:261`) — selecting a single include tag *is* "viewing that folder"; there is no separate `activeFolder` state to fall out of sync with `searchTags`. Removing that chip in the search bar automatically clears the drawer highlight.
- **Include and exclude stay disjoint.** `handleSelectFolder` and `handleSetTagFilter` (`[...slug].tsx:278-314`) each remove a tag from the *other* set before adding it to the target set — a tag can't be simultaneously required and forbidden, which would make the grid permanently empty under a highlighted folder.
- **Applying a filter always leaves a competing view first.** `exitToFeed()` (`[...slug].tsx:271-274`) clears `searchText` and navigates home if `selectedItem` is set, called from every filter-mutating handler (`handleSelectFolder`, `handleSetTagFilter` when `state !== null`). Without this, toggling a filter while a similar-set or semantic search was on screen would refetch the manifest silently underneath the visible grid — the filter would look like it did nothing until the user manually exited, then the grid would lurch to the new filter. This is the coherence-pass invariant **"a filter always acts on what you can see."** The same invariant governs how feed-delta events treat filtered manifests during indexing — see `systems/feed-protocol.md`.

### URL slug → selection: seed-then-upgrade (replaces the old direct `.find()` fix)

```ts
useEffect(() => {
  const pathId = location.pathname.replace(/\//g, "");
  if (!pathId) { setSelectedItem(null); setIsInspecting(false); setSimTrail([]); return; }
  const detail = selectedDetail.data ?? null;
  if (selectedItem?.id.toString() === pathId) {
    if (detail && selectedItem !== detail) setSelectedItem(detail);   // upgrade in place
    return;                                                            // ← load-bearing guard
  }
  const fromDisplay = displayImages?.find((i) => i.id.toString() === pathId);
  const item = detail ?? (fromDisplay ? seedSelectionItem(fromDisplay) : null);
  setSelectedItem(item);
  if (!item) setIsInspecting(false);
}, [location, displayImages, selectedDetail.data, selectedItem]);
```

`[...slug].tsx:427-449`. This supersedes the old audit-era fix that simply pointed the lookup at `displayImages` instead of the raw catalogue. The mechanism changed because the manifest/detail split (`systems/feed-protocol.md`) made selection genuinely two-phase:

1. **Seed** — on a fresh id, synchronously select the entry found in `displayImages` via `seedSelectionItem()` (`[...slug].tsx:46-58`) — a compact `FeedItem` cast into an interim `ImageItem` (thumbnail stands in for the full-res URL, `tags: []`).
2. **Upgrade** — once `useImageDetail(urlImageId)` resolves, swap the hydrated record in for the same id.

The **early-return guard is the load-bearing part**, not an optimisation. Once `selectedItem` already matches the URL's id, the effect stops re-deriving from `displayImages` for that id. Without the guard: `displayImages` flips the instant `selectedItem` is set (from the feed to the similar-set, which never contains the selected image itself), so a naive re-derivation on every `displayImages` change would look the id up, fail to find it (it's not in its own similar-set), set `selectedItem` to `null`, which flips `displayImages` back to the feed, which finds the id again, sets it again — an infinite oscillation ("Maximum update depth exceeded"). The guard makes the only same-id transition allowed through be seed→hydrated (and hydrated→refreshed-hydrated after a detail refetch), which terminates because `selectedDetail.data` is referentially stable between fetches. This preserves the pre-existing `656abc5` anti-oscillation guard through the manifest/detail rework.

The companion arrow-navigation walk (`handleNavigate`, `[...slug].tsx:550-572`) and the modal's predecode-neighbour computation (`modalNeighbourUrls`, `[...slug].tsx:580-594`) both iterate `displayImages` — the active tier — not any raw catalogue, so prev/next inside a semantic-search or similar-image result set walks that set, and the modal predecodes + batch-hydrates (`prefetchImageDetails`) the correct neighbours regardless of which tier is active.

### Debounced semantic search

```ts
const debouncedSearchText = useDebouncedValue(searchText, 300);
const semanticQuery = debouncedSearchText.trim();
const shouldUseSemanticSearch =
    semanticQuery.length > 0 && !semanticQuery.startsWith("#") && !selectedItem;

const semanticSearchResults = useSemanticSearch(
    shouldUseSemanticSearch ? semanticQuery : "",
    50
);
```

300 ms is short enough to feel responsive, long enough to avoid running a full multi-encoder fusion query on every keystroke. Typing a query while a similar-set is open exits that view immediately (`onSearchChange`'s `navigate("/")` call, `[...slug].tsx:775-777`) rather than silently queueing — the same "leave a competing view first" discipline as the filter handlers.

### `#` prefix branches to tag autocomplete, not semantic

Unchanged from the pre-perf-round design: typing `#` triggers the `SearchBar`'s tag dropdown, and the semantic-search trigger explicitly excludes `#`-prefixed text so picking a tag can't accidentally fire a 50-result vector search mid-selection.

### Global keyboard shortcuts

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const cmdOrCtrl = e.metaKey || e.ctrlKey;
    if (cmdOrCtrl && e.key === ",") { /* toggle settings drawer, always available */ }
    if (profiling && cmdOrCtrl && e.shiftKey && (e.key === "P" || e.key === "p")) { /* toggle perf overlay */ }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [profiling]);
```

`[...slug].tsx:96-120`. `cmd+,` toggles the settings drawer. `cmd+shift+P` toggles the perf overlay, only registered when `profiling === true` (gated by `isProfilingEnabled()` resolved once at mount).

### Profiling integration

Unchanged: `isProfilingEnabled()` resolves once at mount; if true, the overlay auto-opens so a user who launched with `--profiling` doesn't have to discover the shortcut. `recordAction` fires at user-action sites throughout this file (settings toggle, folder add, search change, image click/inspect/navigate, masonry reorder/resize, similarity back/rewind, gesture-timer quick-start) — a no-op on the backend when profiling is off.

### Lazy notes loader

Unchanged in mechanism: fetches `getImageNotes(selectedItem.id)` on selection, with a `cancelled` flag guarding against a slow IPC clobbering a fast follow-up during rapid prev/next.

### Similarity breadcrumb trail

```ts
const [simTrail, setSimTrail] = useState<ImageItem[]>([]);
```

New since the last documentation pass. Diving deeper into a similarity cascade (viewing an image's similar-set, clicking one of those results) pushes the *previous* selection onto `simTrail` (`handleImageClick`, `[...slug].tsx:630-632`, guarded to only push when a selection was already active and semantic search isn't). `handleBackHop` pops one hop; `handleRewindTo(index)` truncates to an arbitrary earlier point, rendered as a clickable thumbnail strip above the "More like this" header. The trail clears whenever the user returns to the feed root (`[...slug].tsx:432-435`) — a similarity cascade doesn't survive leaving it, by design.

### Shuffle seed + session-order coordination

```ts
const [shuffleSeed, setShuffleSeed] = useState<number>(() => newShuffleSeed());
const [sessionOrder, setSessionOrder] = useState<number[] | null>(null);
const isResultsView = !!selectedItem || shouldUseSemanticSearch;
const prevResultsView = useRef(isResultsView);
useEffect(() => {
  if (prevResultsView.current && !isResultsView) {
    setShuffleSeed(newShuffleSeed());
    setSessionOrder(null);
  }
  prevResultsView.current = isResultsView;
}, [isResultsView]);
```

`[...slug].tsx:136-194`. The feed re-shuffles on each genuine "entry": launch (the lazy initial `newShuffleSeed()`) and the transition from a results view (similar or semantic) back to the plain feed — not on every render, not on indexing-progress refetches (which reuse the same seed, per `notes/random-shuffle-as-feature.md`). `sessionOrder` (the in-session drag-reorder nudge) is cleared at the same moment, and separately whenever `reorderEnabled` goes false (`[...slug].tsx:468-470`) — reordering is only offered on the unfiltered feed (`reorderEnabled = !selectedItem && !shouldUseSemanticSearch && searchTags.length === 0 && excludeTags.length === 0`), since a reorder rank is meaningless once a filter or search narrows the set.

There is no `sortMode` preference gating any of this — the shuffle is unconditional; see `notes/random-shuffle-as-feature.md` for why and `systems/frontend-state.md` for the removal of the `sortMode` field entirely.

### Typed error catch + format

Unchanged: every IPC call site uses `formatApiError(e)` (from `services/apiError.ts`) for user-visible toasts. `isMissingModelError(e)` remains an unused-programmatically helper — the toast message is still considered sufficient.

## Key Interfaces / Data Flow

### Inputs

| Source | Provides |
|--------|----------|
| URL slug (via `useLocation`) | Selected image id |
| `useFeedManifest` hook | Compact geometry-only manifest, scoped by `searchTags`/`excludeTags`/`tagFilterMode` |
| `useShuffledFeed` | The manifest reordered by stable shuffle key + session reorder |
| `useImageDetail(urlImageId)` | Hydrated detail (tags, full-res url) for the URL-selected image |
| `useTieredSimilarImages` hook | ID-native fused similarity set when an image is selected |
| `useSemanticSearch` hook | ID-native fused text-search set when the search bar has non-`#` text |
| `useUserPreferences` hook | `tagFilterMode`, `imageEncoder`, `columnCount`, `tileScale`, `animationLevel` |
| `usePipelineStats` / `useIsIndexing` | Drive the empty-state branch and the drawer's "All images" total |
| `getTagCounts()` / `useTags()` | Library drawer folder list + per-folder counts |
| `isProfilingEnabled()` IPC | Resolves once at mount; gates profiling code paths |

### Outputs

| Destination | What |
|-------------|------|
| `<Masonry items={displayImages} selectedItem={selectedItem} ...>` | The active tier's set to render |
| `<PinterestModal isOpen={!!selectedItem} neighbourUrls={modalNeighbourUrls} ...>` | Modal driven by selection, predecodes both arrow-nav neighbours |
| `<SearchBar searchTags={...} onChangeTags={...} mode={searchMode} />` | Two-way bound include-filter + text state |
| `<LibraryDrawer includeTagIds excludeTagIds onSelectFolder onSetTagFilter />` | The other half of the shared filter state |
| `<SettingsDrawer open={settingsOpen} onClose={...}>` | Drawer visibility |
| `<PerfOverlay open={perfOpen} onClose={...}>` | Profiling overlay (only when profiling) |
| URL navigation via `navigate("/${id}/")` on tile click | Reflects selection in URL |
| `recordAction(...)` calls at user-action sites | Profiling timeline |

## Implemented Outputs / Artifacts

- A single ~1024-line page component that owns the routing logic (grew from ~700 lines with the manifest/detail split, the drawer's include/exclude wiring, the similarity breadcrumb trail, and the gesture-timer quick-start plumbing).
- Two global keyboard shortcuts (settings + perf overlay).
- Lazy notes loading + cancellation.
- Action-breadcrumb integration for the profiling timeline.
- The similarity breadcrumb trail UI (thumbnail strip + back-one-hop + rewind-to-index).

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| Selection seed can render with stale interim data | URL → page navigation while `useImageDetail` is mid-flight | `seedSelectionItem` supplies `tags: []` and the thumbnail as a full-res stand-in until the hydrated detail lands; briefly correct-but-incomplete rather than blank. Self-heals within one round-trip, faster still if hover/click already prefetched it. |
| Rapid prev/next inside the modal can race the lazy notes load | Holding arrow key | Old `getImageNotes(prev_id)` resolves after `setActiveNotes("")` for the next image, then writes the wrong notes. The cancellation flag prevents this. |
| `shouldUseSemanticSearch` flips on/off as the user types `#`-then-letter-then-deletes-`#` | Fast typing | Each transition triggers a (possibly debounced) re-query. The debounced text + `enabled: false` for empty queries keep this bounded. |
| The seed→upgrade early-return guard is a single equality check (`selectedItem?.id.toString() === pathId`) | A hypothetical future consumer that needs to force a re-seed for the *same* id (e.g. a "refresh this image's detail" action) | Would need to route through a different mechanism (e.g. bump a key) rather than relying on this effect, since the guard is deliberately opaque to same-id changes other than seed→hydrated. |
| `Profiler` wrapper around Masonry runs the `onRenderProfiler` callback in production builds too | Always | The callback short-circuits internally if profiling is off (no `recordAction` fires); minor render-cost overhead from `Profiler` itself. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Programmatic re-download trigger** using `isMissingModelError(e)` — a button in the toast that calls a hypothetical `force_reindex` command. Still unimplemented.
- **Multi-select** for batch tag/note operations — still deferred; would need `prefetchImageDetails`'s batch path exercised at a larger scale than today's 1-2-id calls (see `systems/feed-protocol.md`'s Known Issues on the 500-id chunking never having been driven at size).
- **Drag-and-drop folder add** alongside the dialog plugin path.

## Durable Notes / Discarded Approaches

- **The selection lookup was rewritten from a single-step `.find()` fix into the two-step seed→upgrade model** because the manifest/detail split made a single synchronous lookup structurally impossible — the manifest doesn't carry tags or a full-res URL at all, so there's no "correct" synchronous value to find. The seed step exists precisely to keep the old fix's benefit (instant selection, no blank flash) even though the underlying data model changed shape.
- **The early-return guard on the URL-selection effect is load-bearing, not incidental.** This was true before the rework (the `9d04f69` audit fix) and remains true after: any future edit to this effect that removes the `selectedItem?.id.toString() === pathId` short-circuit risks reintroducing the "Maximum update depth exceeded" oscillation, because `displayImages` and `selectedItem` are mutually dependent by design (selecting an image swaps the grid to a set that structurally excludes the image itself).
- **The library drawer's include set is `searchTags`, not a separate drawer-owned array.** Considered and rejected: two independent tag-selection arrays kept in sync via effects — rejected because "kept in sync via effects" is exactly the pattern that produces the class of bug the coherence passes (`0534bfb..447e557`) were fixing elsewhere in this file (the active-folder highlight, similarly, is derived rather than duplicated).
- **Sort modes are gone; there is no discarded-approach note to preserve here beyond what `notes/random-shuffle-as-feature.md` already documents** — that file owns the shuffle mechanism's history in full.
- **`#` prefix branches to tag autocomplete.** Unchanged reasoning: tag autocomplete is the much more common operation; literal `#` search remains undocumented/unsupported.
- **Profiling overlay auto-opens with `--profiling`.** Unchanged: a user who launched with the flag wanted to see the diagnostics.
- **Action breadcrumbs are fire-and-forget.** Unchanged: awaiting the IPC would add latency to every user-action handler for no user-visible benefit.
- **The 300 ms semantic-search debounce was empirical** and remains unchanged through the fusion-search migration — the number was never about backend load, so ID-native fusion didn't change the right value.

## Obsolete / No Longer Relevant

- The pre-manifest `images.data` / raw-`useImages()` selection lookup is gone entirely — there is no `useImages()` hook anymore, only `useFeedManifest` + `useImageDetail`.
- The four-tier priority chain that separated "tag filter" from "all images" as distinct tiers is gone — both are the same `useFeedManifest` call at different filter-argument values.
- `SortSection`/any sort-mode UI is gone (see `systems/frontend-state.md`).
- The pre-typed-error pattern (`catch(e) { showToast(\`Search failed: ${e}\`) }`) is gone — every catch site uses `formatApiError(e)`.
- The "Pipeline stats UI" item that was tracked as Planned in the prior pass shipped (`StatsSection`, part of the settings-drawer split above) and is no longer a planned item.

## Cross-references

- `systems/feed-protocol.md` § the manifest/detail entity model and delta protocol this file's `feed`/`selectedDetail` are built from
- `systems/frontend-state.md` § query hooks, `useUserPreferences`, the retired `useIndexingProgress`
- `notes/random-shuffle-as-feature.md` § the stable-key shuffle applied to the manifest here
- `systems/masonry-layout.md` § how `displayImages` is packed and rendered
- `systems/multi-encoder-fusion.md` § what `useTieredSimilarImages`/`useSemanticSearch` call backend-side
- `systems/cosine-similarity.md` § the diversity-pool/tiered sampling this route's "similar" tier used to rely on before fusion (still referenced by `notes/random-shuffle-as-feature.md`)
