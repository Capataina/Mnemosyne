import {
  computeMasonryGeometry,
  type MasonryPackInput,
  type MasonryPackRequest,
  type MasonryPackResponse,
} from "./masonryPacking";

/**
 * Web Worker entry for the masonry pack (T3-3).
 *
 * The full O(N) shortest-column pack runs here, off the main thread, so a
 * launch / filter / resize / reorder repack of a 100k-image feed never
 * blocks the UI. Inputs arrive as transferred typed arrays and geometry
 * goes back the same way (see `masonryPacker.ts` for the transfer lists);
 * the pure algorithm is `computeMasonryGeometry`, shared verbatim with the
 * synchronous fallback so worker output is bit-for-bit identical.
 *
 * The worker's global scope is typed with a minimal local interface rather
 * than pulling the `webworker` lib into a DOM-lib compilation — the two
 * libs conflict on `self`/`postMessage`, and this file only needs the two
 * calls below. `Transferable` and `MessageEvent` come from the DOM lib.
 */
interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<MasonryPackRequest>) => void) | null;
  postMessage(message: MasonryPackResponse, transfer: Transferable[]): void;
}

const ctx = self as unknown as DedicatedWorkerScope;

let cachedRevision = -1;
let cachedInput: MasonryPackInput | null = null;

ctx.onmessage = (event) => {
  const request = event.data;
  let input: MasonryPackInput;
  if (request.kind === "full") {
    cachedRevision = request.revision;
    cachedInput = request.input;
    input = request.input;
  } else {
    if (!cachedInput || cachedRevision !== request.revision) {
      // The client only emits reuse after a full request for this revision.
      // Throwing deliberately routes an impossible protocol violation through
      // the existing worker-failure fallback instead of silently packing the
      // wrong catalogue revision.
      throw new Error("masonry worker received an unknown base revision");
    }
    input = {
      ...cachedInput,
      gestureFootprint: request.gestureFootprint,
    };
  }

  const geometry = computeMasonryGeometry(input);
  // Transfer the result buffers back out — no copy on either side.
  const response: MasonryPackResponse = {
    gen: request.gen,
    revision: request.revision,
    geometry,
  };
  ctx.postMessage(response, [
    geometry.xs.buffer,
    geometry.ys.buffer,
    geometry.widths.buffer,
    geometry.heights.buffer,
    geometry.spans.buffer,
  ]);
};
