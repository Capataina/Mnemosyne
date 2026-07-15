import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPipelineStats, type PipelineStats } from "../services/stats";

/**
 * Indexing pipeline phases — matches the kebab-case Phase enum in
 * src-tauri/src/indexing.rs.
 */
export type IndexingPhase =
  | "scan"
  | "model-download"
  | "thumbnail"
  | "encode"
  | "ready"
  | "error";

/**
 * Raw `indexing-progress` event payload from the backend. Mirrors the
 * IndexingProgress struct in indexing.rs. We consume it for the *phase
 * label* and for cache-invalidation timing only — the *numbers* shown
 * to the user come from the authoritative DB snapshot below, not from
 * this stream.
 *
 * Why: with three encoder threads running concurrently, the encode-phase
 * events are inherently racy (each thread reports its own count against
 * the same total), so the last event the UI happens to see can carry a
 * stale or zero `processed`. That was the "pill stuck at 0/21 while the
 * drawer shows 100%" bug — the pill trusted the event stream, the drawer
 * queried the DB. Now both read the DB; the event stream only tells us
 * *which phase* is live and *when* to refresh.
 */
interface IndexingProgressEvent {
  phase: IndexingPhase;
  processed: number;
  total: number;
  message: string | null;
}

const ACTIVE_PHASES: IndexingPhase[] = [
  "scan",
  "model-download",
  "thumbnail",
  "encode",
];

/** Aggregate pipeline progress, derived from the DB snapshot. */
export interface IndexingOverall {
  /** Units completed across thumbnails + every encoder stage. */
  processed: number;
  /** Total units = total_images × (1 thumbnail stage + N encoder stages). */
  total: number;
  /** processed / total, clamped 0..1. Monotonic; reaches 1 when done. */
  fraction: number;
}

export interface IndexingStatus {
  /** True while a pipeline run is actively in flight. */
  isIndexing: boolean;
  /** Latest phase from the event stream, for the status label. Null
   *  before any event has arrived this session. */
  phase: IndexingPhase | null;
  /** Latest human-readable message from the event stream, if any. */
  message: string | null;
  /** Aggregate progress across the whole pipeline (DB-derived). */
  overall: IndexingOverall;
  /** Raw per-stage snapshot for detailed display (the settings drawer). */
  stats: PipelineStats | null;
}

const EMPTY_OVERALL: IndexingOverall = { processed: 0, total: 0, fraction: 0 };

function computeOverall(stats: PipelineStats | null): IndexingOverall {
  if (!stats || stats.total_images === 0) return EMPTY_OVERALL;
  const numEncoders = Math.max(1, stats.with_embedding_per_encoder.length);
  const total = stats.total_images * (1 + numEncoders);
  const embeddingsDone = stats.with_embedding_per_encoder.reduce(
    (sum, e) => sum + e.count,
    0,
  );
  const processed = stats.with_thumbnail + embeddingsDone;
  const fraction = total > 0 ? Math.min(1, processed / total) : 0;
  return { processed, total, fraction };
}

/**
 * Single source of truth for indexing progress, shared by the status
 * pill and the settings drawer.
 *
 * - The `get_pipeline_stats` DB snapshot (react-query keyed
 *   `["pipelineStats"]`, deduped across every consumer) is authoritative
 *   for all displayed numbers.
 * - The `indexing-progress` event stream drives three things and nothing
 *   the user sees directly: the current phase label, when to refresh the
 *   snapshot, and when to refresh the visible image grid.
 *
 * Grid-refresh policy (preserved from the previous useIndexingProgress):
 * - `thumbnail` phase: invalidate `["images"]` every ~5s so newly
 *   thumbnailed images pop into the feed as they land (this is what makes
 *   the "new tiles appear during indexing" behaviour work).
 * - `encode` phase: never invalidate `["images"]` — encoders populate
 *   search-readiness, not the visible grid, and full grid refetches
 *   contended with SigLIP-2 inference (the ~22s stalls documented in
 *   context/plans/performance-analysis.md).
 * - `ready`: invalidate `["images"]` once so any final metadata lands.
 */
export function useIndexingStatus(): IndexingStatus {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<IndexingPhase | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  // Throttle marker for the thumbnail-phase ["images"] invalidation.
  const lastImagesInvalidatedAt = useRef<number>(0);
  // De-dupe the one-shot ready invalidation (the pipeline can re-emit
  // `ready` after a slow background encoder finishes).
  const readyInvalidatedFor = useRef<string | null>(null);

  const { data: stats } = useQuery<PipelineStats>({
    queryKey: ["pipelineStats"],
    queryFn: getPipelineStats,
    // Poll while a run is active; stop when idle so an untouched app
    // isn't hitting the DB forever. The snapshot is a single SELECT, so
    // the polling cost is negligible even on a large library.
    refetchInterval: active ? 1500 : false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      const off = await listen<IndexingProgressEvent>(
        "indexing-progress",
        (event) => {
          const { phase: p, message: m } = event.payload;
          setPhase(p);
          setMessage(m);
          setActive(ACTIVE_PHASES.includes(p));

          // Any progress event → pull a fresh authoritative snapshot so
          // the displayed numbers track reality closely between polls.
          queryClient.invalidateQueries({ queryKey: ["pipelineStats"] });

          if (p === "scan") {
            // New run starting — re-arm the ready de-dupe.
            readyInvalidatedFor.current = null;
          } else if (p === "thumbnail") {
            const now = Date.now();
            if (now - lastImagesInvalidatedAt.current > 5000) {
              lastImagesInvalidatedAt.current = now;
              queryClient.invalidateQueries({ queryKey: ["images"] });
            }
          } else if (p === "ready") {
            lastImagesInvalidatedAt.current = 0;
            const runKey = m ?? "ready";
            if (readyInvalidatedFor.current !== runKey) {
              readyInvalidatedFor.current = runKey;
              queryClient.invalidateQueries({ queryKey: ["images"] });
              // Indexing completing means embeddings just landed. Any
              // similarity / semantic result cached DURING indexing was
              // computed against an incomplete index and, with its 5-minute
              // staleTime, would otherwise be served stale after the run
              // finishes. Drop both so the next open recomputes against the
              // now-complete index. (Prefix match invalidates every id/query
              // variant of each key.)
              queryClient.invalidateQueries({
                queryKey: ["fused-similar-images"],
              });
              queryClient.invalidateQueries({
                queryKey: ["fused-semantic-search"],
              });
            }
          }
        },
      );
      if (cancelled) off();
      else unlisten = off;
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [queryClient]);

  const isIndexing = phase !== null && ACTIVE_PHASES.includes(phase);

  return {
    isIndexing,
    phase,
    message,
    overall: computeOverall(stats ?? null),
    stats: stats ?? null,
  };
}
