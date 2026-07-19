# Lynceus onboarding animation system — Stage 1 master plan

Status: implementation-ready plan for Stage 2. This file is the complete hand-off; Stage 2 must not need the conversation that produced it.

## Outcome and product contract

Build a first-launch, replayable onboarding overlay made from six short, non-interactive demo scenes. The walkthrough is user-paced: every scene loops until the user chooses **Next**, **Back**, or **Skip**. A fake macOS cursor performs all demonstrated actions on a skeleton version of Lynceus; the real application underneath must never receive a scene interaction.

The experience should feel like Lynceus itself: dark by default, quiet, precise, and fast. It must reuse the app's colour and surface tokens, 14px tile radii, inset rings, and motion language. It must not resemble a generic carousel or a marketing slideshow.

### Decisions locked for Stage 2

| Decision | Locked choice | Why |
|---|---|---|
| Scene count | 6 | Covers the product's distinct user jobs without turning first launch into a feature catalogue. |
| Playback | Each scene loops; scenes do not auto-advance | The user asked for Next/Back/Skip controls, and comprehension time varies. |
| Internal stage | 960 × 600 design pixels, aspect-fitted to the available viewport | Stable coordinates make cursor and tile choreography deterministic at every window size. |
| Scene authoring | Bespoke React scene components in a data-driven registry | The scenes have different visual grammars; a generic beat DSL would become a second animation framework. The registry still centralises order, copy, duration, and reduced-motion frames. |
| Animation engine | framer-motion 12 only | Already installed; no dependency is justified. |
| Motion vocabulary | 260ms settle at `cubic-bezier(0.16, 1, 0.3, 1)`; 200ms live reflow at `cubic-bezier(0.2, 0, 0, 1)` | These are the production tokens in `components/masonryMotion.ts`. |
| Overlay layer | `z-[240]` | It clears drawers 90/91, inspector 100, timer/popovers 200, and timer config 220, while remaining below modal dialogs at 250 (raised from 210 by commit 244b87a after this plan was drafted — a confirm must outrank even onboarding) and the boot splash at 300. |
| Persistence | `onboardingVersionSeen: number`, current version `1`, stored in the existing `imageBrowserPrefs` object and preserved by **Reset all preferences** | A version integer supports future onboarding revisions without introducing another storage system; explicit replay remains the only way to replay. |
| Existing installations | Missing version is treated as `0`, so every installation sees version 1 once | The onboarding is new product education, not merely an empty-database hint. |
| Replay | **Restart onboarding** opens scene 1 without clearing `onboardingVersionSeen` | Replaying should not make onboarding auto-open on the next launch. |

### Hard invariants

1. A scene is decorative and non-interactive. Its complete subtree uses `pointer-events: none`, is `aria-hidden="true"`, and makes no Tauri calls, queries, storage writes, or mutations.
2. Every animated value inside the 960 × 600 scene is `transform` or `opacity`. Do not animate `top`, `left`, `width`, `height`, grid tracks, background position, box shadow, blur, clip paths, or SVG stroke offsets.
3. Every keyframe track is closed: its last value equals its first value. Every timeline ends at normalised time `1`. Looping must not depend on a remount, an opacity flash, or an unobservably fast reset.
4. Within the simulated app, only invariant product chrome may use real text: **Lynceus**, **Add folder**, **Settings**, **Library**, **Folders**, **Refine**, **Must have**, **Must not have**, **Clear**, **Semantic**, **Results**, **More like this**, **Back one**, **Back to all**, **Tags**, **Notes**, **Start session**, **Fit**, **Exit**, and similar labels that never change. Folder names, tag names and counts, filenames, notes, queries, image content, result counts, timer values, progress-phase text, and toggle labels such as Pause/Resume are skeletons or icons.
5. Onboarding titles and explanatory captions are real text because they are the walkthrough's own content, not simulated user data.
6. `prefers-reduced-motion: reduce` and the app preference `animationLevel === "off"` render a static three-frame filmstrip plus captions. Nothing loops or moves. `animationLevel === "subtle"` keeps functional cursor/tile movement but removes click halos and decorative scale accents.
7. The fixed-stage scale may change when the viewport changes, but never during a scene frame. Use one `ResizeObserver` calculation, not per-frame layout reads.
8. The onboarding must remain usable without persistence. If localStorage is unavailable, it can close for the current session and may reappear after relaunch; it must not crash.

## 1. Code-proven feature inventory

This is the capability map Stage 2 should treat as ground truth. README claims that are not backed by the current frontend are separated below instead of being silently promoted into onboarding.

### Launch, local library, and indexing

| User-facing capability | Implemented behaviour | Evidence |
|---|---|---|
| Branded boot state | Lynceus wordmark and indeterminate bar remain for at least 600ms and disappear after the first manifest settles, with a 5s hard cap. | `apps/lynceus/src/components/BootSplash.tsx` (`BootSplash`) |
| Add a folder from the top bar | Native folder picker, duplicate-root guard, then an incremental root mutation and indexing run. | `apps/lynceus/src/pages/[...slug].tsx` (top-bar **Add folder**); `apps/lynceus/src/services/images.ts` (`pickScanFolder`); `apps/lynceus/src/queries/useRoots.ts` |
| Recursive multi-folder library | Multiple roots can be added, removed, or paused while retaining their index; root removal does not touch source files. | `apps/lynceus/src/components/settings/FoldersSection.tsx`; `apps/lynceus/src-tauri/src/commands/roots.rs`; `context/systems/multi-folder-roots.md` |
| macOS sandbox folder access | User-picked roots use security-scoped bookmarks for later launches. | `context/systems/multi-folder-roots.md` (macOS security-scoped bookmarks); `apps/lynceus/src-tauri/src/commands/roots.rs` |
| Automatic indexing pipeline | Scan → model download when missing → thumbnails → enabled encoders → ready/error. New thumbnail rows enter the feed during the run. | `apps/lynceus/src/hooks/useIndexingStatus.ts`; `context/systems/indexing.md`; `apps/lynceus/src-tauri/src/commands/images.rs` |
| Live indexing status | A top-right pill names the active phase, shows phase progress, reports ready/error, and can dismiss terminal states. | `apps/lynceus/src/components/IndexingStatusPill.tsx`; `apps/lynceus/src/hooks/useIndexingStatus.ts` |
| Persistent library coverage | Settings shows image, thumbnail, per-encoder embedding, and orphan counts. | `apps/lynceus/src/components/settings/StatsSection.tsx`; `apps/lynceus/src/services/stats.ts` |
| Adaptive thumbnails | Base 480px previews and 960/1440/2048 buckets keep resized tiles crisp without loading originals into the grid. | `apps/lynceus/src/hooks/useAdaptiveThumbnail.ts`; `apps/lynceus/src-tauri/src/commands/images.rs` (`THUMBNAIL_BUCKETS`, `get_thumbnail`) |
| Background filesystem changes | Launch-configured roots are watched and missing files become orphans instead of losing metadata. Newly added roots have a documented watcher-rebuild gap until relaunch. | `context/systems/watcher.md`; `context/systems/multi-folder-roots.md`; `apps/lynceus/src/components/settings/StatsSection.tsx` |
| Local-first operation | Images stay in place; the database, thumbnails, embeddings, and models are local. Model acquisition is the only planned network dependency. | `README.md` (privacy/offline); `context/systems/paths-and-state.md`; `context/systems/model-download.md` |

### Browse and arrange

