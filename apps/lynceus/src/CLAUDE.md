# apps/lynceus/src/

React application shell and frontend type declarations. Lynceus is a local-first image browser: React 19 + Vite + TanStack Query 5 + Tailwind 4, talking to the Mnemosyne engine through Tauri IPC (`src-tauri/` owns the host side).

## Map

```
src/
├── App.tsx            Provider stack: BrowserRouter → QueryClientProvider →
│                      ConfirmProvider → OnboardingProvider → BootSplash + routes.
│                      Arms telemetry once iff profiling mode is on.
├── App.css            Global styles: theme tokens consumed via Tailwind, skeleton
│                      shimmer, boot-bar sweep, selected-hero pill reveal.
├── main.tsx           Pre-React theme application (reads localStorage "theme"
│                      before mount so there is no wrong-theme flash; no-pref
│                      default is dark — image-focused app).
├── types.d.ts         Shared frontend types: ImageData (wire), ImageItem
│                      (hydrated), FeedItem (compact manifest entry), Tag, Root,
│                      FeedManifestRowDTO. snake_case fields mirror the backend.
├── vite-env.d.ts      Vite client types.
├── components/        Grid, masonry engine surface, chrome, drawers, ui kit — see its file.
├── features/          Self-contained product features (gesture-timer, onboarding) — see its file.
├── hooks/             Stateful/pure logic hooks: masonry engine, gestures, feed shuffle, prefs — see its file.
├── lib/               cn() class-merge helper — see its file.
├── pages/             Single catch-all route — see its file.
├── queries/           TanStack Query adapters — see its file.
├── services/          Typed Tauri-command clients + telemetry — see its file.
└── test/              Vitest global setup + shared Tauri IPC mock — see its file.
```

## Current state — 2026-08-02

v1.0.0 (`lynceus-ui`). Store-shaped: sandboxed 674MB bundle boots clean, live folder test passed 2026-08-04. The masonry gesture saga is closed (4009be0; the decision ledger lives in `components/CLAUDE.md`); motion tuned at 3d72951; onboarding shipped (19e5621) and geometry-hardened (48f1e2c, 370e80d). Frontend suite: 294/294 vitest tests. Remaining before release is App Store Connect paperwork, not code.

## State architecture

Three layers cover every state need; no global store exists (`zustand` was declared-but-unused from early planning and has been dropped from `package.json` entirely):

1. **TanStack Query** — server state, via the manifest/detail entity model (`queries/CLAUDE.md`).
2. **`useUserPreferences`** — localStorage-backed persisted prefs (`hooks/CLAUDE.md`).
3. **Per-page `useState`** — transient UI state, owned by components.

`sortMode` and its `SortSection` settings UI were deleted, not deprecated, when the four sort modes collapsed to the one always-shuffled feed — nothing reads a sort preference anywhere; the shuffle model lives in `hooks/CLAUDE.md`.

## Invariants

- The single shuffled feed is driven by a compact manifest plus feed-delta reconciliation — never restore whole-library rematerialisation. The grid is never paginated: packing is prefix-dependent and shuffle order is global, so scaling the feed means compact manifests + deltas, not pages.
- No route/chunk lazy-loading (`React.lazy` on Settings/modal/timer): a web instinct that doesn't transfer — JS loads from local disk and JSC lazily compiles unused bodies, so the win is single-digit ms of pre-parse against a cold-shortcut await regression. Reopen only if a web-served build ever ships.
- Masonry packing stays off the main thread over typed arrays with generation-tagged responses; stale worker results must be discarded.
- Indexing status uses a module-singleton `useSyncExternalStore` source, never component-owned polling state.
- The z-index ladder documented in `components/ui/dialog.tsx` is the single authority for stacking; any new fixed/portalled surface slots into it there first.
- Motion tokens live in one place per domain: `components/masonryMotion.ts` for the grid, `features/onboarding/onboardingMotion.ts` for onboarding. Tests assert against the imported tokens, never re-hardcoded numbers.

## Operating manual

- Tests: `pnpm vitest run` from `apps/lynceus/` (happy-dom; `test/setup.ts` shims localStorage and provides the shared Tauri mock).
- Profiling/telemetry mode is the CLI flag `--profiling` (NOT `--profile` — that collides with cargo's flag; see `src-tauri/src/main.rs`). Dev entry: `just lynceus-dev-telemetry`.
- Path aliases: both `@/x` and relative imports appear; match the file you're editing.

## Planned work (2026-08-02 audit — tree-wide batches; single-folder entries live in the owning folders' files)

- **The zero-importer export batch: complete.** `tileUnderPoint` (services/telemetry.ts) landed 2026-08-03 with the telemetry split (F2 — un-exported, its 3 calls stay intra-file). Done earlier the same day: `lowestFreeY` (components/masonryPacking.ts), `useIndexingPhase`/`IndexingPhaseState` (hooks/useIndexingStatus.ts), `MasonryItemData` (components/Masonry.tsx) — landed 2026-08-03 (F4). The onboarding slice landed the same day (F3, `features/onboarding/CLAUDE.md`): the four `*_GRID` scene exports un-exported and `ARRANGE_TILE_FIXTURES` deleted outright as specified; `PRESS_DOWN_MS`/`PRESS_UP_MS`/`FADE_MS` (onboardingMotion.ts) were **deleted rather than un-exported** — un-exporting a zero-caller const fails `tsc --noEmit` under this project's `noUnusedLocals: true`, so the audit's own "defs only, no importers" framing meant deletion was the only build-clean move. tsc clean + 247/247 throughout. [code-health-audit 2026-08-02]
- The meaning-rename batch is complete: `persistNotesSoon` → `persistNotes` (components/PinterestModal.tsx), the `pickContrastingText` comment fix, and masonryPacking.test.ts's header + `ImageItem`→`FeedItem` fixture typing landed 2026-08-03 (F4); services.test.ts:290/328's describe blocks (renamed to `services/images (fused semantic search)` / `services/images (fused similar images)`) landed the same day as the TS half of the legacy-command removal (`services/CLAUDE.md`); the fifth item, GesturePractice's `inspector` → `setupView` track rename, landed 2026-08-03 (F3, `features/onboarding/CLAUDE.md`). tsc clean, suite 247/247 (down from 250 — the legacy-command removal's three orphaned tests). [code-health-audit 2026-08-02, landed]

