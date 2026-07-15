import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, Infinity as InfinityIcon, Timer, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { formatTimerDuration } from "./session";
import type { GestureTimerConfig } from "./types";

type GestureTimerConfigPanelProps = {
  config: GestureTimerConfig;
  candidateCount: number;
  mode: "start" | "restart";
  onChange: (config: GestureTimerConfig) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

const INTERVAL_PRESETS = [30, 60, 120, 300] as const;

function intervalLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${seconds / 60}m`;
}

export function GestureTimerConfigPanel({
  config,
  candidateCount,
  mode,
  onChange,
  onConfirm,
  onDismiss,
}: GestureTimerConfigPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const isPreset = INTERVAL_PRESETS.includes(
    config.intervalSeconds as (typeof INTERVAL_PRESETS)[number],
  );
  const availableInRange =
    candidateCount === 0
      ? 0
      : Math.max(
          0,
          config.similarityRange.max - config.similarityRange.min + 1,
        );
  const intervalIsValid =
    Number.isInteger(config.intervalSeconds) &&
    config.intervalSeconds >= 5 &&
    config.intervalSeconds <= 86400;
  const rangeIsValid =
    candidateCount > 0 &&
    Number.isInteger(config.similarityRange.min) &&
    Number.isInteger(config.similarityRange.max) &&
    config.similarityRange.min >= 1 &&
    config.similarityRange.max >= config.similarityRange.min &&
    config.similarityRange.max <= candidateCount;
  const countIsValid =
    config.sessionLength.mode === "continuous" ||
    (Number.isInteger(config.sessionLength.count) &&
      config.sessionLength.count >= 2 &&
      (config.repeatAllowed ||
        config.sessionLength.count <= availableInRange + 1));
  const canStart = intervalIsValid && rangeIsValid && countIsValid;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      onDismiss();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;

    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable.item(0);
    const last = focusable.item(focusable.length - 1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === panelRef.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const update = (patch: Partial<GestureTimerConfig>) => {
    onChange({ ...config, ...patch });
  };

  const estimatedDuration =
    config.sessionLength.mode === "count"
      ? config.sessionLength.count * config.intervalSeconds
      : null;

  return (
    <div
      className="fixed inset-0 z-[220] grid place-items-center bg-background/78 p-4 backdrop-blur-xl"
      onKeyDown={handleDialogKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="floating-surface relative max-h-[min(760px,calc(100dvh-32px))] w-full max-w-[560px] overflow-y-auto rounded-[16px] border"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-6 border-b border-border bg-surface-overlay/95 px-6 py-5 backdrop-blur-xl">
          <div>
            <div className="mb-2 flex size-9 items-center justify-center rounded-[10px] border border-primary/20 bg-primary/10 text-primary">
              <Timer className="size-[18px]" strokeWidth={1.8} />
            </div>
            <h2
              id={titleId}
              className="text-[19px] font-[650] tracking-[-0.03em] text-foreground"
            >
              {mode === "start" ? "Set up timer" : "Adjust timer"}
            </h2>
            <p className="mt-1 max-w-[46ch] text-[12px] leading-relaxed text-muted-foreground">
              Choose the pace and how far through the similarity ranking to
              draw references from.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDismiss}
            aria-label="Close timer settings"
          >
            <X strokeWidth={1.8} />
          </Button>
        </header>

        <div className="space-y-7 px-6 py-6">
          <section className="space-y-3">
            <div>
              <h3 className="text-[13px] font-[620] tracking-[-0.015em] text-foreground">
                Interval
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Time spent on each reference, including the starting image.
              </p>
            </div>
            <div className="grid grid-cols-5 gap-2 max-[520px]:grid-cols-3">
              {INTERVAL_PRESETS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  aria-pressed={config.intervalSeconds === seconds}
                  onClick={() => update({ intervalSeconds: seconds })}
                  className={[
                    "h-10 rounded-[10px] border text-[12px] font-[600] tabular-nums transition-[color,background-color,border-color,transform] active:scale-[0.98]",
                    config.intervalSeconds === seconds
                      ? "border-primary/45 bg-primary/12 text-foreground"
                      : "border-border bg-surface-sunken/55 text-muted-foreground hover:border-border-strong hover:text-foreground",
                  ].join(" ")}
                >
                  {intervalLabel(seconds)}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={!isPreset}
                onClick={() => {
                  if (isPreset) update({ intervalSeconds: 90 });
                }}
                className={[
                  "h-10 rounded-[10px] border text-[12px] font-[600] transition-[color,background-color,border-color,transform] active:scale-[0.98]",
                  !isPreset
                    ? "border-primary/45 bg-primary/12 text-foreground"
                    : "border-border bg-surface-sunken/55 text-muted-foreground hover:border-border-strong hover:text-foreground",
                ].join(" ")}
              >
                Custom
              </button>
            </div>
            {!isPreset && (
              <label className="block space-y-2">
                <span className="text-[11px] font-[560] text-foreground">
                  Custom interval in seconds
                </span>
                <input
                  type="number"
                  min={5}
                  max={86400}
                  value={config.intervalSeconds}
                  onChange={(event) =>
                    update({ intervalSeconds: Number(event.target.value) })
                  }
                  className="h-10 w-full rounded-[10px] border border-input bg-surface-sunken/65 px-3.5 text-[13px] tabular-nums text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary/55 focus:ring-3 focus:ring-primary/10"
                />
                {!intervalIsValid && (
                  <span className="block text-[11px] text-destructive">
                    Use a whole number from 5 to 86,400 seconds.
                  </span>
                )}
              </label>
            )}
          </section>

          <section className="space-y-3 border-t border-border pt-6">
            <div>
              <h3 className="text-[13px] font-[620] tracking-[-0.015em] text-foreground">
                Similarity ranks
              </h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Rank 1 is the closest match. Raising the minimum skips near
                duplicates and keeps the study varied.
              </p>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
              <label className="space-y-2">
                <span className="block text-[11px] font-[560] text-foreground">
                  From rank
                </span>
                <input
                  type="number"
                  min={1}
                  max={config.similarityRange.max}
                  value={config.similarityRange.min}
                  disabled={candidateCount === 0}
                  onChange={(event) =>
                    update({
                      similarityRange: {
                        ...config.similarityRange,
                        min: Number(event.target.value),
                      },
                    })
                  }
                  className="h-10 w-full rounded-[10px] border border-input bg-surface-sunken/65 px-3.5 text-[13px] tabular-nums text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary/55 focus:ring-3 focus:ring-primary/10 disabled:opacity-45"
                />
              </label>
              <span className="pb-2.5 text-muted-foreground">to</span>
              <label className="space-y-2">
                <span className="block text-[11px] font-[560] text-foreground">
                  Through rank
                </span>
                <input
                  type="number"
                  min={config.similarityRange.min}
                  max={Math.max(1, candidateCount)}
                  value={config.similarityRange.max}
                  disabled={candidateCount === 0}
                  onChange={(event) =>
                    update({
                      similarityRange: {
                        ...config.similarityRange,
                        max: Number(event.target.value),
                      },
                    })
                  }
                  className="h-10 w-full rounded-[10px] border border-input bg-surface-sunken/65 px-3.5 text-[13px] tabular-nums text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary/55 focus:ring-3 focus:ring-primary/10 disabled:opacity-45"
                />
              </label>
            </div>
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {rangeIsValid && availableInRange > 0
                ? `${availableInRange} candidate${
                    availableInRange === 1 ? "" : "s"
                  } in this range`
                : candidateCount === 0
                  ? "No similar images available. Load the ranked result before starting."
                  : `Choose ranks from 1 to ${candidateCount}.`}
            </p>
          </section>

          <section className="space-y-3 border-t border-border pt-6">
            <div>
              <h3 className="text-[13px] font-[620] tracking-[-0.015em] text-foreground">
                Session length
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                A finite count includes the starting image.
              </p>
            </div>
            <div className="grid grid-cols-2 rounded-[11px] border border-border bg-surface-sunken/55 p-1">
              <button
                type="button"
                aria-pressed={config.sessionLength.mode === "count"}
                onClick={() =>
                  update({
                    sessionLength: {
                      mode: "count",
                      count: config.repeatAllowed
                        ? 10
                        : Math.max(2, Math.min(10, availableInRange + 1)),
                    },
                  })
                }
                className={[
                  "flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[11px] font-[600] transition-[color,background-color,border-color,transform] active:scale-[0.98]",
                  config.sessionLength.mode === "count"
                    ? "border-primary/25 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Check className="size-3.5" strokeWidth={2} />
                Image count
              </button>
              <button
                type="button"
                aria-pressed={config.sessionLength.mode === "continuous"}
                onClick={() =>
                  update({ sessionLength: { mode: "continuous" } })
                }
                className={[
                  "flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[11px] font-[600] transition-[color,background-color,border-color,transform] active:scale-[0.98]",
                  config.sessionLength.mode === "continuous"
                    ? "border-primary/25 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <InfinityIcon className="size-3.5" strokeWidth={2} />
                Continuous
              </button>
            </div>
            {config.sessionLength.mode === "count" && (
              <label className="block space-y-2">
                <span className="text-[11px] font-[560] text-foreground">
                  Total images
                </span>
                <input
                  type="number"
                  min={2}
                  max={
                    config.repeatAllowed
                      ? 999
                      : Math.max(2, availableInRange + 1)
                  }
                  value={config.sessionLength.count}
                  onChange={(event) =>
                    update({
                      sessionLength: {
                        mode: "count",
                        count: Number(event.target.value),
                      },
                    })
                  }
                  className="h-10 w-full rounded-[10px] border border-input bg-surface-sunken/65 px-3.5 text-[13px] tabular-nums text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary/55 focus:ring-3 focus:ring-primary/10"
                />
                {!config.repeatAllowed && (
                  <span className="block text-[11px] text-muted-foreground">
                    This range supports up to {availableInRange + 1} unique
                    images including the starting image.
                  </span>
                )}
              </label>
            )}
          </section>

          <section className="flex items-start justify-between gap-5 border-t border-border pt-6">
            <div>
              <h3 className="text-[13px] font-[620] tracking-[-0.015em] text-foreground">
                Allow repeats
              </h3>
              <p className="mt-0.5 max-w-[38ch] text-[11px] leading-relaxed text-muted-foreground">
                Images can return later in the session. Immediate repeats are
                still avoided when the range contains alternatives.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.repeatAllowed}
              onClick={() => update({ repeatAllowed: !config.repeatAllowed })}
              className={[
                "relative mt-0.5 inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border p-0.5 transition-[background-color,border-color,box-shadow] focus:ring-2 focus:ring-primary/30",
                config.repeatAllowed
                  ? "border-primary/55 bg-primary"
                  : "border-border-strong bg-input",
              ].join(" ")}
            >
              <span
                className={[
                  "size-4 rounded-full shadow-[0_1px_4px_var(--shadow-color)] transition-[transform,background-color]",
                  config.repeatAllowed
                    ? "translate-x-[18px] bg-primary-foreground"
                    : "translate-x-0 bg-muted-foreground",
                ].join(" ")}
              />
            </button>
          </section>

          <div className="rounded-[12px] border border-border bg-surface-sunken/45 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
            {estimatedDuration !== null ? (
              <>
                <span className="font-[620] text-foreground">
                  {config.sessionLength.mode === "count"
                    ? config.sessionLength.count
                    : 0}{" "}
                  images
                </span>{" "}
                over approximately {formatTimerDuration(estimatedDuration)}.
              </>
            ) : config.repeatAllowed ? (
              "Runs until you exit."
            ) : (
              `Runs through ${availableInRange + 1} unique images, then stops.`
            )}
          </div>
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-surface-overlay/95 px-6 py-4 backdrop-blur-xl">
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!canStart}>
            {mode === "start" ? "Start session" : "Apply and restart"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
