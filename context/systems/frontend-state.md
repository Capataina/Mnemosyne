# frontend-state

*Maturity: comprehensive · Stability: stable*

## Scope / Purpose

The shared state layer for the React app. Owns: TanStack Query configuration, the file-based routing setup (`vite-plugin-pages`), the `useUserPreferences` localStorage layer, the singleton `useIndexingStatus` Tauri-event subscription (event stream + delta buffer + cache-invalidation policy in one place), the `useRoots`/`useTags` mutations, the canonical optimistic-mutation pattern every mutation follows, and the settings drawer's split into per-section components.

No global state store exists. `zustand` is no longer even declared in `package.json` (it was present-but-unused from earlier planning as of the last audit; it has since been dropped entirely) — TanStack Query (server state, now split into the manifest/detail entity model below) + `useUserPreferences` (localStorage-backed prefs) + per-page `useState` (transient UI state) covers every state need in the app.

## Boundaries / Ownership

- **Owns:** `queryClient.ts` (cache policy), routing config (`App.tsx` + `vite.config.ts`), the per-resource query hooks (`apps/lynceus/src/queries/*`), the `useUserPreferences` hook + localStorage layout, the singleton indexing/feed-delta event hook (`hooks/useIndexingStatus.ts`), the `useRoots()` + mutations, the settings drawer split (`apps/lynceus/src/components/settings/`).
- **Does not own:** the manifest/delta wire contract itself (see `systems/feed-protocol.md` — that document owns the cross-boundary shapes; this document owns how the frontend *consumes* them into cache), any per-feature query beyond the entity-model hooks listed here, per-page UI state (lives in components via `useState`), the IPC wire format (delegates to `services/*` + `services/apiError.ts`).
- **Public API:** the exported `queryClient`, the `<App />` component composition, `useUserPreferences()`, `usePipelineStats()` / `useIsIndexing()` / `useIndexingPhase()` / `useIndexingStatus()`, `useFeedManifest()` / `useImageDetail()` / `prefetchImageDetails()`, `useRoots()` + add/remove/setEnabled mutations, the implicit contract that all mutations follow `cancelQueries → snapshot → optimistic → onError rollback → onSuccess/onSettled invalidate`.

## Current Implemented Reality

### Query client configuration

```ts
new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: Infinity,         // never auto-stale
            gcTime: 10 * 60 * 1000,      // 10-minute cache lifetime
            refetchOnMount: false,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
            retry: false,
        },
    },
})
```

`apps/lynceus/src/queries/queryClient.ts` — unchanged by v2/the perf round. Aggressive cache policy because:

- This is a desktop app; there's no "user navigates away and comes back" concept
- IPC calls are local — no network costs to retry
- The backend is the single source of truth; staleness happens deterministically (on `Phase::Ready`, or on the feed-delta cadence during indexing) and is handled with explicit `invalidateQueries` — never a background poll of the catalogue itself. (`["pipelineStats"]` is the one query that *does* poll, and only while a run is active — see below.)

### The manifest/detail entity model (replaces the old monolithic `["images"]` cache)

The single largest shape change to this layer. Where the pre-perf-round frontend held one `["images", tagIds, searchText, matchAllTags, sortMode, shuffleSeed]` query returning a full `ImageItem[]` (tags joined, every field populated, one full copy per filter combination), the feed now runs on two entity families:

```
["feed-manifest", tagIds, matchAllTags, excludeTagIds]  →  FeedItem[]   (compact — geometry only)
["image-detail", id]                                     →  ImageItem | null  (hydrated — tags, full-res url)
```

`apps/lynceus/src/queries/useImages.ts` — `useFeedManifest()`, `useImageDetail()`, `prefetchImageDetails()`. The full wire contract behind this split (what the manifest query and the per-id hydration actually fetch, the feed-delta event that keeps the unfiltered manifest patched during indexing, the seed-then-upgrade selection dance) is documented in **`systems/feed-protocol.md`** — that is now the canonical home for the cross-boundary shapes; this file only tracks how the entity model sits inside the query-client layer.

