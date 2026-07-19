import type { ReactNode } from "react";
import { Search, Settings, FolderPlus } from "lucide-react";
import { OnboardingSkeleton } from "./OnboardingSkeleton";

interface DemoSceneRootProps {
  children: ReactNode;
  className?: string;
}

export function DemoSceneRoot({ children, className = "" }: DemoSceneRootProps) {
  return (
    <div
      data-onboarding-scene
      aria-hidden="true"
      className={[
        "pointer-events-none relative h-[600px] w-[960px] overflow-hidden rounded-[18px] border border-border bg-background text-foreground shadow-[var(--shadow-float)]",
        className,
      ].join(" ")}
      style={{ pointerEvents: "none" }}
    >
      {children}
    </div>
  );
}

interface DemoAppChromeProps {
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function DemoAppChrome({ leading, trailing }: DemoAppChromeProps) {
  return (
    <header className="absolute inset-x-0 top-0 z-20 flex h-[72px] items-center gap-3 border-b border-border bg-surface-overlay px-5">
      {leading}
      <span className="mr-4 text-[18px] font-[650] tracking-[-0.035em]">
        Lynceus
      </span>
      <div className="flex h-9 w-[360px] items-center gap-2 rounded-[10px] border border-border bg-surface-sunken px-3">
        <Search className="size-3.5 text-muted-foreground" strokeWidth={1.8} />
        <OnboardingSkeleton className="h-2.5 w-40 rounded-full" />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-[11.5px] font-[580]">
          <FolderPlus className="size-3.5" strokeWidth={1.8} />
          Add folder
        </div>
        <div className="grid size-9 place-items-center rounded-[10px] border border-border bg-surface">
          <Settings className="size-3.5" strokeWidth={1.8} />
          <span className="sr-only">Settings</span>
        </div>
        {trailing}
      </div>
    </header>
  );
}

export function DemoControl({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-center gap-1.5 rounded-[9px] border border-border bg-surface px-3 text-[10.5px] font-[600] text-foreground">
      {children}
    </div>
  );
}
