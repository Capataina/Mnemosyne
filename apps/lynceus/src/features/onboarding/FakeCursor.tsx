import { motion } from "framer-motion";
import { cursorMotion } from "./onboardingMotion";
import type { ClosedTrack, CursorFrame } from "./types";

interface FakeCursorProps {
  track: ClosedTrack<CursorFrame>;
  durationMs: number;
  showHalo: boolean;
}

export function FakeCursor({ track, durationMs, showHalo }: FakeCursorProps) {
  const animation = cursorMotion(track, durationMs);

  return (
    <motion.div
      data-onboarding-cursor
      className="pointer-events-none absolute left-0 top-0 z-50 size-0"
      animate={animation.wrapper}
    >
      {showHalo && (
        <motion.span
          data-onboarding-click-halo
          className="absolute left-[-9px] top-[-9px] size-[18px] rounded-full border border-primary/70 bg-primary/10"
          animate={animation.halo}
        />
      )}
      <motion.svg
        aria-hidden="true"
        focusable="false"
        width="24"
        height="30"
        viewBox="0 0 24 30"
        className="absolute left-0 top-0 origin-top-left"
        animate={animation.pointer}
        style={{ filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.42))" }}
      >
        <path
          d="M2.2 1.7 20.8 18c.8.7.35 2-0.72 2.06l-7.2.42-3.92 6.1c-.58.9-1.96.55-2.02-.52L5.78 5.5 2.2 3.75c-.92-.45-.8-1.43 0-2.05Z"
          fill="oklch(0.95 0.006 245)"
          stroke="oklch(0.18 0.012 252)"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      </motion.svg>
    </motion.div>
  );
}
