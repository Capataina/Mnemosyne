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
  holdTrack,
  normaliseTimes,
  pressAt,
  visualFrame,
  visualMotion,
  visualTrack,
} from "../onboardingMotion";
import {
  CHROME,
  centre,
  rect,
  rectStyle,
  type Rect,
  type SceneGeometryManifest,
} from "../sceneGeometry";
import type { ClosedTrack, OnboardingSceneProps, VisualFrame } from "../types";
import {
  DemoAppChrome,
  DemoSceneRoot,
} from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  reducedFrames,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const ADD_FOLDER_DURATION_MS = 8000;

/**
 * Geometry — declared once, derived everywhere. The picker's internal
 * rects assume its flow layout: p-5 (20), an 18px title with mb-4 (16),
 * two h-14 rows with mb-2 (8), then an mt-4 (16) button row of h-8
 * buttons with fixed widths. Change the markup ⇒ change these together.
 */
// NB: row 2's mb-2 (8) and the button row's mt-4 (16) are adjoining
// sibling margins — they COLLAPSE to max(8,16)=16, not sum to 24, so
// the button row tops at 320+16=336 (an independent audit of the first
// derivation caught the summed version landing 8px low).
const PICKER = rect(280, 146, 380, 242);
const PICKER_ROW_1 = rect(300, 200, 340, 56);
const PICKER_ADD = rect(576, 336, 64, 32);
const INDEXING_PILL = rect(732, 86, 208, 48);

/** Arriving thumbnails: 4 masonry columns (w190, gap 16), each column
 * stacked top-down from y=118 with a 16px vertical gap — computed, so
 * tiles cannot overlap or leak by construction. */
const TILE_COLUMN_X = [64, 270, 476, 682] as const;
const TILE_HEIGHTS: readonly (readonly number[])[] = [
  [132, 150],
  [168, 120],
  [140, 150],
  [150],
];
const TILES: Rect[] = TILE_COLUMN_X.flatMap((x, col) => {
  let y = 118;
  return TILE_HEIGHTS[col].map((h) => {
    const r = rect(x, y, 190, h);
    y += h + 16;
    return r;
  });
});

const CLICK_ADD_FOLDER = centre(CHROME.addFolder);
const CLICK_ROW_1 = centre(PICKER_ROW_1);
const CLICK_ADD = centre(PICKER_ADD);

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    ...pressAt(CLICK_ADD_FOLDER),
    ...pressAt(CLICK_ROW_1),
    ...pressAt(CLICK_ADD),
    cursorFrame(CLICK_ADD.x, CLICK_ADD.y),
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

const rowSelection = holdTrack([0, 2120, 2320, 2960, 3140, 8000], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const indexingPill = holdTrack([0, 2960, 3140, 5100, 5520, 8000], {
  hidden: visualFrame("translate3d(0px, -8px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

const pillCheck = holdTrack([0, 3610, 3790, 5100, 5280, 8000], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const progress = holdTrack([0, 3140, 3790, 5100, 5520, 8000], {
  hidden: visualFrame("translate3d(0px, 0px, 0px) scaleX(0)", 0),
  shown: visualFrame("translate3d(0px, 0px, 0px) scaleX(1)", 1),
});

function tileTrack(index: number): ClosedTrack<VisualFrame> {
  const enter = 3160 + index * STAGGER_MS;
  const leave = 5100 + (TILES.length - index - 1) * 60;
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
  TILES.map((_, index) => [`tile-${index + 1}`, tileTrack(index)]),
) as Record<string, ClosedTrack<VisualFrame>>;
const tileSheenTracks = Object.fromEntries(
  TILES.map((_, index) => [`tile-sheen-${index + 1}`, tileSheenTrack(index)]),
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

export const ADD_FOLDER_GEOMETRY: SceneGeometryManifest = {
  scene: "add-folder",
  bounds: {
    picker: PICKER,
    indexingPill: INDEXING_PILL,
    ...Object.fromEntries(TILES.map((r, i) => [`tile-${i + 1}`, r])),
  },
  clicks: [
    { label: "add-folder", point: CLICK_ADD_FOLDER, target: CHROME.addFolder },
    { label: "picker-row-1", point: CLICK_ROW_1, target: PICKER_ROW_1 },
    { label: "picker-add", point: CLICK_ADD, target: PICKER_ADD },
  ],
  disjoint: { tiles: TILES },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["add-empty", "Choose a folder"],
  ["add-picker", "Keep the originals in place"],
  ["add-indexed", "Browse as thumbnails arrive"],
];

export const ADD_FOLDER_REDUCED_FRAMES = reducedFrames(reducedKinds);

export function AddFolderScene({ animationLevel }: OnboardingSceneProps) {
  const subtle = animationLevel === "subtle";
  const motionOptions = { subtle };
  const accentMotionOptions = { subtle, removeScaleAccent: true };

  return (
    <DemoSceneRoot>
      <DemoAppChrome />
      <motion.div
        className="absolute z-30 rounded-[10px] border border-primary bg-primary/10"
        style={rectStyle(CHROME.addFolder)}
        animate={visualMotion(clickAccent, ADD_FOLDER_DURATION_MS, accentMotionOptions)}
      />

      {TILES.map((tile, index) => (
        <motion.div
          key={index}
          className="absolute"
          style={rectStyle(tile)}
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
        className="absolute z-30 rounded-[16px] border border-border-strong bg-card p-5 shadow-[var(--shadow-float)]"
        style={{ left: PICKER.x, top: PICKER.y, width: PICKER.w }}
        animate={visualMotion(picker, ADD_FOLDER_DURATION_MS, accentMotionOptions)}
      >
        <p className="mb-4 h-[18px] text-[13px] font-[650] leading-[18px]">
          Choose a folder
        </p>
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
          <div className="grid h-8 w-[72px] place-items-center rounded-[9px] border border-border">
            Cancel
          </div>
          <div className="grid h-8 w-[64px] place-items-center rounded-[9px] bg-primary text-primary-foreground">
            Add
          </div>
        </div>
      </motion.div>

      <motion.div
        className="absolute z-30 flex items-center gap-3 rounded-[12px] border border-border bg-card px-3 shadow-[var(--shadow-soft)]"
        style={rectStyle(INDEXING_PILL)}
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
