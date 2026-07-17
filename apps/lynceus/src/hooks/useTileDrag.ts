import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FeedItem } from "../types";
import type { MasonryItemPlacement } from "../components/masonryPacking";
import { buildIndexMap, reorderWithinList } from "./masonryReorder";

/** Pixels of movement before a pointer-down on a tile counts as a drag
 *  rather than a click - below this, releasing still fires onItemClick. */
const DRAG_THRESHOLD_PX = 6;

interface UseTileDragInput {
  enabled: boolean;
  items: FeedItem[] | undefined;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  placementByIdRef: RefObject<Map<number, MasonryItemPlacement>>;
  tileElementsRef: RefObject<Map<number, HTMLElement>>;
  /** Fired once on drop with the complete new id ordering. */
  onReorder?: (orderedIds: number[]) => void;
  /** Called on release so the click that follows a drag doesn't select. */
  suppressClick: () => void;
}

/**
 * Drag-to-reorder as a pointer-event state machine (native HTML5 DnD
 * fights Framer Motion's `layout` animation).
 *
 * The dragged tile's continuous x/y is an imperative translate3d on its
 * wrapper, coalesced to one requestAnimationFrame write at most. React only
 * receives `workingOrder` when the pointer enters a different rendered tile,
 * because that discrete hover swap is the point where the pack must change.
 * DOM hit-testing replaces the old O(n) placement scan on every move, which
 * keeps the frame path independent of a 100k-image library's total size.
 */
