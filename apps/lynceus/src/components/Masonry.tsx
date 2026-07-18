import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { FeedItem } from "../types";
import { MasonryItem } from "./MasonryItem";
import { MasonryAnchor } from "./MasonryAnchor";
import type { MasonryItemPlacement } from "./masonryPacking";
import { useMasonryEngine } from "../hooks/useMasonryEngine";
import { useTileDrag } from "../hooks/useTileDrag";
import { useTileResize } from "../hooks/useTileResize";
import { useIsIndexing } from "../hooks/useIndexingStatus";

export type MasonryItemData = MasonryItemPlacement;

/**
 * How many of the visible tiles the settle-time effect pre-warms. The prefetch
 * fans one tile into a 3-encoder fused-similar search plus a detail hydrate, so
 * firing it for every visible tile turned a settled viewport into 20-30
 * concurrent searches (telemetry logged 133 in one indexing session, ~1.3s each
 * under CPU contention — a click-freeze cause). Capping the auto-prewarm to the
 * few most-likely-next-click tiles keeps opening them instant; genuine
 * pointer-hover still warms any other tile on intent.
 */
const PREFETCH_PREWARM_CAP = 6;

interface MasonryProps {
  items?: FeedItem[];
  selectedItem?: FeedItem | null;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  onItemClick: (item: FeedItem) => void;
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
  onResizeCommit?: (
    itemId: number,
    colSpan: number | null,
  ) => void | Promise<unknown>;
  /** Fired when the pointer enters a tile — used to prefetch its
   *  similar-set so opening it is instant. */
  onItemHover?: (id: number) => void;
  /** Rendered inside the selected hero tile only (the quick-start timer
   *  pill). Memoise it in the host — it is compared by reference. */
  heroOverlay?: React.ReactNode;
}

/**
 * Thin composition shell over three focused hooks:
 *  - `useMasonryEngine`  — dual-path packing + viewport virtualization
 *  - `useTileDrag`       — stable-id spatial drag transaction
 *  - `useTileResize`     — four-corner, opposite-corner-fixed resize
 *
 * The shell owns the shared refs (container + live layout) so the
 * interaction hooks read layout data without re-subscribing on every
 * pointer tick, threads their preview state into the engine, and renders.
 */
