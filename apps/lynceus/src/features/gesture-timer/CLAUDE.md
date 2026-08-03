# src/features/gesture-timer/

Timed drawing-reference sessions: a fullscreen viewer cycles through the selected image's similar-set on an interval. Entered from PinterestModal (with the similar-set as candidate pool) or quick-started from the hero pill (`components/SelectedImageTimerPill.tsx`).

## Map

```
gesture-timer/
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
│                                zoom, exit, the reference-history strip; predecodes
│                                nextImageUrl.
├── GestureTimerProgress.tsx     SVG countdown ring, role="timer" aria-label.
├── useGestureTimer.ts           Sequence/countdown state; exposes nextImageUrl for
│                                predecode (undefined on the continuous+repeat tail —
│                                next is picked at advance time, nothing to predecode);
│                                the reference-history strip's `history`/`viewedIndex`/
│                                `isViewingHistory`/`selectHistoryIndex`.
├── useGestureZoom.ts            Zoom/pan hook state machine: scale 1..64, cursor-stationary
│                                zoom, edge-clamped pan; plain two-finger scroll PANS when
│                                zoomed (trackpad convention, 7e8ce4e) — pinch/ctrl zooms.
├── zoomGeometry.ts              Pure zoom/pan math extracted from useGestureZoom.ts:
│                                transform constrain/anchor functions, wheel-gesture
│                                routing, the double-tap predicate — zero React coupling.
├── gesture-timer.css            Feature-scoped styles, imported by GestureTimer.tsx.
└── *.test.{ts,tsx}              Setup flow, view transport + wheel routing, nextImageUrl
                                 derivation, zoom geometry (pure-function level).
```

## Session semantics

- **Three config functions, three distinct callers** (session.ts): `createDefaultGestureTimerConfig(candidateCount)` scales defaults to the candidate pool (interval 60s; range ranks 5-25 or 1-N when fewer than 5 candidates; count clamped [2, 10] bounded by eligible count); `normaliseGestureTimerConfig(config, candidateCount)` clamps an arbitrary — possibly stale — config against the CURRENT count and runs every time a session actually starts, so a config built before the candidate list changed can never request more images than exist; `mergeGestureTimerConfig(initial, count)` layers a partial config over defaults then normalises.
- **Sequence building**: `getEligibleCandidates` slices the 1-based rank range and de-dupes against the starting image. Non-repeat sessions shuffle once and slice to length; repeat-allowed picks randomly per advance, constrained only against immediately repeating the previous image. Continuous+repeat deliberately builds a ONE-element sequence and appends one random pick per advance — which is exactly why `nextImageUrl` is honestly `undefined` on that tail and the predecode gap there is an accepted limit (speculative pick-ahead would conflict with the genuinely-random, no-immediate-repeat semantics). Every other mode knows its full sequence upfront and predecodes one image ahead. Sequence exhaustion sets `isComplete` and renders an in-place "Session complete" panel (Exit/Restart) rather than auto-closing.
- **Countdown is `performance.now()`-anchored** on a 100ms tick, never a naive per-tick decrement — decrementing would systematically run slow under tab throttling or a dropped frame. The countdown is `suspended` while the current image hasn't loaded, so the interval never burns down against a skeleton.
- **`sessionKey` remount over in-place reset**: every start/restart increments a key that force-remounts GestureTimerView — a fresh mount is a fresh state machine by construction, more robust than manually resetting each field.
- **The autoStart contract is object IDENTITY, two-sided.** GestureTimer fires exactly one session per distinct `autoStart` object (`appliedAutoStartRef`), and the route guards the other half: `pendingTimerStart` clears on selection change so a stale config can never start a session against a different image than it was built for. The guard lives at the route, not in this folder.
- **A candidate-count-changed effect re-derives config only while idle** (no session running or being configured) — similarity results refreshing under an idle setup panel keep defaults sane without yanking an in-progress session.
- **`markReadyIfComplete` ref callback on the keyed `<img>` is load-bearing** (5ce6581): a predecoded reference can be complete at mount and WebKit may never deliver an observable `load` event for it — without the callback the load-gated opacity left the image permanently invisible (the "blank second image" bug).
- Nothing persists: config, sequence, and progress are ephemeral React state — a session leaves no DB row, by design (practice utility, not a training log).
- **The reference-history strip (2026-08-03)**: bottom-left, under the "Reference N of M" label, small thumbnails for every reference shown this session, current one included. Pure viewing — clicking a past thumbnail never mutates the session.
  - `history` is DERIVED, not appended: `sequence.slice(0, highWaterMark + 1)`, where `highWaterMark` tracks the largest `currentIndex` ever reached. This is what keeps it correct through the continuous+repeat tail, which grows `sequence` itself one random pick per advance — no parallel bookkeeping needed, and it can never disagree with the sequence it mirrors.
  - `historyOverrideIndex` (null = "following the tip") is the `viewingIndex` the implementation brief asked for. `viewedIndex = historyOverrideIndex ?? currentIndex`; `isViewingHistory = historyOverrideIndex !== null`. Any REAL position change — `next`, `previous`, or an auto-advance — clears the override via an effect watching `currentIndex`; those are the only paths that move it, so watching it is sufficient to always re-sync the strip to the tip. Consequence, decided rather than accidental: pressing the transport prev/next buttons while browsing history snaps back to following the tip, because those buttons act on the real position, not the view.
  - **Countdown suspension reuses the existing `suspended` gate** (`isViewingHistory` is one more term ORed into the same "don't run the interval effect" condition the image-load and settings-panel cases already use) rather than adding a second mechanism — the property that makes resume "continue, not restart" was already built in: the effect not running leaves `remainingMs` untouched, and re-running it anchors a fresh `startedAt` to that same value.
  - **`positionLabel` (real session position) and `viewedPositionLabel` (whatever is on screen) are deliberately two different fields** — a judgment call beyond the brief. The countdown ring, `remainingMs`, and `positionLabel` always describe the real, possibly-paused session; the identity card's "Reference N of M" text and reference name track `viewedImage`/`viewedIndex` instead, so what's written under the image always matches what's pictured — consistent with each strip thumbnail's own "Reference N of M" aria-label.
  - **Selection is click-only.** The brief's "hovering and clicking … selects it" was read as hover being the opacity affordance (`opacity-55 → opacity-100` on `:hover`), not a second trigger — a hover-triggered pause would fire on stray pointer movement, silently pausing a running session. Only `onClick` calls `selectHistoryIndex`.
  - **Overflow: horizontal scroll, not a fade edge** — chosen over a CSS fade-out mask because a scrollbar signals "more here, scroll for it" unambiguously, while a fade risks reading as decorative and hides how much more there is; `scrollbar-width: thin` keeps it out of the way.
  - **Zoom resets to Fit on selecting a history item** — `useGestureZoom`'s `imageId` already keys off the displayed image and its own effect resets pan/zoom on any `imageId` change (unmodified), so keying it to `viewedImage.id` instead of `currentImage.id` gets the reset for free; a past reference never inherits the live session's zoom/pan state.
  - `nextImageUrl` (the predecode target) stays keyed to `currentIndex`/`sequence`, deliberately never to `viewedIndex` — browsing history must not perturb the predecode window for the session's actual next step.

