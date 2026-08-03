import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
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
  centre,
  makeGrid,
  mapTo,
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

export const SIMILARITY_DURATION_MS = 9000;

/**
 * GEOM — the full trail: feed → similar view → dive one deeper →
 * inspect → back to all.
 *
 * Feed: 5 columns of 160×142 tiles, 12px gaps, two rows, starting at
 * y=178 so the similar-view header band (trail row + title row, below)
 * owns 72..178 outright — the v1 bug class this rebuild kills was the
 * header text sharing space with image rects without any manifest set
 * proving them disjoint. Every band rect now sits in the same disjoint
 * sets as the hero and result cells.
 */
const SIMILARITY_GRID = makeGrid({
  originX: 48,
  originY: 178,
  cellW: 160,
  cellH: 142,
  gapX: 12,
  gapY: 12,
});

const TILE_COUNT = 10;
/** The feed tile clicked first — becomes the first hero. */
const HERO_INDEX = 1;
/** The neighbour dived into — becomes the second hero. */
const DIVE_INDEX = 4;
const baseCell = (index: number) =>
  SIMILARITY_GRID.cell(index % 5, Math.floor(index / 5));

const HERO_RECT = SIMILARITY_GRID.span(0, 0, 2, 2);
/** Grid right edge (col 4's right side) — the band's buttons right-align to it. */
const GRID_RIGHT =
  SIMILARITY_GRID.cell(4, 0).x + SIMILARITY_GRID.cellW; // 736 + 160 = 896

/**
 * Similar-view header band, mirroring the real SimilarHeader
 * (src/pages/SimilarHeader.tsx): breadcrumb trail row ABOVE the title
 * row, count line under the title, "Back one" / "Back to all" buttons
 * right-aligned. Vertical stack inside 72..178: trail 86..110, title
 * 118..134, count 140..148, buttons 112..142 — every gap ≥ 6px and the
 * whole band ends 30px above the grid's y=178.
 */
const CHIP = 24;
const TRAIL_CHIP_A = rect(48, 86, CHIP, CHIP);
const TRAIL_SEP = rect(TRAIL_CHIP_A.x + CHIP + 4, 90, 10, 16); // (76, 90)
const TRAIL_CHIP_B = rect(TRAIL_SEP.x + TRAIL_SEP.w + 4, 86, CHIP, CHIP); // (90, 86)
const TITLE_RECT = rect(48, 118, 96, 16);
const COUNT_RECT = rect(48, 140, 120, 8);
const BACK_ALL = rect(GRID_RIGHT - 96, 112, 96, 30); // (800, 112)
const BACK_ONE = rect(BACK_ALL.x - 8 - 88, 112, 88, 30); // (704, 112)

/**
 * Inspector, mirroring the real PinterestModal: two columns — image
 * stage left, details aside right — with the aside HEADER (title bars +
 * prev/next/close nav) sitting OUTSIDE the scroll area, exactly the
 * current app layout. All child rects derive from INSPECTOR.
 */
const INSPECTOR = rect(42, 42, 876, 516);
const ASIDE_W = 290;
const ASIDE = rect(
  INSPECTOR.x + INSPECTOR.w - ASIDE_W,
  INSPECTOR.y,
  ASIDE_W,
  INSPECTOR.h,
); // (628, 42, 290, 516)
const ASIDE_HEADER = rect(ASIDE.x, ASIDE.y, ASIDE.w, 64);
const IMAGE_PANE = rect(
  INSPECTOR.x,
  INSPECTOR.y,
  INSPECTOR.w - ASIDE_W,
  INSPECTOR.h,
); // (42, 42, 586, 516)
/** The image's true footprint: the pane inset by its 24px padding. The
 * v1 "next image" overlay ignored this footprint and slabbed the whole
 * pane (nav chrome included) — the founder's "looks weird". */
