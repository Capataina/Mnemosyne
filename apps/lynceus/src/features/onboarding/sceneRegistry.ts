import type { ClosedTrack, OnboardingSceneDefinition } from "./types";
import {
  ADD_FOLDER_DURATION_MS,
  ADD_FOLDER_REDUCED_FRAMES,
  ADD_FOLDER_TRACKS,
  AddFolderScene,
} from "./scenes/AddFolderScene";
import {
  ARRANGE_DURATION_MS,
  ARRANGE_REDUCED_FRAMES,
  ARRANGE_TRACKS,
  ArrangeScene,
} from "./scenes/ArrangeScene";
import {
  ORGANISE_DURATION_MS,
  ORGANISE_REDUCED_FRAMES,
  ORGANISE_TRACKS,
  OrganiseScene,
} from "./scenes/OrganiseScene";
import {
  SEARCH_DURATION_MS,
  SEARCH_REDUCED_FRAMES,
  SEARCH_TRACKS,
  SearchScene,
} from "./scenes/SearchScene";
import {
  SIMILARITY_DURATION_MS,
  SIMILARITY_REDUCED_FRAMES,
  SIMILARITY_TRACKS,
  SimilarityScene,
} from "./scenes/SimilarityScene";
import {
  GESTURE_PRACTICE_DURATION_MS,
  GESTURE_PRACTICE_REDUCED_FRAMES,
  GESTURE_PRACTICE_TRACKS,
  GesturePracticeScene,
} from "./scenes/GesturePracticeScene";

const tracks = (value: object) =>
  value as Readonly<Record<string, ClosedTrack<unknown>>>;

export const sceneRegistry: readonly OnboardingSceneDefinition[] = [
  {
    id: "add-folder",
    title: "Bring in your library",
    caption:
      "Open Settings and add any folder. Lynceus keeps the originals in place and builds the browsable library locally.",
    durationMs: ADD_FOLDER_DURATION_MS,
    Component: AddFolderScene,
    reducedFrames: ADD_FOLDER_REDUCED_FRAMES,
    tracks: tracks(ADD_FOLDER_TRACKS),
  },
  {
    id: "arrange",
    title: "Arrange it your way",
    caption:
      "Drag any tile, resize from any corner, and trust the preview—your board settles exactly where it telegraphed.",
    durationMs: ARRANGE_DURATION_MS,
    Component: ArrangeScene,
    reducedFrames: ARRANGE_REDUCED_FRAMES,
    tracks: tracks(ARRANGE_TRACKS),
  },
  {
    id: "organise",
    title: "Organise without moving files",
    caption:
      "Slide the library out from the screen edge, combine what must be present—and what must not—and watch the grid refine live beside it.",
    durationMs: ORGANISE_DURATION_MS,
    Component: OrganiseScene,
    reducedFrames: ORGANISE_REDUCED_FRAMES,
    tracks: tracks(ORGANISE_TRACKS),
  },
  {
    id: "search",
    title: "Search by meaning or name",
    caption:
      "Describe what you remember—or type part of a filename—and local rank fusion brings the strongest matches forward.",
    durationMs: SEARCH_DURATION_MS,
    Component: SearchScene,
    reducedFrames: SEARCH_REDUCED_FRAMES,
    tracks: tracks(SEARCH_TRACKS),
  },
  {
    id: "similarity",
    title: "Follow visual connections",
    caption:
      "Open any image to explore fused visual neighbours, follow a trail, then inspect, tag, and annotate the one that matters.",
    durationMs: SIMILARITY_DURATION_MS,
    Component: SimilarityScene,
    reducedFrames: SIMILARITY_REDUCED_FRAMES,
    tracks: tracks(SIMILARITY_TRACKS),
  },
  {
    id: "gesture-practice",
    title: "Turn references into practice",
    caption:
      "Run timed sessions where the countdown advances references, zoom rides the cursor, and the history strip revisits any of them.",
    durationMs: GESTURE_PRACTICE_DURATION_MS,
    Component: GesturePracticeScene,
    reducedFrames: GESTURE_PRACTICE_REDUCED_FRAMES,
    tracks: tracks(GESTURE_PRACTICE_TRACKS),
  },
] as const;
