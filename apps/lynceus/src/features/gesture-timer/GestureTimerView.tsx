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
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { GestureTimerProgress } from "./GestureTimerProgress";
import type { GestureTimerConfig, GestureTimerImage } from "./types";
import { useGestureTimer } from "./useGestureTimer";

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

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!settingsOpen) rootRef.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    setImageStatus("loading");
  }, [timer.currentImage.id]);

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
      className={[
        "gesture-timer-root fixed inset-0 z-[200] flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-24 outline-none sm:px-10 sm:py-20",
        controlsVisible ? "cursor-default" : "cursor-none",
      ].join(" ")}
    >
      <header
        className={`pointer-events-none absolute inset-x-5 top-5 z-20 flex items-start justify-between gap-5 transition-[opacity,transform] duration-300 sm:inset-x-8 sm:top-7 ${chromeVisibility}`}
      >
        <div className="min-w-0 pt-1">
          <p className="text-[11px] font-[600] text-[var(--gesture-text-muted)]">
            Gesture timer
          </p>
          <p className="mt-1 max-w-[min(54vw,680px)] truncate text-[13px] font-[540] text-[var(--gesture-text)]">
            {timer.currentImage.name ?? "Untitled reference"}
          </p>
        </div>
        <div>
          <GestureTimerProgress
            remainingMs={timer.remainingMs}
            progress={timer.progress}
            paused={
              !timer.isRunning || settingsOpen || imageStatus !== "ready"
            }
          />
        </div>
      </header>

      <div className="relative flex h-full w-full items-center justify-center">
        {imageStatus === "loading" && (
          <div className="absolute h-[min(68dvh,720px)] w-[min(72vw,960px)] animate-pulse rounded-[14px] bg-[oklch(0.94_0.008_245/0.035)]" />
        )}

        {imageStatus !== "error" && (
          <img
            key={timer.currentImage.id}
            ref={markReadyIfComplete}
            src={timer.currentImage.url}
            alt={timer.currentImage.name ?? "Timed drawing reference"}
            width={timer.currentImage.width}
            height={timer.currentImage.height}
            loading="eager"
            decoding="async"
            onLoad={() => setImageStatus("ready")}
            onError={() => setImageStatus("error")}
            className={[
              "max-h-[calc(100dvh-9rem)] max-w-[min(92vw,1800px)] rounded-[14px] object-contain shadow-[0_32px_100px_-42px_oklch(0.01_0.005_252/0.96)] transition-opacity duration-200",
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
        className={`absolute inset-x-5 bottom-5 z-20 flex flex-col items-center gap-3 transition-[opacity,transform] duration-300 sm:inset-x-8 sm:bottom-7 ${chromeVisibility}`}
      >
        <p className="text-[12px] font-[600] tabular-nums text-[var(--gesture-text-muted)]">
          {timer.positionLabel}
        </p>
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
    </div>
  );
}