| User-facing capability | Implemented behaviour | Evidence |
|---|---|---|
| Virtualised masonry library | Aspect-ratio-preserving absolute-positioned tiles are packed densely and only a viewport guard band is mounted. | `apps/lynceus/src/components/Masonry.tsx`; `apps/lynceus/src/hooks/useMasonryEngine.ts`; `context/systems/masonry-layout.md` |
| Fresh but stable feed | The full compact manifest shuffles on launch and on return from a result view; newly indexed thumbnails pop into unused positions without moving existing tiles. | `apps/lynceus/src/hooks/useShuffledFeed.ts`; `apps/lynceus/src/pages/[...slug].tsx`; `context/systems/feed-protocol.md` |
| Direct drag reorder | On the unfiltered feed, any 1×1 or multi-span tile follows the pointer, reserves a live footprint, displaces neighbours, and settles into the previewed slot. The order is session-only. | `apps/lynceus/src/hooks/useTileDrag.ts`; `apps/lynceus/src/components/Masonry.tsx`; `apps/lynceus/src/pages/[...slug].tsx` (`sessionOrder`) |
| Four-corner resize | Any corner can grow or shrink a tile while keeping the opposite corner fixed. Span is persisted; **Reset all image resizes** clears it. | `apps/lynceus/src/hooks/useTileResize.ts`; `apps/lynceus/src/components/MasonryItem.tsx`; `apps/lynceus/src/components/settings/ResetResizesSection.tsx` |
| WYSIWYG pinned placement | The telegraph reserves the complete rectangle; settle reserves valid placement pins before the normal feed so the released tile lands where previewed and neighbours backfill densely. | `apps/lynceus/src/components/masonryPacking.ts`; `apps/lynceus/src/components/MasonryAnchor.tsx`; `apps/lynceus/src/pages/[...slug].tsx` (`placementAnchors`) |
| Display controls | System/light/dark theme, automatic or fixed column count, tile scale, and off/subtle/standard animation levels update live. | `apps/lynceus/src/components/settings/ThemeSection.tsx`; `DisplaySection.tsx`; `apps/lynceus/src/hooks/useUserPreferences.ts` |
| Tile hover and selection affordances | Standard/subtle animation preferences govern hover treatment; selected, dragged, and resized tiles receive explicit raised states and the selected hero reveals its actions on hover/focus. | `apps/lynceus/src/components/MasonryItem.tsx`; `apps/lynceus/src/components/Masonry.tsx`; `apps/lynceus/src/App.css` |
| Empty and early-index states | The empty library points to **Add folder**; an in-progress library shows skeleton tiles and explains that tiles arrive as thumbnails complete. | `apps/lynceus/src/pages/[...slug].tsx` (empty-state branches); `apps/lynceus/src/App.css` (`.skeleton-tile`) |
| Return home | Clicking the Lynceus wordmark clears active search/filter/similarity state and reshuffles the feed. | `apps/lynceus/src/pages/[...slug].tsx` (`handleGoHome`) |

### Organise and search

| User-facing capability | Implemented behaviour | Evidence |
|---|---|---|
| Create and assign tags | `#` opens autocomplete; a new tag can be created from search or the inspector and assigned/removed per image. | `apps/lynceus/src/components/SearchBar.tsx`; `TagDropdown.tsx`; `PinterestModal.tsx`; `apps/lynceus/src-tauri/src/commands/tags.rs` |
| Delete tags | A two-step inline delete removes a tag globally without nesting a modal inside the tag popover. | `apps/lynceus/src/components/TagDropdown.tsx`; `apps/lynceus/src/queries/useTags.ts` |
| Tag chips and Any/All matching | Selected tag chips can be removed; preferences choose whether images match any selected tag or all selected tags. | `apps/lynceus/src/components/SearchBar.tsx`; `apps/lynceus/src/components/settings/SearchSection.tsx`; `apps/lynceus/src/pages/[...slug].tsx` |
| Tags as folders | The Library drawer automatically presents every tag as a folder with a visibility-matched image count and an **All images** row. | `apps/lynceus/src/components/library-drawer/LibraryDrawer.tsx`; `TagFolderList.tsx`; `apps/lynceus/src-tauri/src/commands/tags.rs` (`get_tag_counts`) |
| Include/exclude refinement | Each tag can be **Must have**, **Must not have**, or off; the sets remain disjoint and **Clear** restores the feed. | `apps/lynceus/src/components/library-drawer/TagFilterList.tsx`; `apps/lynceus/src/pages/[...slug].tsx` (`handleSetTagFilter`) |
| Semantic and filename search | Plain text is debounced 300ms, encoded by all enabled text-capable encoders, fused by RRF, and fused with a fuzzy filename rank signal. | `apps/lynceus/src/pages/[...slug].tsx`; `apps/lynceus/src/queries/useSemanticSearch.ts`; `apps/lynceus/src-tauri/src/commands/semantic_fused.rs` |
| Explicit tag search | `#` queries select/create tags and show a fixed **Tags** mode badge instead of being treated as semantic text. | `apps/lynceus/src/components/SearchBar.tsx`; `apps/lynceus/src/pages/[...slug].tsx` (`searchMode`) |
| Search-state coherence | A drawer filter exits competing semantic/similarity views first, so it always affects the visible feed. | `apps/lynceus/src/pages/[...slug].tsx` (`exitToFeed`, `handleSelectFolder`, `handleSetTagFilter`) |

### Discover, inspect, and practise

| User-facing capability | Implemented behaviour | Evidence |
|---|---|---|
| Multi-encoder visual similarity | Selecting an image retrieves fused CLIP, DINOv2, and SigLIP-2 neighbours through RRF. | `apps/lynceus/src/queries/useSimilarImages.ts`; `apps/lynceus/src/services/images.ts`; `apps/lynceus/src-tauri/src/commands/similarity.rs`; `context/systems/multi-encoder-fusion.md` |
| Similarity cascade | Clicking a result dives deeper; a thumbnail breadcrumb, **Back one**, and **Back to all** preserve navigation. | `apps/lynceus/src/pages/[...slug].tsx` (`simTrail`, `handleBackHop`, `handleRewindTo`) |
| Selected hero actions | The selected image becomes the hero and exposes a direct inspector expand action plus a timer quick-start pill. | `apps/lynceus/src/components/HeroExpandButton.tsx`; `SelectedImageTimerPill.tsx`; `apps/lynceus/src/pages/[...slug].tsx` (`heroOverlay`) |
| Fullscreen inspector | Full-resolution artwork, previous/next controls, left/right keys, Escape, predecoded neighbours, tags, notes, and timer setup. | `apps/lynceus/src/components/PinterestModal.tsx` |
| Per-image notes | Free-form notes load lazily and persist on blur; blank content clears the annotation. | `apps/lynceus/src/components/PinterestModal.tsx`; `apps/lynceus/src/services/notes.ts`; `apps/lynceus/src-tauri/src/commands/notes.rs` |
| Gesture-timer setup | Interval presets/custom value, finite or continuous length, similarity-rank range, repeats, validation, and a duration summary. | `apps/lynceus/src/features/gesture-timer/GestureTimerSetup.tsx`; `GestureTimerConfigPanel.tsx`; `session.ts` |
| Timed reference session | Fullscreen auto-advance with countdown, pause/resume, previous/next, settings, completion, restart, and exit. | `apps/lynceus/src/features/gesture-timer/GestureTimerView.tsx`; `useGestureTimer.ts`; `context/systems/gesture-timer.md` |
| Reference zoom and pan | Trackpad pinch, WebKit gesture events, two-touch pinch, wheel zoom, two-finger or drag pan, double-click/tap fit↔1:1, `+`/`-`/`0`, and visible zoom controls. | `apps/lynceus/src/features/gesture-timer/useGestureZoom.ts`; `GestureTimerView.tsx`; `context/systems/gesture-timer.md` |

### Settings and secondary surfaces

