import { ReactNode } from "react";
import { clsx } from "clsx";

interface MasonryItemProps {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  children: ReactNode;
  visible?: boolean;
  onTop: boolean;
  /** Disable committed-geometry transitions while the active tile's inner
   * cosmetic wrapper follows the pointer or settles to this anchor. */
  snap?: boolean;
  /** Render a drop placeholder in this anchor's box. Used for the active
   * gesture tile, whose pixels float with the pointer and would otherwise
   * leave the reserved slot painting as bare background. */
  placeholder?: boolean;
}

export function MasonryAnchor(props: MasonryItemProps) {
  return (
    <div
      className={clsx(
        "absolute",
        !props.snap &&
          "transition-[transform,width,height] duration-400 ease-in-out",
        props.visible == false && "invisible",
        props.onTop && "z-50",
      )}
      data-masonry-id={props.id}
      data-masonry-x={props.x}
      data-masonry-y={props.y}
      data-masonry-width={props.width}
      data-masonry-height={props.height}
      style={{
        left: 0,
        top: 0,
        transform: `translate(${props.x}px, ${props.y}px)`,
        width: props.width,
        height: props.height,
      }}
    >
      {props.placeholder && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[14px] bg-foreground/[0.05] ring-1 ring-inset ring-foreground/15"
        />
      )}
      {props.children}
    </div>
  );
}
