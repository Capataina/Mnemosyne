import type { ReducedFrame } from "../types";
import { Check, Search } from "lucide-react";
import { OnboardingSkeleton } from "./OnboardingSkeleton";

export type StaticFrameKind =
  | "add-empty"
  | "add-picker"
  | "add-indexed"
  | "arrange-start"
  | "arrange-telegraph"
  | "arrange-settled"
  | "organise-all"
  | "organise-filters"
  | "organise-refined"
  | "search-query"
  | "search-results"
  | "search-cleared"
  | "similarity-feed"
  | "similarity-trail"
  | "similarity-inspector"
  | "gesture-setup"
  | "gesture-timer"
  | "gesture-zoomed";

const MINI_TILES = Array.from({ length: 9 }, (_, index) => ({
  left: 12 + (index % 3) * 78,
  top: 58 + Math.floor(index / 3) * 91,
  width: index === 4 ? 70 : 62,
  height: 66 + ((index * 13) % 24),
}));

export function StaticFrameArt({ kind }: { kind: StaticFrameKind }) {
  const showPicker = kind === "add-picker";
  const showCheck = kind === "add-indexed";
  const arrange = kind.startsWith("arrange-");
  const organise = kind.startsWith("organise-");
  const search = kind.startsWith("search-");
  const similarity = kind.startsWith("similarity-");
  const showInspector = kind === "similarity-inspector" || kind === "gesture-setup";
  const showTimer = kind === "gesture-timer" || kind === "gesture-zoomed";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[10px] border border-border bg-background">
      <div className="absolute inset-x-0 top-0 flex h-10 items-center gap-2 border-b border-border bg-surface px-2.5">
        <span className="text-[8px] font-[650]">Lynceus</span>
        <div className="flex h-5 flex-1 items-center gap-1 rounded-md bg-surface-sunken px-1.5">
          <Search className="size-2 text-muted-foreground" />
          <OnboardingSkeleton className="h-1.5 w-14 rounded-full" />
        </div>
        <span className="text-[7px] font-[600]">Add folder</span>
      </div>

      {!showInspector && !showTimer &&
        MINI_TILES.map((tile, index) => {
          const hidden =
            (kind === "add-empty" || kind === "add-picker") ||
            (kind === "organise-refined" && index % 3 === 1) ||
            (kind === "search-results" && index > 5);
          if (hidden) return null;
          const moved =
            kind === "arrange-telegraph" && index > 1
              ? 8
              : kind === "arrange-settled" && index === 2
                ? 74
                : 0;
          return (
            <OnboardingSkeleton
              key={index}
              raised={index % 4 === 0}
              className="absolute rounded-[8px] border border-border/60"
              style={{
                left: tile.left + moved,
                top: tile.top,
                width:
                  arrange && index === 4 && kind !== "arrange-start"
                    ? 140
                    : tile.width,
                height:
                  arrange && index === 4 && kind !== "arrange-start"
                    ? 148
                    : tile.height,
              }}
            />
          );
        })}

      {showPicker && (
        <div className="absolute left-6 right-6 top-16 rounded-[10px] border border-border-strong bg-card p-3 shadow-[var(--shadow-soft)]">
          <p className="mb-2 text-[8px] font-[650]">Choose a folder</p>
          <div className="mb-2 flex items-center gap-2 rounded-md bg-accent p-2">
            <OnboardingSkeleton className="size-4 rounded" />
            <OnboardingSkeleton className="h-1.5 w-24 rounded-full" />
          </div>
          <div className="ml-auto h-5 w-10 rounded-md bg-primary text-center text-[7px] font-[650] leading-5 text-primary-foreground">
            Add
          </div>
        </div>
      )}

      {showCheck && (
        <div className="absolute right-3 top-12 flex h-6 items-center gap-1.5 rounded-full border border-border bg-card px-2">
          <Check className="size-2.5 text-success" />
          <OnboardingSkeleton className="h-1.5 w-12 rounded-full" />
        </div>
      )}

      {kind === "arrange-telegraph" && (
        <div className="absolute left-[92px] top-[150px] h-[148px] w-[140px] rounded-[8px] border-2 border-primary/60 bg-primary/10" />
      )}

      {organise && (
        <aside className="absolute bottom-0 left-0 top-10 w-[104px] border-r border-border bg-card p-2.5">
          <p className="mb-2 text-[8px] font-[650]">Library</p>
          <p className="mb-2 text-[7px] text-muted-foreground">Folders</p>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className={[
                "mb-2 flex items-center gap-1 rounded p-1",
                kind !== "organise-all" && index > 0 ? "bg-accent" : "",
              ].join(" ")}
            >
              <OnboardingSkeleton className="size-2.5 rounded" />
              <OnboardingSkeleton className="h-1.5 flex-1 rounded-full" />
            </div>
          ))}
          <p className="mt-3 text-[7px] font-[650]">Refine</p>
          {kind !== "organise-all" && (
            <div className="mt-2 flex gap-1 text-[6px]">
              <span className="rounded bg-primary/15 px-1 text-primary">Must have</span>
              <span className="rounded bg-destructive/10 px-1 text-destructive">Must not have</span>
            </div>
          )}
        </aside>
      )}

      {search && kind !== "search-cleared" && (
        <>
          <div className="absolute left-12 top-3.5 flex gap-1">
            {[12, 8, 15, 6].map((width, index) => (
              <span
                key={index}
                className="h-1.5 rounded-full bg-muted-foreground/50"
                style={{ width }}
              />
            ))}
          </div>
          {kind === "search-results" && (
            <>
              <span className="absolute right-12 top-3 text-[6px] font-[650] text-primary">
                Semantic
              </span>
              <span className="absolute left-3 top-12 text-[8px] font-[650]">
                Results
              </span>
            </>
          )}
        </>
      )}

      {similarity && kind !== "similarity-feed" && (
        <div className="absolute inset-x-3 top-12 flex items-center justify-between">
          <span className="text-[8px] font-[650]">More like this</span>
          <span className="text-[6px] font-[600]">Back to all</span>
        </div>
      )}

      {kind === "similarity-trail" && (
        <div className="absolute left-3 top-16 flex gap-1">
          <OnboardingSkeleton className="size-5 rounded" />
          <OnboardingSkeleton className="size-5 rounded" />
        </div>
      )}

      {showInspector && (
        <div className="absolute inset-4 top-12 flex overflow-hidden rounded-[10px] border border-border bg-card">
          <OnboardingSkeleton className="m-2 flex-1 rounded-[8px]" raised />
          <div className="w-20 border-l border-border p-2">
            {kind === "gesture-setup" ? (
              <>
                <p className="mb-2 text-[7px] font-[650]">Timer</p>
                <OnboardingSkeleton className="mb-2 h-2 w-full rounded-full" />
                <OnboardingSkeleton className="mb-3 h-2 w-3/4 rounded-full" />
                <div className="rounded-md bg-primary px-1 py-1.5 text-center text-[6px] font-[650] text-primary-foreground">
                  Start session
                </div>
              </>
            ) : (
              <>
                <p className="mb-2 text-[7px] font-[650]">Tags</p>
                <OnboardingSkeleton className="mb-3 h-2 w-full rounded-full" />
                <p className="mb-2 text-[7px] font-[650]">Notes</p>
                <OnboardingSkeleton className="mb-1 h-2 w-full rounded-full" />
                <OnboardingSkeleton className="h-2 w-2/3 rounded-full" />
              </>
            )}
          </div>
        </div>
      )}

      {showTimer && (
        <div className="absolute inset-0 top-10 bg-surface-sunken">
          <OnboardingSkeleton
            raised
            className="absolute left-8 right-8 top-8 bottom-12 rounded-[10px]"
            style={
              kind === "gesture-zoomed"
                ? { transform: "translate(12px, 7px) scale(1.18)" }
                : undefined
            }
          />
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 text-[6px] font-[650]">
            <span>Reference</span>
            <span>Fit</span>
            <span>Exit</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface ReducedMotionFilmstripProps {
  frames: readonly ReducedFrame[];
}

export function ReducedMotionFilmstrip({ frames }: ReducedMotionFilmstripProps) {
  return (
    <div
      data-reduced-motion-filmstrip
      aria-hidden="true"
      className="pointer-events-none flex h-[600px] w-[960px] items-center justify-center gap-5 rounded-[18px] border border-border bg-background px-7"
      style={{ pointerEvents: "none" }}
    >
      {frames.map((frame) => (
        <figure key={frame.caption} className="w-[286px]">
          <div className="h-[410px] overflow-hidden rounded-[14px] border border-border bg-surface-sunken p-3">
            {frame.content}
          </div>
          <figcaption className="mt-3 text-center text-[11px] font-[580] text-muted-foreground">
            {frame.caption}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