There is no `sortMode` anywhere in this model. The four legacy sort modes (shuffle/name/added/custom) collapsed to one always-shuffled feed keyed by a stable per-image `hash(id, seed)`, applied client-side by `useShuffledFeed` on top of the manifest — never part of the query key, never round-tripped through the backend. See `notes/random-shuffle-as-feature.md` for the shuffle mechanism itself.

### Per-resource hook layout

```
apps/lynceus/src/queries/
├── queryClient.ts        — staleTime: Infinity, no auto-refetch
├── useImages.ts          — useFeedManifest + useImageDetail + prefetchImageDetails
│                           + useAssignTagToImage/useRemoveTagFromImage/useSetManualColSpan (optimistic)
├── useTags.ts            — useTags + useCreateTag + useDeleteTag (optimistic)
├── useRoots.ts           — useRoots + useAddRoot + useRemoveRoot + useSetRootEnabled
├── useSimilarImages.ts   — useTieredSimilarImages (ID-native, fused-RRF backed)
└── useSemanticSearch.ts  — 5-min staleTime, 10-min gcTime, debounced from caller
```

`useSemanticSearch` and `useTieredSimilarImages` both call the ID-native `get_fused_*` commands (multi-encoder Reciprocal Rank Fusion — see `systems/multi-encoder-fusion.md`) but keep their pre-fusion hook names so call sites (`[...slug].tsx`, `PinterestModal`) never needed an import-rename wave. `useSemanticSearch` overrides the global staleTime to 5 minutes — semantic queries are deterministic per-input but the user typically doesn't repeat the exact same query within a session.

### `useUserPreferences` localStorage layer

```ts
export interface UserPreferences {
    theme: ThemeMode;             // "system" | "dark" | "light"
    columnCount: number;          // 0 = auto, else 1..8
    tileMinWidth: number;         // px when columnCount is auto
    tileScale: number;            // multiplier on minItemWidth in auto mode
    animationLevel: AnimationLevel;  // "off" | "subtle" | "standard"
    similarResultCount: number;   // 5..75
    semanticResultCount: number;  // 10..100
    tagFilterMode: TagFilterMode; // "any" | "all"
    imageEncoder: string;         // LEGACY, ignored — kept so old JSON deserialises
    textEncoder: string;          // LEGACY, ignored — same reason
}
```

`apps/lynceus/src/hooks/useUserPreferences.ts:18-52`. **`sortMode` no longer exists on this type at all** — it was removed along with the SortSection settings component when the single shuffled feed replaced the four sort modes; there is nothing left to default. Defaults:

```ts
const DEFAULTS: UserPreferences = {
    theme: "system",
    columnCount: 0,           // auto
    tileMinWidth: 236,
    tileScale: 1.0,
    animationLevel: "standard",
    similarResultCount: 35,
    semanticResultCount: 50,
    tagFilterMode: "any",
    imageEncoder: "dinov2_base",
    textEncoder: "clip_vit_b_32",
};
```

Persisted to `localStorage["imageBrowserPrefs"]` as JSON. `theme` is also mirrored to `localStorage["theme"]` so `main.tsx` can apply it before React mounts (avoids the FOUC of wrong-theme flash). Schema is loose — newly-added fields land at their defaults via merge with `DEFAULTS` so older saved JSON deserialises cleanly. `loadFromStorage` also migrates one dead encoder id (`dinov2_small` → `dinov2_base`) for returning users whose saved prefs point at a removed embedding family.

System theme support: when `prefs.theme === "system"`, the hook listens to `window.matchMedia("(prefers-color-scheme: dark)")` so macOS auto-dark-mode flips the app theme along with everything else.

### `useIndexingStatus.ts` — the single event-derived state module

