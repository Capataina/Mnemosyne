# src/features/gesture-timer/

Timed drawing-reference sessions: a fullscreen viewer cycles through the
selected image's similar-set on an interval. Entered from PinterestModal (with
the similar-set as candidate pool) or quick-started from the hero pill
(`components/SelectedImageTimerPill.tsx`).

## Map

```
gesture-timer/
├── index.ts                     Public surface: GestureTimer, GestureTimerConfigPanel,
│                                GestureTimerView, session helpers, types.
├── types.ts                     GestureTimerConfig (interval, one-based inclusive
│                                similarityRange, count|continuous sessionLength,
│                                repeatAllowed), GestureTimerImage, props.
├── session.ts                   Pure config/sequence logic: defaults, normalise/merge
│                                (clamps interval 5s..24h, count ≤999), eligible-candidate
│                                slicing, sequence building, formatTimerDuration.
├── GestureTimer.tsx             Orchestrator: inline setup → portal to body; applies
│                                autoStart once per config object IDENTITY (the hero pill
│                                passes a fresh object to re-trigger).
├── GestureTimerSetup.tsx        Inline setup card (interval presets, range, length, repeat).
├── GestureTimerConfigPanel.tsx  Mid-session reconfigure — portals to body at z-[220]
│                                (above the timer view's 200; the reason dialogs sit at 250).
├── GestureTimerView.tsx         Fullscreen z-[200] viewer: countdown, pause, prev/next,
│                                zoom, exit; predecodes nextImageUrl.
├── GestureTimerProgress.tsx     SVG countdown ring, role="timer" aria-label.
├── useGestureTimer.ts           Sequence/countdown state; exposes nextImageUrl for
│                                predecode (undefined on the continuous+repeat tail —
│                                next is picked at advance time, nothing to predecode).
├── useGestureZoom.ts            Pure-math zoom/pan: scale 1..64, cursor-stationary zoom,
│                                edge-clamped pan; plain two-finger scroll PANS when
│                                zoomed (trackpad convention, 7e8ce4e) — pinch/ctrl zooms.
├── gesture-timer.css            Feature-scoped styles, imported by GestureTimer.tsx.
└── *.test.{ts,tsx}              Setup flow, view transport + wheel routing, nextImageUrl
                                 derivation, zoom geometry (pure-function level).
```

## Operating notes

- `similarityRange` is one-based inclusive over the candidate list's rank order
  — off-by-ones here were real bugs; the session.ts clamps are the contract.
- Wheel routing is deliberate: after a91614f the view-level tests assert
  pan-not-zoom for plain scroll. Don't re-route wheel events without them.
- Zoom logic stays in exported pure functions (`zoomTransformAroundPoint`,
  `constrainZoomTransform`, `resolveWheelGesture`) so geometry is testable
  without mounting; keep new zoom behaviour in that layer.
