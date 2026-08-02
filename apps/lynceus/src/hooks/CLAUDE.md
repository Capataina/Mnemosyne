# src/hooks/

Shared stateful and pure-logic hooks. The masonry ENGINE and gesture state machines live here; the pure packing algorithm and renderers they drive live in `components/` (masonryPacking/masonryPacker/MasonryAnchor).

## Map

```
hooks/
├── useMasonryEngine.ts        The layout brain: owns the committed typed geometry, caches
│                              one flattened input per base revision, dispatches packs to
│                              the worker via masonryPacker, virtualises scroll with an
│                              ±800px overscan + guard band, runs the gesture-release state
│                              machine. Exports pure isWithinGuardBand / sameGeometryBasis.
├── useMasonryEngine.test.ts   Guard-band property: "stay" always keeps the on-screen
│                              window strictly inside the committed render range.
├── useTileDrag.ts             Drag gesture: 6px threshold, pixel-exact ghost, published
│                              footprint top quantised to 48px steps (re-pack per step,
│                              not per pointer pixel); release barrier retains the final
│                              footprint until authoritative geometry commits; exactly one
│                              reorder derived from the final rectangle at release.
├── useTileDrag.test.ts        Release-barrier + settle-token assertions (imported tokens).
├── useTileResize.ts           Corner-grip resize: anchorStartColFor preserves the
│                              opposite horizontal edge (right grips fix left, left grips
│                              fix right); publishes the same footprint/pin shapes as drag.
├── useTileResize.test.ts      Anchor arithmetic + preview/visual pure functions.
├── masonryReorder.ts          Pure commit-time reorder: buildIndexMap O(N) once, O(1)
│                              incremental patching (indices outside the touched window
│                              provably unchanged), reorderAtSpatialTarget at release.
├── masonryReorder.test.ts     Equivalence vs a findIndex reference + map-correctness
│                              across arbitrary swap sequences.
├── useShuffledFeed.ts         Deterministic shuffle: per-image key = hash(id, seed), so a
│                              tile's slot depends only on its own id — newcomers pop into
│                              gaps, existing tiles never move (the anti-"whole app
│                              refreshes" design). Fresh shuffle = new seed.
├── useShuffledFeed.test.ts    Determinism, no-loss, stability under pop-in.
├── useIndexingStatus.ts       Module-singleton store over the `indexing-progress` Tauri
│                              event + 1Hz pipeline-stats poll, exposed via
│                              useSyncExternalStore slices (useIndexingStatus,
│                              useIsIndexing, usePipelineStats). Also merges `feed-delta`
│                              batches into the unfiltered manifest cache. The invalidation
│                              policy runs exactly once per event regardless of subscriber
│                              count — never add component-owned polling beside it.
├── useAdaptiveThumbnail.ts    Bucket ladder (480/960/1440/2048, mirrors THUMBNAIL_BUCKETS
│                              in src-tauri commands/images.rs — keep in sync): picks the
│                              bucket covering the tile's device-pixel width; base 480 is
│                              zero-IPC; higher buckets resolve via ["thumbnail", id,
│                              bucket] queries with 5-min gcTime.
├── useAdaptiveThumbnail.test.ts  Fast paths, base-first swap, cached-bucket no-flash,
│                              one query per (id, bucket).
├── useUserPreferences.ts      localStorage("imageBrowserPrefs")-backed prefs behind a
│                              module store + useSyncExternalStore; loose schema with
│                              defaults-merge so old JSON deserialises forward (a removed
│                              field like the dead sortMode is simply dropped; the dead
│                              dinov2_small encoder id migrates to dinov2_base). theme is
│                              mirrored to localStorage["theme"] so main.tsx applies it
│                              pre-mount (no wrong-theme flash); theme "system" mounts a
│                              prefers-color-scheme listener only while selected. Owns
│                              CURRENT_ONBOARDING_VERSION and onboardingVersionSeen
│                              (resetAll preserves it). imageEncoder/textEncoder fields are
│                              LEGACY, ignored — kept so old JSON deserialises.
├── useUserPreferences.test.ts Store semantics.
└── useDebouncedValue.ts       Plain value debounce.
```

## Masonry engine mechanics

