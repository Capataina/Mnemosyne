import type { ReactNode } from "react";
import { Search, Settings, FolderPlus } from "lucide-react";
import { CHROME, rectStyle } from "../sceneGeometry";
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

/**
 * Every scene-targetable control is ABSOLUTELY positioned from the
 * CHROME rects in sceneGeometry.ts — scenes aim click accents and
 * cursor waypoints at those exact rects, so nothing here may be laid
 * out by flex flow (a flex x-position depends on font metrics and made
 * the first build's cursor land beside its buttons). The logo is the
 * one flex-free-floating label, because nothing ever targets it.
 */
export function DemoAppChrome({ leading, trailing }: DemoAppChromeProps) {
  return (
    <header className="absolute inset-x-0 top-0 z-20 h-[72px] border-b border-border bg-surface-overlay">
      {leading && (
        <div className="absolute" style={rectStyle(CHROME.leadingPill)}>
          {leading}
        </div>
      )}
      <span
        className="absolute text-[18px] font-[650] leading-none tracking-[-0.035em]"
        style={{ left: leading ? 108 : 20, top: 27 }}
      >
        Lynceus
      </span>
      <div
        className="absolute flex items-center gap-2 rounded-[10px] border border-border bg-surface-sunken px-3"
        style={rectStyle(CHROME.searchBar)}
      >
        <Search className="size-3.5 text-muted-foreground" strokeWidth={1.8} />
        <OnboardingSkeleton className="h-2.5 w-40 rounded-full" />
      </div>
      <div
        className="absolute flex items-center justify-center gap-2 rounded-[10px] border border-border bg-surface text-[11.5px] font-[580]"
        style={rectStyle(CHROME.addFolder)}
      >
        <FolderPlus className="size-3.5" strokeWidth={1.8} />
        Add folder
      </div>
      <div
        className="absolute grid place-items-center rounded-[10px] border border-border bg-surface"
        style={rectStyle(CHROME.settings)}
      >
        <Settings className="size-3.5" strokeWidth={1.8} />
        <span className="sr-only">Settings</span>
      </div>
      {trailing}
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
