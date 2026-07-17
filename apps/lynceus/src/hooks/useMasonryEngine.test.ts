import { describe, it, expect } from "vitest";
import { isWithinGuardBand } from "./useMasonryEngine";

/**
 * Guard-band predicate for the scroll virtualization (T1-3).
 *
 * `isWithinGuardBand` decides whether a scroll move is small enough to keep
 * the current visible set (no filter re-run). The committed viewport already
 * carries the ±overscan margin; the band is the inner half of that margin.
 *
 * The load-bearing correctness property: because the band is strictly smaller
 * than the overscan, whenever the predicate says "stay", the on-screen window
 * still sits strictly inside the committed render range — so an on-screen tile
 * is never culled between refreshes. These tests pin that property directly,
 * which is why the band lives in a pure function rather than only inside the
 * hook's scroll effect (mounting the hook needs a live scroll ancestor + rAF
 * and would be brittle for this invariant).
 */

// A committed viewport for an on-screen window of [0, 200] with 800px
// overscan on each side, matching the hook's VIEWPORT_OVERSCAN_PX.
const OVERSCAN = 800;
const GUARD = OVERSCAN / 2; // 400
const committed = { top: 0 - OVERSCAN, bottom: 200 + OVERSCAN };

describe("isWithinGuardBand", () => {
  it("keeps the visible set at the freshly-committed position", () => {
    // The window the viewport was computed for is well inside the band.
    expect(isWithinGuardBand(committed, 0, 200, GUARD)).toBe(true);
  });

  it("keeps the visible set for a sub-band scroll", () => {
    // Scrolled down 300px (< 400 band) — leading margin is still 500 > band.
    expect(isWithinGuardBand(committed, 300, 500, GUARD)).toBe(true);
  });

  it("refreshes once a downward scroll reaches the band edge", () => {
    // localBottom 601 → leading margin 999-601 = 399 < 400 → refresh.
    expect(isWithinGuardBand(committed, 401, 601, GUARD)).toBe(false);
  });

  it("refreshes once an upward scroll reaches the band edge", () => {
    // localTop -401 → top margin -401-(-800) = 399 < 400 → refresh.
    expect(isWithinGuardBand(committed, -401, -201, GUARD)).toBe(false);
  });

  it("never keeps a set once an on-screen edge would leave the render range", () => {
    // Property: for a positive band, "stay" implies the on-screen window is
    // strictly inside the committed range, so on-screen tiles are always kept.
    const samples = [-2000, -900, -400, 0, 300, 750, 1500];
    for (const localTop of samples) {
      const localBottom = localTop + 200;
      if (isWithinGuardBand(committed, localTop, localBottom, GUARD)) {
        expect(localTop).toBeGreaterThan(committed.top);
        expect(localBottom).toBeLessThan(committed.bottom);
      }
    }
  });

  it("with a zero band, degrades to the plain in-range check", () => {
    // A window flush against the committed edge is still 'within' at band 0,
    // but not once it pokes past — the band is what adds the safety buffer.
    expect(isWithinGuardBand(committed, -800, 1000, 0)).toBe(true);
    expect(isWithinGuardBand(committed, -801, 999, 0)).toBe(false);
  });
});
