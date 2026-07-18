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

interface UseTileDragInput {
  enabled: boolean;
  items: FeedItem[] | undefined;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  placementByIdRef: RefObject<Map<number, MasonryItemPlacement>>;
  tileElementsRef: RefObject<Map<number, HTMLElement>>;
  columnWidthRef: RefObject<number>;
  columnCountRef: RefObject<number>;
  columnGap: number;
  onReorder?: (orderedIds: number[]) => void;
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
 * committed-geometry and telemetry owner. A single array insertion is
 * derived from the pre-gesture spatial snapshot on release.
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
      const centreCol = Math.floor((desiredX + base.width / 2) / stride);
      const footprint: MasonryGestureFootprint = {
        id: base.id,
        span: base.span,
        startCol: centreCol,
        top: desiredY,
        edge: 2,
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
      _geometry: MasonryGeometry,
      committedItems: FeedItem[],
    ) => {
      const expected = latestFootprintRef.current;
      const rect = latestRectRef.current;
      if (
        !releasePendingRef.current ||
        !expected ||
        !rect ||
        committedFootprint.id !== expected.id ||
        committedFootprint.span !== expected.span ||
        committedFootprint.startCol !== expected.startCol ||
        committedFootprint.top !== expected.top ||
        (committedFootprint.edge ?? 0) !== (expected.edge ?? 0)
      ) {
        return;
      }

      // The committed obstacle geometry has already displaced every tile
      // away from the reserved rect, so overlap scoring against it always
      // degenerates to a nearest-displaced-neighbour guess. Target the stable
      // pre-gesture snapshot instead: the tile under the drop rect maps back
      // to the feed slot the user actually indicated.
      const next = reorderAtSpatialTarget(
        committedItems,
        dropTargetsRef.current,
        expected.id,
        rect,
      );
      if (next) {
        committedOrderRef.current = next;
        setCommittedOrder(next);
        onReorderRef.current?.(next.map((item) => item.id));
      }

      releasePendingRef.current = false;
      settlePendingRef.current = true;
      settleReadyRef.current = false;
      setGestureFootprint(null);
      latestFootprintRef.current = null;
    },
    [],
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
