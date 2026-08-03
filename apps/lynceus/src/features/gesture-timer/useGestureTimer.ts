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

  // The reference-history strip: every position the session has actually
  // reached, in order, including the one showing now. Derived from `sequence`
  // sliced to the high-water mark rather than a hand-appended array, so it
  // stays correct through the continuous+repeat tail (which grows `sequence`
  // itself one random pick per advance) with no separate bookkeeping.
  const [highWaterMark, setHighWaterMark] = useState(0);
  useEffect(() => {
    setHighWaterMark((mark) => Math.max(mark, currentIndex));
  }, [currentIndex]);
  const history = useMemo(
    () => sequence.slice(0, highWaterMark + 1),
    [sequence, highWaterMark],
  );

  // Non-null while a PAST history entry is being viewed (pure viewing — the
  // real session position, `currentIndex`, is untouched). Any real position
  // change — `next`, `previous`, or an auto-advance — clears it, which is
  // exactly what re-syncs the strip to the tip: those are the only paths
  // that move `currentIndex`, so watching it is sufficient.
  const [historyOverrideIndex, setHistoryOverrideIndex] = useState<
    number | null
  >(null);
  useEffect(() => {
    setHistoryOverrideIndex(null);
  }, [currentIndex]);

  const selectHistoryIndex = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), history.length - 1);
      setHistoryOverrideIndex(clamped === currentIndex ? null : clamped);
    },
    [currentIndex, history.length],
  );

  const isViewingHistory = historyOverrideIndex !== null;
  const viewedIndex = historyOverrideIndex ?? currentIndex;

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
    // Viewing a past reference pauses the countdown without resetting it —
    // the effect simply doesn't run while `isViewingHistory`, so `remainingMs`
    // sits untouched; re-selecting the tip re-runs it with a fresh
    // `startedAt` anchored to that same `remainingMs`, which is what makes
    // resume continue rather than restart. This is the same `suspended`
    // gate the image-load and settings-panel cases already use.
    if (!isRunning || suspended || isComplete || isViewingHistory) return;

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
  }, [currentIndex, isComplete, isRunning, isViewingHistory, next, suspended]);

  const totalLabel =
    config.sessionLength.mode === "continuous"
      ? "∞"
      : sequence.length.toString();

  // The next reference is deterministic whenever it already exists in the
  // built sequence — that's the case predecode can act on ahead of the swap.
  // The continuous+repeat tail appends a random pick at advance time
  // (`next`), so its next image is unknowable here; `undefined` there means
  // "nothing to predecode", handled honestly by the caller. Deliberately
  // tracks the SEQUENCE tip (`currentIndex`), never the viewed history item —
  // browsing history is pure viewing and must not perturb the predecode
  // window for the session's actual next step.
  const nextImageUrl =
    currentIndex < sequence.length - 1
      ? sequence[currentIndex + 1]?.url
      : undefined;

  const currentImage = sequence[currentIndex] ?? startingImage;
  const viewedImage = history[viewedIndex] ?? currentImage;

  return {
    currentImage,
    // The reference currently on screen: the viewed history entry while
    // browsing, otherwise identical to `currentImage`.
    viewedImage,
    history,
    viewedIndex,
    isViewingHistory,
    selectHistoryIndex,
    nextImageUrl,
    currentIndex,
    positionLabel: `${currentIndex + 1} / ${totalLabel}`,
    // Mirrors `positionLabel` but for whatever is actually displayed — the
    // number on screen always names the pictured reference, matching each
    // strip thumbnail's own "Reference N of Total" aria-label.
    viewedPositionLabel: `${viewedIndex + 1} / ${totalLabel}`,
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

