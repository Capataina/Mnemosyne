import { motion } from "framer-motion";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  CURSOR_TRAVEL_EASE,
  LIVE_EASE,
  LIVE_MS,
  SETTLE_EASE,
  SETTLE_MS,
  STAGGER_MS,
  cursorFrame,
  cursorTrack,
  holdTrack,
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
  reducedFrames,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const ARRANGE_DURATION_MS = 8400;

/**
 * V2 — the causally-closed arrangement loop.
 *
 * Four gestures, each press-caused and each undone by a later gesture,
 * so the loop closes through VISIBLE work instead of a restorative
 * off-screen swap (the v1 ending the review flagged as "two images swap
 * for no reason"):
 *
 *   1. drag C (2,0)→(3,1) — H live-reflows to (2,0) mid-drag
 *   2. grow F to its 2×2 footprint by its corner grip — G/J/K spill
 *      to the overflow row, staggered, mid-drag
 *   3. shrink F back by the same grip — K/J/G return mid-drag
 *   4. drag C home — H returns mid-drag; the drop IS loop closure
 *
 * The v1 "cursor moves before the tile responds" disconnect is closed
 * by contract, not by tuning: every drag segment appears in the cursor
 * track and the dragged tile's track with the SAME start/end offsets
 * and the SAME ease (DRAG_EASE below), and both endpoints derive from
 * the same rects — so the carried tile's centre, or the resized tile's
 * bottom-right corner, is at the cursor position at every instant of
 * the segment (identical bezier over identical endpoints). No tile
 * keyframe sits inside a drag segment, which is what keeps that
 * equality exact for a non-linear ease.
 */
const ARRANGE_GRID = makeGrid({
  originX: 54,
  originY: 104,
  cellW: 176,
  cellH: 96,
  gapX: 38,
  gapY: 16,
});

type TileId =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

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

/** F's keyframes all interpolate through two-argument scale, so its
 * home value must carry the same template (framer interpolates matching
 * number slots positionally; scale(1) vs scale(x, y) don't match). */
const F_HOME_T = "translate3d(0px, 0px, 0px) scale(1, 1)";

/** Slot assignment → transform, derived from the grid. */
const slot = (id: TileId, col: number, row: number) =>
  moveTo(BASE[id], ARRANGE_GRID.cell(col, row));

/** A full layout: HOME plus the given overrides (manifest bookkeeping —
 * the animation itself runs on per-tile tracks). */
function layout(
  overrides: Partial<Record<TileId, string>>,
): Record<TileId, string> {
  return Object.fromEntries(
    TILE_IDS.map((id) => [id, overrides[id] ?? HOME_T]),
  ) as Record<TileId, string>;
}

/** F's 2×2 footprint, exact (scale = footprint/cell, not a guess).
 * Spanning from F's own cell, so the mapTo translate component is 0. */
const F_SPAN_GROW = ARRANGE_GRID.span(1, 1, 2, 2);
const F_AS_GROWN = mapTo(BASE.F, F_SPAN_GROW);

/** Carry lift for a dragged tile. origin-top-left means a naive
 * scale(s) would push the tile's centre off the cursor by
 * (s-1)·size/2, so the translate compensates by exactly that much:
 * rendered centre = to.x + dx + s·w/2 = centre(to).x — the lifted tile's
 * centre sits ON the cursor for the whole drag. */
const LIFT_SCALE = 1.04;
const round2 = (n: number) => Math.round(n * 100) / 100;
const carryTo = (id: TileId, to: Rect): string => {
  const from = BASE[id];
  const dx = to.x - from.x - ((LIFT_SCALE - 1) * from.w) / 2;
  const dy = to.y - from.y - ((LIFT_SCALE - 1) * from.h) / 2;
  return `translate3d(${round2(dx)}px, ${round2(dy)}px, 0px) scale(${LIFT_SCALE})`;
};

/** The one ease shared by a drag segment's cursor keyframes AND the
 * dragged tile's keyframes — the coupling contract in one constant. */
const DRAG_EASE = LIVE_EASE;

const CELL_31 = ARRANGE_GRID.cell(3, 1);

