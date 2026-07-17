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
  /** Registers the plain wrapper used for imperative gesture transforms. */
  onTileElement?: (id: number, node: HTMLElement | null) => void;
}

/**
 * A single grid tile. Deliberately dumb: it renders the image at whatever
 * size its packed placement gives it and exposes drag / resize affordances.
 * The plain wrapper applies the active tile's continuous gesture preview.
 * Framer Motion's `layout` animates every other tile sliding aside as a
 * newly-thumbnailed image pops into the feed, and during reorder reflow.
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
 *  - isSelected, animationLevel, reorderEnabled, isDragging,
 *    activeResizeCorner, renderedWidth         → scalar render inputs
 *  - onClick/onHover/onDragHandlePointerDown/onResizeHandlePointerDown/
 *    onTileElement                             → callbacks, stable by reference
 *    once the route (T2-1 step 1) and Masonry useCallback them; a ref change is
 *    a genuine handler swap and correctly re-renders.
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
    prev.isDragging === next.isDragging &&
    prev.activeResizeCorner === next.activeResizeCorner &&
    prev.renderedWidth === next.renderedWidth &&
    prev.onClick === next.onClick &&
    prev.onHover === next.onHover &&
    prev.onDragHandlePointerDown === next.onDragHandlePointerDown &&
    prev.onResizeHandlePointerDown === next.onResizeHandlePointerDown &&
    prev.onTileElement === next.onTileElement
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
  // While THIS tile is being resized or dragged it must track the pointer
  // 1:1 — framer-motion's layout animation would otherwise ease its box
  // toward each new position/size, which reads as the tile lagging behind
  // the cursor. Every other tile keeps `layout` for smooth reflow + pop-in.
  const gestureActive = props.isDragging || props.activeResizeCorner != null;

  return (
    // The wrapper owns the imperative translate3d/width preview. Keeping it
    // outside motion.div is essential: Framer Motion may use the inner
    // element's transform for layout/scale, and two writers on one transform
    // would make the active tile jump or lag. Only this one wrapper changes on
    // continuous pointer frames; React and Motion keep owning everything else.
    <div
      ref={registerTileElement}
      data-masonry-id={itemId}
      className="w-full"
    >
      <motion.div
        layout={!gestureActive}
        transition={
          animationLevel === "off"
            ? { duration: 0 }
            : { type: "spring", stiffness: 350, damping: 35, mass: 0.8 }
        }
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{
          opacity: props.isDragging ? 0.6 : 1,
          scale: props.isDragging ? 0.98 : 1,
        }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={() => props.onClick(props.item)}
        onMouseEnter={() => props.onHover?.(props.item.id)}
        onPointerDown={
          props.reorderEnabled && props.onDragHandlePointerDown
            ? (e) => props.onDragHandlePointerDown?.(itemId, e)
            : undefined
        }
        className={[
          "masonry-tile group relative isolate overflow-hidden rounded-[14px] bg-surface-sunken",
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
          className="block w-full select-none transition-[filter] duration-300 ease-out group-hover:brightness-[1.025]"
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
        {!props.isSelected &&
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
    </div>
  );
}, propsAreEqual);
