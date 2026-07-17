import { useEffect, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { getPipelineStats, type PipelineStats } from "../services/stats";
import {
  mergeFeedDeltaRows,
  UNFILTERED_MANIFEST_KEY,
  type FeedDeltaBatch,
  type FeedDeltaRowDTO,
} from "../services/feedDelta";
import type { FeedItem } from "../types";

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
 * IndexingProgress struct in indexing.rs.
 *
 * `processed / total` is the *current phase's* per-image high-water climb
 * (55655a7: mutex-guarded, strictly increasing, with a guaranteed terminal
 * at the end of each phase — scan 0→total_found, thumbnail 0→total_thumbs,
 * encode 0→aggregate_total). The pill uses it directly during an active run
 * so its number climbs smoothly under the current phase label; the settings
 * drawer and the pill's terminal state still read the authoritative DB
 * snapshot below.
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

/* ---------------------------------------------------------------------------
 * Module singleton: one `indexing-progress` listener for the whole app.
 *
 * Previously each mounted consumer (pill, route, open settings drawer) ran
 * its own `listen()` + its own event-driven useState, so a single progress
 * event fired 2–3 duplicate `["pipelineStats"]` invalidations and re-rendered
 * every consumer per event. Now one listener owns the event-derived state and
 * runs the invalidation policy exactly once per event; consumers subscribe to
 * just the slice they read via `useSyncExternalStore`, so a varying `message`
 * only re-renders the surface that displays it (the pill), never the route.
 * ------------------------------------------------------------------------- */

interface EventState {
  /** Latest phase from the stream; null before any event this session. */
  phase: IndexingPhase | null;
  /** Latest human-readable message from the stream, if any. */
  message: string | null;
  /** True while a pipeline run is actively in flight. */
  active: boolean;
  /** Current phase's per-image fraction (0..1) during an active run; null at
   *  idle/terminal so consumers fall back to the DB snapshot. */
  eventFraction: number | null;
}

let eventState: EventState = {
  phase: null,
  message: null,
  active: false,
  eventFraction: null,
};

const subscribers = new Set<() => void>();
let listenerStarted = false;

// The QueryClient is registered by the first mounted `usePipelineStats`
// (react-query owns the pipeline snapshot). The app shell always mounts a
// stats consumer, so it is set before any indexing event can invalidate.
let queryClientRef: QueryClient | null = null;

// Grid-refresh bookkeeping — module-level now that a single listener owns it.
let lastDeltaAppliedAt = 0;
let readyInvalidatedFor: string | null = null;

/* ---------------------------------------------------------------------------
 * T3-1 feed-delta path.
 *
 * During the thumbnail phase the backend emits batched `feed-delta` events —
 * compact rows for each newly-thumbnailed image — instead of the frontend
 * refetching the whole catalogue every ~5s. Rows buffer here and are applied
 * on the same ~5s cadence the eye already knew:
 *   - the UNFILTERED `["feed-manifest"]` cache is patched in place
 *     (`mergeFeedDeltaRows`: identity-preserving upsert, id-sorted inserts,
 *     spans preserved) — no IPC, no re-materialise;
 *   - any *filtered* manifest queries are invalidated instead of patched
 *     (a delta row's tag membership is unknown here), so a filtered view
 *     refreshes via the compact no-join query and "a filter acts on what
 *     you can see" stays honest;
 *   - the buffer force-flushes on any phase transition away from
 *     `thumbnail` (the backend emits its terminal delta flush BEFORE the
 *     terminal Thumbnail progress event), so no tail of deltas is stranded
 *     while the encode phase runs for minutes.
 * Reconciliation fallback: `ready` still drops the whole
 * `["feed-manifest"]` prefix for a full refetch, so any drift (orphan
 * flips, scan-only rows, a lost event) self-heals at end of run.
 * ------------------------------------------------------------------------- */
let deltaBuffer: FeedDeltaRowDTO[] = [];

function applyBufferedDeltas(queryClient: QueryClient) {
  if (deltaBuffer.length === 0) return;
  const rows = deltaBuffer;
  deltaBuffer = [];
  lastDeltaAppliedAt = Date.now();

  queryClient.setQueryData<FeedItem[]>(
    [...UNFILTERED_MANIFEST_KEY],
    (current) => mergeFeedDeltaRows(current, rows),
  );
  // Filtered manifests refetch (compact query) rather than merge.
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (key[0] !== "feed-manifest") return false;
      const tagIds = key[1] as number[] | undefined;
      const matchAll = key[2] as boolean | undefined;
      const excludeIds = key[3] as number[] | undefined;
      const isUnfiltered =
        Array.isArray(tagIds) &&
        tagIds.length === 0 &&
        matchAll === false &&
        Array.isArray(excludeIds) &&
        excludeIds.length === 0;
      return !isUnfiltered;
    },
  });
}