/* ------------------------------------------------------------------ *
 * Beat clock — every offset below (ms) is read by the cursor track
 * AND by the tile/telegraph tracks it drives, so cause and effect
 * cannot drift apart. PRESS_MS is the press-down/release window;
 * reactions of a pressed element start at the press's LANDING frame,
 * never before, and reflow commits start at release completion.
 * ------------------------------------------------------------------ */
const PRESS_MS = 150;
const DUR = ARRANGE_DURATION_MS;

// Gesture 1 — drag C to (3,1)
const C1_ARRIVE = 900;
const C1_PRESS = C1_ARRIVE + PRESS_MS; // 1050 press lands
const C1_GRAB = C1_PRESS + PRESS_MS; // 1200 lift complete, drag begins
const C1_DROP = C1_GRAB + 700; // 1900 drag ends
const C1_RELEASE = C1_DROP + LIVE_MS; // 2100 release complete
const C1_SETTLED = C1_RELEASE + SETTLE_MS; // 2360 drop settled
const H_OUT = C1_GRAB + 250; // 1450 live reflow: H vacates (3,1) mid-drag
const H_OUT_END = H_OUT + LIVE_MS; // 1650

// Gesture 2 — grow F by its bottom-right grip
const F_ARRIVE = 2600;
const F_PRESS = F_ARRIVE + PRESS_MS; // 2750 press lands, resize begins
const F_GROWN = F_PRESS + 900; // 3650 corner reaches the 2×2 grip point
const F_RELEASE = F_GROWN + LIVE_MS; // 3850 release complete
const SPILL_G = F_PRESS + PRESS_MS; // 2900 footprint crosses into (2,1)
const SPILL_J = SPILL_G + STAGGER_MS; // 2990
const SPILL_K = SPILL_J + STAGGER_MS; // 3080

// Gesture 3 — shrink F back with the same grip
const ADMIRE_END = 4600; // cursor rests on the grip, board holds
const F2_PRESS = ADMIRE_END + PRESS_MS; // 4750 second press lands
const F_SHRUNK = F2_PRESS + 900; // 5650 corner back at the 1×1 grip point
const F2_RELEASE = F_SHRUNK + LIVE_MS; // 5850
const RETURN_K = 5300; // freed cells backfill mid-drag, reverse order
const RETURN_J = RETURN_K + STAGGER_MS; // 5390
const RETURN_G = RETURN_J + STAGGER_MS; // 5480

// Gesture 4 — drag C home (this drop IS the loop closure)
const C2_ARRIVE = F2_RELEASE + 500; // 6350
const C2_PRESS = C2_ARRIVE + PRESS_MS; // 6500
const C2_GRAB = C2_PRESS + PRESS_MS; // 6650
const C2_DROP = C2_GRAB + 700; // 7350
const C2_RELEASE = C2_DROP + LIVE_MS; // 7550
const C2_SETTLED = C2_RELEASE + SETTLE_MS; // 7810
const H_BACK = C2_GRAB + 250; // 6900 H returns to (3,1) mid-drag
const H_BACK_END = H_BACK + LIVE_MS; // 7100

const PARK_ARRIVE = 8100; // short re-park; loop restarts immediately

/* ------------------------------------------------------------------ *
 * Cursor waypoints — every one derived from the grid.
 * ------------------------------------------------------------------ */
