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
    <Section title="Folders">
      <p className="-mt-1 text-[11px] leading-relaxed text-muted-foreground">
        The app indexes every enabled folder recursively. Disable
        to exclude without losing the index; remove to delete the
        index entirely.
      </p>
      <div className="flex flex-col gap-2.5">
        {(roots ?? []).map((root) => (
          <div
            key={root.id}
            className="flex items-center gap-3 rounded-[11px] border border-border bg-surface/55 px-3.5 py-3 transition-colors hover:border-border-strong"
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
            <div className="flex-1 min-w-0">
              <p
                className={[
                  "truncate text-[11px] leading-relaxed",
                  root.enabled
                    ? "text-foreground"
                    : "text-muted-foreground",
                ].join(" ")}
                title={root.path}
              >
                {root.path}
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
              className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        ))}

        {(roots ?? []).length === 0 && (
          <p className="rounded-[10px] border border-dashed border-border px-3.5 py-4 text-center text-[11px] text-muted-foreground">
            No folders configured yet.
          </p>
        )}
      </div>

      <button
        className="flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-border-strong bg-surface-raised/65 px-3 text-[12px] font-[620] text-foreground shadow-[inset_0_1px_0_oklch(0.98_0.005_245/0.04)] transition-[background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.985]"
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
    </Section>
  );
}
