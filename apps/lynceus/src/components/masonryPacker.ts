import {
  computeMasonryGeometry,
  type MasonryGeometry,
  type MasonryPackInput,
  type MasonryPackRequest,
  type MasonryPackResponse,
  type MasonryPlacementAnchor,
} from "./masonryPacking";

/** Worker client with bounded queueing: one computation may be in flight and
 * exactly one replaceable latest request may wait behind it. Catalogue arrays
 * are transferred once per base revision; pointer frames reuse the worker's
 * cached arrays and cross only the numeric gesture footprint. */
export interface MasonryPacker {
  pack(gen: number, revision: number, input: MasonryPackInput): void;
  onResult(handler: (gen: number, geometry: MasonryGeometry) => void): void;
  onFailure(handler: () => void): void;
  readonly offThread: boolean;
  dispose(): void;
}

interface PendingPack {
  gen: number;
  revision: number;
  input: MasonryPackInput;
}

function clonePlacementAnchors(
  anchors: Record<number, MasonryPlacementAnchor> | null,
): Record<number, MasonryPlacementAnchor> | null {
  if (!anchors) return null;
  const clone: Record<number, MasonryPlacementAnchor> = {};
  for (const [id, anchor] of Object.entries(anchors)) {
    clone[Number(id)] = { ...anchor };
  }
  return clone;
}

function cloneInputForTransfer(input: MasonryPackInput): MasonryPackInput {
  return {
    ...input,
    ids: input.ids.slice(),
    widths: input.widths.slice(),
    heights: input.heights.slice(),
    spans: input.spans.slice(),
    gestureFootprint: input.gestureFootprint
      ? { ...input.gestureFootprint }
      : null,
    placementAnchors: clonePlacementAnchors(input.placementAnchors),
  };
}

export function createMasonryPacker(): MasonryPacker {
  let resultHandler: ((gen: number, geometry: MasonryGeometry) => void) | null =
    null;
  let failureHandler: (() => void) | null = null;
  let worker: Worker | null = null;
  let disposed = false;
  let inFlight = false;
  let pending: PendingPack | null = null;
  // Revision whose catalogue arrays have already been sent to the worker.
  // It is safe to mark on dispatch: worker messages are FIFO and the next
  // request is not dispatched until this one returns.
  let workerRevision = -1;

  const dispatch = (request: PendingPack) => {
    const active = worker;
    if (!active || disposed) return;
    inFlight = true;

    if (request.revision === workerRevision) {
      const message: MasonryPackRequest = {
        kind: "reuse",
        gen: request.gen,
        revision: request.revision,
        gestureFootprint: request.input.gestureFootprint,
      };
      active.postMessage(message);
      return;
    }

    const transferred = cloneInputForTransfer(request.input);
    workerRevision = request.revision;
    const message: MasonryPackRequest = {
      kind: "full",
      gen: request.gen,
      revision: request.revision,
      input: transferred,
    };
    active.postMessage(message, [
      transferred.ids.buffer,
      transferred.widths.buffer,
      transferred.heights.buffer,
      transferred.spans.buffer,
    ]);
  };

  try {
    worker = new Worker(new URL("./masonryWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<MasonryPackResponse>) => {
      inFlight = false;
      const next = pending;
      pending = null;
      resultHandler?.(event.data.gen, event.data.geometry);

      // Collapse every request that arrived during the computation to the
      // newest one. A request synchronously queued by the result handler is
      // newer still, so it wins and the captured pending work is discarded.
      if (!inFlight && next) dispatch(next);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      inFlight = false;
      pending = null;
      workerRevision = -1;
      failureHandler?.();
    };
  } catch {
    worker = null;
  }

  return {
    get offThread() {
      return worker !== null;
    },
    pack(gen, revision, input) {
      const active = worker;
      if (!active) {
        resultHandler?.(gen, computeMasonryGeometry(input));
        return;
      }

      const request = { gen, revision, input };
      if (inFlight) {
        pending = request;
      } else {
        dispatch(request);
      }
    },
    onResult(handler) {
      resultHandler = handler;
    },
    onFailure(handler) {
      failureHandler = handler;
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      inFlight = false;
      pending = null;
      resultHandler = null;
      failureHandler = null;
    },
  };
}
