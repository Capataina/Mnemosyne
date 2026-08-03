# src/features/onboarding/primitives/

Reusable skeleton scenery the scenes compose. Nothing here is interactive — every surface is `pointer-events: none`, aria-hidden demo art.

```
primitives/
├── DemoAppChrome.tsx          DemoSceneRoot (the 960×600 stage frame) + the fake app
│                              chrome. Every scene-targetable control is ABSOLUTELY
│                              positioned from the CHROME rects in ../sceneGeometry.ts —
│                              flex flow may not place anything a cursor aims at.
├── OnboardingSkeleton.tsx     Base skeleton bar/tile, optional animated sheen track.
├── SkeletonGrid.tsx           Absolute-positioned tile field from SkeletonTileGeometry[].
└── ReducedMotionFilmstrip.tsx StaticFrameArt: the per-scene three-frame static art keyed
                               by StaticFrameKind — the reduced-motion/small-stage path.
                               Also reducedFrames(kinds): builds a scene's three
                               ReducedFrame entries from its `[kind, caption]` pairs —
                               every scene's *_REDUCED_FRAMES export goes through it.
```

Adding a control a scene will click: give it a rect in `sceneGeometry.ts` CHROME and position it absolutely here — never let flex compute its x/y.
