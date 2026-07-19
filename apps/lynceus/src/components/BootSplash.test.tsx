import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootSplash } from "./BootSplash";
import { queryClient } from "../queries/queryClient";

describe("BootSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  it("holds through the minimum display, then fades and unmounts", () => {
    // Manifest settled BEFORE mount (warm start) — the 600ms minimum is
    // what keeps this from being a one-frame flash.
    queryClient.setQueryData(["feed-manifest", []], []);
    const { container } = render(<BootSplash />);
    const splash = container.firstElementChild as HTMLElement;

    expect(splash.textContent).toContain("Lynceus");
    expect(splash.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(splash.className).toContain("opacity-0");

    fireEvent.transitionEnd(splash);
    expect(container.firstElementChild).toBeNull();
  });

  it("waits for the manifest signal, but the 5s hard cap always wins", () => {
    // No feed-manifest query ever settles (worst case: hung backend).
    const { container } = render(<BootSplash />);
    const splash = container.firstElementChild as HTMLElement;

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(splash.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(4400);
    });
    expect(splash.className).toContain("opacity-0");
  });

  it("hides when the manifest settles after mount", () => {
    const { container } = render(<BootSplash />);
    const splash = container.firstElementChild as HTMLElement;

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(splash.className).toContain("opacity-100");

    act(() => {
      queryClient.setQueryData(["feed-manifest", []], []);
    });
    expect(splash.className).toContain("opacity-0");
  });
});
