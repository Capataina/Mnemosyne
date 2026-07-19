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
import type { ClosedTrack, OnboardingSceneProps, VisualFrame } from "../types";
import { DemoAppChrome, DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const ARRANGE_DURATION_MS = 12000;

type TileId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P";

const TILE_IDS: readonly TileId[] = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
];

const TILE_BASE = Object.fromEntries(
  TILE_IDS.map((id, index) => [
    id,
    {
      left: 54 + (index % 4) * 214,
      top: 104 + Math.floor(index / 4) * 112,
    },
  ]),
) as Record<TileId, { left: number; top: number }>;

const at = (x = 0, y = 0, scaleX = 1, scaleY = scaleX) =>
  `translate3d(${x}px, ${y}px, 0px) scale(${scaleX}, ${scaleY})`;

const START: Record<TileId, string> = {
  A: at(), B: at(), C: at(), D: at(),
  E: at(), F: at(), G: at(), H: at(),
  I: at(), J: at(), K: at(), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

const C_LIVE_ONE: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(170, 86, 1.015), D: at(-214, 0),
  E: at(), F: at(), G: at(-214, 0), H: at(),
  I: at(), J: at(), K: at(), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

const C_LIVE_TWO: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(356, 134, 1.015), D: at(-214, 0),
  E: at(), F: at(-214, 0), G: at(-214, 112), H: at(),
  I: at(), J: at(), K: at(), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

const C_SETTLED: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(428, 112), D: at(-214, 0),
  E: at(), F: at(-214, 0), G: at(-214, 112), H: at(),
  I: at(), J: at(), K: at(), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

const F_GROW: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(428, 112), D: at(-214, 0),
  E: at(), F: at(-214, 0, 1.45, 1.45), G: at(0, 112), H: at(0, 112),
  I: at(), J: at(214, 0), K: at(214, 0), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

const F_TWO_BY_TWO: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(428, 112), D: at(-214, 0),
  E: at(), F: at(-214, 0, 2.12, 2.08), G: at(0, 224), H: at(0, 224),
  I: at(), J: at(428, 0), K: at(214, 112), L: at(),
  M: at(), N: at(214, 0), O: at(), P: at(),
};

const F_MOVING: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(428, 112), D: at(-214, 0),
  E: at(), F: at(120, 96, 2.12, 2.08), G: at(-214, 112), H: at(0, 224),
  I: at(), J: at(214, 0), K: at(0, 112), L: at(),
  M: at(), N: at(), O: at(-214, 0), P: at(-214, 0),
};

const F_MOVED: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(428, 112), D: at(-214, 0),
  E: at(), F: at(428, 224, 2.12, 2.08), G: at(-214, 112), H: at(0, 224),
  I: at(), J: at(214, 0), K: at(0, 112), L: at(),
  M: at(), N: at(), O: at(-214, 0), P: at(-214, 0),
};

const F_ONE_BY_ONE: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(428, 112), D: at(-214, 0),
  E: at(), F: at(428, 224), G: at(-214, 112), H: at(),
  I: at(), J: at(), K: at(), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