export default function Masonry(props: MasonryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const placementsRef = useRef<MasonryItemPlacement[]>([]);
  const placementByIdRef = useRef<Map<number, MasonryItemPlacement>>(new Map());
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
    columnWidthRef,
    columnCountRef,
    columnGap: props.columnGap,
    onReorder: props.onReorder,
    suppressClick,
  });

  const resize = useTileResize({
    enabled: !!props.reorderEnabled,
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
  const effectiveItems = drag.committedOrder ?? props.items;
  // One transaction object replaces the old working-order + span-override +
  // X-anchor composition. Resize takes precedence defensively; the UI cannot
  // start both gestures at once.
  const gestureFootprint =
    resize.gestureFootprint ?? drag.gestureFootprint;
  const handleGestureSettled = useCallback(() => {
    drag.onGestureSettled();
    resize.onGestureSettled();
  }, [drag.onGestureSettled, resize.onGestureSettled]);

  const { visiblePlacements, height, settling } = useMasonryEngine({
    items: effectiveItems,
    selectedItem: props.selectedItem ?? null,
    minItemWidth: props.minItemWidth,
    columnGap: props.columnGap,
    verticalGap: props.verticalGap,
    columnCountOverride: props.columnCountOverride,
    tileScale: props.tileScale,
    gestureFootprint,
    onGestureGeometryCommitted: drag.onGestureGeometryCommitted,
    onGestureSettled: handleGestureSettled,
    containerRef,
    placementsRef,
    placementByIdRef,
    columnWidthRef,
    columnCountRef,
  });

  // Packer commits move the active anchor underneath its floating wrapper.
  // Rebase before paint to keep the ghost pointer-exact. Once the release's
  // dense pack commits, animate that one visual delta back to the anchor.
  useLayoutEffect(() => {
    resize.syncVisual();
    drag.syncVisual();
    if (!settling) {
      resize.finishSettlingVisual();
      drag.finishSettlingVisual();
    }
  }, [
    visiblePlacements,
    settling,
    resize.syncVisual,
    resize.finishSettlingVisual,
    drag.syncVisual,
    drag.finishSettlingVisual,
  ]);

  const handleItemClick = useCallback(
    (item: FeedItem) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      props.onItemClick(item);
    },
    [props.onItemClick],
  );

  // A live indexing run is encoding the corpus, so a similar-set computed
  // now is against half-encoded vectors — wrong until encoding finishes, and
  // expensive under the indexing CPU load. Suppress all similar-prefetch
  // (settle-time and hover) while indexing; the click's own query still fires
  // in the route, so selecting an image stays responsive.
  const isIndexing = useIsIndexing();

  // Gate genuine pointer-hover prefetch through the same indexing guard.
  const onItemHover = props.onItemHover;
  const gatedHover = useCallback(
    (id: number) => {
      if (isIndexing) return;
      onItemHover?.(id);
    },
    [isIndexing, onItemHover],
  );

  // Pre-warm the similar-set of the first few visible tiles once the view
  // settles, so opening the most-likely next click is instant. react-query
  // dedupes, so each image is computed at most once per session; the 200ms
  // debounce coalesces scroll churn. Capped at PREFETCH_PREWARM_CAP so a
  // settled viewport never fires a burst of concurrent fused searches, and
  // skipped entirely during indexing (wrong results, and the storm was a
  // documented freeze contributor). Hover covers any tile past the cap.
  useEffect(() => {
    if (!onItemHover || isIndexing) return;
    const t = setTimeout(() => {
      const cap = Math.min(visiblePlacements.length, PREFETCH_PREWARM_CAP);
      for (let i = 0; i < cap; i++) onItemHover(visiblePlacements[i].itemData.id);
    }, 200);
    return () => clearTimeout(t);
  }, [visiblePlacements, onItemHover, isIndexing]);

  const resizingId = resize.activeItemId;
  const resizingCorner = rs?.corner ?? null;

  // Render the anchors in a STABLE id order, decoupled from the visual/pack
  // order. Every tile is absolutely positioned by `transform: translate()`,
  // so DOM order does not drive tile *placement*. It matters because React's
  // keyed reconciliation relocates a node via insertBefore when its position
  // in the child list changes — and a re-inserted node loses its
  // CSS-transition start frame, so its next `translate()` lands in a single
  // commit with no interpolation (a teleport instead of a slide). A reorder
  // that moved a tile *earlier* used to re-insert exactly the displaced tiles
  // (React's lastPlacedIndex flags the lower-old-index nodes as moved), so
  // dragging up teleported the grid while dragging down slid it — the
  // direction asymmetry telemetry pinned down (the down-drag slide is the
  // control: same async-worker commit path, no node relocation, animates
  // fine). Sorting by id makes the persistent tiles' relative DOM order
  // invariant under any reorder, so every position change is a prop-only
  // update the CSS transition animates. `visiblePlacements` itself stays in
  // pack order — the settle-time prewarm above depends on it leading with the
  // most likely-next-click tiles.
  //
  // Known minor trade-off: among two *ordinary* (non-`onTop`) tiles that cross
  // paths mid-slide, painter order now follows id rather than pack order, so
  // which briefly paints over the other during the ~400ms cross is arbitrary.
  // The settled pack never overlaps (masonryPacking guarantees it) and the
  // dragged/resizing/selected tiles are raised by z-50, so this is a
  // sub-second z-flip between two opaque image tiles, not a layout artefact.
  const renderOrder = useMemo(
    () =>
      [...visiblePlacements].sort((a, b) => a.itemData.id - b.itemData.id),
    [visiblePlacements],
  );

  return (
    <div ref={containerRef} className="w-full relative" style={{ height }}>
      {renderOrder.map((item) => {
        const id = item.itemData.id;
        const isDraggingThis = id === drag.dragItemId;
        return (
          <MasonryAnchor
            // Key by stable id alone. Keying by url too made a thumbnail-URL
            // change (base→sharp swap, re-index) unmount/remount the whole
            // anchor+item subtree, dropping useAdaptiveThumbnail state and
            // re-firing the pop-in. The comparator on MasonryItem handles the
            // url change as a cheap prop update instead.
            id={id}
            key={id}
            x={item.x}
            y={item.y}
            width={item.width}
            height={item.height}
            onTop={item.isSelected || isDraggingThis || id === resizingId}
            snap={id === resizingId || isDraggingThis}
          >
            <MasonryItem
              item={item.itemData}
              isSelected={item.isSelected}
              onClick={handleItemClick}
              onHover={gatedHover}
              renderedWidth={item.width}
              animationLevel={props.animationLevel}
              reorderEnabled={
                props.reorderEnabled && resizingId === null
              }
              resizeEnabled={
                props.reorderEnabled && drag.dragItemId === null
              }
              isDragging={id === drag.dragItemId}
              onDragHandlePointerDown={drag.onDragHandlePointerDown}
              activeResizeCorner={id === resizingId ? resizingCorner : null}
              onResizeHandlePointerDown={resize.onResizeHandlePointerDown}
              onTileElement={registerTileElement}
              heroOverlay={item.isSelected ? props.heroOverlay : undefined}
            />
          </MasonryAnchor>
        );
      })}
    </div>
  );
}
