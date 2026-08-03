/**
 * Section header shown while viewing an image's similar-set: the similarity
 * breadcrumb trail (dived-through images, click to rewind) plus the "More
 * like this" title, count, and back controls.
 *
 * Extracted from `[...slug].tsx` (pure JSX move, zero behaviour change) —
 * see that file's CLAUDE.md planned-work entry. Self-contained: renders its
 * own `AnimatePresence` gated on `selectedItem`, matching the original
 * inline block exactly.
 */
import { AnimatePresence, motion } from "framer-motion";
import type { ImageItem } from "../types";

interface SimilarHeaderProps {
  selectedItem: ImageItem | null;
  simTrail: ImageItem[];
  isFetchingSimilar: boolean;
  similarCount: number;
  onRewindTo: (index: number) => void;
  onBackHop: () => void;
  onClose: () => void;
}

export function SimilarHeader({
  selectedItem,
  simTrail,
  isFetchingSimilar,
  similarCount,
  onRewindTo,
  onBackHop,
  onClose,
}: SimilarHeaderProps) {
  return (
    <AnimatePresence>
      {selectedItem && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="mb-7 flex flex-col gap-4 border-b border-border pb-5"
        >
          {/* Similarity breadcrumb trail — the images dived through to
              reach here; click any thumbnail to rewind to that fork. */}
          {simTrail.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              {simTrail.map((img, i) => (
                <button
                  key={`${img.id}-${i}`}
                  onClick={() => onRewindTo(i)}
                  title={`Back to ${img.name}`}
                  className="group flex shrink-0 items-center gap-1.5"
                >
                  <img
                    src={img.thumbnailUrl ?? img.url}
                    alt={img.name}
                    className="h-8 w-8 rounded-[7px] object-cover opacity-65 ring-1 ring-border transition-opacity group-hover:opacity-100"
                  />
                  <span className="text-[11px] text-muted-foreground">›</span>
                </button>
              ))}
              <img
                src={selectedItem.thumbnailUrl ?? selectedItem.url}
                alt={selectedItem.name}
                className="h-8 w-8 shrink-0 rounded-[7px] object-cover ring-2 ring-primary/60"
              />
            </div>
          )}

          <div className="flex items-end justify-between gap-5">
            <div>
              <h2 className="text-[24px] font-[620] tracking-[-0.04em] text-foreground">
                More like this
              </h2>
              <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
                {isFetchingSimilar
                  ? "Finding similar images..."
                  : `${similarCount} similar images`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {simTrail.length > 0 && (
                <button
                  onClick={onBackHop}
                  className="h-9 rounded-[10px] border border-border bg-surface/65 px-3.5 text-[12px] font-[560] text-foreground transition-[background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98]"
                >
                  ‹ Back one
                </button>
              )}
              <button
                onClick={onClose}
                className="h-9 rounded-[10px] border border-border bg-surface/65 px-3.5 text-[12px] font-[560] text-secondary-foreground transition-[background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98]"
              >
                ← Back to all
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
