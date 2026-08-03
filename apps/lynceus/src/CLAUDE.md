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

v0.7.17 (`lynceus-ui`). Store-shaped: sandboxed 674MB bundle boots clean. The masonry gesture saga is closed (4009be0; the decision ledger lives in `components/CLAUDE.md`); motion tuned at 3d72951; onboarding shipped (19e5621) and geometry-hardened (48f1e2c, 370e80d). Frontend suite: 247/247 vitest tests (was 250; the legacy-command-removal batch deleted three orphaned tests, `services/CLAUDE.md`). Remaining before release is repo-external (Apple enrolment, live folder test).

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