const IMG_RECT = rect(
  IMAGE_PANE.x + 24,
  IMAGE_PANE.y + 24,
  IMAGE_PANE.w - 48,
  IMAGE_PANE.h - 48,
); // (66, 66, 538, 468)
const NAV_SIZE = 28;
const NAV_Y = ASIDE_HEADER.y + (ASIDE_HEADER.h - NAV_SIZE) / 2; // 60
const NAV_CLOSE = rect(ASIDE.x + ASIDE.w - 14 - NAV_SIZE, NAV_Y, NAV_SIZE, NAV_SIZE); // (876, 60)
const NAV_NEXT = rect(NAV_CLOSE.x - 10 - NAV_SIZE, NAV_Y, NAV_SIZE, NAV_SIZE); // (838, 60)
const NAV_PREV = rect(NAV_NEXT.x - 6 - NAV_SIZE, NAV_Y, NAV_SIZE, NAV_SIZE); // (804, 60)
/** 1px divider centred in the 10px next↔close gap, as the real header. */
const NAV_DIVIDER = rect(NAV_NEXT.x + NAV_SIZE + 4, NAV_Y + 6, 1, 16); // (870, 66)
const TITLE_BAR = rect(ASIDE.x + 16, 56, 110, 10);
const TITLE_BAR_B = rect(TITLE_BAR.x, TITLE_BAR.y, 84, TITLE_BAR.h);
const SUB_BAR = rect(ASIDE.x + 16, 72, 70, 7);
const ASIDE_BODY = rect(
  ASIDE.x + 16,
  ASIDE_HEADER.y + ASIDE_HEADER.h + 16,
  ASIDE.w - 32,
  ASIDE.y + ASIDE.h - (ASIDE_HEADER.y + ASIDE_HEADER.h) - 32,
); // (644, 122, 258, 420)

/** Result slots to the hero's right, filled in reading order. */
const RESULT_SLOTS: readonly (readonly [number, number])[] = [
  [2, 0], [3, 0], [4, 0], [2, 1], [3, 1], [4, 1],
];
const slotRect = (slot: number) =>
  SIMILARITY_GRID.cell(...RESULT_SLOTS[slot]);

/** tile → slot in the first similar view (hero = tile 1; 7/8/9 fade). */
const SLOTS_SIM: Readonly<Partial<Record<number, number>>> = {
  0: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
};
/** tile → slot after the dive: tile 4 is the new hero, tile 1 shrinks
 * into the trail, tile 7 arrives as a fresh neighbour, and the fused
 * re-rank permutes the survivors. */
const SLOTS_DIVE: Readonly<Partial<Record<number, number>>> = {
  3: 0, 6: 1, 0: 2, 2: 3, 7: 4, 5: 5,
};

/**
 * Every transform in the tile tracks uses ONE template —
 * `translate3d(x, y, z) scale(sx, sy)` — because framer-motion can only
 * interpolate keyframe strings whose numeric templates match. v1 mixed
 * one-arg scale(1) frames with mapTo's two-arg scale(sx, sy) frames in
 * the same track, which degenerates the hero's map into a snap — the
 * "image looks weird" defect. mapTo always emits the two-arg form, so
 * identity/faded frames spell it out too.
 */
const IDENTITY_2ARG = "translate3d(0px, 0px, 0px) scale(1, 1)";
const AT_BASE: VisualFrame = visualFrame(IDENTITY_2ARG, 1);
const HIDDEN_IN_PLACE: VisualFrame = visualFrame(
  "translate3d(0px, 0px, 0px) scale(0.97, 0.97)",
  0,
);
const shownAt = (index: number, to: Rect): VisualFrame => ({
  transform: mapTo(baseCell(index), to),
  opacity: 1,
});

function viewFrame(index: number, view: "sim" | "dive"): VisualFrame {
  if (view === "sim") {
    if (index === HERO_INDEX) return shownAt(index, HERO_RECT);
    const slot = SLOTS_SIM[index];
    return slot === undefined ? HIDDEN_IN_PLACE : shownAt(index, slotRect(slot));
  }
  if (index === DIVE_INDEX) return shownAt(index, HERO_RECT);
  if (index === HERO_INDEX) return shownAt(index, TRAIL_CHIP_A);
  const slot = SLOTS_DIVE[index];
  return slot === undefined ? HIDDEN_IN_PLACE : shownAt(index, slotRect(slot));
}

