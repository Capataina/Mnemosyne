import { motion } from "framer-motion";
import { ChevronLeft, Maximize2 } from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  CURSOR_TRAVEL_EASE,
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
  makeGrid,
  mapTo,
  moveTo,
  rect,
  rectStyle,
  type Rect,
  type SceneGeometryManifest,
} from "../sceneGeometry";
import type { ClosedTrack, OnboardingSceneProps, VisualFrame } from "../types";
import { DemoAppChrome, DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import { SkeletonInspector } from "../primitives/SkeletonInspector";
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const SIMILARITY_DURATION_MS = 10800;

/**
 * Feed: 5 columns of 160×142 tiles, 12px gaps, two rows. Selecting tile
 * 1 maps it onto the exact 2×2-cell hero footprint (position AND size
 * computed from the grid) while the six strongest results re-pack into
 * the remaining three columns; the weakest three fade where they stand.
 */
export const SIMILARITY_GRID = makeGrid({
  originX: 48,
  originY: 158,
  cellW: 160,
  cellH: 142,
  gapX: 12,
  gapY: 12,
});

const TILE_COUNT = 10;
const HERO_INDEX = 1;
const baseCell = (index: number) =>
  SIMILARITY_GRID.cell(index % 5, Math.floor(index / 5));

const HERO_RECT = SIMILARITY_GRID.span(0, 0, 2, 2);
const HERO_TRANSFORM = mapTo(baseCell(HERO_INDEX), HERO_RECT);

/** Result slots to the hero's right, filled in reading order. */
const RESULT_SLOTS: readonly (readonly [number, number])[] = [
  [2, 0], [3, 0], [4, 0], [2, 1], [3, 1], [4, 1],
];
const VISIBLE_RESULTS = [0, 2, 3, 4, 5, 6] as const;

function resultSlotIndex(tile: number): number | undefined {
  const i = VISIBLE_RESULTS.indexOf(tile as (typeof VISIBLE_RESULTS)[number]);
  return i === -1 ? undefined : i;
}

/** The dive beat re-ranks: the tiles in slots 1 and 3 trade places. */
const DIVE_SLOT_SWAP: Record<number, number> = { 1: 3, 3: 1 };

function sceneFrame(tile: number, dive: boolean): VisualFrame {
  if (tile === HERO_INDEX) return { transform: HERO_TRANSFORM, opacity: 1 };
  const slotIndex = resultSlotIndex(tile);
  if (slotIndex === undefined) {
    return { transform: "translate3d(0px, 0px, 0px) scale(.97)", opacity: 0 };
  }
  const finalSlot = dive ? (DIVE_SLOT_SWAP[slotIndex] ?? slotIndex) : slotIndex;
  const [col, row] = RESULT_SLOTS[finalSlot];
  return {
    transform: moveTo(baseCell(tile), SIMILARITY_GRID.cell(col, row)),
    opacity: 1,
  };
}

function feedTileTrack(index: number): ClosedTrack<VisualFrame> {
  const sim = sceneFrame(index, false);
  const dive = sceneFrame(index, true);
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      sim,
      sim,
      dive,
      dive,
      visualFrame(),
      visualFrame(),
    ],
    normaliseTimes(SIMILARITY_DURATION_MS, [0, 1100, 1500, 2350, 2750, 7750, 8200, 10800]),
    ["linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
  );
}

const tileTracks = Array.from({ length: TILE_COUNT }, (_, index) =>
  feedTileTrack(index),
);

/** Chrome rects (header links pinned; inspector geometry is fully
 * determined by its inset-42 layout and the 290px aside). */
const BACK_ONE = rect(760, 88, 70, 16);
const BACK_ALL = rect(846, 88, 66, 16);
const NAV_NEXT = rect(339, 58, 32, 32);
const INSPECTOR_CLOSE = rect(878, 66, 16, 16);
/** The hero's expand button, at its SCALED position (child of the
 * mapped tile): unscaled offset (124,8,28,28) × hero scale. */
const EXPAND_SCALED = rect(305, 175, 58, 58);

