import { memo, useState, useCallback, useRef } from "react";
import { ImageItem } from "../types";
import { motion } from "framer-motion";

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
  /** Pointer went down on the corner resize grip (drag-to-resize start). */
  onResizeHandlePointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** True while THIS tile's resize grip is being dragged. */
  isResizing?: boolean;
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

        {/* Resize grip — hold and drag horizontally to widen/narrow the
            tile's column span. Preserves aspect ratio by construction:
            masonryPacking always scales height from the placed width,
            span-driven or not, so this handle never distorts the
            image — it only changes how many columns it occupies.
            Hidden on the hero card, which already spans via a
            separate promotion mechanism. */}
        {!props.isSelected && (
          // Oversized invisible hit zone around a small visible glyph:
          // the 16px grip was hard to land a pointer on precisely, so
          // pointerdown kept slipping onto the image next to it. The
          // outer div is the real (larger) interactive target; the
          // inner div is what's actually drawn.
          <div
            role="slider"
            aria-label={`Resize ${props.item.name}`}
            aria-orientation="horizontal"
            onPointerDown={(e) => {
              e.stopPropagation();
              props.onResizeHandlePointerDown?.(e);
            }}
            onClick={(e) => {
              // A click landing squarely on the handle must never
              // reach the tile's own onClick (which selects the
              // image) — this is the direct case; the "pointer
              // strayed off the handle mid-drag" case is handled by
              // Masonry.tsx's suppressNextClickRef instead, since by
              // then the click's target may not even be this element.
              e.stopPropagation();
            }}
            className="absolute -bottom-1 -right-1 h-7 w-7 cursor-ew-resize flex items-center justify-center"
          >
            <div
              className={[
                "h-4 w-4 rounded-sm flex items-center justify-center transition-opacity duration-150",
                props.isResizing
                  ? "opacity-100 bg-primary"
                  : "opacity-0 group-hover:opacity-80 bg-black/50 hover:bg-primary",
              ].join(" ")}
            >
              <div className="h-2 w-0.5 rounded-full bg-white/90" />
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
});
