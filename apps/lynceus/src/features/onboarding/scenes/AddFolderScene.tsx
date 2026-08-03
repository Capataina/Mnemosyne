import { motion } from "framer-motion";
import { Check, Folder, FolderPlus, LoaderCircle } from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  CURSOR_TRAVEL_EASE,
  FADE_EASE,
  LIVE_EASE,
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

export const ADD_FOLDER_DURATION_MS = 7000;

/**
 * v2 beat sheet (times in ms):
 *   0– 500  empty grid, cursor parked
 *  500–1250  cursor travels to the Settings gear, presses it
 * 1250–1430  the settings edge panel slides in from the RIGHT screen edge
 *            (the real app's shape: flush-right, translateX(100%→0), rounded
 *            on the inner/left edge only, no scrim — settings/index.tsx)
 * 1900–2100  cursor presses "Add folder" inside the panel
 * 2100–2300  the folder picker rises
 * 2700–2900  cursor presses folder row 1 (selection ring rises with the press)
 * 3300–3500  cursor presses the picker's Add
 * 3500–3680  picker dismisses AND the panel slides back out
 * 3650–4330  the masonry cascade: tiles rain in on a top-left→bottom-right
 *            diagonal wave, each dropping 26px with a small overshoot before
 *            settling; a sheen sweeps each tile as it lands
 * 3680–5950  indexing pill: slides in, progress fills, loader→check, leaves
 * 6350–6770  quick staggered tile fade — the loop reset, kept to ~420ms so
 *            the restart feels immediate (the v1 tail idled 6120→8000)
 */

/**
 * Geometry — declared once, derived everywhere.
 *
 * Settings edge panel: mirrors the real app's right-edge slide-out
 * (flush against x=960, below the 72px header with a 12px inset top
 * and bottom — the app's `top-[84px] bottom-3` at stage scale).
 */
const PANEL = rect(672, 84, 288, 504);
// Panel flow arithmetic (p-4 = 16 each side): title 16px + mb-4 (16),
// "Folders" label 14px + mb-3 (12), two h-12 rows each with mb-2 (8),
// then the h-9 Add button with NO own top margin — row 2's mb-2 is the
// only margin at that junction, so no adjoining-margin collapse enters:
// y = 84+16 +16+16 +14+12 +48+8 +48+8 = 270. x = 672+16; w = 288−32.
const PANEL_ADD = rect(688, 270, 256, 36);

/**
 * The picker's internal rects assume its flow layout: p-5 (20), an 18px
 * title with mb-4 (16), two h-14 rows with mb-2 (8), then an mt-4 (16)
 * button row of h-8 buttons with fixed widths. Change the markup ⇒
 * change these together.
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
const TILE_TOP = 118;
const TILE_HEIGHTS: readonly (readonly number[])[] = [
  [132, 150],
  [168, 120],
  [140, 150],
  [150],
];
const TILES: Rect[] = TILE_COLUMN_X.flatMap((x, col) => {
  let y = TILE_TOP;
  return TILE_HEIGHTS[col].map((h) => {
    const r = rect(x, y, 190, h);
    y += h + 16;
    return r;
  });
});

/** Diagonal cascade wave: each tile's entry delay is derived from its
 * own rect — normalised x across the column span plus normalised y
 * across the row span — so the library visibly pours in from the
 * top-left corner toward the bottom-right. */
const CASCADE_START = 3650;
const WAVE_X_MS = 180;
const WAVE_Y_MS = 260;
const TILE_X_SPAN = TILE_COLUMN_X[TILE_COLUMN_X.length - 1] - TILE_COLUMN_X[0];
const TILE_Y_SPAN = Math.max(...TILES.map((r) => r.y)) - TILE_TOP;
const waveMs = (r: Rect): number =>
  Math.round(
    ((r.x - TILE_COLUMN_X[0]) / TILE_X_SPAN) * WAVE_X_MS +
      ((r.y - TILE_TOP) / TILE_Y_SPAN) * WAVE_Y_MS,
  );
/** Loop reset: a quick staggered fade starting here — last tile is gone
 * by 6770, leaving only ~230ms of empty stage before the restart. */
const CASCADE_EXIT = 6350;

const CLICK_SETTINGS = centre(CHROME.settings);
const CLICK_PANEL_ADD = centre(PANEL_ADD);
const CLICK_ROW_1 = centre(PICKER_ROW_1);
const CLICK_PICK = centre(PICKER_ADD);

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    ...pressAt(CLICK_SETTINGS),
    ...pressAt(CLICK_PANEL_ADD),
    ...pressAt(CLICK_ROW_1),
    ...pressAt(CLICK_PICK),
    cursorFrame(CLICK_PICK.x, CLICK_PICK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [
    0, 500, 1050, 1140, 1250, 1900, 1990, 2100, 2700, 2790, 2900, 3300,
    3390, 3500, 3600, 4200, 7000,
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
    CURSOR_TRAVEL_EASE,
    SETTLE_EASE,
    SETTLE_EASE,
    "linear",
    CURSOR_TRAVEL_EASE,
    "linear",
  ],
);

/** The edge panel: offstage right (its own width + shadow clearance),
 * slides to rest after the gear press, slides away on the picker's Add.
 * Opacity stays 1 throughout — the slide IS the reveal, per the app. */
const panel = holdTrack([0, 1250, 1430, 3500, 3680, 7000], {
  hidden: visualFrame(`translate3d(${PANEL.w + 40}px, 0px, 0px) scale(1)`, 1),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: LIVE_EASE,
});

