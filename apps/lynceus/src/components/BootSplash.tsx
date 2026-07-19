import { useEffect, useState } from "react";
import { queryClient } from "../queries/queryClient";

/**
 * Branded boot overlay — wordmark + indeterminate bar, painted over the
 * whole viewport while the app boots, then faded out and unmounted.
 *
 * "Booted" means the first feed-manifest query has settled (success OR
 * error — an error state must surface the app, not an eternal splash),
 * with two guards around the signal:
 *  - a 600ms minimum display, so warm starts get a deliberate brand
 *    beat instead of a one-frame flash;
 *  - a 5s hard cap, so a hung query can never wedge the whole UI
 *    behind the splash.
 *
 * Sits at z-[300], above everything in the app's z-ladder (modal
 * dialogs top out at 250 — see ui/dialog.tsx). The wordmark is a text
 * placeholder until the app has a real logo; swap the <span> for the
 * logo mark when it lands.
 */

const MIN_DISPLAY_MS = 600;
const HARD_CAP_MS = 5000;
const FADE_MS = 300;

function manifestSettled(): boolean {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ["feed-manifest"] })
    .some((q) => q.state.status !== "pending");
}

export function BootSplash() {
  const [ready, setReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const minTimer = setTimeout(() => setMinElapsed(true), MIN_DISPLAY_MS);
    const capTimer = setTimeout(() => setReady(true), HARD_CAP_MS);
    if (manifestSettled()) {
      setReady(true);
    }
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (manifestSettled()) setReady(true);
    });
    return () => {
      clearTimeout(minTimer);
      clearTimeout(capTimer);
      unsubscribe();
    };
  }, []);

  const hiding = ready && minElapsed;

  if (gone) return null;

  return (
    <div
      role="status"
      aria-label="Loading Lynceus"
      onTransitionEnd={() => {
        if (hiding) setGone(true);
      }}
      className={[
        "fixed inset-0 z-[300] flex flex-col items-center justify-center gap-5 bg-background transition-opacity",
        hiding ? "pointer-events-none opacity-0" : "opacity-100",
      ].join(" ")}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <span className="select-none text-[27px] font-[650] leading-none tracking-[-0.035em] text-foreground">
        Lynceus
      </span>
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-input">
        <div className="boot-bar-sweep h-full w-2/5 rounded-full bg-primary" />
      </div>
    </div>
  );
}
