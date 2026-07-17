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

/**
 * The column the packer should pin the tile's left edge to for a given
 * span, given the corner grabbed and the footprint at grab. A right-corner
 * drag keeps the original left edge (`startCol`) and grows rightward; a
 * left-corner drag keeps the original right edge (`startCol + baseSpan`) so
 * the left edge walks leftward as the tile grows. The packer clamps the
 * result into `[0, colCount - span]`.
 */
export function anchorStartColFor(
  corner: ResizeCorner,
  startCol: number,
  baseSpan: number,
  span: number,
): number {
  return isLeftCorner(corner) ? startCol + baseSpan - span : startCol;
}

export interface ResizeState {
  id: number;
  corner: ResizeCorner;
  /** Span at pointer-down, used to avoid a no-op pack at gesture start. */
  baseSpan: number;
  /** Rounded span - the footprint the packer reflows the grid around. */
  previewSpan: number;
  leftAnchored: boolean;
  /**
   * Column the packer should pin the tile's left edge to for the current
   * `previewSpan`, so a widening tile grows in place instead of wrapping to
   * a new row. Right-corner drags hold the tile's original start column;
   * left-corner drags hold its right edge, so the start walks left as it
   * grows. The packer clamps this into range.
   */
  anchorStartCol: number;
}

interface UseTileResizeInput {
  columnWidthRef: RefObject<number>;
  columnCountRef: RefObject<number>;
  columnGap: number;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  placementByIdRef: RefObject<Map<number, MasonryItemPlacement>>;
  tileElementsRef: RefObject<Map<number, HTMLElement>>;
  onResizeCommit?: (id: number, colSpan: number | null) => void;
  /** Called on release so the click that follows a drag doesn't select. */
  suppressClick: () => void;
}

interface LiveResize {
  id: number;
  previewPx: number;
  previewSpan: number;
}

/**
 * Drag-to-resize as a smooth pixel gesture that snaps to a whole column
 * span only on release.
 *
 * Continuous pointer positions deliberately never enter React state. Each
 * pointermove only stores the latest x coordinate and schedules at most one
 * requestAnimationFrame. That frame writes width + translate3d to the one
 * active tile wrapper. React sees a state update only when the rounded span
 * crosses a column boundary, which is the only moment the rest of the grid's
 * footprint actually changes and an O(n) pack is warranted.
 */
