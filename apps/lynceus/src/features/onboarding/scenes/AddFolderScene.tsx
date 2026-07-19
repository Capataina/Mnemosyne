import { motion } from "framer-motion";
import { Check, Folder, LoaderCircle } from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  CURSOR_TRAVEL_EASE,
  FADE_EASE,
  SETTLE_EASE,
  STAGGER_MS,
  cursorFrame,
  cursorTrack,
  normaliseTimes,
  visualFrame,
  visualMotion,
  visualTrack,
} from "../onboardingMotion";
import type { ClosedTrack, OnboardingSceneProps, VisualFrame } from "../types";
import {
  DemoAppChrome,
  DemoSceneRoot,
} from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const ADD_FOLDER_DURATION_MS = 8000;

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(842, 36),
    cursorFrame(842, 36, 0.92, 0.75, 1),
    cursorFrame(842, 36),
    cursorFrame(438, 228),
    cursorFrame(438, 228, 0.92, 0.75, 1),
    cursorFrame(438, 228),
    cursorFrame(612, 386),
    cursorFrame(612, 386, 0.92, 0.75, 1),
    cursorFrame(612, 386),
    cursorFrame(612, 386),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [
    0, 600, 1150, 1240, 1350, 2120, 2210, 2320, 2760, 2850, 2960, 5520,
    6120, 8000,
  ]),
  [
    "linear",
    CURSOR_TRAVEL_EASE,
    SETTLE_EASE,
    SETTLE_EASE,
    CURSOR_TRAVEL_EASE,
    SETTLE_EASE,
    SETTLE_EASE,
    CURSOR_TRAVEL_EASE,
    SETTLE_EASE,
    SETTLE_EASE,
    "linear",
    CURSOR_TRAVEL_EASE,
    "linear",
  ],
);

const picker = visualTrack(
  [
    visualFrame("translate3d(0px, 0px, 0px) scale(.985)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(.985)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(1)", 1),
    visualFrame("translate3d(0px, 0px, 0px) scale(1)", 1),
    visualFrame("translate3d(0px, -8px, 0px) scale(.985)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(.985)", 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 1350, 1530, 2960, 3140, 8000]),
  ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
);

const rowSelection = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 2120, 2320, 2960, 3140, 8000]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const indexingPill = visualTrack(
  [
    visualFrame("translate3d(0px, -8px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, -8px, 0px) scale(1)", 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame("translate3d(0px, -8px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, -8px, 0px) scale(1)", 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 2960, 3140, 5100, 5520, 8000]),
  ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
);

const pillCheck = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 3610, 3790, 5100, 5280, 8000]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const progress = visualTrack(
  [
    visualFrame("translate3d(0px, 0px, 0px) scaleX(0)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scaleX(0)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scaleX(1)", 1),
    visualFrame("translate3d(0px, 0px, 0px) scaleX(1)", 1),
    visualFrame("translate3d(0px, 0px, 0px) scaleX(0)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scaleX(0)", 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 3140, 3790, 5100, 5520, 8000]),
);

const tileGeometry = [
  [88, 118, 148, 120],
  [250, 118, 128, 178],
  [392, 118, 184, 134],
  [590, 118, 122, 164],
  [726, 118, 146, 110],
  [88, 312, 178, 156],
  [280, 312, 140, 126],
] as const;

function tileTrack(index: number): ClosedTrack<VisualFrame> {
  const enter = 3160 + index * STAGGER_MS;
  const leave = 5100 + (tileGeometry.length - index - 1) * 60;
  return visualTrack(
    [
      visualFrame("translate3d(0px, 10px, 0px) scale(.965)", 0),
      visualFrame("translate3d(0px, 10px, 0px) scale(.965)", 0),
      visualFrame(undefined, 1),
      visualFrame(undefined, 1),
      visualFrame("translate3d(0px, 8px, 0px) scale(.965)", 0),
      visualFrame("translate3d(0px, 10px, 0px) scale(.965)", 0),
    ],
    normaliseTimes(ADD_FOLDER_DURATION_MS, [
      0,
      enter,
      enter + 260,
      leave,
      Math.min(5520, leave + 180),
      8000,
    ]),
    ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
  );
}

function tileSheenTrack(index: number): ClosedTrack<VisualFrame> {
  const enter = 3160 + index * STAGGER_MS;
  return visualTrack(
    [
      visualFrame("translate3d(-120%, 0px, 0px) scale(1)", 0),
      visualFrame("translate3d(-120%, 0px, 0px) scale(1)", 0),
      visualFrame("translate3d(240%, 0px, 0px) scale(1)", 1),
      visualFrame("translate3d(240%, 0px, 0px) scale(1)", 0),
      visualFrame("translate3d(-120%, 0px, 0px) scale(1)", 0),
      visualFrame("translate3d(-120%, 0px, 0px) scale(1)", 0),
    ],
    normaliseTimes(ADD_FOLDER_DURATION_MS, [
      0,
      enter + 80,
      enter + 440,
      enter + 620,
      6120,
      8000,
    ]),
    ["linear", SETTLE_EASE, FADE_EASE, "linear", "linear"],
  );
}

