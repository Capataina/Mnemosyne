# src/features/onboarding/

First-boot tutorial: six looping skeleton demos with a fake cursor, replayable
from Settings. Shipped 19e5621; geometry re-architected 48f1e2c after the first
build's hand-typed coordinates failed a live pass (cursors clicking beside
buttons, tiles off the stage); two residual margin-collapse misses fixed 370e80d.

## Architecture — the two rules everything obeys

1. **Every coordinate is derived, never typed.** Layout is declared ONCE as
   rects/grid cells (in `sceneGeometry.ts` for chrome, in a scene's GEOM block
   for its own elements); styles, telegraphs, cursor waypoints, and
   translate/scale strings are all computed from those rects. Hand-typing a
   pixel pair in two places is the exact failure class this replaced.
2. **Every keyframe track is closed.** Each track ends exactly where it begins
   (times 0→1, last value === first), enforced registry-wide by
   `__tests__/closedTracks.test.ts` — scenes loop seamlessly.

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
│                            add-folder 8000 · arrange 12000 · organise 9600 · search 8400
│                            · similarity 10800 · gesture-practice 10800.
├── onboardingMotion.ts      Onboarding's own motion tokens (LIVE 200 / SETTLE 260 mirror
│                            the grid's feel) + visualFrame/visualTrack/cursorTrack
│                            helpers, CURSOR_PARK.
├── types.ts                 Scene ids, ClosedTrack<T> + assertClosedTrack, frame types.
├── primitives/              Skeleton chrome/grid/inspector + reduced-motion art — see its file.
├── scenes/                  The six scene components — see its file.
└── __tests__/               closedTracks (loop closure, registry-wide), sceneGeometry
                             (manifest invariants: rects in-stage, clicks centred on
                             targets, layouts pairwise non-overlapping), sceneRegistry
                             (order/durations/filmstrip frames), Provider + Overlay
                             behaviour tests.
```

## Traps

- **The BootSplash handshake.** The provider was forbidden from editing
  BootSplash, so it observes that component's exact `role="status"` +
  `aria-label="Loading Lynceus"` node and arms auto-open only after it
  unmounts. Rename either attribute and first-boot onboarding never opens —
  no test currently spans the two components; the paired comments are the guard.
- **CSS margin collapse vs flex-gap stacking** (370e80d). Adjoining sibling
  margins COLLAPSE to their max (AddFolderScene: mb-2 + mt-4 → 16, not 24);
  a flex `gap` plus an item's own margin do NOT collapse — they stack
  (GesturePracticeScene's Exit button). The invariant tests check the manifest
  against itself and structurally cannot see markup-vs-constant divergence, so
  the derivation comments at those junctions ARE the guard. When deriving a new
  rect from Tailwind flow arithmetic, re-derive by the CSS rules, not by summing.
- **Persistence semantics.** Reset-all-preferences deliberately preserves
  `onboardingVersionSeen`; Skip and Finish both persist; Settings' replay
  bypasses persistence entirely. Bump `CURRENT_ONBOARDING_VERSION` (in
  useUserPreferences.ts) only to force a re-showing for every user.
- Real text appears only on invariant chrome (a plan whitelist); user content
  is always skeleton bars.
