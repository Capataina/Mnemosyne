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
          "fixed top-4 right-4 z-50 flex items-center gap-3",
          "rounded-full border bg-card/95 backdrop-blur-md",
          "px-4 py-2 shadow-lg shadow-black/30",
          "min-w-[240px] max-w-[380px]",
          isError ? "border-destructive/40" : "border-border",
        ].join(" ")}
        title={message ?? undefined}
      >
        <div className="shrink-0">
          {isError ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : isReady ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span
              className={[
                "text-xs font-medium",
                isError ? "text-destructive" : "text-foreground",
              ].join(" ")}
            >
              {label}
            </span>
            {showBar && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {pct}%
              </span>
            )}
          </div>

          {showBar && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full bg-primary"
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 200, damping: 30 }}
              />
            </div>
          )}

          {isReady && message && (
            <span className="text-[10px] text-muted-foreground">{message}</span>
          )}
        </div>

        {(isError || isReady) && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition"
          >
            ×
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
