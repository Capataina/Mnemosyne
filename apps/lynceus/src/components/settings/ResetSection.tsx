import { RotateCcw } from "lucide-react";
import { useUserPreferences } from "../../hooks/useUserPreferences";
import { Section } from "./controls";

export function ResetSection() {
  const { resetAll } = useUserPreferences();

  return (
    <Section title="Reset">
      <button
        onClick={() => {
          if (
            window.confirm(
              "Reset all UI preferences to defaults? Your images, tags, and folder list are NOT affected.",
            )
          ) {
            resetAll();
          }
        }}
        className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-transparent px-3 text-[11px] font-[560] text-muted-foreground transition-[color,background-color,border-color,transform] hover:border-border-strong hover:bg-accent hover:text-foreground active:scale-[0.98]"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
        Reset all preferences
      </button>
    </Section>
  );
}
