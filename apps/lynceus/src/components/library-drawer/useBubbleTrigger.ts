import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Interaction constants for both bubble panels (library + settings). Hosted
 * here rather than duplicated because the hover-open/pin-toggle contract is
 * identical for both triggers — settings/index.tsx imports this hook via
 * the library-drawer public barrel; see both folders' CLAUDE.md.
 */
export const BUBBLE_HOVER_ENTER_DELAY_MS = 150;
export const BUBBLE_HOVER_LEAVE_GRACE_MS = 300;

/** Pop-open motion: mirrors the grid's ease-out-expo idiom (masonryMotion.ts
 * SETTLE_EASING), scaled down for a compact chrome affordance rather than a
 * full-grid settle. */
export const BUBBLE_POP_MS = 165;
export const BUBBLE_POP_EASE = [0.16, 1, 0.3, 1] as const;

export interface BubbleTriggerProps {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

export interface BubblePanelProps {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export interface UseBubbleTriggerResult {
  /** Effective visibility: pinned OR mid-hover-intent. A hover-peek counts
   * as "open" for data-gating purposes (counts polling etc.) — callers that
   * gate a query on the panel being open should read this, not `pinned`. */
  open: boolean;
  pinned: boolean;
  togglePinned: () => void;
  /** Clears both pin and hover — Escape, outside click, and the other
   * bubble's mutual-exclusion effect all call this. */
  close: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  triggerProps: BubbleTriggerProps;
  panelProps: BubblePanelProps;
}

/**
 * Hover-open-with-intent + click-to-pin state machine shared by the library
 * and settings bubble panels. One instance per bubble, owned by the route
 * (the common ancestor of the trigger, which lives in TopBar, and the
 * panel, which renders alongside it) — the trigger and panel components
 * themselves stay presentational and just consume the returned props/refs.
 *
 * - Hovering the trigger opens after BUBBLE_HOVER_ENTER_DELAY_MS; leaving
 *   the trigger OR the panel schedules a close after
 *   BUBBLE_HOVER_LEAVE_GRACE_MS, giving diagonal travel from trigger to
 *   panel time to land before the panel disappears under the pointer.
 * - Clicking the trigger toggles `pinned`, which keeps the panel open
 *   regardless of hover and is the only thing that survives the pointer
 *   leaving both trigger and panel entirely.
 * - `close()` clears both hover and pin. Callers needing mutual exclusion
 *   between the two bubbles watch `open` and call the other's `close()`.
 */
export function useBubbleTrigger(): UseBubbleTriggerResult {
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const enterTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);

  const clearTimers = useCallback(() => {
    window.clearTimeout(enterTimer.current);
    window.clearTimeout(leaveTimer.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleOpen = useCallback(() => {
    clearTimers();
    enterTimer.current = window.setTimeout(
      () => setHovering(true),
      BUBBLE_HOVER_ENTER_DELAY_MS,
    );
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    leaveTimer.current = window.setTimeout(
      () => setHovering(false),
      BUBBLE_HOVER_LEAVE_GRACE_MS,
    );
  }, [clearTimers]);

  const cancelScheduledClose = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
  }, []);

  const togglePinned = useCallback(() => {
    clearTimers();
    setHovering(false);
    setPinned((p) => !p);
  }, [clearTimers]);

  const close = useCallback(() => {
    clearTimers();
    setHovering(false);
    setPinned(false);
  }, [clearTimers]);

  return {
    open: pinned || hovering,
    pinned,
    togglePinned,
    close,
    triggerRef,
    triggerProps: {
      onMouseEnter: scheduleOpen,
      onMouseLeave: scheduleClose,
      onClick: togglePinned,
    },
    panelProps: {
      onMouseEnter: cancelScheduledClose,
      onMouseLeave: scheduleClose,
    },
  };
}
