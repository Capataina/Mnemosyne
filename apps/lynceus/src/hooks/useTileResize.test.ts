import { describe, it, expect } from "vitest";
import { anchorStartColFor } from "./useTileResize";
import type { ResizeCorner } from "./useTileResize";

/**
 * The re-anchor column math that keeps a resizing tile in place. The packer
 * clamps the result into `[0, colCount - span]`, so these assertions are about
 * the pre-clamp intent: which edge each corner holds fixed.
 *
 * This also documents the bug #3 finding: the four corners are symmetric on
 * the horizontal axis (tl≡bl on the left edge, tr≡br on the right edge). The
 * masonry model is width-driven and top-left-anchored, so a top-corner drag
 * widens the tile exactly like its bottom counterpart — "growing upward" is
 * inherent-impossible, not a sign bug.
 */
describe("anchorStartColFor — corner holds the opposite edge fixed", () => {
  const at = (corner: ResizeCorner, startCol: number, baseSpan: number, span: number) =>
    anchorStartColFor(corner, startCol, baseSpan, span);

  it("right corners keep the left edge (start column) fixed as the tile grows", () => {
    // A tile at column 2, span 1, grown to span 3 from a right corner keeps
    // start = 2 and extends rightward.
    for (const corner of ["tr", "br"] as ResizeCorner[]) {
      expect(at(corner, 2, 1, 1)).toBe(2);
      expect(at(corner, 2, 1, 3)).toBe(2);
    }
  });

  it("left corners keep the right edge fixed, so start walks left as it grows", () => {
    // A tile at column 2, span 1 (right edge = column 3) grown to span 3 from
    // a left corner keeps the right edge and moves start to 3 - 3 = 0.
    for (const corner of ["tl", "bl"] as ResizeCorner[]) {
      expect(at(corner, 2, 1, 1)).toBe(2); // no growth → unchanged
      expect(at(corner, 2, 1, 3)).toBe(0); // right edge (2+1) held, start = 3 - 3
    }
  });

  it("top and bottom corners on the same side are identical (horizontal-only)", () => {
    expect(at("tl", 4, 2, 3)).toBe(at("bl", 4, 2, 3));
    expect(at("tr", 4, 2, 3)).toBe(at("br", 4, 2, 3));
  });
});
