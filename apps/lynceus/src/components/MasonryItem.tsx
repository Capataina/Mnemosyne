import { memo } from "react";
import { ImageItem } from "../types";
import { motion } from "framer-motion";
import type { ResizeCorner } from "../hooks/useTileResize";
import { useAdaptiveThumbnail } from "../hooks/useAdaptiveThumbnail";

const RESIZE_CORNERS: Array<{
  corner: ResizeCorner;
  position: string;
  cursor: string;
}> = [
  { corner: "tl", position: "top-1 left-1", cursor: "cursor-nwse-resize" },
  { corner: "tr", position: "top-1 right-1", cursor: "cursor-nesw-resize" },
  { corner: "bl", position: "bottom-1 left-1", cursor: "cursor-nesw-resize" },
  { corner: "br", position: "bottom-1 right-1", cursor: "cursor-nwse-resize" },
];

interface MasonryItemProps {
  item: ImageItem;
  isSelected?: boolean;
  onClick: (item: ImageItem) => void;
  /** Reduce / disable animations per user setting. */
  animationLevel?: "subtle" | "standard" | "off";
  /** True when drag-to-reorder is available (adds the grab affordance). */
  reorderEnabled?: boolean;
  /** True while THIS tile is the one being drag-reordered. */
  isDragging?: boolean;
  /** Pointer went down on the tile body (drag-to-reorder start). */
  onDragHandlePointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Pointer went down on one of the four corner resize grips. */
  onResizeHandlePointerDown?: (
    corner: ResizeCorner,
    e: React.PointerEvent<HTMLDivElement>,
  ) => void;
  /** Which corner (if any) of THIS tile has an active resize drag. */
  activeResizeCorner?: ResizeCorner | null;
  /** The tile's current rendered CSS width, so it can request a
   *  thumbnail resolution that matches (crisp when stretched). */
  renderedWidth?: number;
}

/**
 * A single grid tile. Deliberately dumb: it renders the image at whatever
 * size its placement gives it (the smooth-resize preview drives that from
 * the engine) and exposes drag / resize affordances. framer-motion's
 * `layout` is what animates a tile sliding aside as a newly-thumbnailed
 * image pops into the feed, and the reorder reflow.
 *
 * The 3D-tilt hover gimmick and the amber corner-bracket handles from the
 * previous design are gone — the tilt caused the "yellow line" edge flare
 * (the global focus outline catching light through the 3D transform), and
 * both read as cheap. The resize grips here are neutral and functional;
 * the v2 visual pass restyles the whole tile against these same props.
 */
export const MasonryItem = memo(function MasonryItem(props: MasonryItemProps) {
  // Full resolution for the selected hero (needs clarity); an
  // adaptive-resolution thumbnail matched to the tile's rendered width
  // for grid tiles, so a stretched tile stays crisp without over-fetching
  // a 1-column tile.
  const adaptiveUrl = useAdaptiveThumbnail(props.item, props.renderedWidth ?? 0);
  const displayUrl = props.isSelected
    ? props.item.url
    : adaptiveUrl ?? props.item.thumbnailUrl ?? props.item.url;

  const animationLevel = props.animationLevel ?? "standard";

  return (
    <motion.div
      layout
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
      onPointerDown={
        props.reorderEnabled ? props.onDragHandlePointerDown : undefined
      }
      className={[
        "masonry-tile group relative overflow-hidden rounded-xl bg-card",
        "shadow-md transition-shadow duration-200 hover:shadow-xl",
        props.isSelected ? "ring-2 ring-foreground/25 shadow-2xl" : "",
        props.reorderEnabled
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-pointer",
        props.isDragging ? "z-50" : "",
      ].join(" ")}
    >
      <img
        className="w-full block"
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

      {/* Subtle dim on hover for non-selected tiles. */}
      {!props.isSelected && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors duration-200 pointer-events-none" />
      )}

      {/* Resize grips — all four corners. Neutral + functional; the v2
          visual pass owns the styling. Each stops propagation so it never
          starts a reorder drag or selects the image. */}
      {!props.isSelected &&
        RESIZE_CORNERS.map(({ corner, position, cursor }) => (
          <div
            key={corner}
            role="slider"
            aria-label={`Resize ${props.item.name} from the ${corner} corner`}
            aria-orientation="horizontal"
            aria-valuenow={1}
            onPointerDown={(e) => {
              e.stopPropagation();
              props.onResizeHandlePointerDown?.(corner, e);
            }}
            onClick={(e) => e.stopPropagation()}
            className={`absolute ${position} flex h-5 w-5 items-center justify-center ${cursor}`}
          >
            <span
              className={[
                "h-2.5 w-2.5 rounded-[3px] border border-white/80 bg-black/40 backdrop-blur-sm transition-opacity duration-150",
                props.activeResizeCorner === corner
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-70",
              ].join(" ")}
            />
          </div>
        ))}
    </motion.div>
  );
});
