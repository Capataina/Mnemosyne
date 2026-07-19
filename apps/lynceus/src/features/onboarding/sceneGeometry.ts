/**
 * Shared geometry for onboarding scenes — the single source of truth
 * every element rect, cursor waypoint, and move-delta derives from.
 *
 * The first build hand-typed coordinates in two parallel places (static
 * element styles and animation tracks) and aimed cursor clicks at
 * flex-positioned chrome whose x depends on font metrics. The result was
 * the live-pass failure class: halos off their buttons, tiles leaking
 * off the stage, "filtered" grids that shuffled instead of re-packing.
 * The rule now: layout is declared ONCE as rects here or in a scene's
 * GEOM block, and everything else — styles, telegraphs, cursor tracks,
 * translate/scale strings — is computed. sceneGeometry.test.ts holds the
 * machine-checked invariants (rects inside the stage, clicks inside
 * their targets, slot occupancy without collisions).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const STAGE = { w: 960, h: 600 } as const;

export const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x,
  y,
  w,
  h,
});

export const centre = (r: Rect): Point => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});

/** Inline style for absolutely positioning an element at a rect. */
export const rectStyle = (r: Rect) => ({
  left: r.x,
  top: r.y,
  width: r.w,
  height: r.h,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Transform moving an element FROM its base rect TO a target position
 * (same size), as the app's translate3d idiom. */
export const moveTo = (from: Rect, to: Rect): string =>
  `translate3d(${round2(to.x - from.x)}px, ${round2(to.y - from.y)}px, 0px) scale(1)`;

/** Transform mapping an origin-top-left element FROM its base rect ONTO
 * a target rect (position AND size). */
export const mapTo = (from: Rect, to: Rect): string =>
  `translate3d(${round2(to.x - from.x)}px, ${round2(to.y - from.y)}px, 0px) scale(${round2(
    to.w / from.w,
  )}, ${round2(to.h / from.h)})`;

export interface GridSpec {
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
  gapX: number;
  gapY: number;
}

export interface Grid extends GridSpec {
  cell: (col: number, row: number) => Rect;
  span: (col: number, row: number, cols: number, rows: number) => Rect;
}

export function makeGrid(spec: GridSpec): Grid {
  const cell = (col: number, row: number): Rect =>
    rect(
      spec.originX + col * (spec.cellW + spec.gapX),
      spec.originY + row * (spec.cellH + spec.gapY),
      spec.cellW,
      spec.cellH,
    );
  const span = (col: number, row: number, cols: number, rows: number): Rect => {
    const first = cell(col, row);
    return rect(
      first.x,
      first.y,
      cols * spec.cellW + (cols - 1) * spec.gapX,
      rows * spec.cellH + (rows - 1) * spec.gapY,
    );
  };
  return { ...spec, cell, span };
}

/**
 * The demo chrome's clickable targets. DemoAppChrome positions these
 * elements ABSOLUTELY from these exact rects — never flex — because
 * scenes aim accents and cursor clicks at them. Header is 72px tall;
 * controls are 36px, vertically centred at y=18.
 */
export const CHROME = {
  header: rect(0, 0, STAGE.w, 72),
  /** Optional leading slot (e.g. the Library pill in the Organise
   * scene) — first element after the header's 20px padding. */
  leadingPill: rect(20, 20, 76, 32),
  searchBar: rect(258, 18, 360, 36),
  addFolder: rect(776, 18, 120, 36),
  settings: rect(904, 18, 36, 36),
} as const;

/** A cursor click and the rect it must land inside (used by the
 * geometry invariant tests). */
export interface ClickTarget {
  label: string;
  point: Point;
  target: Rect;
}

/** Manifest each scene exports so sceneGeometry.test.ts can verify its
 * maths without rendering anything. */
export interface SceneGeometryManifest {
  scene: string;
  /** Rects that must sit fully inside the stage. */
  bounds: Record<string, Rect>;
  /** Clicks that must land inside their declared targets. */
  clicks: ClickTarget[];
  /** Optional groups of rects that must be pairwise non-overlapping
   * (e.g. the tiles of one settled layout beat). */
  disjoint?: Record<string, Rect[]>;
}

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const inside = (r: Rect, outer: { w: number; h: number }): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= outer.w && r.y + r.h <= outer.h;

export const containsPoint = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
