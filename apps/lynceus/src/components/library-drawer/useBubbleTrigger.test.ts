import { act, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUBBLE_HOVER_ENTER_DELAY_MS,
  BUBBLE_HOVER_LEAVE_GRACE_MS,
  useBubbleTrigger,
} from "./useBubbleTrigger";

describe("useBubbleTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays closed until the hover-enter delay elapses", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onMouseEnter());
    expect(result.current.open).toBe(false);

    act(() => {
      vi.advanceTimersByTime(BUBBLE_HOVER_ENTER_DELAY_MS - 1);
    });
    expect(result.current.open).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.open).toBe(true);
    expect(result.current.pinned).toBe(false);
  });

  it("closes after the leave-grace window once the trigger is left", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onMouseEnter());
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_ENTER_DELAY_MS));
    expect(result.current.open).toBe(true);

    act(() => result.current.triggerProps.onMouseLeave());
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_GRACE_MS - 1));
    expect(result.current.open).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(false);
  });

  it("cancels the pending close when the pointer lands on the panel (diagonal travel)", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onMouseEnter());
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_ENTER_DELAY_MS));
    act(() => result.current.triggerProps.onMouseLeave());

    // Pointer lands on the panel before the grace window expires.
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_GRACE_MS - 50));
    act(() => result.current.panelProps.onMouseEnter());
    act(() => vi.advanceTimersByTime(10_000));

    expect(result.current.open).toBe(true);
  });

  it("leaving the panel schedules the same grace-delay close", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onMouseEnter());
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_ENTER_DELAY_MS));
    act(() => result.current.panelProps.onMouseLeave());

    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_GRACE_MS - 1));
    expect(result.current.open).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(false);
  });

  it("clicking the trigger pins immediately, bypassing the hover delay", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onClick());
    expect(result.current.pinned).toBe(true);
    expect(result.current.open).toBe(true);
  });

  it("clicking the trigger again unpins and closes", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onClick());
    act(() => result.current.triggerProps.onClick());

    expect(result.current.pinned).toBe(false);
    expect(result.current.open).toBe(false);
  });

  it("stays open on hover-leave once pinned — only close() or another toggle clears it", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onClick()); // pin
    act(() => result.current.triggerProps.onMouseLeave());
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_GRACE_MS * 5));

    expect(result.current.pinned).toBe(true);
    expect(result.current.open).toBe(true);
  });

  it("close() clears both pin and any pending hover timers", () => {
    const { result } = renderHook(() => useBubbleTrigger());

    act(() => result.current.triggerProps.onClick()); // pin
    act(() => result.current.close());

    expect(result.current.pinned).toBe(false);
    expect(result.current.open).toBe(false);

    // A leave timer scheduled just before close() must not fire later and
    // resurrect a closed state.
    act(() => result.current.triggerProps.onMouseEnter());
    act(() => result.current.close());
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_ENTER_DELAY_MS));
    expect(result.current.open).toBe(false);
  });

  /**
   * Reproduces the route's mutual-exclusion wiring (pages/[...slug].tsx)
   * verbatim — a `useEffect` pair, each closing the other bubble whenever
   * its own `open` becomes true — rather than re-deriving the assertion
   * by hand. Exercised here as a hook-level contract test since the route
   * itself has no test harness (pages/CLAUDE.md).
   */
  function useTwoMutuallyExclusiveBubbles() {
    const a = useBubbleTrigger();
    const b = useBubbleTrigger();

    useEffect(() => {
      if (a.open) b.close();
    }, [a.open, b.close]);
    useEffect(() => {
      if (b.open) a.close();
    }, [b.open, a.close]);

    return { a, b };
  }

  it("mutual exclusion: pinning one bubble closes the other", () => {
    const { result } = renderHook(() => useTwoMutuallyExclusiveBubbles());

    act(() => result.current.a.triggerProps.onClick());
    expect(result.current.a.open).toBe(true);
    expect(result.current.b.open).toBe(false);

    act(() => result.current.b.triggerProps.onClick());
    expect(result.current.b.open).toBe(true);
    expect(result.current.a.open).toBe(false);
    expect(result.current.a.pinned).toBe(false);
  });

  it("mutual exclusion: hover-opening one bubble closes the other, even if it was pinned", () => {
    const { result } = renderHook(() => useTwoMutuallyExclusiveBubbles());

    act(() => result.current.a.triggerProps.onClick()); // pin A
    expect(result.current.a.pinned).toBe(true);

    act(() => result.current.b.triggerProps.onMouseEnter());
    act(() => vi.advanceTimersByTime(BUBBLE_HOVER_ENTER_DELAY_MS));

    expect(result.current.b.open).toBe(true);
    expect(result.current.a.open).toBe(false);
    expect(result.current.a.pinned).toBe(false);
  });
});
