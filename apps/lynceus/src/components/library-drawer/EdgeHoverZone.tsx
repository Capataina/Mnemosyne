import { cn } from "@/lib/utils";

import { BUBBLE_EDGE_HOTZONE_PX } from "./useBubbleTrigger";

export interface EdgeHoverZoneProps {
  /** Which screen edge this strip runs along — left for the library panel,
   * right for settings. */
  side: "left" | "right";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Thin invisible hover strip flush against a screen edge, feeding the SAME
 * hover-intent handlers useBubbleTrigger hands the trigger button
 * (`triggerProps.onMouseEnter`/`onMouseLeave`) — hovering the bare screen
 * edge opens the panel exactly like hovering the TopBar icon does. Always
 * mounted (not gated on `open`), since its whole job is to open a closed
 * panel; LibraryDrawer.tsx / settings/index.tsx render it as a sibling of
 * the AnimatePresence-gated panel.
 *
 * Sits in the grid-chrome z-tier (10-50, see ui/dialog.tsx) — above the
 * grid, below the detail modal (100) and the panel itself (200). Once the
 * panel slides out it physically covers this strip at the same edge, so
 * further hover/leave over that pixel range is handled by the panel's own
 * `panelProps`, not this zone.
 */
export function EdgeHoverZone({ side, onMouseEnter, onMouseLeave }: EdgeHoverZoneProps) {
  return (
    <div
      aria-hidden="true"
      data-testid={`${side}-edge-hotzone`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ width: BUBBLE_EDGE_HOTZONE_PX }}
      className={cn(
        "fixed top-[84px] bottom-3 z-[45]",
        side === "left" ? "left-0" : "right-0",
      )}
    />
  );
}
