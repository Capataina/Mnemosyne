import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeMasonryGeometry,
  type MasonryPackInput,
  type MasonryPackRequest,
  type MasonryPackResponse,
} from "./masonryPacking";
import { createMasonryPacker } from "./masonryPacker";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<MasonryPackResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: MasonryPackRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: MasonryPackRequest) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  resolve(message: MasonryPackResponse) {
    this.onmessage?.({ data: message } as MessageEvent<MasonryPackResponse>);
  }
}

function input(top: number | null): MasonryPackInput {
  return {
    ids: new Float64Array([1, 2, 3]),
    widths: new Float64Array([100, 100, 100]),
    heights: new Float64Array([100, 100, 100]),
    spans: new Int32Array([1, 1, 1]),
    containerWidth: 300,
    minItemWidth: 100,
    columnGap: 0,
    verticalGap: 0,
    columnCountOverride: 3,
    tileScale: 1,
    hasHero: false,
    selectedIndex: -1,
    selectedWidth: 0,
    selectedHeight: 0,
    gestureFootprint:
      top === null ? null : { id: 1, span: 1, startCol: 0, top },
    columnAnchors: null,
  };
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
});

describe("masonry worker coalescing", () => {
  it("keeps one in-flight request and replaces pending work with the latest", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const packer = createMasonryPacker();
    const results: number[] = [];
    packer.onResult((gen) => results.push(gen));
    const worker = FakeWorker.instances[0];

    packer.pack(1, 9, input(0));
    packer.pack(2, 9, input(100));
    packer.pack(3, 9, input(250));
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0]).toMatchObject({ kind: "full", gen: 1 });

    const firstInput = input(0);
    worker.resolve({
      gen: 1,
      revision: 9,
      geometry: computeMasonryGeometry(firstInput),
    });
    expect(results).toEqual([1]);
    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1]).toEqual({
      kind: "reuse",
      gen: 3,
      revision: 9,
      gestureFootprint: { id: 1, span: 1, startCol: 0, top: 250 },
    });

    worker.resolve({
      gen: 3,
      revision: 9,
      geometry: computeMasonryGeometry(input(250)),
    });
    expect(results).toEqual([1, 3]);
    expect(worker.messages).toHaveLength(2);
    packer.dispose();
  });

  it("sends catalogue arrays again only when the base revision changes", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const packer = createMasonryPacker();
    packer.onResult(() => undefined);
    const worker = FakeWorker.instances[0];

    packer.pack(1, 1, input(null));
    worker.resolve({
      gen: 1,
      revision: 1,
      geometry: computeMasonryGeometry(input(null)),
    });
    packer.pack(2, 2, input(null));
    expect(worker.messages.map((message) => message.kind)).toEqual([
      "full",
      "full",
    ]);
    packer.dispose();
  });
});
