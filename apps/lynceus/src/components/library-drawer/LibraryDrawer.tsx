import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LibraryBig } from "lucide-react";
import { useEffect, useRef } from "react";

import { BUBBLE_POP_EASE, BUBBLE_POP_MS } from "./useBubbleTrigger";
import { TagFilterList } from "./TagFilterList";
import { TagFolderList } from "./TagFolderList";
import type { LibraryDrawerProps } from "./types";

/**
 * Floating bubble panel, non-modal: pops out near the library trigger
 * (top-left of the header) rather than sliding a full-height scrimmed
 * drawer over the grid. See CLAUDE.md for the shared interaction contract
 * with the settings bubble (useBubbleTrigger) and the z-ladder position.
 */
export function LibraryDrawer({
  open,
  pinned,
  onClose,
  panelProps,
  triggerRef,
  tags,
  totalImageCount,
  activeTagId,
  includeTagIds,
  excludeTagIds,
  onSelectFolder,
  onSetTagFilter,
  onClearFilters,
  loading = false,
  errorMessage = null,
  id = "library-drawer",
}: LibraryDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const activeTag = tags.find((tag) => tag.id === activeTagId);

  // Escape + outside click close the bubble (unpins and cancels hover).
  // The trigger itself is excluded from the outside-click check — its own
  // onClick already toggles pin, so treating a trigger click as "outside"
  // would immediately re-close a panel that just opened.
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
  // trigger. Hover-peeks deliberately don't move focus — only a
  // deliberate (click or keyboard) pin does.
  useEffect(() => {
    if (pinned) {
      panelRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [pinned, triggerRef]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          id={id}
          tabIndex={-1}
          aria-labelledby={`${id}-title`}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: BUBBLE_POP_MS / 1000, ease: BUBBLE_POP_EASE }
          }
          className="floating-surface fixed left-5 top-[84px] z-[200] flex max-h-[min(640px,calc(100dvh-104px))] w-[360px] max-w-[calc(100vw-2.5rem)] origin-top-left flex-col overflow-hidden rounded-2xl border md:left-8 lg:left-10"
          {...panelProps}
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border/70 px-5 py-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary">
              <LibraryBig className="size-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <h2
                id={`${id}-title`}
                className="truncate text-[16px] font-[650] tracking-[-0.025em]"
              >
                Library
              </h2>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {activeTag ? activeTag.name : "All images"}
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {loading ? (
              <div aria-label="Loading tag folders" className="space-y-2">
                {Array.from({ length: 7 }, (_, index) => (
                  <div
                    key={index}
                    className="skeleton-tile h-9 rounded-[10px]"
                  />
                ))}
              </div>
            ) : errorMessage ? (
              <div
                role="alert"
                className="rounded-[10px] border border-destructive/25 bg-destructive/10 px-3 py-3 text-[11px] leading-relaxed text-destructive"
              >
                {errorMessage}
              </div>
            ) : (
              <div className="space-y-6">
                <TagFolderList
                  tags={tags}
                  totalImageCount={totalImageCount}
                  activeTagId={activeTagId}
                  onSelectFolder={onSelectFolder}
                />

                <div className="h-px bg-border" />

                <TagFilterList
                  tags={tags}
                  activeTagId={activeTagId}
                  includeTagIds={includeTagIds}
                  excludeTagIds={excludeTagIds}
                  onSetTagFilter={onSetTagFilter}
                  onClearFilters={onClearFilters}
                />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
