import { AnimatePresence, motion } from "framer-motion";
import { LibraryBig, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { TagFilterList } from "./TagFilterList";
import { TagFolderList } from "./TagFolderList";
import type { LibraryDrawerProps } from "./types";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function LibraryDrawer({
  open,
  onClose,
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
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeTag = tags.find((tag) => tag.id === activeTagId);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-md"
            onPointerDown={onClose}
          />

          <motion.aside
            ref={panelRef}
            id={id}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
            className="floating-surface fixed top-0 left-0 z-[91] flex h-[100dvh] w-[360px] max-w-full flex-col border-r"
          >
            <header className="chrome-surface flex items-center justify-between border-b px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
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
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close library"
                className="grid size-9 place-items-center rounded-[10px] text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-95"
                onClick={onClose}
              >
                <X className="size-4" strokeWidth={1.8} />
              </button>
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
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
