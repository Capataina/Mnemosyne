import { useConfirm } from "@/components/ui/confirm";
import { usePipelineStats } from "../../hooks/useIndexingStatus";
import { usePurgeOrphanedImages } from "../../queries/useImages";
import { Section } from "./controls";

/**
 * Pipeline progress stats — counts of images at each stage of the
 * indexing pipeline. Lets the user see at a glance how much of the
 * library has been indexed (base previews generated, embeddings computed).
 * `with_thumbnail` counts images with a base preview, not the number of
 * adaptive-resolution preview files stored for each image.
 *
 * Reads the shared `usePipelineStats` snapshot (react-query keyed
 * `["pipelineStats"]`), which is the same authoritative source the
 * top-right status pill uses — one poll, one source of truth, so the two
 * surfaces can never disagree. The query is a single SELECT on the
 * backend so the polling cost is negligible regardless of library size.
 *
 * Why this exists: when indexing is in flight, the user has no way to
 * know how many of their images already have base previews vs how many
 * are still in the queue. The status pill shows aggregate progress
 * during a single pipeline run; this section shows the persistent
 * state of the index.
 */
export function StatsSection() {
  const stats = usePipelineStats();
  const confirm = useConfirm();
  const purgeOrphanedMutation = usePurgeOrphanedImages();

  async function handleCleanUpOrphaned(orphanedCount: number) {
    const confirmed = await confirm({
      title: "Remove missing images?",
      description: `${orphanedCount.toLocaleString()} ${
        orphanedCount === 1 ? "image points" : "images point"
      } at files that are no longer on disk. Removing them clears these entries from the library — files still on disk are untouched, and any tags on these entries are removed along with them.`,
      confirmLabel: "Remove images",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await purgeOrphanedMutation.mutateAsync();
    } catch (err) {
      await confirm({
        title: "Could not clean up missing images",
        description: err instanceof Error ? err.message : String(err),
        confirmLabel: "OK",
        alert: true,
      });
    }
  }

  if (!stats) {
    return (
      <Section
        title="Library index"
        description="Persistent processing coverage for the current library."
      >
        <div className="space-y-3" aria-label="Loading indexing progress">
          <div className="skeleton-tile h-3 rounded-full" />
          <div className="skeleton-tile h-3 w-4/5 rounded-full" />
          <div className="skeleton-tile h-3 w-3/5 rounded-full" />
        </div>
      </Section>
    );
  }

  // Compute percentages for the bars. Avoid division by zero on an
  // empty library (shows "0 images" + 0% bars).
  const total = stats.total_images;
  const thumbPct =
    total > 0 ? Math.round((stats.with_thumbnail / total) * 100) : 0;

  // Friendly display names for each encoder. Matches the EncoderInfo
  // display_names from src-tauri/src/commands/encoders.rs but without
  // an extra IPC round-trip.
  const encoderLabel = (id: string): string => {
    switch (id) {
      case "clip_vit_b_32":
        return "OpenCLIP";
      case "siglip2_base":
        return "SigLIP-2";
      case "dinov2_base":
        return "DINOv2";
      default:
        return id;
    }
  };

  return (
    <Section
      title="Library index"
      description="Persistent processing coverage for the current library. Refreshes every 5 seconds."
    >
      <div className="rounded-[11px] border border-border bg-surface/35">
        <div className="flex items-end justify-between gap-4 border-b border-border px-3.5 py-3">
          <div>
            <p className="text-[11px] font-[580] text-foreground">
              Images catalogued
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Original images in the library
            </p>
          </div>
          <span className="text-[18px] font-[650] leading-none tracking-[-0.025em] tabular-nums text-foreground">
            {stats.total_images.toLocaleString()}
          </span>
        </div>

        <div className="space-y-4 px-3.5 py-3.5">
          <ProgressRow
            label="Images with previews"
            description="Base preview created"
            done={stats.with_thumbnail}
            total={total}
            pct={thumbPct}
          />
          {/* Per-encoder progress — one row per encoder. Encoders that
              haven't been indexed yet show 0/total in muted style; full
              encoders show the bar at 100%. */}
          {stats.with_embedding_per_encoder.map((ec) => {
            const pct =
              total > 0 ? Math.round((ec.count / total) * 100) : 0;
            return (
              <ProgressRow
                key={ec.encoder_id}
                label={encoderLabel(ec.encoder_id)}
                description="Images encoded"
                done={ec.count}
                total={total}
                pct={pct}
              />
            );
          })}
          {stats.orphaned > 0 && (
            <div className="space-y-1.5 rounded-[8px] bg-warning/8 px-2.5 py-2 text-[10.5px] text-warning">
              <div className="flex items-center justify-between gap-3">
                <span>Source file missing</span>
                <span className="font-[620] tabular-nums">
                  {stats.orphaned.toLocaleString()}{" "}
                  {stats.orphaned === 1 ? "image" : "images"}
                </span>
              </div>
              <button
                onClick={() => handleCleanUpOrphaned(stats.orphaned)}
                disabled={purgeOrphanedMutation.isPending}
                className="w-full rounded-[6px] border border-warning/25 bg-warning/10 py-1 text-[10px] font-[600] text-warning transition-colors hover:bg-warning/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {purgeOrphanedMutation.isPending ? "Cleaning up…" : "Clean up"}
              </button>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function ProgressRow({
  label,
  description,
  done,
  total,
  pct,
}: {
  label: string;
  description: string;
  done: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-[580] text-foreground">
            {label}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {description}
          </p>
        </div>
        <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
          {done.toLocaleString()} of {total.toLocaleString()} images
        </span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-input">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
