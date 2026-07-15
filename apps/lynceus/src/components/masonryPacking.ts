import type { ImageItem } from "../types";

/**
 * Pure layout calculation for the Pinterest-style masonry grid.
 *
 * Extracted out of Masonry.tsx so it's unit-testable without DOM
 * mounting. The component reads container width via a ref and feeds
 * it in here; tests provide deterministic widths and item shapes.
 *
 * Algorithm:
 *   1. Determine column count from container width / minItemWidth.
 *      An explicit override beats auto.
 *   2. If a hero item is selected, place it first spanning up to 3
 *      columns from the top-left.
 *   3. For every other item, find the window of `colSpan` adjacent
 *      columns whose current max height is smallest, place the item
 *      there flush against that max (so every spanned column's top
 *      edge lines up), and scale height to preserve aspect ratio at
 *      the spanned width. `colSpan` defaults to 1, which degenerates
 *      to the original shortest-single-column search.
 *
 * Returns the placed items plus the total grid height.
 */

export interface MasonryItemPlacement {
  itemData: ImageItem;
  x: number;
  y: number;
  width: number;
  /** Rendered height in pixels (aspect-ratio scaled to placed width). */
  height: number;
  isSelected: boolean;
  /** Number of columns this placement actually spans (1 = default). */
  colSpan: number;
}

export interface MasonryLayoutInput {
  items: ImageItem[];
  selectedItem?: ImageItem | null;
  containerWidth: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  /** 0 = auto (computed). 1..12 forces. */
  columnCountOverride?: number;
  /** Multiplier on minItemWidth in auto mode. Default 1.0. */
  tileScale?: number;
  /**
   * Live drag-resize preview: item id → column span, consulted ahead
   * of `itemData.manualColSpan`. Lets Masonry.tsx re-flow the grid on
   * every pointer-move during an active resize without waiting for
   * the persisted value to round-trip through the backend.
   */
  spanOverrides?: Record<number, number>;
}

export interface MasonryLayoutOutput {
  placements: MasonryItemPlacement[];
  height: number;
  columnCount: number;
  /** Pixel width of a single column — needed by the resize handle to
   *  convert a pointer-drag delta into a column-span delta. */
  columnWidth: number;
}

export function computeMasonryLayout(
  input: MasonryLayoutInput,
): MasonryLayoutOutput {
  const {
    items,
    selectedItem,
    containerWidth,
    minItemWidth,
    columnGap,
    verticalGap,
    columnCountOverride,
    tileScale = 1.0,
    spanOverrides,
  } = input;

  if (containerWidth <= 0) {
    return { placements: [], height: 0, columnCount: 0, columnWidth: 0 };
  }

  // Column count derivation: explicit override beats auto. Auto uses
  // tile-scaled minimum width. We cap at 12 to prevent absurd values.
  const effectiveMin = minItemWidth * tileScale;
  const autoCount = Math.max(1, Math.floor(containerWidth / effectiveMin));
  const colCount =
    columnCountOverride && columnCountOverride > 0
      ? Math.min(columnCountOverride, 12)
      : autoCount;

  const columnWidth =
    (containerWidth - (colCount - 1) * columnGap) / colCount;
  const placements: MasonryItemPlacement[] = [];
  const colHeights: number[] = new Array(colCount).fill(0);

  // Hero placement: selected item spans up to 3 columns at the top.
  if (selectedItem) {
    const selectedCols = Math.min(colCount, 3);
    const selectedWidth =
      columnWidth * selectedCols + columnGap * (selectedCols - 1);
    const ratio = selectedWidth / selectedItem.width;
    const selectedHeight = selectedItem.height * ratio;

    placements.push({
      itemData: selectedItem,
      x: 0,
      y: 0,
      width: selectedWidth,
      height: selectedHeight,
      isSelected: true,
      colSpan: selectedCols,
    });

    for (let i = 0; i < selectedCols; i++) {
      colHeights[i] = selectedHeight + verticalGap;
    }
  }

  // Place remaining items. For a single-column item this is the
  // original shortest-column search; for a spanned item it's the
  // same search widened to a `span`-column sliding window, placed
  // flush against the tallest column in that window so every spanned
  // column's top edge lines up (no jagged mid-tile offsets).
  for (const img of items) {
    if (selectedItem && img.id === selectedItem.id) continue;

    const requestedSpan = spanOverrides?.[img.id] ?? img.manualColSpan ?? 1;
    const span = Math.max(1, Math.min(requestedSpan, colCount));

    let bestStart = 0;
    let bestMax = Infinity;
    for (let start = 0; start <= colCount - span; start++) {
      let windowMax = colHeights[start];
      for (let k = start + 1; k < start + span; k++) {
        windowMax = Math.max(windowMax, colHeights[k]);
      }
      if (windowMax < bestMax) {
        bestMax = windowMax;
        bestStart = start;
      }
    }

    const placedWidth = columnWidth * span + columnGap * (span - 1);
    const ratio = placedWidth / img.width;
    const itemHeight = img.height * ratio;
    placements.push({
      itemData: img,
      x: bestStart * (columnWidth + columnGap),
      y: bestMax,
      width: placedWidth,
      height: itemHeight,
      isSelected: false,
      colSpan: span,
    });
    for (let k = bestStart; k < bestStart + span; k++) {
      colHeights[k] = bestMax + itemHeight + verticalGap;
    }
  }

  const height = colHeights.length > 0 ? Math.max(...colHeights, 0) : 0;
  return { placements, height, columnCount: colCount, columnWidth };
}