const CLICK_TILE = centre(baseCell(HERO_INDEX));
const CLICK_RESULT = centre(SIMILARITY_GRID.cell(...RESULT_SLOTS[1]));
const CLICK_EXPAND = centre(EXPAND_SCALED);
const CLICK_NEXT = centre(NAV_NEXT);
const CLICK_CLOSE = centre(INSPECTOR_CLOSE);
const CLICK_BACK_ALL = centre(BACK_ALL);

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CLICK_TILE.x, CLICK_TILE.y),
    cursorFrame(CLICK_TILE.x, CLICK_TILE.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_TILE.x, CLICK_TILE.y),
    cursorFrame(CLICK_RESULT.x, CLICK_RESULT.y),
    cursorFrame(CLICK_RESULT.x, CLICK_RESULT.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_RESULT.x, CLICK_RESULT.y),
    cursorFrame(CLICK_EXPAND.x, CLICK_EXPAND.y),
    cursorFrame(CLICK_EXPAND.x, CLICK_EXPAND.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_EXPAND.x, CLICK_EXPAND.y),
    cursorFrame(CLICK_NEXT.x, CLICK_NEXT.y),
    cursorFrame(CLICK_NEXT.x, CLICK_NEXT.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_NEXT.x, CLICK_NEXT.y),
    cursorFrame(CLICK_CLOSE.x, CLICK_CLOSE.y),
    cursorFrame(CLICK_CLOSE.x, CLICK_CLOSE.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_CLOSE.x, CLICK_CLOSE.y),
    cursorFrame(CLICK_BACK_ALL.x, CLICK_BACK_ALL.y),
    cursorFrame(CLICK_BACK_ALL.x, CLICK_BACK_ALL.y, 0.92, 0.75, 1),
    cursorFrame(CLICK_BACK_ALL.x, CLICK_BACK_ALL.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(SIMILARITY_DURATION_MS, [
    0, 600, 1000, 1100, 1500, 2250, 2350, 2750, 3550, 3650, 3910, 4950,
    5050, 5910, 6650, 6750, 7010, 7650, 7750, 8200, 8850, 10800,
  ]),
  [
    "linear", CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE,
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE,
    SETTLE_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE, SETTLE_EASE,
    SETTLE_EASE, CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE,
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE,
    "linear",
  ],
);

const similarityChrome = visualTrack(
  [
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
  ],
  normaliseTimes(SIMILARITY_DURATION_MS, [0, 1100, 1500, 7750, 8200, 10800]),
  ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
);

