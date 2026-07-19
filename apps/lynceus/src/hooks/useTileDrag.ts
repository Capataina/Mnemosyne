import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FeedItem } from "../types";
import {
  type MasonryGestureFootprint,
  type MasonryGeometry,
  type MasonryItemPlacement,
} from "../components/masonryPacking";
import {
  reorderAtSpatialTarget,
  type SpatialPlacement,
  type SpatialRect,
} from "./masonryReorder";

const DRAG_THRESHOLD_PX = 6;
const GESTURE_SETTLE_MS = 400;
/** Vertical step for the published footprint's `top`. The ghost stays
 * pixel-exact; only the reserved obstacle moves in steps, so a drag re-packs
 * the grid per step crossing instead of per pointer pixel and neighbours get
 * transition targets they can actually reach. */
const FOOTPRINT_TOP_QUANTUM_PX = 48;

interface UseTileDragInput {
  enabled: boolean;
  items: FeedItem[] | undefined;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  placementByIdRef: RefObject<Map<number, MasonryItemPlacement>>;
  tileElementsRef: RefObject<Map<number, HTMLElement>>;
  columnWidthRef: RefObject<number>;
  columnCountRef: RefObject<number>;
  columnGap: number;
  /** Fired once on a committing drop with the complete new id ordering and
   * the released tile's column pin (the slot the gesture preview showed). */
  onReorder?: (
    orderedIds: number[],
    anchor: { id: number; startCol: number },
  ) => void;
  suppressClick: () => void;
}

interface DragBase {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  span: number;
  pointerX: number;
  pointerY: number;
}

