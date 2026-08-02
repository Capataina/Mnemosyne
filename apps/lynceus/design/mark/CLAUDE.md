# design/mark/ — the ringed-almond brand mark

Lynceus's face: a 3D black almond eye with a blue iris echoing the app primary, on off-white ground. Won a seven-candidate multi-model logo round; authored as hand-written SVG throughout.

```
mark/
├── ringed-almond-r1.svg                     round-1 original, preserved verbatim (c809fdb) —
│                                            THIS is what ships; it beat its own softened
│                                            variants on simplicity (b5005e4)
├── app-icon-master.svg                      the composed icon source: r1 card scaled to 824px,
│                                            centred on a transparent 1024 canvas with drop
│                                            shadow (Big Sur ~10% margin convention); corner
│                                            radius pre-compensated 184 -> 229 for the 0.8047 scale
├── logo-terra-r2-1-softer-gaze.svg          round-2 softening variants (fa7f561), one lever
├── logo-terra-r2-2-lighter-material.svg     each: gaze, material, geometry, ambience.
├── logo-terra-r2-3-friendlier-geometry.svg  Vaulted UNSHIPPED — kept for future family
└── logo-terra-r2-4-warmer-ambience.svg      marks, not pending decisions
```

Regenerating the icon set: `pnpm tauri icon` against `app-icon-master.svg` writes icns/ico/png into `../../src-tauri/icons/`; delete the android/ and ios/ sets it also emits (macOS-only app, they regenerate on demand). The in-app `LynceusMark` component carries the same eye cropped to the almond, gradient ids namespaced `mark-*` — an SVG edit here does not propagate to it automatically.

The r1-ships decision is closed (2026-07-19): the base won as the anchor the rest of the product family's marks will align to. Don't reopen it by "helpfully" shipping a softened variant.
