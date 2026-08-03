# src/features/onboarding/

First-boot tutorial: six looping skeleton demos with a fake cursor, replayable from Settings. Shipped 19e5621; geometry re-architected 48f1e2c after the first build's hand-typed coordinates failed a live pass (cursors clicking beside buttons, tiles off the stage); two residual margin-collapse misses fixed 370e80d.

## Architecture — the two rules everything obeys

1. **Every coordinate is derived, never typed.** Layout is declared ONCE as rects/grid cells (in `sceneGeometry.ts` for chrome, in a scene's GEOM block for its own elements); styles, telegraphs, cursor waypoints, and translate/scale strings are all computed from those rects. Hand-typing a pixel pair in two places is the exact failure class this replaced.
2. **Every keyframe track is closed.** Each track ends exactly where it begins (times 0→1, last value === first), enforced registry-wide by `__tests__/closedTracks.test.ts` — scenes loop seamlessly.

## Map

```
onboarding/
├── index.ts                 Public surface: OnboardingProvider, useOnboarding, sceneRegistry.
├── OnboardingProvider.tsx   Context + persistence (one integer, onboardingVersionSeen, in
│                            useUserPreferences). Auto-opens once on first boot AFTER the
│                            BootSplash status node unmounts — a MutationObserver on
│                            [role="status"][aria-label="Loading Lynceus"] (see Traps).
│                            Wraps app content inert/aria-hidden while open; restart()
│                            replays without touching persistence.
├── OnboardingOverlay.tsx    z-[240] fullscreen shell: focus trap, Escape=skip, progress
│                            dots, Back/Next/Skip.
├── OnboardingStage.tsx      Scales the 960×600 stage to fit; below scale 0.58, or under
│                            prefers-reduced-motion / animation-off prefs, renders the
│                            static three-frame filmstrip instead of the live scene.
├── OnboardingControls.tsx   Back/Next footer row.
├── FakeCursor.tsx           Animated pointer + press halo driven by a CursorFrame track.
├── sceneGeometry.ts         Rect/Point primitives (rect, centre, moveTo, mapTo, makeGrid,
│                            rectStyle), STAGE 960×600, the CHROME rects every scene
│                            targets, SceneGeometryManifest type.
├── sceneRegistry.ts         The accepted six-scene order + durations (locked by test):
│                            add-folder 7000 · arrange 8400 · organise 7500 · search 7000
│                            · similarity 9000 · gesture-practice 11200.
├── onboardingMotion.ts      Onboarding's own motion tokens (LIVE 200 / SETTLE 260 mirror
│                            the grid's feel) + visualFrame/visualTrack/cursorTrack
│                            helpers, CURSOR_PARK, plus two pattern extractions:
│                            pressAt(p) (an in-place arrive/press/release triple) and
│                            holdTrack(times, {hidden, shown, easeIn, easeOut}) (a
│                            hidden→shown→hidden six-keyframe hold).
├── types.ts                 Scene ids, ClosedTrack<T> + assertClosedTrack, frame types.
├── primitives/              Skeleton chrome/grid/inspector + reduced-motion art, incl.
│                            reducedFrames(kinds) (a scene's three static frames from
│                            its `[kind, caption]` pairs) — see its file.
├── scenes/                  The six scene components — see its file.
└── __tests__/               closedTracks (loop closure, registry-wide), sceneGeometry
                             (manifest invariants: rects in-stage, clicks centred on
                             targets, layouts pairwise non-overlapping), sceneRegistry
                             (order/durations/filmstrip frames), Provider + Overlay
                             behaviour tests.
```

## Traps

- **The BootSplash handshake.** The provider was forbidden from editing BootSplash, so it observes that component's exact `role="status"` + `aria-label="Loading Lynceus"` node and arms auto-open only after it unmounts. Rename either attribute and first-boot onboarding never opens — no test currently spans the two components; the paired comments are the guard.
- **CSS margin collapse vs flex-gap stacking** (370e80d). Adjoining sibling margins COLLAPSE to their max (AddFolderScene: mb-2 + mt-4 → 16, not 24); a flex `gap` plus an item's own margin do NOT collapse — they stack (GesturePracticeScene's Exit button). The invariant tests check the manifest against itself and structurally cannot see markup-vs-constant divergence, so the derivation comments at those junctions ARE the guard. When deriving a new rect from Tailwind flow arithmetic, re-derive by the CSS rules, not by summing.
- **Persistence semantics.** Reset-all-preferences deliberately preserves `onboardingVersionSeen`; Skip and Finish both persist; Settings' replay bypasses persistence entirely. Bump `CURRENT_ONBOARDING_VERSION` (in useUserPreferences.ts) only to force a re-showing for every user.
- Real text appears only on invariant chrome (a plan whitelist); user content is always skeleton bars.
- **`holdTrack` omits its `ease` array when `easeIn`/`easeOut` are left unset**, exactly matching a literal `visualTrack(values, times)` call with no third argument (e.g. Arrange's `grips`). Passing `"linear"` explicitly instead would still animate identically through framer-motion, but would stop being a bit-identical `ClosedTrack` object — pass nothing, not `"linear"`, when a track never varied its easing.
- **Drag presses stay hand-built.** `pressAt()` covers only the same-point arrive/press/release case; a press whose release lands elsewhere (Arrange's drags, GesturePractice's pan) is hand-typed `cursorFrame` lines by design. (The old shared-boundary double-press on GesturePractice's pause button died in the 2026-08-03 v2 rebuild — every remaining press in the tree is either a clean `pressAt` triple or a drag.)

## 2026-08-03 v2 rebuild (landed, same day as the audit migration below)

All six scenes were rebuilt in one six-agent parallel pass after a live founder review — one agent per scene file, orchestrator-owned shared surfaces. The through-lines: every beat is causally motivated (the cursor or the timer visibly causes each change; the uncaused loop-restore motions v1 used are gone — Arrange's closing swap became a deliberate drag, GesturePractice's reference swap is caused by the countdown hitting zero); trailing dead time is eliminated in every scene (~200-400ms parked tails, durations retimed to 7.0/8.4/7.5/7.0/9.0/11.2s); and the scenes now mirror the current app (edge slide-out panels in AddFolder/Organise, thin ring-primary hover instead of the deleted expand pill in Similarity, PinterestModal's header-outside-scroll inspector, the gesture history strip). Two mechanical bug classes were found and fixed in Similarity: mixed one-arg/two-arg `scale()` frames in a single track break framer-motion string interpolation (keep one transform template per track — the "weird image" bug), and header-band rects are now declared in the manifest's disjoint sets so label-vs-tile overlap is test-pinned. `SkeletonInspector.tsx` lost its last consumer and was deleted. The audit-migration counts below (press/holdTrack call sites) describe the pre-rebuild tree and no longer match — kept for the trap reasoning, not the numbers.

## 2026-08-03 audit migration (landed)

The 2026-08-02 audit's four extraction/naming/export items landed in one pass: `pressAt(p)` (in `onboardingMotion.ts`) covers 22 of the 23 conforming press-frame instances via 21 call sites (AddFolder 3, Organise 6, Similarity 6, Search 2, GesturePractice 5 — start/plus/fit/exit clean, pause's first press via `pressAt`, its second press/release hand-typed; see Traps); `holdTrack(times, {hidden, shown, easeIn, easeOut})` replaced all 21 candidate hold tracks (AddFolder 4, Arrange 1, Organise 5, Search 2 fixed + its `glyphTrack` factory reimplemented on top, Similarity 4, GesturePractice 5); `reducedFrames(kinds)` (in `primitives/ReducedMotionFilmstrip.tsx`) replaced all six scenes' `reducedKinds.map` blocks; GesturePractice's `inspector` track/key/usage renamed to `setupView`. Migration was verified by a temporary deep-equal spot check (old literal vs. helper output, since deleted) plus the full onboarding suite and `tsc --noEmit`, both clean throughout.

Un-exported in the same pass (tree-wide zero-importer batch, `src/CLAUDE.md`): the four `*_GRID` scene constants. `PRESS_DOWN_MS`/`PRESS_UP_MS`/`FADE_MS` in `onboardingMotion.ts` were **deleted rather than un-exported** — the audit called for un-export, but with zero internal callers, un-exporting them under this project's `noUnusedLocals: true` fails `tsc --noEmit` (`TS6133`); deleting was the only build-clean option and they carried no external references to preserve. `ARRANGE_TILE_FIXTURES` was deleted outright as specified (also zero importers).