const gearAccent = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 1050, 1140, 1250, 7000]),
  ["linear", SETTLE_EASE, SETTLE_EASE, "linear"],
);

const panelAddAccent = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 1900, 1990, 2100, 7000]),
  ["linear", SETTLE_EASE, SETTLE_EASE, "linear"],
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
  normaliseTimes(ADD_FOLDER_DURATION_MS, [0, 2100, 2300, 3500, 3680, 7000]),
  ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
);

const rowSelection = holdTrack([0, 2700, 2900, 3500, 3680, 7000], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const indexingPill = holdTrack([0, 3680, 3860, 5750, 5950, 7000], {
  hidden: visualFrame("translate3d(0px, -8px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

const pillCheck = holdTrack([0, 5100, 5280, 5750, 5930, 7000], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const progress = holdTrack([0, 3860, 5100, 5750, 5950, 7000], {
  hidden: visualFrame("translate3d(0px, 0px, 0px) scaleX(0)", 0),
  shown: visualFrame("translate3d(0px, 0px, 0px) scaleX(1)", 1),
});

/** Tile entry with settle physics: drop 26px at 92% scale, overshoot
 * 5px past rest, then settle — LIVE_EASE into the overshoot (fast
 * arrival), SETTLE_EASE out of it (soft landing). */
function tileTrack(index: number): ClosedTrack<VisualFrame> {
  const enter = CASCADE_START + waveMs(TILES[index]);
  const leave = CASCADE_EXIT + (TILES.length - index - 1) * 30;
  const drop = visualFrame("translate3d(0px, 26px, 0px) scale(.92)", 0);
  return visualTrack(
    [
      drop,
      drop,
      visualFrame("translate3d(0px, -5px, 0px) scale(1.01)", 1),
      visualFrame(undefined, 1),
      visualFrame(undefined, 1),
      visualFrame("translate3d(0px, 14px, 0px) scale(.95)", 0),
      drop,
    ],
    normaliseTimes(ADD_FOLDER_DURATION_MS, [
      0,
      enter,
      enter + 190,
      enter + 330,
      leave,
      leave + 240,
      7000,
    ]),
    ["linear", LIVE_EASE, SETTLE_EASE, "linear", FADE_EASE, "linear"],
  );
}

function tileSheenTrack(index: number): ClosedTrack<VisualFrame> {
  const enter = CASCADE_START + waveMs(TILES[index]);
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
      enter + 260,
      enter + 680,
      enter + 840,
      6300,
      7000,
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

export const ADD_FOLDER_TRACKS = {
  cursor,
  panel,
  gearAccent,
  panelAddAccent,
  picker,
  rowSelection,
  indexingPill,
  pillCheck,
  progress,
  ...tileTracks,
  ...tileSheenTracks,
} as const;

export const ADD_FOLDER_GEOMETRY: SceneGeometryManifest = {
  scene: "add-folder",
  bounds: {
    panel: PANEL,
    panelAdd: PANEL_ADD,
    picker: PICKER,
    indexingPill: INDEXING_PILL,
    ...Object.fromEntries(TILES.map((r, i) => [`tile-${i + 1}`, r])),
  },
  clicks: [
    { label: "settings", point: CLICK_SETTINGS, target: CHROME.settings },
    { label: "add-folder", point: CLICK_PANEL_ADD, target: PANEL_ADD },
    { label: "picker-row-1", point: CLICK_ROW_1, target: PICKER_ROW_1 },
    { label: "picker-add", point: CLICK_PICK, target: PICKER_ADD },
  ],
  disjoint: { tiles: TILES, panelAndPicker: [PANEL, PICKER] },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["add-empty", "Open Settings to add a folder"],
  ["add-picker", "Pick a folder — originals stay in place"],
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
        style={rectStyle(CHROME.settings)}
        animate={visualMotion(gearAccent, ADD_FOLDER_DURATION_MS, accentMotionOptions)}
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
        className="absolute z-30 rounded-l-[16px] border border-border-strong bg-card p-4 shadow-[var(--shadow-float)]"
        style={rectStyle(PANEL)}
        animate={visualMotion(panel, ADD_FOLDER_DURATION_MS, motionOptions)}
      >
        <p className="mb-4 h-[16px] text-[13px] font-[650] leading-[16px]">
          Settings
        </p>
        <p className="mb-3 h-[14px] text-[11px] font-[600] leading-[14px] text-muted-foreground">
          Folders
        </p>
        {[0, 1].map((index) => (
          <div
            key={index}
            className="mb-2 flex h-12 items-center gap-3 rounded-[10px] border border-border bg-surface px-3"
          >
            <Folder className="size-4 text-muted-foreground" strokeWidth={1.7} />
            <div className="flex-1">
              <OnboardingSkeleton className="h-2.5 w-3/4 rounded-full" />
              <OnboardingSkeleton className="mt-2 h-2 w-1/2 rounded-full" />
            </div>
          </div>
        ))}
        <div className="relative flex h-9 items-center justify-center gap-1.5 rounded-[9px] border border-border bg-surface text-[11px] font-[600]">
          <FolderPlus className="size-3.5" strokeWidth={1.8} />
          Add folder
          <motion.span
            className="absolute inset-0 rounded-[9px] border border-primary bg-primary/10"
            animate={visualMotion(
              panelAddAccent,
              ADD_FOLDER_DURATION_MS,
              accentMotionOptions,
            )}
          />
        </div>
      </motion.div>

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