This is the subsystem that changed shape the most since the last documentation pass. Pre-perf-round, `useIndexingProgress` was a plain hook: each mounted consumer (pill, route, open settings drawer) ran its own `listen()` call and its own event-driven `useState`, so a single `indexing-progress` event fired 2-3 duplicate `["pipelineStats"]` invalidations and re-rendered every consumer per event — the verified "render storm" (`ebe4006`). **`useIndexingProgress` is retired.** It does not exist as an importable name; every consumer now goes through one of the exports below.

The module (`apps/lynceus/src/hooks/useIndexingStatus.ts`) is built on `useSyncExternalStore` over a **module-level singleton listener**:

```ts
// One Tauri listen() call for the whole app lifetime, registered lazily
// on first subscription. Tauri holds the callback; there is no teardown
// because the pill/route/drawer that read it are effectively always
// mounted in the shell.
function subscribe(cb: () => void): () => void
```

Event-derived state (`phase`, `message`, `active`, `eventFraction`) lives in a module-level object, updated once per `indexing-progress` event by `handleEvent`, then broadcast to subscribers via `notify()`. Consumers subscribe to a **primitive slice**, not the whole object, so a subscriber only re-renders when *its* slice's `Object.is` comparison actually changes:

| Export | Subscribes to | Used by |
|---|---|---|
| `usePipelineStats()` | the coarse `active` flag (to drive polling) + the `["pipelineStats"]` react-query itself | the route (`totalVisibleImages`), the settings drawer's `StatsSection` |
| `useIsIndexing()` | `active` only | the route's empty-state branch |
| `useIndexingPhase()` | `phase` + `message` + `eventFraction` | the status pill (needs the live per-image climb) |
| `useIndexingStatus()` | composes the two above | thin compatibility wrapper for any caller wanting both sides at once |

A varying `message` (the human-readable phase detail, which changes on nearly every event) therefore only ever re-renders the pill — never the route, never the grid. This is the direct fix for the render-storm finding: an indexing run's events no longer reach the masonry grid at all.

`usePipelineStats()` is also where the DB-backed snapshot lives: `useQuery({ queryKey: ["pipelineStats"], queryFn: getPipelineStats, refetchInterval: active ? 1500 : false })` — it polls only while a run is active, so an idle app isn't hitting the DB forever, and the poll cost is negligible (a single `SELECT`) regardless of library size.

**The same listener also owns the feed-delta consumer.** `handleFeedDelta` / `applyBufferedDeltas` (`useIndexingStatus.ts:145-184`) buffer and apply `feed-delta` events into the `["feed-manifest"]` cache on the same module-level machinery — registered by the same `subscribe()` call, alongside the `indexing-progress` listener. The delta wire contract, the merge semantics, and the `Phase::Ready` reconciliation fallback are documented fully in `systems/feed-protocol.md`; what belongs here is only that **one listener, one module, drives both the progress UI and the feed's live-update path** — there is no second event subscription anywhere in the app.

Cache-invalidation policy, all inside `handleEvent` (`useIndexingStatus.ts:208-258`):

