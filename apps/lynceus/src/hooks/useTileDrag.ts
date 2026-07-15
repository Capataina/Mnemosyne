import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ImageItem } from "../types";
import type { MasonryItemPlacement } from "../components/masonryPacking";

/** Pixels of movement before a pointer-down on a tile counts as a drag
 *  rather than a click — below this, releasing still fires onItemClick. */
const DRAG_THRESHOLD_PX = 6;

interface UseTileDragInput {
  enabled: boolean;
  items: ImageItem[] | undefined;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Fired once on drop with the complete new id ordering. */
  onReorder?: (orderedIds: number[]) => void;
  /** Called on release so the click that follows a drag doesn't select. */
  suppressClick: () => void;
}

/**
 * Drag-to-reorder as a pointer-event state machine (native HTML5 DnD
 * fights framer-motion's `layout` animation). `workingOrder` is a live
 * locally-reordered copy of the items, so the grid re-flows in real time
 * during the drag; on drop the caller persists the final ordering (as an
 * in-session order, which is why the drop *sticks* now instead of
 * snapping back — there's no backend round-trip re-sorting it).
 */
export function useTileDrag(input: UseTileDragInput) {
  const { enabled, items, placementsRef, containerRef } = input;

  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [workingOrder, setWorkingOrder] = useState<ImageItem[] | null>(null);
  // Live top-left of the dragged tile, pinned to the pointer so the tile
  // sits *under* the cursor instead of easing toward the grid slot behind it.
  const [dragVisual, setDragVisual] = useState<{ x: number; y: number } | null>(
    null,
  );

  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  // The dragged tile's slot position + pointer position captured at grab, so
  // the pointer-to-tile offset stays fixed for the whole drag.
  const dragBaseRef = useRef<{
    x0: number;
    y0: number;
    startX: number;
    startY: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const workingOrderRef = useRef<ImageItem[] | null>(null);
  workingOrderRef.current = workingOrder;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onReorderRef = useRef(input.onReorder);
  onReorderRef.current = input.onReorder;
  const suppressRef = useRef(input.suppressClick);
  suppressRef.current = input.suppressClick;

  const onDragHandlePointerDown = useCallback(
    (id: number, e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const p = placementsRef.current?.find((pl) => pl.itemData.id === id);
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      dragBaseRef.current = {
        x0: p?.x ?? 0,
        y0: p?.y ?? 0,
        startX: e.clientX,
        startY: e.clientY,
      };
      dragMovedRef.current = false;
      setDragItemId(id);
    },
    [enabled, placementsRef],
  );

  useEffect(() => {
    if (dragItemId === null) return;

    const handleMove = (e: PointerEvent) => {
      const start = dragStartPosRef.current;
      const container = containerRef.current;
      if (!start || !container) return;

      if (!dragMovedRef.current) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragMovedRef.current = true;
      }

      // Pin the tile under the pointer, keeping the same pointer-to-tile
      // offset it had at grab — so it sits under the cursor, not behind it.
      const dragBase = dragBaseRef.current;
      if (dragBase) {
        setDragVisual({
          x: dragBase.x0 + (e.clientX - dragBase.startX),
          y: dragBase.y0 + (e.clientY - dragBase.startY),
        });
      }

      const rect = container.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      // Hit-test against the full placement list (not the viewport-culled
      // subset) so a target just outside the visible band still registers.
      const hovered = placementsRef.current?.find(
        (p) =>
          p.itemData.id !== dragItemId &&
          localX >= p.x &&
          localX <= p.x + p.width &&
          localY >= p.y &&
          localY <= p.y + p.height,
      );
      if (!hovered) return;

      const base = workingOrderRef.current ?? itemsRef.current ?? [];
      const fromIndex = base.findIndex((i) => i.id === dragItemId);
      const toIndex = base.findIndex((i) => i.id === hovered.itemData.id);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const next = base.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setWorkingOrder(next);
    };

    const handleUp = () => {
      if (dragMovedRef.current) {
        suppressRef.current();
        const finalOrder = workingOrderRef.current;
        if (finalOrder) onReorderRef.current?.(finalOrder.map((i) => i.id));
      }
      setDragItemId(null);
      setWorkingOrder(null);
      setDragVisual(null);
      dragStartPosRef.current = null;
      dragBaseRef.current = null;
      dragMovedRef.current = false;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragItemId, placementsRef, containerRef]);

  return { dragItemId, workingOrder, dragVisual, onDragHandlePointerDown };
}
