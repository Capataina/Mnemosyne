import { ReactNode } from "react";
import { clsx } from "clsx";

interface MasonryItemProps {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
  visible?: boolean;
  onTop: boolean;
  /** Disable the position transition — used for the tile under an active
   *  resize so its (left-anchored) x tracks the pointer instantly instead
   *  of easing over 400ms. */
  snap?: boolean;
}

export function MasonryAnchor(props: MasonryItemProps) {
  return (
    <div
      className={clsx(
        "absolute",
        !props.snap && "transition-transform duration-400 ease-in-out",
        props.visible == false && "invisible",
        props.onTop && "z-50"
      )}
      style={{
        left: 0,
        top: 0,
        transform: `translate(${props.x}px, ${props.y}px)`,
        width: props.width,
      }}
    >
      {props.children}
    </div>
  );
}
