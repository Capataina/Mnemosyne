import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";

import type { LibraryMenuButtonProps } from "./types";

export function LibraryMenuButton({
  open,
  onOpen,
  drawerId = "library-drawer",
  className,
  disabled = false,
}: LibraryMenuButtonProps) {
  return (
    <button
      type="button"
      aria-label="Open library"
      aria-controls={drawerId}
      aria-expanded={open}
      disabled={disabled}
      className={cn(
        "chrome-surface grid size-11 shrink-0 place-items-center rounded-[12px] border text-muted-foreground transition-[color,background-color,border-color,transform] hover:border-border-strong hover:bg-surface-raised hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-45",
        open && "border-primary/35 bg-primary/10 text-primary",
        className
      )}
      onClick={onOpen}
    >
      <Menu className="size-[18px]" strokeWidth={1.8} />
    </button>
  );
}
