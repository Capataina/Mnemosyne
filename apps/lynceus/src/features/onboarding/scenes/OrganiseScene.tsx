import { motion } from "framer-motion";
import { Check, LibraryBig, Minus, Plus } from "lucide-react";
import { FakeCursor } from "../FakeCursor";
import {
  CURSOR_PARK,
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

export const ORGANISE_DURATION_MS = 7500;

/**
 * Results grid: 3 columns of 168×102 cells, 12px gaps (the container is
 * w-[528px] with grid-cols-3 gap-3, which yields exactly these cells —
 * change one, change both). originX centres the grid in the 600px strip
 * beside the OPEN panel (360 + (600 − 528) / 2 = 396), so the panel never
 * covers the action — filter clicks land on the left while survivors
 * compact live on the right. Filtering REMOVES tiles and COMPACTS the
 * survivors: each survivor translates from its base cell to the cell of
 * its new index among survivors — computed, so nothing stacks or drifts.
 */
const ORGANISE_GRID = makeGrid({
  originX: 396,
  originY: 104,
  cellW: 168,
  cellH: 102,
  gapX: 12,
  gapY: 12,
});

const TILE_COUNT = 12;
const baseCell = (index: number) =>
  ORGANISE_GRID.cell(index % 3, Math.floor(index / 3));

/**
 * Tag membership drives both the tile swatch dots AND the filter beats,
 * so the removals read as caused rather than arbitrary:
 * - INCLUDE_MISSES lack the primary tag → depart on the must-have click;
 * - EXCLUDE_HITS carry the flagged (destructive) tag → depart on the
 *   must-not click (they also carry the primary tag, which is why they
 *   survive the first filter).
 */
const INCLUDE_MISSES = new Set([1, 4, 8, 11]);
const EXCLUDE_HITS = new Set([2, 6]);
const AFTER_INCLUDE = INCLUDE_MISSES;
const AFTER_EXCLUDE = new Set([...INCLUDE_MISSES, ...EXCLUDE_HITS]);

/** The cell a tile occupies once `removed` is applied: its index among
 * the survivors, laid back onto the same grid. */
const survivorCell = (index: number, removed: Set<number>): Rect => {
  let survivorIndex = 0;
  for (let k = 0; k < index; k += 1) {
    if (!removed.has(k)) survivorIndex += 1;
  }
  return ORGANISE_GRID.cell(survivorIndex % 3, Math.floor(survivorIndex / 3));
};

function filteredFrame(index: number, removed: Set<number>): VisualFrame {
  if (removed.has(index)) {
    // Departure with intent: a short downward drop as it fades, in place.
    return {
      transform: "translate3d(0px, 10px, 0px) scale(0.92)",
      opacity: 0,
    };
  }
  return {
    transform: moveTo(baseCell(index), survivorCell(index, removed)),
    opacity: 1,
  };
}

/**
 * Beat timeline (ms) — every visual reaction trails its causing press
 * release by ≤ ~SETTLE_MS, and the cursor holds still on watch beats so
 * travel never coincides with a press.
 *
 *    0– 420  rest, cursor parked
 *  900–1140  press the Library pill → panel slides out 1190–1400
 * 1880–2020  press the must-have toggle → rings 2020, grid compacts 2120–2670
 * 3050–3190  press the must-not toggle → rings 3190, grid compacts 3290–3840
 * 4900–5040  press Clear → chips/toggles fade, return wave 5140–6090
 * 6500–6640  press the Library pill again → panel slides home 6690–6940
 * 7150–7500  cursor re-parked; loop restarts immediately
 */
const T = {
  restEnd: 420,
  openArrive: 900,
  openPress: 1000,
  openRelease: 1140,
  drawerOutStart: 1190,
  drawerOut: 1400,
  includeArrive: 1780,
  includePress: 1880,
  includeRelease: 2020,
  includeReactStart: 2120,
  includeSettled: 2670,
  watchCompact: 2600,
  excludeArrive: 2950,
  excludePress: 3050,
  excludeRelease: 3190,
  excludeReactStart: 3290,
  excludeSettled: 3840,
  breathe: 4300,
  clearArrive: 4800,
  clearPress: 4900,
  clearRelease: 5040,
  waveStart: 5140,
  waveStepMs: 90,
  waveTravelMs: 500,
  watchWave: 5900,
  closeArrive: 6400,
  closePress: 6500,
  closeRelease: 6640,
  drawerInStart: 6690,
  drawerIn: 6940,
  parked: 7150,
} as const;

/** Per-tile loop: base → must-have compact → must-not compact → held →
 * staggered return to base. The return offsets by (col + row) so the
 * refill sweeps diagonally from the top-left — each tile's times stay
 * strictly ordered and its last return (5590 + 500) lands well before
 * the panel starts closing at 6690. */
function gridTileTrack(index: number): ClosedTrack<VisualFrame> {
  const col = index % 3;
  const row = Math.floor(index / 3);
  const returnStart = T.waveStart + (col + row) * T.waveStepMs;
  const returnEnd = returnStart + T.waveTravelMs;
  return visualTrack(
    [
      visualFrame(),
      visualFrame(),
      filteredFrame(index, AFTER_INCLUDE),
      filteredFrame(index, AFTER_INCLUDE),
      filteredFrame(index, AFTER_EXCLUDE),
      filteredFrame(index, AFTER_EXCLUDE),
      visualFrame(),
      visualFrame(),
    ],
    normaliseTimes(ORGANISE_DURATION_MS, [
      0,
      T.includeReactStart,
      T.includeSettled,
      T.excludeReactStart,
      T.excludeSettled,
      returnStart,
      returnEnd,
      ORGANISE_DURATION_MS,
    ]),
    ["linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear", SETTLE_EASE, "linear"],
  );
}

const gridTracks = Array.from({ length: TILE_COUNT }, (_, index) =>
  gridTileTrack(index),
);

/**
 * Panel geometry — the library panel is an EDGE SLIDE-OUT, matching the
 * shipped LibraryDrawer: flush against the left screen edge, floating
 * below the header (real app: top-[84px] bottom-3 → here 84 to 588),
 * 360 wide, rounded on its inner (right) edge only, NO scrim — the grid
 * stays fully visible beside it. Interior rows are absolutely positioned
 * from these rects (header 16 + 36 + 16 + 1px border = 68; body px-4
 * py-5), via a flow accumulator rather than CSS flow — margin collapse
 * structurally cannot happen because no element carries a margin.
 */
const PANEL = rect(0, 84, 360, 504);
const PANEL_HEADER_H = 68;
const BODY_X = 16; // panel px-4
const BODY_W = PANEL.w - 2 * BODY_X;
let flowY = PANEL.y + PANEL_HEADER_H + 1 + 20; // header + border-b + body py-5
const flowRow = (h: number, below: number): Rect => {
  const r = rect(BODY_X, flowY, BODY_W, h);
  flowY += h + below;
  return r;
};
const FOLDERS_LABEL = flowRow(14, 12);
const ALL_IMAGES = flowRow(40, 8);
const FOLDER_ROWS = [flowRow(40, 8), flowRow(40, 20)];
const DIVIDER = flowRow(1, 20);
const FILTER_HEAD = flowRow(22, 12);
const FILTER_ROWS = [flowRow(44, 8), flowRow(44, 8), flowRow(44, 0)];
// flowY now 558 — inside the body's bottom padding line (588 − 20 = 568).

const CLEAR = rect(FILTER_HEAD.x + FILTER_HEAD.w - 48, FILTER_HEAD.y, 48, 22);

/** The per-tag include/exclude toggle pair, right-aligned in a filter
 * row: 12px row padding, 28px buttons, 6px between (slot 0 = outer
 * exclude, slot 1 = inner include). */
const toggleRect = (row: Rect, slot: 0 | 1): Rect =>
  rect(row.x + row.w - 12 - 28 - slot * 34, row.y + (row.h - 28) / 2, 28, 28);
const INCLUDE_TOGGLE = toggleRect(FILTER_ROWS[0], 1);
const EXCLUDE_TOGGLE = toggleRect(FILTER_ROWS[1], 0);

/** Active-filter chips in the search bar (the real app renders panel
 * filters as SearchBar chips — two views of one state), right-aligned
 * against the bar's 12px padding, clear of its left-side skeleton bar. */
const CHIP_W = 62;
const CHIP_H = 20;
const chipRect = (slotFromRight: number): Rect =>
  rect(
    CHROME.searchBar.x + CHROME.searchBar.w - 12 - CHIP_W - slotFromRight * (CHIP_W + 6),
    CHROME.searchBar.y + (CHROME.searchBar.h - CHIP_H) / 2,
    CHIP_W,
    CHIP_H,
  );
const INCLUDE_CHIP = chipRect(1);
const EXCLUDE_CHIP = chipRect(0);

const CLICK_LIBRARY = centre(CHROME.leadingPill);
const CLICK_INCLUDE = centre(INCLUDE_TOGGLE);
const CLICK_EXCLUDE = centre(EXCLUDE_TOGGLE);
const CLICK_CLEAR = centre(CLEAR);

const cursor = cursorTrack(
  [
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    ...pressAt(CLICK_LIBRARY),
    ...pressAt(CLICK_INCLUDE),
    cursorFrame(CLICK_INCLUDE.x, CLICK_INCLUDE.y), // hold: watch the compact
    ...pressAt(CLICK_EXCLUDE),
    cursorFrame(CLICK_EXCLUDE.x, CLICK_EXCLUDE.y), // hold: let the refined grid breathe
    ...pressAt(CLICK_CLEAR),
    cursorFrame(CLICK_CLEAR.x, CLICK_CLEAR.y), // hold: watch the return wave
    ...pressAt(CLICK_LIBRARY),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
    cursorFrame(CURSOR_PARK.x, CURSOR_PARK.y),
  ],
  normaliseTimes(ORGANISE_DURATION_MS, [
    0,
    T.restEnd,
    T.openArrive,
    T.openPress,
    T.openRelease,
    T.includeArrive,
    T.includePress,
    T.includeRelease,
    T.watchCompact,
    T.excludeArrive,
    T.excludePress,
    T.excludeRelease,
    T.breathe,
    T.clearArrive,
    T.clearPress,
    T.clearRelease,
    T.watchWave,
    T.closeArrive,
    T.closePress,
    T.closeRelease,
    T.parked,
    ORGANISE_DURATION_MS,
  ]),
);

// −380 = panel width 360 + 20 slack so the float shadow can't peek while
// hidden; the slide itself mirrors the app's translateX(-100% → 0).
const drawer = holdTrack(
  [0, T.drawerOutStart, T.drawerOut, T.drawerInStart, T.drawerIn, ORGANISE_DURATION_MS],
  {
    hidden: visualFrame(`translate3d(${-(PANEL.w + 20)}px, 0px, 0px) scale(1)`, 1),
    shown: visualFrame(undefined, 1),
    easeIn: SETTLE_EASE,
    easeOut: SETTLE_EASE,
  },
);

const activeStateTimes = (pressRelease: number, liveMs: number) =>
  [0, pressRelease, pressRelease + liveMs, T.clearRelease + 50, T.clearRelease + 310, ORGANISE_DURATION_MS] as const;

const includeState = holdTrack(activeStateTimes(T.includeRelease, 140), {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const excludeState = holdTrack(activeStateTimes(T.excludeRelease, 140), {
  hidden: visualFrame(undefined, 0),
  shown: visualFrame(undefined, 1),
  easeIn: FADE_EASE,
  easeOut: FADE_EASE,
});

const includeChip = holdTrack(activeStateTimes(T.includeRelease, 260), {
  hidden: visualFrame("translate3d(0px, -6px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

const excludeChip = holdTrack(activeStateTimes(T.excludeRelease, 260), {
  hidden: visualFrame("translate3d(0px, -6px, 0px) scale(1)", 0),
  shown: visualFrame(undefined, 1),
  easeIn: SETTLE_EASE,
  easeOut: FADE_EASE,
});

/** Telegraph rings: pop onto the tiles a press has just doomed, then
 * fade with them as they depart — cause on the left, marked effect on
 * the right, one beat before the compact. */
const departureRing = (pressRelease: number) =>
  holdTrack(
    [0, pressRelease, pressRelease + 70, pressRelease + 280, pressRelease + 540, ORGANISE_DURATION_MS],
    {
      hidden: visualFrame("translate3d(0px, 0px, 0px) scale(0.85)", 0),
      shown: visualFrame(undefined, 1),
      easeIn: SETTLE_EASE,
      easeOut: FADE_EASE,
    },
  );

const includeRing = departureRing(T.includeRelease);
const excludeRing = departureRing(T.excludeRelease);

// Beat-two departures flash at their COMPACTED (post-include) cells,
// because that is where those tiles are sitting when the press lands.
const INCLUDE_RING_CELLS = [...INCLUDE_MISSES].map((i) => baseCell(i));
const EXCLUDE_RING_CELLS = [...EXCLUDE_HITS].map((i) =>
  survivorCell(i, AFTER_INCLUDE),
);

export const ORGANISE_TRACKS = {
  cursor,
  drawer,
  includeState,
  excludeState,
  includeChip,
  excludeChip,
  includeRing,
  excludeRing,
  ...Object.fromEntries(gridTracks.map((track, index) => [`tile-${index}`, track])),
} as const;

const BASE_TILES = Array.from({ length: TILE_COUNT }, (_, i) => baseCell(i));

export const ORGANISE_GEOMETRY: SceneGeometryManifest = {
  scene: "organise",
  bounds: {
    panel: PANEL,
    clear: CLEAR,
    includeToggle: INCLUDE_TOGGLE,
    excludeToggle: EXCLUDE_TOGGLE,
    includeChip: INCLUDE_CHIP,
    excludeChip: EXCLUDE_CHIP,
    ...Object.fromEntries(BASE_TILES.map((r, i) => [`tile-${i}`, r])),
  },
  clicks: [
    { label: "library", point: CLICK_LIBRARY, target: CHROME.leadingPill },
    { label: "include-toggle", point: CLICK_INCLUDE, target: INCLUDE_TOGGLE },
    { label: "exclude-toggle", point: CLICK_EXCLUDE, target: EXCLUDE_TOGGLE },
    { label: "clear", point: CLICK_CLEAR, target: CLEAR },
    { label: "library-close", point: CLICK_LIBRARY, target: CHROME.leadingPill },
  ],
  disjoint: {
    base: BASE_TILES,
    afterInclude: BASE_TILES.filter((_, i) => !AFTER_INCLUDE.has(i)).map(
      (_, j) => ORGANISE_GRID.cell(j % 3, Math.floor(j / 3)),
    ),
    afterExclude: BASE_TILES.filter((_, i) => !AFTER_EXCLUDE.has(i)).map(
      (_, j) => ORGANISE_GRID.cell(j % 3, Math.floor(j / 3)),
    ),
  },
};

const reducedKinds: readonly [StaticFrameKind, string][] = [
  ["organise-all", "Browse every tag as a folder"],
  ["organise-filters", "Combine must-have and must-not-have"],
  ["organise-refined", "Refine without moving originals"],
];

export const ORGANISE_REDUCED_FRAMES = reducedFrames(reducedKinds);

/** Absolute-position style for a rect inside the panel's own frame. */
const inPanel = (r: Rect) => ({
  left: r.x - PANEL.x,
  top: r.y - PANEL.y,
  width: r.w,
  height: r.h,
});

/** Absolute-position style for a rect inside another rect (toggle
 * buttons inside their filter row). */
const inRect = (r: Rect, outer: Rect) => ({
  left: r.x - outer.x,
  top: r.y - outer.y,
  width: r.w,
  height: r.h,
});

export function OrganiseScene({ animationLevel }: OnboardingSceneProps) {
  const motionOptions = { subtle: animationLevel === "subtle" };

  return (
    <DemoSceneRoot>
      <DemoAppChrome
        leading={
          <div className="grid size-full place-items-center rounded-[9px] border border-border bg-surface text-[10.5px] font-[600]">
            Library
          </div>
        }
      />
      <div className="absolute inset-x-0 bottom-0 top-[72px] bg-surface-sunken/35" />

      {/* Active-filter chips in the search bar — the panel's state echoed
          up top, exactly as the shipped SearchBar shows filter chips. */}
      <motion.div
        className="absolute z-30 flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-2"
        style={rectStyle(INCLUDE_CHIP)}
        animate={visualMotion(includeChip, ORGANISE_DURATION_MS, motionOptions)}
      >
        <Plus className="size-2.5 text-primary" strokeWidth={2.2} />
        <OnboardingSkeleton className="h-1.5 flex-1 rounded-full" />
      </motion.div>
      <motion.div
        className="absolute z-30 flex items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/10 px-2"
        style={rectStyle(EXCLUDE_CHIP)}
        animate={visualMotion(excludeChip, ORGANISE_DURATION_MS, motionOptions)}
      >
        <Minus className="size-2.5 text-destructive" strokeWidth={2.2} />
        <OnboardingSkeleton className="h-1.5 flex-1 rounded-full" />
      </motion.div>

      <div
        className="absolute grid w-[528px] grid-cols-3 gap-3"
        style={{ left: ORGANISE_GRID.originX, top: ORGANISE_GRID.originY }}
      >
        {gridTracks.map((track, index) => (
          <motion.div
            key={index}
            className="relative h-[102px]"
            animate={visualMotion(track, ORGANISE_DURATION_MS, motionOptions)}
          >
            <OnboardingSkeleton
              raised={index % 4 === 0}
              className="size-full rounded-[14px] border border-border/70"
            />
            {/* Tag swatch dots — the membership that motivates each beat:
                primary = carries the must-have tag (survives beat one),
                destructive = carries the must-not tag (departs beat two). */}
            <div className="absolute bottom-2 left-2 flex gap-1">
              {!INCLUDE_MISSES.has(index) && (
                <span className="size-2 rounded-full bg-primary/70" />
              )}
              {EXCLUDE_HITS.has(index) && (
                <span className="size-2 rounded-full bg-destructive/70" />
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Telegraph rings on the tiles each press just doomed. */}
      {INCLUDE_RING_CELLS.map((cell, index) => (
        <motion.div
          key={`include-ring-${index}`}
          className="absolute z-10 rounded-[14px] border-2 border-border-strong bg-foreground/5"
          style={rectStyle(cell)}
          animate={visualMotion(includeRing, ORGANISE_DURATION_MS, motionOptions)}
        />
      ))}
      {EXCLUDE_RING_CELLS.map((cell, index) => (
        <motion.div
          key={`exclude-ring-${index}`}
          className="absolute z-10 rounded-[14px] border-2 border-destructive/60 bg-destructive/10"
          style={rectStyle(cell)}
          animate={visualMotion(excludeRing, ORGANISE_DURATION_MS, motionOptions)}
        />
      ))}

      {/* The library panel — edge slide-out matching the shipped
          LibraryDrawer: flush left, floating below the header, rounded on
          the inner edge only, no scrim, grid fully visible beside it. */}
      <motion.aside
        className="absolute z-30 overflow-hidden rounded-r-2xl border border-l-0 border-border bg-card shadow-[var(--shadow-float)]"
        style={rectStyle(PANEL)}
        animate={visualMotion(drawer, ORGANISE_DURATION_MS, motionOptions)}
      >
        <div
          className="absolute inset-x-0 top-0 flex items-center gap-3 border-b border-border/70 px-5"
          style={{ height: PANEL_HEADER_H }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary">
            <LibraryBig className="size-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-[650] leading-[18px] tracking-[-0.025em]">
              Library
            </h3>
            <OnboardingSkeleton className="mt-1 h-1.5 w-16 rounded-full" />
          </div>
        </div>

        <p
          className="absolute text-[10px] font-[650] leading-[14px] text-muted-foreground"
          style={inPanel(FOLDERS_LABEL)}
        >
          Folders
        </p>
        <div
          className="absolute flex items-center justify-between rounded-[9px] bg-accent/60 px-3 text-[11px] font-[600]"
          style={inPanel(ALL_IMAGES)}
        >
          <span>All images</span>
          <OnboardingSkeleton className="h-2 w-7 rounded-full" />
        </div>
        {FOLDER_ROWS.map((row, index) => (
          <div
            key={`folder-${index}`}
            className="absolute flex items-center gap-3 rounded-[9px] border border-border px-3"
            style={inPanel(row)}
          >
            <OnboardingSkeleton className="size-4 rounded" />
            <OnboardingSkeleton className="h-2 flex-1 rounded-full" />
            <OnboardingSkeleton className="h-2 w-6 rounded-full" />
          </div>
        ))}
        <div className="absolute bg-border" style={inPanel(DIVIDER)} />
        <p
          className="absolute text-[10px] font-[650] leading-[22px] text-muted-foreground"
          style={inPanel(FILTER_HEAD)}
        >
          Filters
        </p>
        <div
          className="absolute grid place-items-center rounded-[7px] border border-border text-[10px] font-[650]"
          style={inPanel(CLEAR)}
        >
          Clear
        </div>
        {FILTER_ROWS.map((row, index) => {
          const swatchTint =
            index === 0
              ? "bg-primary/40"
              : index === 1
                ? "bg-destructive/40"
                : "";
          return (
            <div
              key={`filter-${index}`}
              className="absolute rounded-[9px] border border-border"
              style={inPanel(row)}
            >
              <div className="flex h-full items-center gap-3 pl-3 pr-[80px]">
                <OnboardingSkeleton className={`size-4 rounded ${swatchTint}`} />
                <OnboardingSkeleton className="h-2 flex-1 rounded-full" />
              </div>
              {([1, 0] as const).map((slot) => (
                <div
                  key={slot}
                  className="absolute grid place-items-center rounded-[8px] border border-border text-muted-foreground"
                  style={inRect(toggleRect(row, slot), row)}
                >
                  {slot === 1 ? (
                    <Plus className="size-3" strokeWidth={2} />
                  ) : (
                    <Minus className="size-3" strokeWidth={2} />
                  )}
                </div>
              ))}
              {index === 0 && (
                <motion.div
                  className="absolute grid place-items-center rounded-[8px] border border-primary/60 bg-primary/15"
                  style={inRect(INCLUDE_TOGGLE, row)}
                  animate={visualMotion(includeState, ORGANISE_DURATION_MS, motionOptions)}
                >
                  <Check className="size-3 text-primary" strokeWidth={2.4} />
                </motion.div>
              )}
              {index === 1 && (
                <motion.div
                  className="absolute grid place-items-center rounded-[8px] border border-destructive/60 bg-destructive/15"
                  style={inRect(EXCLUDE_TOGGLE, row)}
                  animate={visualMotion(excludeState, ORGANISE_DURATION_MS, motionOptions)}
                >
                  <Minus className="size-3 text-destructive" strokeWidth={2.4} />
                </motion.div>
              )}
            </div>
          );
        })}
      </motion.aside>

      <FakeCursor
        track={cursor}
        durationMs={ORGANISE_DURATION_MS}
        showHalo={animationLevel === "standard"}
      />
    </DemoSceneRoot>
  );
}