| User-facing capability | Implemented behaviour | Evidence |
|---|---|---|
| Settings shell | Gear button or `⌘,`; right drawer closes by Escape, backdrop, or close button. | `apps/lynceus/src/pages/[...slug].tsx`; `apps/lynceus/src/components/settings/index.tsx` |
| Encoder controls | CLIP, DINOv2, and SigLIP-2 can be enabled/disabled with their role and dimensionality shown; at least one stays enabled. | `apps/lynceus/src/components/settings/EncoderSection.tsx`; `apps/lynceus/src-tauri/src/commands/encoders.rs` |
| Search result-size controls | Settings exposes similar-result and semantic-result sliders. The values persist, but the current route does not consume them; see the drift ledger below. | `apps/lynceus/src/components/settings/SearchSection.tsx`; `apps/lynceus/src/hooks/useUserPreferences.ts`; `apps/lynceus/src/pages/[...slug].tsx` |
| Reset controls | Separate two-step controls reset all manual image spans or all UI preferences. | `apps/lynceus/src/components/settings/ResetResizesSection.tsx`; `ResetSection.tsx` |
| Profiling overlay | A launch-flag-only diagnostics drawer can inspect, reset, and export performance snapshots. This is developer tooling, not normal App Store onboarding. | `apps/lynceus/src/components/PerfOverlay.tsx`; `apps/lynceus/src/services/perf.ts` |

### Documentation claims not safe to teach

| Claim | Current code reality | Onboarding rule |
|---|---|---|
| Separate slideshow mode | No `slideshow` surface exists in the current frontend. The implemented sequence feature is the gesture timer. | Do not mention or animate a slideshow. |
| Paginated infinite scroll | `useFeedManifest` loads a compact full manifest; `useMasonryEngine` virtualises the rendered guard band. | Say “browse large libraries”, not “infinite scroll”. |
| Exact tag-name priority for plain text | Current routing treats plain non-`#` text as fused semantic/filename search. Tags are explicit through `#` or the drawer. | Show semantic text and tag filtering as distinct routes. |
| Manual rescan button in Settings | `FoldersSection.tsx` currently offers add, pause, and remove, but no manual rescan control. | Do not show a rescan button. |
| Search result-count controls affect results | The controls write `similarResultCount` and `semanticResultCount`, but the route currently calls similarity with 30 and semantic search with 50; no production consumer reads the two preferences. | Inventory the controls as visible settings, but do not animate or claim that they currently alter results. Stage 2 must not fix this unrelated wiring gap. |

## 2. Scene list and order

The order follows the user's actual value journey rather than the UI's information architecture:

```text
bring images in → shape the board → organise it → find by language
                 → follow visual links → practise from the result
```

| # | Scene | Loop | Features taught | Why it earns a scene |
|---:|---|---:|---|---|
| 1 | **Bring in your library** | 8,000ms | Add folder, folder picker, indexing pill, incremental thumbnail arrival | The first-launch job must be understandable before any advanced feature matters. |
| 2 | **Arrange it your way** | 12,000ms | Multi-span drag, telegraph, dense neighbour reflow, four-corner resize, pinned settle | This is Lynceus's most tactile and newly stabilised interaction; it deserves the longest scene. |
| 3 | **Organise without moving files** | 9,600ms | Tags-as-folders, live counts as skeletons, include/exclude filters, clear | It explains the distinctive library model without pretending tags are physical directories. |
| 4 | **Search by meaning or name** | 8,400ms | Semantic/filename query, Semantic mode, ranked result transition, clear | Natural-language local search is a core reason to use Lynceus. |
| 5 | **Follow visual connections** | 10,800ms | Visual similarity, selected hero, cascade breadcrumb, inspector, tags/notes | Similarity and inspection form one discovery loop and are clearer together than as two fragments. |
| 6 | **Turn references into practice** | 10,800ms | Gesture timer, auto-advance, zoom, pan, pause/resume, fit, exit | It is the strongest specialist feature and an earned final reveal after discovery. |

### Features merged or deliberately left without their own scene

| Capability | Decision | Rationale |
|---|---|---|
| Multi-root add/remove/pause | Fold into Scene 1's caption and folder-picker composition | A second setup scene would repeat the same mental model. Do not imply that a newly added root is watched before relaunch; the watcher rebuild is a known gap. |
| Indexing phases, model download, adaptive previews, index coverage | Fold the visible status pill and tile arrival into Scene 1; leave backend detail to captions | Users need the outcome, not a pipeline architecture lecture. |
| Tag creation/deletion and per-image assignment | Fold assignment into Scene 5's inspector and filtering into Scene 3 | The two contexts show why tags exist and how they are used. Global deletion is maintenance, not onboarding. |
| Theme, columns, tile scale, animation level | No scene | Familiar preference controls have low discovery risk. The onboarding itself must honour motion preferences. |
| Encoder toggles and index statistics | No scene | Powerful but configuration-heavy; showing them before the user understands search would add cognitive load. |
| Search result-count sliders | No scene | They are currently unwired to route result sizes and must not be advertised as functional. |
| Reset preferences and reset resizes | No scene | Recovery controls are self-describing and do not communicate product value. |
| Feed shuffle, virtualisation, prefetch, watcher, security bookmarks | No scene | These are user benefits or implementation qualities, not interactions worth pantomiming. |
| Profiling overlay | Omit | Developer-only launch mode, not App Store onboarding. |
| Separate slideshow | Omit | Not implemented as a current frontend surface. |
| Local-first privacy | State in the opening caption and final caption | It is a product promise, not a cursor action; do not invent a cloud/offline animation. |

## 3. Motion system and fixed stage

### Internal coordinate system

Every scene renders into the same fixed coordinate plane:

```text
960 × 600 internal stage
┌────────────────────────────────────────────────────────────────────┐
│ 0..72      simulated Lynceus top bar / scene-specific fixed chrome │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│ 72..600    scene workspace: grid, drawer, picker, or modal         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

Outer overlay (not part of the 960 × 600 simulation)
  title + caption
  [Back]      ● ● ● ● ● ●      [Next / Finish]
  Skip
```

`OnboardingStage` receives the available slot size from one `ResizeObserver` and calculates:

```ts
scale = Math.min(1, availableWidth / 960, availableHeight / 600)
```

The 960 × 600 child remains absolutely positioned and is transformed with `scale(scale)` from its centre. The observer may update on a real window resize; scenes must not call `getBoundingClientRect` or measure during animation.

### Shared motion tokens

| Token | Value | Use |
|---|---|---|
| `LIVE_MS` | 200ms | Neighbours acquiring a new live-drag target. |
| `LIVE_EASE` | `[0.2, 0, 0, 1]` | Production live-reflow easing. |
| `SETTLE_MS` | 260ms | Release, modal/card settle, and final geometry adoption. |
| `SETTLE_EASE` | `[0.16, 1, 0.3, 1]` | Production ease-out-expo approximation. |
| `CURSOR_TRAVEL_EASE` | `[0.22, 1, 0.36, 1]` | 420–700ms cursor paths; decelerates into targets. |
| `PRESS_MS` | 90ms down + 110ms up | Cursor scale `1 → 0.92 → 1` and optional click halo. |
| `FADE_MS` | 180ms | Crossfades between pre-rendered state layers. |
| `FADE_EASE` | `[0.16, 1, 0.3, 1]` | All opacity-only entrances/exits unless a timeline explicitly says linear. |
| `STAGGER_MS` | 90ms | Scene 1 tile arrival. |

Use linear easing only for the transform-driven timer progress sweep in Scene 6. Nothing bounces and no spring overshoots.

Timeline shorthand is binding: **Translate** means `CURSOR_TRAVEL_EASE`; **live reflow** means `LIVE_MS` + `LIVE_EASE`; **settle** means `SETTLE_MS` + `SETTLE_EASE`; **crossfade/fade** means `FADE_MS` + `FADE_EASE`; **press** means the 90ms-down/110ms-up press track. A hold has no easing because no value changes.

### Skeleton implementation

Do not apply the existing `.skeleton-tile` animation inside onboarding: it animates `background-position`, which repaints and violates the transform/opacity rule. Reuse its colours, not its animation.

