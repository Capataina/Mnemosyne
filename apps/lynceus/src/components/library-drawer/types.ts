import type { RefObject } from "react";

import type { BubblePanelProps, BubbleTriggerProps } from "./useBubbleTrigger";
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
  /** Effective visibility (pinned OR hovered) — from useBubbleTrigger.open. */
  open: boolean;
  /** True only when click-pinned — drives the panel's focus-in-on-open;
   * hover-peeks don't steal focus. */
  pinned: boolean;
  /** Clears pin + hover — wired to Escape, outside click, and the header's
   * close control. */
  onClose: () => void;
  /** Pointer handlers from useBubbleTrigger.panelProps, so the panel can
   * cancel a pending close while the pointer travels onto it. */
  panelProps: BubblePanelProps;
  /** The trigger button's ref, so closing can return focus to it. */
  triggerRef: RefObject<HTMLButtonElement | null>;
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
  /** Effective visibility (pinned OR hovered) — drives the active/highlight
   * style, the same signal the panel uses to decide whether it's showing. */
  open: boolean;
  triggerProps: BubbleTriggerProps;
  drawerId?: string;
  className?: string;
  disabled?: boolean;
  ref?: RefObject<HTMLButtonElement | null>;
}
