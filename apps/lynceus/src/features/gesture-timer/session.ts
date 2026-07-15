import type {
  GestureTimerConfig,
  GestureTimerImage,
  GestureTimerInitialConfig,
} from "./types";

const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
const MAX_SESSION_COUNT = 999;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toSafeInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

export function createDefaultGestureTimerConfig(
  candidateCount: number,
): GestureTimerConfig {
  const rangeMax = Math.max(1, Math.min(25, candidateCount));
  const rangeMin = rangeMax >= 5 ? 5 : 1;
  const eligibleCount = Math.max(0, rangeMax - rangeMin + 1);

  return {
    intervalSeconds: 60,
    similarityRange: { min: rangeMin, max: rangeMax },
    sessionLength: {
      mode: "count",
      count: Math.max(2, Math.min(10, eligibleCount + 1)),
    },
    repeatAllowed: false,
  };
}

export function normaliseGestureTimerConfig(
  config: GestureTimerConfig,
  candidateCount: number,
): GestureTimerConfig {
  const safeCandidateCount = Math.max(1, candidateCount);
  const minRank = clamp(
    toSafeInteger(config.similarityRange.min, 1),
    1,
    safeCandidateCount,
  );
  const maxRank = clamp(
    toSafeInteger(config.similarityRange.max, safeCandidateCount),
    minRank,
    safeCandidateCount,
  );
  const eligibleCount = Math.max(0, maxRank - minRank + 1);

  let sessionLength = config.sessionLength;
  if (sessionLength.mode === "count") {
    const repeatLimit = config.repeatAllowed
      ? MAX_SESSION_COUNT
      : eligibleCount + 1;
    sessionLength = {
      mode: "count",
      count: clamp(
        toSafeInteger(sessionLength.count, 10),
        2,
        Math.max(2, repeatLimit),
      ),
    };
  }

  return {
    intervalSeconds: clamp(
      toSafeInteger(config.intervalSeconds, 60),
      MIN_INTERVAL_SECONDS,
      MAX_INTERVAL_SECONDS,
    ),
    similarityRange: { min: minRank, max: maxRank },
    sessionLength,
    repeatAllowed: config.repeatAllowed,
  };
}

export function mergeGestureTimerConfig(
  initialConfig: GestureTimerInitialConfig | undefined,
  candidateCount: number,
): GestureTimerConfig {
  const defaults = createDefaultGestureTimerConfig(candidateCount);
  if (!initialConfig) return defaults;

  return normaliseGestureTimerConfig(
    {
      ...defaults,
      ...initialConfig,
      similarityRange: {
        ...defaults.similarityRange,
        ...initialConfig.similarityRange,
      },
      sessionLength: initialConfig.sessionLength ?? defaults.sessionLength,
    },
    candidateCount,
  );
}

export function getEligibleCandidates(
  startingImage: GestureTimerImage,
  candidateImages: readonly GestureTimerImage[],
  config: GestureTimerConfig,
): GestureTimerImage[] {
  const { min, max } = config.similarityRange;
  const rankedWindow = candidateImages.slice(min - 1, max);
  const seenIds = new Set<number>([startingImage.id]);

  return rankedWindow.filter((image) => {
    if (seenIds.has(image.id)) return false;
    seenIds.add(image.id);
    return true;
  });
}

export function shuffleImages(
  images: readonly GestureTimerImage[],
  random: () => number = Math.random,
): GestureTimerImage[] {
  const shuffled = [...images];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

export function pickRandomImage(
  images: readonly GestureTimerImage[],
  previousImageId?: number,
  random: () => number = Math.random,
): GestureTimerImage | undefined {
  if (images.length === 0) return undefined;

  const choices =
    images.length > 1 && previousImageId !== undefined
      ? images.filter((image) => image.id !== previousImageId)
      : images;
  return choices[Math.floor(random() * choices.length)];
}

export function buildGestureTimerSequence(
  startingImage: GestureTimerImage,
  eligibleCandidates: readonly GestureTimerImage[],
  config: GestureTimerConfig,
  random: () => number = Math.random,
): GestureTimerImage[] {
  if (config.sessionLength.mode === "continuous") {
    return config.repeatAllowed
      ? [startingImage]
      : [startingImage, ...shuffleImages(eligibleCandidates, random)];
  }

  const requiredCandidates = config.sessionLength.count - 1;
  if (!config.repeatAllowed) {
    return [
      startingImage,
      ...shuffleImages(eligibleCandidates, random).slice(0, requiredCandidates),
    ];
  }

  const selected: GestureTimerImage[] = [];
  let previousImageId = startingImage.id;
  for (let index = 0; index < requiredCandidates; index += 1) {
    const nextImage = pickRandomImage(
      eligibleCandidates,
      previousImageId,
      random,
    );
    if (!nextImage) break;
    selected.push(nextImage);
    previousImageId = nextImage.id;
  }
  return [startingImage, ...selected];
}

export function formatTimerDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
