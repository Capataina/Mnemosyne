# src/features/onboarding/scenes/

The six demo scenes. Each file follows one fixed pattern:

- a GEOM block declaring the scene's layout ONCE as rects/grid cells, with derivation comments where a constant comes from Tailwind flow arithmetic;
- exported `<NAME>_DURATION_MS`, `<NAME>_TRACKS` (all closed loops), `<NAME>_REDUCED_FRAMES` (three static frames), the component, and a `SceneGeometryManifest` (bounds, clicks with declared targets, disjoint layout sets) that `__tests__/sceneGeometry.test.ts` verifies.

```
scenes/
├── AddFolderScene.tsx        7.0s — Settings gear → right-edge slide-out panel → Add
│                             folder → picker → diagonal masonry cascade with per-tile
│                             settle physics (delays derived from each tile's own rect).
├── ArrangeScene.tsx          8.4s — slot model: 4×3 board + overflow row, four caused
│                             gestures (drag swap, 2×2 grow, shrink, drag home — the last
│                             drag IS the loop closure); per-tile tracks keyframed only at
│                             each tile's own beats so cursor↔tile coupling is exact.
├── OrganiseScene.tsx         7.5s — left-edge slide-out panel (real LibraryDrawer shape);
│                             tag swatch dots pre-motivate removals, telegraph rings fire
│                             at press-release, survivors translate to the cell of their
│                             index among survivors, diagonal return wave on Clear.
├── SearchScene.tsx           7.0s — semantic search; 12 distinct oklch hue tints make the
│                             rank-fusion permutation trackable (swap partners hue-opposed);
│                             bijective per-row column permutation at the true 202px pitch,
│                             top-hit ring lands last.
├── SimilarityScene.tsx       9.0s — full trail: hover-ring select, hero maps onto its
│                             exact 2×2 footprint, dive shrinks the old hero into the
│                             breadcrumb chip, inspector rebuilt to the real PinterestModal
│                             (header outside scroll, image-footprint-confined next-image
│                             swap); header band manifest-pinned disjoint from all tiles.
└── GesturePracticeScene.tsx  11.2s — countdown bar whose zero CAUSES the reference swap,
                              bottom-left history strip (ring slides between thumbs,
                              history click pauses, tip click resumes), cursor-centred
                              zoom (translate=(1−s)(P−A)) and drag-coupled pan.
```

Rules when editing (the parent file's traps apply in full here):

- Never type a coordinate that can be derived; never duplicate one between a style and a track.
- Margin-collapse: adjoining sibling margins collapse to max; flex gap + own margin stack. The derivation comments at the AddFolder button row and the GesturePractice Start/Exit buttons record the two junctions this bit (370e80d).
- Changing a scene's duration or the scene order breaks `sceneRegistry.test.ts` on purpose — update both deliberately.
- Every new track must close (last value === first, times 0→1) or closedTracks.test.ts fails.
