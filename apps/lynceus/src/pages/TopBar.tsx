/**
 * Route header: library bubble toggle, wordmark, search bar, add-folder and
 * settings bubble toggle. Extracted from `[...slug].tsx` (pure JSX move,
 * zero behaviour change) — see that file's CLAUDE.md planned-work entry.
 *
 * Two handlers stay BUILT IN THE ROUTE rather than folding into this
 * component: `onSearchChange` carries the leave-first invariant (exiting a
 * similar-set the moment a semantic query starts typing) and `onAddFolder`
 * carries the duplicate-folder confirm + mutation flow. Both are prebuilt
 * callbacks passed down, never re-derived here.
 *
 * The library and settings triggers each take an `open` flag plus a
 * `triggerProps`/`ref` pair sourced from the route's two
 * `useBubbleTrigger()` instances (`@/components/library-drawer`) — this
 * component stays presentational and never manages the hover/pin state
 * machine itself.
 */
import { FolderPlus } from "lucide-react";
import type { RefObject } from "react";
import {
  LibraryMenuButton,
  type BubbleTriggerProps,
} from "@/components/library-drawer";
import { SettingsMenuButton } from "@/components/settings";
import { SearchBar } from "@/components/SearchBar";
import type { Tag } from "../types";

interface TopBarProps {
  libraryOpen: boolean;
  libraryTriggerProps: BubbleTriggerProps;
  libraryTriggerRef: RefObject<HTMLButtonElement | null>;
  settingsOpen: boolean;
  settingsTriggerProps: BubbleTriggerProps;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
  onGoHome: () => void;
  tags: Tag[] | undefined;
  searchTags: Tag[];
  searchText: string;
  searchMode: "tags" | "semantic" | "idle";
  onSearchChange: (selectedTags: Tag[], text: string) => void;
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  onAddFolder: () => void;
}

export function TopBar({
  libraryOpen,
  libraryTriggerProps,
  libraryTriggerRef,
  settingsOpen,
  settingsTriggerProps,
  settingsTriggerRef,
  onGoHome,
  tags,
  searchTags,
  searchText,
  searchMode,
  onSearchChange,
  onCreateTag,
  onAddFolder,
}: TopBarProps) {
  return (
    <header className="chrome-surface sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-[72px] w-full items-center gap-3 px-5 md:px-8 lg:gap-4 lg:px-10">
        {/* Library bubble toggle (folders-as-tags) — always visible, the
            left-most anchor of the top bar. Hover pops it, click pins it. */}
        <LibraryMenuButton
          open={libraryOpen}
          triggerProps={libraryTriggerProps}
          ref={libraryTriggerRef}
          drawerId="library-drawer"
        />
        <div className="hidden w-32 shrink-0 items-center xl:flex">
          <button
            type="button"
            onClick={onGoHome}
            aria-label="Lynceus — back to library"
            title="Back to library"
            className="cursor-pointer rounded-[8px] px-1 py-0.5 text-[15px] font-[650] tracking-[-0.035em] text-foreground transition-opacity hover:opacity-70 active:scale-[0.98]"
          >
            Lynceus
          </button>
        </div>

        <div className="mx-auto min-w-0 max-w-3xl flex-1">
          <SearchBar
            tags={tags}
            selectedTags={searchTags}
            searchText={searchText}
            mode={searchMode}
            onSearchChange={onSearchChange}
            placeholder="Search images or type # to filter by tags..."
            onCreateTag={onCreateTag}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            title="Add image folder"
            aria-label="Add image folder"
            className="flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-border-strong bg-surface-raised/65 px-3.5 text-[12px] font-[560] text-secondary-foreground transition-[background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98]"
            onClick={onAddFolder}
          >
            <FolderPlus className="h-4 w-4" strokeWidth={1.8} />
            <span className="hidden md:inline">Add folder</span>
          </button>

          <SettingsMenuButton
            open={settingsOpen}
            triggerProps={settingsTriggerProps}
            ref={settingsTriggerRef}
            panelId="settings-panel"
          />
        </div>
      </div>
    </header>
  );
}