export function useTileDrag(input: UseTileDragInput) {
  const {
    enabled,
    items,
    placementsRef,
    placementByIdRef,
    tileElementsRef,
  } = input;

  const [dragItemId, setDragItemId] = useState<number | null>(null);
  // The dragged tile's committed column span, captured at grab. Fed back
  // into the preview pack as an explicit span override so a multi-span tile
  // keeps its footprint for the whole drag — independent of whether the
  // active feed slice still carries the tile's `manualColSpan` (the
  // similar/search feeds drop it; only reorder's gating hides that today).
  const [dragItemSpan, setDragItemSpan] = useState(1);
  const [workingOrder, setWorkingOrder] = useState<FeedItem[] | null>(null);

  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  // Packed slot position + pointer position captured at grab, so the
  // pointer-to-tile offset stays fixed for the whole drag.
  const dragBaseRef = useRef<{
    x0: number;
    y0: number;
    startX: number;
    startY: number;
  } | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const lastHoveredIdRef = useRef<number | null>(null);
  const workingOrderRef = useRef<FeedItem[] | null>(null);
  // id→index map over the working order, built once per drag and patched on
  // each swap (see masonryReorder). Kills the two O(N) findIndex scans that
  // a hover-swap used to pay. `indexMapBaseRef` is the array the live map
  // describes, so a mid-drag base change (a delta) triggers a rebuild.
  const idToIndexRef = useRef<Map<number, number> | null>(null);
  const indexMapBaseRef = useRef<FeedItem[] | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onReorderRef = useRef(input.onReorder);
  onReorderRef.current = input.onReorder;
  const suppressRef = useRef(input.suppressClick);
  suppressRef.current = input.suppressClick;

  const writeDragVisual = useCallback(
    (id: number, pointer: { x: number; y: number }) => {
      const node = tileElementsRef.current.get(id);
      const placement = placementByIdRef.current.get(id);
      const base = dragBaseRef.current;
      if (!node || !placement || !base) return;

      const desiredX = base.x0 + (pointer.x - base.startX);
      const desiredY = base.y0 + (pointer.y - base.startY);
      node.style.transform = `translate3d(${desiredX - placement.x}px, ${
        desiredY - placement.y
      }px, 0)`;
    },
    [placementByIdRef, tileElementsRef],
  );

  const reorderOverPoint = useCallback(
    (id: number, x: number, y: number) => {
      // The active wrapper has pointer-events disabled, but its transparent
      // absolute-positioning anchor can still be the first hit. Walk the full
      // browser-computed stack and select the first actual tile that is not
      // the active one; this stays proportional to the tiny overlap stack,
      // not to the library's placement count.
      let hoveredId: number | null = null;
      for (const hit of document.elementsFromPoint(x, y)) {
        const tile = hit.closest<HTMLElement>("[data-masonry-id]");
        if (!tile) continue;
        const candidateId = Number(tile.dataset.masonryId);
        if (Number.isFinite(candidateId) && candidateId !== id) {
          hoveredId = candidateId;
          break;
        }
      }

      if (hoveredId === null || hoveredId === id) {
        lastHoveredIdRef.current = null;
        return;
      }
      // Once a tile has caused a swap, remaining over that same DOM target
      // must not repeatedly swap the pair back and forth every frame.
      if (hoveredId === lastHoveredIdRef.current) return;
      lastHoveredIdRef.current = hoveredId;

      const base = workingOrderRef.current ?? itemsRef.current ?? [];
      // Build the id→index map lazily on the first swap (not at pointer-down:
      // a plain click never pays for it, and the drag threshold means the
      // tile hasn't moved yet, so the one-time O(N) build is invisible), or
      // rebuild it if the base order changed identity beneath us (a mid-drag
      // delta). Each swap then patches the map in O(window), replacing the two
      // O(N) findIndex scans the hover path used to pay.
      if (idToIndexRef.current === null || indexMapBaseRef.current !== base) {
        idToIndexRef.current = buildIndexMap(base);
        indexMapBaseRef.current = base;
      }
      const next = reorderWithinList(base, idToIndexRef.current, id, hoveredId);
      if (!next) return;
      // The map now describes `next`; track it as the base so the next swap
      // reuses the patched map instead of rebuilding, and update the
      // imperative ref before scheduling React so another pointer frame
      // cannot derive a second reorder from stale item positions.
      indexMapBaseRef.current = next;
      workingOrderRef.current = next;
      setWorkingOrder(next);
    },
    [],
  );

  const processPointer = useCallback(
    (id: number, pointer: { x: number; y: number }) => {
      latestPointerRef.current = pointer;
      writeDragVisual(id, pointer);
      // Hit-test the reorder from the dragged tile's VISUAL CENTRE, not the
      // raw cursor. The cursor is wherever you grabbed the tile, which on a
      // 2x2 / 3x3 tile can sit over an empty corner while the tile's body
      // overlaps other tiles — sampling only the cursor pixel then finds
      // nothing and displaces nothing ("treats a 2x2 like a 1x1"). The
      // dragged node already carries the follow-the-cursor transform, so its
      // getBoundingClientRect centre is exactly where the tile's body is.
      const node = tileElementsRef.current.get(id);
      if (node) {
        const r = node.getBoundingClientRect();
        reorderOverPoint(id, r.left + r.width / 2, r.top + r.height / 2);
      } else {
        reorderOverPoint(id, pointer.x, pointer.y);
      }
    },
    [reorderOverPoint, writeDragVisual, tileElementsRef],
  );

  const cancelScheduledFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const schedulePointer = useCallback(
    (id: number, pointer: { x: number; y: number }) => {
      pendingPointerRef.current = pointer;
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const pending = pendingPointerRef.current;
        pendingPointerRef.current = null;
        if (pending) processPointer(id, pending);
      });
    },
    [processPointer],
  );

  const clearTileVisual = useCallback(
    (id: number) => {
      const node = tileElementsRef.current.get(id);
      if (!node) return;
      node.style.transform = "";
      node.style.pointerEvents = "";
      node.style.willChange = "";
    },
    [tileElementsRef],
  );

  const onDragHandlePointerDown = useCallback(
    (id: number, e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const placement =
        placementByIdRef.current.get(id) ??
        placementsRef.current.find((candidate) => candidate.itemData.id === id);
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      dragBaseRef.current = {
        x0: placement?.x ?? 0,
        y0: placement?.y ?? 0,
        startX: e.clientX,
        startY: e.clientY,
      };
      latestPointerRef.current = { x: e.clientX, y: e.clientY };
      dragMovedRef.current = false;
      lastHoveredIdRef.current = null;
      workingOrderRef.current = null;
      idToIndexRef.current = null;
      indexMapBaseRef.current = null;
      setDragItemSpan(placement?.colSpan ?? 1);
      setDragItemId(id);
    },
    [enabled, placementByIdRef, placementsRef],
  );

  useEffect(() => {
    if (dragItemId === null) return;

    const handleMove = (e: PointerEvent) => {
      const start = dragStartPosRef.current;
      if (!start) return;

      if (!dragMovedRef.current) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragMovedRef.current = true;
        const node = tileElementsRef.current.get(dragItemId);
        if (node) {
          // Exclude the active wrapper from elementFromPoint so the browser
          // returns the rendered tile underneath it as the hover target.
          node.style.pointerEvents = "none";
          node.style.willChange = "transform";
        }
      }

      schedulePointer(dragItemId, { x: e.clientX, y: e.clientY });
    };

    const handleUp = (e: PointerEvent) => {
      if (dragMovedRef.current) {
        cancelScheduledFrame();
        pendingPointerRef.current = null;
        processPointer(dragItemId, { x: e.clientX, y: e.clientY });
        suppressRef.current();
        const finalOrder = workingOrderRef.current;
        if (finalOrder) onReorderRef.current?.(finalOrder.map((item) => item.id));
      }

      clearTileVisual(dragItemId);
      setDragItemId(null);
      setWorkingOrder(null);
      workingOrderRef.current = null;
      idToIndexRef.current = null;
      indexMapBaseRef.current = null;
      dragStartPosRef.current = null;
      dragBaseRef.current = null;
      latestPointerRef.current = null;
      lastHoveredIdRef.current = null;
      dragMovedRef.current = false;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      cancelScheduledFrame();
      pendingPointerRef.current = null;
    };
  }, [
    cancelScheduledFrame,
    clearTileVisual,
    dragItemId,
    processPointer,
    schedulePointer,
    tileElementsRef,
  ]);

  // A hover swap changes the packed anchor. Rebase the imperative transform
  // against that new slot before paint so the dragged tile never eases or
  // jumps away from the pointer while the rest of the grid animates around it.
  const syncVisual = useCallback(() => {
    const pointer = latestPointerRef.current;
    if (dragItemId !== null && dragMovedRef.current && pointer) {
      writeDragVisual(dragItemId, pointer);
    }
  }, [dragItemId, writeDragVisual]);

  return {
    dragItemId,
    dragItemSpan,
    workingOrder,
    onDragHandlePointerDown,
    syncVisual,
  };
}
