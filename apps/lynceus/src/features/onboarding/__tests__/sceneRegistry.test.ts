import { describe, expect, it } from "vitest";
import { sceneRegistry } from "../sceneRegistry";

describe("onboarding scene registry", () => {
  it("keeps the accepted six-scene order and durations", () => {
    expect(sceneRegistry.map(({ id }) => id)).toEqual([
      "add-folder",
      "arrange",
      "organise",
      "search",
      "similarity",
      "gesture-practice",
    ]);
    expect(sceneRegistry.map(({ durationMs }) => durationMs)).toEqual([
      7000, 8400, 7500, 7000, 9000, 11200,
    ]);
  });

  it("provides three reduced-motion frames for every scene", () => {
    expect(sceneRegistry).toHaveLength(6);
    for (const scene of sceneRegistry) {
      expect(scene.title).not.toBe("");
      expect(scene.caption).not.toBe("");
      expect(scene.reducedFrames).toHaveLength(3);
    }
  });
});