- **Release is an explicit state machine**: idle → (footprint appears) active → (final obstacle geometry commits and footprint clears) settling → (final dense pack or ANY newer authoritative pack commits) idle. There is no geometry-adoption branch — clearing an obstacle always requests a real dense pack, and a superseding authoritative generation is allowed to finish settling so a discarded final generation can't strand transitions.
- **Virtualisation numbers**: 240-item synchronous prefix for first paint/large expansion; 800px overscan + 400px guard band for scroll. The engine caches one flattened input per base revision and materialises placement objects only for the visible window. Pointer-only frames write one active wrapper and send an O(1) reuse message — they never trigger the O(N) visible-window scan (culling keys off the stable active ID). A deferred y-range index for the accepted-result scan has its trigger: build it only if profiling shows accepted-result scans are material at 100k (rAF coalescing + the guard band made the O(N) filter rare instead of fast, which was most of the win).
- **Visible IDs stay mounted across gesture and non-scroll repacks**, and anchors render in stable ID order even though placements are feed-ordered — React updates persistent nodes instead of relocating them, preserving the CSS transition start frame for displaced tiles.
- **Placement pins carry the telegraph**: every gesture commit stores `{startCol, top}` (drag: the committed footprint; resize: the previewed rect, on mutation success only). Pins share `sessionOrder`'s lifecycle and ADDITIONALLY clear whenever the pack's coordinate basis changes (`sameGeometryBasis` / `onGeometryBasisChanged` → the route empties the map) because pin tops are absolute pixels in that basis — a stale-space pin can never reserve a void; the arrangement is simply released on reflow.
- **Drag release is WYSIWYG**: the COMMITTED footprint rectangle from the gesture pack — never the raw pixel ghost — is scored by `reorderAtSpatialTarget` against the pre-gesture snapshot with the active tile EXCLUDED (max-overlap/nearest-centre, one ID-based insertion). Dropped-at-source is a slot comparison in the hook (same start column, top within min(height/2, 72px)) — the earlier self-inclusive scoring made every one-column multi-span move a silent no-op, because a wide tile out-overlaps any smaller neighbour on its own vacated rect. The ghost stays at the literal drop rectangle until the worker's dense geometry commits, then its transform animates to zero over the shared settle curve. Concurrent feed deltas merge by stable ID; no interaction state stores a feed index.
- **Resize corner semantics**: the grip picks both moving edges; the diagonally opposite corner stays fixed. Left grips derive the start column from the fixed right edge; top grips derive the exact top from the fixed bottom and clamp whole-span growth before crossing y=0 — upward growth is real solver geometry, not a CSS offset illusion. On pointer-up the footprint stays in `committing` until the route's `mutateAsync` settles (Promise-held preview: no render exists where the preview vanished but the feed still says 1×1, so no stale-span geometry can be adopted), then `settling` behind the retained pixel ghost. Resize shares drag's view-level enable gate: an open selected hero hides grips, blocks new transactions, and cancels an active resize if the gate closes — no footprint can displace the top-left hero.
- **Backend `set_manual_order` is callerless** — resize persists (`manual_col_span`), reorder is deliberately session-only and reshuffle clears it. Reading the Rust commands alone can mislead you into thinking reorder persists; no frontend path calls it.
- **EXIF orientation is not normalised**: a phone image storing rotated pixels plus orientation metadata can display at a different aspect than stored dimensions in WebKit — a latent image-pipeline issue, not a masonry intersection cause.

## The shuffle model (why the feed is always shuffled)

The four legacy sort modes (shuffle/name/added/custom) are gone; the single ordering is `(shuffleKey(id, seed), id)` where `shuffleKey` is a Murmur3-style integer finalizer over `id ^ seed` mapped to [0, 1). The load-bearing property: a tile's position depends only on its own id and the seed — never on list length — so a newcomer pops into its slot without moving anyone (a Fisher-Yates over the array re-places every tile when length changes). The feed additionally gates on `hasThumbnail` so nothing pops in blank. History: pre-Phase-9 the backend shuffled per read ("entire app refreshes" during indexing); 2026-04-26 a naive stable-less shuffle-as-default was tried and removed (reshuffled on every background refetch); b12ba46 replaced both the multi-mode model and the naive attempt with the stable key in one move; 012012c added the incremental fast path.

