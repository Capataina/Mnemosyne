import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGestureTimer } from "./useGestureTimer";
import type { GestureTimerConfig, GestureTimerImage } from "./types";

/**
 * `nextImageUrl` derivation for the timer predecode (T1-6).
 *
 * The predecode window warms whatever `nextImageUrl` reports, so the property
 * that matters is that it names the reference the timer will ACTUALLY advance
 * to next. These tests advance the timer and assert the previously-reported
 * next URL is the one that became current — regardless of the shuffle order —
 * plus the one honest limit: the continuous+repeat tail picks its next image
 * at advance time, so `nextImageUrl` is undefined there (nothing to predecode).
 */

const start: GestureTimerImage = { id: 1, url: "u1", name: "start" };
const candidates: GestureTimerImage[] = [
  { id: 10, url: "u10" },
  { id: 11, url: "u11" },
  { id: 12, url: "u12" },
];

// Suspended so the countdown interval never auto-advances — we drive `next`
// explicitly and read the derivation deterministically.
function renderTimer(config: GestureTimerConfig) {
  return renderHook(() =>
    useGestureTimer({
      startingImage: start,
      candidateImages: candidates,
      config,
      suspended: true,
    }),
  );
}

describe("useGestureTimer nextImageUrl", () => {
  it("names the reference each advance actually lands on, then undefined at the end", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 60,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "count", count: 3 },
      repeatAllowed: false,
    };
    const { result } = renderTimer(config);

    // A built count-mode sequence has a deterministic next at every non-final
    // index: the predicted URL must equal the current URL after advancing.
    const predictedAt0 = result.current.nextImageUrl;
    expect(predictedAt0).toBeDefined();
    act(() => result.current.next());
    expect(result.current.currentImage.url).toBe(predictedAt0);

    const predictedAt1 = result.current.nextImageUrl;
    expect(predictedAt1).toBeDefined();
    act(() => result.current.next());
    expect(result.current.currentImage.url).toBe(predictedAt1);

    // Index 2 is the last in a count-3 session → nothing to predecode.
    expect(result.current.nextImageUrl).toBeUndefined();
  });

  it("is undefined at the continuous+repeat tail (next is random at advance time)", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 60,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "continuous" },
      repeatAllowed: true,
    };
    const { result } = renderTimer(config);
    // The repeat sequence starts as [start] alone; the next image is appended
    // by a random pick inside `next`, so it can't be known ahead of the swap.
    expect(result.current.nextImageUrl).toBeUndefined();
  });
});
