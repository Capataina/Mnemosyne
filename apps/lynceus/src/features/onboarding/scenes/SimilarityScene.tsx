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
import type { ClosedTrack, OnboardingSceneProps, VisualFrame } from "../types";
import { DemoAppChrome, DemoSceneRoot } from "../primitives/DemoAppChrome";
import { OnboardingSkeleton } from "../primitives/OnboardingSkeleton";
import { SkeletonInspector } from "../primitives/SkeletonInspector";
import {
  StaticFrameArt,
  type StaticFrameKind,
} from "../primitives/ReducedMotionFilmstrip";

export const SIMILARITY_DURATION_MS = 10800;

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(270, 210),
    cursorFrame(270, 210, 0.92, 0.75, 1),
    cursorFrame(270, 210),
    cursorFrame(612, 248),
    cursorFrame(612, 248, 0.92, 0.75, 1),
    cursorFrame(612, 248),
    cursorFrame(270, 132),
    cursorFrame(270, 132, 0.92, 0.75, 1),
    cursorFrame(270, 132),
    cursorFrame(864, 116),
    cursorFrame(864, 116, 0.92, 0.75, 1),
    cursorFrame(864, 116),
    cursorFrame(910, 116),
    cursorFrame(910, 116, 0.92, 0.75, 1),
    cursorFrame(910, 116),
    cursorFrame(820, 116),
    cursorFrame(820, 116, 0.92, 0.75, 1),
    cursorFrame(820, 116),
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

function feedTileTrack(index: number): ClosedTrack<VisualFrame> {
  const hero = index === 1;
  const resultX = hero ? -170 : ((index % 4) - 1) * 16;
  const resultY = hero ? -28 : index % 2 === 0 ? 24 : -10;
  const resultScale = hero ? 1.45 : 1;
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      visualFrame(
        `translate3d(${resultX}px, ${resultY}px, 0px) scale(${resultScale})`,
        1,
      ),
      visualFrame(
        `translate3d(${resultX}px, ${resultY}px, 0px) scale(${resultScale})`,
        index === 8 ? 0 : 1,
      ),
      visualFrame(
        `translate3d(${resultX + (index % 3) * 8}px, ${resultY}px, 0px) scale(${resultScale})`,
        index === 7 ? 0 : 1,
      ),
      visualFrame(
        `translate3d(${resultX + (index % 3) * 8}px, ${resultY}px, 0px) scale(${resultScale})`,
        index === 7 ? 0 : 1,
      ),
      visualFrame(),
      visualFrame(),
    ],
    normaliseTimes(SIMILARITY_DURATION_MS, [0, 1100, 1500, 2350, 2750, 7750, 8200, 10800]),
    ["linear", SETTLE_EASE, FADE_EASE, SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
  );
}

const tileTracks = Array.from({ length: 10 }, (_, index) => feedTileTrack(index));

export const SIMILARITY_TRACKS = {
  cursor,
  similarityChrome,
  breadcrumb,
  inspector,
  inspectorNext,
  ...Object.fromEntries(tileTracks.map((track, index) => [`tile-${index}`, track])),
} as const;

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
        className="absolute inset-x-12 top-[88px] z-20 flex items-center justify-between"
        animate={visualMotion(similarityChrome, SIMILARITY_DURATION_MS, motionOptions)}
      >
        <h3 className="text-[13px] font-[650]">More like this</h3>
        <div className="flex items-center gap-3 text-[10px] font-[600]">
          <span className="flex items-center gap-1"><ChevronLeft className="size-3" />Back one</span>
          <span>Back to all</span>
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

      <div className="absolute left-12 top-[158px] grid grid-cols-5 gap-3">
        {tileTracks.map((track, index) => (
          <motion.div
            key={index}
            className={[
              "relative h-[142px] w-[160px] origin-center",
              index === 1 ? "z-20" : "z-10",
            ].join(" ")}
            animate={visualMotion(track, SIMILARITY_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton
              raised={index === 1 || index % 4 === 0}
              className="size-full rounded-[14px] border border-border/70"
            />
            {index === 1 && (
              <div className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-background/75">
                <Maximize2 className="size-3.5" />
              </div>
            )}
          </motion.div>
        ))}
      </div>

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