function handleFeedDelta(payload: FeedDeltaBatch) {
  if (!payload?.rows?.length) return;
  deltaBuffer.push(...payload.rows);
  const queryClient = queryClientRef;
  if (!queryClient) return;
  if (Date.now() - lastDeltaAppliedAt > 5000) {
    applyBufferedDeltas(queryClient);
  }
}

function notify() {
  for (const cb of subscribers) cb();
}

/**
 * Handle one `indexing-progress` event: update the event-derived state and run
 * the cache-invalidation policy once.
 *
 * Grid-refresh policy (T3-1 — deltas replace the thumbnail-phase refetch):
 * - `thumbnail` phase: NO catalogue invalidation. Newly thumbnailed images
 *   reach the feed as `feed-delta` patches (see handleFeedDelta above) —
 *   the old "invalidate `["images"]` every ~5s → refetch the whole
 *   library → re-shuffle → re-pack" amplification cycle is dead.
 * - any transition away from `thumbnail` (encode/ready/error): flush the
 *   delta buffer so the last partial batch lands.
 * - `encode` phase: never touch the grid — encoders populate
 *   search-readiness, not the visible grid, and full grid refetches contended
 *   with SigLIP-2 inference (the ~22s stalls in performance-analysis.md).
 * - `ready`: invalidate `["feed-manifest"]` once as the delta protocol's
 *   full reconciliation (orphan flips, scan-only rows, final metadata),
 *   plus drop similarity/search caches computed against the mid-index state.
 */
function handleEvent(payload: IndexingProgressEvent) {
  const { phase, message, processed, total } = payload;
  const active = ACTIVE_PHASES.includes(phase);
  const eventFraction =
    active && total > 0 ? Math.min(1, Math.max(0, processed / total)) : null;
  eventState = { phase, message, active, eventFraction };
  notify();

  const queryClient = queryClientRef;
  if (!queryClient) return;

  // Any progress event → pull a fresh authoritative snapshot so the displayed
  // numbers track reality closely between polls.
  queryClient.invalidateQueries({ queryKey: ["pipelineStats"] });

  // Leaving the thumbnail phase strands any <5s tail in the delta buffer;
  // the backend flushes its own terminal delta batch BEFORE the terminal
  // thumbnail progress emit, so by the time a non-thumbnail phase arrives
  // every row is client-side. Apply them now.
  if (phase !== "thumbnail" && deltaBuffer.length > 0) {
    applyBufferedDeltas(queryClient);
  }

  if (phase === "scan") {
    // New run starting — re-arm the ready de-dupe.
    readyInvalidatedFor = null;
  } else if (phase === "ready") {
    lastDeltaAppliedAt = 0;
    const runKey = message ?? "ready";
    if (readyInvalidatedFor !== runKey) {
      readyInvalidatedFor = runKey;
      // Full-manifest refetch — the delta protocol's reconciliation
      // fallback, and the moment scan-added / orphaned rows resolve.
      queryClient.invalidateQueries({ queryKey: ["feed-manifest"] });
      // Indexing completing means embeddings just landed. Any similarity /
      // semantic result cached DURING indexing was computed against an
      // incomplete index and, with its 5-minute staleTime, would otherwise be
      // served stale after the run finishes. Drop both so the next open
      // recomputes against the now-complete index. (Prefix match invalidates
      // every id/query variant of each key.)
      queryClient.invalidateQueries({ queryKey: ["fused-similar-images"] });
      queryClient.invalidateQueries({ queryKey: ["fused-semantic-search"] });
      // A re-index of the SAME root regenerates bucket files at identical
      // paths, and the adaptive-thumbnail cache's Infinity staleTime would
      // keep serving the old converted URL's stale pixels. Root changes
      // self-heal (new ids → new keys), so this prefix drop is specifically
      // for the same-id re-index case.
      queryClient.invalidateQueries({ queryKey: ["thumbnail"] });
    }
  }
}

/** Stable subscribe fn for `useSyncExternalStore`. Lazily starts the single
 *  Tauri listener on first subscription and keeps it for the app lifetime. */
