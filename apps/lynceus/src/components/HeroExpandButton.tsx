/**
 * Direct expand-to-inspector affordance for the selected hero image.
 *
 * Intended mount point: a child of the selected hero-image wrapper in the
 * route (the same `data-selected-hero` element that hosts the timer pill),
 * composed into Masonry's `heroOverlay`. It sits top-middle — mirroring
 * where the timer pill sits at the bottom — and, like the pill, is inert
 * (pointer-events: none, faded) until the hero is hovered or keyboard
 * focused; App.css owns that reveal via `.selected-image-expand-btn`.
 *
 * Clicking opens the fullscreen inspector for the current selection
 * directly, without the two-click select-then-inspect dance. Pointer/click
 * propagation is stopped so it never triggers the tile's select/similar
 * click behind it.
 */
import { Maximize2 } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";

export interface HeroExpandButtonProps {
  onExpand: () => void;
}

export function HeroExpandButton({ onExpand }: HeroExpandButtonProps) {
  const stopHeroActivation = (
    event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
  };

  return (
    <button
      type="button"
      aria-label="Expand to fullscreen inspector"
      title="Expand to fullscreen inspector"
      onClick={(event) => {
        stopHeroActivation(event);
        onExpand();
      }}
      onPointerDown={stopHeroActivation}
      className="selected-image-expand-btn floating-surface absolute inset-x-0 top-4 z-20 mx-auto grid size-9 w-fit place-items-center rounded-full border shadow-[var(--shadow-float)]"
    >
      <Maximize2 className="size-4 text-primary" strokeWidth={1.8} />
    </button>
  );
}
