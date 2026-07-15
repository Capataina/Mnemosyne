import { useEffect, useState } from "react";
import { ImageItem, Tag } from "../types";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { TagDropdown } from "./TagDropdown";
import { Badge } from "./ui/badge";

interface PinterestModalProps {
  item: ImageItem | null;
  onClose: () => void;
  onNavigate?: (direction: "prev" | "next") => void;
  tags?: Tag[];
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  onDeleteTag?: (tagId: number) => void;
  onAssignTag: (imageId: number, tagId: number) => void;
  onRemoveTag: (imageId: number, tagId: number) => void;
  /** Free-text annotation for this image (Phase 11) */
  notes?: string;
  onSaveNotes?: (imageId: number, notes: string) => void;
}

/**
 * Fullscreen image inspector.
 *
 * Layout: image fills the left ~60% of the viewport, details drawer on
 * the right with tag editor + notes textarea + dimensions metadata.
 *
 * Navigation: left/right arrow keys move through the displayed list.
 * The previous arrow buttons are gone — keyboard nav is enough and the
 * buttons made the modal feel cluttered.
 */
export function PinterestModal(props: PinterestModalProps) {
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [notesValue, setNotesValue] = useState(props.notes ?? "");

  useEffect(() => {
    if (props.item) {
      setSelectedTags(props.item.tags.map((t) => t.id));
    }
  }, [props.item]);

  useEffect(() => {
    setNotesValue(props.notes ?? "");
  }, [props.notes, props.item?.id]);

  // Keyboard handlers: arrow keys navigate, esc closes.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when the user is typing in an input/textarea.
      const target = e.target as HTMLElement | null;
      const inEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.getAttribute("contenteditable") === "true";

      if (e.key === "Escape") {
        props.onClose();
      } else if (!inEditable && e.key === "ArrowLeft" && props.onNavigate) {
        props.onNavigate("prev");
      } else if (!inEditable && e.key === "ArrowRight" && props.onNavigate) {
        props.onNavigate("next");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose, props.onNavigate]);

  const persistNotesSoon = () => {
    if (!props.onSaveNotes || !props.item) return;
    props.onSaveNotes(props.item.id, notesValue);
  };

  if (!props.item) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-5"
        onClick={props.onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-background/88 backdrop-blur-xl" />

        {/* Modal — spring scale-in for a more physical feel */}
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          className="floating-surface relative z-10 grid h-full max-h-[calc(100dvh-40px)] w-full max-w-[calc(100vw-40px)] grid-cols-[minmax(0,1fr)_360px] overflow-hidden rounded-[16px] border max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(0,1fr)_auto]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={props.onClose}
            className="chrome-surface absolute top-4 left-4 z-20 grid size-9 place-items-center rounded-[10px] border text-muted-foreground transition-[color,background-color,transform] hover:bg-surface-raised hover:text-foreground active:scale-95"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>

          {/* Image stage */}
          <div className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-surface-sunken p-5 max-[760px]:p-3">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-foreground/[0.025] to-transparent" />
            <img
              src={props.item.url}
              alt={props.item.name}
              className="relative max-h-full max-w-full rounded-[14px] object-contain shadow-[0_24px_70px_-36px_var(--shadow-color)]"
              loading="eager"
              decoding="async"
            />
          </div>

          {/* Details panel */}
          <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-border bg-card/92 max-[760px]:max-h-[42dvh] max-[760px]:border-l-0 max-[760px]:border-t">
            <div className="border-b border-border px-6 py-5">
              <p className="mb-1 text-[11px] font-[560] text-muted-foreground">
                Image details
              </p>
              <h2 className="line-clamp-2 text-[17px] font-[620] leading-snug tracking-[-0.025em] text-foreground">
                {props.item.name}
              </h2>
            </div>

            <div className="flex flex-1 flex-col gap-6 px-6 py-5">
            {/* Tag dropdown */}
            <div className="space-y-2">
              <label className="block text-[11px] font-[560] text-muted-foreground">
                Tags
              </label>
              <TagDropdown
                tags={props.tags}
                open={comboboxOpen}
                setOpen={setComboboxOpen}
                selected={selectedTags}
                setSelected={setSelectedTags}
                placeholder="Add Tags"
                instruction="Select tags to add"
                onCreateTag={props.onCreateTag}
                onDeleteTag={props.onDeleteTag}
                imageId={props.item.id}
                onAssignTag={props.onAssignTag}
                onRemoveTag={props.onRemoveTag}
              />
            </div>

            {/* Active tags */}
            <div className="flex min-h-6 flex-wrap gap-1.5">
              <AnimatePresence mode="popLayout">
                {props.item.tags.map((tag) => (
                  <motion.div
                    key={tag.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  >
                    <Badge
                      className="border-transparent px-2.5 py-1"
                      style={{
                        backgroundColor: tag.color,
                        color: pickContrastingText(tag.color),
                      }}
                    >
                      {tag.name}
                      <button
                        className="ml-1 grid size-4 place-items-center rounded-full transition-colors hover:bg-background/15"
                        onClick={() =>
                          props.onRemoveTag(props.item!.id, tag.id)
                        }
                        aria-label={`Remove ${tag.name}`}
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    </Badge>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Notes textarea (Phase 11) */}
            {props.onSaveNotes && (
              <div className="space-y-2">
                <label className="block text-[11px] font-[560] text-muted-foreground">
                  Notes
                </label>
                <textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  onBlur={persistNotesSoon}
                  placeholder="Add a note about this image..."
                  className="min-h-[112px] w-full resize-none rounded-[10px] border border-border bg-surface-sunken/65 px-3.5 py-3 text-[13px] leading-relaxed text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground focus:border-primary/55 focus:bg-surface-sunken focus:ring-3 focus:ring-primary/10"
                />
              </div>
            )}

            <div className="flex-1" />
            </div>

            {/* Image dimensions */}
            <div className="border-t border-border px-6 py-4 text-[11px] font-[520] tabular-nums text-muted-foreground">
              {props.item.width.toLocaleString()} × {props.item.height.toLocaleString()} px
            </div>
          </aside>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Pick black or white text colour to maximise contrast against a
 * given hex background. Used so a custom-coloured tag pill (Phase 11)
 * stays readable.
 */
function pickContrastingText(hex: string): string {
  // Naive luma — sum of RGB channels normalised to 0-1, scaled by
  // perceptual weights. Threshold 0.5 picks black on light bgs.
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return "#111827";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 0.6 ? "#111827" : "#f8fafc";
}
