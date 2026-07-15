import { FolderPlus, Trash2 } from "lucide-react";
import {
  useAddRoot,
  useRemoveRoot,
  useRoots,
  useSetRootEnabled,
} from "../../queries/useRoots";
import { pickScanFolder } from "../../services/images";
import { recordAction } from "../../services/perf";
import { Section, Toggle } from "./controls";

export function FoldersSection() {
  const { data: roots } = useRoots();
  const addRootMutation = useAddRoot();
  const removeRootMutation = useRemoveRoot();
  const toggleRootMutation = useSetRootEnabled();

  return (
    <Section
      title="Folders"
      description="Add folders to index them recursively. Enabled folders stay watched for changes; pausing one keeps its index intact."
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {(roots ?? []).length === 1
            ? "1 library folder"
            : `${(roots ?? []).length} library folders`}
        </span>
        <button
          className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-border-strong bg-surface-raised/65 px-2.5 text-[11px] font-[620] text-foreground shadow-[inset_0_1px_0_oklch(0.98_0.005_245/0.04)] transition-[background-color,border-color,transform] hover:bg-accent active:scale-[0.98]"
          onClick={async () => {
            try {
              const folder = await pickScanFolder();
              if (!folder) return;
              recordAction("folder_add", { path: folder });
              await addRootMutation.mutateAsync(folder);
            } catch (err) {
              window.alert(
                `Could not add folder: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }}
        >
          <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
          Add folder
        </button>
      </div>

      <div className="overflow-hidden rounded-[11px] border border-border bg-surface/35">
        {(roots ?? []).map((root) => (
          <div
            key={root.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent/30"
          >
            <Toggle
              checked={root.enabled}
              onChange={(enabled) => {
                recordAction("folder_toggle", {
                  id: root.id,
                  enabled,
                });
                toggleRootMutation.mutate({ id: root.id, enabled });
              }}
            />
            <div className="min-w-0">
              <p
                className={[
                  "truncate text-[11px] font-[560] leading-snug",
                  root.enabled
                    ? "text-foreground"
                    : "text-muted-foreground",
                ].join(" ")}
                title={root.path}
              >
                {root.path}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {root.enabled
                  ? "Included in the library"
                  : "Paused, index retained"}
              </p>
            </div>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${root.path}?\n\nThe images from this folder will be removed from the index. The actual files on disk are not touched.`,
                  )
                ) {
                  recordAction("folder_remove", {
                    id: root.id,
                    path: root.path,
                  });
                  removeRootMutation.mutate(root.id);
                }
              }}
              aria-label="Remove folder"
              className="grid size-7 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            </button>
          </div>
        ))}

        {(roots ?? []).length === 0 && (
          <div className="px-4 py-5 text-center">
            <p className="text-[11px] font-[560] text-foreground">
              No folders added
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              Add a folder to begin building the library.
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}
