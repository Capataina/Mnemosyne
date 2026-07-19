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
import type { ClosedTrack, OnboardingSceneProps, VisualFrame } from "../types";
import { DemoAppChrome, DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const SEARCH_DURATION_MS = 8400;

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(438, 36),
    cursorFrame(438, 36, 0.92, 0.75, 1),
    cursorFrame(438, 36),
    cursorFrame(438, 36),
    cursorFrame(704, 36),
    cursorFrame(704, 36, 0.92, 0.75, 1),
    cursorFrame(704, 36),
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
  const rankedCol = [1, 0, 3, 2][col] ?? col;
  const dx = (rankedCol - col) * 206;
  const dy = index % 3 === 0 ? -8 : row * 4;
  const unmatched = index > 7;
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      visualFrame(`translate3d(${dx}px, ${dy}px, 0px) scale(1)`, unmatched ? 0 : 1),
      visualFrame(`translate3d(${dx}px, ${dy}px, 0px) scale(1)`, unmatched ? 0 : 1),
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
        className="absolute left-[258px] top-[17px] z-30 h-9 w-[360px] rounded-[10px] border border-primary/70 shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary),transparent_82%)]"
        animate={visualMotion(focusRing, SEARCH_DURATION_MS, motionOptions)}
      />
      <div className="absolute left-[292px] top-[31px] z-40 flex items-center gap-1.5">
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
        className="absolute left-[570px] top-[24px] z-40 flex h-6 items-center gap-2 rounded-full bg-primary/15 px-2 text-[9px] font-[650] text-primary"
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

      <div className="absolute left-16 top-[128px] grid grid-cols-4 gap-3">
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