`OnboardingSkeleton` is a static `var(--surface)` / `var(--surface-raised)` shape with `overflow: hidden`. When a one-shot shimmer is called for, a nested sheen element moves from `translateX(-140%)` to `translateX(140%)`; the base never changes paint properties. Most scene skeletons remain static, because constant shimmer across 16 tiles would add noise and unnecessary compositor layers.

### Closed-track representation

Each scene exports the keyframe constants it renders:

```ts
type ClosedTrack<T> = {
  values: readonly T[];
  times: readonly number[]; // begins 0, ends 1, strictly increasing
  ease?: readonly Easing[];
};
```

The scene remains a bespoke React component, but its cursor, tile, panel, and opacity tracks are declared as `ClosedTrack`s. A shared test asserts `values.at(0) === values.at(-1)` (deep equality for tuples/objects), `times[0] === 0`, `times.at(-1) === 1`, and monotonic times. This is the mechanical proof that `repeat: Infinity` cannot jump at the boundary.

## 4. Per-scene storyboards

All coordinates below are internal 960 × 600 coordinates. `P0 = (912, 552)` is the shared cursor parking point and every cursor track starts and ends there.

### Scene 1 — Bring in your library

Title: **Bring in your library**

Caption: **Choose any folder. Lynceus keeps the originals in place and builds the browsable library locally.**

Loop: 8,000ms

#### Stage layout

```text
┌ Library     [search skeleton________________] [Add folder] [Settings] ┐
│                                                                          │
│       ┌──────────── Choose a folder ────────────┐                        │
│       │  ▰  ▬▬▬▬▬▬▬▬▬ skeleton folder row      │   [Scanning ▬▬▬]       │
│       │  ▰  ▬▬▬▬▬ skeleton folder row           │                        │
│       │                         [Cancel] [Add]   │                        │
│       └─────────────────────────────────────────┘                        │
│                                                                          │
│          skeleton masonry tiles arrive here in staggered order           │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Element manifest

| Real invariant chrome | Skeleton-only content |
|---|---|
| Lynceus, Add folder, Settings, Choose a folder, Cancel, Add | Search content, folder names/paths, image tiles, progress phase/percentage/count |

#### Cursor path

`P0 (912,552) → Add folder (842,36) → first folder row (438,228) → Add (612,386) → P0`.

#### Beat timeline

| Offset | Beat | Motion |
|---:|---|---|
| 0–600 | Empty-grid start frame; cursor parked. | Hold. |
| 600–1,150 | Cursor travels to **Add folder**. | Translate, cursor travel ease. |
| 1,150–1,350 | Click. | Cursor press track; button scale `1 → .97 → 1`. |
| 1,350–1,530 | Picker appears above the grid. | Opacity `0 → 1`, scale `.985 → 1`, settle ease. |
| 1,650–2,120 | Cursor enters first skeleton folder row. | Translate. |
| 2,120–2,320 | Click row; a fixed checkmark fades in. | Press; row inset highlight opacity. |
| 2,360–2,760 | Cursor travels to **Add**. | Translate. |
| 2,760–2,960 | Click **Add**. | Press. |
| 2,960–3,140 | Picker leaves; indexing pill enters from `translateY(-8px)` with an activity icon and skeleton phase line. | Opacity/transform only. |
| 3,160–3,790 | Seven tiles enter, 90ms apart. Each scales `.965 → 1`, fades in, and receives one transform-driven sheen pass. | Settle ease per tile. Progress uses `scaleX`, origin left. |
| 3,790–5,100 | Completed library holds. The activity icon crossfades to a check while the phase line remains a skeleton, so no dynamic status text is exposed. | Hold after 180ms crossfade. |
| 5,100–5,520 | Tiles leave in reverse stagger while the terminal check pill fades upward. | Opacity/scale; reverse 60ms stagger. |
| 5,520–6,120 | Cursor returns to `P0`. | Translate. |
| 6,120–8,000 | Empty-grid start frame holds. | Exact start state. |

#### Loop closure

The picker, pill, row selection, progress transform, every tile, every sheen, and the cursor all explicitly return to their time-0 values by 6,120ms. The remaining 1,880ms is the same empty frame shown at 0ms. No element is unmounted to manufacture the reset.

### Scene 2 — Arrange it your way

Title: **Arrange it your way**

Caption: **Drag any tile, resize from any corner, and trust the preview—your board settles exactly where it telegraphed.**

Loop: 12,000ms

#### Stage layout

```text
┌ Lynceus    [search skeleton________________] [Add folder] [Settings] ┐
│                                                                          │
│   A 1×1      B 1×1      C tall      D 1×1                               │
│   E wide     F 1×1      G 1×1      H tall       ~4 × 4 masonry fixture  │
│   I 1×1      J wide     K 1×1      L 1×1                               │
│   M tall     N 1×1      O wide      P 1×1                               │
│                                                                          │
│   active tile = raised skeleton; reserved slot = inset telegraph         │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Element manifest

| Real invariant chrome | Skeleton-only content |
|---|---|
| Lynceus, Add folder, Settings | Search content, all 16 image tiles, any image metadata |

#### Cursor path

`P0 → tile C centre (348,170) → open slot (704,305) → tile F bottom-right handle (472,296) → enlarged F centre (590,350) → F handle (704,472) → F origin → tile C origin → P0`.

#### Beat timeline

| Offset | Beat | Motion |
|---:|---|---|
| 0–500 | Original fixture holds. | Hold. |
| 500–1,000 | Cursor travels to tile C. | Translate. |
| 1,000–1,150 | Press raises C; its original anchor becomes a telegraph. | Cursor press; tile scale `1 → 1.015`; opacity unchanged. |
| 1,150–2,350 | Drag C in a curved path across two rows. The telegraph moves at three quantised targets; neighbours acquire each target over 200ms. | Active tile transform follows cursor; neighbour transforms use live token. |
| 2,350–2,610 | Release. C glides into the telegraph and the placeholder crossfades into the tile without changing geometry. | Settle token. |
| 2,850–3,350 | Cursor travels to tile F's bottom-right grip. | Translate. |
| 3,350–4,240 | Drag the grip until F occupies 2×2 cells. The opposite corner stays fixed and neighbours repack around the full rectangle. | F scale/translate from a precomputed 1×1 frame to 2×2 frame; live neighbour transforms. |
| 4,240–4,500 | Release into the 2×2 telegraph. | Settle token. |
| 4,720–5,150 | Cursor moves to F's body and presses. | Translate + press. |
| 5,150–6,000 | Move the 2×2 tile to a lower-right opening; its 2×2 telegraph displaces every overlapped neighbour. | Transform; three live-reflow targets. |
| 6,000–6,260 | Release. | Settle token. |
| 6,520–7,020 | Cursor moves to F's bottom-right grip. | Translate. |
| 7,020–7,760 | Resize F back to 1×1 in place. | Transform to the authored 1×1 frame; live neighbour reflow. |
| 7,760–8,020 | Release. | Settle token. |
| 8,220–9,140 | Drag F back to its original slot and release. | Transform + live reflow + 260ms settle ending at 9,400. |
| 9,580–10,500 | Drag C back to its original slot and release. | Transform + live reflow + 260ms settle ending at 10,760. |
| 10,760–11,340 | Cursor returns to `P0`; all grips and telegraphs fade out. | Translate/opacity. |
| 11,340–12,000 | Original fixture holds. | Exact start state. |

#### Loop closure

The reset is part of the demonstration, not a hidden rewind: the fake cursor visibly returns F and C to their original slots using the same telegraph and settle behaviour. Every tile's final translate/scale tuple is byte-identical to its initial tuple. The active elevation, placeholder opacity, grip opacity, and cursor also close.

### Scene 3 — Organise without moving files

Title: **Organise without moving files**

Caption: **Tags become folders automatically. Combine what must be present—and what must not—without touching the originals.**

Loop: 9,600ms

#### Stage layout