- **Seed re-rolls only on genuine feed entry**: app launch (lazy initializer) and returning to the plain feed from a results view. Indexing refetches and delta patches reuse the seed.
- **Incremental fast path** (same seed, new array reference — the delta-patched shape): patch/remove over the cached order (no existing id can move; its key is fixed), merge-insert newcomers at their `(key, id)` slot in one linear walk, and return the PREVIOUS array by reference when nothing changed so the pack memo holds. Provably identical to a full rebuild — the comparator is a strict total order the cached array already satisfies; equivalence is test-locked. This is the surviving half of the rejected over-general "incremental shuffle for every mutation" idea.
- **`sessionOrder` is a nudge over the shuffle, not a mode**: listed ids rank by manual position, unlisted newcomers append by shuffle key. Never persisted; cleared on seed re-roll or whenever reorder becomes unavailable.
- **Revisit triggers**: a user-facing sort-mode toggle would need its own stability story or the reshuffle flicker returns in a new form; at 100k the full-rebuild path is still one O(N log N) sort on the main thread (packing is off-thread, the sort is not) — worth watching at larger scale; boards/ collections would need per-board persistent order coexisting with the global shuffle the way `sessionOrder` already does.

## Indexing status + feed-delta consumption

One module-level listener (registered lazily on first subscription, never torn down) owns BOTH `indexing-progress` and `feed-delta` — there is no second event subscription in the app. This replaced per-mount `listen()` calls in the retired `useIndexingProgress`: 2-3 concurrently mounted consumers each fired duplicate invalidations and re-renders per event — the verified render storm (ebe4006). Consumers subscribe to primitive slices, so `message` churn re-renders only the pill, never the grid.

- **Delta application**: `handleFeedDelta` buffers rows; applies if >5s since the last apply; any phase transition AWAY from `thumbnail` force-flushes the buffer. Safe because the backend orders its terminal delta flush before the terminal thumbnail progress emit — every row is client-side before phase logic runs.
- **Phase::Ready reconciliation** (de-duped per run via `readyInvalidatedFor`) is the delta protocol's correctness backstop: force-flush the buffer, then invalidate every `["feed-manifest"]` (filtered and unfiltered — full refetch heals any drift the delta stream couldn't express), `["fused-similar-images"]` + `["fused-semantic-search"]` (mid-index results would serve stale under their 5-min staleTime), and `["thumbnail"]` (a same-root re-index regenerates bucket files at identical paths; the Infinity-staleTime cache would keep serving old pixels).
- **Known risks**: `readyInvalidatedFor` keys on the ready event's `message` string — two runs sharing a terminal message verbatim would skip the second backstop (benign today because messages carry per-run counts; no structural run-id guarantee). The lazy listener registration has no test-pinned ordering guarantee against an event firing before any subscriber exists (benign: the shell mounts a stats consumer very early).

## Traps

- Gesture invariants are load-bearing and test-locked: the release barrier (footprint held until geometry commits), the 48px footprint quantum, and the opposite-edge resize anchor each closed a diagnosed live defect (0d42833/c3c18e7/102d1ad arc). Don't relax them for "simplification".
- Motion assertions in these tests import from `components/masonryMotion.ts`; never re-hardcode durations.
- The shuffle key must stay a pure function of (id, seed). Any dependence on array length or neighbours reintroduces the full-refresh flicker that got shuffle demoted in 2026-04.
- `useIndexingStatus` slices return primitive snapshots so a changing `message` doesn't re-render `useIsIndexing` consumers — keep new selectors primitive.

## Planned work

- **Split `useTileResize.ts` (594 lines): the pure-geometry block (lines 13-167) moves to `components/resizeGeometry.ts`, mirroring drag's existing `masonryReorder.ts`** (modularisation; gate-promoted). Coupling proven zero (no React hook/namespace references in the block); with `export * from "./resizeGeometry"` the importer edit set is EMPTY — external references stay valid as-is (`components/MasonryItem.tsx:4` `ResizeCorner` type, `useTileResize.test.ts:9-16` five names, `components/Masonry.tsx:17` hook only). Constraint: move verbatim — the resize corner suite locks the arithmetic. Settle: suite incl. corner suite + masonryGestureRegression. [code-health-audit 2026-08-02]
