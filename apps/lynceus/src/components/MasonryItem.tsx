import { memo, useCallback } from "react";
import { FeedItem } from "../types";
import { motion } from "framer-motion";
import type { ResizeCorner } from "../hooks/useTileResize";
import { useAdaptiveThumbnail } from "../hooks/useAdaptiveThumbnail";

const RESIZE_CORNERS: Array<{
  corner: ResizeCorner;
  position: string;
  cursor: string;
  bracket: string;
}> = [
  {
    corner: "tl",
    position: "top-0 left-0",
    cursor: "cursor-nwse-resize",
    bracket: "border-l border-t rounded-tl-[5px]",
  },
  {
    corner: "tr",
    position: "top-0 right-0",
    cursor: "cursor-nesw-resize",
    bracket: "border-r border-t rounded-tr-[5px]",
  },
  {
    corner: "bl",
    position: "bottom-0 left-0",
    cursor: "cursor-nesw-resize",
    bracket: "border-l border-b rounded-bl-[5px]",
  },
  {
    corner: "br",
    position: "bottom-0 right-0",
    cursor: "cursor-nwse-resize",
    bracket: "border-r border-b rounded-br-[5px]",
  },
];

interface MasonryItemProps {
  item: FeedItem;
  isSelected?: boolean;
  onClick: (item: FeedItem) => void;
  /** Fired on pointer-enter — used to prefetch the tile's similar-set. */
  onHover?: (id: number) => void;
  /** Reduce / disable animations per user setting. */
  animationLevel?: "subtle" | "standard" | "off";
  /** True when drag-to-reorder is available (adds the grab affordance). */
  reorderEnabled?: boolean;
  /** True when resize grips are available. Disabled with reorder while a
   * hero/search/filter view is active so no gesture can displace the hero. */
  resizeEnabled?: boolean;
  /** True while THIS tile is the one being drag-reordered. */
  isDragging?: boolean;
  /** Pointer went down on the tile body (drag-to-reorder start). */
  onDragHandlePointerDown?: (
    id: number,
    e: React.PointerEvent<HTMLDivElement>,
  ) => void;
  /** Pointer went down on one of the four corner resize grips. */
  onResizeHandlePointerDown?: (
    id: number,
    corner: ResizeCorner,
    e: React.PointerEvent<HTMLDivElement>,
  ) => void;
  /** Which corner (if any) of THIS tile has an active resize drag. */
  activeResizeCorner?: ResizeCorner | null;
  /** The tile's current rendered CSS width, so it can request a
   *  thumbnail resolution that matches (crisp when stretched). */
  renderedWidth?: number;
  /** Registers the active-only cosmetic wrapper used for pointer-exact
   * drag/resize visuals. Committed geometry remains on MasonryAnchor. */
  onTileElement?: (id: number, node: HTMLElement | null) => void;
  /** Rendered inside the selected hero's tile only (the quick-start timer
   *  pill). The host marks the tile `data-selected-hero`, whose hover /
   *  focus-within state drives the overlay's CSS reveal. */
  heroOverlay?: React.ReactNode;
}

/**
 * A single grid tile. Deliberately dumb: it renders the image at whatever
 * size its packed placement gives it and exposes drag / resize affordances.
 * MasonryAnchor owns committed geometry. The plain wrapper below may carry a
 * temporary active-only transform/size delta so direct manipulation follows
 * the pointer while the anchor continues to expose packed telemetry.
 *
 * The 3D-tilt hover gimmick and the amber corner-bracket handles from the
 * previous design are gone — the tilt caused the "yellow line" edge flare
 * (the global focus outline catching light through the 3D transform), and
 * both read as cheap. The resize grips here are neutral and functional;
 * the v2 visual pass restyles the whole tile against these same props.
 */
