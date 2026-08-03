import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

/**
 * The reference-history strip (bottom-left, under "Reference x of y"):
 * `history` accumulates every position the session has actually reached,
 * `viewedIndex`/`viewedImage` name whatever is on screen, and
 * `selectHistoryIndex` is pure viewing — it never mutates `history` or the
 * real session position (`currentIndex`).
 */
describe("useGestureTimer history strip", () => {
  it("accumulates one entry per advance, including the starting reference, and never shrinks", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 60,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "count", count: 4 },
      repeatAllowed: false,
    };
    const { result } = renderTimer(config);

    expect(result.current.history).toEqual([result.current.currentImage]);
    expect(result.current.history[0].id).toBe(start.id);

    act(() => result.current.next());
    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[1]).toBe(result.current.currentImage);

    act(() => result.current.next());
    expect(result.current.history).toHaveLength(3);
    expect(result.current.history[2]).toBe(result.current.currentImage);

    // Going back with the existing transport doesn't shrink the strip —
    // nothing already shown is ever removed.
    act(() => result.current.previous());
    expect(result.current.history).toHaveLength(3);
  });

  it("selecting a past index views it without touching history, the real position, or nextImageUrl", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 60,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "count", count: 3 },
      repeatAllowed: false,
    };
    const { result } = renderTimer(config);

    act(() => result.current.next());
    const realCurrentImage = result.current.currentImage;
    const realNextImageUrl = result.current.nextImageUrl;
    const historyBefore = result.current.history;

    act(() => result.current.selectHistoryIndex(0));

    expect(result.current.isViewingHistory).toBe(true);
    expect(result.current.viewedIndex).toBe(0);
    expect(result.current.viewedImage).toBe(result.current.history[0]);
    expect(result.current.viewedImage.id).toBe(start.id);
    // Pure viewing: the real session position and predecode target are
    // untouched by browsing.
    expect(result.current.currentImage).toBe(realCurrentImage);
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.nextImageUrl).toBe(realNextImageUrl);
    expect(result.current.history).toBe(historyBefore);
    expect(result.current.history).toHaveLength(2);

    // positionLabel keeps reporting the real session position; the viewed
    // label follows whatever is on screen.
    expect(result.current.positionLabel).toBe("2 / 3");
    expect(result.current.viewedPositionLabel).toBe("1 / 3");
  });

  it("selecting the tip resumes normally", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 60,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "count", count: 3 },
      repeatAllowed: false,
    };
    const { result } = renderTimer(config);

    act(() => result.current.next());
    act(() => result.current.selectHistoryIndex(0));
    expect(result.current.isViewingHistory).toBe(true);

    act(() => result.current.selectHistoryIndex(1));
    expect(result.current.isViewingHistory).toBe(false);
    expect(result.current.viewedIndex).toBe(result.current.currentIndex);
    expect(result.current.viewedImage).toBe(result.current.currentImage);
  });

  it("keeps history growing through the continuous+repeat tail (sequence itself grows on advance)", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 60,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "continuous" },
      repeatAllowed: true,
    };
    const { result } = renderTimer(config);

    expect(result.current.history).toHaveLength(1);
    act(() => result.current.next());
    expect(result.current.history).toHaveLength(2);
    act(() => result.current.next());
    expect(result.current.history).toHaveLength(3);
  });
});

/**
 * Countdown suspension while browsing history slots into the same
 * `suspended` mechanism the image-load gate already uses (useGestureTimer.ts
 * `isViewingHistory` term) — these tests drive the interval for real via
 * fake timers plus a controlled `performance.now`, unlike the tests above
 * which stay `suspended: true` throughout to isolate the pure state.
 */
describe("useGestureTimer history viewing pauses the countdown", () => {
  let now = 0;

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function advance(ms: number) {
    now += ms;
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  function renderRunningTimer(config: GestureTimerConfig) {
    return renderHook(() =>
      useGestureTimer({
        startingImage: start,
        candidateImages: candidates,
        config,
        suspended: false,
      }),
    );
  }

  it("does not burn the countdown against a past reference, and resumes with the remaining time intact", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 60,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "count", count: 3 },
      repeatAllowed: false,
    };
    const { result } = renderRunningTimer(config);

    advance(10_000);
    expect(result.current.remainingMs).toBe(50_000);

    act(() => result.current.next());
    expect(result.current.remainingMs).toBe(60_000);
    advance(20_000);
    expect(result.current.remainingMs).toBe(40_000);

    act(() => result.current.selectHistoryIndex(0));
    expect(result.current.isViewingHistory).toBe(true);

    // Time passes while browsing history — the real session's countdown
    // must not move.
    advance(30_000);
    expect(result.current.remainingMs).toBe(40_000);
    expect(result.current.currentIndex).toBe(1);

    // Re-selecting the tip (index 1, the real position) resumes — the
    // countdown continues from 40_000, it does not reset to 60_000.
    act(() => result.current.selectHistoryIndex(1));
    expect(result.current.isViewingHistory).toBe(false);
    advance(5_000);
    expect(result.current.remainingMs).toBe(35_000);
  });

  it("blocks auto-advance while viewing history — the session can't move on its own", () => {
    const config: GestureTimerConfig = {
      intervalSeconds: 1,
      similarityRange: { min: 1, max: 3 },
      sessionLength: { mode: "count", count: 3 },
      repeatAllowed: false,
    };
    const { result } = renderRunningTimer(config);

    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);

    act(() => result.current.selectHistoryIndex(0));
    expect(result.current.isViewingHistory).toBe(true);

    // Advance far past the 1s interval — with no browsing this would have
    // auto-advanced (and, at the sequence end, completed the session).
    advance(30_000);

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.remainingMs).toBe(1000);
  });
});
