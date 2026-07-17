import { useEffect, useRef, useState } from "react";
import { ImageItem, SimilarImageItem, Tag } from "../types";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { TagDropdown } from "./TagDropdown";
import { Badge } from "./ui/badge";
import { GestureTimer } from "../features/gesture-timer/GestureTimer";
import type { GestureTimerConfig } from "../features/gesture-timer/types";

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
  /** The current image's similar-set (ranked most→least similar), fed to
   *  the gesture-drawing timer mode as its candidate pool. */
  timerCandidates?: SimilarImageItem[];
  /** Quick-start config from the selected-hero pill: when present, the
   *  gesture timer starts running with it the moment the inspector opens
   *  (one auto-start per config object identity). */
  autoStartTimer?: GestureTimerConfig | null;
  /** Full-res URLs of the arrow-navigation neighbours, so the modal can
   *  predecode them before the user moves. The host owns the active nav
   *  list; wiring these lets prev/next land on a warm decode instead of
   *  popping in a fresh 4000px+ original. Absent → nothing to predecode. */
  neighbourUrls?: { prev?: string; next?: string };
}

/**
 * Warm the browser's decode cache for `url` off-screen so the real <img> hits
 * a decoded bitmap on navigation. Returns the Image whose reference must be
 * held for the window (dropping it lets the decoded data be reclaimed). A
 * rejected decode — AbortError is normal on rapid nav — is swallowed but
 * logged.
 */
function predecodeImage(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  void img.decode().catch((err: unknown) => {
    if ((err as DOMException | undefined)?.name !== "AbortError") {
      console.debug("modal predecode failed", url, err);
    }
  });
  return img;
}

/**
 * Fullscreen image inspector.
 *
 * Layout: artwork leads on the left; the right inspector is one deliberate
 * column for tags, notes, and gesture-timer setup.
 *
 * Navigation: left/right arrow keys and the compact panel controls move
 * through the displayed list.
 */
export function PinterestModal(props: PinterestModalProps) {
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [notesValue, setNotesValue] = useState(props.notes ?? "");
  // 2-deep predecode window: references to only the current prev+next
  // Images, replaced (older dropped) whenever the selected image changes.
  const neighbourDecodeRef = useRef<HTMLImageElement[]>([]);

  const prevUrl = props.neighbourUrls?.prev;
  const nextUrl = props.neighbourUrls?.next;
  useEffect(() => {
    neighbourDecodeRef.current = [prevUrl, nextUrl]
      .filter((url): url is string => !!url)
      .map(predecodeImage);
  }, [prevUrl, nextUrl]);

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
          className="floating-surface relative z-10 grid h-full max-h-[calc(100dvh-40px)] w-full max-w-[calc(100vw-40px)] grid-cols-[minmax(0,1fr)_minmax(380px,420px)] overflow-hidden rounded-[16px] border max-[860px]:grid-cols-1 max-[860px]:grid-rows-[minmax(0,1fr)_auto]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Image stage */}
          <div className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-surface-sunken p-5 max-[860px]:p-3">
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
          <aside className="min-h-0 overflow-y-auto border-l border-border bg-card/92 max-[860px]:max-h-[54dvh] max-[860px]:border-l-0 max-[860px]:border-t">
            <header className="sticky top-0 z-10 flex items-start gap-4 border-b border-border bg-surface-overlay/95 px-5 py-4 backdrop-blur-xl">
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-2 text-[15px] font-[640] leading-snug tracking-[-0.025em] text-foreground">
                  {props.item.name}
                </h2>
                <p className="mt-1 text-[10px] font-[540] tabular-nums text-muted-foreground">
                  {props.item.width.toLocaleString()} × {props.item.height.toLocaleString()} px
                </p>
              </div>
              <nav className="flex shrink-0 items-center gap-1" aria-label="Image navigation">
                <button
                  type="button"
                  onClick={() => props.onNavigate?.("prev")}
                  disabled={!props.onNavigate}
                  className="grid size-8 place-items-center rounded-[9px] text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-[0.96] disabled:opacity-35"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => props.onNavigate?.("next")}
                  disabled={!props.onNavigate}
                  className="grid size-8 place-items-center rounded-[9px] text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-[0.96] disabled:opacity-35"
                  aria-label="Next image"
                >
                  <ChevronRight className="size-4" strokeWidth={1.8} />
                </button>
                <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
                <button
                  type="button"
                  onClick={props.onClose}
                  className="grid size-8 place-items-center rounded-[9px] text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-[0.96]"
                  aria-label="Close image inspector"
                >
                  <X className="size-4" strokeWidth={1.8} />
                </button>
              </nav>
            </header>

            <section className="border-b border-border px-5 py-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-[12px] font-[620] text-foreground">Tags</h3>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {props.item.tags.length} assigned
                </span>
              </div>
              <div className="flex min-h-7 flex-wrap items-center gap-1.5">
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
                          type="button"
                          className="ml-1 grid size-4 place-items-center rounded-full transition-colors hover:bg-background/15"
                          onClick={() =>
                            props.onRemoveTag(props.item!.id, tag.id)
                          }
                          aria-label={`Remove ${tag.name}`}
                        >
                          <X className="size-3" strokeWidth={2} />
                        </button>
                      </Badge>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {props.item.tags.length === 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    No tags assigned
                  </span>
                )}
              </div>
              <div className="mt-3">
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
            </section>

            {props.onSaveNotes && (
              <section className="border-b border-border px-5 py-4">
                <label
                  htmlFor={`image-notes-${props.item.id}`}
                  className="mb-2.5 block text-[12px] font-[620] text-foreground"
                >
                  Notes
                </label>
                <textarea
                  id={`image-notes-${props.item.id}`}
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  onBlur={persistNotesSoon}
                  placeholder="Add a note about this image..."
                  className="min-h-[104px] w-full resize-y rounded-[10px] border border-border bg-surface-sunken/65 px-3.5 py-3 text-[12px] leading-relaxed text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground focus:border-primary/55 focus:bg-surface-sunken focus:ring-3 focus:ring-primary/10"
                />
              </section>
            )}

            <section className="px-5 py-5">
              <GestureTimer
                startingImage={props.item}
                candidateImages={props.timerCandidates ?? []}
                autoStart={props.autoStartTimer ?? null}
              />
            </section>
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
