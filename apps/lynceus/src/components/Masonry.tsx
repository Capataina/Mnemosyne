import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ImageItem } from "../types";
import { MasonryItem } from "./MasonryItem";
import { MasonryAnchor } from "./MasonryAnchor";
import type { MasonryItemPlacement } from "./masonryPacking";
import { useMasonryEngine } from "../hooks/useMasonryEngine";
import { useTileDrag } from "../hooks/useTileDrag";
import { useTileResize } from "../hooks/useTileResize";

export type MasonryItemData = MasonryItemPlacement;

interface MasonryProps {
  items?: ImageItem[];
  selectedItem?: ImageItem | null;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  onItemClick: (item: ImageItem) => void;
  /** Override the computed column count. 0/undefined = auto. */
  columnCountOverride?: number;
  /** Tile size scale multiplier. Default 1.0. */
  tileScale?: number;
  animationLevel?: "off" | "subtle" | "standard";
  /** Enables drag-to-reorder (a live in-session nudge). */
  reorderEnabled?: boolean;
  /** Fired once, on drop, with the complete new id ordering. */
  onReorder?: (orderedIds: number[]) => void;
  /**
   * Fired once, on release, with the tile's new column span (`null` =
   * back to single-column). Resize persists per-image (unlike reorder).
   */
  onResizeCommit?: (itemId: number, colSpan: number | null) => void;
  /** Fired when the pointer enters a tile — used to prefetch its
   *  similar-set so opening it is instant. */
  onItemHover?: (id: number) => void;
}

/**
 * Thin composition shell over three focused hooks:
 *  - `useMasonryEngine`  — shortest-column packing + viewport virtualization
 *  - `useTileDrag`       — pointer-driven drag-to-reorder (live in-session)
 *  - `useTileResize`     — smooth pixel resize that snaps to a span on release
 *
 * The shell owns the shared refs (container + live layout) so the
 * interaction hooks read layout data without re-subscribing on every
 * pointer tick, threads their preview state into the engine, and renders.
 */
export default function Masonry(props: MasonryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const placementsRef = useRef<MasonryItemPlacement[]>([]);
  const placementByIdRef = useRef<Map<number, MasonryItemPlacement>>(new Map());
  // Only visible tiles have DOM nodes. Gesture hooks address the one active
  // tile through this registry, keeping continuous pointer motion completely
  // outside React while virtualization remains free to mount/unmount the rest.
  const tileElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const columnWidthRef = useRef(0);
  const columnCountRef = useRef(0);
  // Consumed by the click handler right after a drag/resize pointerup, to
  // swallow the click that otherwise selects/navigates the tile.
  const suppressNextClickRef = useRef(false);
  const suppressClick = useCallback(() => {
    suppressNextClickRef.current = true;
  }, []);
  const registerTileElement = useCallback(
    (id: number, node: HTMLElement | null) => {
      if (node) tileElementsRef.current.set(id, node);
      else tileElementsRef.current.delete(id);
    },
    [],
  );

  const drag = useTileDrag({
    enabled: !!props.reorderEnabled,
    items: props.items,
    placementsRef,
    placementByIdRef,
    tileElementsRef,
    onReorder: props.onReorder,
    suppressClick,
  });

  const resize = useTileResize({
    columnWidthRef,
    columnCountRef,
    columnGap: props.columnGap,
    placementsRef,
    placementByIdRef,
    tileElementsRef,
    onResizeCommit: props.onResizeCommit,
    suppressClick,
  });

  const rs = resize.resizeState;
  const effectiveItems = drag.workingOrder ?? props.items;
  // The packer's resize input is deliberately keyed only by the rounded
  // footprint. Pixel motion lives in useTileResize's imperative rAF path, so
  // dozens of pointer events within one column keep this object's identity
  // stable and cannot retrigger an O(n) pack.
  const spanOverrides = useMemo(() => {
    if (!rs || rs.previewSpan === rs.baseSpan) return undefined;
    return { [rs.id]: rs.previewSpan };
  }, [rs?.id, rs?.previewSpan, rs?.baseSpan]);

  const { visiblePlacements, height } = useMasonryEngine({
    items: effectiveItems,
    selectedItem: props.selectedItem ?? null,
    minItemWidth: props.minItemWidth,
    columnGap: props.columnGap,
    verticalGap: props.verticalGap,
    columnCountOverride: props.columnCountOverride,
    tileScale: props.tileScale,
    spanOverrides,
    dragItemId: drag.dragItemId,
    containerRef,
    placementsRef,
    placementByIdRef,
    columnWidthRef,
    columnCountRef,
  });

  // A discrete pack can move the active tile's anchor beneath its imperative
  // wrapper transform. Rebase that transform before paint so the resize edge
  // or dragged tile remains exactly under the pointer through the reflow.
  // This runs only after React work (span boundary, hover swap, viewport
  // change), never for the continuous pointermove frames themselves.
  useLayoutEffect(() => {
    resize.syncVisual();
    drag.syncVisual();
  }, [visiblePlacements, resize.syncVisual, drag.syncVisual]);

  const handleItemClick = useCallback(
    (item: ImageItem) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      props.onItemClick(item);
    },
    [props.onItemClick],
  );

  // Prefetch the similar-set of every on-screen tile once the view
  // settles, so opening any visible image is instant — the cascade you
  // described: launch → click → instant → click → instant. react-query
  // dedupes, so each image is computed at most once per session; the
  // 200ms debounce coalesces scroll churn so a fast scroll doesn't fire a
  // query per intermediate frame. This scales because it's always ~the
  // visible ~20-30 tiles, never the whole library.
  useEffect(() => {
    const prefetch = props.onItemHover;
    if (!prefetch) return;
    const t = setTimeout(() => {
      for (const p of visiblePlacements) prefetch(p.itemData.id);
    }, 200);
    return () => clearTimeout(t);
  }, [visiblePlacements, props.onItemHover]);

  const resizingId = rs?.id ?? null;
  const resizingCorner = rs?.corner ?? null;

  return (
    <div ref={containerRef} className="w-full relative" style={{ height }}>
      {visiblePlacements.map((item) => {
        const id = item.itemData.id;
        const isDraggingThis = id === drag.dragItemId;
        return (
          <MasonryAnchor
            // Key by stable id alone. Keying by url too made a thumbnail-URL
            // change (base→sharp swap, re-index) unmount/remount the whole
            // anchor+item subtree, dropping useAdaptiveThumbnail state and
            // re-firing the pop-in. The comparator on MasonryItem handles the
            // url change as a cheap prop update instead.
            key={id}
            x={item.x}
            y={item.y}
            width={item.width}
            onTop={item.isSelected || isDraggingThis || id === resizingId}
            snap={id === resizingId || isDraggingThis}
          >
            <MasonryItem
              item={item.itemData}
              isSelected={item.isSelected}
              onClick={handleItemClick}
              onHover={props.onItemHover}
              renderedWidth={item.width}
              animationLevel={props.animationLevel}
              reorderEnabled={props.reorderEnabled}
              isDragging={id === drag.dragItemId}
              onDragHandlePointerDown={drag.onDragHandlePointerDown}
              activeResizeCorner={id === resizingId ? resizingCorner : null}
              onResizeHandlePointerDown={resize.onResizeHandlePointerDown}
              onTileElement={registerTileElement}
            />
          </MasonryAnchor>
        );
      })}
    </div>
  );
}
