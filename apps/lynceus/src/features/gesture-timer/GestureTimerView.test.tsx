import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GestureTimerView } from "./GestureTimerView";
import type { GestureTimerConfig, GestureTimerImage } from "./types";

const start: GestureTimerImage = {
  id: 1,
  url: "start.jpg",
  name: "Starting reference",
  width: 2400,
  height: 2400,
};

const candidates: GestureTimerImage[] = [
  {
    id: 2,
    url: "second.jpg",
    name: "Second reference",
    width: 2400,
    height: 2400,
  },
];

const config: GestureTimerConfig = {
  intervalSeconds: 60,
  similarityRange: { min: 1, max: 1 },
  sessionLength: { mode: "count", count: 2 },
  repeatAllowed: false,
};

const historyCandidates: GestureTimerImage[] = [
  { id: 2, url: "second.jpg", name: "Second reference" },
  { id: 3, url: "third.jpg", name: "Third reference" },
];

const historyConfig: GestureTimerConfig = {
  intervalSeconds: 60,
  similarityRange: { min: 1, max: 2 },
  sessionLength: { mode: "count", count: 3 },
  repeatAllowed: false,
};

function renderView() {
  return render(
    <GestureTimerView
      startingImage={start}
      candidateImages={candidates}
      config={config}
      settingsOpen={false}
      onRequestSettings={vi.fn()}
      onRestart={vi.fn()}
      onExit={vi.fn()}
    />,
  );
}

// happy-dom's WheelEvent constructor drops ctrlKey (and fireEvent.wheel passes
// it through as undefined), so the trackpad-pinch encoding (ctrl-wheel) has to
// be dispatched as a hand-built event.
function firePinchWheel(
  stage: HTMLElement,
  init: { deltaY: number; clientX: number; clientY: number },
) {
  const event = new Event("wheel", { bubbles: true, cancelable: true });
  const fields = { ...init, ctrlKey: true, deltaMode: 0, deltaX: 0 };
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(event, key, { value });
  }
  // Dispatch through fireEvent so React state updates flush inside act().
  fireEvent(stage, event);
}

function setZoomGeometry(stage: HTMLElement, image: HTMLImageElement) {
  Object.defineProperties(stage, {
    clientWidth: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 800 },
  });
  Object.defineProperties(image, {
    offsetWidth: { configurable: true, value: 800 },
    offsetHeight: { configurable: true, value: 800 },
    naturalWidth: { configurable: true, value: 2400 },
    naturalHeight: { configurable: true, value: 2400 },
  });
}

describe("GestureTimerView zoom", () => {
  it("zooms around pinch (ctrl-wheel) input and exposes an immediate return to fit", () => {
    renderView();
    const stage = screen.getByLabelText(/Drawing reference/);
    const image = screen.getByRole("img", {
      name: "Starting reference",
    }) as HTMLImageElement;
    setZoomGeometry(stage, image);
    fireEvent.load(image);

    firePinchWheel(stage, { deltaY: -100, clientX: 750, clientY: 300 });

    expect(image.style.transform).toContain("scale(");
    const reset = screen.getByRole("button", { name: "Reset zoom to fit" });
    expect(reset).toHaveAttribute("tabindex", "0");
    fireEvent.click(reset);
    expect(image.style.transform).toBe("");
  });

  it("pans with a plain scroll only while zoomed", () => {
    renderView();
    const stage = screen.getByLabelText(/Drawing reference/);
    const image = screen.getByRole("img", {
      name: "Starting reference",
    }) as HTMLImageElement;
    setZoomGeometry(stage, image);
    fireEvent.load(image);

    fireEvent.wheel(stage, { deltaY: -100, clientX: 750, clientY: 300 });
    expect(image.style.transform).toBe("");

    firePinchWheel(stage, { deltaY: -100, clientX: 750, clientY: 300 });
    const zoomed = image.style.transform;
    expect(zoomed).toContain("scale(");

    fireEvent.wheel(stage, { deltaX: 40, deltaY: 25 });
    expect(image.style.transform).not.toBe(zoomed);
    expect(image.style.transform).toContain("scale(");
  });

  it("mounts the next keyed image at fit with no stale transform", () => {
    renderView();
    const stage = screen.getByLabelText(/Drawing reference/);
    const firstImage = screen.getByRole("img", {
      name: "Starting reference",
    }) as HTMLImageElement;
    setZoomGeometry(stage, firstImage);
    fireEvent.load(firstImage);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "+" });
    expect(firstImage.style.transform).not.toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    const nextImage = screen.getByRole("img", {
      name: "Second reference",
    }) as HTMLImageElement;
    expect(nextImage).not.toBe(firstImage);
    expect(nextImage.style.transform).toBe("");
  });
});

