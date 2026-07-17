import {
  computeMasonryGeometry,
  type MasonryGeometry,
  type MasonryPackInput,
  type MasonryPackResponse,
} from "./masonryPacking";

/**
 * Thin client over the masonry pack Web Worker (T3-3), with a synchronous
 * fallback that makes the grid independent of worker availability.
 *
 * `pack` transfers the input's typed arrays into the worker; the result is
 * delivered to the `onResult` handler tagged with the request's generation.
 * If the worker cannot be constructed (or fails at runtime), the packer
 * downgrades to computing `computeMasonryGeometry` inline on the calling
 * thread — the hard invariant is that a worker failure never leaves the
 * grid unpacked. `onFailure` lets the engine re-run the latest request
 * synchronously the moment a live worker dies mid-session (its in-flight
 * request's transferred buffers are gone, so only the caller, which still
 * holds the source `items`, can rebuild and recover).
 */
export interface MasonryPacker {
  pack(gen: number, input: MasonryPackInput): void;
  onResult(handler: (gen: number, geometry: MasonryGeometry) => void): void;
  onFailure(handler: () => void): void;
  /** True when a live worker backs the packer (packs run off-thread). */
  readonly offThread: boolean;
  dispose(): void;
}

export function createMasonryPacker(): MasonryPacker {
  let resultHandler: ((gen: number, geometry: MasonryGeometry) => void) | null =
    null;
  let failureHandler: (() => void) | null = null;
  let worker: Worker | null = null;

  try {
    worker = new Worker(new URL("./masonryWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<MasonryPackResponse>) => {
      resultHandler?.(event.data.gen, event.data.geometry);
    };
    worker.onerror = () => {
      // A construction/load/runtime worker failure downgrades to synchronous
      // packing for the rest of the session. The in-flight request's inputs
      // were transferred away and are gone; the engine's `onFailure` re-runs
      // the latest pack from the source items it still holds.
      worker?.terminate();
      worker = null;
      failureHandler?.();
    };
  } catch {
    // Environment without module-worker support (or a blocked construction):
    // every pack runs synchronously from the start.
    worker = null;
  }

  return {
    get offThread() {
      return worker !== null;
    },
    pack(gen, input) {
      const active = worker;
      if (active) {
        active.postMessage({ gen, input }, [
          input.widths.buffer,
          input.heights.buffer,
          input.spans.buffer,
        ]);
        return;
      }
      // Synchronous fallback: compute inline and deliver on the same tick.
      resultHandler?.(gen, computeMasonryGeometry(input));
    },
    onResult(handler) {
      resultHandler = handler;
    },
    onFailure(handler) {
      failureHandler = handler;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      resultHandler = null;
      failureHandler = null;
    },
  };
}
