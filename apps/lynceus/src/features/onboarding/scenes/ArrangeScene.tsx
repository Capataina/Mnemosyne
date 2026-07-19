import { motion } from "framer-motion";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  CURSOR_TRAVEL_EASE,
  LIVE_EASE,
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
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const ARRANGE_DURATION_MS = 12000;

/**
 * The board is a real 4-column grid (like the app's masonry, idealised):
 * rows 0-2 hold the twelve tiles A-L; row 3 is the overflow band that
 * displaced tiles re-pack into while F occupies a 2×2 footprint. Every
 * beat below is a slot assignment — transforms are COMPUTED from cells,
 * so a tile can neither leak off the stage nor land between columns.
 */
export const ARRANGE_GRID = makeGrid({
  originX: 54,
  originY: 104,
  cellW: 176,
  cellH: 96,
  gapX: 38,
  gapY: 16,
});

type TileId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

const TILE_IDS: readonly TileId[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
];

const BASE: Record<TileId, Rect> = Object.fromEntries(
  TILE_IDS.map((id, index) => [
    id,
    ARRANGE_GRID.cell(index % 4, Math.floor(index / 4)),
  ]),
) as Record<TileId, Rect>;

/** Tile at its base slot. */
const HOME_T = "translate3d(0px, 0px, 0px) scale(1)";

/** Slot assignment → transform, derived from the grid. */
const slot = (id: TileId, col: number, row: number) =>
  moveTo(BASE[id], ARRANGE_GRID.cell(col, row));

/** A full layout: HOME plus the given overrides. */
function layout(overrides: Partial<Record<TileId, string>>): Record<TileId, string> {
  return Object.fromEntries(
    TILE_IDS.map((id) => [id, overrides[id] ?? HOME_T]),
  ) as Record<TileId, string>;
}

/** F's 2×2 footprints, exact (scale = footprint/cell, not a guess). */
const F_SPAN_GROW = ARRANGE_GRID.span(1, 1, 2, 2);
const F_SPAN_MOVED = ARRANGE_GRID.span(2, 1, 2, 2);
const F_AS_GROWN = mapTo(BASE.F, F_SPAN_GROW);
const F_AS_MOVED = mapTo(BASE.F, F_SPAN_MOVED);
const F_AT_SHRUNK = moveTo(BASE.F, ARRANGE_GRID.cell(2, 1));

/** Mid-drag float for C between its base and the (3,1) target. */
const C_FLOAT_ONE = "translate3d(107px, 56px, 0px) scale(1.02)";
const C_FLOAT_TWO = "translate3d(182px, 96px, 0px) scale(1.02)";
/** Mid-drag float for the grown F between its two footprints. */
const F_AS_MOVING = F_AS_GROWN.replace(
  "translate3d(0px, 0px, 0px)",
  "translate3d(107px, 0px, 0px)",
);
/** C and H mid-way through their closing swap-back. */
const C_RETURN_FLOAT = "translate3d(107px, 56px, 0px) scale(1.01)";
const H_RETURN_FLOAT = "translate3d(-107px, 56px, 0px) scale(1)";

