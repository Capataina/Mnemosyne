import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";

import type { LibraryMenuButtonProps } from "./types";

export function LibraryMenuButton({
  open,
  triggerProps,
  drawerId = "library-drawer",
  className,
  disabled = false,
  ref,
}: LibraryMenuButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Library"
      aria-controls={drawerId}
      aria-expanded={open}
      disabled={disabled}
      className={cn(
        "chrome-surface grid size-11 shrink-0 place-items-center rounded-[12px] border text-muted-foreground transition-[color,background-color,border-color,transform] hover:border-border-strong hover:bg-surface-raised hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-45",
        open && "border-primary/35 bg-primary/10 text-primary",
        className
      )}
      {...triggerProps}
    >
      <Menu className="size-[18px]" strokeWidth={1.8} />
    </button>
  );
}
