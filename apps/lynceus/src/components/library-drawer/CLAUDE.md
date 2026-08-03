# src/components/library-drawer/

Library bubble panel: tag folders (browse one tag as a folder) plus include/exclude tag filtering. Purely presentational — all filter state lives in the page (`pages/[...slug].tsx`), which also feeds the same state to SearchBar so the panel and search chips are two views of one filter.

## Map

```
library-drawer/
├── index.ts               Public surface: LibraryDrawer, LibraryMenuButton, useBubbleTrigger
│                           (+ its constants/types) + types.
├── useBubbleTrigger.ts     Hover-open-with-intent + click-to-pin state machine SHARED by
│                           both bubble panels — settings/index.tsx imports it from here
│                           via the barrel rather than duplicating it, since the interaction
│                           contract is identical for both triggers. One instance per bubble,
│                           owned by the route (the common ancestor of the trigger in TopBar
│                           and the panel rendered alongside it).
├── LibraryDrawer.tsx       The floating panel: non-modal, z-[200], pops out near the trigger
│                           (fixed, anchored to the header's left edge) with a scale+fade
│                           motion. Escape/outside-click call `onClose`; pin-open moves focus
│                           in, close returns it to `triggerRef`. Composes the two lists.
├── LibraryMenuButton.tsx   The trigger button — ref-as-prop (React 19), spreads
│                           `triggerProps` from useBubbleTrigger; active style follows
│                           `open` (pinned OR hovered).
├── TagFolderList.tsx       "All images" + one row per tag with image counts
│                           (locale-formatted), single-select folder semantics.
├── TagFilterList.tsx       Include/exclude toggles per tag, excluding the active folder
│                           tag; case-insensitive name sort; optional clear-all.
├── types.ts                LibraryDrawerTag = Tag + imageCount (counts are supplied by
│                           the mounting layer — the base Tag has none), TagFilterState,
│                           and the component prop contracts (open/pinned/onClose/
│                           panelProps/triggerRef, sourced from useBubbleTrigger).
├── useBubbleTrigger.test.ts  Hook contract: hover-enter delay, leave-grace close, panel
│                           re-enter cancels a pending close, pin toggling, close() clears
│                           timers, and the route's mutual-exclusion effect pair (verbatim,
│                           since the route itself has no test harness — pages/CLAUDE.md).
└── LibraryDrawer.test.tsx  Panel contract: Escape/outside-click close, trigger-click is
                            excluded from "outside", pin-only focus-in/focus-return, hover
                            handoff to the panel, and the z-[200] tier.
```

## The bubble-panel redesign (2026-08-03)

Both drawers were full-height scrimmed slide-outs at z-90/91 through 2026-08-02. The founder spec replaced that with a non-modal floating "bubble": rounded-2xl `floating-surface` panel, no scrim, grid stays interactive underneath, opens on hover-with-intent over the trigger and toggles pinned on click. `useBubbleTrigger` is the whole state machine; `LibraryDrawer`/`SettingsDrawer` stay presentational panels that consume its output. Mutual exclusion (opening one bubble closes the other) is NOT implemented here — it's a `useEffect` pair in the route, since the route is the only place holding both bubbles' hook instances; see `pages/[...slug].tsx` and the mirrored test in `useBubbleTrigger.test.ts`.

## Operating notes

- `includeTagIds` / `excludeTagIds` must stay disjoint; `onSetTagFilter` replaces either state (stated on the props type).
- Counts come from `services/tags.ts getTagCounts()` — per-tag counts under the grid's visibility predicate, so a folder's number matches what opening it shows. The query is NOT gated on the panel's open state (never was, pre-redesign); if a future change adds that gating, gate on `open` (pinned OR hovered), not `pinned` alone — a hover-peek is a real "the user is looking at this" moment for data-freshness purposes.
- Destructive confirms launched from this panel rely on dialogs sitting at z-[250]; see the ladder in `ui/dialog.tsx` (the invisible-modal bug 244b87a started here, back when this was a scrimmed drawer at z-91 rather than a z-200 popover).