function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  if (!listenerStarted) {
    listenerStarted = true;
    // Registered once and kept for the app lifetime (Tauri holds the
    // callback); there is no teardown because the pill/route/drawer that read
    // it are effectively always mounted in the shell.
    listen<IndexingProgressEvent>("indexing-progress", (event) =>
      handleEvent(event.payload),
    ).catch(() => {
      // Registration failed — allow a later mount to retry.
      listenerStarted = false;
    });
    // Companion feed-delta stream (T3-1). Registration failure is
    // non-fatal: without deltas the feed simply stays static until the
    // `ready` reconciliation refetch — stale for the run, never wrong.
    listen<FeedDeltaBatch>("feed-delta", (event) =>
      handleFeedDelta(event.payload),
    ).catch(() => {});
  }
  return () => {
    subscribers.delete(cb);
  };
}

// getSnapshot selectors — each returns a primitive slice, so a subscriber only
// re-renders when *its* slice changes (Object.is comparison in React).
const getPhase = () => eventState.phase;
const getMessage = () => eventState.message;
const getActive = () => eventState.active;
const getEventFraction = () => eventState.eventFraction;

/* --------------------------------------------------------------------------- */

/**
 * The DB-backed pipeline snapshot (react-query keyed `["pipelineStats"]`,
 * deduped across every consumer). Authoritative for all displayed counts.
 *
 * Consuming this subscribes to the coarse `active` flag (to drive polling)
 * but NOT to `message`, so an indexing run's per-event message churn cannot
 * re-render a stats consumer. This is the hook the route and the settings
 * drawer read.
 */
export function usePipelineStats(): PipelineStats | null {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClientRef = queryClient;
  }, [queryClient]);

  const active = useSyncExternalStore(subscribe, getActive);

  const { data } = useQuery<PipelineStats>({
    queryKey: ["pipelineStats"],
    queryFn: getPipelineStats,
    // Poll while a run is active; stop when idle so an untouched app isn't
    // hitting the DB forever. The snapshot is a single SELECT, so the polling
    // cost is negligible even on a large library.
    refetchInterval: active ? 1500 : false,
    refetchOnWindowFocus: false,
  });

  return data ?? null;
}

/** Coarse "is a run in flight" flag. Flips on phase transitions only, so
 *  consuming it never re-renders on per-message event churn. */
export function useIsIndexing(): boolean {
  return useSyncExternalStore(subscribe, getActive);
}

/** Fine-grained event-derived state for the status pill: the phase label,
 *  the live message, and the current phase's per-image fraction. */
export interface IndexingPhaseState {
  isIndexing: boolean;
  phase: IndexingPhase | null;
  message: string | null;
  /** Current phase's per-image fraction (0..1) during an active run; null at
   *  idle/terminal. */
  eventFraction: number | null;
}

export function useIndexingPhase(): IndexingPhaseState {
  const phase = useSyncExternalStore(subscribe, getPhase);
  const message = useSyncExternalStore(subscribe, getMessage);
  const eventFraction = useSyncExternalStore(subscribe, getEventFraction);
  const isIndexing = phase !== null && ACTIVE_PHASES.includes(phase);
  return { isIndexing, phase, message, eventFraction };
}

export interface IndexingStatus {
  /** True while a pipeline run is actively in flight. */
  isIndexing: boolean;
  /** Latest phase from the event stream, for the status label. */
  phase: IndexingPhase | null;
  /** Latest human-readable message from the event stream, if any. */
  message: string | null;
  /** Current phase's per-image fraction (0..1) during an active run; null at
   *  idle/terminal. */
  eventFraction: number | null;
  /** Aggregate progress across the whole pipeline (DB-derived). */
  overall: IndexingOverall;
  /** Raw per-stage snapshot for detailed display (the settings drawer). */
  stats: PipelineStats | null;
}

/**
 * Thin compatibility wrapper composing the fine-grained event state and the
 * DB snapshot. Used by the status pill, which needs both the per-image event
 * fraction (smooth climb during an active run) and the DB-derived `overall`
 * (the terminal authority for reaching 100% and clearing). Prefer the narrow
 * hooks above for surfaces that only read one side.
 */
export function useIndexingStatus(): IndexingStatus {
  const { isIndexing, phase, message, eventFraction } = useIndexingPhase();
  const stats = usePipelineStats();
  return {
    isIndexing,
    phase,
    message,
    eventFraction,
    overall: computeOverall(stats),
    stats,
  };
}
