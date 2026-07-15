import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildGestureTimerSequence,
  getEligibleCandidates,
  pickRandomImage,
} from "./session";
import type {
  GestureTimerConfig,
  GestureTimerImage,
} from "./types";

type UseGestureTimerOptions = {
  startingImage: GestureTimerImage;
  candidateImages: readonly GestureTimerImage[];
  config: GestureTimerConfig;
  suspended?: boolean;
};

export function useGestureTimer({
  startingImage,
  candidateImages,
  config,
  suspended = false,
}: UseGestureTimerOptions) {
  const intervalMs = config.intervalSeconds * 1000;
  const eligibleCandidates = useMemo(
    () => getEligibleCandidates(startingImage, candidateImages, config),
    [candidateImages, config, startingImage],
  );
  const [sequence, setSequence] = useState<GestureTimerImage[]>(() =>
    buildGestureTimerSequence(startingImage, eligibleCandidates, config),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(intervalMs);
  const [isRunning, setIsRunning] = useState(true);
  const [isComplete, setIsComplete] = useState(false);

  const resetCountdown = useCallback(() => {
    setRemainingMs(intervalMs);
  }, [intervalMs]);

  const next = useCallback(() => {
    if (currentIndex < sequence.length - 1) {
      setCurrentIndex((index) => index + 1);
      resetCountdown();
      setIsComplete(false);
      return;
    }

    const canExpand =
      config.sessionLength.mode === "continuous" && config.repeatAllowed;
    if (canExpand) {
      const nextImage = pickRandomImage(
        eligibleCandidates,
        sequence[currentIndex]?.id,
      );
      if (nextImage) {
        setSequence((images) => [...images, nextImage]);
        setCurrentIndex(sequence.length);
        resetCountdown();
        setIsComplete(false);
        return;
      }
    }

    setRemainingMs(0);
    setIsRunning(false);
    setIsComplete(true);
  }, [
    config.repeatAllowed,
    config.sessionLength.mode,
    currentIndex,
    eligibleCandidates,
    resetCountdown,
    sequence,
  ]);

  const previous = useCallback(() => {
    if (currentIndex === 0) return;
    setCurrentIndex((index) => index - 1);
    resetCountdown();
    setIsComplete(false);
  }, [currentIndex, resetCountdown]);

  const pause = useCallback(() => setIsRunning(false), []);
  const resume = useCallback(() => {
    if (!isComplete) setIsRunning(true);
  }, [isComplete]);
  const togglePaused = useCallback(() => {
    if (isComplete) return;
    setIsRunning((running) => !running);
  }, [isComplete]);

  useEffect(() => {
    if (!isRunning || suspended || isComplete) return;

    const startedAt = performance.now();
    const startingRemainingMs = remainingMs;
    const timerId = window.setInterval(() => {
      const nextRemainingMs = Math.max(
        0,
        startingRemainingMs - (performance.now() - startedAt),
      );
      setRemainingMs(nextRemainingMs);
      if (nextRemainingMs === 0) {
        window.clearInterval(timerId);
        next();
      }
    }, 100);

    return () => window.clearInterval(timerId);
  }, [currentIndex, isComplete, isRunning, next, suspended]);

  const totalLabel =
    config.sessionLength.mode === "continuous"
      ? "∞"
      : sequence.length.toString();

  return {
    currentImage: sequence[currentIndex] ?? startingImage,
    currentIndex,
    positionLabel: `${currentIndex + 1} / ${totalLabel}`,
    remainingMs,
    progress: Math.min(1, Math.max(0, 1 - remainingMs / intervalMs)),
    isRunning,
    isComplete,
    canGoPrevious: currentIndex > 0,
    next,
    previous,
    pause,
    resume,
    togglePaused,
  };
}

