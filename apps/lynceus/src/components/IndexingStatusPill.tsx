import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  useIndexingStatus,
  type IndexingPhase,
} from "../hooks/useIndexingStatus";

const PHASE_LABELS: Record<IndexingPhase, string> = {
  scan: "Scanning",
  "model-download": "Downloading models",
  thumbnail: "Generating thumbnails",
  encode: "Encoding embeddings",
  ready: "Ready",
  error: "Error",
};

/**
 * Floating status pill in the top-right corner.
 *
 * All numbers come from `useIndexingStatus` (the DB-backed snapshot), so
 * the pill can never disagree with the settings drawer — that was the
 * "stuck at 0/21 while the drawer shows 100%" bug. The pill shows an
 * aggregate percentage across the whole pipeline (thumbnails + every
 * encoder), which is monotonic and reaches 100%; it lingers briefly as a
 * "Ready" confirmation when a run finishes, then fades.
 */
export function IndexingStatusPill() {
  const { isIndexing, phase, message, overall } = useIndexingStatus();
  const [dismissed, setDismissed] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const wasIndexing = useRef(false);

  const isError = phase === "error";

  useEffect(() => {
    // A run just finished (was active, now isn't, and not an error) →
    // show a brief "Ready" confirmation, then fade.
    if (wasIndexing.current && !isIndexing && !isError) {
      setShowFinal(true);
      setDismissed(false);
      const t = setTimeout(() => setShowFinal(false), 4000);
      wasIndexing.current = isIndexing;
      return () => clearTimeout(t);
    }
    wasIndexing.current = isIndexing;
    if (isIndexing) {
      setDismissed(false);
      setShowFinal(false);
    }
  }, [isIndexing, isError]);

  const visible = (isIndexing || showFinal || isError) && !dismissed;
  if (!visible || phase === null) return null;

  const isReady = showFinal && !isIndexing && !isError;
  const label = isReady ? PHASE_LABELS.ready : PHASE_LABELS[phase];
  const pct = Math.round(overall.fraction * 100);
  const showBar = isIndexing && !isError;

  return (
    <AnimatePresence>
      <motion.div
        key="indexing-pill"
        initial={{ opacity: 0, y: -8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={[
          "floating-surface fixed top-20 right-6 z-[80] flex min-w-[260px] max-w-[380px] items-center gap-3.5",
          "overflow-hidden rounded-[14px] border px-3.5 py-3",
          isError ? "border-destructive/45" : "border-border-strong",
        ].join(" ")}
        title={message ?? undefined}
      >
        <div
          className={[
            "grid size-8 shrink-0 place-items-center rounded-[9px] border",
            isError
              ? "border-destructive/25 bg-destructive/10"
              : isReady
                ? "border-success/25 bg-success/10"
                : "border-primary/25 bg-primary/10",
          ].join(" ")}
        >
          {isError ? (
            <AlertCircle className="h-4 w-4 text-destructive" strokeWidth={1.8} />
          ) : isReady ? (
            <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.8} />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" strokeWidth={1.8} />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span
              className={[
                "truncate text-[12px] font-[620] tracking-[-0.01em]",
                isError ? "text-destructive" : "text-foreground",
              ].join(" ")}
            >
              {label}
            </span>
            {showBar && (
              <span className="shrink-0 text-[11px] font-[560] tabular-nums text-primary">
                {pct}%
              </span>
            )}
          </div>

          {showBar && (
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-input">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 200, damping: 30 }}
              />
            </div>
          )}

          {isReady && message && (
            <span className="truncate text-[10px] leading-tight text-muted-foreground">
              {message}
            </span>
          )}
        </div>

        {(isError || isReady) && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-lg font-light leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            ×
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