const C_HOME_PT = centre(BASE.C);
const C_AWAY_PT = centre(CELL_31);
const F_GRIP = { x: BASE.F.x + BASE.F.w, y: BASE.F.y + BASE.F.h };
const F_GRIP_GROWN = {
  x: F_SPAN_GROW.x + F_SPAN_GROW.w,
  y: F_SPAN_GROW.y + F_SPAN_GROW.h,
};

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(C_HOME_PT.x, C_HOME_PT.y),
    cursorFrame(C_HOME_PT.x, C_HOME_PT.y, 0.92, 0.75, 1),
    cursorFrame(C_HOME_PT.x, C_HOME_PT.y, 0.92),
    cursorFrame(C_AWAY_PT.x, C_AWAY_PT.y, 0.92),
    cursorFrame(C_AWAY_PT.x, C_AWAY_PT.y),
    cursorFrame(F_GRIP.x, F_GRIP.y),
    cursorFrame(F_GRIP.x, F_GRIP.y, 0.92, 0.75, 1),
    cursorFrame(F_GRIP_GROWN.x, F_GRIP_GROWN.y, 0.92),
    cursorFrame(F_GRIP_GROWN.x, F_GRIP_GROWN.y),
    cursorFrame(F_GRIP_GROWN.x, F_GRIP_GROWN.y),
    cursorFrame(F_GRIP_GROWN.x, F_GRIP_GROWN.y, 0.92, 0.75, 1),
    cursorFrame(F_GRIP.x, F_GRIP.y, 0.92),
    cursorFrame(F_GRIP.x, F_GRIP.y),
    cursorFrame(C_AWAY_PT.x, C_AWAY_PT.y),
    cursorFrame(C_AWAY_PT.x, C_AWAY_PT.y, 0.92, 0.75, 1),
    cursorFrame(C_AWAY_PT.x, C_AWAY_PT.y, 0.92),
    cursorFrame(C_HOME_PT.x, C_HOME_PT.y, 0.92),
    cursorFrame(C_HOME_PT.x, C_HOME_PT.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(DUR, [
    0, 400, C1_ARRIVE, C1_PRESS, C1_GRAB, C1_DROP, C1_RELEASE,
    F_ARRIVE, F_PRESS, F_GROWN, F_RELEASE, ADMIRE_END, F2_PRESS,
    F_SHRUNK, F2_RELEASE, C2_ARRIVE, C2_PRESS, C2_GRAB, C2_DROP,
    C2_RELEASE, PARK_ARRIVE, DUR,
  ]),
  [
    "linear", CURSOR_TRAVEL_EASE, LIVE_EASE, "linear", DRAG_EASE,
    LIVE_EASE, CURSOR_TRAVEL_EASE, LIVE_EASE, DRAG_EASE, LIVE_EASE,
    "linear", LIVE_EASE, DRAG_EASE, LIVE_EASE, CURSOR_TRAVEL_EASE,
    LIVE_EASE, "linear", DRAG_EASE, LIVE_EASE, CURSOR_TRAVEL_EASE,
    "linear",
  ],
);

/* ------------------------------------------------------------------ *
 * Tile tracks — one per moving tile, keyframed only at its own beats.
 * ------------------------------------------------------------------ */

/** Nine tiles never move: a closed constant track. */
const STATIC_TILE = visualTrack(
  [visualFrame(HOME_T), visualFrame(HOME_T)],
  [0, 1],
);

/** C rides under the cursor both ways: lift on press landing, carry on
 * the cursor's exact drag segment (same times, same DRAG_EASE), hold
 * through release, settle after it. */
const cTrack = visualTrack(
  [
    visualFrame(HOME_T),
    visualFrame(HOME_T),
    visualFrame(carryTo("C", BASE.C)),
    visualFrame(carryTo("C", CELL_31)),
    visualFrame(carryTo("C", CELL_31)),
    visualFrame(slot("C", 3, 1)),
    visualFrame(slot("C", 3, 1)),
    visualFrame(carryTo("C", CELL_31)),
    visualFrame(carryTo("C", BASE.C)),
    visualFrame(carryTo("C", BASE.C)),
    visualFrame(HOME_T),
    visualFrame(HOME_T),
  ],
  normaliseTimes(DUR, [
    0, C1_PRESS, C1_GRAB, C1_DROP, C1_RELEASE, C1_SETTLED,
    C2_PRESS, C2_GRAB, C2_DROP, C2_RELEASE, C2_SETTLED, DUR,
  ]),
  [
    "linear", LIVE_EASE, DRAG_EASE, "linear", SETTLE_EASE,
    "linear", LIVE_EASE, DRAG_EASE, "linear", SETTLE_EASE, "linear",
  ],
);

/** F's corner tracks the cursor frame-for-frame: its grow and shrink
 * segments are the cursor's grip-drag segments verbatim (same offsets,
 * same DRAG_EASE), and since corner-x = F.x + w·scaleX(t) while the
 * cursor interpolates F.x + w → F.x + W over the same bezier, the two
 * are equal at every instant. */