/**
 * Beat offsets (ms). Every visual response begins exactly at (or just
 * after) the press release that causes it:
 * select release 1200 → similar view settles 1660; dive release 2700 →
 * dive settles 3200; hero release 4100 → inspector in by 4460; next
 * release 5500 → detail swap by 5860; close release 6800 → inspector
 * out by 7160; back-all release 7900 → home by 8500; park by 8600 with
 * a 400ms rest — no trailing dead time.
 */
function feedTileTrack(index: number): ClosedTrack<VisualFrame> {
  const sim = viewFrame(index, "sim");
  const dive = viewFrame(index, "dive");
  return visualTrack(
    [AT_BASE, AT_BASE, sim, sim, dive, dive, AT_BASE, AT_BASE],
    normaliseTimes(SIMILARITY_DURATION_MS, [0, 1200, 1660, 2700, 3200, 7900, 8500, 9000]),
    ["linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
  );
}

const tileTracks = Array.from({ length: TILE_COUNT }, (_, index) =>
  feedTileTrack(index),
);

const CLICK_TILE = centre(baseCell(HERO_INDEX));
const CLICK_RESULT = centre(slotRect(SLOTS_SIM[DIVE_INDEX]!));
const CLICK_HERO = centre(HERO_RECT);
const CLICK_NEXT = centre(NAV_NEXT);
const CLICK_CLOSE = centre(NAV_CLOSE);
const CLICK_BACK_ALL = centre(BACK_ALL);

/** Hold frames after each release keep the cursor parked on its target
 * while the UI responds, instead of drifting through a long travel
 * segment toward the next waypoint. */
const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    ...pressAt(CLICK_TILE),
    cursorFrame(CLICK_TILE.x, CLICK_TILE.y),
    ...pressAt(CLICK_RESULT),
    cursorFrame(CLICK_RESULT.x, CLICK_RESULT.y),
    ...pressAt(CLICK_HERO),
    cursorFrame(CLICK_HERO.x, CLICK_HERO.y),
    ...pressAt(CLICK_NEXT),
    cursorFrame(CLICK_NEXT.x, CLICK_NEXT.y),
    ...pressAt(CLICK_CLOSE),
    cursorFrame(CLICK_CLOSE.x, CLICK_CLOSE.y),
    ...pressAt(CLICK_BACK_ALL),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(SIMILARITY_DURATION_MS, [
    0, 400, 1000, 1100, 1200, 2100, 2500, 2600, 2700, 3400, 3900, 4000,
    4100, 4900, 5300, 5400, 5500, 6350, 6600, 6700, 6800, 7200, 7700,
    7800, 7900, 8600, 9000,
  ]),
  [
    "linear", CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, "linear",
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, "linear",
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, "linear",
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, "linear",
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, "linear",
    CURSOR_TRAVEL_EASE, SETTLE_EASE, SETTLE_EASE, CURSOR_TRAVEL_EASE,
    "linear",
  ],
);

/** Header band + the hero's selected ring-2: in from the select
 * release, out on the back-to-all release. */
