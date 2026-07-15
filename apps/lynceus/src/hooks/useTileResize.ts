import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MasonryItemPlacement } from "../components/masonryPacking";

/** Which corner of a tile a resize drag started from. */
export type ResizeCorner = "tl" | "tr" | "bl" | "br";

function isLeftCorner(c: ResizeCorner): boolean {
  return c === "tl" || c === "bl";
}
/** Left corners invert the drag-delta sign so dragging "away from the
 *  tile" always grows it, regardless of which corner was grabbed. */
function signForCorner(c: ResizeCorner): 1 | -1 {
  return isLeftCorner(c) ? -1 : 1;
}

export interface ResizeState {
  id: number;
  corner: ResizeCorner;
  /** Rounded span — the footprint the packer reflows the grid around. */
  previewSpan: number;
  /** Continuous width in px — how wide the active tile actually renders,
   *  so the resize follows the pointer smoothly. */
  previewPx: number;
  leftAnchored: boolean;
}

interface UseTileResizeInput {
  columnWidthRef: RefObject<number>;
  columnCountRef: RefObject<number>;
  columnGap: number;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  onResizeCommit?: (id: number, colSpan: number | null) => void;
  /** Called on release so the click that follows a drag doesn't select. */
  suppressClick: () => void;
}

/**
 * Drag-to-resize as a smooth pixel gesture that snaps to a whole column
 * span only on release.
 *
 * The old model set the span to `round(dx / columnWidth)` on every
 * pointer move, so nothing happened until the pointer crossed a full
 * column boundary and then the tile jumped a whole column — the "only
 * resizes when I cross the next column, looks weird" bug. Here the tile
 * renders at a continuous `previewPx` that tracks the pointer 1:1, while
 * `previewSpan` (the rounded footprint) is what the packer reflows the
 * rest of the grid around. On release we commit `previewSpan`, and the
 * visual width snaps to match its footprint.
 */
export function useTileResize(input: UseTileResizeInput) {
  const { columnWidthRef, columnCountRef, columnGap, placementsRef } = input;

  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  // Base captured at pointer-down; live layout read from refs so the
  // move handler never needs to re-subscribe.
  const baseRef = useRef<{
    id: number;
    corner: ResizeCorner;
    startX: number;
    basePx: number;
  } | null>(null);
  const stateRef = useRef<ResizeState | null>(null);
  stateRef.current = resizeState;
  // Callbacks via refs so the effect isn't torn down when the parent
  // re-renders with fresh callback identities mid-drag.
  const commitRef = useRef(input.onResizeCommit);
  commitRef.current = input.onResizeCommit;
  const suppressRef = useRef(input.suppressClick);
  suppressRef.current = input.suppressClick;

  const onResizeHandlePointerDown = useCallback(
    (id: number, corner: ResizeCorner, e: React.PointerEvent<HTMLDivElement>) => {
      const placement = placementsRef.current?.find(
        (p) => p.itemData.id === id,
      );
      const basePx = placement?.width ?? columnWidthRef.current ?? 1;
      const baseSpan = placement?.colSpan ?? 1;
      baseRef.current = { id, corner, startX: e.clientX, basePx };
      setResizeState({
        id,
        corner,
        previewSpan: baseSpan,
        previewPx: basePx,
        leftAnchored: isLeftCorner(corner),
      });
    },
    [placementsRef, columnWidthRef],
  );

  const resizingId = resizeState?.id ?? null;

  useEffect(() => {
    if (resizingId === null) return;

    const handleMove = (e: PointerEvent) => {
      const base = baseRef.current;
      if (!base) return;
      const colWidth = columnWidthRef.current || 1;
      const colCount = Math.max(1, columnCountRef.current || 1);
      const fullWidth = colWidth * colCount + columnGap * (colCount - 1);
      const dx = (e.clientX - base.startX) * signForCorner(base.corner);
      const previewPx = Math.max(colWidth, Math.min(base.basePx + dx, fullWidth));
      const previewSpan = Math.max(
        1,
        Math.min(Math.round((previewPx + columnGap) / (colWidth + columnGap)), colCount),
      );
      setResizeState((prev) =>
        prev ? { ...prev, previewPx, previewSpan } : prev,
      );
    };

    const handleUp = () => {
      const s = stateRef.current;
      if (s) {
        commitRef.current?.(s.id, s.previewSpan === 1 ? null : s.previewSpan);
        // The click that naturally follows this pointerup must not reach
        // the tile's onClick (which would select the image).
        suppressRef.current();
      }
      baseRef.current = null;
      setResizeState(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [resizingId, columnWidthRef, columnCountRef, columnGap]);

  return { resizeState, onResizeHandlePointerDown };
}
