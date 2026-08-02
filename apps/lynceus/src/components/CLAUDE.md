# src/components/

Presentation components plus the masonry layout core. The masonry files live
here (not in `hooks/`) because the pure packing algorithm, the worker, and the
anchor/tile renderers form one unit; the stateful engine/gesture hooks that
drive them live in `hooks/` and import from here.

## Map

```
components/
├── Masonry.tsx                    Grid host: wires useMasonryEngine + useTileDrag +
│                                  useTileResize into anchors/tiles; caps settle-time
│                                  prewarm to a few tiles (uncapped prewarm caused
│                                  click-freezes — 133 concurrent searches logged).
├── MasonryAnchor.tsx              Positioned wrapper per tile. Takes motion="live"|"settle",
│                                  settling, placeholder; inline transition tokens from
│                                  masonryMotion; will-change latched only to anchors a
│                                  settle actually moved. Mutates data-masonry-* attrs the
│                                  layout monitor observes.
├── MasonryItem.tsx                The tile itself (memoised): adaptive thumbnail, selection,
│                                  four corner resize grips.
├── masonryPacking.ts              Pure packing domain: occupancy packer, MasonryGestureFootprint
│                                  ({id, span, startCol, top} — startCol is always the physical
│                                  LEFT column), MasonryPlacementAnchor (placement pins),
│                                  buildPackInput/computeMasonryGeometry. Shared verbatim by
│                                  worker and sync fallback — outputs bit-identical.
├── masonryWorker.ts               Web Worker entry; caches input per base revision, pointer
│                                  frames reuse cached arrays.
├── masonryPacker.ts               Worker client: one in-flight computation + one replaceable
│                                  queued request; typed-array transfer; sync fallback
│                                  (offThread=false) when Worker is unavailable.
├── masonryMotion.ts               THE single motion source for the grid: SETTLE_MS 260 /
│                                  ease-out-expo, LIVE_REFLOW_MS 200, SETTLE_CLEANUP_SLACK_MS.
├── masonryGeometry.test.ts        Packer geometry gates.
├── masonryPacker.test.ts          Worker-client queueing/transfer behaviour.
├── masonryPacking.test.ts         Pure pack correctness incl. fuzz-style cases.
├── masonryGestureAnchor.test.ts   Footprint/pin anchor arithmetic.
├── masonryGestureRegression.test.tsx  End-to-end pack regressions for the closed gesture saga.
├── MasonryAnchor.test.tsx         Motion-mode transition tokens + will-change latch states.
├── MasonryItem.test.tsx           Tile render/resize-grip contract.
├── BootSplash.tsx                 z-[300] branded boot overlay; 600ms min display, 5s hard cap,
│                                  hides when the first feed-manifest query settles (success OR
│                                  error). Its role="status" aria-label="Loading Lynceus" node is
│                                  a PUBLIC handshake — see Traps.
├── BootSplash.test.tsx            Locks min-display/hard-cap/late-settle contract (855f4f2).
├── LynceusMark.tsx                Ringed-almond eye SVG (from design/mark/); gradient ids
│                                  prefixed so instances coexist.
├── IndexingStatusPill.tsx         Top-right pipeline pill; all numbers from useIndexingStatus'
│                                  DB-backed snapshot, never raw events; knows the "previews"
│                                  phase ("Preparing larger previews").
├── IndexingStatusPill.test.tsx    Visibility/rendering rules via mocked hook.
├── SearchBar.tsx                  Controlled tag-chips + text input. Parent owns BOTH tag set
│                                  and text (one filter state shared with the library drawer);
│                                  raw untrimmed text goes up, trim happens at point of use.
├── TagDropdown.tsx (+test)        Tag assign/create/delete combobox over ui/command + popover.
├── PinterestModal.tsx             Fullscreen inspector (z-[100]): nav arrows with neighbour
│                                  predecode, tags, notes, gesture-timer entry (auto-start via
│                                  config object identity).
├── SelectedImageTimerPill.tsx     Timer quick-start pill overlapping the selected hero's bottom
│                                  edge; App.css owns its hover/focus reveal.
├── HeroExpandButton.tsx           Top-middle expand-to-inspector affordance on the hero;
│                                  propagation stopped so it never selects the tile.
├── PerfOverlay.tsx                ⌘⇧P diagnostics panel (z-[80/81]); polls perf snapshot 2s.
├── library-drawer/                Left drawer: tag folders + include/exclude filters — see its file.
├── settings/                      Right settings drawer, one file per section — see its file.
└── ui/                            shadcn-style primitives; dialog.tsx documents the z-ladder — see its file.
```

## Current state — 2026-08-02

Masonry is post-milestone stable: occupancy packer + placement pins +
two-layer gesture model (live footprint / settle commit), motion unified in
masonryMotion.ts. No open masonry defects; the deferred optimistic pre-pack
settle idea lives in `docs/engineering/decisions/performance-decisions.md`
with its reopening trigger.

## Traps

- **BootSplash's status node is load-bearing.** `OnboardingProvider` MutationObserves
  `[role="status"][aria-label="Loading Lynceus"]` and auto-opens onboarding only
  after it unmounts. Renaming that role/label silently breaks first-boot
  onboarding; the coupling is commented on both sides — keep both in sync.
- **Never re-hardcode motion numbers.** Durations/easings come from
  `masonryMotion.ts`; tests import the tokens. A literal `duration-400` or a
  ms constant in a component reintroduces the drift 3d72951 killed.
- **Stale worker results.** Pack responses are generation-tagged; a late
  response for an old generation must be dropped, and a worker FAILURE must not
  overwrite an adopted layout (8fa6288). Don't "simplify" the guard away.
- **Prewarm fan-out.** Each prewarmed tile costs a 3-encoder fused search plus a
  detail hydrate. The cap in Masonry.tsx exists because uncapped prewarm froze
  clicks under indexing load; hover still warms any tile on intent.
- **Footprint convention.** `startCol` is the physical left column, always. The
  old left/right/centre edge-reference convention was removed because centre
  was ambiguous for even spans — don't reintroduce it.

## Key findings

- Settle curves that accelerate from zero read as lag even at perfect frame
  rate; the grid decelerates into place (ease-out-expo) by decision (3d72951).
- A starved measurement loop manufactures teleport evidence — the layout
  monitor is armed-when-active precisely because free-running measurement both
  cost frames and faked the jank it reported.