const breadcrumb = visualTrack(
  [
    visualFrame("translate3d(-8px, 0px, 0px) scale(1)", 0),
    visualFrame("translate3d(-8px, 0px, 0px) scale(1)", 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame("translate3d(-8px, 0px, 0px) scale(1)", 0),
    visualFrame("translate3d(-8px, 0px, 0px) scale(1)", 0),
  ],
  normaliseTimes(SIMILARITY_DURATION_MS, [0, 2350, 2750, 7750, 8200, 10800]),
  ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
);

const inspector = visualTrack(
  [
    visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 0),
  ],
  normaliseTimes(SIMILARITY_DURATION_MS, [0, 3650, 3910, 6750, 7010, 10800]),
  ["linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
);

const inspectorNext = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(SIMILARITY_DURATION_MS, [0, 5050, 5550, 5910, 6750, 10800]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

export const SIMILARITY_TRACKS = {
  cursor,
  similarityChrome,
  breadcrumb,
  inspector,
  inspectorNext,
  ...Object.fromEntries(tileTracks.map((track, index) => [`tile-${index}`, track])),
} as const;

const BASE_TILES: Rect[] = Array.from({ length: TILE_COUNT }, (_, i) =>
  baseCell(i),
);
const SIM_LAYOUT: Rect[] = [
  HERO_RECT,
  ...VISIBLE_RESULTS.map((t) => {
    const [col, row] = RESULT_SLOTS[resultSlotIndex(t)!];
    return SIMILARITY_GRID.cell(col, row);
  }),
];

export const SIMILARITY_GEOMETRY: SceneGeometryManifest = {
  scene: "similarity",
  bounds: {
    hero: HERO_RECT,
    backOne: BACK_ONE,
    backAll: BACK_ALL,
    ...Object.fromEntries(BASE_TILES.map((r, i) => [`tile-${i}`, r])),
  },
  clicks: [
    { label: "select-tile", point: CLICK_TILE, target: baseCell(HERO_INDEX) },
    {
      label: "dive-result",
      point: CLICK_RESULT,
      target: SIMILARITY_GRID.cell(...RESULT_SLOTS[1]),
    },
    { label: "expand", point: CLICK_EXPAND, target: EXPAND_SCALED },
    { label: "inspector-next", point: CLICK_NEXT, target: NAV_NEXT },
    { label: "inspector-close", point: CLICK_CLOSE, target: INSPECTOR_CLOSE },
    { label: "back-to-all", point: CLICK_BACK_ALL, target: BACK_ALL },
  ],
  disjoint: { base: BASE_TILES, similarity: SIM_LAYOUT },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["similarity-feed", "Choose an image"],
  ["similarity-trail", "Follow a visual trail"],
  ["similarity-inspector", "Inspect and annotate"],
];

export const SIMILARITY_REDUCED_FRAMES = reducedKinds.map(([kind, caption]) => ({
  caption,
  content: <StaticFrameArt kind={kind} />,
}));

export function SimilarityScene({ animationLevel }: OnboardingSceneProps) {
  const subtle = animationLevel === "subtle";
  const motionOptions = { subtle };
  const accentMotionOptions = { subtle, removeScaleAccent: true };

  return (
    <DemoSceneRoot>
      <DemoAppChrome />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/30" />

      <motion.div
        className="absolute z-20"
        animate={visualMotion(similarityChrome, SIMILARITY_DURATION_MS, motionOptions)}
      >
        <h3 className="absolute left-12 top-[88px] text-[13px] font-[650] leading-[16px]">
          More like this
        </h3>
        <div
          className="absolute flex items-center gap-1 text-[10px] font-[600] leading-[16px]"
          style={rectStyle(BACK_ONE)}
        >
          <ChevronLeft className="size-3" />
          Back one
        </div>
        <div
          className="absolute text-[10px] font-[600] leading-[16px]"
          style={rectStyle(BACK_ALL)}
        >
          Back to all
        </div>
      </motion.div>

      <motion.div
        className="absolute left-12 top-[118px] z-20 flex items-center gap-2"
        animate={visualMotion(breadcrumb, SIMILARITY_DURATION_MS, motionOptions)}
      >
        <OnboardingSkeleton className="size-8 rounded-[7px]" />
        <span className="text-muted-foreground">›</span>
        <OnboardingSkeleton className="size-8 rounded-[7px]" raised />
      </motion.div>

      {BASE_TILES.map((tile, index) => (
        <motion.div
          key={index}
          className={[
            "absolute origin-top-left",
            index === HERO_INDEX ? "z-20" : "z-10",
          ].join(" ")}
          style={rectStyle(tile)}
          animate={visualMotion(tileTracks[index], SIMILARITY_DURATION_MS, motionOptions)}
        >
          <OnboardingSkeleton
            raised={index === HERO_INDEX || index % 4 === 0}
            className="size-full rounded-[14px] border border-border/70"
          />
          {index === HERO_INDEX && (
            <div className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-background/75">
              <Maximize2 className="size-3.5" />
            </div>
          )}
        </motion.div>
      ))}

      <motion.div
        className="absolute inset-0 z-40 bg-background/70"
        animate={visualMotion(inspector, SIMILARITY_DURATION_MS, accentMotionOptions)}
      />
      <motion.div
        className="absolute inset-0 z-50"
        animate={visualMotion(inspector, SIMILARITY_DURATION_MS, accentMotionOptions)}
      >
        <SkeletonInspector />
        <motion.div
          className="absolute bottom-[42px] left-[42px] right-[332px] top-[42px] rounded-[14px] bg-surface-raised"
          animate={visualMotion(inspectorNext, SIMILARITY_DURATION_MS, motionOptions)}
        />
      </motion.div>

      <FakeCursor
        track={cursor}
        durationMs={SIMILARITY_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