function renderHistoryView() {
  return render(
    <GestureTimerView
      startingImage={start}
      candidateImages={historyCandidates}
      config={historyConfig}
      settingsOpen={false}
      onRequestSettings={vi.fn()}
      onRestart={vi.fn()}
      onExit={vi.fn()}
    />,
  );
}

function historyThumbnails() {
  return screen.getAllByRole("button", { name: /^Reference \d+ of \d+$/ });
}

// `historyCandidates` shuffles, so the second/third reference's name isn't
// deterministic — read whatever is actually on the stage instead of
// hardcoding an assumed order.
function currentStageImage() {
  return screen
    .getByLabelText(/Drawing reference/)
    .querySelector("[data-gesture-timer-image]") as HTMLImageElement;
}

describe("GestureTimerView reference-history strip", () => {
  it("shows one box per reference shown so far, current one included, growing on each advance without ever shrinking", () => {
    renderHistoryView();
    const firstImage = screen.getByRole("img", { name: "Starting reference" });
    fireEvent.load(firstImage);

    // The strip is visible from the very first reference — one box.
    expect(historyThumbnails()).toHaveLength(1);
    expect(historyThumbnails()[0]).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    fireEvent.load(currentStageImage());
    expect(historyThumbnails()).toHaveLength(2);
    // The newest (current) box carries the selection.
    expect(historyThumbnails()[1]).toHaveAttribute("aria-current", "true");
    expect(historyThumbnails()[0]).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    fireEvent.load(currentStageImage());
    expect(historyThumbnails()).toHaveLength(3);

    // Going back with the existing transport control doesn't remove boxes.
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(historyThumbnails()).toHaveLength(3);
  });

  it("clicking a past box displays it, pauses the countdown, and clicking the newest box resumes without removing anything", () => {
    renderHistoryView();
    fireEvent.load(screen.getByRole("img", { name: "Starting reference" }));
    const startingName = currentStageImage().alt;

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    fireEvent.load(currentStageImage());
    const secondName = currentStageImage().alt;
    expect(secondName).not.toBe(startingName);

    const [pastBox, newestBox] = historyThumbnails();
    expect(historyThumbnails()).toHaveLength(2);

    fireEvent.click(pastBox);

    // The stage now shows the past (starting) reference, and the timer
    // aria-label reports paused; the "N of M" text under the strip follows
    // the viewed item, not the real session position.
    expect(currentStageImage().alt).toBe(startingName);
    expect(screen.getByText("Reference 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveAccessibleName(/paused/);
    expect(pastBox).toHaveAttribute("aria-current", "true");
    expect(newestBox).not.toHaveAttribute("aria-current");

    // Nothing was removed — both boxes remain, pure viewing.
    expect(historyThumbnails()).toHaveLength(2);

    fireEvent.click(newestBox);

    expect(currentStageImage().alt).toBe(secondName);
    expect(screen.getByText("Reference 2 of 3")).toBeInTheDocument();
    expect(newestBox).toHaveAttribute("aria-current", "true");
    expect(historyThumbnails()).toHaveLength(2);
  });
});
