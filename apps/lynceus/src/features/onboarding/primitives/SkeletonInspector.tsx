import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { OnboardingSkeleton } from "./OnboardingSkeleton";

export function SkeletonInspector() {
  return (
    <div className="absolute inset-[42px] flex overflow-hidden rounded-[16px] border border-border-strong bg-surface-overlay shadow-[var(--shadow-float)]">
      <div className="relative flex-1 bg-surface-sunken p-7">
        <OnboardingSkeleton className="h-full w-full rounded-[14px]" raised />
        <div className="absolute inset-x-0 top-4 flex justify-center gap-2">
          <div className="grid size-8 place-items-center rounded-full bg-background/70">
            <ChevronLeft className="size-4" />
          </div>
          <div className="grid size-8 place-items-center rounded-full bg-background/70">
            <ChevronRight className="size-4" />
          </div>
        </div>
      </div>
      <aside className="w-[290px] border-l border-border bg-card p-6">
        <div className="mb-7 flex items-center justify-between">
          <OnboardingSkeleton className="h-3 w-32 rounded-full" />
          <X className="size-4 text-muted-foreground" />
        </div>
        <p className="mb-3 text-[11px] font-[620]">Tags</p>
        <div className="mb-8 flex gap-2">
          <OnboardingSkeleton className="h-7 w-16 rounded-full" />
          <OnboardingSkeleton className="h-7 w-20 rounded-full" />
        </div>
        <p className="mb-3 text-[11px] font-[620]">Notes</p>
        <OnboardingSkeleton className="h-3 w-full rounded-full" />
        <OnboardingSkeleton className="mt-2 h-3 w-5/6 rounded-full" />
        <OnboardingSkeleton className="mt-2 h-3 w-2/3 rounded-full" />
      </aside>
    </div>
  );
}
