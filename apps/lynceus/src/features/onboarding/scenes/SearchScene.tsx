import { motion } from "framer-motion";
import { X } from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
  CURSOR_TRAVEL_EASE,
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

export const SEARCH_DURATION_MS = 7000;

/**
 * Results: 4 columns of 190×126 tiles with 12px gaps (grid-cols-4 gap-3
 * of w-[190px] h-[126px] tiles ⇒ pitch 202/138). The beat map:
 * press on the search field → the query types itself → the grid dims
 * ("searching") → the eight candidates shimmer back in, staggered →
 * rank fusion re-orders each row by a real column permutation, one row
 * after the other (survivors swap whole slots, dx = Δcol × pitch, with
 * a lifted mid-flight arc), the weakest row fades → the hover-style
 * blue ring lands on the rank-1 cell → the X clears everything back.
 * Every tile carries its own hue tint so individual tiles stay
 * trackable across the permutation — identity legibility is the point
 * of the fusion beat.
 */
const SEARCH_GRID = makeGrid({
  originX: 64,
  originY: 128,
  cellW: 190,
  cellH: 126,
  gapX: 12,
  gapY: 12,
});

/** Per-row column permutations: rankedColumn[row][col] = where the tile
 * in (col,row) moves. Each is a bijection, so slots stay disjoint. */
const RANKED_COLUMN: readonly (readonly number[])[] = [
  [1, 0, 3, 2],
  [2, 3, 0, 1],
];

const SEMANTIC_BADGE = rect(526, 24, 84, 24);
const BADGE_X = rect(586, 30, 16, 12);
const QUERY_POINT = { x: CHROME.searchBar.x + 62, y: 36 };
const CLEAR_POINT = centre(BADGE_X);

/** The rank-1 slot after fusion — RANKED_COLUMN[0] sends col 1 → col 0,
 * so the blue tile (index 1) lands here and the ring greets it. The
 * ring sits RING_OUT proud of the cell, like the app's hover ring. */
const TOP_HIT_CELL = SEARCH_GRID.cell(0, 0);
const RING_OUT = 4;
const TOP_HIT_RING = rect(
  TOP_HIT_CELL.x - RING_OUT,
  TOP_HIT_CELL.y - RING_OUT,
  TOP_HIT_CELL.w + 2 * RING_OUT,
  TOP_HIT_CELL.h + 2 * RING_OUT,
);

/** Per-tile hue tints (skeleton fills, no imagery). Swap partners are
 * hue-opposed on purpose — row 0 swaps (0↔1),(2↔3); row 1 swaps
 * (4↔6),(5↔7) — so every fusion move reads as "THAT colour went
 * THERE". Row 2 (the fusion's discards) is deliberately desaturated. */
const TILE_TINTS: readonly string[] = [
  "oklch(0.68 0.11 25 / 0.45)", // terracotta
  "oklch(0.66 0.11 230 / 0.45)", // blue — the future top match
  "oklch(0.68 0.1 145 / 0.45)", // green
  "oklch(0.66 0.11 320 / 0.45)", // magenta
  "oklch(0.72 0.1 75 / 0.45)", // amber
  "oklch(0.62 0.11 265 / 0.45)", // indigo
  "oklch(0.68 0.1 180 / 0.45)", // teal
  "oklch(0.66 0.11 350 / 0.45)", // pink
  "oklch(0.62 0.04 90 / 0.3)", // greyed olive
  "oklch(0.6 0.04 270 / 0.3)", // greyed slate
  "oklch(0.62 0.04 30 / 0.3)", // greyed clay
  "oklch(0.6 0.04 180 / 0.3)", // greyed sea
];

/* Beat offsets (ms). Reactions start at-or-after the press RELEASE
 * that causes them — the causal spine of the loop. */
const PRESS_ARRIVE = 900;
const PRESS_DOWN = 1050;
const PRESS_RELEASE = 1200; // → focus ring
const TYPE_START = 1350;
const TYPE_STEP = 120;
const TYPE_MS = 180; // last glyph shown 2130
const CHROME_IN = 2150; // Semantic badge + Results header
const CHROME_SHOWN = 2400;
const DIM_AT = 2150; // grid dims: "searching"
const DIM_DONE = 2330;
const POP_START = 2450; // candidates shimmer back in
const POP_STAGGER = 60;
const POP_MS = 200;
const POP_SETTLE = 180; // last candidate lit 3250
const FUSE_START = 3450; // rank fusion fires, row 0 first
const FUSE_ROW_STAGGER = 180;
const FUSE_MID = 260; // mid-flight arc keyframe
const FUSE_MS = 520; // row 1 settled 4150
const RING_IN = 4250; // top-match ring lands last
const RING_SHOWN = 4500;
const LEAVE_QUERY = 5450; // cursor departs for the X
const CLEAR_ARRIVE = 5750;
const CLEAR_DOWN = 5900;
const CLEAR_RELEASE = 6050; // → everything restores
const RESTORE_DONE = 6600; // base feed again; short tail, loop restarts

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    ...pressAt(QUERY_POINT),
    cursorFrame(QUERY_POINT.x, QUERY_POINT.y),
    ...pressAt(CLEAR_POINT),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(SEARCH_DURATION_MS, [
    0,
    400,
    PRESS_ARRIVE,
    PRESS_DOWN,
    PRESS_RELEASE,
    LEAVE_QUERY,
    CLEAR_ARRIVE,
    CLEAR_DOWN,
    CLEAR_RELEASE,
    6550,
    SEARCH_DURATION_MS,
  ]),
  [
    "linear", CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, "linear",
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE, "linear",
  ],
);

