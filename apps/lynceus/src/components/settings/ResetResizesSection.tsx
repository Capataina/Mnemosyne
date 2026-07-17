import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { useClearAllManualSpans } from "../../queries/useImages";

/**
 * Single-line reset control for tile resizes. Clears every image's manual
 * column span so the grid re-packs at default widths. Mirrors
 * ResetSection's two-click confirm with escalating red *highlights* (not a
 * block of red): the label is red at rest; the first click arms it — border
 * + a faint red wash join the red text ("are you sure") — and the second
 * click resets. Moving the pointer away disarms it, so it can't stay armed
 * by accident.
 */
export function ResetResizesSection() {
  const clearAllResizes = useClearAllManualSpans();
  const [armed, setArmed] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        clearAllResizes.mutate();
        setArmed(false);
      }}
      onMouseLeave={() => setArmed(false)}
      className={[
        "flex h-10 w-full items-center justify-start gap-2 rounded-[10px] border px-3 text-[11.5px] font-[580] transition-[color,background-color,border-color,transform] active:scale-[0.98]",
        armed
          ? "border-destructive/55 bg-destructive/10 text-destructive"
          : "border-border bg-transparent text-destructive/90 hover:border-destructive/40 hover:bg-destructive/[0.06] hover:text-destructive",
      ].join(" ")}
    >
      <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      {armed
        ? "Are you sure? Click again to reset all image resizes"
        : "Reset all image resizes"}
    </button>
  );
}