## Place in the whole

This tree is the entire UI of the Lynceus app. It draws on `src-tauri/` commands (payload shapes mirrored in `services/`) and the shared design tokens in `App.css`/Tailwind config. Product/design context lives in `apps/lynceus/design/` — not here.

## Design register: the images are the most vivid thing on screen, and the code is the record

This register describes the CSS in `App.css` and the components as committed. An earlier design direction called for sharp zero-radius corners, no shadows and a dark-only interface; the shipped code does none of those, and where the two disagree this register records the code.

**Palette, each colour with its job** (OKLCH, shadcn-style tokens; `:root` is the light theme, `.dark` the dark one; the Theme setting offers System, Light and Dark and defaults to System):

```
token                light                      dark                       job
├─ --background      oklch(0.975 0.004 245)     oklch(0.115 0.008 252)     the ground every image sits on
├─ --foreground      oklch(0.19 0.014 250)      oklch(0.935 0.008 245)     primary text
├─ --surface         oklch(0.955 0.006 245)     oklch(0.155 0.01 252)      chrome strips and bars
├─ --surface-raised  oklch(0.995 0.002 245)     oklch(0.19 0.012 252)      drawers and panels above the grid
├─ --surface-overlay oklch(0.985 0.004 245/.94) oklch(0.16 0.012 252/.92)  translucent overlays (inspector, menus)
├─ --surface-sunken  oklch(0.925 0.008 245)     oklch(0.09 0.007 252)      wells and inputs set into a surface
├─ --primary         oklch(0.52 0.105 218)      oklch(0.75 0.085 216)      the one accent: selection, focus ring, active filter
├─ --muted-fg        oklch(0.47 0.018 250)      oklch(0.64 0.016 245)      secondary and inactive text
├─ --border / -strong  hue-245 greys at 13–34% alpha                       single-line edges; never a box around a group
├─ --destructive     oklch(0.56 0.18 25)        oklch(0.67 0.17 25)        only for something genuinely wrong
├─ --success / --warning  hue 158 / hue 75–78                              pipeline health in Settings only
└─ --chart-1..5      dark theme only                                       reserved; the app draws no charts
```

The rules that outlive the values: the images must stay the most vivid thing on screen, so no saturated colour covers a large area of chrome; one accent per surface; a missing measurement (not yet indexed) is drawn differently from a measured zero (no tags).

**Type roles**: one family, DM Sans (falling back to the system sans), base 14px at line-height 1.5 with -0.006em tracking; weight is the only expressive axis. Filenames are shown as the file's own name, truncated at the end with an ellipsis rather than wrapped, because a wrapped name changes tile height and re-packs the column.

**Spacing**: dense by default; the grid would rather show more rows than add padding. There is no separate spacing scale in the CSS; Tailwind 4's default scale is used.

**Corners and depth**: `--radius` is 0.75rem with sm/md/lg/xl steps derived from it; pills use 999px. A grid tile (`components/MasonryItem.tsx`) is `rounded-[14px]` on a `bg-surface-sunken` fill with a 1px inset `ring-border`, rests on `--shadow-soft`, lifts to `--shadow-float` on hover, and takes a 2px `ring-primary/70` when selected; its drag-resize corner brackets are 5px-radius border fragments. Panels and the gesture-timer config use the same rounded and shadow vocabulary. The selection ring is a box-shadow, never a real border, so tile geometry (owned by the packer) never changes with state.

**Motion**: short and physical, decelerating into place; framer-motion drives panels and the drag settle. A reduced-motion setting and `prefers-reduced-motion` turn the onboarding into static captioned filmstrips.

**References**: a Pinterest-style column masonry (taken for the layout), a photographer's contact sheet (density as a virtue), a professional tool whose working area fills the window with thin edge controls. The approved brand mark is `apps/lynceus/design/mark/app-icon-master.svg`; the `logo-terra-*` and `ringed-almond-r1` files beside it are explored alternatives.

**Tried and rejected, as kinds of thing**: a layout packer that re-derived the arrangement on release (a drag preview must be a promise); heavily styled free-floating drawer panels (they invite move and resize); abstract onboarding animations (motion not depicting the real product teaches nothing); anything dashboard-, feed- or editor-shaped.
