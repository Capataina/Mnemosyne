import { describe, expect, it } from "vitest";
import {
  buildPackInput,
  computeMasonryGeometry,
  resolveFootprintLeft,
  type MasonryPackParams,
} from "./masonryPacking";
import { transitionMasonryGesturePhase } from "../hooks/useMasonryEngine";
import type { FeedItem } from "../types";

const item = (id: number, width = 100, height = 100): FeedItem =>
  ({ id, width, height, hasThumbnail: true, name: `tile-${id}` }) as FeedItem;

describe("resolveFootprintLeft", () => {
  it("passes an in-range left column through unchanged for every span parity", () => {
    // The old centre-reference mode shifted EVEN spans one column left of
    // the rendered ghost (the 2026-07-19 diagnosis); startCol is now always
    // the physical left column, so odd and even spans behave identically.
    expect(resolveFootprintLeft(5, 1, 10)).toBe(5);
    expect(resolveFootprintLeft(5, 2, 10)).toBe(5);
    expect(resolveFootprintLeft(5, 3, 10)).toBe(5);
    expect(resolveFootprintLeft(5, 4, 10)).toBe(5);
  });

  it("clamps the complete footprint at both walls", () => {
    expect(resolveFootprintLeft(-5, 3, 6)).toBe(0);
    expect(resolveFootprintLeft(99, 3, 6)).toBe(3);
    expect(resolveFootprintLeft(5, 2, 6)).toBe(4);
    expect(resolveFootprintLeft(2, 3, 3)).toBe(0);
  });
});

describe("stable-id 2D gesture footprint", () => {
  const params: MasonryPackParams = {
    containerWidth: 600,
    minItemWidth: 100,
    columnGap: 0,
    verticalGap: 0,
    columnCountOverride: 6,
  };

  it("places the active tile at its exact top instead of a column frontier", () => {
    const items = [item(1, 100, 500), item(2), item(3), item(4)];
    const geometry = computeMasonryGeometry(
      buildPackInput(items, null, {
        ...params,
        gestureFootprint: {
          id: 3,
          span: 2,
          startCol: 4,
          top: 73.25,
        },
      }),
    );
    const index = items.findIndex((candidate) => candidate.id === 3);
    expect(geometry.xs[index]).toBe(400);
    expect(geometry.ys[index]).toBe(73.25);
    expect(geometry.spans[index]).toBe(2);
  });

  it("continues targeting the same id after array indices shuffle", () => {
    const first = [item(41), item(42), item(43), item(44)];
    const shuffled = [first[3], first[0], first[2], first[1]];
    const footprint = { id: 42, span: 1, startCol: 5, top: 211 };
    const geometry = computeMasonryGeometry(
      buildPackInput(shuffled, null, { ...params, gestureFootprint: footprint }),
    );
    const index = shuffled.findIndex((candidate) => candidate.id === 42);
    expect(index).toBe(3);
    expect(geometry.xs[index]).toBe(500);
    expect(geometry.ys[index]).toBe(211);
  });
});

describe("gesture release state machine", () => {
  it("runs active → settling → idle", () => {
    let phase = transitionMasonryGesturePhase("idle", "activate");
    expect(phase).toBe("active");
    phase = transitionMasonryGesturePhase(phase, "release");
    expect(phase).toBe("settling");
    phase = transitionMasonryGesturePhase(phase, "commit");
    expect(phase).toBe("idle");
  });

  it("a newer active generation supersedes settling without stranding", () => {
    let phase = transitionMasonryGesturePhase("active", "release");
    expect(phase).toBe("settling");
    phase = transitionMasonryGesturePhase(phase, "activate");
    expect(phase).toBe("active");
    // A late result from the superseded release cannot end the new gesture.
    expect(transitionMasonryGesturePhase(phase, "commit")).toBe("active");
  });
});