const HOME = layout({});
const C_LIVE_ONE = layout({ C: C_FLOAT_ONE });
const C_LIVE_TWO = layout({ C: C_FLOAT_TWO, H: slot("H", 2, 0) });
const C_SETTLED = layout({ C: slot("C", 3, 1), H: slot("H", 2, 0) });
const F_GROW = layout({
  C: slot("C", 3, 1),
  H: slot("H", 2, 0),
  F: "translate3d(0px, 0px, 0px) scale(1.6, 1.58)",
  G: slot("G", 0, 3),
  J: slot("J", 1, 3),
  K: slot("K", 2, 3),
});
const F_TWO_BY_TWO = layout({
  C: slot("C", 3, 1),
  H: slot("H", 2, 0),
  F: F_AS_GROWN,
  G: slot("G", 0, 3),
  J: slot("J", 1, 3),
  K: slot("K", 2, 3),
});
const F_MOVING = layout({
  C: slot("C", 1, 1),
  H: slot("H", 2, 0),
  F: F_AS_MOVING,
  G: slot("G", 0, 3),
  J: slot("J", 1, 3),
  K: slot("K", 2, 3),
  L: slot("L", 1, 2),
});
const F_MOVED = layout({
  C: slot("C", 1, 1),
  H: slot("H", 2, 0),
  F: F_AS_MOVED,
  G: slot("G", 0, 3),
  J: slot("J", 1, 3),
  K: slot("K", 2, 3),
  L: slot("L", 1, 2),
});
const F_SHRUNK = layout({
  C: slot("C", 1, 1),
  H: slot("H", 2, 0),
  F: F_AT_SHRUNK,
  G: slot("G", 0, 3),
  J: slot("J", 1, 3),
  K: slot("K", 2, 3),
  L: slot("L", 1, 2),
});
/** C and L return to their phase-one slots while F still sits at (2,1). */
const CL_BACK = layout({
  C: slot("C", 3, 1),
  H: slot("H", 2, 0),
  F: F_AT_SHRUNK,
  G: slot("G", 0, 3),
  J: slot("J", 1, 3),
  K: slot("K", 2, 3),
});
/** F and the row-3 tiles go home; only the C/H swap remains. */
const REST_HOME = layout({ C: slot("C", 3, 1), H: slot("H", 2, 0) });
const CH_RETURNING = layout({ C: C_RETURN_FLOAT, H: H_RETURN_FLOAT });

export const ARRANGE_TILE_FIXTURES = {
  home: HOME,
  cLiveOne: C_LIVE_ONE,
  cLiveTwo: C_LIVE_TWO,
  cSettled: C_SETTLED,
  fGrow: F_GROW,
  fTwoByTwo: F_TWO_BY_TWO,
  fMoving: F_MOVING,
  fMoved: F_MOVED,
  fShrunk: F_SHRUNK,
  clBack: CL_BACK,
  restHome: REST_HOME,
  chReturning: CH_RETURNING,
} as const;

const layoutTimeline = [
  HOME,
  HOME,
  C_LIVE_ONE,
  C_LIVE_TWO,
  C_SETTLED,
  C_SETTLED,
  C_SETTLED,
  F_GROW,
  F_TWO_BY_TWO,
  F_TWO_BY_TWO,
  F_TWO_BY_TWO,
  F_MOVING,
  F_MOVED,
  F_MOVED,
  F_MOVED,
  F_SHRUNK,
  F_SHRUNK,
  F_SHRUNK,
  CL_BACK,
  REST_HOME,
  REST_HOME,
  CH_RETURNING,
  HOME,
  HOME,
] as const;

const layoutTimes = normaliseTimes(ARRANGE_DURATION_MS, [
  0, 1000, 1600, 1950, 2350, 2610, 3350, 3800, 4240, 4500, 5150, 5600,
  6000, 6260, 7020, 7400, 7760, 8020, 8800, 9400, 9580, 10200, 10760,
  12000,
]);

function makeTileTrack(id: TileId): ClosedTrack<VisualFrame> {
  return visualTrack(
    layoutTimeline.map((current) => visualFrame(current[id])),
    layoutTimes,
    layoutTimeline.slice(1).map((_, index) =>
      [1, 2, 6, 7, 10, 11, 14, 15, 18, 21].includes(index)
        ? LIVE_EASE
        : SETTLE_EASE,
    ),
  );
}

const tileTracks = Object.fromEntries(
  TILE_IDS.map((id) => [id, makeTileTrack(id)]),
) as Record<TileId, ClosedTrack<VisualFrame>>;

