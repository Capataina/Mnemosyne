import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  MasonryGestureFootprint,
  MasonryItemPlacement,
} from "../components/masonryPacking";

export type ResizeCorner = "tl" | "tr" | "bl" | "br";
const GESTURE_SETTLE_MS = 400;

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
      edge: 0,
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

export interface ResizeState extends ResizePreview {
  id: number;
  corner: ResizeCorner;
  baseSpan: number;
  phase: "active" | "committing" | "settling";
}

interface UseTileResizeInput {
  enabled: boolean;
  columnWidthRef: RefObject<number>;
  columnCountRef: RefObject<number>;
  columnGap: number;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  placementByIdRef: RefObject<Map<number, MasonryItemPlacement>>;
  tileElementsRef: RefObject<Map<number, HTMLElement>>;
  /** Resolves only after the durable/optimistic span is authoritative. The
   * local footprint remains live until then, eliminating the 1×1 gap render. */
  onResizeCommit?: (
    id: number,
    colSpan: number | null,
  ) => void | Promise<unknown>;
  suppressClick: () => void;
}

interface ResizePointerBase extends ResizeBaseGeometry {
  corner: ResizeCorner;
  pointerX: number;
  pointerY: number;
}

/** Four-corner, opposite-corner-fixed resize transaction. The footprint is
 * discrete structural geometry for neighbours; one imperative inner wrapper
 * renders the exact pixel preview without putting pointer values in React. */
