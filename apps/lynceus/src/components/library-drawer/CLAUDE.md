# src/components/library-drawer/

Library edge slide-out panel: tag folders (browse one tag as a folder) plus include/exclude tag filtering. Purely presentational — all filter state lives in the page (`pages/[...slug].tsx`), which also feeds the same state to SearchBar so the panel and search chips are two views of one filter.

## Map

```
library-drawer/
├── index.ts               Public surface: LibraryDrawer, LibraryMenuButton, EdgeHoverZone,
│                           useBubbleTrigger (+ its constants/types) + types.
├── useBubbleTrigger.ts     Hover-open-with-intent + click-to-pin state machine SHARED by
│                           both panels — settings/index.tsx imports it from here via the
│                           barrel rather than duplicating it, since the interaction contract
│                           is identical for both triggers. One instance per panel, owned by
│                           the route (the common ancestor of the trigger in TopBar and the
│                           panel rendered alongside it). Also hosts BUBBLE_SLIDE_MS/EASE
│                           (the shared slide motion) and BUBBLE_EDGE_HOTZONE_PX (the shared
│                           edge-strip width) for the same reason.
├── EdgeHoverZone.tsx       Thin invisible hover strip flush against a screen edge (left or
│                           right), feeding the SAME triggerProps.onMouseEnter/onMouseLeave
│                           as the TopBar trigger button — hovering the bare edge opens the
│                           panel. Always mounted, independent of `open`. z-[45] (grid-chrome
│                           tier, ui/dialog.tsx) — under the panel itself (200) and the detail
│                           modal (100), so it can't pop a panel out over an open image.
├── LibraryDrawer.tsx       The panel: non-modal, z-[200], anchored FLUSH to the screen's left
│                           edge (fixed, `top-[84px] bottom-3`), sliding in via
│                           translateX(-100% → 0) over BUBBLE_SLIDE_MS; rounded only on the
│                           inner (right) edge, the outer edge is flush. Renders its own
│                           EdgeHoverZone as a sibling of the AnimatePresence-gated panel div.
│                           Escape/outside-click call `onClose`; pin-open moves focus in,
│                           close returns it to `triggerRef`. Composes the two lists.
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
│                           panelProps/triggerRef/triggerProps, sourced from
│                           useBubbleTrigger).
├── useBubbleTrigger.test.ts  Hook contract: hover-enter delay, leave-grace close, panel
│                           re-enter cancels a pending close, pin toggling, close() clears
│                           timers, and the route's mutual-exclusion effect pair (verbatim,
│                           since the route itself has no test harness — pages/CLAUDE.md).
│                           Unchanged by the edge-slide-out geometry correction — the state
│                           machine it tests never moved.
└── LibraryDrawer.test.tsx  Panel contract: Escape/outside-click close, trigger-click is
                            excluded from "outside", pin-only focus-in/focus-return, hover
                            handoff to the panel, the z-[200] tier, and (2026-08-03) the
                            left-edge hover strip opening via triggerProps even while closed.
```

## The edge slide-out redesign (2026-08-03, corrected same day)

Both drawers were full-height scrimmed slide-outs at z-90/91 through 2026-08-02. A first pass (89b6ee2) replaced that with a non-modal floating "bubble" — a rounded-2xl `floating-surface` card popping open near the trigger with a scale+fade motion. The founder clarified same-day that this wasn't the intended shape: the reference was an edge slide-out menu (another of his apps) — a panel anchored flush to the screen edge that slides out horizontally on hovering that edge. This second pass keeps every interaction contract from the first (no scrim, grid stays interactive, hover-open-with-intent + click-to-pin, Escape/outside-click, mutual exclusion, focus-on-pin, z-[200]) and changes only the presentation: flush-edge anchoring, translateX slide instead of scale+fade, rounding on the inner edge only, and a new `EdgeHoverZone` strip so hovering the bare screen edge — not just the TopBar icon — opens the panel. `useBubbleTrigger` is still the whole state machine; `LibraryDrawer`/`SettingsDrawer` stay presentational panels that consume its output, now also forwarding `triggerProps` down to their `EdgeHoverZone`. Mutual exclusion (opening one panel closes the other) is NOT implemented here — it's a `useEffect` pair in the route, since the route is the only place holding both panels' hook instances; see `pages/[...slug].tsx` and the mirrored test in `useBubbleTrigger.test.ts`.

## Operating notes

- `includeTagIds` / `excludeTagIds` must stay disjoint; `onSetTagFilter` replaces either state (stated on the props type).
- Counts come from `services/tags.ts getTagCounts()` — per-tag counts under the grid's visibility predicate, so a folder's number matches what opening it shows. The query is NOT gated on the panel's open state (never was, pre-redesign); if a future change adds that gating, gate on `open` (pinned OR hovered), not `pinned` alone — a hover-peek is a real "the user is looking at this" moment for data-freshness purposes.
- Destructive confirms launched from this panel rely on dialogs sitting at z-[250]; see the ladder in `ui/dialog.tsx` (the invisible-modal bug 244b87a started here, back when this was a scrimmed drawer at z-91 rather than a z-200 popover).
- `BUBBLE_EDGE_HOTZONE_PX` (10px) is well inside the grid container's smallest padding (`px-5` = 20px, `pages/[...slug].tsx`), so the strip can never overlap a tile's interactive edge — verified by reading that padding value, not assumed.
