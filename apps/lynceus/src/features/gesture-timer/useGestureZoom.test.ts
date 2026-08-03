import { describe, expect, it } from "vitest";
import {
  constrainZoomTransform,
  naturalPixelScale,
  resolveWheelGesture,
  zoomTransformAroundPoint,
} from "./zoomGeometry";

const geometry = {
  viewportWidth: 1000,
  viewportHeight: 800,
  imageWidth: 800,
  imageHeight: 800,
};

describe("gesture-timer zoom geometry", () => {
  it("keeps the content beneath the cursor stationary while zooming", () => {
    expect(
      zoomTransformAroundPoint(
        { scale: 1, x: 0, y: 0 },
        2,
        { x: 750, y: 300 },
        geometry,
      ),
    ).toEqual({ scale: 2, x: -250, y: 100 });
  });

  it("clamps panning to the transformed image edges", () => {
    expect(
      constrainZoomTransform(
        { scale: 2, x: 900, y: -900 },
        geometry,
      ),
    ).toEqual({ scale: 2, x: 300, y: -400 });
  });

  it("maps fit-sized pixels back to a true one-to-one image scale", () => {
    expect(naturalPixelScale(2400, 800)).toBe(3);
    expect(naturalPixelScale(600, 800)).toBe(1);
    expect(naturalPixelScale(0, 0)).toBe(1);
  });

  it("routes a pinch (ctrl-wheel) to zoom at any scale", () => {
    expect(resolveWheelGesture(true, 1)).toBe("zoom");
    expect(resolveWheelGesture(true, 4)).toBe("zoom");
  });

  it("routes a plain two-finger scroll to pan only while zoomed", () => {
    expect(resolveWheelGesture(false, 4)).toBe("pan");
    expect(resolveWheelGesture(false, 1)).toBe("none");
  });
});