- Every event → `invalidateQueries(["pipelineStats"])` so the DB-derived numbers track reality between polls.
- Leaving the `thumbnail` phase → flush any buffered feed-delta rows (the backend's terminal delta flush is ordered before the terminal thumbnail progress emit, so every row is guaranteed client-side by the time this fires).
- `phase === "ready"` (de-duped per run via a `readyInvalidatedFor` guard keyed on the terminal message) → drop `["feed-manifest"]` (full reconciliation), `["fused-similar-images"]`, `["fused-semantic-search"]` (results computed mid-index would otherwise serve stale under their 5-minute staleTime), and `["thumbnail"]` (a same-root re-index regenerates bucket files at identical paths; the adaptive-thumbnail cache's `staleTime: Infinity` would otherwise keep serving stale pixels at the old converted URL).

Old hook name preserved as a thin wrapper (`useIndexingStatus()` itself) specifically so the pill's existing mocked tests didn't churn during the rebuild — noted in the `ebe4006` commit body.

### `useRoots` + mutations

```
useRoots()                — read-only listing of roots
useAddRoot()              — optimistic-adjacent insert + invalidate ["roots"] + ["feed-manifest"] on success
useRemoveRoot()           — optimistic remove + invalidate ["roots"] + ["feed-manifest"] on success
useSetRootEnabled()       — optimistic toggle + invalidate ["roots"] + ["feed-manifest"] on success
```

`apps/lynceus/src/queries/useRoots.ts`. The invalidation target changed from `["images"]` to `["feed-manifest"]` along with the rest of the app — root mutations change which images appear in the grid (CASCADE wipe on remove, filter change on enable toggle), and that's now expressed against the manifest key, which in turn drives `useShuffledFeed` → the grid.

### Settings drawer split

`apps/lynceus/src/components/settings/` — the split-out drawer, now 9 files (up from the audit-era split of 8; `EncoderSection.tsx` and `StatsSection.tsx` are the growth, `SortSection.tsx` is gone):

```
apps/lynceus/src/components/settings/
├── index.tsx              — Drawer shell (AnimatePresence + slide animation + esc handler)
├── controls.tsx           — Shared section header + slider/toggle primitives
├── ThemeSection.tsx       — system / dark / light segmented buttons
├── DisplaySection.tsx     — column count slider (0=auto, 1..8), tile scale (0.6..2.0), animation level
├── SearchSection.tsx      — similar / semantic result count sliders, tag filter mode toggle
├── EncoderSection.tsx     — per-encoder enable/disable toggles (replaces the old single-choice dropdowns);
│                           persists via set_enabled_encoders; at-least-one-enabled + dedup/canonicalise
│                           invariants enforced backend-side
├── StatsSection.tsx       — reads usePipelineStats() — the SAME snapshot the status pill reads, so the
│                           two surfaces can never disagree; per-encoder embedding counts + orphan count
├── FoldersSection.tsx     — list of configured roots with per-row enable/remove + add-folder button
└── ResetSection.tsx       — "Reset all settings" button → useUserPreferences().resetAll()
```

**`SortSection.tsx` is gone** — there is no sort-mode UI anywhere in the app; the feed is unconditionally the shuffled/thumbnail-gated manifest. Each section consumes `useUserPreferences` (and the roots/stats hooks where applicable) directly so they remain testable in isolation without prop-drilling.

### Optimistic mutation pattern (canonical)

```ts
useMutation({
    mutationFn: (params) => /* IPC call via service */,
    onMutate: async (params) => {
        await queryClient.cancelQueries({ queryKey: [...] });
        const prevData = queryClient.getQueryData([...]);
        queryClient.setQueriesData([...], optimistic update);
        return { prevData };
    },
    onError: (_err, _vars, context) => {
        if (context?.prevData) {
            queryClient.setQueryData([...], context.prevData);
        }
    },
    onSettled: () => { /* invalidate the affected entity families */ },
});
```

Followed by every mutation in the codebase, now expressed against the manifest/detail entity split rather than one monolithic cache — e.g. `useAssignTagToImage` optimistically stamps the tag onto the hydrated `["image-detail", id]` entity (the manifest carries no tags, so there's nothing to patch grid-side) and, on settle, invalidates `["feed-manifest"]` (folder membership may have changed), `["tagCounts"]`, and the touched `["image-detail", id]`. The reasoning is unchanged from before the split: `staleTime: Infinity` means the only way the UI feels responsive after a mutation is via optimistic updates, and the rollback handles transient IPC failures cleanly.

### `services/*` IPC wrappers

```
src/services/
├── apiError.ts        — ApiError discriminated union + formatApiError + isApiError + isMissingModelError
├── images.ts          — fetchFeedManifest, fetchImageDetails, fetchTieredSimilarImages,
│                         fetchFusedSimilarImages, fetchFusedSemanticSearch, semanticSearch (legacy),
│                         pickScanFolder, setScanRoot, getThumbnail, setManualColSpan
├── feedDelta.ts        — mergeFeedDeltaRows, UNFILTERED_MANIFEST_KEY (see systems/feed-protocol.md)
├── tags.ts             — fetchTags, createTag (default colour), deleteTag, getTagCounts
├── notes.ts            — getImageNotes, setImageNotes
├── roots.ts            — listRoots, addRoot, removeRoot, setRootEnabled
├── stats.ts            — getPipelineStats (the DB-backed snapshot usePipelineStats polls)
└── perf.ts             — isProfilingEnabled, getPerfSnapshot, recordAction (fire-and-forget),
                          exportPerfSnapshot, perfInvoke (wraps invoke with profiling start/end),
                          onRenderProfiler (React.Profiler callback)
```

Hooks call services; components do not call `invoke` directly. Every catch site uses `formatApiError(e)` for user-visible toasts.

## Key Interfaces / Data Flow

### Inputs

- `QueryClientProvider` wrapping `<App />`
- Tauri IPC events (`indexing-progress`, `feed-delta`) — one module-level listener for both
- localStorage (`imageBrowserPrefs`, `theme`)
- `prefers-color-scheme` media query

### Outputs

- React Query cache state, consumed by hooks throughout the app, now split into the manifest/detail entity families
- localStorage writes on every preference change
- Module-level `eventState` updated on every event, broadcast via `useSyncExternalStore`
- `<html class="dark">` toggling on theme change

## Implemented Outputs / Artifacts

- 6 query/mutation hook files in `apps/lynceus/src/queries/` (unchanged count; `useImages.ts` grew the manifest/detail split)
- The singleton `hooks/useIndexingStatus.ts` (replaces the old per-mount `useIndexingProgress`)
- 3 utility hooks in `apps/lynceus/src/hooks/` (debounce, prefs, indexing-status)
- 7 services in `apps/lynceus/src/services/` (added `feedDelta.ts`, `stats.ts` since the last pass)
- 9 settings section components + 1 controls primitive + 1 shell (`apps/lynceus/src/components/settings/`)
- The implicit "every mutation follows the canonical pattern" contract
- Tests: `useUserPreferences.test.ts`, `services.test.ts`, plus the new `useShuffledFeed`/delta-merge test files referenced in `systems/feed-protocol.md`

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| `staleTime: Infinity` means cache can lag if a backend mutation happens outside a frontend mutation | A second app instance edits the DB (today: not possible — single-process), or a manual DB edit | Stale UI until manual invalidation. Acceptable. |
| `useUserPreferences` writes to localStorage in `update`'s setter | Rapid preference toggling | Each write is sync + small; not a bottleneck. localStorage may be disabled in some WebView modes — falls through to in-memory state silently. |
| The module-level `useIndexingStatus` listener registers lazily on first subscription | A very fast indexing run (cache-load-only path on second launch) racing the first mount | An event could in principle fire before any subscriber exists. Currently benign because the app shell always mounts a stats consumer very early, but there's no explicit ordering guarantee pinned by a test. |
| Settings sections all consume `useUserPreferences` directly | Re-renders on every preference change | Each section subscribes to the whole prefs object; React batches re-renders. Not a measured bottleneck. |
| `mutation rollback` doesn't refetch | Backend rejection due to staleness | Cache might restore an obsolete entry. `invalidateQueries`/`onSettled` covers the success path; `onError` doesn't. |
| See `systems/feed-protocol.md` § Known Issues for the delta/manifest-specific risks (filtered-manifest invalidate-only cost, the `isUnfiltered` predicate's hardcoded key shape, the `readyInvalidatedFor` message-based de-dupe) | — | This file intentionally doesn't duplicate them. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Backend-persisted preferences for cross-device sync** if multi-device support is ever added. Today's localStorage-only approach is correct for single-machine.
- **Settings export/import** so a user can share their pref set or move it between machines.
- **Granular cache subscription** if a future profiling pass shows the whole-prefs subscription is causing wasteful re-renders.
- **Build-outside-lock-then-swap** for the fusion-slot refresh at `Phase::Ready` is tracked in `systems/multi-encoder-fusion.md`, not here, but its resolution would change what `useIndexingStatus`'s `ready` handler can assume about search-cache freshness timing.

## Durable Notes / Discarded Approaches

- **The manifest/detail entity split replaced one monolithic `["images"]` cache** because the full-catalogue-with-tags-joined shape amplified badly at scale (200-300k joined rows at 100k images) and every filter combination duplicated a complete `ImageItem[]`. Splitting into compact-geometry-only (manifest) + hydrate-on-demand (detail) collapses per-filter duplication to id+geometry only. Full rationale and the wire contract live in `systems/feed-protocol.md`.
- **`useIndexingProgress`'s per-mount `listen()` pattern was replaced by a module-level singleton** because 2-3 concurrently-mounted consumers each running their own listener meant a single backend event fired that many duplicate invalidations and re-renders — the verified render storm. One listener, `useSyncExternalStore`-published primitive slices, closes it: `message` churn only reaches the pill, never the grid.
- **`zustand` was declared-but-unused at the last audit; it is no longer in `package.json` at all.** TanStack Query handles server state (now via the manifest/detail split), `useUserPreferences` handles persisted prefs, and per-component `useState` handles transient UI. No global store was ever needed.
- **Settings split into per-section files** because the single `SettingsDrawer.tsx` had grown to 466 lines and several sections were independently changing. Each section now owns its UI + reads `useUserPreferences`/relevant hooks directly.
- **`SortSection.tsx` was deleted, not deprecated-in-place**, when the four sort modes collapsed to one shuffled feed — there was no user-facing toggle left to render once shuffle became the unconditional default (see `notes/random-shuffle-as-feature.md` for why shuffle stopped being merely one option among several).
- **Theme is mirrored to a separate localStorage key** so `main.tsx` can apply it before React mounts. Without this, the app would flash with the wrong theme for a moment on every launch (FOUC).
- **System theme listener is mounted only when `prefs.theme === "system"`** — no point listening when the user has explicitly forced dark or light.
- **Optimistic updates with rollback are mandatory.** Without them, the UI feels stale after every tag/root mutation; with them, the UI feels instant. The rollback covers the rare failure case.
- **`perfInvoke` is opt-in per call site, not an automatic interceptor.** A global interceptor would profile every IPC including ones we don't care about; the explicit wrapper makes profiling intent visible at each call site.

## Obsolete / No Longer Relevant

- **`useIndexingProgress` as a per-mount hook is gone.** The name survives only as a thin compatibility wrapper (`useIndexingStatus()`) composing the new primitive-slice hooks — it is not the same implementation, and no consumer calls `listen()` directly anymore.
- **The monolithic `["images", tagIds, searchText, matchAllTags, sortMode, shuffleSeed]` query key is gone.** Replaced by `["feed-manifest", tagIds, matchAllTags, excludeTagIds]` + `["image-detail", id]`.
- **`sortMode` and every sort-mode value (`"shuffle" | "name" | "added" | "custom"`) are gone from `UserPreferences`.** There is nothing to migrate a saved `sortMode` field to; `loadFromStorage`'s defaults-merge simply drops it if present in old JSON.
- The pre-Phase-9 single `SettingsDrawer.tsx` is gone (split into `settings/`). The pre-typed-error `catch(e) { ... }` patterns that interpolated raw strings are gone — every catch site uses `formatApiError(e)`.

## Cross-references

- `systems/feed-protocol.md` — the manifest/delta wire contract this file's entity model consumes
- `systems/search-routing.md` — the priority chain that decides which entity family drives `displayImages`
- `systems/masonry-layout.md` — the grid that renders the manifest this layer maintains
- `notes/random-shuffle-as-feature.md` — the client-side ordering applied on top of the manifest
- `systems/multi-encoder-fusion.md` — what `useSemanticSearch`/`useTieredSimilarImages` actually call