```text
┌ [Library]  Lynceus   [search skeleton________] [Add folder] [Settings] ┐
│ ┌──────────── Library ───────────┐                                      │
│ │ Folders                        │     masonry skeleton grid             │
│ │ All images              ▬▬     │                                      │
│ │ ▰ ▬▬▬▬▬▬▬              ▬▬     │     filtered tiles crossfade/slide   │
│ │ ▰ ▬▬▬▬▬                ▬▬     │                                      │
│ │ ─────────────────────────      │                                      │
│ │ Refine              [Clear]    │                                      │
│ │ ▰ ▬▬▬▬▬      [+] [-]           │                                      │
│ └────────────────────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Element manifest

| Real invariant chrome | Skeleton-only content |
|---|---|
| Lynceus, Add folder, Settings, Library, Folders, All images, Refine, Must have, Must not have, Clear | Tag/folder names, tag colours if derived from a user tag, counts, search content, image tiles |

Use neutral primary/destructive accents for include/exclude controls. Do not show coloured tag chips with real names.

#### Cursor path

`P0 → Library menu (36,36) → first skeleton folder row (142,214) → second-row plus (304,392) → third-row minus (336,432) → Clear (304,334) → drawer close (332,105) → P0`.

#### Beat timeline

| Offset | Beat | Motion |
|---:|---|---|
| 0–500 | Full grid, drawer closed, cursor parked. | Hold. |
| 500–1,000 | Cursor clicks **Library**; drawer slides from `translateX(-360px)` to `0`. | Travel + press; drawer settle ease; backdrop opacity. |
| 1,300–1,800 | Cursor selects the first skeleton folder. | Travel + press. |
| 1,800–2,200 | Non-members fade and translate down 12px; matching tiles close gaps using authored transforms. A skeleton chip appears in search. | 180ms crossfade + 260ms settle. |
| 2,500–3,000 | Cursor clicks **Must have** on another skeleton tag. | Travel + press. |
| 3,000–3,360 | Grid refines again; the row gains primary emphasis. | Opacity/transform. |
| 3,650–4,150 | Cursor clicks **Must not have** on a third skeleton tag. | Travel + press. |
| 4,150–4,510 | Excluded tiles fade; the row gains destructive emphasis. | Opacity/transform. |
| 4,510–5,500 | Refined result holds. | Hold. |
| 5,500–6,000 | Cursor clicks **Clear**. | Travel + press. |
| 6,000–6,420 | All skeleton rows return to off and the full grid settles back. | Opacity/transform; settle token. |
| 6,720–7,200 | Cursor closes the drawer. | Travel + press; drawer translates out. |
| 7,200–7,850 | Cursor returns to `P0`. | Translate. |
| 7,850–9,600 | Full-grid start frame holds. | Exact start state. |

#### Loop closure

**Clear** restores the original tile set and coordinates before the drawer closes. The drawer, backdrop, search chip, row states, grid tracks, and cursor all return through visible transforms/opacity, ending in the same full-grid frame.

### Scene 4 — Search by meaning or name

Title: **Search by meaning or name**

Caption: **Describe what you remember—or type part of a filename—and local rank fusion brings the strongest matches forward.**

Loop: 8,400ms

#### Stage layout

```text
┌ Lynceus  [ ▬ ▬▬ ▬▬▬ skeleton query________ ] [Semantic] [×] [Settings] ┐
│                                                                          │
│ Results                                                                  │
│                                                                          │
│     ranked skeleton results replace the shuffled feed                    │
│     with a small transform-and-opacity reordering                         │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Element manifest

| Real invariant chrome | Skeleton-only content |
|---|---|
| Lynceus, Add folder, Settings, Semantic, Results | Query text, result count, filenames, all image tiles |

#### Cursor path

`P0 → search field (438,36) → clear control (704,36) → P0`.

#### Beat timeline

| Offset | Beat | Motion |
|---:|---|---|
| 0–600 | Shuffled feed and empty search field. | Hold. |
| 600–1,150 | Cursor travels to and clicks the search field. | Translate + press; focus ring opacity. |
| 1,300–2,300 | Six skeleton glyph bars appear left-to-right to imply typing without exposing query content. | Each glyph opacity/scaleX, 120ms stagger. |
| 2,300–2,520 | Fixed **Semantic** badge enters. | Opacity/translateY. |
| 2,520–3,050 | Feed tiles transform into ranked result positions; unmatched tiles fade while the fixed **Results** heading enters. | Existing tile transforms use settle token; duplicate-only tiles crossfade. |
| 3,050–4,950 | Search results hold. | Hold. |
| 4,950–5,450 | Cursor travels to and clicks clear. | Translate + press. |
| 5,450–5,970 | Result heading/badge/glyphs leave while the original feed transforms back. | Opacity/transform; settle token. |
| 5,970–6,620 | Cursor returns to `P0`. | Translate. |
| 6,620–8,400 | Empty-search feed holds. | Exact start state. |

#### Loop closure

The clear action visibly reverses the query and ranking state. Every result-layer tile has an explicit initial and terminal opacity of zero; every persistent feed tile returns to its initial translate tuple. The search focus ring, skeleton glyphs, badge, heading, and cursor close as tracks.

### Scene 5 — Follow visual connections

Title: **Follow visual connections**

Caption: **Open any image to explore fused visual neighbours, follow a trail, then inspect, tag, and annotate the one that matters.**

Loop: 10,800ms

#### Stage layout

```text
┌ Lynceus  [search skeleton________________] [Add folder] [Settings] ┐
│  More like this                         [Back one] [Back to all]       │
│  [breadcrumb skeleton thumbnails › current]                           │
│                                                                        │
│  selected hero skeleton + similarity skeleton grid                     │
│                                                                        │
│     ┌──────── full inspector ───────────────┬───────────────┐          │
│     │ large image skeleton                 │ Tags  ▬ ▬     │          │
│     │                                      │ Notes ▬▬▬▬▬   │          │
│     └──────────────────────────────────────┴───────────────┘          │
└────────────────────────────────────────────────────────────────────────┘
```

#### Element manifest

| Real invariant chrome | Skeleton-only content |
|---|---|
| Lynceus, Add folder, Settings, More like this, Back one, Back to all, Tags, Notes, previous/next/close icons | Search/query text, image content, thumbnails, filenames, dimensions, tag names/counts, notes |

#### Cursor path

`P0 → feed tile (270,210) → similar tile (612,248) → hero expand control (270,132) → inspector next (864,116) → inspector close (910,116) → Back to all (820,116) → P0`.

#### Beat timeline

| Offset | Beat | Motion |
|---:|---|---|
| 0–600 | Main feed holds. | Hold. |
| 600–1,100 | Cursor clicks a feed tile. | Travel + press. |
| 1,100–1,500 | Chosen tile becomes a larger hero; neighbours transform into a similarity ranking and **More like this** enters. | Settle token + heading opacity. |
| 1,850–2,350 | Cursor clicks a similar tile. | Travel + press. |
| 2,350–2,750 | Results crossfade to the next similarity set; a two-thumbnail skeleton breadcrumb enters with **Back one**. | Opacity/transform. |
| 3,150–3,650 | Cursor clicks the hero's fixed expand icon. | Travel + press. |
| 3,650–3,910 | Inspector backdrop and panel enter. | Backdrop opacity; panel opacity/scale `.97 → 1`, settle token. |
| 3,910–5,050 | Inspector holds: large image skeleton left; tag and note skeletons right. | Hold. |
| 5,050–5,550 | Cursor clicks next. | Travel + press. |
| 5,550–5,910 | Current and next image skeletons crossfade; metadata skeleton widths swap by stacked-layer opacity, not width animation. | Opacity only. |
| 6,250–6,750 | Cursor clicks inspector close. | Travel + press. |
| 6,750–7,010 | Inspector exits. | Opacity/scale. |
| 7,250–7,750 | Cursor clicks **Back to all**. | Travel + press. |
| 7,750–8,200 | Breadcrumb, similarity heading, and hero leave; original feed transforms back. | Opacity/transform; settle token. |
| 8,200–8,850 | Cursor returns to `P0`. | Translate. |
| 8,850–10,800 | Main feed holds. | Exact start state. |