const focusRing = holdTrack(
  [0, PRESS_RELEASE, PRESS_RELEASE + 200, CLEAR_RELEASE, CLEAR_RELEASE + 250, SEARCH_DURATION_MS],
  {
    hidden: visualFrame(undefined, 0),
    shown: visualFrame(undefined, 1),
    easeIn: FADE_EASE,
    easeOut: FADE_EASE,
  },
);

function glyphTrack(index: number): ClosedTrack<VisualFrame> {
  const start = TYPE_START + index * TYPE_STEP;
  return holdTrack(
    [0, start, start + TYPE_MS, CLEAR_RELEASE, CLEAR_RELEASE + 300, SEARCH_DURATION_MS],
    {
      hidden: visualFrame("translate3d(-4px, 0px, 0px) scaleX(.3)", 0),
      shown: visualFrame(undefined, 1),
      easeIn: SETTLE_EASE,
      easeOut: FADE_EASE,
    },
  );
}

const glyphs = Array.from({ length: 6 }, (_, index) => glyphTrack(index));

const resultsChrome = holdTrack(
  [0, CHROME_IN, CHROME_SHOWN, CLEAR_RELEASE, CLEAR_RELEASE + 300, SEARCH_DURATION_MS],
  {
    hidden: visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
    shown: visualFrame(undefined, 1),
    easeIn: SETTLE_EASE,
    easeOut: FADE_EASE,
  },
);

const topHit = holdTrack(
  [0, RING_IN, RING_SHOWN, CLEAR_RELEASE, CLEAR_RELEASE + 250, SEARCH_DURATION_MS],
  {
    hidden: visualFrame("translate3d(0px, 0px, 0px) scale(0.9)", 0),
    shown: visualFrame(undefined, 1),
    easeIn: SETTLE_EASE,
    easeOut: FADE_EASE,
  },
);

function resultTileTrack(index: number): ClosedTrack<VisualFrame> {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const permutation = RANKED_COLUMN[row];
  const dim = visualFrame(undefined, 0.35);

  if (permutation === undefined) {
    // Row 2: not a strong-enough match — fusion drops it while the
    // survivors permute, and the X brings it back.
    const gone = visualFrame("translate3d(0px, 10px, 0px) scale(0.96)", 0);
    return visualTrack(
      [visualFrame(), visualFrame(), dim, dim, gone, gone, visualFrame(), visualFrame()],
      normaliseTimes(SEARCH_DURATION_MS, [
        0, DIM_AT, DIM_DONE, FUSE_START, FUSE_START + FUSE_MS,
        CLEAR_RELEASE, RESTORE_DONE, SEARCH_DURATION_MS,
      ]),
      ["linear", FADE_EASE, "linear", FADE_EASE, "linear", SETTLE_EASE, "linear"],
    );
  }

  const from = SEARCH_GRID.cell(col, row);
  const to = SEARCH_GRID.cell(permutation[col], row);
  const dx = to.x - from.x; // Δcol × 202px pitch, sign included
  const popAt = POP_START + index * POP_STAGGER;
  const fuseAt = FUSE_START + row * FUSE_ROW_STAGGER;
  const pop = visualFrame("translate3d(0px, 0px, 0px) scale(1.04)", 1);
  // Mid-flight arc: half the slot delta, a 6px lift, a 5% swell —
  // the linear→SETTLE ease pair reads as one decelerating flight.
  const mid = visualFrame(`translate3d(${dx / 2}px, -6px, 0px) scale(1.05)`, 1);
  const ranked = { transform: moveTo(from, to), opacity: 1 };
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      dim,
      dim,
      pop,
      visualFrame(),
      visualFrame(),
      mid,
      ranked,
      ranked,
      visualFrame(),
      visualFrame(),
    ],
    normaliseTimes(SEARCH_DURATION_MS, [
      0, DIM_AT, DIM_DONE, popAt, popAt + POP_MS, popAt + POP_MS + POP_SETTLE,
      fuseAt, fuseAt + FUSE_MID, fuseAt + FUSE_MS,
      CLEAR_RELEASE, RESTORE_DONE, SEARCH_DURATION_MS,
    ]),
    [
      "linear", FADE_EASE, "linear", SETTLE_EASE, SETTLE_EASE, "linear",
      "linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear",
    ],
  );
}

const tileTracks = Array.from({ length: 12 }, (_, index) => resultTileTrack(index));

/** The candidate shimmer: the skeleton's own sheen span (half a cell
 * wide) sweeps left→right across each matched tile as it pops. The
 * span crawls home invisibly (opacity 0 at both jump ends). */
