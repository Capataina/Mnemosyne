import { formatTimerDuration } from "./session";

type GestureTimerProgressProps = {
  remainingMs: number;
  progress: number;
  paused: boolean;
};

const RADIUS = 29;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function GestureTimerProgress({
  remainingMs,
  progress,
  paused,
}: GestureTimerProgressProps) {
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div
      className="relative grid size-[76px] place-items-center"
      role="timer"
      aria-label={`${formatTimerDuration(remainingMs / 1000)} remaining${
        paused ? ", paused" : ""
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 68 68"
        className="absolute inset-1 size-[68px] -rotate-90"
      >
        <circle
          cx="34"
          cy="34"
          r={RADIUS}
          fill="none"
          stroke="var(--gesture-ring-track)"
          strokeWidth="2"
        />
        <circle
          cx="34"
          cy="34"
          r={RADIUS}
          fill="none"
          stroke="var(--gesture-ring-progress)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-100 ease-linear"
        />
      </svg>
      <span className="relative text-[13px] font-[620] tabular-nums tracking-[-0.02em] text-[var(--gesture-text)]">
        {formatTimerDuration(remainingMs / 1000)}
      </span>
    </div>
  );
}