#### Loop closure

The scene exits through the real conceptual route—close the inspector, then **Back to all**—before returning the cursor. Similarity-only layers end transparent at their initial transforms, and every original feed tile closes to its starting translate tuple.

### Scene 6 — Turn references into practice

Title: **Turn references into practice**

Caption: **Build a timed session from similar images, zoom into the reference, pan across it, and let Lynceus keep the pace.**

Loop: 10,800ms

#### Stage layout

```text
┌──────── inspector start frame ────────────────────────┬───────────────┐
│ image skeleton                                         │ Timer setup   │
│                                                        │ ▬▬  ▬▬▬      │
│                                                        │ [Start session]│
└────────────────────────────────────────────────────────┴───────────────┘

┌──────── fullscreen timer frame ───────────────────────────────────────┐
│                       static ring + rotating progress arc              │
│                                                                        │
│                   large reference skeleton (zoom/pan)                  │
│                                                                        │
│  Reference ▬▬       [prev] [play/pause icon] [next] [settings] [Exit]    │
│                                                              [-][+][Fit]│
└────────────────────────────────────────────────────────────────────────┘
```

#### Element manifest

| Real invariant chrome | Skeleton-only content |
|---|---|
| Timer, Start session, Fit, Exit, previous/next/settings/play-pause icons, Reference | Artwork, filename, timer digits, reference position/count, interval/rank/count values, Pause/Resume text |

#### Cursor path

`P0 → Start session (796,500) → zoom plus (884,526) → reference centre (480,300) and drag to (552,332) → Fit (916,526) → Pause (486,548) → same control for resume → Exit (606,548) → P0`.

#### Beat timeline

| Offset | Beat | Motion |
|---:|---|---|
| 0–600 | Inspector with timer setup holds; all configurable values are skeleton bars. | Hold. |
| 600–1,100 | Cursor clicks **Start session**. | Travel + press. |
| 1,100–1,360 | Timer layer enters and inspector leaves underneath. | Opacity only; timer controls translateY `8px → 0`. |
| 1,360–2,050 | Fullscreen reference holds while a transform-driven arc rotates around a static ring. | Arc rotate, linear; no stroke animation. |
| 2,050–2,550 | Cursor clicks zoom plus. | Travel + press. |
| 2,550–2,950 | Reference skeleton scales to `1.42` around the authored focal point; zoom controls become opaque. | Transform/opacity, settle ease. |
| 3,150–3,700 | Cursor drags across the reference, panning it by `(72px,32px)`. | Cursor and artwork translate together. |
| 4,050–4,550 | Cursor clicks **Fit**. | Travel + press. |
| 4,550–4,810 | Artwork returns to identity; zoom controls fade. | Settle token + opacity. |
| 5,150–5,510 | Timer advances: two stacked reference skeletons crossfade; the progress arc returns through a visible continuation track rather than snapping. | Opacity; rotating arc track remains closed. |
| 5,950–6,450 | Cursor clicks **Pause**; the arc holds. | Travel + press. |
| 6,750–7,050 | Cursor clicks the same control to resume; the arc continues. | Press. |
| 7,450–7,950 | Cursor clicks **Exit**. | Travel + press. |
| 7,950–8,260 | Timer fades; the original inspector setup returns exactly. | Opacity/translateY. |
| 8,260–8,900 | Cursor returns to `P0`. | Translate. |
| 8,900–10,800 | Inspector start frame holds. | Exact start state. |

#### Loop closure

The timer exits back to the same inspector frame it started from. The reference transform is reset by **Fit** before exit. Both reference layers, all controls, the progress arc rotation, timer/inspector opacities, and cursor end at their initial values. The progress arc's final rotation is expressed modulo 360° as the same transform value used at time 0, not as `360deg` versus `0deg`, so the deep-equality closure test remains meaningful.

## 5. Reduced-motion fallback

When `useReducedMotion()` is true or `prefs.animationLevel === "off"`, replace the looping scene with a static three-panel filmstrip. It uses the same skeleton rule and scene caption; no cursor, shimmer, progress sweep, crossfade, autoplay, or decorative transition runs. Next/Back/Skip still work normally.

| Scene | Frame 1 | Frame 2 | Frame 3 |
|---|---|---|---|
| Bring in your library | Empty grid + Add folder | Picker with selected skeleton row | Indexed skeleton grid + terminal check pill |
| Arrange it your way | Original 4×4 grid | 2×2 telegraph with displaced neighbours | Arranged grid after settle |
| Organise without moving files | All images | Must-have and must-not-have rows active | Refined grid |
| Search by meaning or name | Skeleton query in search | Semantic badge + ranked results | Cleared search + full feed |
| Follow visual connections | Main feed | More like this + breadcrumb | Inspector with tag/note skeletons |
| Turn references into practice | Timer setup | Fullscreen timed reference | Zoomed/panned reference with Fit control |

Each panel gets a short fixed caption such as **Choose a folder**, **Preview the exact landing place**, or **Inspect and annotate**. Do not animate between panels. On small windows, scale the complete 960 × 600 filmstrip as one unit rather than reflowing its panels and changing authored coordinates.

## 6. Component architecture

### Proposed file surface

```text
apps/lynceus/src/features/onboarding/
├── index.ts
├── types.ts
├── onboardingMotion.ts
├── sceneRegistry.ts
├── OnboardingProvider.tsx
├── OnboardingOverlay.tsx
├── OnboardingStage.tsx
├── OnboardingControls.tsx
├── FakeCursor.tsx
├── primitives/
│   ├── DemoAppChrome.tsx
│   ├── OnboardingSkeleton.tsx
│   ├── SkeletonGrid.tsx
│   ├── SkeletonInspector.tsx
│   └── ReducedMotionFilmstrip.tsx
├── scenes/
│   ├── AddFolderScene.tsx
│   ├── ArrangeScene.tsx
│   ├── OrganiseScene.tsx
│   ├── SearchScene.tsx
│   ├── SimilarityScene.tsx
│   └── GesturePracticeScene.tsx
└── __tests__/
    ├── closedTracks.test.ts
    ├── sceneRegistry.test.ts
    ├── OnboardingProvider.test.tsx
    └── OnboardingOverlay.test.tsx
```

This is a proposed Stage-2 surface, not permission to restructure unrelated feature folders.

### Ownership

| Component | Responsibility | Explicit non-responsibility |
|---|---|---|
| `OnboardingProvider` | Auto-open rule, manual replay, active scene index, completion/skip persistence, boot-ready gate | Scene visuals and timings |
| `OnboardingOverlay` | `z-[250]` modal shell, background inertness, focus trap, title/caption, scene mount, keyboard controls | Scene choreography |
| `OnboardingStage` | 960 × 600 coordinate plane, aspect-fit scale, reduced-motion switch | Window-level modal behaviour |
| `sceneRegistry` | Stable scene order, id, title, caption, duration, component, reduced frames | Per-element animation tracks |
| `FakeCursor` | One SVG pointer, transform track, press state, optional subtle click halo | Hit testing or real DOM interaction |
| `OnboardingSkeleton` | Static user-content placeholder and optional transform-driven sheen child | Existing `.skeleton-tile` background-position animation |
| Scene components | Bespoke composition and exported closed tracks | Persistence, navigation, app queries, real components with interactive state |
| `OnboardingControls` | Back, Next/Finish, Skip, progress, keyboard semantics | Direct scene manipulation |

### Registry shape

