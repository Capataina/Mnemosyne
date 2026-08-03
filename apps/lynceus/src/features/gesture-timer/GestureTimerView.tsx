import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scan,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { GestureTimerProgress } from "./GestureTimerProgress";
import type { GestureTimerConfig, GestureTimerImage } from "./types";
import { useGestureTimer } from "./useGestureTimer";
import { useGestureZoom } from "./useGestureZoom";

/**
 * Warm the browser's decode cache for `url` off-screen so the real <img> hits
 * a decoded bitmap on swap. Returns the Image whose reference must be held for
 * the window (dropping it lets the decoded data be reclaimed). A rejected
 * decode — AbortError is normal on rapid navigation — is swallowed but logged.
 */
function predecodeImage(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  void img.decode().catch((err: unknown) => {
    if ((err as DOMException | undefined)?.name !== "AbortError") {
      console.debug("gesture-timer predecode failed", url, err);
    }
  });
  return img;
}

type GestureTimerViewProps = {
  startingImage: GestureTimerImage;
  candidateImages: readonly GestureTimerImage[];
  config: GestureTimerConfig;
  settingsOpen: boolean;
  onRequestSettings: () => void;
  onRestart: () => void;
  onExit: () => void;
};

export function GestureTimerView({
  startingImage,
  candidateImages,
  config,
  settingsOpen,
  onRequestSettings,
  onRestart,
  onExit,
}: GestureTimerViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  // 1-deep predecode window: a reference to only the upcoming reference's
  // Image, replaced (older dropped) whenever the next candidate changes.
  const nextDecodeRef = useRef<HTMLImageElement | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [imageStatus, setImageStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const timer = useGestureTimer({
    startingImage,
    candidateImages,
    config,
    suspended: settingsOpen || imageStatus !== "ready",
  });

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    clearIdleTimer();
    if (
      timer.isRunning &&
      !timer.isComplete &&
      !settingsOpen &&
      imageStatus === "ready"
    ) {
      idleTimerRef.current = window.setTimeout(
        () => setControlsVisible(false),
        2600,
      );
    }
  }, [
    clearIdleTimer,
    imageStatus,
    settingsOpen,
    timer.isComplete,
    timer.isRunning,
  ]);

  const {
    stageRef,
    zoomLabelRef,
    isZoomed,
    resetZoom,
    zoomIn,
    zoomOut,
    pointerHandlers,
  } = useGestureZoom({
    // Keying zoom off the VIEWED image (not the session position) is the
    // reset-to-Fit decision for history browsing: selecting a past reference
    // gets a clean Fit view rather than carrying over whatever zoom/pan the
    // live session had, exactly like the existing swap-to-next reset.
    imageId: timer.viewedImage.id,
    onInteraction: revealControls,
  });

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!settingsOpen) rootRef.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    setImageStatus("loading");
  }, [timer.viewedImage.id]);

  // A predecoded (T1-6) reference can be complete the instant the keyed
  // <img> mounts — WebKit may then never deliver a `load` event React's
  // listener observes, leaving imageStatus stuck on "loading" and the
  // image at opacity-0 (the "blank second image" bug). This ref callback
  // runs at commit and settles the race: if the bitmap is already there,
  // declare ready without waiting for an event that may not come.
  const markReadyIfComplete = useCallback(
    (node: HTMLImageElement | null) => {
      if (node && node.complete && node.naturalWidth > 0) {
        setImageStatus("ready");
      }
    },
    [],
  );

  // Predecode the next reference so the keyed hard-swap lands on a warm
  // bitmap instead of pulsing the skeleton while a fresh original decodes.
  useEffect(() => {
    nextDecodeRef.current = timer.nextImageUrl
      ? predecodeImage(timer.nextImageUrl)
      : null;
  }, [timer.nextImageUrl]);

  useEffect(() => {
    revealControls();
    return clearIdleTimer;
  }, [clearIdleTimer, revealControls]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    revealControls();
    if (event.key === "Escape") {
      onExit();
      return;
    }

    const target = event.target as HTMLElement;
    const isInteractive =
      target.tagName === "BUTTON" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA";
    if (isInteractive || settingsOpen) return;

    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      timer.togglePaused();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      timer.next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      timer.previous();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomIn();
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomOut();
    } else if (event.key === "0") {
      event.preventDefault();
      resetZoom();
    }
  };

  const chromeVisibility = controlsVisible
    ? "opacity-100 translate-y-0"
    : "pointer-events-none opacity-0 translate-y-1";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Gesture drawing timer"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerMove={revealControls}
      onFocusCapture={revealControls}
      data-controls-visible={controlsVisible}
      data-zoomed={isZoomed}
      className={[
        "gesture-timer-root fixed inset-0 z-[200] min-h-[100dvh] overflow-hidden outline-none",
        controlsVisible ? "cursor-default" : "cursor-none",
      ].join(" ")}
    >
      <div
        aria-hidden="true"
        className="gesture-timer-vignette pointer-events-none absolute inset-0 z-10"
      />

      <header
        className={`pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 transition-[opacity,transform] duration-300 sm:top-5 ${chromeVisibility}`}
      >
        <div className="gesture-timer-chrome gesture-timer-progress-shell rounded-full">
          <GestureTimerProgress
            remainingMs={timer.remainingMs}
            progress={timer.progress}
            paused={
              !timer.isRunning ||
              settingsOpen ||
              imageStatus !== "ready" ||
              timer.isViewingHistory
            }
          />
        </div>
      </header>

      <div
        ref={stageRef}
        data-gesture-zoom-stage
        aria-label="Drawing reference. Pinch or use plus and minus to zoom. Scroll or drag to pan while zoomed."
        className="gesture-timer-stage absolute inset-0 flex touch-none items-center justify-center overflow-hidden"
        {...pointerHandlers}
      >
        {imageStatus === "loading" && (
          <div
            style={
              timer.viewedImage.width && timer.viewedImage.height
                ? {
                    aspectRatio: `${timer.viewedImage.width} / ${timer.viewedImage.height}`,
                  }
                : undefined
            }
            className="absolute h-[88dvh] max-h-full max-w-[94vw] animate-pulse rounded-[4px] bg-[oklch(0.94_0.008_245/0.035)]"
          />
        )}

        {imageStatus !== "error" && (
          <img
            key={timer.viewedImage.id}
            ref={markReadyIfComplete}
            src={timer.viewedImage.url}
            alt={timer.viewedImage.name ?? "Timed drawing reference"}
            width={timer.viewedImage.width}
            height={timer.viewedImage.height}
            loading="eager"
            decoding="async"
            onLoad={() => setImageStatus("ready")}
            onError={() => setImageStatus("error")}
            draggable={false}
            data-gesture-timer-image
            className={[
              "gesture-timer-image block h-auto w-auto max-h-[100dvh] max-w-[100vw] select-none object-contain transition-opacity duration-200",
              imageStatus === "ready" ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
        )}

        {imageStatus === "error" && (
          <div className="gesture-timer-chrome flex max-w-sm flex-col items-center rounded-[14px] px-8 py-9 text-center">
            <ImageOff
              className="mb-4 size-7 text-[var(--gesture-text-muted)]"
              strokeWidth={1.6}
            />
            <h2 className="text-[15px] font-[620]">Image could not be shown</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--gesture-text-muted)]">
              The file may have moved or become unavailable. Move to the next
              reference to continue the session.
            </p>
            <button
              type="button"
              onClick={timer.next}
              className="mt-5 rounded-[10px] bg-[var(--gesture-accent)] px-4 py-2 text-[12px] font-[620] text-[var(--gesture-accent-foreground)] transition-transform active:scale-[0.98]"
            >
              Next reference
            </button>
          </div>
        )}

        {timer.isComplete && (
          <div className="gesture-timer-chrome absolute z-10 flex max-w-sm flex-col items-center rounded-[14px] px-8 py-8 text-center">
            <p className="text-[11px] font-[600] text-[var(--gesture-text-muted)]">
              Session complete
            </p>
            <h2 className="mt-1 text-[19px] font-[640] tracking-[-0.025em]">
              Good work. Take a breath.
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--gesture-text-muted)]">
              Start the same setup again or return to the image inspector.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onExit}
                className="rounded-[10px] border border-[var(--gesture-border)] px-4 py-2 text-[12px] font-[600] text-[var(--gesture-text)] transition-[background-color,transform] hover:bg-[oklch(0.94_0.008_245/0.06)] active:scale-[0.98]"
              >
                Exit
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="flex items-center gap-2 rounded-[10px] bg-[var(--gesture-accent)] px-4 py-2 text-[12px] font-[620] text-[var(--gesture-accent-foreground)] transition-transform active:scale-[0.98]"
              >
                <RotateCcw className="size-3.5" strokeWidth={1.9} />
                Restart
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        className={`pointer-events-none absolute bottom-[5.25rem] left-4 z-20 max-w-[calc(100vw-2rem)] transition-[opacity,transform] duration-300 sm:left-6 lg:bottom-6 lg:max-w-[min(34vw,520px)] ${chromeVisibility}`}
      >
        <div className="gesture-timer-chrome gesture-timer-identity min-w-0 rounded-[12px] px-4 py-3 sm:px-5 sm:py-3.5">
          <p className="text-[10px] font-[650] uppercase tracking-[0.14em] text-[var(--gesture-accent)]">
            Reference {timer.viewedPositionLabel.replace(" / ", " of ")}
          </p>
          <p className="mt-1 max-w-full truncate text-[14px] font-[620] tracking-[-0.018em] text-[var(--gesture-text)] sm:text-[15px]">
            {timer.viewedImage.name ?? "Untitled reference"}
          </p>
        </div>

        {/* Every reference shown so far this session, current one included
            (`history` always has at least the starting image) — pure
            viewing: click pauses on a past entry, click the last (newest)
            box to resume. Hover only lifts opacity; selection is click-only,
            so a stray pointer pass can't pause the session. */}
        {/* p-1 (4px) on every side, not just bottom: overflow-x-auto forces
            overflow-y to compute to auto too (spec), clipping the selected
            item's outward ring-2 (2px) top edge with zero top padding. 4px
            clears the 2px ring with headroom on all four sides, matching
            the breadcrumb-ring fix's py-1 (89b6ee2); gap-2 (8px) already
            clears two adjacent 2px rings meeting mid-strip. */}
        <div
          role="group"
          aria-label="Reference history"
          className="gesture-timer-history-strip mt-2 flex max-w-full gap-2 overflow-x-auto p-1"
        >
          {timer.history.map((image, index) => {
            const isSelected = index === timer.viewedIndex;
            return (
              <button
                key={`${image.id}-${index}`}
                type="button"
                onClick={() => timer.selectHistoryIndex(index)}
                aria-label={`Reference ${index + 1} of ${timer.history.length}`}
                aria-current={isSelected ? "true" : undefined}
                className={[
                  "gesture-timer-history-item pointer-events-auto size-11 shrink-0 overflow-hidden rounded-md object-cover transition-opacity",
                  isSelected
                    ? "opacity-100 ring-2 ring-[var(--gesture-accent)]"
                    : "opacity-55 ring-1 ring-[var(--gesture-border)] hover:opacity-100",
                ].join(" ")}
              >
                <img
                  src={image.url}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="size-full object-cover"
                />
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`absolute bottom-4 left-1/2 z-20 -translate-x-1/2 transition-[opacity,transform] duration-300 sm:bottom-6 ${chromeVisibility}`}
      >
        <div className="gesture-timer-chrome flex items-center gap-1 rounded-[14px] p-1.5">
          <button
            type="button"
            className="gesture-timer-control"
            onClick={timer.previous}
            disabled={!timer.canGoPrevious}
            aria-label="Previous image"
          >
            <ChevronLeft className="size-[19px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="gesture-timer-control gesture-timer-control-primary"
            onClick={timer.togglePaused}
            disabled={timer.isComplete}
            aria-label={timer.isRunning ? "Pause timer" : "Resume timer"}
          >
            {timer.isRunning ? (
              <Pause className="size-[18px]" strokeWidth={1.9} />
            ) : (
              <Play className="ml-0.5 size-[18px]" strokeWidth={1.9} />
            )}
          </button>
          <button
            type="button"
            className="gesture-timer-control"
            onClick={timer.next}
            disabled={timer.isComplete}
            aria-label="Next image"
          >
            <ChevronRight className="size-[19px]" strokeWidth={1.8} />
          </button>
          <span
            aria-hidden="true"
            className="mx-1 h-5 w-px bg-[var(--gesture-border)]"
          />
          <button
            type="button"
            className="gesture-timer-control"
            onClick={onRequestSettings}
            aria-label="Timer settings"
          >
            <SlidersHorizontal className="size-[17px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="gesture-timer-control"
            onClick={onExit}
            aria-label="Exit timer"
          >
            <X className="size-[18px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div
        className={[
          "absolute right-4 top-[5.75rem] z-20 transition-[opacity,transform] duration-300 sm:right-6 lg:bottom-6 lg:top-auto",
          isZoomed && controlsVisible
            ? "opacity-100 translate-y-0"
            : "pointer-events-none translate-y-1 opacity-0",
        ].join(" ")}
        aria-hidden={!isZoomed}
      >
        <div className="gesture-timer-chrome flex items-center gap-0.5 rounded-[12px] p-1">
          <button
            type="button"
            className="gesture-timer-zoom-control"
            onClick={zoomOut}
            aria-label="Zoom out"
            tabIndex={isZoomed ? 0 : -1}
          >
            <Minus className="size-3.5" strokeWidth={1.9} />
          </button>
          <span
            ref={zoomLabelRef}
            className="min-w-11 px-1 text-center text-[11px] font-[650] tabular-nums text-[var(--gesture-text)]"
            aria-live="polite"
          >
            100%
          </span>
          <button
            type="button"
            className="gesture-timer-zoom-control"
            onClick={zoomIn}
            aria-label="Zoom in"
            tabIndex={isZoomed ? 0 : -1}
          >
            <Plus className="size-3.5" strokeWidth={1.9} />
          </button>
          <span
            aria-hidden="true"
            className="mx-0.5 h-4 w-px bg-[var(--gesture-border)]"
          />
          <button
            type="button"
            className="gesture-timer-zoom-control w-auto gap-1.5 px-2"
            onClick={resetZoom}
            aria-label="Reset zoom to fit"
            tabIndex={isZoomed ? 0 : -1}
          >
            <Scan className="size-3.5" strokeWidth={1.8} />
            <span className="text-[10px] font-[650]">Fit</span>
          </button>
        </div>
      </div>
    </div>
  );
}
