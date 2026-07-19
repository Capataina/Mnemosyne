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
  normaliseTimes,
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
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const SEARCH_DURATION_MS = 8400;

/**
 * Results: 4 columns of 190×126 tiles with 12px gaps (grid-cols-4 gap-3
 * of w-[190px] h-[126px] tiles ⇒ pitch 202/138). The "rank fusion"
 * beat re-orders each row by a real permutation of its columns —
 * survivors swap whole slots (dx = Δcol × pitch), the weakest row fades.
 */
export const SEARCH_GRID = makeGrid({
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

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(QUERY_POINT.x, QUERY_POINT.y),
    cursorFrame(QUERY_POINT.x, QUERY_POINT.y, 0.92, 0.75, 1),
    cursorFrame(QUERY_POINT.x, QUERY_POINT.y),
    cursorFrame(QUERY_POINT.x, QUERY_POINT.y),
    cursorFrame(CLEAR_POINT.x, CLEAR_POINT.y),
    cursorFrame(CLEAR_POINT.x, CLEAR_POINT.y, 0.92, 0.75, 1),
    cursorFrame(CLEAR_POINT.x, CLEAR_POINT.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(SEARCH_DURATION_MS, [
    0, 600, 1050, 1150, 1300, 4950, 5300, 5450, 5970, 6620, 8400,
  ]),
  [
    "linear", CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, "linear",
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE, "linear",
  ],
);

const focusRing = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(SEARCH_DURATION_MS, [0, 1050, 1230, 4950, 5450, 8400]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

function glyphTrack(index: number): ClosedTrack<VisualFrame> {
  const start = 1300 + index * 120;
  return visualTrack(
    [
      visualFrame("translate3d(-4px, 0px, 0px) scaleX(.3)", 0),
      visualFrame("translate3d(-4px, 0px, 0px) scaleX(.3)", 0),
      visualFrame(undefined, 1),
      visualFrame(undefined, 1),
      visualFrame("translate3d(-4px, 0px, 0px) scaleX(.3)", 0),
      visualFrame("translate3d(-4px, 0px, 0px) scaleX(.3)", 0),
    ],
    normaliseTimes(SEARCH_DURATION_MS, [0, start, start + 180, 4950, 5450, 8400]),
    ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
  );
}

const glyphs = Array.from({ length: 6 }, (_, index) => glyphTrack(index));

const resultsChrome = visualTrack(
  [
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
    visualFrame("translate3d(0px, 6px, 0px) scale(1)", 0),
  ],
  normaliseTimes(SEARCH_DURATION_MS, [0, 2300, 2520, 4950, 5450, 8400]),
  ["linear", SETTLE_EASE, "linear", FADE_EASE, "linear"],
);

function resultTileTrack(index: number): ClosedTrack<VisualFrame> {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const permutation = RANKED_COLUMN[row];
  const unmatched = permutation === undefined;
  const ranked = unmatched
    ? visualFrame(undefined, 0)
    : {
        transform: moveTo(
          SEARCH_GRID.cell(col, row),
          SEARCH_GRID.cell(permutation[col], row),
        ),
        opacity: 1,
      };
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      ranked,
      ranked,
      visualFrame(),
      visualFrame(),
    ],
    normaliseTimes(SEARCH_DURATION_MS, [0, 2520, 3050, 4950, 5970, 8400]),
    ["linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
  );
}

const tileTracks = Array.from({ length: 12 }, (_, index) => resultTileTrack(index));

export const SEARCH_TRACKS = {
  cursor,
  focusRing,
  resultsChrome,
  ...Object.fromEntries(glyphs.map((track, index) => [`glyph-${index}`, track])),
  ...Object.fromEntries(tileTracks.map((track, index) => [`tile-${index}`, track])),
} as const;

const BASE_TILES = Array.from({ length: 12 }, (_, i) =>
  SEARCH_GRID.cell(i % 4, Math.floor(i / 4)),
);

export const SEARCH_GEOMETRY: SceneGeometryManifest = {
  scene: "search",
  bounds: {
    focusRing: CHROME.searchBar,
    badge: SEMANTIC_BADGE,
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

export const SEARCH_REDUCED_FRAMES = reducedKinds.map(([kind, caption]) => ({
  caption,
  content: <StaticFrameArt kind={kind} />,
}));

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
            className="h-[126px] w-[190px]"
            animate={visualMotion(track, SEARCH_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton
              raised={index % 4 === 1}
              className="size-full rounded-[14px] border border-border/70"
            />
          </motion.div>
        ))}
      </div>

      <FakeCursor
        track={cursor}
        durationMs={SEARCH_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