```ts
type OnboardingSceneId =
  | "add-folder"
  | "arrange"
  | "organise"
  | "search"
  | "similarity"
  | "gesture-practice";

interface OnboardingSceneDefinition {
  id: OnboardingSceneId;
  title: string;
  caption: string;
  durationMs: number;
  Component: React.ComponentType<OnboardingSceneProps>;
  reducedFrames: readonly ReducedFrame[];
}
```

Keep the registry data-driven and the scene body bespoke. Do not create a JSON animation interpreter. Shared coordinates and tracks are ordinary typed constants imported by the relevant scene.

### Fake cursor specification

- Render a 24 × 30 inline SVG with a macOS-arrow silhouette, off-white fill, 1.25px dark stroke, and a small static drop shadow.
- Position from the arrow tip, not the SVG's bounding-box centre; waypoints in this plan refer to the tip.
- Animate a wrapper with `translate3d(x, y, 0)` and an inner SVG with the press scale. This prevents press scale from shifting the tip's path.
- The click halo is a separate 18px ring using opacity and scale only. It is absent for subtle/reduced motion.
- The cursor never has pointer handlers or focusability.

### Overlay and navigation behaviour

- Stage scenes are keyed by `scene.id`; changing scene mounts its exact frame-0 state and starts its loop from 0.
- **Back** is disabled on scene 1 but retains its space so the footer does not jump.
- **Next** advances one scene. On scene 6 it reads **Finish** and completes onboarding.
- **Skip** is always visible in the overlay header. Escape performs the same action as Skip.
- Left/Right arrow keys call Back/Next unless focus is on a button or other interactive overlay control. Tab stays inside the overlay controls.
- Progress is non-interactive: six dots plus an accessible `Scene N of 6` label. Do not add direct scene-jump controls in Stage 2.
- When the overlay opens, focus **Next** on scene 1. After Back/Next, return focus to the corresponding navigation button. When manual replay closes, return focus to **Restart onboarding**.
- Wrap `Routes` in a dedicated app-content element and apply `inert` and `aria-hidden` to that wrapper while onboarding is open; restore both on close. Never mark `#root` inert, because it also owns the onboarding overlay. Body scrolling is locked for the same lifetime.
- The overlay itself uses `role="dialog"`, `aria-modal="true"`, a title id, and a caption id. The animated stage is `aria-hidden`; the title and caption carry the meaning.

## 7. Integration specification

### User-preference schema

Extend `UserPreferences` in `apps/lynceus/src/hooks/useUserPreferences.ts`:

```ts
interface UserPreferences {
  // existing fields...
  onboardingVersionSeen: number;
}

const CURRENT_ONBOARDING_VERSION = 1;

const DEFAULTS = {
  // existing defaults...
  onboardingVersionSeen: 0,
};
```

The existing `{ ...DEFAULTS, ...parsed }` merge migrates old values automatically. Completion and Skip both call `update("onboardingVersionSeen", CURRENT_ONBOARDING_VERSION)`. Back/Next before the final scene do not persist partial position; a relaunch starts scene 1, which is simpler and deterministic.

`resetAllPreferences()` must preserve the current onboarding version while restoring every actual UI preference:

```ts
store = {
  ...DEFAULTS,
  onboardingVersionSeen: store.onboardingVersionSeen,
};
```

Without that carve-out, clicking **Reset all preferences** would silently schedule onboarding for the next launch even though Settings already provides the explicit **Restart onboarding** action. The reset test must lock this behaviour.

Manual replay sets provider-local `replayOpen = true` and `sceneIndex = 0`; it does not lower the persisted version. Finishing or skipping a replay only closes the local replay state.

### App-level host and boot ordering

Mount onboarding at app level so it can cover every route and drawer:

```text
App
└─ BrowserRouter
   └─ QueryClientProvider
      └─ ConfirmProvider
         └─ OnboardingProvider
            ├─ AppContent wrapper
            │  └─ Routes             inert only while onboarding is open
            ├─ OnboardingOverlayHost  z-250
            └─ BootSplash             z-300
```

`BootSplash` currently owns its `gone` state internally. Stage 2 should add an `onGone` callback and let `App`/`OnboardingProvider` arm auto-onboarding only after the splash's fade has completed. This prevents Scene 1 from spending its first 600–5,000ms looping invisibly behind `z-[300]`.

Do not wait for model download or a complete index. The walkthrough is useful while indexing runs, and Scene 1 explains that state. The host must not read root count to decide whether onboarding is “first launch”; the version preference is the sole trigger.

### Z-layer choice

Current ladder, verified in source:

```text
80/81   indexing pill / profiling drawer
90/91   library and settings drawers
100     Pinterest inspector
200     gesture timer and tag popover
210     confirm/dialog overlay
220     gesture-timer config panel
250     onboarding overlay (new)
300     BootSplash
```

`z-[250]` is deliberate. At `200`, tag popovers or the gesture timer could appear over onboarding during replay. At `300+`, onboarding would cover the boot brand state and start before the app is ready. The 250 slot is the only clean layer between all runtime interaction surfaces and boot.

### Restart entry in Settings

Add a non-destructive single-line **Restart onboarding** control immediately above the existing **Reset all preferences** control in `apps/lynceus/src/components/settings/index.tsx`.

- It uses a replay/rotate icon and the same 40px height, 10px radius, border, type scale, and active transform as `ResetSection`, but normal foreground/secondary colours—never destructive red and never a two-click arm.
- `SettingsDrawer` calls its own `onClose()` first, then schedules `restart()` on the next animation frame so the drawer's focus restoration and exit animation cannot fight the onboarding focus trap.
- The provider retains a ref to this trigger and restores focus to it when replay closes. If the settings drawer has unmounted by then, focus the Settings button as the fallback.
- The entry is present regardless of whether onboarding version 1 has been completed.

### Interaction with app animation preferences

| State | Onboarding behaviour |
|---|---|
| OS `prefers-reduced-motion: reduce` | Static filmstrip, always. |
| App animation level `off` | Static filmstrip, even if OS allows motion. |
| App animation level `subtle` | Full functional choreography, but no click halo, no decorative tile scale-up, and opacity travel capped at 180ms. |
| App animation level `standard` | Full storyboard in this plan. |

The onboarding must not change the user's animation preference.

## 8. Stage-2 implementation order and verification

Execute in this dependency order. Each step is complete only when its check passes.

1. **Extend the preference store without changing existing preference behaviour.**
   - Add `onboardingVersionSeen`, default `0`, and `CURRENT_ONBOARDING_VERSION = 1`.
   - Preserve the seen version when resetting UI preferences.
   - Add tests for missing-field migration, completion persistence, reset-preserves-completion behaviour, and localStorage failure fallback.
   - Verification: `useUserPreferences.test.ts` passes; existing theme/display/search preference tests remain green.

2. **Build the closed-track and motion-token foundation.**
   - Add shared tokens, `ClosedTrack`, closure assertions, `FakeCursor`, `OnboardingSkeleton`, `DemoAppChrome`, and the fixed stage scaler.
   - Do not import the existing `.skeleton-tile` animation.
   - Verification: every shared track fixture passes first=last and time-bound tests; a DOM test confirms scene roots are `pointer-events:none` and `aria-hidden`.

3. **Build provider, overlay shell, and boot handshake before any scene-specific detail.**
   - Add auto-open, Skip/Finish, replay state, scene navigation, focus trap/return, body lock, app inertness, `z-[250]`, and `BootSplash.onGone`.
   - Use a placeholder closed scene for this step.
   - Verification: tests cover boot-before-onboarding ordering, first-view auto-open, no re-open after completion, replay without persistence reset, Escape=Skip, Back/Next bounds, and focus restoration.

4. **Implement Scene 1 and make it the visual-quality reference.**
   - Establish all surfaces, type sizes, skeleton contrast, cursor size, and caption spacing here before copying primitives elsewhere.
   - Verification: two uninterrupted live loops show identical wrap frames; DevTools paint flashing shows no repeated scene-wide paint; no console errors or Tauri calls occur.

