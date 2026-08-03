import { motion } from "framer-motion";
import { Check, Minus, Plus, X } from "lucide-react";
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
  CHROME,
  centre,
  makeGrid,
  moveTo,
  rect,
  rectStyle,
  type SceneGeometryManifest,
} from "../sceneGeometry";
import type { ClosedTrack, OnboardingSceneProps, VisualFrame } from "../types";
import { DemoAppChrome, DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  reducedFrames,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const ORGANISE_DURATION_MS = 9600;

/**
 * Results grid: 3 columns of 168×102 cells, 12px gaps (the container is
 * w-[528px] with grid-cols-3 gap-3, which yields exactly these cells —
 * change one, change both). Filtering REMOVES tiles and COMPACTS the
 * survivors: each survivor translates from its base cell to the cell of
 * its new index among survivors — computed, so nothing stacks or drifts.
 */
const ORGANISE_GRID = makeGrid({
  originX: 382,
  originY: 104,
  cellW: 168,
  cellH: 102,
  gapX: 12,
  gapY: 12,
});

const TILE_COUNT = 12;
const baseCell = (index: number) =>
  ORGANISE_GRID.cell(index % 3, Math.floor(index / 3));

const FOLDER_REMOVED = new Set([2, 7, 10]);
const INCLUDE_REMOVED = new Set([...FOLDER_REMOVED, 1, 5]);
const EXCLUDE_REMOVED = new Set([...INCLUDE_REMOVED, 4]);

function filteredFrame(index: number, removed: Set<number>): VisualFrame {
  if (removed.has(index)) {
    return { transform: "translate3d(0px, 0px, 0px) scale(.96)", opacity: 0 };
  }
  let survivorIndex = 0;
  for (let k = 0; k < index; k += 1) {
    if (!removed.has(k)) survivorIndex += 1;
  }
  const target = ORGANISE_GRID.cell(
    survivorIndex % 3,
    Math.floor(survivorIndex / 3),
  );
  return { transform: moveTo(baseCell(index), target), opacity: 1 };
}

function gridTileTrack(index: number): ClosedTrack<VisualFrame> {
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      filteredFrame(index, FOLDER_REMOVED),
      filteredFrame(index, INCLUDE_REMOVED),
      filteredFrame(index, EXCLUDE_REMOVED),
      filteredFrame(index, EXCLUDE_REMOVED),
      visualFrame(),
      visualFrame(),
    ],
    normaliseTimes(ORGANISE_DURATION_MS, [0, 1800, 2200, 3360, 4510, 6000, 6420, 9600]),
    ["linear", SETTLE_EASE, SETTLE_EASE, SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
  );
}

const gridTracks = Array.from({ length: TILE_COUNT }, (_, index) =>
  gridTileTrack(index),
);

/**
 * Drawer geometry — the drawer is 360 wide under the 72px header, p-5
 * (20) padding, with every flow element's height pinned in the markup so
 * these rects stay true: header row h-[20px] mb-5, section labels
 * h-[14px] mb-3, All-images h-10 mb-2, folder rows h-11 mb-2, divider
 * my-5, refine rows h-12 mb-2.
 */
const DRAWER = rect(0, 72, 360, 528);
const CLOSE_X = rect(324, 94, 16, 16);
const FOLDER_ROW_1 = rect(20, 206, 320, 44);
const CLEAR = rect(300, 343, 40, 14);
const MUST_HAVE = rect(20, 369, 320, 48);
const MUST_HAVE_CONTROL = rect(300, 381, 28, 24);
const MUST_NOT = rect(20, 425, 320, 48);
const MUST_NOT_CONTROL = rect(300, 437, 28, 24);
const SEARCH_CHIP = rect(294, 24, 80, 24);

const CLICK_LIBRARY = centre(CHROME.leadingPill);
const CLICK_FOLDER = centre(FOLDER_ROW_1);
const CLICK_INCLUDE = centre(MUST_HAVE_CONTROL);
const CLICK_EXCLUDE = centre(MUST_NOT_CONTROL);
const CLICK_CLEAR = centre(CLEAR);
const CLICK_CLOSE = centre(CLOSE_X);

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    ...pressAt(CLICK_LIBRARY),
    ...pressAt(CLICK_FOLDER),
    ...pressAt(CLICK_INCLUDE),
    ...pressAt(CLICK_EXCLUDE),
    ...pressAt(CLICK_CLEAR),
    ...pressAt(CLICK_CLOSE),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [
    0, 500, 900, 1000, 1200, 1700, 1800, 2200, 2900, 3000, 3360, 4050,
    4150, 4510, 5900, 6000, 6420, 7100, 7200, 7350, 7850, 9600,
  ]),
);

const drawer = holdTrack([0, 500, 1000, 6720, 7200, 9600], {
  hidden: visualFrame("translate3d(-360px, 0px, 0px) scale(1)", 1),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: SETTLE_EASE,
});