const similarChrome = holdTrack([0, 1250, 1660, 7900, 8360, 9000], {
  hidden: visualFrame("translate3d(0px, 8px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

/** Trail chip + separator appear only after the dive (the real app's
 * simTrail is empty until you follow a neighbour). */
const trail = holdTrack([0, 2750, 3200, 7900, 8360, 9000], {
  hidden: visualFrame("translate3d(-6px, 0px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

/** Hover rings — the real MasonryItem hover treatment (thin primary
 * ring, no arrow pill; the hero expand pill was removed from the app).
 * Each ring lights exactly when the cursor arrives over the tile and
 * dies as the click's response carries the tile away. */
const ringFeed = holdTrack([0, 1000, 1140, 1210, 1350, 9000], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});
const ringResult = holdTrack([0, 2500, 2640, 2710, 2850, 9000], {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

const inspectorHold = holdTrack([0, 4100, 4460, 6800, 7160, 9000], {
  hidden: visualFrame("translate3d(0px, 0px, 0px) scale(.97)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: SETTLE_EASE,
});

/** The next-image swap, confined to the image's true footprint (and the
 * aside title bar): A slides out left as B slides in from the right.
 * detailA is the reverse-labelled hold — resting visible, "shown" =
 * slid-out — so both reset invisibly while the inspector is closed. */
const detailA = holdTrack([0, 5500, 5860, 6800, 7160, 9000], {
  hidden: visualFrame(undefined, 1),
  shown: visualFrame("translate3d(-18px, 0px, 0px) scale(1)", 0),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});
const detailB = holdTrack([0, 5500, 5860, 6800, 7160, 9000], {
  hidden: visualFrame("translate3d(18px, 0px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

export const SIMILARITY_TRACKS = {
  cursor,
  similarChrome,
  trail,
  ringFeed,
  ringResult,
  inspectorHold,
  detailA,
  detailB,
  ...Object.fromEntries(tileTracks.map((track, index) => [`tile-${index}`, track])),
} as const;

const BASE_TILES: Rect[] = Array.from({ length: TILE_COUNT }, (_, i) =>
  baseCell(i),
);
const SLOT_RECTS: Rect[] = RESULT_SLOTS.map((_, slot) => slotRect(slot));
/** Both settled similar views share the band rects, so the manifest
 * proves the v1 complaint dead: no image rect may touch the header. */
const BAND_RECTS: Rect[] = [TITLE_RECT, COUNT_RECT, BACK_ONE, BACK_ALL];

export const SIMILARITY_GEOMETRY: SceneGeometryManifest = {
  scene: "similarity",
  bounds: {
    hero: HERO_RECT,
    title: TITLE_RECT,
    count: COUNT_RECT,
    backOne: BACK_ONE,
    backAll: BACK_ALL,
    trailChipA: TRAIL_CHIP_A,
    trailSep: TRAIL_SEP,
    trailChipB: TRAIL_CHIP_B,
    inspector: INSPECTOR,
    imagePane: IMAGE_PANE,
    imageRect: IMG_RECT,
    aside: ASIDE,
    asideHeader: ASIDE_HEADER,
    asideBody: ASIDE_BODY,
    titleBar: TITLE_BAR,
    titleBarB: TITLE_BAR_B,
    subBar: SUB_BAR,
    navPrev: NAV_PREV,
    navNext: NAV_NEXT,
    navClose: NAV_CLOSE,
    navDivider: NAV_DIVIDER,
    ...Object.fromEntries(BASE_TILES.map((r, i) => [`tile-${i}`, r])),
  },
  clicks: [
    { label: "select-tile", point: CLICK_TILE, target: baseCell(HERO_INDEX) },
    {
      label: "dive-result",
      point: CLICK_RESULT,
      target: slotRect(SLOTS_SIM[DIVE_INDEX]!),
    },
    { label: "open-inspector", point: CLICK_HERO, target: HERO_RECT },
    { label: "inspector-next", point: CLICK_NEXT, target: NAV_NEXT },
    { label: "inspector-close", point: CLICK_CLOSE, target: NAV_CLOSE },
    { label: "back-to-all", point: CLICK_BACK_ALL, target: BACK_ALL },
  ],
  disjoint: {
    base: BASE_TILES,
    similar: [...BAND_RECTS, HERO_RECT, ...SLOT_RECTS],
    dive: [
      ...BAND_RECTS,
      TRAIL_CHIP_A,
      TRAIL_SEP,
      TRAIL_CHIP_B,
      HERO_RECT,
      ...SLOT_RECTS,
    ],
    inspector: [IMG_RECT, ASIDE],
    inspectorHeader: [TITLE_BAR, SUB_BAR, NAV_PREV, NAV_NEXT, NAV_CLOSE, NAV_DIVIDER],
  },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["similarity-feed", "Choose an image"],
  ["similarity-trail", "Follow a visual trail"],
  ["similarity-inspector", "Inspect and annotate"],
];

export const SIMILARITY_REDUCED_FRAMES = reducedFrames(reducedKinds);

/** Positions a stage-coordinate rect inside the inspector panel (whose
 * own div is at INSPECTOR with overflow-hidden for the rounding). */
const inPanel = (r: Rect) =>
  rectStyle(rect(r.x - INSPECTOR.x, r.y - INSPECTOR.y, r.w, r.h));

export function SimilarityScene({ animationLevel }: OnboardingSceneProps) {
  const subtle = animationLevel === "subtle";
  const motionOptions = { subtle };
  const accentMotionOptions = { subtle, removeScaleAccent: true };

  return (
    <DemoSceneRoot>
      <DemoAppChrome />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/30" />

      {/* Similar-view header band — the real SimilarHeader's shape. */}
      <motion.div
        className="absolute z-20"
        animate={visualMotion(similarChrome, SIMILARITY_DURATION_MS, motionOptions)}
      >
        <h3
          className="absolute text-[13px] font-[650] leading-[16px]"
          style={rectStyle(TITLE_RECT)}
        >
          More like this
        </h3>
        <OnboardingSkeleton
          className="absolute rounded-full"
          style={rectStyle(COUNT_RECT)}
        />
        <div
          className="absolute flex items-center justify-center gap-1 rounded-[10px] border border-border bg-surface/65 text-[10px] font-[600]"
          style={rectStyle(BACK_ONE)}
        >
          <ChevronLeft className="size-3" />
          Back one
        </div>
        <div
          className="absolute grid place-items-center rounded-[10px] border border-border bg-surface/65 text-[10px] font-[600]"
          style={rectStyle(BACK_ALL)}
        >
          ← Back to all
        </div>
      </motion.div>

      {/* Trail: tile 1 itself shrinks onto TRAIL_CHIP_A; the separator
          and the current-hero mini (primary ring, as the real trail's
          last chip) fade in with it. */}
      <motion.div
        className="absolute z-20"
        animate={visualMotion(trail, SIMILARITY_DURATION_MS, motionOptions)}
      >
        <span
          className="absolute grid place-items-center text-[11px] text-muted-foreground"
          style={rectStyle(TRAIL_SEP)}
        >
          ›
        </span>
        <OnboardingSkeleton
          raised
          className="absolute rounded-[7px] ring-2 ring-inset ring-primary/60"
          style={rectStyle(TRAIL_CHIP_B)}
        />
      </motion.div>

      {BASE_TILES.map((tile, index) => (
        <motion.div
          key={index}
          className={[
            "absolute origin-top-left",
            index === DIVE_INDEX
              ? "z-[25]"
              : index === HERO_INDEX
                ? "z-20"
                : "z-10",
          ].join(" ")}
          style={rectStyle(tile)}
          animate={visualMotion(tileTracks[index], SIMILARITY_DURATION_MS, motionOptions)}
        >
          <OnboardingSkeleton
            raised={index === HERO_INDEX || index % 4 === 0}
            className="size-full rounded-[14px] border border-border/70"
          />
        </motion.div>
      ))}

      {/* Hover rings (thin primary hairline — MasonryItem's hover
          treatment; the old always-on expand pill is gone from the app)
          and the pinned hero's selected ring-2. Rendered after the
          tiles so they draw over the tile edges. */}
      <motion.div
        className="absolute z-30 rounded-[14px] ring-1 ring-inset ring-primary/65"
        style={rectStyle(baseCell(HERO_INDEX))}
        animate={visualMotion(ringFeed, SIMILARITY_DURATION_MS, motionOptions)}
      />
      <motion.div
        className="absolute z-30 rounded-[14px] ring-1 ring-inset ring-primary/65"
        style={rectStyle(slotRect(SLOTS_SIM[DIVE_INDEX]!))}
        animate={visualMotion(ringResult, SIMILARITY_DURATION_MS, motionOptions)}
      />
      <motion.div
        className="absolute z-30 rounded-[14px] ring-2 ring-inset ring-primary/70"
        style={rectStyle(HERO_RECT)}
        animate={visualMotion(similarChrome, SIMILARITY_DURATION_MS, motionOptions)}
      />

      {/* Inspector: the real PinterestModal layout — image stage +
          details aside, aside header OUTSIDE the scroll area with
          prev/next | close nav at its top right. */}
      <motion.div
        className="absolute inset-0 z-40 bg-background/70"
        animate={visualMotion(inspectorHold, SIMILARITY_DURATION_MS, accentMotionOptions)}
      />
      <motion.div
        className="absolute inset-0 z-50"
        animate={visualMotion(inspectorHold, SIMILARITY_DURATION_MS, accentMotionOptions)}
      >
        <div
          className="absolute overflow-hidden rounded-[16px] border border-border-strong bg-card shadow-[var(--shadow-float)]"
          style={rectStyle(INSPECTOR)}
        >
          <div
            className="absolute bg-surface-sunken"
            style={inPanel(IMAGE_PANE)}
          />
          <div
            className="absolute overflow-hidden rounded-[14px]"
            style={inPanel(IMG_RECT)}
          >
            <motion.div
              className="absolute inset-0"
              animate={visualMotion(detailA, SIMILARITY_DURATION_MS, motionOptions)}
            >
              <OnboardingSkeleton raised className="size-full rounded-[14px]" />
            </motion.div>
            <motion.div
              className="absolute inset-0"
              animate={visualMotion(detailB, SIMILARITY_DURATION_MS, motionOptions)}
            >
              <OnboardingSkeleton className="size-full rounded-[14px]" />
            </motion.div>
          </div>
          <div
            className="absolute border-l border-border bg-card"
            style={inPanel(ASIDE)}
          />
          <div
            className="absolute border-b border-border bg-surface-overlay/95"
            style={inPanel(ASIDE_HEADER)}
          />
          <motion.div
            className="absolute"
            style={inPanel(TITLE_BAR)}
            animate={visualMotion(detailA, SIMILARITY_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton className="size-full rounded-full" />
          </motion.div>
          <motion.div
            className="absolute"
            style={inPanel(TITLE_BAR_B)}
            animate={visualMotion(detailB, SIMILARITY_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton className="size-full rounded-full" raised />
          </motion.div>
          <OnboardingSkeleton
            className="absolute rounded-full"
            style={inPanel(SUB_BAR)}
          />
          <div
            className="absolute grid place-items-center rounded-[9px] bg-surface text-muted-foreground"
            style={inPanel(NAV_PREV)}
          >
            <ChevronLeft className="size-3.5" strokeWidth={1.8} />
          </div>
          <div
            className="absolute grid place-items-center rounded-[9px] bg-surface text-muted-foreground"
            style={inPanel(NAV_NEXT)}
          >
            <ChevronRight className="size-3.5" strokeWidth={1.8} />
          </div>
          <div className="absolute bg-border" style={inPanel(NAV_DIVIDER)} />
          <div
            className="absolute grid place-items-center rounded-[9px] bg-surface text-muted-foreground"
            style={inPanel(NAV_CLOSE)}
          >
            <X className="size-3.5" strokeWidth={1.8} />
          </div>
          <div className="absolute" style={inPanel(ASIDE_BODY)}>
            <p className="mb-3 text-[11px] font-[620]">Tags</p>
            <div className="mb-8 flex gap-2">
              <OnboardingSkeleton className="h-7 w-16 rounded-full" />
              <OnboardingSkeleton className="h-7 w-20 rounded-full" raised />
            </div>
            <p className="mb-3 text-[11px] font-[620]">Notes</p>
            <OnboardingSkeleton className="h-3 w-full rounded-full" />
            <OnboardingSkeleton className="mt-2 h-3 w-5/6 rounded-full" />
            <OnboardingSkeleton className="mt-2 h-3 w-2/3 rounded-full" />
          </div>
        </div>
      </motion.div>

      <FakeCursor
        track={cursor}
        durationMs={SIMILARITY_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
