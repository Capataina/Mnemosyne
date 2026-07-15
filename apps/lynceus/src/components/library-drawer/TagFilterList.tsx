import { Minus, Plus } from "lucide-react";

import type { LibraryDrawerTag, TagFilterState } from "./types";

interface TagFilterListProps {
  tags: readonly LibraryDrawerTag[];
  activeTagId: number | null;
  includeTagIds: ReadonlySet<number>;
  excludeTagIds: ReadonlySet<number>;
  onSetTagFilter: (tagId: number, state: TagFilterState) => void;
  onClearFilters?: () => void;
}

export function TagFilterList({
  tags,
  activeTagId,
  includeTagIds,
  excludeTagIds,
  onSetTagFilter,
  onClearFilters,
}: TagFilterListProps) {
  const filterableTags = [...tags]
    .filter((tag) => tag.id !== activeTagId)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  const activeFilterCount = includeTagIds.size + excludeTagIds.size;

  return (
    <section aria-labelledby="library-tag-filters-heading">
      <div className="mb-2 flex items-center justify-between px-2">
        <div>
          <h3
            id="library-tag-filters-heading"
            className="text-[11px] font-[650] text-foreground"
          >
            Refine
          </h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Combine tags with this view
          </p>
        </div>
        {activeFilterCount > 0 && onClearFilters && (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[10px] font-[600] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClearFilters}
          >
            Clear {activeFilterCount}
          </button>
        )}
      </div>

      <div className="mb-2.5 flex gap-3 px-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Plus className="size-3 text-primary" strokeWidth={2} />
          Must have
        </span>
        <span className="inline-flex items-center gap-1">
          <Minus className="size-3 text-destructive" strokeWidth={2} />
          Must not have
        </span>
      </div>

      <div className="space-y-0.5">
        {filterableTags.map((tag) => {
          const included = includeTagIds.has(tag.id);
          const excluded = excludeTagIds.has(tag.id);

          return (
            <div
              key={tag.id}
              className={`flex min-h-9 items-center gap-2 rounded-[10px] px-2.5 transition-colors ${
                included
                  ? "bg-primary/10"
                  : excluded
                    ? "bg-destructive/10"
                    : "hover:bg-accent/65"
              }`}
            >
              <span
                className="size-2.5 shrink-0 rounded-[3px] border border-foreground/10"
                style={{ backgroundColor: tag.color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[11px] font-[540] text-foreground">
                {tag.name}
              </span>

              <div
                className="flex shrink-0 items-center rounded-[8px] bg-surface-sunken/65 p-0.5"
                role="group"
                aria-label={`Filter by ${tag.name}`}
              >
                <button
                  type="button"
                  aria-label={
                    included
                      ? `Remove ${tag.name} from required tags`
                      : `Require ${tag.name}`
                  }
                  aria-pressed={included}
                  title={included ? "Remove must-have filter" : "Must have"}
                  className={`grid size-7 place-items-center rounded-[7px] transition-[color,background-color,transform] active:scale-95 ${
                    included
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-surface-raised hover:text-primary"
                  }`}
                  onClick={() =>
                    onSetTagFilter(tag.id, included ? null : "include")
                  }
                >
                  <Plus className="size-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label={
                    excluded
                      ? `Remove ${tag.name} from excluded tags`
                      : `Exclude ${tag.name}`
                  }
                  aria-pressed={excluded}
                  title={excluded ? "Remove must-not-have filter" : "Must not have"}
                  className={`grid size-7 place-items-center rounded-[7px] transition-[color,background-color,transform] active:scale-95 ${
                    excluded
                      ? "bg-destructive text-background"
                      : "text-muted-foreground hover:bg-surface-raised hover:text-destructive"
                  }`}
                  onClick={() =>
                    onSetTagFilter(tag.id, excluded ? null : "exclude")
                  }
                >
                  <Minus className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filterableTags.length === 0 && (
        <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Add another tag to combine filters.
        </p>
      )}
    </section>
  );
}