/**
 * Custom memo comparator. The default shallow compare breaks on every
 * catalogue refetch because react-query hands back a fresh `item` object even
 * when its values are identical, re-rendering every visible tile during an
 * indexing run (T2-1). We compare `item`'s pixel-affecting fields by value and
 * everything else by reference.
 *
 * The field list below must stay in sync with `MasonryItemProps` and with what
 * this component (and `useAdaptiveThumbnail`) actually reads:
 *  - item.{id,url,thumbnailUrl,hasThumbnail}  → displayUrl / adaptive bucket
 *  - item.{width,height}                       → packed footprint / aspect
 *  - item.name                                 → alt text + resize-grip aria
 *  - isSelected, animationLevel, reorderEnabled, resizeEnabled, isDragging,
 *    activeResizeCorner, renderedWidth         → scalar render inputs
 *  - onClick/onHover/onDragHandlePointerDown/onResizeHandlePointerDown/
 *    onTileElement                              → callbacks, stable by reference
 *    once the route (T2-1 step 1) and Masonry useCallback them; a ref change is
 *    a genuine handler swap and correctly re-renders.
 *  - heroOverlay                               → by reference; the route
 *    memoises the pill element, so identity only changes when its inputs do
 *    (and it is undefined for every non-hero tile).
 * A field that affects output but is missing here would hide a real update, so
 * any new render-affecting prop must be added to both the type and this list.
 */
function propsAreEqual(prev: MasonryItemProps, next: MasonryItemProps): boolean {
  const a = prev.item;
  const b = next.item;
  return (
    a.id === b.id &&
    a.url === b.url &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.hasThumbnail === b.hasThumbnail &&
    a.width === b.width &&
    a.height === b.height &&
    a.name === b.name &&
    prev.isSelected === next.isSelected &&
    prev.animationLevel === next.animationLevel &&
    prev.reorderEnabled === next.reorderEnabled &&
    prev.resizeEnabled === next.resizeEnabled &&
    prev.isDragging === next.isDragging &&
    prev.activeResizeCorner === next.activeResizeCorner &&
    prev.renderedWidth === next.renderedWidth &&
    prev.onClick === next.onClick &&
    prev.onHover === next.onHover &&
    prev.onDragHandlePointerDown === next.onDragHandlePointerDown &&
    prev.onResizeHandlePointerDown === next.onResizeHandlePointerDown &&
    prev.onTileElement === next.onTileElement &&
    prev.heroOverlay === next.heroOverlay
  );
}

