import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Minus,
  Pause,
  Plus,
  Scan,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  FADE_EASE,
  SETTLE_EASE,
  cursorFrame,
  cursorTrack,
  holdTrack,
  normaliseTimes,
  pressAt,
  visualFrame,
  visualMotion,
  visualTrack,
} from "../onboardingMotion";
import {
  STAGE,
  centre,
  moveTo,
  rect,
  rectStyle,
  type Point,
  type Rect,
  type SceneGeometryManifest,
} from "../sceneGeometry";
import type { OnboardingSceneProps } from "../types";
import { DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  reducedFrames,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const GESTURE_PRACTICE_DURATION_MS = 11200;

/**
 * GEOM — setup view (unchanged from v1): the aside is x 650..960 with
 * p-6 (24) padding and pinned flow heights (19px heading + mb-5, four
 * 12px rows with mb-4, mt-10, then a 40px button). NB the audit-caught
 * collapse: the fourth row's mb-4 (16) and the button's mt-10 (40) are
 * adjoining sibling margins that COLLAPSE to max=40 (not sum to 56), so
 * the button tops at 159+40=199.
 *
 * Session view mirrors the real GestureTimerView chrome layout:
 * countdown pill top-centre, identity card + reference-history strip
 * bottom-left, transport bottom-centre, zoom HUD bottom-right. Every
 * control is ABSOLUTELY positioned from these rects — the v2 transport
 * deliberately drops v1's flex row (and with it the gap+margin
 * stacking arithmetic), so there is no flow-derived coordinate left in
 * this scene.
 */
const START_BTN = rect(674, 199, 262, 40);
const ARTWORK = rect(80, 80, 800, 440);

// Countdown pill, top-centre like the real app's progress ring shell.
const TIMER_PILL = rect((STAGE.w - 160) / 2, 20, 160, 36);
// The depleting bar sits inside the pill: 14px side padding, 24px down.
const COUNTDOWN_BAR = rect(TIMER_PILL.x + 14, TIMER_PILL.y + 24, TIMER_PILL.w - 28, 4);

// Identity card ("Reference N of M" + name skeleton) with the history
// strip beneath it — the real view's bottom-left cluster.
const IDENTITY = rect(20, 468, 180, 34);
const THUMB1 = rect(IDENTITY.x + 4, IDENTITY.y + IDENTITY.h + 8, 44, 44);
const THUMB2 = rect(THUMB1.x + THUMB1.w + 8, THUMB1.y, THUMB1.w, THUMB1.h);
// Selection ring floats 3px outside whichever thumb is viewed; it
// TRAVELS between thumbs (moveTo delta) rather than blinking.
const RING_HOME = rect(THUMB1.x - 3, THUMB1.y - 3, THUMB1.w + 6, THUMB1.h + 6);
const RING_TO_THUMB2 = moveTo(THUMB1, THUMB2);

// Transport: five 36px circular buttons (prev · pause · next · settings
// · exit), 8px apart, centred — matching the real transport's order.
const TRANSPORT_BTN = 36;
const TRANSPORT_GAP = 8;
const TRANSPORT_W = 5 * TRANSPORT_BTN + 4 * TRANSPORT_GAP;
const TRANSPORT_X = (STAGE.w - TRANSPORT_W) / 2;
const transportBtn = (index: number): Rect =>
  rect(TRANSPORT_X + index * (TRANSPORT_BTN + TRANSPORT_GAP), 548, TRANSPORT_BTN, TRANSPORT_BTN);
const TRANSPORT_RECTS = [0, 1, 2, 3, 4].map(transportBtn);
const EXIT_BTN = TRANSPORT_RECTS[4];

// Zoom HUD (minus · percent label · plus · Fit), bottom-right, visible
// only while zoomed — exactly the real app's isZoomed cluster.
const ZOOM_HUD = rect(752, 546, 196, 44);
const ZOOM_MINUS = rect(ZOOM_HUD.x + 8, ZOOM_HUD.y + 6, 32, 32);
const ZOOM_LABEL = rect(ZOOM_MINUS.x + ZOOM_MINUS.w + 8, ZOOM_MINUS.y, 44, 32);
const ZOOM_PLUS = rect(ZOOM_LABEL.x + ZOOM_LABEL.w + 8, ZOOM_LABEL.y, 32, 32);
const ZOOM_FIT = rect(ZOOM_PLUS.x + ZOOM_PLUS.w + 8, ZOOM_PLUS.y, 48, 32);

// The zoom gesture: scroll-wheel zoom is centred on the cursor in the
// real app, so the artwork scales ABOUT this exact stage point (the
// cursor stands on it), then the pan drag moves the image by exactly
// the cursor's own delta — the grabbed pixel stays under the pointer.
const ZOOM_SCALE = 1.6;
const ZOOM_POINT: Point = {
  x: ARTWORK.x + ARTWORK.w * 0.62,
  y: ARTWORK.y + ARTWORK.h * 0.38,
};
const PAN_DELTA: Point = { x: -90, y: 55 };
const PAN_TO: Point = { x: ZOOM_POINT.x + PAN_DELTA.x, y: ZOOM_POINT.y + PAN_DELTA.y };
// Scroll-tick telegraph: two chevrons hovering just above the cursor.
const WHEEL_HINT = rect(ZOOM_POINT.x - 9, ZOOM_POINT.y - 34, 18, 24);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Transform scaling the origin-top-left ARTWORK element by `s` about
 * stage point `p`, optionally shifted by drag delta `d`: with top-left
 * origin, point q maps to A + t + s·(q−A), so t = (1−s)·(p−A) + d
 * keeps p fixed under the cursor (d = 0) or tracks the drag exactly. */
const zoomAbout = (p: Point, s: number, d: Point = { x: 0, y: 0 }): string =>
  `translate3d(${round2((1 - s) * (p.x - ARTWORK.x) + d.x)}px, ${round2(
    (1 - s) * (p.y - ARTWORK.y) + d.y,
  )}px, 0px) scale(${s})`;

const ZOOMED = zoomAbout(ZOOM_POINT, ZOOM_SCALE);
const ZOOMED_PANNED = zoomAbout(ZOOM_POINT, ZOOM_SCALE, PAN_DELTA);
const ZOOM_PERCENT = `${Math.round(ZOOM_SCALE * 100)}%`;

/** Position a child rect relative to its absolutely-positioned parent. */
const relStyle = (child: Rect, parent: Rect) => ({
  left: child.x - parent.x,
  top: child.y - parent.y,
  width: child.w,
  height: child.h,
});

const CLICK_START = centre(START_BTN);
const CLICK_FIT = centre(ZOOM_FIT);
const CLICK_THUMB1 = centre(THUMB1);
const CLICK_THUMB2 = centre(THUMB2);
const CLICK_EXIT = centre(EXIT_BTN);

/**
 * The loop, one causal chain (all ms, D = 11200):
 *   800/900/1000   press Start → setup fades out, session fades in (1000–1300)
 *   1300           countdown bar full; ONE demo interval = 4000ms
 *   5300           bar hits 0 → the TIMER advances ref 1 → 2: crossfade,
 *                  thumb 2 pops into the strip, the ring slides onto it,
 *                  the bar refills and depletes again
 *   5650/5950      two scroll ticks at the cursor (halo pulses + chevron
 *                  hints) → artwork zooms to 160% ABOUT the cursor point
 *                  (5700–6100), zoom HUD fades in reading 160%
 *   6450–6850      press-drag pan: image translates by exactly the
 *                  cursor's delta (same times, same linear ease)
 *   7450/7550      press Fit → zoom resets (7550–7950), HUD fades out
 *   8100/8200      press thumb 1 → ring slides back, ref 1 shown again,
 *                  countdown FREEZES at 0.3 (viewing history suspends
 *                  the timer, exactly like the real view)
 *   9450/9550      press thumb 2 (the tip) → ring returns, ref 2 back,
 *                  bar resumes from 0.3 at the same 1/4000 rate
 *   10150/10250    press exit (X) → session fades, setup returns,
 *                  cursor re-parks by 10850 — no trailing dead time
 * Countdown arithmetic is one rate throughout: 4000ms per full bar;
 * 1300→5300 full deplete, 5400→8200 drops 0.7, 9550→10250 drops 0.175.
 */
const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    ...pressAt(CLICK_START),
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y),
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y),
    // Two scroll ticks: halo pulses WITHOUT the press signature
    // (pressScale stays 1) — a wheel gesture, not a click.
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y, 1, 0.6, 1),
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y),
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y, 1, 0.6, 1),
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y),
    // Press-drag pan (a drag, not pressAt): press, travel, release.
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y),
    cursorFrame(ZOOM_POINT.x, ZOOM_POINT.y, 0.92),
    cursorFrame(PAN_TO.x, PAN_TO.y, 0.92),
    cursorFrame(PAN_TO.x, PAN_TO.y),
    ...pressAt(CLICK_FIT),
    ...pressAt(CLICK_THUMB1),
    cursorFrame(CLICK_THUMB1.x, CLICK_THUMB1.y),
    ...pressAt(CLICK_THUMB2),
    ...pressAt(CLICK_EXIT),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [
    0, 300, 800, 900, 1000, 2000, 5500, 5650, 5800, 5950, 6100, 6350, 6450,
    6850, 6950, 7350, 7450, 7550, 8000, 8100, 8200, 9050, 9350, 9450, 9550,
    10050, 10150, 10250, 10850, 11200,
  ]),
);