function sameIdOrder(a: readonly FeedItem[], b: readonly FeedItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

/**
 * Spatial drag transaction. Pointer frames publish one stable-id 2D obstacle
 * for neighbour packing and imperatively translate only the active tile's
 * inner wrapper. The wrapper is a cosmetic ghost; MasonryAnchor remains the
 * committed-geometry and telemetry owner. On release a single array
 * insertion is derived from the COMMITTED footprint rectangle scored against
 * the pre-gesture snapshot, and the footprint's column travels up as a
 * session pin — the commit is the slot the preview showed.
 */
export function useTileDrag(input: UseTileDragInput) {
  const {
    enabled,
    items,
    placementsRef,
    placementByIdRef,
    tileElementsRef,
    columnWidthRef,
    columnCountRef,
    columnGap,
  } = input;

  const [pressedId, setPressedId] = useState<number | null>(null);
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [gestureFootprint, setGestureFootprint] =
    useState<MasonryGestureFootprint | null>(null);
  // Held only across the release render until the parent acknowledges the
  // same stable-id ordering. It also gives an absent onReorder callback a
  // useful in-component session reorder instead of an immediate snap-back.
  const [committedOrder, setCommittedOrder] = useState<FeedItem[] | null>(null);

  const baseRef = useRef<DragBase | null>(null);
  const movedRef = useRef(false);
  const latestRectRef = useRef<SpatialRect | null>(null);
  const latestFootprintRef = useRef<MasonryGestureFootprint | null>(null);
  const dropTargetsRef = useRef<SpatialPlacement[]>([]);
  const releasePendingRef = useRef(false);
  const settlePendingRef = useRef(false);
  const settleReadyRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const committedOrderRef = useRef<FeedItem[] | null>(null);
  const onReorderRef = useRef(input.onReorder);
  onReorderRef.current = input.onReorder;
  const suppressRef = useRef(input.suppressClick);
  suppressRef.current = input.suppressClick;

  const writeDragVisual = useCallback(
    (id: number, rect: SpatialRect) => {
      const node = tileElementsRef.current.get(id);
      const placement = placementByIdRef.current.get(id);
      if (!node || !placement) return;
      node.style.transition = "none";
      node.style.willChange = "transform";
      node.style.transform = `translate3d(${rect.x - placement.x}px, ${
        rect.y - placement.y
      }px, 0)`;
    },
    [placementByIdRef, tileElementsRef],
  );

  const clearTileVisual = useCallback(
    (id: number) => {
      const node = tileElementsRef.current.get(id);
      if (!node) return;
      node.style.transition = "";
      node.style.transform = "";
      node.style.willChange = "";
    },
    [tileElementsRef],
  );

  // Reconcile the release bridge against the parent order and merge a
  // concurrent feed delta by id. No gesture state ever holds an array index.
  useEffect(() => {
    const local = committedOrderRef.current;
    if (!local || !items) return;
    if (sameIdOrder(local, items)) {
      committedOrderRef.current = null;
      setCommittedOrder(null);
      return;
    }

    const currentById = new Map(items.map((item) => [item.id, item]));
    const localIds = new Set(local.map((item) => item.id));
    const merged = local
      .map((item) => currentById.get(item.id))
      .filter((item): item is FeedItem => item !== undefined);
    for (const item of items) {
      if (!localIds.has(item.id)) merged.push(item);
    }
    const identityChanged =
      merged.length !== local.length ||
      merged.some((item, index) => item !== local[index]);
    if (identityChanged) {
      committedOrderRef.current = merged;
      setCommittedOrder(merged);
    }
  }, [items]);

  const processPointer = useCallback(
    (pointer: { x: number; y: number }, force = false) => {
      const base = baseRef.current;
      const columnWidth = columnWidthRef.current;
      const columnCount = columnCountRef.current;
      if (!base || columnWidth <= 0 || columnCount <= 0) return;

      const desiredX = base.x + (pointer.x - base.pointerX);
      const desiredY = Math.max(0, base.y + (pointer.y - base.pointerY));
      const rect: SpatialRect = {
        x: desiredX,
        y: desiredY,
        width: base.width,
        height: base.height,
      };
      latestRectRef.current = rect;
      writeDragVisual(base.id, rect);
      const stride = columnWidth + columnGap;
      // The reserved slot is the column-quantised ghost rectangle itself:
      // nearest column to the ghost's left edge, top stepped so packs fire on
      // step crossings, not per pixel. (The old centre-column reference was
      // ambiguous for even spans and reserved one column left of the ghost.)
      const footprint: MasonryGestureFootprint = {
        id: base.id,
        span: base.span,
        startCol: Math.round(desiredX / stride),
        top:
          Math.round(desiredY / FOOTPRINT_TOP_QUANTUM_PX) *
          FOOTPRINT_TOP_QUANTUM_PX,
      };
      latestFootprintRef.current = footprint;
      setGestureFootprint((previous) =>
        !force &&
        previous &&
        previous.id === footprint.id &&
        previous.span === footprint.span &&
        previous.startCol === footprint.startCol &&
        previous.top === footprint.top
          ? previous
          : footprint,
      );
    },
    [columnCountRef, columnGap, columnWidthRef, writeDragVisual],
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
        if (pending) processPointer(pending);
      });
    },
    [processPointer],
  );

  const flushPointer = useCallback(
    (pointer: { x: number; y: number }, force = false) => {
      cancelFrame();
      pendingPointerRef.current = null;
      processPointer(pointer, force);
    },
    [cancelFrame, processPointer],
  );

  const onDragHandlePointerDown = useCallback(
    (id: number, event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !enabled ||
        pressedId !== null ||
        baseRef.current !== null ||
        releasePendingRef.current ||
        settlePendingRef.current
      ) {
        return;
      }
      const placement =
        placementByIdRef.current.get(id) ??
        placementsRef.current.find((candidate) => candidate.itemData.id === id);
      if (!placement || placement.isSelected) return;
      baseRef.current = {
        id,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        span: placement.colSpan,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };
      movedRef.current = false;
      latestRectRef.current = null;
      latestFootprintRef.current = null;
      dropTargetsRef.current = placementsRef.current.map((candidate) => ({
        itemData: { id: candidate.itemData.id },
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
      }));
      setPressedId(id);
    },
    [enabled, placementByIdRef, placementsRef, pressedId],
  );

  useEffect(() => {
    if (pressedId === null) return;

    const handleMove = (event: PointerEvent) => {
      const base = baseRef.current;
      if (!base) return;
      if (!movedRef.current) {
        const distance = Math.hypot(
          event.clientX - base.pointerX,
          event.clientY - base.pointerY,
        );
        if (distance < DRAG_THRESHOLD_PX) return;
        movedRef.current = true;
        const node = tileElementsRef.current.get(pressedId);
        if (node) node.style.willChange = "transform";
        setDragItemId(pressedId);
      }
      schedulePointer({ x: event.clientX, y: event.clientY });
    };

    const finish = (event: PointerEvent) => {
      if (movedRef.current) {
        // Force a new object even if pointerup equals the last move. The
        // engine must commit this exact obstacle generation before it may be
        // cleared into the dense release pack.
        flushPointer({ x: event.clientX, y: event.clientY }, true);
        releasePendingRef.current = true;
        suppressRef.current();
        setPressedId(null);
        pendingPointerRef.current = null;
        return;
      }

      setGestureFootprint(null);
      setDragItemId(null);
      setPressedId(null);
      baseRef.current = null;
      movedRef.current = false;
      latestRectRef.current = null;
      latestFootprintRef.current = null;
      dropTargetsRef.current = [];
      pendingPointerRef.current = null;
    };

    const cancel = () => {
      cancelFrame();
      releasePendingRef.current = false;
      settlePendingRef.current = false;
      settleReadyRef.current = false;
      const id = baseRef.current?.id;
      if (id != null) clearTileVisual(id);
      setGestureFootprint(null);
      setDragItemId(null);
      setPressedId(null);
      baseRef.current = null;
      movedRef.current = false;
      latestRectRef.current = null;
      latestFootprintRef.current = null;
      dropTargetsRef.current = [];
      pendingPointerRef.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      cancelFrame();
      pendingPointerRef.current = null;
    };
  }, [
    cancelFrame,
    clearTileVisual,
    flushPointer,
    placementsRef,
    pressedId,
    schedulePointer,
    tileElementsRef,
  ]);

  const onGestureGeometryCommitted = useCallback(
    (
      committedFootprint: MasonryGestureFootprint,
      geometry: MasonryGeometry,
      committedItems: FeedItem[],
    ) => {
      const expected = latestFootprintRef.current;
      const base = baseRef.current;
      if (
        !releasePendingRef.current ||
        !expected ||
        !base ||
        committedFootprint.id !== expected.id ||
        committedFootprint.span !== expected.span ||
        committedFootprint.startCol !== expected.startCol ||
        committedFootprint.top !== expected.top
      ) {
        return;
      }

      // WYSIWYG release: the slot the user watched IS the commit. Target the
      // committed footprint rectangle from the gesture pack (column-aligned,
      // the reserved slot the preview displaced neighbours around), never the
      // raw pixel ghost — so the derived insertion matches the preview.
      // Dropping back onto the source slot is the one genuine no-op, decided
      // by comparing slots, not by self-overlap (a span-2 moved one column
      // still overlaps its own old rect, which used to silently discard
      // every small multi-span move).
      const stride =
        columnWidthRef.current > 0
          ? columnWidthRef.current + columnGap
          : 0;
      const sourceStartCol =
        stride > 0 ? Math.round(base.x / stride) : expected.startCol;
      const droppedAtSource =
        expected.startCol === sourceStartCol &&
        Math.abs(expected.top - base.y) < base.height / 2;

      if (!droppedAtSource) {
        let committedIndex = -1;
        for (let i = 0; i < committedItems.length; i++) {
          if (committedItems[i].id === expected.id) {
            committedIndex = i;
            break;
          }
        }
        const committedRect: SpatialRect =
          committedIndex >= 0
            ? {
                x: geometry.xs[committedIndex],
                y: geometry.ys[committedIndex],
                width: geometry.widths[committedIndex],
                height: geometry.heights[committedIndex],
              }
            : {
                x: expected.startCol * stride,
                y: expected.top,
                width: base.width,
                height: base.height,
              };
        const next = reorderAtSpatialTarget(
          committedItems,
          dropTargetsRef.current,
          expected.id,
          committedRect,
        );
        if (next) {
          committedOrderRef.current = next;
          setCommittedOrder(next);
          onReorderRef.current?.(
            next.map((item) => item.id),
            { id: expected.id, startCol: committedFootprint.startCol },
          );
        }
      }

      releasePendingRef.current = false;
      settlePendingRef.current = true;
      settleReadyRef.current = false;
      setGestureFootprint(null);
      latestFootprintRef.current = null;
    },
    [columnGap, columnWidthRef],
  );

  const onGestureSettled = useCallback(() => {
    if (settlePendingRef.current) settleReadyRef.current = true;
  }, []);

  // A discrete obstacle/dense pack can move the active anchor beneath the
  // floating wrapper. Rebase the wrapper against the latest committed anchor
  // before paint so its screen-space rectangle remains pointer-exact.
  const syncVisual = useCallback(() => {
    const base = baseRef.current;
    const rect = latestRectRef.current;
    if (base && rect && movedRef.current) writeDragVisual(base.id, rect);
  }, [writeDragVisual]);

  // Once the dense release pack is committed, snap the hidden anchor behind
  // the ghost, then animate the one cosmetic delta back to zero. The tile
  // therefore slides from the literal drop rectangle to its committed slot;
  // it never exposes the packer's unrelated intermediate anchor.
  const finishSettlingVisual = useCallback(() => {
    if (!settlePendingRef.current || !settleReadyRef.current) return;
    const base = baseRef.current;
    const rect = latestRectRef.current;
    if (!base || !rect) return;

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
      setDragItemId(null);
      baseRef.current = null;
      movedRef.current = false;
      latestRectRef.current = null;
      latestFootprintRef.current = null;
      dropTargetsRef.current = [];
    };

    if (!node || !placement) {
      finish();
      return;
    }

    writeDragVisual(id, rect);
    // The rebase above happens in this layout effect. Force that one active
    // wrapper to establish its start frame before enabling the settle curve.
    void node.offsetWidth;
    node.style.transition = `transform ${GESTURE_SETTLE_MS}ms ease-in-out`;
    node.style.transform = "translate3d(0px, 0px, 0)";
    settleTimerRef.current = window.setTimeout(
      finish,
      GESTURE_SETTLE_MS + 50,
    );
  }, [clearTileVisual, placementByIdRef, tileElementsRef, writeDragVisual]);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  return {
    dragItemId,
    gestureFootprint: gestureFootprint ?? undefined,
    committedOrder,
    onDragHandlePointerDown,
    onGestureGeometryCommitted,
    onGestureSettled,
    syncVisual,
    finishSettlingVisual,
  };
}
