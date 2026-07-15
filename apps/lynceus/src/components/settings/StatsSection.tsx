import { useIndexingStatus } from "../../hooks/useIndexingStatus";
import { Section } from "./controls";

/**
 * Pipeline progress stats — counts of images at each stage of the
 * indexing pipeline. Lets the user see at a glance how much of the
 * library has been indexed (thumbnails generated, embeddings computed).
 *
 * Reads the shared `useIndexingStatus` snapshot (react-query keyed
 * `["pipelineStats"]`), which is the same authoritative source the
 * top-right status pill uses — one poll, one source of truth, so the two
 * surfaces can never disagree. The query is a single SELECT on the
 * backend so the polling cost is negligible regardless of library size.
 *
 * Why this exists: when indexing is in flight, the user has no way to
 * know how many of their images already have thumbnails vs how many
 * are still in the queue. The status pill shows aggregate progress
 * during a single pipeline run; this section shows the persistent
 * state of the index.
 */
export function StatsSection() {
  const { stats } = useIndexingStatus();

  if (!stats) {
    return (
      <Section title="Indexing progress">
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
  const thumbPct = total > 0 ? Math.round((stats.with_thumbnail / total) * 100) : 0;

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
    <Section title="Indexing progress">
      <p className="-mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Snapshot of how many images have been processed at each stage.
        Refreshes every 5 seconds.
      </p>

      <div className="space-y-4 rounded-[11px] border border-border bg-surface/45 p-3.5">
        <StatRow label="Total images" value={stats.total_images} />
        <ProgressRow
          label="Thumbnails"
          done={stats.with_thumbnail}
          total={total}
          pct={thumbPct}
        />
        {/* Per-encoder progress — one row per encoder. Encoders that
            haven't been indexed yet show 0/total in muted style; full
            encoders show the bar at 100%. */}
        {stats.with_embedding_per_encoder.map((ec) => {
          const pct = total > 0 ? Math.round((ec.count / total) * 100) : 0;
          return (
            <ProgressRow
              key={ec.encoder_id}
              label={`Embeddings · ${encoderLabel(ec.encoder_id)}`}
              done={ec.count}
              total={total}
              pct={pct}
            />
          );
        })}
        {stats.orphaned > 0 && (
          <StatRow
            label="Orphaned (file deleted on disk)"
            value={stats.orphaned}
            tone="warn"
          />
        )}
      </div>
    </Section>
  );
}

function StatRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warn";
}) {
  const labelClass =
    tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className={labelClass}>{label}</span>
      <span className="font-[620] tabular-nums text-foreground">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function ProgressRow({
  label,
  done,
  total,
  pct,
}: {
  label: string;
  done: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="min-w-0 truncate text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {done.toLocaleString()} / {total.toLocaleString()} ({pct}%)
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
