import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useOnboarding } from "../../features/onboarding";
import {
  BUBBLE_SLIDE_EASE,
  BUBBLE_SLIDE_MS,
  EdgeHoverZone,
} from "@/components/library-drawer";
import type { BubblePanelProps, BubbleTriggerProps } from "@/components/library-drawer";
import { ThemeSection } from "./ThemeSection";
import { DisplaySection } from "./DisplaySection";
import { SearchSection } from "./SearchSection";
import { FoldersSection } from "./FoldersSection";
import { EncoderSection } from "./EncoderSection";
import { StatsSection } from "./StatsSection";
import { ResetSection } from "./ResetSection";

export { SettingsMenuButton } from "./SettingsMenuButton";
export type { SettingsMenuButtonProps } from "./SettingsMenuButton";

interface SettingsDrawerProps {
  /** Effective visibility (pinned OR hovered) — from useBubbleTrigger.open. */
  open: boolean;
  /** True only when click-pinned — drives focus-in-on-open; hover-peeks
   * don't steal focus. */
  pinned: boolean;
  /** Clears pin + hover — wired to Escape and outside click. */
  onClose: () => void;
  /** Pointer handlers from useBubbleTrigger.panelProps, so the panel can
   * cancel a pending close while the pointer travels onto it. */
  panelProps: BubblePanelProps;
  /** The trigger button's ref, so closing can return focus to it. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Trigger hover/click handlers from useBubbleTrigger.triggerProps —
   * forwarded to the panel's own EdgeHoverZone so hovering the bare screen
   * edge opens it exactly like hovering the gear icon does. */
  triggerProps: BubbleTriggerProps;
  id?: string;
}

/**
 * Edge slide-out settings panel, non-modal: anchored flush to the screen's
 * right edge, sliding in on hover-with-intent rather than popping open
 * near the gear icon or sliding a full-height scrimmed drawer over the
 * grid.
 *
 * Open via cmd/ctrl + , or hover/click on the gear icon.
 * Closes on Escape, outside click, or re-clicking the trigger.
 *
 * Sections (each lives in its own file under this directory):
 * 1. Theme
 * 2. Display (column count, tile scale, animation level)
 * 3. Search (similar / semantic result counts, tag filter mode)
 * 4. Folders (add / remove / toggle / list)
 * 5. Encoder and library statistics
 * 6. Tutorial replay and reset controls
 *
 * The shell here owns purely structural concerns: enter/exit animation,
 * Escape/outside-click dismiss, header chrome, and the scroll container.
 * Each section consumes useUserPreferences (and the roots hooks where
 * applicable) directly so they remain testable in isolation without
 * prop-drilling.
 */
export function SettingsDrawer({
  open,
  pinned,
  onClose,
  panelProps,
  triggerRef,
  triggerProps,
  id = "settings-panel",
}: SettingsDrawerProps) {
  const { restart } = useOnboarding();
  const restartRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  // Escape + outside click close the bubble. The trigger is excluded from
  // the outside-click check — its own onClick already toggles pin.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose, triggerRef]);

  // Pin-open moves focus into the panel; closing returns it to the
  // trigger. Hover-peeks deliberately don't move focus.
  useEffect(() => {
    if (pinned) {
      panelRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [pinned, triggerRef]);

  return (
    <>
      <EdgeHoverZone
        side="right"
        onMouseEnter={triggerProps.onMouseEnter}
        onMouseLeave={triggerProps.onMouseLeave}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            id={id}
            tabIndex={-1}
            aria-labelledby={`${id}-title`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: BUBBLE_SLIDE_MS / 1000, ease: BUBBLE_SLIDE_EASE }
            }
            className="floating-surface fixed right-0 top-[84px] bottom-3 z-[200] flex w-[min(430px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-l-2xl border border-r-0"
            {...panelProps}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-6 py-[18px]">
              <div>
                <h2
                  id={`${id}-title`}
                  className="text-[17px] font-[620] tracking-[-0.025em]"
                >
                  Settings
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Library, search, and display
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 text-[12px]">
              <ThemeSection />
              <DisplaySection />
              <SearchSection />
              <FoldersSection />
              <EncoderSection />
              <StatsSection />
              <div className="flex flex-col gap-2 pt-6">
                <button
                  ref={restartRef}
                  type="button"
                  onClick={() => {
                    // The panel deliberately STAYS open: it sits under the
                    // z-240 onboarding overlay and goes inert with the rest
                    // of the app, so it cannot be interacted with during the
                    // replay — but its Restart button stays mounted, which is
                    // what lets the provider's close path restore focus to
                    // it. Closing the panel here put the trigger on a
                    // one-way unmount and broke focus restoration in every
                    // realistic timing.
                    restart(restartRef.current);
                  }}
                  className="flex h-10 w-full items-center justify-start gap-2 rounded-[10px] border border-border bg-transparent px-3 text-[11.5px] font-[580] text-foreground transition-[color,background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98]"
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Restart onboarding
                </button>
                <ResetSection />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
