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
  /** Live column width + gap, so a hover-swap can map the hovered tile's x to
   *  a column index for the pack pin (keeps the dragged tile's reserved slot
   *  under the pointer instead of drifting to the greedy-shortest column). */
  columnWidthRef: RefObject<number>;
  columnGap: number;
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
    columnWidthRef,
    columnGap,
  } = input;

  const [dragItemId, setDragItemId] = useState<number | null>(null);
  // The column the dragged tile's reserved slot is pinned to — the column of
  // the tile the footprint currently hovers. Fed to the pack as a column
  // anchor so the open slot tracks the pointer instead of drifting to whatever
  // column the greedy search finds shortest (a col of drift telemetry caught).
  // Null until the first hover-swap, and reset on drop.
  const [dragAnchorCol, setDragAnchorCol] = useState<number | null>(null);
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
    (id: number) => {
      // Sample a span×span grid of points across the dragged tile's body —
      // one dot per cell (a 2-wide tile is probed at 4 points, a 3-wide at 9,
      // a 1-wide at its single centre). Hit-testing only the cursor pixel (or
      // even the tile centre) fails for a big tile: telemetry showed the
      // centre landed on EMPTY space 79% of a drag, so nothing displaced. Each
      // cell that overlaps another tile votes for it; the MOST-overlapped tile
      // wins, so the swap is driven by the tile's whole footprint, not a
      // single point — and the pack then reflows to make room for the span.
      const node = tileElementsRef.current.get(id);
      const placement = placementByIdRef.current.get(id);
      if (!node) {
        lastHoveredIdRef.current = null;
        return;
      }
      const rect = node.getBoundingClientRect();
      const span = Math.max(1, placement?.colSpan ?? 1);

      const votes = new Map<number, number>();
      for (let cx = 0; cx < span; cx++) {
        for (let cy = 0; cy < span; cy++) {
          const px = rect.left + rect.width * ((cx + 0.5) / span);
          const py = rect.top + rect.height * ((cy + 0.5) / span);
          for (const hit of document.elementsFromPoint(px, py)) {
            const tile = hit.closest<HTMLElement>("[data-masonry-id]");
            if (!tile) continue;
            const cand = Number(tile.dataset.masonryId);
            if (Number.isFinite(cand) && cand !== id) {
              votes.set(cand, (votes.get(cand) ?? 0) + 1);
              break; // first real tile beneath this cell
            }
          }
        }
      }

      // The tile the dragged footprint overlaps most; ties break to the
      // first seen (Map preserves insertion = scan order, top-left first).
      let hoveredId: number | null = null;
      let bestVotes = 0;
      for (const [cand, v] of votes) {
        if (v > bestVotes) {
          bestVotes = v;
          hoveredId = cand;
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

      // Pin the dragged tile's reserved slot to the hovered tile's column
      // (read from its current placement, pre-repack), so the open slot sits
      // under the pointer. Without it the greedy pack drops the dragged tile
      // into the shortest column, which — with slightly-varying tile heights —
      // can land a column off the cursor (the "hole appears bottom-right" of
      // where you're dragging).
      const hoveredPlacement = placementByIdRef.current.get(hoveredId);
      const colWidth = columnWidthRef.current ?? 0;
      if (hoveredPlacement && colWidth > 0) {
        setDragAnchorCol(Math.round(hoveredPlacement.x / (colWidth + columnGap)));
      }

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
    [columnGap, columnWidthRef, placementByIdRef, tileElementsRef],
  );

  const processPointer = useCallback(
    (id: number, pointer: { x: number; y: number }) => {
      latestPointerRef.current = pointer;
      writeDragVisual(id, pointer);
      // reorderOverPoint samples the dragged tile's whole footprint (span×span
      // dots), so it needs no cursor coordinate — it reads the tile's current
      // rendered box directly.
      reorderOverPoint(id);
    },
    [reorderOverPoint, writeDragVisual],
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
      setDragAnchorCol(null);
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
      setDragAnchorCol(null);
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
    dragAnchorCol,
    workingOrder,
    onDragHandlePointerDown,
    syncVisual,
  };
}