const setupView = holdTrack([0, 1000, 1300, 10250, 10650, 11200], {
  hidden: visualFrame(undefined, 1),
  shown: visualFrame(undefined, 0),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const sessionView = holdTrack([0, 1000, 1300, 10250, 10650, 11200], {
  hidden: visualFrame("translate3d(0px, 8px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

const countdownFrame = (remaining: number) =>
  visualFrame(`translate3d(0px, 0px, 0px) scaleX(${remaining})`, 1);

// One constant depletion rate (1/4000 per ms) across every live span;
// pauses are flat holds, the refill and the loop-reset happen while the
// bar is empty or the session invisible. All-linear, so no ease array.
const countdownBar = visualTrack(
  [
    countdownFrame(1),
    countdownFrame(1),
    countdownFrame(0),
    countdownFrame(1),
    countdownFrame(0.3),
    countdownFrame(0.3),
    countdownFrame(0.125),
    countdownFrame(0.125),
    countdownFrame(1),
    countdownFrame(1),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [
    0, 1300, 5300, 5400, 8200, 9550, 10250, 10800, 11100, 11200,
  ]),
);

// Reference 2's artwork layer: in at the timed swap (5300), out while
// history shows ref 1 (8200), back on resume (9550), reset off-screen
// after the session fades. Constant transform, opacity-only.
const ref2Layer = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [
    0, 5300, 5600, 8200, 8500, 9550, 9850, 10650, 10950, 11200,
  ]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

// Thumb 2 pops into the strip the moment the timer advances.
const thumbPop = holdTrack([0, 5300, 5600, 10650, 11000, 11200], {
  hidden: visualFrame("translate3d(0px, 0px, 0px) scale(0.6)", 0),
  shown: visualFrame(),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

// The selection ring SLIDES between thumbs: onto 2 at the swap, back to
// 1 on the history click, onto 2 again on resume, home while invisible.
const ring = visualTrack(
  [
    visualFrame(),
    visualFrame(),
    visualFrame(RING_TO_THUMB2),
    visualFrame(RING_TO_THUMB2),
    visualFrame(),
    visualFrame(),
    visualFrame(RING_TO_THUMB2),
    visualFrame(RING_TO_THUMB2),
    visualFrame(),
    visualFrame(),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [
    0, 5300, 5600, 8200, 8500, 9550, 9850, 10650, 10950, 11200,
  ]),
  ["linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
);

// Zoom: identity until the scroll ticks, scale about the cursor point,
// hold, pan tracking the drag (same 6450–6850 window and linear ease as
// the cursor, so the image moves WITH the pointer), hold, reset on Fit.
const artwork = visualTrack(
  [
    visualFrame(),
    visualFrame(),
    visualFrame(ZOOMED),
    visualFrame(ZOOMED),
    visualFrame(ZOOMED_PANNED),
    visualFrame(ZOOMED_PANNED),
    visualFrame(),
    visualFrame(),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [
    0, 5700, 6100, 6450, 6850, 7550, 7950, 11200,
  ]),
  ["linear", SETTLE_EASE, "linear", "linear", "linear", SETTLE_EASE, "linear"],
);

// Ambient sheen sweeps the reference once during the first interval and
// exits exactly at the swap; it travels home at opacity 0 (both ends
// sit outside the clipped artwork, so nothing flashes).
const sheenFrame = (x: number, opacity: number) =>
  visualFrame(`translate3d(${x}px, 0px, 0px) scale(1)`, opacity);
const sheen = visualTrack(
  [
    sheenFrame(-ARTWORK.w / 2, 1),
    sheenFrame(-ARTWORK.w / 2, 1),
    sheenFrame(ARTWORK.w, 1),
    sheenFrame(ARTWORK.w, 0),
    sheenFrame(-ARTWORK.w / 2, 0),
    sheenFrame(-ARTWORK.w / 2, 1),
    sheenFrame(-ARTWORK.w / 2, 1),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 1300, 5300, 5400, 5500, 5600, 11200]),
);

// The zoom HUD exists only while zoomed (real isZoomed behaviour):
// fades in reacting to the first scroll tick, out after Fit releases.
const zoomHud = holdTrack([0, 5700, 6000, 7550, 7850, 11200], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

// The percent label crossfades 100% → 160% as the zoom lands, and back
// as Fit resets it — the zoom level is always readable.
const zoomLabel = holdTrack([0, 5700, 6100, 7550, 7750, 11200], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

// Scroll-tick chevrons above the cursor, pulsing twice in sync with the
// halo pulses (peaks 5650 and 5950) — the telegraph for the zoom.
const wheelHint = visualTrack(
  [
    visualFrame("translate3d(0px, 4px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 4px, 0px) scale(1)", 0),
    visualFrame(undefined, 1),
    visualFrame("translate3d(0px, 4px, 0px) scale(1)", 0),
    visualFrame(undefined, 1),
    visualFrame("translate3d(0px, 4px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 4px, 0px) scale(1)", 0),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 5450, 5650, 5800, 5950, 6100, 11200]),
  ["linear", FADE_EASE, FADE_EASE, FADE_EASE, FADE_EASE, "linear"],
);

export const GESTURE_PRACTICE_TRACKS = {
  cursor,
  setupView,
  sessionView,
  countdownBar,
  ref2Layer,
  thumbPop,
  ring,
  artwork,
  sheen,
  zoomHud,
  zoomLabel,
  wheelHint,
} as const;

export const GESTURE_PRACTICE_GEOMETRY: SceneGeometryManifest = {
  scene: "gesture-practice",
  bounds: {
    startButton: START_BTN,
    artwork: ARTWORK,
    timerPill: TIMER_PILL,
    countdownBar: COUNTDOWN_BAR,
    identity: IDENTITY,
    historyThumb1: THUMB1,
    historyThumb2: THUMB2,
    historyRing: RING_HOME,
    transportPrev: TRANSPORT_RECTS[0],
    transportPause: TRANSPORT_RECTS[1],
    transportNext: TRANSPORT_RECTS[2],
    transportSettings: TRANSPORT_RECTS[3],
    exit: EXIT_BTN,
    zoomHud: ZOOM_HUD,
    zoomMinus: ZOOM_MINUS,
    zoomLabel: ZOOM_LABEL,
    zoomPlus: ZOOM_PLUS,
    zoomFit: ZOOM_FIT,
    wheelHint: WHEEL_HINT,
  },
  clicks: [
    { label: "start-session", point: CLICK_START, target: START_BTN },
    { label: "pan-from", point: ZOOM_POINT, target: ARTWORK },
    { label: "pan-to", point: PAN_TO, target: ARTWORK },
    { label: "fit", point: CLICK_FIT, target: ZOOM_FIT },
    { label: "history-1", point: CLICK_THUMB1, target: THUMB1 },
    { label: "history-2", point: CLICK_THUMB2, target: THUMB2 },
    { label: "exit", point: CLICK_EXIT, target: EXIT_BTN },
  ],
  disjoint: {
    // The session chrome cluster: artwork is deliberately absent (the
    // real view overlays its chrome ON the image), and the ring is
    // absent because it frames a thumb by design.
    sessionChrome: [
      TIMER_PILL,
      IDENTITY,
      THUMB1,
      THUMB2,
      ...TRANSPORT_RECTS,
      ZOOM_MINUS,
      ZOOM_LABEL,
      ZOOM_PLUS,
      ZOOM_FIT,
    ],
  },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["gesture-setup", "Build a timed session"],
  ["gesture-timer", "The countdown drives each reference"],
  ["gesture-zoomed", "Zoom at the cursor, revisit history"],
];

export const GESTURE_PRACTICE_REDUCED_FRAMES = reducedFrames(reducedKinds);

export function GesturePracticeScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <motion.div
        className="absolute inset-0 flex bg-background"
        animate={visualMotion(setupView, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
      >
        <div className="flex flex-1 items-center justify-center bg-surface-sunken p-10">
          <OnboardingSkeleton className="h-full w-full rounded-[14px]" raised />
        </div>
        <aside className="w-[310px] border-l border-border bg-card p-6">
          <h3 className="mb-5 h-[19px] text-[14px] font-[650] leading-[19px]">
            Timer
          </h3>
          {["w-full", "w-3/4", "w-5/6", "w-2/3"].map((width) => (
            <OnboardingSkeleton key={width} className={`mb-4 h-3 ${width} rounded-full`} />
          ))}
          <div className="mt-10 grid h-[40px] place-items-center rounded-[10px] bg-primary text-[11px] font-[650] text-primary-foreground">
            Start session
          </div>
        </aside>
      </motion.div>

      <motion.div
        className="absolute inset-0 z-20 overflow-hidden bg-surface-sunken"
        animate={visualMotion(sessionView, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
      >
        {/* Reference artwork: origin-top-left so the zoom-about-a-point
            transform maths in the GEOM block holds exactly. Ref 1 and
            ref 2 are distinct skeleton "silhouettes" so the timed swap
            and the history flips are visibly different references. */}
        <motion.div
          className="absolute origin-top-left"
          style={rectStyle(ARTWORK)}
          animate={visualMotion(artwork, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        >
          <OnboardingSkeleton
            className="size-full rounded-[16px]"
            raised
            sheen={{ track: sheen, durationMs: GESTURE_PRACTICE_DURATION_MS }}
          />
          {/* Ref 1 silhouette (single-use decorative fractions). */}
          <div className="absolute left-[30%] top-[18%] h-[46%] w-[22%] rounded-[40%] bg-foreground/10" />
          <div className="absolute left-[26%] top-[62%] h-[24%] w-[30%] rounded-[30%] bg-foreground/10" />
          {/* Ref 2 layer: opaque cover with its own silhouette + hue. */}
          <motion.div
            className="absolute inset-0 overflow-hidden rounded-[16px] bg-surface-raised"
            animate={visualMotion(ref2Layer, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
          >
            <div className="absolute left-[54%] top-[24%] h-[52%] w-[18%] rounded-[45%] bg-primary/15" />
            <div className="absolute left-[38%] top-[40%] h-[20%] w-[24%] rounded-[35%] bg-primary/10" />
          </motion.div>
        </motion.div>

        {/* Scroll-tick telegraph above the cursor's zoom point. */}
        <motion.div
          className="absolute flex flex-col items-center text-primary"
          style={rectStyle(WHEEL_HINT)}
          animate={visualMotion(wheelHint, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        >
          <ChevronUp className="-mb-2 size-4" strokeWidth={2.4} />
          <ChevronUp className="size-4 opacity-60" strokeWidth={2.4} />
        </motion.div>

        {/* Countdown pill: skeleton time text over the depleting bar. */}
        <div
          className="absolute rounded-full border border-border bg-card"
          style={rectStyle(TIMER_PILL)}
        >
          <div className="flex justify-center pt-2">
            <OnboardingSkeleton className="h-2 w-12 rounded-full" />
          </div>
          <div
            className="absolute overflow-hidden rounded-full bg-surface-sunken"
            style={relStyle(COUNTDOWN_BAR, TIMER_PILL)}
          >
            <motion.div
              className="size-full origin-left rounded-full bg-primary"
              animate={visualMotion(countdownBar, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
            />
          </div>
        </div>

        {/* Identity card + reference-history strip, bottom-left. */}
        <div
          className="absolute rounded-[10px] border border-border bg-card px-3 py-2"
          style={rectStyle(IDENTITY)}
        >
          <p className="text-[8px] font-[650] uppercase tracking-[0.14em] text-primary">
            Reference
          </p>
          <OnboardingSkeleton className="mt-1 h-2 w-24 rounded-full" />
        </div>
        <div
          className="absolute overflow-hidden rounded-md bg-surface-raised ring-1 ring-border"
          style={rectStyle(THUMB1)}
        >
          <div className="absolute left-[28%] top-[20%] h-[46%] w-[26%] rounded-[40%] bg-foreground/10" />
        </div>
        <motion.div
          className="absolute overflow-hidden rounded-md bg-surface-raised ring-1 ring-border"
          style={rectStyle(THUMB2)}
          animate={visualMotion(thumbPop, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        >
          <div className="absolute left-[50%] top-[24%] h-[50%] w-[22%] rounded-[45%] bg-primary/20" />
        </motion.div>
        <motion.div
          className="absolute rounded-[9px] border-2 border-primary"
          style={rectStyle(RING_HOME)}
          animate={visualMotion(ring, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        />

        {/* Transport: prev · pause · next · settings · exit — absolute
            per-button rects, no flex flow (see GEOM note). */}
        {[ChevronLeft, Pause, ChevronRight, SlidersHorizontal, X].map((Icon, index) => (
          <div
            key={index}
            className="absolute grid place-items-center rounded-full border border-border bg-card"
            style={rectStyle(TRANSPORT_RECTS[index])}
          >
            <Icon className="size-3.5" strokeWidth={1.9} />
          </div>
        ))}

        {/* Zoom HUD — only while zoomed, percent label crossfading. */}
        <motion.div
          className="absolute rounded-[12px] border border-border bg-card"
          style={rectStyle(ZOOM_HUD)}
          animate={visualMotion(zoomHud, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        >
          <div
            className="absolute grid place-items-center rounded-[9px] border border-border bg-surface"
            style={relStyle(ZOOM_MINUS, ZOOM_HUD)}
          >
            <Minus className="size-3" />
          </div>
          <div
            className="absolute grid place-items-center text-[11px] font-[650] tabular-nums"
            style={relStyle(ZOOM_LABEL, ZOOM_HUD)}
          >
            <span>100%</span>
            <motion.span
              className="absolute inset-0 grid place-items-center bg-card"
              animate={visualMotion(zoomLabel, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
            >
              {ZOOM_PERCENT}
            </motion.span>
          </div>
          <div
            className="absolute grid place-items-center rounded-[9px] border border-border bg-surface"
            style={relStyle(ZOOM_PLUS, ZOOM_HUD)}
          >
            <Plus className="size-3" />
          </div>
          <div
            className="absolute flex items-center justify-center gap-1 rounded-[9px] border border-border bg-surface text-[10px] font-[650]"
            style={relStyle(ZOOM_FIT, ZOOM_HUD)}
          >
            <Scan className="size-3" strokeWidth={1.8} />
            Fit
          </div>
        </motion.div>
      </motion.div>

      <FakeCursor
        track={cursor}
        durationMs={GESTURE_PRACTICE_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
