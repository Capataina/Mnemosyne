import { Folder, Images } from "lucide-react";

import type { LibraryDrawerTag } from "./types";

interface TagFolderListProps {
  tags: readonly LibraryDrawerTag[];
  totalImageCount: number;
  activeTagId: number | null;
  onSelectFolder: (tagId: number | null) => void;
}

function formatCount(count: number) {
  return count.toLocaleString();
}

export function TagFolderList({
  tags,
  totalImageCount,
  activeTagId,
  onSelectFolder,
}: TagFolderListProps) {
  const sortedTags = [...tags].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  return (
    <nav aria-label="Tag folders">
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h3 className="text-[11px] font-[650] text-foreground">Folders</h3>
        <span className="text-[10px] text-muted-foreground">
          {formatCount(tags.length)} tags
        </span>
      </div>

      <div className="space-y-0.5">
        <button
          type="button"
          aria-current={activeTagId === null ? "page" : undefined}
          className={`flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[12px] transition-[color,background-color,transform] active:scale-[0.99] ${
            activeTagId === null
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          onClick={() => onSelectFolder(null)}
        >
          <Images
            className={`size-4 shrink-0 ${
              activeTagId === null ? "text-primary" : "text-muted-foreground"
            }`}
            strokeWidth={1.7}
          />
          <span className="min-w-0 flex-1 truncate font-[560]">All images</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {formatCount(totalImageCount)}
          </span>
        </button>

        {sortedTags.map((tag) => {
          const active = tag.id === activeTagId;

          return (
            <button
              key={tag.id}
              type="button"
              aria-current={active ? "page" : undefined}
              title={`${tag.name}: ${formatCount(tag.imageCount)} images`}
              className={`flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[12px] transition-[color,background-color,transform] active:scale-[0.99] ${
                active
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              onClick={() => onSelectFolder(tag.id)}
            >
              <Folder
                className="size-4 shrink-0"
                style={{ color: tag.color }}
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-[560]">
                {tag.name}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {formatCount(tag.imageCount)}
              </span>
            </button>
          );
        })}
      </div>

      {tags.length === 0 && (
        <p className="mx-2 mt-3 rounded-[10px] bg-surface-sunken/55 px-3 py-4 text-[11px] leading-relaxed text-muted-foreground">
          Tags you add to images will appear here as folders.
        </p>
      )}
    </nav>
  );
}