export function useTileResize(input: UseTileResizeInput) {
  const {
    columnWidthRef,
    columnCountRef,
    columnGap,
    placementsRef,
    placementByIdRef,
    tileElementsRef,
  } = input;

  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  // Geometry captured at pointer-down. Live placements are read from the
  // id map after discrete packs so rebasing the active wrapper stays O(1).
  const baseRef = useRef<{
    id: number;
    corner: ResizeCorner;
    startX: number;
    basePx: number;
    /** The tile's start column at grab, derived from its packed x. */
    startCol: number;
    /** The tile's span at grab — the right-edge reference for left grips. */
    baseSpan: number;
  } | null>(null);
  const liveRef = useRef<LiveResize | null>(null);
  const pendingClientXRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Callbacks via refs so a parent render cannot tear down the active
  // window listeners or make pointerup commit a stale callback.
  const commitRef = useRef(input.onResizeCommit);
  commitRef.current = input.onResizeCommit;
  const suppressRef = useRef(input.suppressClick);
  suppressRef.current = input.suppressClick;

  const writeTileVisual = useCallback(
    (id: number, previewPx: number) => {
      const node = tileElementsRef.current.get(id);
      const placement = placementByIdRef.current.get(id);
      const base = baseRef.current;
      if (!node || !placement || !base) return;

      // The packed anchor owns the rounded footprint. The child wrapper owns
      // only the continuous difference. A left grip translates by that
      // difference so the packed footprint's right edge remains anchored.
      const offsetX = isLeftCorner(base.corner)
        ? placement.width - previewPx
        : 0;
      // Upward-growth illusion for the two TOP corners. Height is
      // aspect-derived from width, so widening the tile makes it taller —
      // by default the top edge stays pinned and the tile grows DOWNWARD,
      // which feels wrong when you grabbed a top corner. Translating up by
      // the height delta pins the BOTTOM edge instead, so the grabbed top
      // corner appears to rise: a top-corner drag now resizes from that
      // corner like any window/image handle. This is a gesture-time visual
      // only — masonry is top-down packed, so on release the tile settles to
      // its real packed row (the framer layout spring smooths the drop). The
      // horizontal axis stays real (offsetX + the committed re-anchor).
      const isTopCorner = base.corner === "tl" || base.corner === "tr";
      const aspect =
        placement.width > 0 ? placement.height / placement.width : 0;
      const offsetY = isTopCorner ? -(previewPx - placement.width) * aspect : 0;
      node.style.width = `${previewPx}px`;
      node.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
    },
    [placementByIdRef, tileElementsRef],
  );

  const applyPointerX = useCallback(
    (clientX: number) => {
      const base = baseRef.current;
      if (!base) return;

      const colWidth = columnWidthRef.current || 1;
      const colCount = Math.max(1, columnCountRef.current || 1);
      const fullWidth = colWidth * colCount + columnGap * (colCount - 1);
      const dx = (clientX - base.startX) * signForCorner(base.corner);
      const previewPx = Math.max(
        colWidth,
        Math.min(base.basePx + dx, fullWidth),
      );
      const previewSpan = Math.max(
        1,
        Math.min(
          Math.round((previewPx + columnGap) / (colWidth + columnGap)),
          colCount,
        ),
      );

      const previousSpan = liveRef.current?.previewSpan;
      liveRef.current = { id: base.id, previewPx, previewSpan };
      writeTileVisual(base.id, previewPx);

      // This is the sole React update in the move path. It happens only at a
      // rounded column boundary, not for every physical pointer pixel. The
      // re-anchor column is recomputed here so the reflow pins the grown
      // tile in place rather than letting the packer relocate it.
      if (previewSpan !== previousSpan) {
        const anchorStartCol = anchorStartColFor(
          base.corner,
          base.startCol,
          base.baseSpan,
          previewSpan,
        );
        setResizeState((previous) =>
          previous
            ? { ...previous, previewSpan, anchorStartCol }
            : previous,
        );
      }
    },
    [columnCountRef, columnGap, columnWidthRef, writeTileVisual],
  );

  const cancelScheduledFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const schedulePointerX = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX;
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const pendingX = pendingClientXRef.current;
        pendingClientXRef.current = null;
        if (pendingX !== null) applyPointerX(pendingX);
      });
    },
    [applyPointerX],
  );

  const flushPointerX = useCallback(
    (clientX: number) => {
      cancelScheduledFrame();
      pendingClientXRef.current = null;
      applyPointerX(clientX);
    },
    [applyPointerX, cancelScheduledFrame],
  );

  const clearTileVisual = useCallback(
    (id: number) => {
      const node = tileElementsRef.current.get(id);
      if (!node) return;
      node.style.width = "";
      node.style.transform = "";
      node.style.willChange = "";
    },
    [tileElementsRef],
  );

  const onResizeHandlePointerDown = useCallback(
    (
      id: number,
      corner: ResizeCorner,
      e: React.PointerEvent<HTMLDivElement>,
    ) => {
      const placement =
        placementByIdRef.current.get(id) ??
        placementsRef.current.find((candidate) => candidate.itemData.id === id);
      const basePx = placement?.width ?? columnWidthRef.current ?? 1;
      const baseSpan = placement?.colSpan ?? 1;
      // Recover the tile's start column from its packed x. The stride is one
      // column plus the gap; rounding absorbs sub-pixel drift.
      const colStride = (columnWidthRef.current ?? 0) + columnGap;
      const startCol =
        colStride > 0 && placement
          ? Math.round(placement.x / colStride)
          : 0;
      baseRef.current = { id, corner, startX: e.clientX, basePx, startCol, baseSpan };
      liveRef.current = { id, previewPx: basePx, previewSpan: baseSpan };

      const node = tileElementsRef.current.get(id);
      if (node) node.style.willChange = "width, transform";

      setResizeState({
        id,
        corner,
        baseSpan,
        previewSpan: baseSpan,
        leftAnchored: isLeftCorner(corner),
        anchorStartCol: startCol,
      });
    },
    [columnGap, columnWidthRef, placementByIdRef, placementsRef, tileElementsRef],
  );

  const resizingId = resizeState?.id ?? null;

  useEffect(() => {
    if (resizingId === null) return;

    const handleMove = (e: PointerEvent) => schedulePointerX(e.clientX);

    const handleUp = (e: PointerEvent) => {
      // Pointerup may beat the scheduled frame. Flush its exact coordinate so
      // the committed span and final visual both reflect the release point.
      flushPointerX(e.clientX);
      const live = liveRef.current;
      if (live) {
        commitRef.current?.(
          live.id,
          live.previewSpan === 1 ? null : live.previewSpan,
        );
        // The click that naturally follows this pointerup must not reach the
        // tile's onClick (which would select the image).
        suppressRef.current();
        clearTileVisual(live.id);
      }
      baseRef.current = null;
      liveRef.current = null;
      setResizeState(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      cancelScheduledFrame();
      pendingClientXRef.current = null;
    };
  }, [
    cancelScheduledFrame,
    clearTileVisual,
    flushPointerX,
    resizingId,
    schedulePointerX,
  ]);

  // Called by the shell after a discrete pack. It adjusts the child wrapper
  // against its new packed anchor before paint, without changing React state.
  const syncVisual = useCallback(() => {
    const live = liveRef.current;
    if (live) writeTileVisual(live.id, live.previewPx);
  }, [writeTileVisual]);

  return { resizeState, onResizeHandlePointerDown, syncVisual };
}
