import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MasonryAnchor } from "./MasonryAnchor";
import {
  LIVE_REFLOW_EASING,
  LIVE_REFLOW_MS,
  SETTLE_EASING,
  SETTLE_MS,
} from "./masonryMotion";

const baseProps = {
  id: 7,
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  onTop: false,
};

describe("MasonryAnchor motion", () => {
  it("switches inline transition tokens by motion mode and scopes promotion", () => {
    const { container, rerender } = render(
      <MasonryAnchor {...baseProps} motion="live" settling={false}>
        tile
      </MasonryAnchor>,
    );
    const anchor = container.firstElementChild as HTMLElement;

    expect(anchor.style.transition).toBe(
      `transform ${LIVE_REFLOW_MS}ms ${LIVE_REFLOW_EASING}`,
    );
    expect(anchor.style.willChange).toBe("");

    rerender(
      <MasonryAnchor {...baseProps} motion="settle" settling={false}>
        tile
      </MasonryAnchor>,
    );
    expect(anchor.style.transition).toBe(
      [
        `transform ${SETTLE_MS}ms ${SETTLE_EASING}`,
        `width ${SETTLE_MS}ms ${SETTLE_EASING}`,
        `height ${SETTLE_MS}ms ${SETTLE_EASING}`,
      ].join(", "),
    );
    expect(anchor.style.willChange).toBe("");

    // Settling alone does NOT promote: a settle repack fans `settling` to
    // every visible anchor, and promoting dozens of unmoved retina tiles is
    // will-change overuse. Promotion requires the settle to have MOVED this
    // anchor.
    rerender(
      <MasonryAnchor {...baseProps} motion="settle" settling>
        tile
      </MasonryAnchor>,
    );
    expect(anchor.style.willChange).toBe("");

    rerender(
      <MasonryAnchor {...baseProps} x={250} motion="settle" settling>
        tile
      </MasonryAnchor>,
    );
    expect(anchor.style.willChange).toBe("transform");

    // The latch holds through the glide even without further movement…
    rerender(
      <MasonryAnchor {...baseProps} x={250} motion="settle" settling>
        tile
      </MasonryAnchor>,
    );
    expect(anchor.style.willChange).toBe("transform");

    // …and releases when settling ends.
    rerender(
      <MasonryAnchor {...baseProps} x={250} motion="settle" settling={false}>
        tile
      </MasonryAnchor>,
    );
    expect(anchor.style.willChange).toBe("");
  });
});
