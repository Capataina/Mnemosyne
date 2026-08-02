# src/hooks/

Shared stateful and pure-logic hooks. The masonry ENGINE and gesture state
machines live here; the pure packing algorithm and renderers they drive live in
`components/` (masonryPacking/masonryPacker/MasonryAnchor).

## Map

```
hooks/
├── useMasonryEngine.ts        The layout brain: owns geometry state, dispatches packs to
│                              the worker via masonryPacker, virtualises scroll with an
│                              ±800px overscan + guard band, adopts committed gesture
│                              geometry. Exports pure isWithinGuardBand / sameGeometryBasis.
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
├── useUserPreferences.ts      localStorage-backed prefs behind a module store +
│                              useSyncExternalStore; loose schema with defaults so old
│                              JSON deserialises forward. Owns CURRENT_ONBOARDING_VERSION
│                              and onboardingVersionSeen (resetAll preserves it).
├── useUserPreferences.test.ts Store semantics.
└── useDebouncedValue.ts       Plain value debounce.
```

## Traps

- Gesture invariants are load-bearing and test-locked: the release barrier
  (footprint held until geometry commits), the 48px footprint quantum, and the
  opposite-edge resize anchor each closed a diagnosed live defect
  (0d42833/c3c18e7/102d1ad arc). Don't relax them for "simplification".
- Motion assertions in these tests import from `components/masonryMotion.ts`;
  never re-hardcode durations.
- The shuffle key must stay a pure function of (id, seed). Any dependence on
  array length or neighbours reintroduces the full-refresh flicker that got
  shuffle demoted in 2026-04.
- `useIndexingStatus` slices return primitive snapshots so a changing `message`
  doesn't re-render `useIsIndexing` consumers — keep new selectors primitive.
