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
import type { OnboardingSceneProps } from "../types";
import { DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const GESTURE_PRACTICE_DURATION_MS = 10800;

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(796, 500),
    cursorFrame(796, 500, 0.92, 0.75, 1),
    cursorFrame(796, 500),
    cursorFrame(884, 526),
    cursorFrame(884, 526, 0.92, 0.75, 1),
    cursorFrame(884, 526),
    cursorFrame(480, 300),
    cursorFrame(480, 300, 0.92),
    cursorFrame(552, 332, 0.92),
    cursorFrame(552, 332),
    cursorFrame(916, 526),
    cursorFrame(916, 526, 0.92, 0.75, 1),
    cursorFrame(916, 526),
    cursorFrame(486, 548),
    cursorFrame(486, 548, 0.92, 0.75, 1),
    cursorFrame(486, 548),
    cursorFrame(486, 548, 0.92, 0.75, 1),
    cursorFrame(486, 548),
    cursorFrame(606, 548),
    cursorFrame(606, 548, 0.92, 0.75, 1),
    cursorFrame(606, 548),
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
          <h3 className="mb-5 text-[14px] font-[650]">Timer</h3>
          {["w-full", "w-3/4", "w-5/6", "w-2/3"].map((width) => (
            <OnboardingSkeleton key={width} className={`mb-4 h-3 ${width} rounded-full`} />
          ))}
          <div className="mt-10 rounded-[10px] bg-primary px-4 py-3 text-center text-[11px] font-[650] text-primary-foreground">
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
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
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
          <div className="ml-2 rounded-[9px] border border-border bg-card px-3 py-2 text-[10px] font-[650]">
            Exit
          </div>
        </div>
        <motion.div
          className="absolute bottom-4 right-5 flex items-center gap-2"
          animate={visualMotion(zoomControls, GESTURE_PRACTICE_DURATION_MS, motionOptions)}
        >
          <div className="grid size-8 place-items-center rounded-[9px] border border-border bg-card"><Minus className="size-3" /></div>
          <div className="grid size-8 place-items-center rounded-[9px] border border-border bg-card"><Plus className="size-3" /></div>
          <div className="rounded-[9px] border border-border bg-card px-3 py-2 text-[10px] font-[650]">Fit</div>
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
