import { memo, useState, useCallback, useRef } from "react";
import { ImageItem } from "../types";
import { motion } from "framer-motion";

/** Which corner of a tile a resize drag started from. Only the
 *  left/right side matters for the actual span math (there's no row
 *  span, so top vs bottom don't change behaviour) — top and bottom
 *  variants exist so a handle is reachable from whichever corner is
 *  physically closest to the pointer. */
export type ResizeCorner = "tl" | "tr" | "bl" | "br";

const RESIZE_CORNERS: Array<{
  corner: ResizeCorner;
  position: string;
  rotation: string;
}> = [
  { corner: "tl", position: "-top-1 -left-1", rotation: "rotate-180" },
  { corner: "tr", position: "-top-1 -right-1", rotation: "-rotate-90" },
  { corner: "bl", position: "-bottom-1 -left-1", rotation: "rotate-90" },
  { corner: "br", position: "-bottom-1 -right-1", rotation: "rotate-0" },
];

interface MasonryItemProps {
  item: ImageItem;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  onClick: (item: ImageItem) => void;
  onContextMenu?: (item: ImageItem, x: number, y: number) => void;
  animationDelay: number;
  /** Reduce / disable animations per user setting */
  animationLevel?: "subtle" | "standard" | "off";
  /** True while "custom" sort mode + unfiltered catalogue make
   *  drag-to-reorder available. Adds the grab affordance to the tile
   *  itself. */
  reorderEnabled?: boolean;
  /** True while THIS tile is the one currently being dragged. */
  isDragging?: boolean;
  /** Pointer went down on the tile body (drag-to-reorder start). */
  onDragHandlePointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Pointer went down on one of the four corner resize grips. */
  onResizeHandlePointerDown?: (
    corner: ResizeCorner,
    e: React.PointerEvent<HTMLDivElement>,
  ) => void;
  /** Which corner (if any) of THIS tile currently has an active resize
   *  drag. Null/undefined when not resizing. */
  activeResizeCorner?: ResizeCorner | null;
}

/**
 * MasonryItem displays an image in the grid.
 *
 * Uses thumbnailUrl for faster loading; falls through to the full URL
 * only when the image is the active hero card (selected). 3D tilt on
 * hover responds to mouse position; the magnitude is configurable
 * via the animationLevel prop so the user can tone it down or off.
 *
 * Multi-select highlight uses the warm amber accent token to indicate
 * inclusion in a bulk-tag operation.
 */