const fTrack = holdTrack([0, F_PRESS, F_GROWN, F2_PRESS, F_SHRUNK, DUR], {
  hidden: visualFrame(F_HOME_T),
  shown: visualFrame(F_AS_GROWN),
  easeIn: DRAG_EASE,
  easeOut: DRAG_EASE,
});

/** H live-reflows out of C's way mid-drag and back mid-return-drag —
 * the caused version of v1's unexplained closing swap. */
const hTrack = holdTrack([0, H_OUT, H_OUT_END, H_BACK, H_BACK_END, DUR], {
  hidden: visualFrame(HOME_T),
  shown: visualFrame(slot("H", 2, 0)),
  easeIn: LIVE_EASE,
  easeOut: LIVE_EASE,
});

/** G/J/K spill to the overflow row as F's growing footprint crosses
 * their cells (staggered, mid-drag) and backfill in reverse order as
 * the shrink frees them. */
const displacedTrack = (
  id: TileId,
  col: number,
  out: number,
  back: number,
): ClosedTrack<VisualFrame> =>
  holdTrack([0, out, out + LIVE_MS, back, back + LIVE_MS, DUR], {
    hidden: visualFrame(HOME_T),
    shown: visualFrame(slot(id, col, 3)),
    easeIn: LIVE_EASE,
    easeOut: LIVE_EASE,
  });

const tileTracks: Record<TileId, ClosedTrack<VisualFrame>> = {
  A: STATIC_TILE,
  B: STATIC_TILE,
  C: cTrack,
  D: STATIC_TILE,
  E: STATIC_TILE,
  F: fTrack,
  G: displacedTrack("G", 0, SPILL_G, RETURN_G),
  H: hTrack,
  I: STATIC_TILE,
  J: displacedTrack("J", 1, SPILL_J, RETURN_J),
  K: displacedTrack("K", 2, SPILL_K, RETURN_K),
  L: STATIC_TILE,
};

/* ------------------------------------------------------------------ *
 * Telegraphs, hover rings, grip.
 * ------------------------------------------------------------------ */

/** Drop telegraph at (3,1): lights as the drag starts (H is vacating
 * the cell at the same moment), fades once the drop settles. */
const cTelegraph = holdTrack(
  [0, C1_GRAB + 100, C1_GRAB + 300, C1_RELEASE, C1_SETTLED, DUR],
  {
    hidden: visualFrame(undefined, 0),
    shown: visualFrame(undefined, 1),
    easeIn: LIVE_EASE,
    easeOut: SETTLE_EASE,
  },
);

/** Return-drop telegraph at C's home cell, for the closing drag. */
const cHomeTelegraph = holdTrack(
  [0, C2_GRAB + 100, C2_GRAB + 300, C2_RELEASE, C2_SETTLED, DUR],
  {
    hidden: visualFrame(undefined, 0),
    shown: visualFrame(undefined, 1),
    easeIn: LIVE_EASE,
    easeOut: SETTLE_EASE,
  },
);

/** Resize telegraph: the exact 2×2 footprint, lit for the grow drag. */
const fTelegraph = holdTrack(
  [0, F_PRESS + 50, F_PRESS + 250, F_RELEASE, F_RELEASE + SETTLE_MS, DUR],
  {
    hidden: visualFrame(undefined, 0),
    shown: visualFrame(undefined, 1),
    easeIn: LIVE_EASE,
    easeOut: SETTLE_EASE,
  },
);

/** Hover affordance — the app's THIN primary ring (MasonryItem's
 * group-hover ring-primary/65), shown on arrival, yielding at press. */
const hoverC = holdTrack(
  [0, C1_ARRIVE, C1_ARRIVE + 120, C1_PRESS, C1_GRAB, DUR],
  {
    hidden: visualFrame(undefined, 0),
    shown: visualFrame(undefined, 1),
    easeIn: LIVE_EASE,
    easeOut: LIVE_EASE,
  },
);
const hoverCAway = holdTrack(
  [0, C2_ARRIVE, C2_ARRIVE + 120, C2_PRESS, C2_GRAB, DUR],
  {
    hidden: visualFrame(undefined, 0),
    shown: visualFrame(undefined, 1),
    easeIn: LIVE_EASE,
    easeOut: LIVE_EASE,
  },
);

