import { ReactNode, useRef } from "react";
import { clsx } from "clsx";
import {
  LIVE_REFLOW_EASING,
  LIVE_REFLOW_MS,
  SETTLE_EASING,
  SETTLE_MS,
} from "./masonryMotion";

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
  /** Live gesture reflows track the pointer; settle reflows glide once. */
  motion: "live" | "settle";
  /** Whether the engine is committing the final dense gesture pack. */
  settling: boolean;
  /** Render a drop placeholder in this anchor's box. Used for the active
   * gesture tile, whose pixels float with the pointer and would otherwise
   * leave the reserved slot painting as bare background. */
  placeholder?: boolean;
}

export function MasonryAnchor(props: MasonryItemProps) {
  const transition = props.snap
    ? undefined
    : props.motion === "live"
      ? `transform ${LIVE_REFLOW_MS}ms ${LIVE_REFLOW_EASING}`
      : [
          `transform ${SETTLE_MS}ms ${SETTLE_EASING}`,
          `width ${SETTLE_MS}ms ${SETTLE_EASING}`,
          `height ${SETTLE_MS}ms ${SETTLE_EASING}`,
        ].join(", ");

  // Compositor promotion is scoped to anchors the settle actually MOVED —
  // promoting every visible anchor whenever any gesture settles is classic
  // will-change overuse (dozens of idle retina layers). The latch holds
  // through the glide (removing will-change mid-transition repaints) and
  // resets when settling ends. Render-phase ref writes are safe here: the
  // outputs are a pure function of the memo inputs, per the established
  // pattern in useMasonryEngine/useShuffledFeed.
  const prevPosRef = useRef({ x: props.x, y: props.y });
  const movedInSettleRef = useRef(false);
  if (!props.settling) {
    movedInSettleRef.current = false;
  } else if (
    prevPosRef.current.x !== props.x ||
    prevPosRef.current.y !== props.y
  ) {
    movedInSettleRef.current = true;
  }
  prevPosRef.current = { x: props.x, y: props.y };
  const promote =
    transition !== undefined &&
    props.motion === "settle" &&
    props.settling &&
    movedInSettleRef.current;

  return (
    <div
      className={clsx(
        "absolute",
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
        transition,
        willChange: promote ? "transform" : undefined,
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
