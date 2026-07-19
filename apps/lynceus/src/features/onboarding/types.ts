import type { ComponentType, ReactNode } from "react";
import type { Easing } from "framer-motion";
import type { AnimationLevel } from "../../hooks/useUserPreferences";

export type OnboardingSceneId =
  | "add-folder"
  | "arrange"
  | "organise"
  | "search"
  | "similarity"
  | "gesture-practice";

export interface ClosedTrack<T> {
  values: readonly T[];
  times: readonly number[];
  ease?: readonly Easing[];
}

export interface VisualFrame {
  transform: string;
  opacity: number;
}

export interface CursorFrame {
  x: number;
  y: number;
  pressScale: number;
  haloOpacity: number;
  haloScale: number;
}

export interface ReducedFrame {
  caption: string;
  content: ReactNode;
}

export interface OnboardingSceneProps {
  animationLevel: Exclude<AnimationLevel, "off">;
}

export interface OnboardingSceneDefinition {
  id: OnboardingSceneId;
  title: string;
  caption: string;
  durationMs: number;
  Component: ComponentType<OnboardingSceneProps>;
  reducedFrames: readonly ReducedFrame[];
  tracks: Readonly<Record<string, ClosedTrack<unknown>>>;
}

export function assertClosedTrack<T>(track: ClosedTrack<T>): void {
  if (track.values.length < 2 || track.values.length !== track.times.length) {
    throw new Error("Closed tracks need matching value and time keyframes");
  }
  if (track.times[0] !== 0 || track.times[track.times.length - 1] !== 1) {
    throw new Error("Closed tracks must span normalised time 0 to 1");
  }
  for (let index = 1; index < track.times.length; index += 1) {
    if (track.times[index] <= track.times[index - 1]) {
      throw new Error("Closed-track times must be strictly increasing");
    }
  }
  if (track.ease && track.ease.length !== track.values.length - 1) {
    throw new Error("Closed tracks need one easing value per transition");
  }
  if (
    JSON.stringify(track.values[0]) !==
    JSON.stringify(track.values[track.values.length - 1])
  ) {
    throw new Error("Closed tracks must finish on their exact first value");
  }
}
