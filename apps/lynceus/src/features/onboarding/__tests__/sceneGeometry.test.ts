import { describe, expect, it } from "vitest";
import {
  STAGE,
  centre,
  containsPoint,
  inside,
  overlaps,
  type SceneGeometryManifest,
} from "../sceneGeometry";
import { ADD_FOLDER_GEOMETRY } from "../scenes/AddFolderScene";
import { ARRANGE_GEOMETRY, ARRANGE_SETTLED_BEATS } from "../scenes/ArrangeScene";
import { ORGANISE_GEOMETRY } from "../scenes/OrganiseScene";
import { SEARCH_GEOMETRY } from "../scenes/SearchScene";
import { SIMILARITY_GEOMETRY } from "../scenes/SimilarityScene";
import { GESTURE_PRACTICE_GEOMETRY } from "../scenes/GesturePracticeScene";

/**
 * The live-pass failure class of 2026-07-19: hand-typed coordinates in
 * two parallel places — cursors clicking beside their buttons, tiles
 * leaking off the stage, "filters" that shuffled instead of re-packing.
 * These invariants hold every scene's exported geometry manifest to the
 * contract that killed it: every rect inside the stage, every declared
 * click inside (and centred on, where it claims to be) its target, and
 * every settled layout free of overlaps.
 */

const MANIFESTS: SceneGeometryManifest[] = [
  ADD_FOLDER_GEOMETRY,
  ARRANGE_GEOMETRY,
  ORGANISE_GEOMETRY,
  SEARCH_GEOMETRY,
  SIMILARITY_GEOMETRY,
  GESTURE_PRACTICE_GEOMETRY,
];

describe("scene geometry invariants", () => {
  for (const manifest of MANIFESTS) {
    describe(manifest.scene, () => {
      it("keeps every declared rect inside the 960×600 stage", () => {
        for (const [name, r] of Object.entries(manifest.bounds)) {
          expect
            .soft(inside(r, STAGE), `${name} leaks: ${JSON.stringify(r)}`)
            .toBe(true);
        }
      });

      it("lands every cursor click inside its declared target", () => {
        for (const click of manifest.clicks) {
          expect
            .soft(
              containsPoint(click.target, click.point),
              `${click.label} clicks (${click.point.x},${click.point.y}) outside ${JSON.stringify(click.target)}`,
            )
            .toBe(true);
        }
      });

      if (manifest.disjoint) {
        it("keeps every settled layout free of overlaps", () => {
          for (const [beat, rects] of Object.entries(manifest.disjoint!)) {
            for (let a = 0; a < rects.length; a += 1) {
              for (let b = a + 1; b < rects.length; b += 1) {
                expect
                  .soft(
                    !overlaps(rects[a], rects[b]),
                    `${beat}: rect ${a} ${JSON.stringify(rects[a])} overlaps rect ${b} ${JSON.stringify(rects[b])}`,
                  )
                  .toBe(true);
              }
            }
          }
        });
      }
    });
  }

  it("arrange settled beats stay inside the stage as well", () => {
    for (const [beat, rects] of Object.entries(ARRANGE_SETTLED_BEATS)) {
      for (const [index, r] of rects.entries()) {
        expect
          .soft(inside(r, STAGE), `${beat} tile ${index} leaks: ${JSON.stringify(r)}`)
          .toBe(true);
      }
    }
  });

  it("centres single-point clicks on their targets where exactness matters", () => {
    // A click derived as centre(target) must BE the centre — catches a
    // future hand-typed regression that still lands inside the rect.
    const exact: Array<[SceneGeometryManifest, string]> = [
      [ADD_FOLDER_GEOMETRY, "add-folder"],
      [ORGANISE_GEOMETRY, "library"],
      [GESTURE_PRACTICE_GEOMETRY, "start-session"],
      [SIMILARITY_GEOMETRY, "select-tile"],
    ];
    for (const [manifest, label] of exact) {
      const click = manifest.clicks.find((c) => c.label === label);
      expect(click, `${manifest.scene}/${label} missing`).toBeDefined();
      const c = centre(click!.target);
      expect
        .soft(
          Math.abs(click!.point.x - c.x) < 0.51 &&
            Math.abs(click!.point.y - c.y) < 0.51,
          `${manifest.scene}/${label} not centred`,
        )
        .toBe(true);
    }
  });
});
