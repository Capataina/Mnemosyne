import { motion } from "framer-motion";
import { Check, Minus, Plus, X } from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
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

export const ORGANISE_DURATION_MS = 9600;

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(36, 36),
    cursorFrame(36, 36, 0.92, 0.75, 1),
    cursorFrame(36, 36),
    cursorFrame(142, 214),
    cursorFrame(142, 214, 0.92, 0.75, 1),
    cursorFrame(142, 214),
    cursorFrame(304, 392),
    cursorFrame(304, 392, 0.92, 0.75, 1),
    cursorFrame(304, 392),
    cursorFrame(336, 432),
    cursorFrame(336, 432, 0.92, 0.75, 1),
    cursorFrame(336, 432),
    cursorFrame(304, 334),
    cursorFrame(304, 334, 0.92, 0.75, 1),
    cursorFrame(304, 334),
    cursorFrame(332, 105),
    cursorFrame(332, 105, 0.92, 0.75, 1),
    cursorFrame(332, 105),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [
    0, 500, 900, 1000, 1200, 1700, 1800, 2200, 2900, 3000, 3360, 4050,
    4150, 4510, 5900, 6000, 6420, 7100, 7200, 7350, 7850, 9600,
  ]),
);

const drawer = visualTrack(
  [
    visualFrame("translate3d(-360px, 0px, 0px) scale(1)", 1),
    visualFrame("translate3d(-360px, 0px, 0px) scale(1)", 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame("translate3d(-360px, 0px, 0px) scale(1)", 1),
    visualFrame("translate3d(-360px, 0px, 0px) scale(1)", 1),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [0, 500, 1000, 6720, 7200, 9600]),
  ["linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
);

const backdrop = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [0, 500, 1000, 6720, 7200, 9600]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const folderState = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [0, 1800, 2200, 6000, 6420, 9600]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const includeState = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [0, 3000, 3360, 6000, 6420, 9600]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

const excludeState = visualTrack(
  [
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
    visualFrame(undefined, 1),
    visualFrame(undefined, 1),
    visualFrame(undefined, 0),
    visualFrame(undefined, 0),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [0, 4150, 4510, 6000, 6420, 9600]),
  ["linear", FADE_EASE, "linear", FADE_EASE, "linear"],
);

function gridTileTrack(index: number): ClosedTrack<VisualFrame> {
  const folderShift = index % 3 === 1 ? 18 : index % 3 === 2 ? -18 : 0;
  const includeShift = index % 4 === 0 ? 22 : -12;
  const excluded = index === 2 || index === 7;
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      visualFrame(`translate3d(${folderShift}px, 0px, 0px) scale(1)`, index % 5 === 0 ? 0 : 1),
      visualFrame(`translate3d(${includeShift}px, -6px, 0px) scale(1)`, index % 4 === 1 ? 0 : 1),
      visualFrame(`translate3d(${includeShift}px, -12px, 0px) scale(1)`, excluded ? 0 : 1),
      visualFrame(`translate3d(${includeShift}px, -12px, 0px) scale(1)`, excluded ? 0 : 1),
      visualFrame(),
      visualFrame(),
    ],
    normaliseTimes(ORGANISE_DURATION_MS, [0, 1800, 2200, 3360, 4510, 6000, 6420, 9600]),
    ["linear", SETTLE_EASE, SETTLE_EASE, SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
  );
}

const gridTracks = Array.from({ length: 12 }, (_, index) => gridTileTrack(index));

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

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["organise-all", "Browse every tag as a folder"],
  ["organise-filters", "Combine must-have and must-not-have"],
  ["organise-refined", "Refine without moving originals"],
];

export const ORGANISE_REDUCED_FRAMES = reducedKinds.map(([kind, caption]) => ({
  caption,
  content: <StaticFrameArt kind={kind} />,
}));

export function OrganiseScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <DemoAppChrome
        leading={
          <div className="rounded-[9px] border border-border bg-surface px-3 py-2 text-[10.5px] font-[600]">
            Library
          </div>
        }
      />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/35" />

      <div className="absolute left-[382px] top-[104px] grid w-[530px] grid-cols-3 gap-3">
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
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[14px] font-[650]">Library</h3>
          <X className="size-4 text-muted-foreground" />
        </div>
        <p className="mb-3 text-[10px] font-[650] text-muted-foreground">Folders</p>
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
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[10px] font-[650] text-muted-foreground">Refine</p>
          <span className="text-[10px] font-[650]">Clear</span>
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
        className="absolute left-[330px] top-[18px] z-40 h-9 w-20 rounded-full border border-primary/50 bg-primary/10"
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
