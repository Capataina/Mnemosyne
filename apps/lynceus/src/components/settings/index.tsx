import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { ThemeSection } from "./ThemeSection";
import { DisplaySection } from "./DisplaySection";
import { SearchSection } from "./SearchSection";
import { FoldersSection } from "./FoldersSection";
import { EncoderSection } from "./EncoderSection";
import { StatsSection } from "./StatsSection";
import { ResetSection } from "./ResetSection";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-out settings drawer from the right edge.
 *
 * Open via cmd/ctrl + , or via the gear icon next to the search bar.
 * Closes on Escape, click-outside, or × button.
 *
 * Sections (each lives in its own file under this directory):
 * 1. Theme
 * 2. Display (column count, tile scale, animation level)
 * 3. Search (similar / semantic result counts, tag filter mode)
 * 4. Folders (add / remove / toggle / list)
 * 5. Reset
 *
 * The shell here owns purely structural concerns: enter/exit animation,
 * backdrop click-to-dismiss, the Escape-key handler, header chrome, and
 * the scroll container. Each section consumes useUserPreferences (and the
 * roots hooks where applicable) directly so they remain testable in
 * isolation without prop-drilling.
 */
export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — click to dismiss */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
            className="fixed top-0 right-0 z-[91] flex h-[100dvh] w-[min(430px,100vw)] flex-col border-l border-border bg-card shadow-[var(--shadow-float)]"
          >
            {/* Header */}
            <div className="chrome-surface sticky top-0 z-10 flex items-center justify-between border-b px-6 py-[18px]">
              <div>
                <h2 className="text-[17px] font-[620] tracking-[-0.025em]">Settings</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Library, search, and display
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close settings"
                className="grid size-9 place-items-center rounded-[10px] text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-95"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 text-[12px]">
              <ThemeSection />
              <DisplaySection />
              <SearchSection />
              <FoldersSection />
              <EncoderSection />
              <StatsSection />
              <div className="pt-6">
                <ResetSection />
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
