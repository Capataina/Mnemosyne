/**
 * Semantic search status header: the loading/results title, the matching
 * count, and any query error.
 *
 * Extracted from `[...slug].tsx` (pure JSX move, zero behaviour change) —
 * see that file's CLAUDE.md planned-work entry. `error` stays the raw
 * `unknown` from the query so the title/body formatting matches the
 * original inline block exactly (the title always stringifies the whole
 * error; the body prefers an `Error`'s `.message`).
 */
import { AnimatePresence, motion } from "framer-motion";

interface SemanticStatusProps {
  visible: boolean;
  isSearchLoading: boolean;
  semanticQuery: string;
  resultsCount: number | undefined;
  isError: boolean;
  error: unknown;
}

export function SemanticStatus({
  visible,
  isSearchLoading,
  semanticQuery,
  resultsCount,
  isError,
  error,
}: SemanticStatusProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="mb-7 border-b border-border pb-5"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-[24px] font-[620] tracking-[-0.04em] text-foreground">
              {isSearchLoading ? (
                <span className="flex items-center gap-2.5">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-input border-t-primary" />
                  Searching for "{semanticQuery}"...
                </span>
              ) : (
                `Results for "${semanticQuery}"`
              )}
            </h2>
          </div>
          {!isSearchLoading && resultsCount !== undefined && (
            <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
              Found {resultsCount} matching images
            </p>
          )}
          {isError && (
            <p
              className="mt-2 rounded-[10px] border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] text-destructive"
              title={String(error)}
            >
              Search failed:{" "}
              {error instanceof Error ? error.message : String(error)}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
