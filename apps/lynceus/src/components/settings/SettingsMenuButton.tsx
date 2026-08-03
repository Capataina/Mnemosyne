import { Settings as SettingsIcon } from "lucide-react";
import type { RefObject } from "react";

import { cn } from "@/lib/utils";
import type { BubbleTriggerProps } from "@/components/library-drawer";

export interface SettingsMenuButtonProps {
  /** Effective visibility (pinned OR hovered) — drives the active/highlight
   * style, the same signal the panel uses to decide whether it's showing. */
  open: boolean;
  triggerProps: BubbleTriggerProps;
  panelId?: string;
  className?: string;
  ref?: RefObject<HTMLButtonElement | null>;
}

export function SettingsMenuButton({
  open,
  triggerProps,
  panelId = "settings-panel",
  className,
  ref,
}: SettingsMenuButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      title="Settings (⌘,)"
      aria-label="Settings"
      aria-controls={panelId}
      aria-expanded={open}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-[10px] border border-border bg-surface/60 text-muted-foreground transition-[color,background-color,border-color,transform] hover:border-border-strong hover:bg-accent hover:text-foreground active:scale-[0.98]",
        open && "border-primary/35 bg-primary/10 text-primary",
        className
      )}
      {...triggerProps}
    >
      <SettingsIcon className="h-4 w-4" strokeWidth={1.8} />
    </button>
  );
}