/** Cursor waypoints — every one derived from the grid. */
const C_PRESS = centre(BASE.C);
const C_DROP = centre(ARRANGE_GRID.cell(3, 1));
const F_GRIP = { x: BASE.F.x + BASE.F.w, y: BASE.F.y + BASE.F.h };
const F_GRIP_GROWN = { x: F_SPAN_GROW.x + F_SPAN_GROW.w, y: F_SPAN_GROW.y + F_SPAN_GROW.h };
const F_CENTRE_GROWN = centre(F_SPAN_GROW);
const F_CENTRE_MOVED = centre(F_SPAN_MOVED);
const F_GRIP_MOVED = { x: F_SPAN_MOVED.x + F_SPAN_MOVED.w, y: F_SPAN_MOVED.y + F_SPAN_MOVED.h };
const F_GRIP_SHRUNK = {
  x: ARRANGE_GRID.cell(2, 1).x + ARRANGE_GRID.cellW,
  y: ARRANGE_GRID.cell(2, 1).y + ARRANGE_GRID.cellH,
};

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(C_PRESS.x, C_PRESS.y),
    cursorFrame(C_PRESS.x, C_PRESS.y, 0.92, 0.75, 1),
    cursorFrame(C_DROP.x, C_DROP.y, 0.92),
    cursorFrame(C_DROP.x, C_DROP.y),
    cursorFrame(F_GRIP.x, F_GRIP.y),
    cursorFrame(F_GRIP_GROWN.x, F_GRIP_GROWN.y, 0.92),
    cursorFrame(F_GRIP_GROWN.x, F_GRIP_GROWN.y),
    cursorFrame(F_CENTRE_GROWN.x, F_CENTRE_GROWN.y, 0.92, 0.75, 1),
    cursorFrame(F_CENTRE_MOVED.x, F_CENTRE_MOVED.y, 0.92),
    cursorFrame(F_CENTRE_MOVED.x, F_CENTRE_MOVED.y),
    cursorFrame(F_GRIP_MOVED.x, F_GRIP_MOVED.y, 0.92),
    cursorFrame(F_GRIP_SHRUNK.x, F_GRIP_SHRUNK.y, 0.92),
    cursorFrame(F_GRIP_SHRUNK.x, F_GRIP_SHRUNK.y),
    cursorFrame(760, 180),
    cursorFrame(880, 470),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(ARRANGE_DURATION_MS, [
    0, 500, 1000, 1150, 2350, 2610, 3350, 4240, 4500, 5150, 6000, 6260,
    7020, 7760, 8020, 8220, 9580, 11340, 12000,
  ]),
  [
    "linear", CURSOR_TRAVEL_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE,
    SETTLE_EASE, CURSOR_TRAVEL_EASE, CURSOR_TRAVEL_EASE, SETTLE_EASE,
    CURSOR_TRAVEL_EASE, CURSOR_TRAVEL_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE,
    CURSOR_TRAVEL_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE, CURSOR_TRAVEL_EASE,
    CURSOR_TRAVEL_EASE, "linear",
  ],
);

/** Drag telegraph: fixed at C's landing cell, fades with the drag. */
const C_TARGET_RECT = ARRANGE_GRID.cell(3, 1);
const cTelegraph = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ARRANGE_DURATION_MS, [0, 1000, 1600, 2350, 2610, 12000]),
  ["linear", LIVE_EASE, LIVE_EASE, SETTLE_EASE, "linear"],
);

/** Resize/move telegraph: sized to the full 2×2 footprint, sliding from
 * the grow footprint to the move target. */
const F_TELEGRAPH_SLIDE = moveTo(F_SPAN_GROW, F_SPAN_MOVED);
const fTelegraph = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(F_TELEGRAPH_SLIDE, 1),
    visualFrame(F_TELEGRAPH_SLIDE, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ARRANGE_DURATION_MS, [0, 3350, 4240, 5600, 6000, 6400, 6500, 12000]),
  ["linear", LIVE_EASE, "linear", LIVE_EASE, SETTLE_EASE, "linear", "linear"],
);

const grips = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ARRANGE_DURATION_MS, [0, 2850, 3350, 8020, 8340, 12000]),
);

export const ARRANGE_TRACKS = {
  cursor,
  cTelegraph,
  fTelegraph,
  grips,
  ...tileTracks,
} as const;