/** Corner grip dot: in on hover-arrival at F, out after the shrink
 * release — it rides F's corner by nesting (and so tracks the cursor
 * through both resize drags for free). */
const grips = holdTrack([0, F_ARRIVE, F_PRESS, F2_RELEASE, F2_RELEASE + 300, DUR], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
});

export const ARRANGE_TRACKS = {
  cursor,
  cTelegraph,
  cHomeTelegraph,
  fTelegraph,
  hoverC,
  hoverCAway,
  grips,
  ...tileTracks,
} as const;

/* ------------------------------------------------------------------ *
 * Geometry manifest.
 * ------------------------------------------------------------------ */

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

const HOME = layout({});
const SWAPPED = layout({ C: slot("C", 3, 1), H: slot("H", 2, 0) });
const GROWN = layout({
  C: slot("C", 3, 1),
  H: slot("H", 2, 0),
  F: F_AS_GROWN,
  G: slot("G", 0, 3),
  J: slot("J", 1, 3),
  K: slot("K", 2, 3),
});

export const ARRANGE_SETTLED_BEATS: Record<string, Rect[]> = {
  home: beatRects(HOME),
  swapped: beatRects(SWAPPED),
  grown: beatRects(GROWN, F_SPAN_GROW),
};

export const ARRANGE_GEOMETRY: SceneGeometryManifest = {
  scene: "arrange",
  bounds: {
    cTelegraph: CELL_31,
    cHomeTelegraph: BASE.C,
    fTelegraph: F_SPAN_GROW,
    hoverC: BASE.C,
    hoverCAway: CELL_31,
  },
  clicks: [
    { label: "press-c", point: C_HOME_PT, target: BASE.C },
    { label: "drop-c", point: C_AWAY_PT, target: CELL_31 },
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
    { label: "press-c-return", point: C_AWAY_PT, target: CELL_31 },
    { label: "drop-c-return", point: C_HOME_PT, target: BASE.C },
  ],
  disjoint: ARRANGE_SETTLED_BEATS,
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["arrange-start", "Start with the dense board"],
  ["arrange-telegraph", "Preview the exact landing place"],
  ["arrange-settled", "Settle into the reserved space"],
];

export const ARRANGE_REDUCED_FRAMES = reducedFrames(reducedKinds);

export function ArrangeScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <DemoAppChrome />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/40" />

      {/* Telegraphs sit under the tiles: each lights inside a cell its
          occupant is vacating (H's reflow / the spill), so the preview
          emerges exactly where the drop will land. */}
      <motion.div
        className="absolute rounded-[14px] border-2 border-primary/65 bg-primary/10"
        style={rectStyle(CELL_31)}
        animate={visualMotion(cTelegraph, ARRANGE_DURATION_MS, motionOptions)}
      />
      <motion.div
        className="absolute rounded-[14px] border-2 border-primary/65 bg-primary/10"
        style={rectStyle(BASE.C)}
        animate={visualMotion(cHomeTelegraph, ARRANGE_DURATION_MS, motionOptions)}
      />
      <motion.div
        className="absolute rounded-[14px] border-2 border-primary/65 bg-primary/10"
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

      {/* Hover rings over the tiles (z-30): the app's real affordance,
          a 1px ring-primary hairline, on the cell the cursor is about
          to grab. */}
      <motion.div
        className="pointer-events-none absolute z-30 rounded-[14px] ring-1 ring-inset ring-primary/65"
        style={rectStyle(BASE.C)}
        animate={visualMotion(hoverC, ARRANGE_DURATION_MS, motionOptions)}
      />
      <motion.div
        className="pointer-events-none absolute z-30 rounded-[14px] ring-1 ring-inset ring-primary/65"
        style={rectStyle(CELL_31)}
        animate={visualMotion(hoverCAway, ARRANGE_DURATION_MS, motionOptions)}
      />

      <FakeCursor
        track={cursor}
        durationMs={ARRANGE_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
