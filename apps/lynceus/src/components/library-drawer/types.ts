import type { Tag } from "@/types";

export type TagFilterState = "include" | "exclude" | null;

/**
 * Drawer-facing tag data. The catalogue's base Tag does not currently carry
 * assignment counts, so the mounting layer supplies that derived value.
 */
export type LibraryDrawerTag = Tag & {
  imageCount: number;
};

export interface LibraryDrawerProps {
  open: boolean;
  onClose: () => void;
  tags: readonly LibraryDrawerTag[];
  totalImageCount: number;
  activeTagId: number | null;
  /** These sets must be disjoint; onSetTagFilter replaces either state. */
  includeTagIds: ReadonlySet<number>;
  excludeTagIds: ReadonlySet<number>;
  onSelectFolder: (tagId: number | null) => void;
  onSetTagFilter: (tagId: number, state: TagFilterState) => void;
  onClearFilters?: () => void;
  loading?: boolean;
  errorMessage?: string | null;
  id?: string;
}

export interface LibraryMenuButtonProps {
  open: boolean;
  onOpen: () => void;
  drawerId?: string;
  className?: string;
  disabled?: boolean;
}
