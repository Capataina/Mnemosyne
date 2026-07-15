import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { recordAction } from "../../services/perf";
import { Section } from "./controls";

/**
 * Phase 11c — per-encoder enable/disable toggles (replaces both
 * dropdowns).
 *
 * Each row is one supported encoder + a switch. Toggling persists
 * via the `set_enabled_encoders` IPC and takes effect:
 *
 *   - immediately for fusion (next `get_fused_*` IPC reads from
 *     settings.json)
 *   - on the next indexing pipeline run for encoding (re-enabled
 *     encoders re-encode the rows they don't already have rows for)
 *
 * Backend invariants enforced via `decide_enabled_write`:
 *   - at least one encoder must stay enabled (the IPC rejects an
 *     empty-list mutation with `BadInput`)
 *   - unknown encoder ids are rejected
 *   - the set is deduped + canonicalised (sorted) before persist so
 *     toggle-order doesn't churn settings.json
 *
 * Disabling an encoder does NOT delete its embeddings. They stay in
 * the per-encoder embeddings table; re-enabling brings them back
 * instantly with no re-encoding.
 */

interface EncoderInfo {
  id: string;
  display_name: string;
  description: string;
  dim: number;
  supports_text: boolean;
  supports_image: boolean;
}

export function EncoderSection() {
  const queryClient = useQueryClient();
  const [encoders, setEncoders] = useState<EncoderInfo[] | null>(null);
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Initial load: list of available encoders + currently-enabled set.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<EncoderInfo[]>("list_available_encoders"),
      invoke<string[]>("get_enabled_encoders"),
    ])
      .then(([list, enabledIds]) => {
        if (cancelled) return;
        setEncoders(list);
        setEnabled(new Set(enabledIds));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Section title="Encoders">
        <p className="rounded-[10px] border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-[11px] leading-relaxed text-destructive">
          {error}
        </p>
      </Section>
    );
  }
  if (!encoders || !enabled) {
    return (
      <Section title="Encoders">
        <div className="space-y-2.5" aria-label="Loading encoders">
          <div className="skeleton-tile h-16 rounded-[11px]" />
          <div className="skeleton-tile h-16 rounded-[11px]" />
        </div>
      </Section>
    );
  }

  async function toggle(id: string, want: boolean) {
    if (!enabled) return;
    // Optimistic update + IPC. On error we reset state to whatever
    // the backend says it is (the backend is the source of truth).
    const next = new Set(enabled);
    if (want) {
      next.add(id);
    } else {
      next.delete(id);
    }
    if (next.size === 0) {
      // Frontend guard mirroring the backend's BadInput rejection.
      // The IPC would reject anyway; surfacing as a UI message saves
      // a roundtrip and a transient toggle bounce.
      setError("At least one encoder must stay enabled.");
      // Auto-clear after 3 s so the message doesn't stick.
      setTimeout(() => setError(null), 3000);
      return;
    }
    setEnabled(next);
    setPending(true);
    recordAction("encoder_toggle", { id, enabled: want });
    try {
      await invoke("set_enabled_encoders", { ids: Array.from(next) });
      // The enabled set is NOT part of the fused-query keys (they key on
      // query/image + primary encoder only), so a cached similar/semantic
      // result — 5-minute staleTime — would keep showing rankings from the
      // OLD encoder set for minutes after a toggle. Invalidate both so the
      // next search/similar recomputes fusion over the new set.
      queryClient.invalidateQueries({ queryKey: ["fused-similar-images"] });
      queryClient.invalidateQueries({ queryKey: ["fused-semantic-search"] });
    } catch (e) {
      // Backend rejected — re-fetch authoritative state.
      console.warn("set_enabled_encoders failed:", e);
      try {
        const auth = await invoke<string[]>("get_enabled_encoders");
        setEnabled(new Set(auth));
      } catch {
        /* leave state as-is */
      }
      setError(String(e));
      setTimeout(() => setError(null), 3000);
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      title="Encoders"
      description="Enabled models contribute to search fusion. Disabling one skips future indexing without deleting its existing embeddings."
    >
      <div className="overflow-hidden rounded-[11px] border border-border bg-surface/35">
        {encoders.map((enc) => (
          <EncoderToggle
            key={enc.id}
            info={enc}
            enabled={enabled.has(enc.id)}
            disabled={pending}
            onChange={(want) => toggle(enc.id, want)}
          />
        ))}
      </div>
    </Section>
  );
}

function EncoderToggle({
  info,
  enabled,
  disabled,
  onChange,
}: {
  info: EncoderInfo;
  enabled: boolean;
  disabled: boolean;
  onChange: (want: boolean) => void;
}) {
  return (
    <div className="border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[12px] font-[620] text-foreground">
              {info.display_name}
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {info.dim} dimensions
            </span>
            <span className="text-[10px] text-muted-foreground">
              {info.supports_image && info.supports_text
                ? "Image and text"
                : info.supports_image
                  ? "Image only"
                  : "Text only"}
            </span>
          </div>
          <details className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            <summary className="w-fit cursor-pointer transition-colors hover:text-foreground">
              Role in search
            </summary>
            <p className="mt-1.5 max-w-[34ch] leading-relaxed">
              {info.description}
            </p>
          </details>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`Toggle ${info.display_name}`}
          disabled={disabled}
          onClick={() => onChange(!enabled)}
          className={`relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-[background-color,border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-45 ${
            enabled
              ? "border-primary/55 bg-primary"
              : "border-border-strong bg-input"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full shadow-[0_1px_4px_var(--shadow-color)] transition-[transform,background-color] duration-200 ${
              enabled
                ? "translate-x-[18px] bg-primary-foreground"
                : "translate-x-0 bg-muted-foreground"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