## Decision history

- The original two-step flow (a "Start timer" button under the fullscreen image opening a separate config dialog, `GestureTimerTrigger.tsx`) was DELETED, not iterated on (fcad704) — inline setup in the inspector plus the hero quick-start pill replaced it; the mid-session `GestureTimerConfigPanel` was deliberately kept because it belongs to a live session. Residue: the panel's `mode="start"` copy branch is tested-but-unreachable today (`configOpen` is only settable from a RUNNING session's settings button) — a leftover from when the dialog could open pre-session, not speculative future work. Provenance: a GPT-driven pass (Codex harness) built the presentational surfaces against a brief that forbade touching the route; the route wiring (autoStart plumbing, `pendingTimerStart`, the memoised `heroOverlay` threading) was done separately because the route was mid-rewrite by the concurrent perf round.
- The pill (`components/SelectedImageTimerPill.tsx`) and `GestureTimerSetup` are two independent config UIs sharing session.ts's pure merge/normalise functions — behaviour stays identical by construction, but a new `GestureTimerConfig` field needs input markup added to BOTH by hand.
- `disabled` and `onOpenChange` have no caller at the only real mount site (PinterestModal passes just startingImage/candidateImages/autoStart) — live, tested surface, safe to build on, just unexercised.

## Knowledge (2026-08-02 audit)

- **The three validation surfaces are NOT identical — the Pill diverges.** ConfigPanel:41-65 ↔ Setup:36-61 are token-identical, but `SelectedImageTimerPill.tsx:42-45`'s `availableInRange` lacks the `candidateCount === 0 ? 0 :` guard the other two carry — at zero candidates the Pill computes 1 where the others compute 0. Masked twice today (`Math.max(2, ·+1)` absorbs the difference, and the Pill is `inert` when `similarCount === 0`) — dormant, not dead. A dedup into session.ts was audited and refuted over exactly this unnamed divergence; if resubmitted, extract the ConfigPanel↔Setup pair only, or include the Pill with the guard delta explicitly decided. [code-health-audit 2026-08-02]

## Operating notes

- `similarityRange` is one-based inclusive over the candidate list's rank order — off-by-ones here were real bugs; the session.ts clamps are the contract.
- Wheel routing is deliberate: after a91614f the view-level tests assert pan-not-zoom for plain scroll. Don't re-route wheel events without them.
- Zoom logic stays in `zoomGeometry.ts`'s exported pure functions (`zoomTransformAroundPoint`, `constrainZoomTransform`, `resolveWheelGesture`, `isDoubleTap`) so geometry is testable without mounting; keep new zoom behaviour in that layer, not in the `useGestureZoom` hook.
