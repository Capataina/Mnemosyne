/**
 * First-launch / empty-state hint. The feed is thumbnail-gated, so during
 * early indexing it can be empty while images already exist — show an
 * "indexing" state then, and "no images yet" only when the library is
 * genuinely empty and nothing is in flight.
 *
 * Extracted from `[...slug].tsx` (pure JSX move, zero behaviour change) —
 * see that file's CLAUDE.md planned-work entry. The route still gates
 * mounting this on `!selectedItem && !shouldUseSemanticSearch &&
 * feed.length === 0`; `manifestCount` is the three-state read of
 * `manifest.data?.length` (undefined = not yet loaded, 0 = empty, >0 =
 * populated) that the two branches below distinguish on.
 */
import { FolderPlus } from "lucide-react";

interface EmptyStateProps {
  isIndexing: boolean;
  manifestCount: number | undefined;
}

export function EmptyState({ isIndexing, manifestCount }: EmptyStateProps) {
  if (isIndexing || (manifestCount !== undefined && manifestCount > 0)) {
    return (
      <section className="mx-auto mb-12 flex min-h-[340px] max-w-2xl flex-col items-center justify-center text-center">
        <div className="mb-7 flex h-24 items-end gap-2.5" aria-hidden="true">
          <div className="skeleton-tile h-16 w-16 rounded-[10px]" />
          <div className="skeleton-tile h-24 w-20 rounded-[10px]" />
          <div className="skeleton-tile h-20 w-14 rounded-[10px]" />
        </div>
        <h2 className="mb-2 text-[22px] font-[620] tracking-[-0.035em] text-foreground">
          Indexing your library…
        </h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
          Tiles appear here as each image's thumbnail is generated.
          You can keep using the app while indexing runs in the
          background.
        </p>
      </section>
    );
  }

  if (manifestCount === 0) {
    return (
      <section className="mx-auto mb-12 flex min-h-[340px] max-w-2xl flex-col items-center justify-center text-center">
        <div className="mb-6 grid size-14 place-items-center rounded-[14px] border border-border bg-surface text-muted-foreground shadow-[var(--shadow-soft)]">
          <FolderPlus className="h-5 w-5" strokeWidth={1.6} />
        </div>
        <h2 className="mb-2 text-[22px] font-[620] tracking-[-0.035em] text-foreground">
          No images yet
        </h2>
        <p className="max-w-lg text-[13px] leading-relaxed text-muted-foreground">
          Pick a folder above to start indexing your library. The app
          searches recursively, so you can point it at a parent folder
          and let it sweep through every subfolder.
        </p>
      </section>
    );
  }

  return null;
}