const backdrop = holdTrack([0, 500, 1000, 6720, 7200, 9600], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const folderState = holdTrack([0, 1800, 2200, 6000, 6420, 9600], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const includeState = holdTrack([0, 3000, 3360, 6000, 6420, 9600], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const excludeState = holdTrack([0, 4150, 4510, 6000, 6420, 9600], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const searchChip = folderState;

export const ORGANISE_TRACKS = {
  cursor,
  drawer,
  backdrop,
  folderState,
  includeState,
  excludeState,
  searchChip,
  ...Object.fromEntries(gridTracks.map((track, index) => [`tile-${index}`, track])),
} as const;

const BASE_TILES = Array.from({ length: TILE_COUNT }, (_, i) => baseCell(i));

export const ORGANISE_GEOMETRY: SceneGeometryManifest = {
  scene: "organise",
  bounds: {
    drawer: DRAWER,
    searchChip: SEARCH_CHIP,
    ...Object.fromEntries(BASE_TILES.map((r, i) => [`tile-${i}`, r])),
  },
  clicks: [
    { label: "library", point: CLICK_LIBRARY, target: CHROME.leadingPill },
    { label: "folder-row", point: CLICK_FOLDER, target: FOLDER_ROW_1 },
    { label: "must-have", point: CLICK_INCLUDE, target: MUST_HAVE },
    { label: "must-not", point: CLICK_EXCLUDE, target: MUST_NOT },
    { label: "clear", point: CLICK_CLEAR, target: CLEAR },
    { label: "close", point: CLICK_CLOSE, target: CLOSE_X },
  ],
  disjoint: {
    base: BASE_TILES,
    folderFiltered: BASE_TILES.filter((_, i) => !FOLDER_REMOVED.has(i)).map(
      (_, j) => ORGANISE_GRID.cell(j % 3, Math.floor(j / 3)),
    ),
    excludeFiltered: BASE_TILES.filter((_, i) => !EXCLUDE_REMOVED.has(i)).map(
      (_, j) => ORGANISE_GRID.cell(j % 3, Math.floor(j / 3)),
    ),
  },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["organise-all", "Browse every tag as a folder"],
  ["organise-filters", "Combine must-have and must-not-have"],
  ["organise-refined", "Refine without moving originals"],
];

export const ORGANISE_REDUCED_FRAMES = reducedFrames(reducedKinds);

export function OrganiseScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <DemoAppChrome
        leading={
          <div className="grid size-full place-items-center rounded-[9px] border border-border bg-surface text-[10.5px] font-[600]">
            Library
          </div>
        }
      />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/35" />

      <div
        className="absolute grid w-[528px] grid-cols-3 gap-3"
        style={{ left: ORGANISE_GRID.originX, top: ORGANISE_GRID.originY }}
      >
        {gridTracks.map((track, index) => (
          <motion.div
            key={index}
            className="h-[102px]"
            animate={visualMotion(track, ORGANISE_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton
              raised={index % 4 === 0}
              className="size-full rounded-[14px] border border-border/70"
            />
          </motion.div>
        ))}
      </div>

      <motion.div
        className="absolute inset-0 z-20 bg-background/45"
        animate={visualMotion(backdrop, ORGANISE_DURATION_MS, motionOptions)}
      />
      <motion.aside
        className="absolute bottom-0 left-0 top-[72px] z-30 w-[360px] border-r border-border bg-card p-5 shadow-[var(--shadow-float)]"
        animate={visualMotion(drawer, ORGANISE_DURATION_MS, motionOptions)}
      >
        <div className="mb-5 flex h-[20px] items-center justify-between">
          <h3 className="text-[14px] font-[650] leading-[20px]">Library</h3>
          <X className="size-4 text-muted-foreground" />
        </div>
        <p className="mb-3 h-[14px] text-[10px] font-[650] leading-[14px] text-muted-foreground">
          Folders
        </p>
        <div className="mb-2 flex h-10 items-center justify-between rounded-[9px] px-3 text-[11px] font-[600]">
          <span>All images</span>
          <OnboardingSkeleton className="h-2 w-7 rounded-full" />
        </div>
        {[0, 1].map((index) => (
          <div
            key={index}
            className="relative mb-2 flex h-11 items-center gap-3 rounded-[9px] border border-border px-3"
          >
            <OnboardingSkeleton className="size-4 rounded" />
            <OnboardingSkeleton className="h-2 flex-1 rounded-full" />
            <OnboardingSkeleton className="h-2 w-6 rounded-full" />
            {index === 0 && (
              <motion.div
                className="absolute inset-0 rounded-[9px] border border-primary/60 bg-primary/10"
                animate={visualMotion(folderState, ORGANISE_DURATION_MS, motionOptions)}
              />
            )}
          </div>
        ))}
        <div className="my-5 h-px bg-border" />
        <div className="mb-3 flex h-[14px] items-center justify-between">
          <p className="text-[10px] font-[650] leading-[14px] text-muted-foreground">
            Refine
          </p>
          <span className="text-[10px] font-[650] leading-[14px]">Clear</span>
        </div>
        {[
          { label: "Must have", icon: Plus, track: includeState, destructive: false },
          { label: "Must not have", icon: Minus, track: excludeState, destructive: true },
        ].map(({ label, icon: Icon, track, destructive }) => (
          <div key={label} className="relative mb-2 flex h-12 items-center gap-3 rounded-[9px] border border-border px-3">
            <OnboardingSkeleton className="size-4 rounded" />
            <OnboardingSkeleton className="h-2 flex-1 rounded-full" />
            <span className="text-[9px] font-[600]">{label}</span>
            <Icon className="size-3.5" />
            <motion.div
              className={[
                "absolute inset-0 rounded-[9px] border",
                destructive
                  ? "border-destructive/60 bg-destructive/10"
                  : "border-primary/60 bg-primary/10",
              ].join(" ")}
              animate={visualMotion(track, ORGANISE_DURATION_MS, motionOptions)}
            >
              <Check className={[
                "absolute right-3 top-4 size-3.5",
                destructive ? "text-destructive" : "text-primary",
              ].join(" ")} />
            </motion.div>
          </div>
        ))}
      </motion.aside>

      <motion.div
        className="absolute z-40 rounded-full border border-primary/50 bg-primary/10"
        style={rectStyle(SEARCH_CHIP)}
        animate={visualMotion(searchChip, ORGANISE_DURATION_MS, motionOptions)}
      />

      <FakeCursor
        track={cursor}
        durationMs={ORGANISE_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
