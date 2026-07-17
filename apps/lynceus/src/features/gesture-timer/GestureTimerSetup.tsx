import {
  Infinity as InfinityIcon,
  Play,
  Repeat2,
  Timer,
} from "lucide-react";
import type { Ref } from "react";
import { formatTimerDuration } from "./session";
import type { GestureTimerConfig } from "./types";

type GestureTimerSetupProps = {
  config: GestureTimerConfig;
  candidateCount: number;
  disabled: boolean;
  startButtonRef?: Ref<HTMLButtonElement>;
  className?: string;
  onChange: (config: GestureTimerConfig) => void;
  onStart: () => void;
};

const INTERVAL_PRESETS = [30, 60, 120, 300] as const;

function intervalLabel(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${seconds / 60}m`;
}

export function GestureTimerSetup({
  config,
  candidateCount,
  disabled,
  startButtonRef,
  className,
  onChange,
  onStart,
}: GestureTimerSetupProps) {
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
  const canStart =
    !disabled && intervalIsValid && rangeIsValid && countIsValid;
  const sessionSummary =
    config.sessionLength.mode === "count"
      ? `${config.sessionLength.count} images in about ${formatTimerDuration(
          config.sessionLength.count * config.intervalSeconds,
        )}`
      : config.repeatAllowed
        ? "Runs until you exit"
        : `Uses ${availableInRange + 1} unique images`;

  const update = (patch: Partial<GestureTimerConfig>) => {
    onChange({ ...config, ...patch });
  };

  const selectCountMode = () => {
    update({
      sessionLength: {
        mode: "count",
        count: config.repeatAllowed
          ? 10
          : Math.max(2, Math.min(10, availableInRange + 1)),
      },
    });
  };

  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-primary/20 bg-primary/10 text-primary">
          <Timer className="size-[17px]" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-[640] tracking-[-0.02em] text-foreground">
            Gesture timer
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Set a pace, then draw from the similarity range.
          </p>
        </div>
        <span className="shrink-0 pt-0.5 text-[10px] font-[600] tabular-nums text-muted-foreground">
          {candidateCount} similar
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <fieldset className="space-y-2.5">
          <legend className="text-[11px] font-[600] text-foreground">
            Seconds per image
          </legend>
          <div className="grid grid-cols-[minmax(76px,0.8fr)_1.7fr] gap-2">
            <label className="relative">
              <span className="sr-only">Custom interval in seconds</span>
              <input
                type="number"
                min={5}
                max={86400}
                value={config.intervalSeconds}
                onChange={(event) =>
                  update({ intervalSeconds: Number(event.target.value) })
                }
                aria-invalid={!intervalIsValid}
                className="h-9 w-full rounded-[9px] border border-input bg-surface-sunken/70 px-3 pr-7 text-[12px] font-[620] tabular-nums text-foreground outline-none transition-[border-color,box-shadow,background-color] focus:border-primary/55 focus:bg-surface-sunken focus:ring-3 focus:ring-primary/10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-[10px] text-muted-foreground">
                s
              </span>
            </label>
            <div className="grid grid-cols-4 gap-1 rounded-[10px] border border-border bg-surface-sunken/45 p-1">
              {INTERVAL_PRESETS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  aria-pressed={config.intervalSeconds === seconds}
                  onClick={() => update({ intervalSeconds: seconds })}
                  className={[
                    "h-7 rounded-[7px] text-[10px] font-[620] tabular-nums transition-[color,background-color,transform] active:scale-[0.97]",
                    config.intervalSeconds === seconds
                      ? "bg-primary/14 text-primary"
                      : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground",
                  ].join(" ")}
                >
                  {intervalLabel(seconds)}
                </button>
              ))}
            </div>
          </div>
          {!intervalIsValid && (
            <p className="text-[10px] text-destructive">
              Use a whole number from 5 to 86,400.
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-2.5 border-t border-border pt-4">
          <legend className="sr-only">Session length</legend>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-[600] text-foreground">
              Session length
            </span>
            <div className="grid grid-cols-2 rounded-[10px] border border-border bg-surface-sunken/45 p-1">
              <button
                type="button"
                aria-pressed={config.sessionLength.mode === "count"}
                onClick={selectCountMode}
                className={[
                  "h-7 rounded-[7px] px-3 text-[10px] font-[620] transition-[color,background-color,transform] active:scale-[0.97]",
                  config.sessionLength.mode === "count"
                    ? "bg-primary/14 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                Count
              </button>
              <button
                type="button"
                aria-pressed={config.sessionLength.mode === "continuous"}
                onClick={() =>
                  update({ sessionLength: { mode: "continuous" } })
                }
                className={[
                  "flex h-7 items-center justify-center gap-1 rounded-[7px] px-2.5 text-[10px] font-[620] transition-[color,background-color,transform] active:scale-[0.97]",
                  config.sessionLength.mode === "continuous"
                    ? "bg-primary/14 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <InfinityIcon className="size-3" strokeWidth={2} />
                Continuous
              </button>
            </div>
          </div>
          {config.sessionLength.mode === "count" && (
            <div className="space-y-1.5">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-muted-foreground">
                  Total images, including this one
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
                  aria-invalid={!countIsValid}
                  className="h-8 w-20 rounded-[9px] border border-input bg-surface-sunken/70 px-2.5 text-center text-[11px] font-[620] tabular-nums text-foreground outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/10"
                />
              </label>
              {!countIsValid && (
                <p className="text-[10px] text-destructive">
                  Choose 2-{availableInRange + 1}, or allow repeats.
                </p>
              )}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2.5 border-t border-border pt-4">
          <legend className="sr-only">Similarity ranks</legend>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-[600] text-foreground">
              Similarity ranks
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {rangeIsValid
                ? `${availableInRange} in range`
                : candidateCount === 0
                  ? "No candidates"
                  : `1-${candidateCount} available`}
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <label>
              <span className="sr-only">First similarity rank</span>
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
                aria-invalid={!rangeIsValid}
                className="h-9 w-full rounded-[9px] border border-input bg-surface-sunken/70 px-3 text-center text-[11px] font-[620] tabular-nums text-foreground outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/10 disabled:opacity-40"
              />
            </label>
            <div className="flex items-center gap-1.5 text-muted-foreground" aria-hidden="true">
              <span className="h-px w-3 bg-border-strong" />
              <span className="text-[9px]">to</span>
              <span className="h-px w-3 bg-border-strong" />
            </div>
            <label>
              <span className="sr-only">Last similarity rank</span>
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
                aria-invalid={!rangeIsValid}
                className="h-9 w-full rounded-[9px] border border-input bg-surface-sunken/70 px-3 text-center text-[11px] font-[620] tabular-nums text-foreground outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/10 disabled:opacity-40"
              />
            </label>
          </div>
          {!rangeIsValid && candidateCount > 0 && (
            <p className="text-[10px] text-destructive">
              Choose an ordered range between 1 and {candidateCount}.
            </p>
          )}
        </fieldset>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Repeat2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <div className="min-w-0">
              <p className="text-[11px] font-[600] text-foreground">
                Allow repeats
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                Reuse references in longer sessions
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Allow repeated images"
            aria-checked={config.repeatAllowed}
            onClick={() => update({ repeatAllowed: !config.repeatAllowed })}
            className={[
              "relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border p-0.5 transition-[background-color,border-color,box-shadow] focus:ring-2 focus:ring-primary/30",
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
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-3 rounded-[12px] border border-border bg-surface-sunken/45 p-1.5 pl-3.5">
        <p className="min-w-0 text-[10px] leading-relaxed text-muted-foreground">
          {sessionSummary}
        </p>
        <button
          ref={startButtonRef}
          type="button"
          onClick={onStart}
          disabled={!canStart}
          title={
            candidateCount === 0
              ? "No similar images to cycle through"
              : undefined
          }
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-primary/45 bg-primary px-3.5 text-[11px] font-[650] text-primary-foreground shadow-[inset_0_1px_0_oklch(0.98_0.005_245/0.16)] transition-[background-color,transform,opacity] hover:bg-primary/88 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play className="size-3.5 fill-current" strokeWidth={1.7} />
          Start
        </button>
      </div>
    </div>
  );
}