const tileTracks = Object.fromEntries(
  tileGeometry.map((_, index) => [`tile-${index + 1}`, tileTrack(index)]),
) as Record<string, ClosedTrack<VisualFrame>>;
const tileSheenTracks = Object.fromEntries(
  tileGeometry.map((_, index) => [
    `tile-sheen-${index + 1}`,
    tileSheenTrack(index),
  ]),
) as Record<string, ClosedTrack<VisualFrame>>;

const clickAccent = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 1150, 1240, 1350, 8000]),
  ["linear", SETTLE_EASE, SETTLE_EASE, "linear"],
);

export const ADD_FOLDER_TRACKS = {
  cursor,
  picker,
  rowSelection,
  indexingPill,
  pillCheck,
  progress,
  clickAccent,
  ...tileTracks,
  ...tileSheenTracks,
} as const;

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["add-empty", "Choose a folder"],
  ["add-picker", "Keep the originals in place"],
  ["add-indexed", "Browse as thumbnails arrive"],
];

export const ADD_FOLDER_REDUCED_FRAMES = reducedKinds.map(([kind, caption]) => ({
  caption,
  content: <StaticFrameArt kind={kind} />,
}));

export function AddFolderScene({ animationLevel }: OnboardingSceneProps) {
  const subtle = animationLevel === "subtle";
  const motionOptions = { subtle };
  const accentMotionOptions = { subtle, removeScaleAccent: true };

  return (
    <DemoSceneRoot>
      <DemoAppChrome />
      <motion.div
        className="absolute left-[768px] top-[17px] z-30 h-9 w-[106px] rounded-[10px] border border-primary bg-primary/10"
        animate={visualMotion(clickAccent, ADD_FOLDER_DURATION_MS, accentMotionOptions)}
      />

      {tileGeometry.map(([left, top, width, height], index) => (
        <motion.div
          key={index}
          className="absolute"
          style={{ left, top, width, height }}
          animate={visualMotion(
            tileTracks[`tile-${index + 1}`],
            ADD_FOLDER_DURATION_MS,
            accentMotionOptions,
          )}
        >
          <OnboardingSkeleton
            raised={index % 3 === 1}
            className="size-full rounded-[14px] border border-border/70"
            sheen={
              animationLevel === "standard"
                ? {
                    track: tileSheenTracks[`tile-sheen-${index + 1}`],
                    durationMs: ADD_FOLDER_DURATION_MS,
                  }
                : undefined
            }
          />
        </motion.div>
      ))}

      <motion.div
        className="absolute left-[280px] top-[146px] z-30 w-[380px] rounded-[16px] border border-border-strong bg-card p-5 shadow-[var(--shadow-float)]"
        animate={visualMotion(picker, ADD_FOLDER_DURATION_MS, accentMotionOptions)}
      >
        <p className="mb-4 text-[13px] font-[650]">Choose a folder</p>
        {[0, 1].map((index) => (
          <div
            key={index}
            className="relative mb-2 flex h-14 items-center gap-3 rounded-[10px] border border-border bg-surface px-3"
          >
            <Folder className="size-4 text-muted-foreground" strokeWidth={1.7} />
            <div className="flex-1">
              <OnboardingSkeleton className="h-2.5 w-3/4 rounded-full" />
              <OnboardingSkeleton className="mt-2 h-2 w-1/2 rounded-full" />
            </div>
            {index === 0 && (
              <motion.span
                className="absolute inset-0 rounded-[10px] border border-primary/70 bg-primary/10"
                animate={visualMotion(rowSelection, ADD_FOLDER_DURATION_MS, motionOptions)}
              >
                <Check className="absolute right-3 top-4 size-4 text-primary" />
              </motion.span>
            )}
          </div>
        ))}
        <div className="mt-4 flex justify-end gap-2 text-[11px] font-[600]">
          <div className="rounded-[9px] border border-border px-3 py-2">Cancel</div>
          <div className="rounded-[9px] bg-primary px-3 py-2 text-primary-foreground">
            Add
          </div>
        </div>
      </motion.div>

      <motion.div
        className="absolute right-5 top-[86px] z-30 flex h-12 w-[208px] items-center gap-3 rounded-[12px] border border-border bg-card px-3 shadow-[var(--shadow-soft)]"
        animate={visualMotion(indexingPill, ADD_FOLDER_DURATION_MS, motionOptions)}
      >
        <LoaderCircle className="size-4 text-primary" strokeWidth={1.8} />
        <motion.div
          className="absolute left-3 top-4 text-success"
          animate={visualMotion(pillCheck, ADD_FOLDER_DURATION_MS, motionOptions)}
        >
          <Check className="size-4" strokeWidth={2} />
        </motion.div>
        <div className="flex-1">
          <OnboardingSkeleton className="h-2 w-24 rounded-full" />
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-input">
            <motion.div
              className="h-full w-full origin-left rounded-full bg-primary"
              animate={visualMotion(progress, ADD_FOLDER_DURATION_MS, motionOptions)}
            />
          </div>
        </div>
      </motion.div>

      <FakeCursor
        track={cursor}
        durationMs={ADD_FOLDER_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
