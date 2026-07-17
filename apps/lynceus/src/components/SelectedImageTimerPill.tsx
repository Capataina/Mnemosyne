/**
 * Intended mount point: render as a child of the selected hero-image wrapper
 * in the route, with that wrapper marked `data-selected-hero` and positioned
 * relative. The pill overlaps the image's bottom edge; App.css makes it
 * pointer-interactive only while that hero is hovered or keyboard-focused.
 */
import { Infinity as InfinityIcon, Play, Timer } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  mergeGestureTimerConfig,
  normaliseGestureTimerConfig,
} from "../features/gesture-timer/session";
import type {
  GestureTimerConfig,
  GestureTimerInitialConfig,
} from "../features/gesture-timer/types";

export interface SelectedImageTimerPillProps {
  defaults?: GestureTimerInitialConfig;
  similarCount: number;
  disabled?: boolean;
  onStart: (config: GestureTimerConfig) => void;
}

export function SelectedImageTimerPill({
  defaults,
  similarCount,
  disabled = false,
  onStart,
}: SelectedImageTimerPillProps) {
  const initialConfig = useMemo(
    () => mergeGestureTimerConfig(defaults, similarCount),
    [defaults, similarCount],
  );
  const [config, setConfig] = useState(initialConfig);
  const availableInRange = Math.max(
    0,
    config.similarityRange.max - config.similarityRange.min + 1,
  );
  const countLimit = config.repeatAllowed
    ? 999
    : Math.max(2, availableInRange + 1);
  const inert = disabled || similarCount === 0;

  useEffect(() => {
    setConfig((current) =>
      normaliseGestureTimerConfig(current, similarCount),
    );
  }, [similarCount]);

  const update = (patch: Partial<GestureTimerConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  };

  const stopHeroActivation = (
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
  };

  const toggleContinuous = () => {
    setConfig((current) => ({
      ...current,
      sessionLength:
        current.sessionLength.mode === "continuous"
          ? {
              mode: "count",
              count: Math.max(2, Math.min(10, countLimit)),
            }
          : { mode: "continuous" },
    }));
  };

  const start = () => {
    if (inert) return;
    onStart(normaliseGestureTimerConfig(config, similarCount));
  };

  return (
    <div
      className="selected-image-timer-pill floating-surface absolute inset-x-0 bottom-4 z-20 mx-auto flex h-11 w-fit max-w-[calc(100%-24px)] items-center gap-1 rounded-full border p-1 pl-2 shadow-[var(--shadow-float)]"
      role="group"
      aria-label="Quick gesture timer"
      onClick={stopHeroActivation}
      onPointerDown={stopHeroActivation}
    >
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full text-primary"
        title="Gesture timer"
      >
        <Timer className="size-4" strokeWidth={1.8} />
      </span>

      {config.sessionLength.mode === "count" && (
        <label className="relative shrink-0">
          <span className="sr-only">Session image count</span>
          <input
            type="number"
            min={2}
            max={countLimit}
            value={config.sessionLength.count}
            disabled={inert}
            onChange={(event) =>
              update({
                sessionLength: {
                  mode: "count",
                  count: Number(event.target.value),
                },
              })
            }
            className="h-8 w-12 rounded-full border border-border bg-surface-sunken/72 px-2 text-center text-[10px] font-[650] tabular-nums text-foreground outline-none focus:border-primary/55 focus:ring-2 focus:ring-primary/15 disabled:opacity-40"
          />
        </label>
      )}

      <button
        type="button"
        role="switch"
        aria-label="Run continuously"
        aria-checked={config.sessionLength.mode === "continuous"}
        disabled={inert}
        onClick={toggleContinuous}
        className={[
          "grid size-8 shrink-0 place-items-center rounded-full border transition-[color,background-color,border-color,transform] active:scale-[0.96] disabled:opacity-40",
          config.sessionLength.mode === "continuous"
            ? "border-primary/45 bg-primary/14 text-primary"
            : "border-border bg-surface-sunken/55 text-muted-foreground hover:text-foreground",
        ].join(" ")}
      >
        <InfinityIcon className="size-3.5" strokeWidth={2} />
      </button>

      <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />

      <label className="relative shrink-0">
        <span className="sr-only">Seconds per image</span>
        <input
          type="number"
          min={5}
          max={86400}
          value={config.intervalSeconds}
          disabled={inert}
          onChange={(event) =>
            update({ intervalSeconds: Number(event.target.value) })
          }
          className="h-8 w-[58px] rounded-full border border-border bg-surface-sunken/72 px-2 pr-5 text-center text-[10px] font-[650] tabular-nums text-foreground outline-none focus:border-primary/55 focus:ring-2 focus:ring-primary/15 disabled:opacity-40"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 grid place-items-center text-[9px] text-muted-foreground">
          s
        </span>
      </label>

      <div className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface-sunken/72 px-1" aria-label="Similarity rank range">
        <label>
          <span className="sr-only">First similarity rank</span>
          <input
            type="number"
            min={1}
            max={config.similarityRange.max}
            value={config.similarityRange.min}
            disabled={inert}
            onChange={(event) =>
              update({
                similarityRange: {
                  ...config.similarityRange,
                  min: Number(event.target.value),
                },
              })
            }
            className="h-6 w-8 bg-transparent text-center text-[10px] font-[650] tabular-nums text-foreground outline-none disabled:opacity-40"
          />
        </label>
        <span aria-hidden="true" className="text-[9px] text-muted-foreground">
          -
        </span>
        <label>
          <span className="sr-only">Last similarity rank</span>
          <input
            type="number"
            min={config.similarityRange.min}
            max={Math.max(1, similarCount)}
            value={config.similarityRange.max}
            disabled={inert}
            onChange={(event) =>
              update({
                similarityRange: {
                  ...config.similarityRange,
                  max: Number(event.target.value),
                },
              })
            }
            className="h-6 w-8 bg-transparent text-center text-[10px] font-[650] tabular-nums text-foreground outline-none disabled:opacity-40"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={start}
        disabled={inert}
        title={inert ? "No similar images available" : "Start gesture timer"}
        className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/45 bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(0.98_0.005_245/0.16)] transition-[background-color,transform,opacity] hover:bg-primary/88 active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Start gesture timer"
      >
        <Play className="ml-0.5 size-3.5 fill-current" strokeWidth={1.7} />
      </button>
    </div>
  );
}
