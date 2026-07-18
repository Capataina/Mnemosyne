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
      {props.children}
    </div>
  );
}
