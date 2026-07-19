import { useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { AnimationLevel } from "../../hooks/useUserPreferences";
import type { OnboardingSceneDefinition } from "./types";
import { ReducedMotionFilmstrip } from "./primitives/ReducedMotionFilmstrip";

const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 600;
const FILMSTRIP_SCALE_THRESHOLD = 0.58;

interface OnboardingStageProps {
  scene: OnboardingSceneDefinition;
  animationLevel: AnimationLevel;
}

export function OnboardingStage({ scene, animationLevel }: OnboardingStageProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const reduceForOs = Boolean(useReducedMotion());

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = Math.min(
        1,
        entry.contentRect.width / STAGE_WIDTH,
        entry.contentRect.height / STAGE_HEIGHT,
      );
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  const filmstrip =
    reduceForOs ||
    animationLevel === "off" ||
    scale < FILMSTRIP_SCALE_THRESHOLD;
  const Scene = scene.Component;

  return (
    <div ref={slotRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 h-[600px] w-[960px] origin-center"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {filmstrip ? (
          <ReducedMotionFilmstrip frames={scene.reducedFrames} />
        ) : (
          <Scene animationLevel={animationLevel === "subtle" ? "subtle" : "standard"} />
        )}
      </div>
    </div>
  );
}