export function useTileResize(input: UseTileResizeInput) {
  const {
    enabled,
    columnWidthRef,
    columnCountRef,
    columnGap,
    placementsRef,
    placementByIdRef,
    tileElementsRef,
  } = input;
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  const baseRef = useRef<ResizePointerBase | null>(null);
  const liveRef = useRef<ResizeState | null>(null);
  const liveVisualRef = useRef<ResizeVisual | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const settlePendingRef = useRef(false);
  const settleReadyRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const commitRef = useRef(input.onResizeCommit);
  commitRef.current = input.onResizeCommit;
  const suppressRef = useRef(input.suppressClick);
  suppressRef.current = input.suppressClick;

  const writeTileVisual = useCallback(
    (id: number, visual: ResizeVisual) => {
      const node = tileElementsRef.current.get(id);
      const placement = placementByIdRef.current.get(id);
      if (!node || !placement) return;
      node.style.transition = "none";
      node.style.willChange = "transform, width, height";
      node.style.width = `${visual.width}px`;
      node.style.height = `${visual.height}px`;
      node.style.transform = `translate3d(${visual.x - placement.x}px, ${
        visual.y - placement.y
      }px, 0)`;
    },
    [placementByIdRef, tileElementsRef],
  );

  const clearTileVisual = useCallback(
    (id: number) => {
      const node = tileElementsRef.current.get(id);
      if (!node) return;
      node.style.transition = "";
      node.style.width = "";
      node.style.height = "";
      node.style.transform = "";
      node.style.willChange = "";
    },
    [tileElementsRef],
  );

  const applyPointer = useCallback(
    (pointer: { x: number; y: number }): ResizeState | null => {
      const base = baseRef.current;
      const columnWidth = columnWidthRef.current;
      const columnCount = columnCountRef.current;
      if (!base || columnWidth <= 0 || columnCount <= 0) return null;

      const visual = resizeVisualForPointer(
        base.corner,
        base,
        pointer.x - base.pointerX,
        pointer.y - base.pointerY,
        columnWidth,
        columnGap,
        columnCount,
      );
      const requestedSpan = Math.max(
        1,
        Math.round(
          (visual.width + columnGap) /
            (columnWidth + columnGap),
        ),
      );
      const preview = resizePreviewForSpan(
        base.corner,
        base,
        requestedSpan,
        columnWidth,
        columnGap,
        columnCount,
      );
      const next: ResizeState = {
        ...preview,
        id: base.id,
        corner: base.corner,
        baseSpan: base.baseSpan,
        phase: "active",
      };
      liveRef.current = next;
      liveVisualRef.current = visual;
      writeTileVisual(base.id, visual);
      setResizeState((previous) =>
        previous &&
        previous.span === next.span &&
        previous.footprint.startCol === next.footprint.startCol &&
        previous.footprint.top === next.footprint.top &&
        previous.phase === next.phase
          ? previous
          : next,
      );
      return next;
    },
    [
      columnCountRef,
      columnGap,
      columnWidthRef,
      writeTileVisual,
    ],
  );

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const schedulePointer = useCallback(
    (pointer: { x: number; y: number }) => {
      pendingPointerRef.current = pointer;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingPointerRef.current;
        pendingPointerRef.current = null;
        if (pending) applyPointer(pending);
      });
    },
    [applyPointer],
  );

  const flushPointer = useCallback(
    (pointer: { x: number; y: number }) => {
      cancelFrame();
      pendingPointerRef.current = null;
      return applyPointer(pointer);
    },
    [applyPointer, cancelFrame],
  );

  const cancelResize = useCallback(
    (sequence: number) => {
      if (sequence !== sequenceRef.current) return;
      const id = baseRef.current?.id;
      if (id != null) clearTileVisual(id);
      settlePendingRef.current = false;
      settleReadyRef.current = false;
      baseRef.current = null;
      liveRef.current = null;
      liveVisualRef.current = null;
      pendingPointerRef.current = null;
      setResizeState(null);
    },
    [clearTileVisual],
  );

  const beginSettling = useCallback((sequence: number) => {
    if (sequence !== sequenceRef.current) return;
    const live = liveRef.current;
    if (!live) return;
    const settling: ResizeState = { ...live, phase: "settling" };
    liveRef.current = settling;
    settlePendingRef.current = true;
    settleReadyRef.current = false;
    // Keep the active id and ghost alive, but stop publishing its structural
    // footprint. This is the exact edge that requests the dense release pack.
    setResizeState(settling);
  }, []);

  // Selection/search can disable gestures independently of the pointer
  // lifecycle. If that view gate closes mid-resize, cancel immediately so a
  // stale footprint can never coexist with (and displace) the hero.
  useEffect(() => {
    if (enabled || !baseRef.current) return;
    const sequence = ++sequenceRef.current;
    cancelFrame();
    cancelResize(sequence);
  }, [cancelFrame, cancelResize, enabled]);

  const onResizeHandlePointerDown = useCallback(
    (
      id: number,
      corner: ResizeCorner,
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      if (!enabled || baseRef.current || settlePendingRef.current) return;
      const placement =
        placementByIdRef.current.get(id) ??
        placementsRef.current.find((candidate) => candidate.itemData.id === id);
      const columnWidth = columnWidthRef.current;
      const columnCount = columnCountRef.current;
      if (
        !placement ||
        placement.isSelected ||
        columnWidth <= 0 ||
        columnCount <= 0
      ) {
        return;
      }
      const stride = columnWidth + columnGap;
      const startCol = Math.round(placement.x / stride);
      const base: ResizePointerBase = {
        id,
        corner,
        pointerX: event.clientX,
        pointerY: event.clientY,
        startCol,
        baseSpan: placement.colSpan,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      };
      baseRef.current = base;
      const initial = resizePreviewForSpan(
        corner,
        base,
        base.baseSpan,
        columnWidth,
        columnGap,
        columnCount,
      );
      const next: ResizeState = {
        ...initial,
        id,
        corner,
        baseSpan: base.baseSpan,
        phase: "active",
      };
      liveRef.current = next;
      liveVisualRef.current = {
        x: base.x,
        y: base.y,
        width: base.width,
        height: base.height,
      };
      const node = tileElementsRef.current.get(id);
      if (node) node.style.willChange = "transform, width, height";
      setResizeState(next);
    },
    [
      enabled,
      columnCountRef,
      columnGap,
      columnWidthRef,
      placementByIdRef,
      placementsRef,
      tileElementsRef,
    ],
  );

  const resizingId = resizeState?.id ?? null;
  useEffect(() => {
    if (resizingId === null) return;

    const handleMove = (event: PointerEvent) => {
      if (liveRef.current?.phase !== "active") return;
      schedulePointer({ x: event.clientX, y: event.clientY });
    };

    const handleUp = (event: PointerEvent) => {
      const live =
        flushPointer({ x: event.clientX, y: event.clientY }) ?? liveRef.current;
      if (!live) return;
      const sequence = ++sequenceRef.current;
      const committing: ResizeState = { ...live, phase: "committing" };
      liveRef.current = committing;
      setResizeState(committing);
      suppressRef.current();

      let result: void | Promise<unknown>;
      try {
        result = commitRef.current?.(
          live.id,
          live.span === 1 ? null : live.span,
        );
      } catch {
        cancelResize(sequence);
        return;
      }
      void Promise.resolve(result)
        .catch(() => undefined)
        .finally(() => beginSettling(sequence));
    };

    const handleCancel = () => {
      const sequence = ++sequenceRef.current;
      cancelFrame();
      cancelResize(sequence);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointercancel", handleCancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      cancelFrame();
      pendingPointerRef.current = null;
    };
  }, [
    beginSettling,
    cancelFrame,
    cancelResize,
    flushPointer,
    resizingId,
    schedulePointer,
  ]);

  const onGestureSettled = useCallback(() => {
    if (settlePendingRef.current) settleReadyRef.current = true;
  }, []);

  const syncVisual = useCallback(() => {
    const base = baseRef.current;
    const visual = liveVisualRef.current;
    if (base && visual) writeTileVisual(base.id, visual);
  }, [writeTileVisual]);

  const finishSettlingVisual = useCallback(() => {
    if (!settlePendingRef.current || !settleReadyRef.current) return;
    const base = baseRef.current;
    const visual = liveVisualRef.current;
    if (!base || !visual) return;

    settlePendingRef.current = false;
    settleReadyRef.current = false;
    const id = base.id;
    const node = tileElementsRef.current.get(id);
    const placement = placementByIdRef.current.get(id);

    const finish = () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      clearTileVisual(id);
      baseRef.current = null;
      liveRef.current = null;
      liveVisualRef.current = null;
      pendingPointerRef.current = null;
      setResizeState(null);
    };

    if (!node || !placement) {
      finish();
      return;
    }

    writeTileVisual(id, visual);
    void node.offsetWidth;
    node.style.transition = [
      `transform ${GESTURE_SETTLE_MS}ms ease-in-out`,
      `width ${GESTURE_SETTLE_MS}ms ease-in-out`,
      `height ${GESTURE_SETTLE_MS}ms ease-in-out`,
    ].join(", ");
    node.style.width = `${placement.width}px`;
    node.style.height = `${placement.height}px`;
    node.style.transform = "translate3d(0px, 0px, 0)";
    settleTimerRef.current = window.setTimeout(
      finish,
      GESTURE_SETTLE_MS + 50,
    );
  }, [clearTileVisual, placementByIdRef, tileElementsRef, writeTileVisual]);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  return {
    resizeState,
    activeItemId: resizeState?.id ?? null,
    gestureFootprint:
      resizeState && resizeState.phase !== "settling"
        ? resizeState.footprint
        : undefined,
    onResizeHandlePointerDown,
    onGestureSettled,
    syncVisual,
    finishSettlingVisual,
  };
}
