import type { Easing, TargetAndTransition, Transition } from "framer-motion";
import type {
  ClosedTrack,
  CursorFrame,
  VisualFrame,
} from "./types";

export const LIVE_MS = 200;
export const LIVE_EASE = [0.2, 0, 0, 1] as const;
export const SETTLE_MS = 260;
export const SETTLE_EASE = [0.16, 1, 0.3, 1] as const;
export const CURSOR_TRAVEL_EASE = [0.22, 1, 0.36, 1] as const;
export const PRESS_DOWN_MS = 90;
export const PRESS_UP_MS = 110;
export const FADE_MS = 180;
export const FADE_EASE = SETTLE_EASE;
export const STAGGER_MS = 90;
export const CURSOR_PARK = { x: 912, y: 552 } as const;

const LINEAR: Easing = "linear";
const SUBTLE_OPACITY_MS = 180;

interface VisualMotionOptions {
  subtle?: boolean;
  removeScaleAccent?: boolean;
}

export function visualFrame(
  transform = "translate3d(0px, 0px, 0px) scale(1)",
  opacity = 1,
): VisualFrame {
  return { transform, opacity };
}

export function visualTrack(
  values: readonly VisualFrame[],
  times: readonly number[],
  ease?: readonly Easing[],
): ClosedTrack<VisualFrame> {
  return { values, times, ease };
}

export function cursorFrame(
  x: number,
  y: number,
  pressScale = 1,
  haloOpacity = 0,
  haloScale = 0.7,
): CursorFrame {
  return { x, y, pressScale, haloOpacity, haloScale };
}

export function cursorTrack(
  values: readonly CursorFrame[],
  times: readonly number[],
  ease?: readonly Easing[],
): ClosedTrack<CursorFrame> {
  return { values, times, ease };
}

function loopingTransition<T>(
  track: ClosedTrack<T>,
  durationMs: number,
): Transition {
  return {
    duration: durationMs / 1000,
    times: [...track.times],
    ease: track.ease ? [...track.ease] : LINEAR,
    repeat: Infinity,
    repeatType: "loop",
  };
}

export function visualMotion(
  track: ClosedTrack<VisualFrame>,
  durationMs: number,
  options: VisualMotionOptions = {},
): TargetAndTransition {
  const transform = track.values.map((value) =>
    options.subtle && options.removeScaleAccent
      ? value.transform.replace(/scale\([^)]*\)/g, "scale(1)")
      : value.transform,
  );
  if (options.subtle) {
    const opacityTimes = [...track.times];
    const maxOpacityStep = SUBTLE_OPACITY_MS / durationMs;
    for (let index = 1; index < track.values.length; index += 1) {
      if (
        track.values[index].opacity !== track.values[index - 1].opacity &&
        opacityTimes[index] - opacityTimes[index - 1] > maxOpacityStep
      ) {
        opacityTimes[index] = opacityTimes[index - 1] + maxOpacityStep;
      }
    }
    return {
      transform,
      opacity: track.values.map((value) => value.opacity),
      transition: {
        transform: loopingTransition(track, durationMs),
        opacity: loopingTransition(
          { ...track, times: opacityTimes },
          durationMs,
        ),
      },
    };
  }
  return {
    transform,
    opacity: track.values.map((value) => value.opacity),
    transition: loopingTransition(track, durationMs),
  };
}

export function cursorMotion(
  track: ClosedTrack<CursorFrame>,
  durationMs: number,
): {
  wrapper: TargetAndTransition;
  pointer: TargetAndTransition;
  halo: TargetAndTransition;
} {
  const transition = loopingTransition(track, durationMs);
  return {
    wrapper: {
      transform: track.values.map(
        ({ x, y }) => `translate3d(${x}px, ${y}px, 0px)`,
      ),
      transition,
    },
    pointer: {
      scale: track.values.map(({ pressScale }) => pressScale),
      transition,
    },
    halo: {
      opacity: track.values.map(({ haloOpacity }) => haloOpacity),
      scale: track.values.map(({ haloScale }) => haloScale),
      transition,
    },
  };
}

export function normaliseTimes(durationMs: number, offsets: readonly number[]) {
  return offsets.map((offset) => offset / durationMs);
}
