export type GestureTimerImage = {
  id: number;
  /** Full-resolution image URL. */
  url: string;
  /** Human-readable filename or title used for accessible alt text. */
  name?: string;
  width?: number;
  height?: number;
};

export type SimilarityRankRange = {
  /** One-based, inclusive rank within `candidateImages`. */
  min: number;
  /** One-based, inclusive rank within `candidateImages`. */
  max: number;
};

export type GestureTimerSessionLength =
  | { mode: "count"; count: number }
  | { mode: "continuous" };

export type GestureTimerConfig = {
  intervalSeconds: number;
  similarityRange: SimilarityRankRange;
  sessionLength: GestureTimerSessionLength;
  repeatAllowed: boolean;
};

export type GestureTimerInitialConfig = Omit<
  Partial<GestureTimerConfig>,
  "similarityRange"
> & {
  similarityRange?: Partial<SimilarityRankRange>;
};

export type GestureTimerProps = {
  /** The inspector image. It is always the first image in the session. */
  startingImage: GestureTimerImage;
  /**
   * Similar images ordered most to least similar. The array should contain
   * at least `similarityRange.max` items and should not include the starting
   * image. `SimilarImageItem[]` can be passed directly.
   */
  candidateImages: readonly GestureTimerImage[];
  initialConfig?: GestureTimerInitialConfig;
  /**
   * Quick-start path (the selected-hero pill): when a config object arrives,
   * the timer adopts it and starts running immediately — no setup step. Each
   * distinct object identity triggers at most one auto-start.
   */
  autoStart?: GestureTimerConfig | null;
  className?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
};
