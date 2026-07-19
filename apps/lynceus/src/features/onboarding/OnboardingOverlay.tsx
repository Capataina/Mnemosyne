import { useEffect, useRef } from "react";
import { useUserPreferences } from "../../hooks/useUserPreferences";
import { OnboardingControls } from "./OnboardingControls";
import { useOnboarding } from "./OnboardingProvider";
import { OnboardingStage } from "./OnboardingStage";
import { sceneRegistry } from "./sceneRegistry";

const INTERACTIVE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function OnboardingOverlay() {
  const { prefs } = useUserPreferences();
  const { sceneIndex, sceneCount, back, next, skip } = useOnboarding();
  const overlayRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const scene = sceneRegistry[sceneIndex];

  useEffect(() => {
    const frame = requestAnimationFrame(() => nextRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!scene) return null;

  const titleId = `onboarding-title-${scene.id}`;
  const captionId = `onboarding-caption-${scene.id}`;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      skip();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(
        overlayRef.current?.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    const target = event.target as HTMLElement;
    if (target.matches("button, input, select, textarea, [contenteditable=true]")) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      back();
      requestAnimationFrame(() => backRef.current?.focus());
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
      requestAnimationFrame(() => nextRef.current?.focus());
    }
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={captionId}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[240] flex min-h-[100dvh] flex-col bg-background/95 px-5 py-4 text-foreground md:px-8 md:py-6"
    >
      <header className="mx-auto flex w-full max-w-[1180px] items-start justify-between gap-6 pb-3">
        <div className="min-w-0">
          <h1
            id={titleId}
            className="text-[24px] font-[650] leading-tight tracking-[-0.035em] md:text-[28px]"
          >
            {scene.title}
          </h1>
          <p
            id={captionId}
            className="mt-1.5 max-w-[720px] text-[12.5px] leading-relaxed text-muted-foreground md:text-[13px]"
          >
            {scene.caption}
          </p>
        </div>
        <button
          type="button"
          onClick={skip}
          className="h-9 shrink-0 rounded-[10px] px-3 text-[11.5px] font-[600] text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-[0.98]"
        >
          Skip
        </button>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1">
        <OnboardingStage
          key={scene.id}
          scene={scene}
          animationLevel={prefs.animationLevel}
        />
      </div>

      <div className="mx-auto w-full max-w-[960px] pt-2">
        <OnboardingControls
          sceneIndex={sceneIndex}
          sceneCount={sceneCount}
          backRef={backRef}
          nextRef={nextRef}
          onBack={() => {
            back();
            requestAnimationFrame(() => backRef.current?.focus());
          }}
          onNext={() => {
            next();
            requestAnimationFrame(() => nextRef.current?.focus());
          }}
        />
      </div>
    </div>
  );
}
