import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Pause,
  Play,
  Plus,
  Settings,
} from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  FADE_EASE,
  SETTLE_EASE,
  cursorFrame,
  cursorTrack,
  normaliseTimes,
  visualFrame,
  visualMotion,
  visualTrack,
} from "../onboardingMotion";
import {
  centre,
  rect,
  type SceneGeometryManifest,
} from "../sceneGeometry";
import type { OnboardingSceneProps } from "../types";
import { DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const GESTURE_PRACTICE_DURATION_MS = 10800;

/**
 * Geometry — the setup aside is x 650..960 with p-6 (24) padding and
 * pinned flow heights (19px heading + mb-5, four 12px rows with mb-4,
 * mt-10, then a 40px button), so the Start button rect is exact. The
 * session view's transport and zoom rows are absolutely positioned from
 * these rects rather than flex-centred, so the cursor can actually hit
 * them. Artwork area = inset 80/80/20 band (bottom-20 left-20 right-20
 * top-20 of the 960×600 stage).
 */
// NB two audit-caught corrections to the first derivation: (a) the
// fourth row's mb-4 (16) and the button's mt-10 (40) are adjoining
// sibling margins that COLLAPSE to max=40 (not sum to 56), so the
// button tops at 159+40=199; (b) flex `gap` and a flex item's own
// margin do NOT collapse — they stack — so Exit sits after
// gap-2 (8) + ml-2 (8) = 16px, at x 548.
const START_BTN = rect(674, 199, 262, 40);
const ARTWORK = rect(80, 80, 800, 440);
const TRANSPORT_X = 364;
const PAUSE_BTN = rect(TRANSPORT_X + 44, 548, 36, 36);
const EXIT_BTN = rect(TRANSPORT_X + 184, 548, 56, 36);
const ZOOM_PLUS = rect(852, 552, 32, 32);
const ZOOM_FIT = rect(892, 552, 48, 32);

const CLICK_START = centre(START_BTN);
const CLICK_PLUS = centre(ZOOM_PLUS);
const CLICK_FIT = centre(ZOOM_FIT);
const CLICK_PAUSE = centre(PAUSE_BTN);
const CLICK_EXIT = centre(EXIT_BTN);
const PAN_FROM = { x: 440, y: 300 };
const PAN_TO = { x: 540, y: 350 };

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CLICK_START.x, CLICK_START.y),
    cursorFrame(CLICK_START.x, CLICK_START.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_START.x, CLICK_START.y),
    cursorFrame(CLICK_PLUS.x, CLICK_PLUS.y),
    cursorFrame(CLICK_PLUS.x, CLICK_PLUS.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_PLUS.x, CLICK_PLUS.y),
    cursorFrame(PAN_FROM.x, PAN_FROM.y),
    cursorFrame(PAN_FROM.x, PAN_FROM.y, 0.92),
    cursorFrame(PAN_TO.x, PAN_TO.y, 0.92),
    cursorFrame(PAN_TO.x, PAN_TO.y),
    cursorFrame(CLICK_FIT.x, CLICK_FIT.y),
    cursorFrame(CLICK_FIT.x, CLICK_FIT.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_FIT.x, CLICK_FIT.y),
    cursorFrame(CLICK_PAUSE.x, CLICK_PAUSE.y),
    cursorFrame(CLICK_PAUSE.x, CLICK_PAUSE.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_PAUSE.x, CLICK_PAUSE.y),
    cursorFrame(CLICK_PAUSE.x, CLICK_PAUSE.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_PAUSE.x, CLICK_PAUSE.y),
    cursorFrame(CLICK_EXIT.x, CLICK_EXIT.y),
    cursorFrame(CLICK_EXIT.x, CLICK_EXIT.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_EXIT.x, CLICK_EXIT.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [
    0, 600, 1000, 1100, 1360, 2450, 2550, 2950, 3150, 3250, 3700, 4050,
    4450, 4550, 4810, 6350, 6450, 6750, 6950, 7050, 7850, 7950, 8260, 8900,
    10800,
  ]),
);

const inspector = visualTrack(
  [
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 1100, 1360, 7950, 8260, 10800]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const timer = visualTrack(
  [
    visualFrame("translate3d(0px, 8px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 8px, 0px) scale(1)", 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame("translate3d(0px, 8px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 8px, 0px) scale(1)", 0),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 1100, 1360, 7950, 8260, 10800]),
  ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
);

const artwork = visualTrack(
  [
    visualFrame(),
    visualFrame(),
    visualFrame("translate3d(0px, 0px, 0px) scale(1.42)"),
    visualFrame("translate3d(72px, 32px, 0px) scale(1.42)"),
    visualFrame("translate3d(72px, 32px, 0px) scale(1.42)"),
    visualFrame(),
    visualFrame(),
    visualFrame(),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 2550, 2950, 3700, 4550, 4810, 8260, 10800]),
  ["linear", SETTLE_EASE, SETTLE_EASE, "linear", SETTLE_EASE, "linear", "linear"],
);

