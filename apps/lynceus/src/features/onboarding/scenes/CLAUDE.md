# src/features/onboarding/scenes/

The six demo scenes. Each file follows one fixed pattern:

- a GEOM block declaring the scene's layout ONCE as rects/grid cells, with
  derivation comments where a constant comes from Tailwind flow arithmetic;
- exported `<NAME>_DURATION_MS`, `<NAME>_TRACKS` (all closed loops),
  `<NAME>_REDUCED_FRAMES` (three static frames), the component, and a
  `SceneGeometryManifest` (bounds, clicks with declared targets, disjoint
  layout sets) that `__tests__/sceneGeometry.test.ts` verifies.

```
scenes/
├── AddFolderScene.tsx        8.0s — add a folder, picker, tiles arrive as a computed
│                             4-column masonry stack (overlap impossible by construction).
├── ArrangeScene.tsx          12.0s — slot model: 4×3 board + overflow row, every beat a
│                             declared cell-occupancy map; drag swap and 2×2 resize with
│                             exact footprint scales; telegraphs are the target cells.
├── OrganiseScene.tsx         9.6s — tag filters REMOVE and COMPACT: survivors translate to
│                             the cell of their index among survivors, computed.
├── SearchScene.tsx           8.4s — semantic search; rank fusion as a bijective per-row
│                             column permutation at the true 202px pitch.
├── SimilarityScene.tsx       10.8s — hero maps onto its exact 2×2 footprint, results
│                             re-pack, inspector dive via SkeletonInspector.
└── GesturePracticeScene.tsx  10.8s — timer setup/transport/zoom, all controls on
                              computed rects.
```

Rules when editing (the parent file's traps apply in full here):

- Never type a coordinate that can be derived; never duplicate one between a
  style and a track.
- Margin-collapse: adjoining sibling margins collapse to max; flex gap + own
  margin stack. The derivation comments at the AddFolder button row and the
  GesturePractice Start/Exit buttons record the two junctions this bit (370e80d).
- Changing a scene's duration or the scene order breaks
  `sceneRegistry.test.ts` on purpose — update both deliberately.
- Every new track must close (last value === first, times 0→1) or
  closedTracks.test.ts fails.