export const MasonryItem = memo(function MasonryItem(props: MasonryItemProps) {
  // Use full resolution for selected image (it's bigger, needs clarity).
  // Use thumbnail for grid items (much faster loading + content-visibility friendly).
  const displayUrl = props.isSelected
    ? props.item.url
    : (props.item.thumbnailUrl || props.item.url);

  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const animationLevel = props.animationLevel ?? "standard";
  // Tilt magnitudes — keep subtle. Standard is 3°, the previous 6° was
  // too much. Subtle drops to 1.5°, off disables tilt entirely.
  const maxTilt =
    animationLevel === "off" ? 0 : animationLevel === "subtle" ? 1.5 : 3;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cardRef.current || maxTilt === 0) return;

      const rect = cardRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const percentX = (e.clientX - centerX) / (rect.width / 2);
      const percentY = (e.clientY - centerY) / (rect.height / 2);

      setTilt({
        rotateX: -percentY * maxTilt,
        rotateY: percentX * maxTilt,
      });
    },
    [maxTilt],
  );

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setTilt({ rotateX: 0, rotateY: 0 });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (props.onContextMenu) {
        e.preventDefault();
        props.onContextMenu(props.item, e.clientX, e.clientY);
      }
    },
    [props.onContextMenu, props.item],
  );

  return (
    <motion.div
      ref={cardRef}
      layout
      // Use spring physics for layout transitions instead of an ease curve.
      // Stiffer spring = snappier "rearrange" feel as the grid reflows
      // when an image is selected or filtered.
      transition={
        animationLevel === "off"
          ? { duration: 0 }
          : {
              type: "spring",
              stiffness: 350,
              damping: 35,
              mass: 0.8,
              delay: props.animationDelay,
            }
      }
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{
        opacity: props.isDragging ? 0.6 : 1,
        scale: props.isDragging ? 0.96 : 1,
      }}
      exit={{ opacity: 0, scale: 0.97 }}
      onClick={() => props.onClick(props.item)}
      onContextMenu={handleContextMenu}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDown={
        props.reorderEnabled ? props.onDragHandlePointerDown : undefined
      }
      className={[
        "masonry-tile group",
        props.reorderEnabled ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        props.isDragging ? "z-50" : "",
      ].join(" ")}
      style={{
        perspective: "1000px",
      }}
    >
      <motion.div
        animate={{
          rotateX: isHovered ? tilt.rotateX : 0,
          rotateY: isHovered ? tilt.rotateY : 0,
          scale: isHovered ? (props.isSelected ? 1.015 : 1.02) : 1,
        }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 25,
          mass: 0.5,
        }}
        style={{
          transformStyle: "preserve-3d",
        }}
        className={[
          "relative overflow-hidden rounded-xl bg-card transition-shadow duration-200",
          props.isMultiSelected
            ? "ring-2 ring-primary shadow-lg shadow-primary/20"
            : props.isSelected
              ? "ring-2 ring-primary/60 shadow-2xl"
              : isHovered
                ? "shadow-xl"
                : "shadow-md",
        ].join(" ")}
      >
        <img
          className="w-full block"
          src={displayUrl}
          alt={props.item.name}
          loading={props.isSelected ? "eager" : "lazy"}
          decoding="async"
          // <img> is natively draggable in every browser/webview unless
          // told otherwise. Without this, starting a drag (reorder OR
          // resize) over the image itself hands the gesture to the
          // browser's own HTML5 drag-and-drop instead of our pointer
          // handlers — which is exactly the "shows a + cursor and
          // nothing happens" symptom, since native drag consumes the
          // pointer stream and our pointermove/pointerup listeners
          // never see it.
          draggable={false}
        />

        {/* Subtle dimming on hover for non-selected tiles. Selected
            and multi-select states already have ring affordances. */}
        {!props.isSelected && !props.isMultiSelected && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors duration-200 pointer-events-none" />
        )}

        {/* Multi-select indicator — small filled circle in the top-left */}
        {props.isMultiSelected && (
          <div className="absolute top-2 left-2 h-5 w-5 rounded-full bg-primary border-2 border-background shadow-md" />
        )}

        {/* Resize grips — all four corners, each a small curved bracket
            sitting right at the actual corner. Dragging any of them
            widens/narrows the tile's column span (there's no row-span
            concept, so top vs bottom corners behave identically —
            left corners just invert the drag direction so "away from
            the tile" always grows regardless of which corner you
            grabbed). Preserves aspect ratio by construction:
            masonryPacking always scales height from the placed width,
            span-driven or not, so this never distorts the image — it
            only changes how many columns it occupies. Hidden on the
            hero card, which already spans via a separate promotion
            mechanism.
            The hit zone (20px) is deliberately modest — four of these
            now exist per tile, and an oversized zone at every corner
            would eat too far into the area the tile needs to stay
            grabbable for drag-to-reorder. */}
        {!props.isSelected &&
          RESIZE_CORNERS.map(({ corner, position, rotation }) => (
            <div
              key={corner}
              role="slider"
              aria-label={`Resize ${props.item.name} from the ${corner} corner`}
              aria-orientation="horizontal"
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onResizeHandlePointerDown?.(corner, e);
              }}
              onClick={(e) => {
                // A click landing squarely on a handle must never
                // reach the tile's own onClick (which selects the
                // image) — this is the direct case; the "pointer
                // strayed off the handle mid-drag" case is handled by
                // Masonry.tsx's suppressNextClickRef instead, since by
                // then the click's target may not even be this
                // element.
                e.stopPropagation();
              }}
              className={`absolute ${position} h-5 w-5 cursor-ew-resize flex items-center justify-center`}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 11 11"
                className={[
                  rotation,
                  "transition-opacity duration-150",
                  props.activeResizeCorner === corner
                    ? "opacity-100 text-primary"
                    : "opacity-0 group-hover:opacity-70 text-white",
                ].join(" ")}
              >
                {/* A quarter-circle bow hugging the corner — a curved
                    bracket rather than a filled shape, so it reads as
                    "grab here to resize" without looking like a
                    selection dot. */}
                <path
                  d="M2 2 A6.5 6.5 0 0 1 9 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          ))}
      </motion.div>
    </motion.div>
  );
});
