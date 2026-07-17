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
  it("zooms around wheel input and exposes an immediate return to fit", () => {
    renderView();
    const stage = screen.getByLabelText(/Drawing reference/);
    const image = screen.getByRole("img", {
      name: "Starting reference",
    }) as HTMLImageElement;
    setZoomGeometry(stage, image);
    fireEvent.load(image);

    fireEvent.wheel(stage, {
      deltaY: -100,
      clientX: 750,
      clientY: 300,
    });

    expect(image.style.transform).toContain("scale(");
    const reset = screen.getByRole("button", { name: "Reset zoom to fit" });
    expect(reset).toHaveAttribute("tabindex", "0");
    fireEvent.click(reset);
    expect(image.style.transform).toBe("");
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