export const MasonryItem = memo(function MasonryItem(props: MasonryItemProps) {
  const itemId = props.item.id;
  const registerTileElement = useCallback(
    (node: HTMLDivElement | null) => props.onTileElement?.(itemId, node),
    [itemId, props.onTileElement],
  );

  // Full resolution for the selected hero (needs clarity); an
  // adaptive-resolution thumbnail matched to the tile's rendered width
  // for grid tiles, so a stretched tile stays crisp without over-fetching
  // a 1-column tile.
  const adaptiveUrl = useAdaptiveThumbnail(props.item, props.renderedWidth ?? 0);
  const displayUrl = props.isSelected
    ? props.item.url
    : adaptiveUrl ?? props.item.thumbnailUrl ?? props.item.url;

  const animationLevel = props.animationLevel ?? "standard";
  // Whether THIS tile is under an active gesture (used to suppress the
  // pop-in `initial`/`animate` motion while its plain wrapper follows the
  // pointer outside React; see the motion.div below.
  const gestureActive = props.isDragging || props.activeResizeCorner != null;

  return (
    // Committed geometry lives on MasonryAnchor. During one active gesture,
    // this wrapper alone carries the pointer-exact cosmetic delta.
    <div
      ref={registerTileElement}
      // The hero overlay (quick-start pill) mounts on THIS wrapper, not the
      // inner tile: the tile is overflow-hidden and would clip the pill's
      // bottom-edge overhang. data-selected-hero drives the pill's CSS
      // hover/focus reveal (App.css).
      data-selected-hero={
        props.isSelected && props.heroOverlay ? true : undefined
      }
      className={
        props.isSelected && props.heroOverlay
          ? "relative h-full w-full"
          : "h-full w-full"
      }
    >
      <motion.div
        // NO `layout`. Committed grid position belongs to MasonryAnchor's CSS
        // transition; active pointer delta belongs to the plain wrapper.
        // framer's
        // `layout` here was a SECOND position animator: because this motion.div
        // sits inside the anchor, when the anchor's translate moved the tile,
        // framer measured a screen-position change it hadn't caused and
        // FLIP-animated it too, on a spring curve fighting the anchor's
        // ease-in-out. The two resolved asymmetrically — a move down blended,
        // a move up snapped ("teleport"). Dropping `layout` leaves the anchor
        // as the sole committed-position owner and removes a
        // per-tile getBoundingClientRect every reflow (a perf win). This
        // motion.div now owns ONLY the pop-in / drag feedback (opacity+scale),
        // which never conflicts. gestureActive skips the pop-in for the tile
        // whose wrapper is being driven imperatively.
        transition={
          animationLevel === "off"
            ? { duration: 0 }
            : { type: "spring", stiffness: 350, damping: 35, mass: 0.8 }
        }
        initial={gestureActive ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: props.isDragging ? 0.72 : 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={() => props.onClick(props.item)}
        onMouseEnter={() => props.onHover?.(props.item.id)}
        onPointerDown={
          props.reorderEnabled && props.onDragHandlePointerDown
            ? (e) => props.onDragHandlePointerDown?.(itemId, e)
            : undefined
        }
        className={[
          "masonry-tile group relative isolate h-full overflow-hidden rounded-[14px] bg-surface-sunken",
          "ring-1 ring-inset ring-border transition-[box-shadow,filter] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-float)]",
          props.isSelected
            ? "ring-2 ring-primary/70 shadow-[var(--shadow-float)]"
            : "hover:ring-border-strong",
          props.reorderEnabled
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-pointer",
          props.isDragging ? "z-50" : "",
        ].join(" ")}
      >
        <img
          className="block h-full w-full select-none object-cover transition-[filter] duration-300 ease-out group-hover:brightness-[1.025]"
          src={displayUrl}
          alt={props.item.name}
          loading={props.isSelected ? "eager" : "lazy"}
          decoding="async"
          // <img> is natively draggable in every webview unless told
          // otherwise — without this, a drag started over the image hands
          // the gesture to the browser's HTML5 drag (the "+ cursor and
          // nothing happens" symptom) and our pointer handlers never fire.
          draggable={false}
        />

        {/* A quiet edge treatment gives the image material definition without
            putting labels or decorative chrome over the artwork. */}
        {!props.isSelected && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-foreground/[0.035] via-transparent to-background/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        )}

        <div
          className={[
            "pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset transition-colors duration-300",
            props.isSelected ? "ring-primary/45" : "ring-foreground/[0.04]",
          ].join(" ")}
        />

        {/* Resize grips — all four corners. Neutral + functional; the v2
            visual pass owns the styling. Each stops propagation so it never
            starts a reorder drag or selects the image. */}
        {props.resizeEnabled &&
          !props.isSelected &&
          RESIZE_CORNERS.map(({ corner, position, cursor, bracket }) => (
            <div
              key={corner}
              role="slider"
              aria-label={`Resize ${props.item.name} from the ${corner} corner`}
              aria-orientation="horizontal"
              aria-valuenow={1}
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onResizeHandlePointerDown?.(itemId, corner, e);
              }}
              onClick={(e) => e.stopPropagation()}
              className={`absolute z-10 ${position} flex h-8 w-8 items-center justify-center ${cursor}`}
            >
              <span
                className={[
                  `h-3 w-3 ${bracket} transition-[opacity,transform,border-color] duration-200 ease-out`,
                  props.activeResizeCorner === corner
                    ? "scale-110 border-primary opacity-100"
                    : "scale-90 border-foreground/80 opacity-0 group-hover:scale-100 group-hover:opacity-75",
                ].join(" ")}
              />
            </div>
          ))}
      </motion.div>

      {/* Quick-start timer pill — hero only, outside the clipped tile so its
          bottom-edge overhang survives; CSS reveals it on hover/focus-within
          of this data-selected-hero wrapper. */}
      {props.isSelected ? props.heroOverlay : null}
    </div>
  );
}, propsAreEqual);
