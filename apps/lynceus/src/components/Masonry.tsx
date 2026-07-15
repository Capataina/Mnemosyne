import { useCallback, useRef } from "react";
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
  const columnWidthRef = useRef(0);
  const columnCountRef = useRef(0);
  // Consumed by the click handler right after a drag/resize pointerup, to
  // swallow the click that otherwise selects/navigates the tile.
  const suppressNextClickRef = useRef(false);
  const suppressClick = useCallback(() => {
    suppressNextClickRef.current = true;
  }, []);

  const drag = useTileDrag({
    enabled: !!props.reorderEnabled,
    items: props.items,
    placementsRef,
    containerRef,
    onReorder: props.onReorder,
    suppressClick,
  });

  const resize = useTileResize({
    columnWidthRef,
    columnCountRef,
    columnGap: props.columnGap,
    placementsRef,
    onResizeCommit: props.onResizeCommit,
    suppressClick,
  });

  const rs = resize.resizeState;
  const effectiveItems = drag.workingOrder ?? props.items;
  const spanOverrides = rs ? { [rs.id]: rs.previewSpan } : undefined;
  const resizePreview = rs
    ? { id: rs.id, px: rs.previewPx, leftAnchored: rs.leftAnchored }
    : null;

  const { visiblePlacements, height } = useMasonryEngine({
    items: effectiveItems,
    selectedItem: props.selectedItem ?? null,
    minItemWidth: props.minItemWidth,
    columnGap: props.columnGap,
    verticalGap: props.verticalGap,
    columnCountOverride: props.columnCountOverride,
    tileScale: props.tileScale,
    spanOverrides,
    resizePreview,
    dragItemId: drag.dragItemId,
    containerRef,
    placementsRef,
    columnWidthRef,
    columnCountRef,
  });

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

  const resizingId = rs?.id ?? null;
  const resizingCorner = rs?.corner ?? null;

  return (
    <div ref={containerRef} className="w-full relative" style={{ height }}>
      {visiblePlacements.map((item) => {
        const id = item.itemData.id;
        const isDraggingThis = id === drag.dragItemId;
        // The dragged tile is pinned under the pointer (dragVisual);
        // every other tile sits at its packed slot and reflows around it.
        const ax = isDraggingThis && drag.dragVisual ? drag.dragVisual.x : item.x;
        const ay = isDraggingThis && drag.dragVisual ? drag.dragVisual.y : item.y;
        return (
          <MasonryAnchor
            key={`${id}-${item.itemData.url}`}
            x={ax}
            y={ay}
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
              onDragHandlePointerDown={(e) => drag.onDragHandlePointerDown(id, e)}
              activeResizeCorner={id === resizingId ? resizingCorner : null}
              onResizeHandlePointerDown={(corner, e) =>
                resize.onResizeHandlePointerDown(id, corner, e)
              }
            />
          </MasonryAnchor>
        );
      })}
    </div>
  );
}