const zoomControls = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 2550, 2950, 4550, 4810, 10800]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const nextReference = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 5150, 5510, 7950, 8260, 10800]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const arc = visualTrack(
  [
    visualFrame("rotate(0deg)", 0),
    visualFrame("rotate(0deg)", 0),
    visualFrame("rotate(0deg)", 1),
    visualFrame("rotate(210deg)", 1),
    visualFrame("rotate(330deg)", 1),
    visualFrame("rotate(330deg)", 1),
    visualFrame("rotate(330deg)", 1),
    visualFrame("rotate(359deg)", 1),
    // 360, not 0: framer-motion interpolates the raw number with no
    // 0°≡360° awareness, so a 0 here would whip the arc backward ~359°
    // while still half-visible during the fade. The sweep completes
    // forward to 360 as opacity reaches 0; the final segment (360 → 0)
    // runs entirely at opacity 0, where direction cannot be seen, and
    // the boundary frames stay rotate(0deg)/0 for loop closure.
    visualFrame("rotate(360deg)", 0),
    visualFrame("rotate(0deg)", 0),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [
    0, 1100, 1360, 5150, 5510, 5950, 6750, 7950, 8260, 10800,
  ]),
  ["linear", "linear", "linear", "linear", "linear", "linear", "linear", FADE_EASE, "linear"],
);

const pauseState = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(GESTURE_PRACTICE_DURATION_MS, [0, 5950, 6450, 6950, 7050, 10800]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

export const GESTURE_PRACTICE_TRACKS = {
  cursor,
  inspector,
  timer,
  artwork,
  zoomControls,
  nextReference,
  arc,
  pauseState,
} as const;

export const GESTURE_PRACTICE_GEOMETRY: SceneGeometryManifest = {
  scene: "gesture-practice",
  bounds: {
    startButton: START_BTN,
    artwork: ARTWORK,
    pause: PAUSE_BTN,
    exit: EXIT_BTN,
    zoomPlus: ZOOM_PLUS,
    zoomFit: ZOOM_FIT,
  },
  clicks: [
    { label: "start-session", point: CLICK_START, target: START_BTN },
    { label: "zoom-in", point: CLICK_PLUS, target: ZOOM_PLUS },
    { label: "pan-from", point: PAN_FROM, target: ARTWORK },
    { label: "pan-to", point: PAN_TO, target: ARTWORK },
    { label: "fit", point: CLICK_FIT, target: ZOOM_FIT },
    { label: "pause", point: CLICK_PAUSE, target: PAUSE_BTN },
    { label: "exit", point: CLICK_EXIT, target: EXIT_BTN },
  ],
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["gesture-setup", "Build a timed session"],
  ["gesture-timer", "Let Lynceus keep the pace"],
  ["gesture-zoomed", "Zoom, pan, and return to Fit"],
];

export const GESTURE_PRACTICE_REDUCED_FRAMES = reducedKinds.map(
  ([kind, caption]) => ({ caption, content: <StaticFrameArt kind={kind} /> }),
);

export function GesturePracticeScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <motion.div
        className="absolute inset-0 flex bg-background"
        animate={visualMotion(inspector, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
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
        animate={visualMotion(timer, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
      >
        <div className="absolute left-1/2 top-7 size-16 -translate-x-1/2 rounded-full border-2 border-border" />
        <div className="absolute left-1/2 top-7 size-16 -translate-x-1/2">
          <motion.div
            className="size-full origin-center rounded-full border-r-2 border-t-2 border-primary"
            animate={visualMotion(arc, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
          />
        </div>

        <motion.div
          className="absolute bottom-20 left-20 right-20 top-20 origin-center"
          animate={visualMotion(artwork, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        >
          <OnboardingSkeleton className="size-full rounded-[16px]" raised />
          <motion.div
            className="absolute inset-0 rounded-[16px] bg-surface-raised"
            animate={visualMotion(nextReference, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
          />
        </motion.div>

        <div className="absolute bottom-5 left-5 flex items-center gap-2">
          <span className="text-[10px] font-[650]">Reference</span>
          <OnboardingSkeleton className="h-2 w-12 rounded-full" />
        </div>
        <div
          className="absolute flex items-center gap-2"
          style={{ left: TRANSPORT_X, top: PAUSE_BTN.y }}
        >
          {[ChevronLeft, Pause, ChevronRight, Settings].map((Icon, index) => (
            <div key={index} className="relative grid size-9 place-items-center rounded-full border border-border bg-card">
              <Icon className="size-3.5" />
              {index === 1 && (
                <motion.span
                  className="absolute inset-0 grid place-items-center rounded-full bg-card"
                  animate={visualMotion(pauseState, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
                >
                  <Play className="size-3.5" />
                </motion.span>
              )}
            </div>
          ))}
          <div className="ml-2 grid h-9 w-[56px] place-items-center rounded-[9px] border border-border bg-card text-[10px] font-[650]">
            Exit
          </div>
        </div>
        <motion.div
          className="absolute flex items-center gap-2"
          style={{ left: 812, top: ZOOM_PLUS.y }}
          animate={visualMotion(zoomControls, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        >
          <div className="grid size-8 place-items-center rounded-[9px] border border-border bg-card"><Minus className="size-3" /></div>
          <div className="grid size-8 place-items-center rounded-[9px] border border-border bg-card"><Plus className="size-3" /></div>
          <div className="grid h-8 w-[48px] place-items-center rounded-[9px] border border-border bg-card text-[10px] font-[650]">Fit</div>
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
