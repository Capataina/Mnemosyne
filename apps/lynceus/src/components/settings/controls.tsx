import type React from "react";

/**
 * Small layout + input primitives shared across the settings sections.
 *
 * These were originally co-located inside SettingsDrawer.tsx; lifting them
 * here keeps each section file focused on its own controls while every
 * section consumes the same visual + behavioural primitives.
 */

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-b border-border py-6 first:pt-0 last:border-b-0 last:pb-0">
      <div className="space-y-1">
        <h3 className="text-[13px] font-[640] tracking-[-0.015em] text-foreground">
          {title}
        </h3>
        {description && (
          <p className="max-w-[38ch] text-[11px] leading-[1.55] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-4">
        <span className="font-[540] leading-snug text-foreground">{label}</span>
        {hint && (
          <span className="shrink-0 text-right text-[10.5px] leading-snug tabular-nums text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="gallery-range w-full focus-visible:outline-none"
    />
  );
}

export function SegmentedButtons<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
}) {
  return (
    <div className="flex rounded-[10px] border border-border bg-surface-sunken/55 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={[
            "flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-[7px] border px-2 py-1.5 text-[11px] font-[580] transition-[color,background-color,border-color,box-shadow,transform] duration-200 active:scale-[0.98]",
            value === opt.value
              ? "border-primary/25 bg-primary/10 text-foreground shadow-[inset_0_1px_0_oklch(0.98_0.005_245/0.05)]"
              : "border-transparent text-muted-foreground hover:bg-accent/55 hover:text-foreground",
          ].join(" ")}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  // h-5 (20px) track, w-9 (36px) wide, p-0.5 (2px) inset.
  // Thumb is h-4 (16px) — leaves 36 - 16 - 2*2 = 16px of horizontal
  // travel, exactly translate-x-4. Thumb stays inside the track in both
  // states, no margin-juggling.
  // Off state uses bg-input + bg-foreground thumb so it's clearly
  // visible against the dark theme (bg-card thumb on bg-secondary track
  // had no contrast and made the off state look broken).
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-[background-color,border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30",
        checked
          ? "border-primary/55 bg-primary"
          : "border-border-strong bg-input",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 transform rounded-full shadow-[0_1px_4px_var(--shadow-color)] transition-[transform,background-color] duration-200",
          checked
            ? "translate-x-[18px] bg-primary-foreground"
            : "translate-x-0 bg-muted-foreground",
        ].join(" ")}
      />
    </button>
  );
}
