import { describe, expect, it } from "vitest";
import { visualFrame, visualMotion, visualTrack } from "../onboardingMotion";
import { sceneRegistry } from "../sceneRegistry";
import { assertClosedTrack } from "../types";

describe("onboarding closed tracks", () => {
  for (const scene of sceneRegistry) {
    it(`${scene.id} closes every declared keyframe track`, () => {
      for (const [name, track] of Object.entries(scene.tracks)) {
        expect(() => assertClosedTrack(track), name).not.toThrow();
        expect(track.values[track.values.length - 1], name).toEqual(track.values[0]);
        expect(track.times[0], name).toBe(0);
        expect(track.times[track.times.length - 1], name).toBe(1);
      }
    });
  }

  it("caps subtle opacity travel and removes only opted-in scale accents", () => {
    const track = visualTrack(
      [
        visualFrame("translate3d(0px, 0px, 0px) scale(.96)", 0),
        visualFrame("translate3d(0px, 0px, 0px) scale(.96)", 0),
        visualFrame("translate3d(0px, 0px, 0px) scale(1)", 1),
        visualFrame("translate3d(0px, 0px, 0px) scale(1)", 1),
        visualFrame("translate3d(0px, 0px, 0px) scale(.96)", 0),
        visualFrame("translate3d(0px, 0px, 0px) scale(.96)", 0),
      ],
      [0, 0.1, 0.4, 0.6, 0.9, 1],
    );
    const animation = visualMotion(track, 1000, {
      subtle: true,
      removeScaleAccent: true,
    });
    const transition = animation.transition as {
      opacity: { times: number[] };
    };

    expect(animation.transform).toEqual(
      Array.from({ length: 6 }, () =>
        "translate3d(0px, 0px, 0px) scale(1)"
      ),
    );
    expect(transition.opacity.times).toEqual([0, 0.1, 0.28, 0.6, 0.78, 1]);
  });
});