/** Settled beats and the rects every tile occupies in them — the
 * geometry tests assert these are disjoint and inside the stage. */
function beatRects(current: Record<TileId, string>, fSpan?: Rect): Rect[] {
  return TILE_IDS.map((id) => {
    if (id === "F" && fSpan) return fSpan;
    const match = current[id].match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/);
    const dx = match ? Number(match[1]) : 0;
    const dy = match ? Number(match[2]) : 0;
    return rect(BASE[id].x + dx, BASE[id].y + dy, BASE[id].w, BASE[id].h);
  });
}

export const ARRANGE_SETTLED_BEATS: Record<string, Rect[]> = {
  home: beatRects(HOME),
  cSettled: beatRects(C_SETTLED),
  fTwoByTwo: beatRects(F_TWO_BY_TWO, F_SPAN_GROW),
  fMoved: beatRects(F_MOVED, F_SPAN_MOVED),
  fShrunk: beatRects(F_SHRUNK),
  clBack: beatRects(CL_BACK),
  restHome: beatRects(REST_HOME),
};

export const ARRANGE_GEOMETRY: SceneGeometryManifest = {
  scene: "arrange",
  bounds: {
    cTelegraph: C_TARGET_RECT,
    fTelegraphGrow: F_SPAN_GROW,
    fTelegraphMoved: F_SPAN_MOVED,
  },
  clicks: [
    { label: "press-c", point: C_PRESS, target: BASE.C },
    { label: "drop-c", point: C_DROP, target: ARRANGE_GRID.cell(3, 1) },
    {
      label: "grip-f",
      point: F_GRIP,
      target: rect(F_GRIP.x - 10, F_GRIP.y - 10, 20, 20),
    },
    {
      label: "grip-f-grown",
      point: F_GRIP_GROWN,
      target: rect(F_GRIP_GROWN.x - 10, F_GRIP_GROWN.y - 10, 20, 20),
    },
    { label: "drag-f-grown", point: F_CENTRE_GROWN, target: F_SPAN_GROW },
    { label: "drag-f-moved", point: F_CENTRE_MOVED, target: F_SPAN_MOVED },
  ],
  disjoint: ARRANGE_SETTLED_BEATS,
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["arrange-start", "Start with the dense board"],
  ["arrange-telegraph", "Preview the exact landing place"],
  ["arrange-settled", "Settle into the reserved space"],
];

export const ARRANGE_REDUCED_FRAMES = reducedKinds.map(([kind, caption]) => ({
  caption,
  content: <StaticFrameArt kind={kind} />,
}));

export function ArrangeScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <DemoAppChrome />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/40" />

      <motion.div
        className="absolute rounded-[14px] border-2 border-primary/65 bg-primary/10"
        style={rectStyle(C_TARGET_RECT)}
        animate={visualMotion(cTelegraph, ARRANGE_DURATION_MS, motionOptions)}
      />
      <motion.div
        className="absolute origin-top-left rounded-[14px] border-2 border-primary/65 bg-primary/10"
        style={rectStyle(F_SPAN_GROW)}
        animate={visualMotion(fTelegraph, ARRANGE_DURATION_MS, motionOptions)}
      />

      {TILE_IDS.map((id, index) => {
        const active = id === "C" || id === "F";
        return (
          <motion.div
            key={id}
            className={[
              "absolute origin-top-left rounded-[14px]",
              active ? "z-20" : "z-10",
            ].join(" ")}
            style={rectStyle(BASE[id])}
            animate={visualMotion(tileTracks[id], ARRANGE_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton
              raised={active || index % 5 === 0}
              className="size-full rounded-[14px] border border-border"
            />
            {id === "F" && (
              <motion.div
                className="absolute -bottom-1.5 -right-1.5 size-3 rounded-full border border-background bg-primary"
                animate={visualMotion(grips, ARRANGE_DURATION_MS, motionOptions)}
              />
            )}
          </motion.div>
        );
      })}

      <FakeCursor
        track={cursor}
        durationMs={ARRANGE_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