function sheenTrack(index: number): ClosedTrack<VisualFrame> {
  const start = POP_START + index * POP_STAGGER;
  const half = SEARCH_GRID.cellW / 2;
  const off = visualFrame(`translate3d(${-half}px, 0px, 0px) scale(1)`, 0);
  return visualTrack(
    [
      off,
      off,
      visualFrame(`translate3d(${SEARCH_GRID.cellW / 4}px, 0px, 0px) scale(1)`, 0.9),
      visualFrame(`translate3d(${SEARCH_GRID.cellW}px, 0px, 0px) scale(1)`, 0),
      off,
    ],
    normaliseTimes(SEARCH_DURATION_MS, [0, start, start + 200, start + 400, SEARCH_DURATION_MS]),
  );
}

const sheens = Array.from({ length: 8 }, (_, index) => sheenTrack(index));

export const SEARCH_TRACKS = {
  cursor,
  focusRing,
  resultsChrome,
  topHit,
  ...Object.fromEntries(glyphs.map((track, index) => [`glyph-${index}`, track])),
  ...Object.fromEntries(tileTracks.map((track, index) => [`tile-${index}`, track])),
  ...Object.fromEntries(sheens.map((track, index) => [`sheen-${index}`, track])),
} as const;

const BASE_TILES = Array.from({ length: 12 }, (_, i) =>
  SEARCH_GRID.cell(i % 4, Math.floor(i / 4)),
);

export const SEARCH_GEOMETRY: SceneGeometryManifest = {
  scene: "search",
  bounds: {
    focusRing: CHROME.searchBar,
    badge: SEMANTIC_BADGE,
    topHitRing: TOP_HIT_RING,
    ...Object.fromEntries(BASE_TILES.map((r, i) => [`tile-${i}`, r])),
  },
  clicks: [
    { label: "query", point: QUERY_POINT, target: CHROME.searchBar },
    { label: "clear", point: CLEAR_POINT, target: SEMANTIC_BADGE },
  ],
  disjoint: {
    base: BASE_TILES,
    ranked: BASE_TILES.slice(0, 8).map((_, i) =>
      SEARCH_GRID.cell(RANKED_COLUMN[Math.floor(i / 4)][i % 4], Math.floor(i / 4)),
    ),
  },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["search-query", "Describe what you remember"],
  ["search-results", "Bring the strongest matches forward"],
  ["search-cleared", "Clear back to the full feed"],
];

export const SEARCH_REDUCED_FRAMES = reducedFrames(reducedKinds);

export function SearchScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <DemoAppChrome />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/30" />

      <motion.div
        className="absolute z-30 rounded-[10px] border border-primary/70 shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary),transparent_82%)]"
        style={rectStyle(CHROME.searchBar)}
        animate={visualMotion(focusRing, SEARCH_DURATION_MS, motionOptions)}
      />
      <div
        className="absolute z-40 flex items-center gap-1.5"
        style={{ left: CHROME.searchBar.x + 34, top: 31 }}
      >
        {glyphs.map((track, index) => (
          <motion.span
            key={index}
            className="h-2 origin-left rounded-full bg-muted-foreground/65"
            style={{ width: 8 + ((index * 7) % 15) }}
            animate={visualMotion(track, SEARCH_DURATION_MS, motionOptions)}
          />
        ))}
      </div>
      <motion.div
        className="absolute z-40 flex items-center justify-center gap-2 rounded-full bg-primary/15 text-[9px] font-[650] text-primary"
        style={rectStyle(SEMANTIC_BADGE)}
        animate={visualMotion(resultsChrome, SEARCH_DURATION_MS, motionOptions)}
      >
        Semantic
        <X className="size-3" />
      </motion.div>

      <motion.h3
        className="absolute left-16 top-[94px] text-[13px] font-[650]"
        animate={visualMotion(resultsChrome, SEARCH_DURATION_MS, motionOptions)}
      >
        Results
      </motion.h3>

      <div
        className="absolute grid grid-cols-4 gap-3"
        style={{ left: SEARCH_GRID.originX, top: SEARCH_GRID.originY }}
      >
        {tileTracks.map((track, index) => (
          <motion.div
            key={index}
            className="relative h-[126px] w-[190px]"
            animate={visualMotion(track, SEARCH_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton
              className="size-full rounded-[14px] border border-border/70"
              sheen={
                index < 8
                  ? { track: sheens[index], durationMs: SEARCH_DURATION_MS }
                  : undefined
              }
            />
            <span
              className="pointer-events-none absolute inset-0 rounded-[14px]"
              style={{ background: TILE_TINTS[index] }}
            />
            <span
              className="pointer-events-none absolute bottom-2.5 left-2.5 h-2 rounded-full"
              style={{
                width: 30 + ((index * 13) % 42),
                background: TILE_TINTS[index],
              }}
            />
          </motion.div>
        ))}
      </div>

      <motion.div
        className="absolute z-10 rounded-[16px] border-2 border-primary/85 shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary),transparent_80%)]"
        style={rectStyle(TOP_HIT_RING)}
        animate={visualMotion(topHit, SEARCH_DURATION_MS, motionOptions)}
      />

      <FakeCursor
        track={cursor}
        durationMs={SEARCH_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
