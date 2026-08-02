# src/components/library-drawer/

Left-edge library drawer: tag folders (browse one tag as a folder) plus include/exclude tag filtering. Purely presentational — all filter state lives in the page (`pages/[...slug].tsx`), which also feeds the same state to SearchBar so drawer and search chips are two views of one filter.

## Map

```
library-drawer/
├── index.ts               Public surface: LibraryDrawer, LibraryMenuButton + types.
├── LibraryDrawer.tsx       The drawer shell (z-[90] scrim / z-[91] panel, matching the
│                           settings drawer): focus containment via FOCUSABLE_SELECTOR,
│                           Escape/outside-click close, composes the two lists.
├── TagFolderList.tsx       "All images" + one row per tag with image counts
│                           (locale-formatted), single-select folder semantics.
├── TagFilterList.tsx       Include/exclude toggles per tag, excluding the active folder
│                           tag; case-insensitive name sort; optional clear-all.
└── types.ts                LibraryDrawerTag = Tag + imageCount (counts are supplied by
                            the mounting layer — the base Tag has none), TagFilterState.
```

## Operating notes

- `includeTagIds` / `excludeTagIds` must stay disjoint; `onSetTagFilter` replaces either state (stated on the props type).
- Counts come from `services/tags.ts getTagCounts()` — per-tag counts under the grid's visibility predicate, so a folder's number matches what opening it shows.
- Destructive confirms launched from this drawer rely on dialogs sitting at z-[250]; see the ladder in `ui/dialog.tsx` (the invisible-modal bug 244b87a started here).