const F_RETURNING: Record<TileId, string> = {
  A: at(), B: at(0, 112), C: at(428, 112), D: at(-214, 0),
  E: at(), F: at(120, 90), G: at(-214, 112), H: at(),
  I: at(), J: at(), K: at(), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

const C_RETURNING: Record<TileId, string> = {
  A: at(), B: at(0, 56), C: at(205, 58, 1.015), D: at(-110, 0),
  E: at(), F: at(), G: at(-110, 56), H: at(),
  I: at(), J: at(), K: at(), L: at(),
  M: at(), N: at(), O: at(), P: at(),
};

export const ARRANGE_TILE_FIXTURES = {
  start: START,
  cLiveOne: C_LIVE_ONE,
  cLiveTwo: C_LIVE_TWO,
  cSettled: C_SETTLED,
  fGrow: F_GROW,
  fTwoByTwo: F_TWO_BY_TWO,
  fMoving: F_MOVING,
  fMoved: F_MOVED,
  fOneByOne: F_ONE_BY_ONE,
  fReturning: F_RETURNING,
  cReturning: C_RETURNING,
  restored: START,
} as const;

const layoutTimeline = [
  START,
  START,
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
  F_ONE_BY_ONE,
  F_ONE_BY_ONE,
  F_ONE_BY_ONE,
  F_RETURNING,
  C_SETTLED,
  C_SETTLED,
  C_RETURNING,
  START,
  START,
] as const;

const layoutTimes = normaliseTimes(ARRANGE_DURATION_MS, [
  0, 1000, 1600, 1950, 2350, 2610, 3350, 3800, 4240, 4500, 5150, 5600,
  6000, 6260, 7020, 7400, 7760, 8020, 8800, 9400, 9580, 10200, 10760,
  12000,
]);

function makeTileTrack(id: TileId): ClosedTrack<VisualFrame> {
  return visualTrack(
    layoutTimeline.map((layout) => visualFrame(layout[id])),
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

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(348, 170),
    cursorFrame(348, 170, 0.92, 0.75, 1),
    cursorFrame(704, 305, 0.92),
    cursorFrame(704, 305),
    cursorFrame(472, 296),
    cursorFrame(704, 472, 0.92),
    cursorFrame(704, 472),
    cursorFrame(590, 350),
    cursorFrame(704, 416, 0.92),
    cursorFrame(704, 416),
    cursorFrame(704, 472),
    cursorFrame(704, 360, 0.92),
    cursorFrame(704, 360),
    cursorFrame(472, 296),
    cursorFrame(348, 170),
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

const cTelegraph = visualTrack(
  [
    visualFrame("translate3d(0px, 0px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(1)", 0),
    visualFrame("translate3d(214px, 112px, 0px) scale(1)", 1),
    visualFrame("translate3d(428px, 112px, 0px) scale(1)", 1),
    visualFrame("translate3d(428px, 112px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(1)", 0),
  ],
  normaliseTimes(ARRANGE_DURATION_MS, [0, 1000, 1600, 2350, 2610, 12000]),
  ["linear", LIVE_EASE, LIVE_EASE, SETTLE_EASE, "linear"],
);

const fTelegraph = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame("translate3d(0px, 0px, 0px) scale(2.12, 2.08)", 1),
    visualFrame("translate3d(428px, 224px, 0px) scale(2.12, 2.08)", 1),
    visualFrame("translate3d(428px, 224px, 0px) scale(1)", 1),
    visualFrame("translate3d(0px, 0px, 0px) scale(1)", 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ARRANGE_DURATION_MS, [0, 3350, 4240, 6000, 7760, 9400, 9580, 12000]),
  ["linear", LIVE_EASE, LIVE_EASE, LIVE_EASE, LIVE_EASE, SETTLE_EASE, "linear"],
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
        className="absolute left-[482px] top-[104px] h-24 w-44 origin-top-left rounded-[14px] border-2 border-primary/65 bg-primary/10"
        animate={visualMotion(cTelegraph, ARRANGE_DURATION_MS, motionOptions)}
      />
      <motion.div
        className="absolute left-[268px] top-[216px] h-24 w-44 origin-top-left rounded-[14px] border-2 border-primary/65 bg-primary/10"
        animate={visualMotion(fTelegraph, ARRANGE_DURATION_MS, motionOptions)}
      />

      {TILE_IDS.map((id, index) => {
        const base = TILE_BASE[id];
        const active = id === "C" || id === "F";
        return (
          <motion.div
            key={id}
            className={[
              "absolute h-24 w-44 origin-top-left rounded-[14px]",
              active ? "z-20" : "z-10",
            ].join(" ")}
            style={{ left: base.left, top: base.top }}
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
