import type { RefObject } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface OnboardingControlsProps {
  sceneIndex: number;
  sceneCount: number;
  backRef: RefObject<HTMLButtonElement | null>;
  nextRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onNext: () => void;
}

export function OnboardingControls({
  sceneIndex,
  sceneCount,
  backRef,
  nextRef,
  onBack,
  onNext,
}: OnboardingControlsProps) {
  const lastScene = sceneIndex === sceneCount - 1;

  return (
    <footer className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-5">
      <button
        ref={backRef}
        type="button"
        disabled={sceneIndex === 0}
        onClick={onBack}
        className="flex h-10 w-fit items-center gap-2 rounded-[10px] border border-border bg-surface px-4 text-[12px] font-[600] transition-[color,background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.8} />
        Back
      </button>

      <div
        className="flex items-center gap-2"
        role="status"
        aria-label={`Scene ${sceneIndex + 1} of ${sceneCount}`}
      >
        {Array.from({ length: sceneCount }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={[
              "block size-1.5 rounded-full",
              index === sceneIndex ? "bg-primary" : "bg-muted-foreground/35",
            ].join(" ")}
          />
        ))}
      </div>

      <button
        ref={nextRef}
        type="button"
        onClick={onNext}
        className="ml-auto flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-[12px] font-[650] text-primary-foreground transition-[filter,transform] hover:brightness-105 active:scale-[0.98]"
      >
        {lastScene ? "Finish" : "Next"}
        {!lastScene && <ArrowRight className="size-3.5" strokeWidth={1.8} />}
      </button>
    </footer>
  );
}
