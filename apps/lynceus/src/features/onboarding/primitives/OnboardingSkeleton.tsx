import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { visualMotion } from "../onboardingMotion";
import type { ClosedTrack, VisualFrame } from "../types";

interface OnboardingSkeletonProps {
  className?: string;
  raised?: boolean;
  style?: CSSProperties;
  sheen?: {
    track: ClosedTrack<VisualFrame>;
    durationMs: number;
  };
}

export function OnboardingSkeleton({
  className = "",
  raised = false,
  style,
  sheen,
}: OnboardingSkeletonProps) {
  return (
    <div
      className={[
        "relative overflow-hidden bg-surface",
        raised ? "bg-surface-raised" : "",
        className,
      ].join(" ")}
      style={style}
    >
      {sheen && (
        <motion.span
          className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-foreground/10 to-transparent"
          animate={visualMotion(sheen.track, sheen.durationMs)}
        />
      )}
    </div>
  );
}
