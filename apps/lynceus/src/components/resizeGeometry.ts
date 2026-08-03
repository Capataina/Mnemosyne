import type { MasonryGestureFootprint } from "./masonryPacking";

export type ResizeCorner = "tl" | "tr" | "bl" | "br";

export function isLeftCorner(corner: ResizeCorner): boolean {
  return corner === "tl" || corner === "bl";
}

export function isTopCorner(corner: ResizeCorner): boolean {
  return corner === "tl" || corner === "tr";
}

/** Resolve the physical left column while preserving the opposite horizontal
 * edge: right grips keep left fixed; left grips keep right fixed. */
export function anchorStartColFor(
  corner: ResizeCorner,
  startCol: number,
  baseSpan: number,
  span: number,
): number {
  return isLeftCorner(corner) ? startCol + baseSpan - span : startCol;
}

export interface ResizeBaseGeometry {
  id: number;
  startCol: number;
  baseSpan: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizePreview {
  footprint: MasonryGestureFootprint;
  x: number;
  y: number;
  width: number;
  height: number;
  span: number;
}

export interface ResizeVisual {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pure corner geometry used by the hook and regression tests. The opposite
 * corner is invariant on both axes. Top grips genuinely move the top upward;
 * no CSS-only offset is involved. */
export function resizePreviewForSpan(
  corner: ResizeCorner,
  base: ResizeBaseGeometry,
  requestedSpan: number,
  columnWidth: number,
  columnGap: number,
  columnCount: number,
): ResizePreview {
  const horizontalMax = isLeftCorner(corner)
    ? base.startCol + base.baseSpan
    : columnCount - base.startCol;
  let span = Math.max(1, Math.min(Math.round(requestedSpan), horizontalMax));
  const aspect = base.width > 0 ? base.height / base.width : 1;
  const widthFor = (value: number) =>
    columnWidth * value + columnGap * (value - 1);
  const heightFor = (value: number) => widthFor(value) * aspect;

  // A top grip cannot keep the bottom fixed while growing through y=0.
  // Clamp to the largest whole span that still fits above the fixed bottom.
  if (isTopCorner(corner)) {
    const fixedBottom = base.y + base.height;
    while (span > 1 && heightFor(span) > fixedBottom) span -= 1;
  }

  const width = widthFor(span);
  const height = heightFor(span);
  const startCol = anchorStartColFor(
    corner,
    base.startCol,
    base.baseSpan,
    span,
  );
  const x = startCol * (columnWidth + columnGap);
  const y = isTopCorner(corner)
    ? base.y + base.height - height
    : base.y;

  return {
    footprint: {
      id: base.id,
      span,
      startCol,
      top: Math.max(0, y),
    },
    x,
    y: Math.max(0, y),
    width,
    height,
    span,
  };
}

/** Exact active-tile rectangle for a pointer delta. Unlike the footprint,
 * this never rounds to a column. It is the cosmetic ghost the user directly
 * manipulates while neighbours reserve the nearest whole-span rectangle. */
export function resizeVisualForPointer(
  corner: ResizeCorner,
  base: ResizeBaseGeometry,
  deltaX: number,
  deltaY: number,
  columnWidth: number,
  columnGap: number,
  columnCount: number,
): ResizeVisual {
  const signedX = deltaX * (isLeftCorner(corner) ? -1 : 1);
  const signedY = deltaY * (isTopCorner(corner) ? -1 : 1);
  const aspect = base.width > 0 ? base.height / base.width : 1;
  const widthFromX = base.width + signedX;
  const widthFromY = base.width + signedY / Math.max(aspect, 1e-9);
  const desiredWidth =
    Math.abs(widthFromX - base.width) >= Math.abs(widthFromY - base.width)
      ? widthFromX
      : widthFromY;
  const horizontalSpan = isLeftCorner(corner)
    ? base.startCol + base.baseSpan
    : columnCount - base.startCol;
  const horizontalMax =
    columnWidth * horizontalSpan + columnGap * (horizontalSpan - 1);
  const verticalMax = isTopCorner(corner)
    ? (base.y + base.height) / Math.max(aspect, 1e-9)
    : Infinity;
  const maxWidth = Math.max(
    columnWidth,
    Math.min(horizontalMax, verticalMax),
  );
  const width = Math.max(columnWidth, Math.min(desiredWidth, maxWidth));
  const height = width * aspect;
  return {
    x: isLeftCorner(corner)
      ? base.x + base.width - width
      : base.x,
    y: isTopCorner(corner)
      ? Math.max(0, base.y + base.height - height)
      : base.y,
    width,
    height,
  };
}
