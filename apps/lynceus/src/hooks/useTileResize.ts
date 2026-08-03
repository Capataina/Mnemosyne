import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  MasonryItemPlacement,
  MasonryPlacementAnchor,
} from "../components/masonryPacking";
import {
  SETTLE_CLEANUP_SLACK_MS,
  SETTLE_EASING,
  SETTLE_MS,
} from "../components/masonryMotion";
import {
  resizePreviewForSpan,
  resizeVisualForPointer,
  type ResizeBaseGeometry,
  type ResizeCorner,
  type ResizePreview,
  type ResizeVisual,
} from "../components/resizeGeometry";

export * from "../components/resizeGeometry";

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
   * local footprint remains live until then, eliminating the 1×1 gap render.
   * The anchor is the previewed rectangle coordinate — the caller pins it so
   * settle cannot relocate the tile the user just placed. */
  onResizeCommit?: (
    id: number,
    colSpan: number | null,
    anchor: MasonryPlacementAnchor,
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
          {
            startCol: live.footprint.startCol,
            top: live.footprint.top,
          },
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
      `transform ${SETTLE_MS}ms ${SETTLE_EASING}`,
      `width ${SETTLE_MS}ms ${SETTLE_EASING}`,
      `height ${SETTLE_MS}ms ${SETTLE_EASING}`,
    ].join(", ");
    node.style.width = `${placement.width}px`;
    node.style.height = `${placement.height}px`;
    node.style.transform = "translate3d(0px, 0px, 0)";
    settleTimerRef.current = window.setTimeout(
      finish,
      SETTLE_MS + SETTLE_CLEANUP_SLACK_MS,
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