5. **Implement Scene 2 against authored geometry maps.**
   - Store the 16 tile start, live-target, settled, and restored transforms as explicit fixtures. Do not mount production Masonry or run its pointer hooks.
   - The active tile must follow the cursor, the telegraph must reserve its full span, neighbours must use 200ms live reflow, and the active tile must adopt the telegraph with 260ms settle.
   - Verification: closure tests cover every tile; a frame-by-frame screen recording confirms no tile jumps at drag, resize, restore, or loop wrap.

6. **Implement Scenes 3–6 one at a time, preserving the closed-track gate.**
   - Register a scene only after all its exported tracks close and its fixed/user-content text classification matches the manifest above.
   - Verification after each scene: registry count increments by one; track tests pass; source inspection shows only transform/opacity in animated props.

7. **Implement the reduced-motion filmstrips from the same scene fixtures.**
   - Use three static frames per the table in §5; no Framer repeat or CSS animation remains mounted in reduced mode.
   - Verification: mock `useReducedMotion=true` and `animationLevel=off`; assert no element has an animation/transition style and all six scenes still expose title/caption/navigation.

8. **Add the Settings replay entry in the exact requested position.**
   - Place it immediately above `ResetSection`, close Settings before replay, and restore focus on exit.
   - Verification: rendered settings order is `... Library index → Restart onboarding → Reset all preferences`; clicking replay opens scene 1 and leaves `onboardingVersionSeen` unchanged.

9. **Run the complete behavioural and compositor verification.**
   - `pnpm` frontend typecheck exits 0.
   - Full Vitest suite exits 0, including registry, closure, persistence, navigation, focus, and reduced-motion tests.
   - Production frontend build exits 0.
   - In a live Tauri WebView, exercise: fresh preference state, Skip, Finish, Back/Next, Escape, replay from Settings, window resize during a scene, OS reduced motion, app animation Off/Subtle/Standard, and localStorage failure simulation.
   - Record two loops of every animated scene. Compare the first and wrap frames side-by-side; no visible pixel jump is acceptable.
   - Record a browser performance trace for one full loop of Scene 2. The animation interval must show no repeated layout work and no scene-wide paint storm; moving layers should be compositor-promoted only while active.
   - Run `rg -n 'z-\[[0-9]+' apps/lynceus/src --glob '!**/*.test.*'` and confirm onboarding remains above 220 and below 300.

10. **Audit scope before hand-off.**
    - Confirm no new dependency was added.
    - Confirm no existing production feature was refactored except the minimal preference field, BootSplash callback, host mount, and Settings entry required by this plan.
    - Confirm no scene contains real user content or a real interactive child.
    - Verification: final diff matches the proposed onboarding surface plus those four named integration seams; every other change is treated as scope drift.

## 9. Risks, constraints, and open questions

### Risks Stage 2 must actively control

| Risk | Trigger | Consequence | Control |
|---|---|---|---|
| Loop looks closed in code but jumps visually | Equivalent transforms are expressed differently, a layer remounts, or a 360° value wraps to 0° | The defining requirement fails at the exact loop boundary. | Closed-track tests plus two-loop frame comparison; use identical first/last values, not merely equivalent values. |
| Scene 2 teaches an approximation that drifts from production | Hand-authored geometry ignores full-span telegraph or settle timing | Onboarding promises a feel the real grid does not have. | Mirror rectangle reservation, live reflow, pinned settle, and production motion tokens; do not imitate the obsolete one-point/column-only system. |
| Skeleton shimmer causes paint storms | Reusing `.skeleton-tile` animates background position on many tiles | Onboarding itself feels janky. | Static skeleton base plus one-shot translated sheen; verify with paint flashing. |
| Auto-onboarding starts behind BootSplash | Provider opens as soon as preferences hydrate | Scene 1 is halfway through when the user first sees it. | Explicit `BootSplash.onGone` gate. |
| Replay fights the open Settings drawer | Both focus traps and exit animations remain active | Broken focus, Escape behaviour, or a visible drawer over/under overlay. | Close Settings, wait one animation frame, then replay; onboarding at z250. |
| Reset preferences unexpectedly re-arms onboarding | `resetAllPreferences()` copies the version-0 default over a completed version | Onboarding opens on the next launch without the user choosing replay. | Preserve `store.onboardingVersionSeen` during reset and test it. |
| Existing users are surprised by auto-open | New preference field defaults to unseen | One-time interruption on first launch after upgrade. | Keep Skip persistent and always visible. This is an accepted product call for version 1. |
| Small windows make skeleton chrome illegible | Stage scale becomes too small while outer controls consume height | The demo is technically present but unreadable. | Reserve outer controls first, aspect-fit the stage, and live-test the app's minimum supported window. If scale drops below 0.58, show the reduced-motion filmstrip layout even when motion is allowed. |
| App animation level and onboarding disagree | Replay after user selected Off/Subtle | Onboarding violates an explicit preference. | Behaviour table in §7 is binding. |
| localStorage unavailable | WebView privacy/storage failure | Onboarding returns next launch. | Catch writes as the existing store does; close in memory and accept non-persistence rather than blocking use. |
| User-content text leaks into mock UI | An implementer uses realistic folder/tag/query examples | Violates the mandated skeleton rule and may imply bundled content. | Manifest review plus a test/grep list of the only allowed in-stage text literals. |
| Scene claims watcher immediacy after adding a root | The known watcher-rebuild gap remains | Onboarding promises automatic changes that require relaunch for a newly added root. | Scene 1 demonstrates initial indexing only; caption avoids watcher claims. |
| Unrelated bugs get pulled into onboarding scope | Search result-count controls or README drift are noticed during Stage 2 | Delivery expands into product refactoring. | Record them here, do not fix them in Stage 2. |

### Human decisions that would change this plan

The plan is intentionally autonomous and has no blocking design question. The only product choices worth revisiting before Stage 2 are these; absent a new directive, the locked choices above stand:

1. Whether existing installations should see onboarding version 1 automatically. This plan says yes once; changing that means distinguishing an empty/new install from an upgraded install rather than using only the version preference.
2. Whether six scenes are acceptable for App Store launch. This plan keeps them short and user-paced; if a hard maximum is later imposed, merge Scenes 4 and 5 before cutting Scene 6, because semantic and visual discovery share a result-grid grammar.
3. Whether a future real logo will land before Stage 2. If it does, use the same asset in BootSplash and demo chrome; otherwise retain the existing Lynceus wordmark and do not invent a temporary mark.

## 10. Acceptance checklist

- [ ] Six scenes exist in the exact order in §2.
- [ ] Scene 1 performs Add folder → picker row → Add → staggered tile arrival.
- [ ] Scene 2 performs drag/reflow/release, resize to 2×2, move, resize to 1×1, and a visible closed reset.
- [ ] Every scene's final visual state is identical to its initial state.
- [ ] Every in-scene animated property is transform or opacity.
- [ ] Fixed 960 × 600 coordinates scale to the viewport without per-frame measurement.
- [ ] Fake cursor is SVG, macOS-style, decorative, and non-interactive.
- [ ] All images, filenames, folders, tags, counts, notes, queries, and timer values are skeletons.
- [ ] Only invariant simulated chrome and onboarding copy use real text.
- [ ] Reduced motion and animation Off render static three-frame filmstrips.
- [ ] No dependency is added.
- [ ] Auto-open waits until BootSplash has actually gone.
- [ ] Skip and Finish persist onboarding version 1.
- [ ] Restart onboarding sits immediately above Reset all preferences and does not reset persistence.
- [ ] Onboarding is z250: above app interactions, below BootSplash.
- [ ] Scene subtree cannot interact with the real application.
- [ ] Typecheck, full Vitest, production build, live WebView pass, loop-frame comparison, and compositor trace all pass.
