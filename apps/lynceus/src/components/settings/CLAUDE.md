# src/components/settings/

The settings edge slide-out panel (⌘, or the gear icon, top-right of the header), one file per section so each stays focused on its own controls.

## Map

```
settings/
├── index.tsx                 Panel shell (non-modal, z-[200], anchored FLUSH to the screen's
│                              right edge, sliding in via translateX(100% → 0)) + section
│                              order; renders its own left-mirrored EdgeHoverZone (right side)
│                              as a sibling of the AnimatePresence-gated panel; carries the
│                              "Restart onboarding" row immediately above Reset — replays via
│                              useOnboarding().restart without touching persistence. Also
│                              re-exports SettingsMenuButton as this folder's trigger.
├── index.test.tsx             Onboarding-replay wiring (sections mocked out) + the panel
│                              interaction contract: Escape/outside-click close, trigger
│                              excluded from "outside", pin-only focus-in/focus-return,
│                              hover handoff, the z-[200]-below-dialogs-[250] check, and
│                              (2026-08-03) the right-edge hover strip opening via
│                              triggerProps even while closed.
├── SettingsMenuButton.tsx     The trigger button — ref-as-prop (React 19), spreads
│                              `triggerProps` from useBubbleTrigger; active style follows
│                              `open` (pinned OR hovered).
├── controls.tsx               Shared primitives: Section, Field, Slider, SegmentedButtons,
│                              Toggle — lifted out of the old monolithic SettingsDrawer.
├── ThemeSection.tsx            system/light/dark segmented control → useUserPreferences.
├── DisplaySection.tsx          Columns (0 = auto), tile min width/scale, animation level;
│                              embeds ResetResizesSection.
├── SearchSection.tsx           Similar/semantic result-count sliders, tag filter mode.
├── FoldersSection.tsx          Root add/remove/enable via queries/useRoots. Remove and toggle
│                              AWAIT mutateAsync and raise the alert dialog on failure — a
│                              silently-rolled-back optimistic mutation is indistinguishable
│                              from a dead button (244b87a); keep any new mutation loud.
├── EncoderSection.tsx          Per-encoder enable toggles (set_enabled_encoders IPC); backend
│                              enforces non-empty set, dedupe, known ids.
├── StatsSection.tsx            Pipeline counts + collapsible per-size preview breakdown
│                              (480/960/1440/2048). Denominators are ELIGIBLE counts (source
│                              wider than bucket), not library total; the breakdown query is
│                              enabled only while expanded (5s poll); incomplete tiers narrate
│                              the pipeline ("queued — runs after encoding" / "generating
│                              now…" per phase, cad6cfc). Also hosts the orphan "Clean up".
├── StatsSection.test.tsx       Collapsed-by-default + expand-with-eligible-denominators.
├── ResetResizesSection.tsx     Two-click armed reset of all manual col spans (red-highlight
│                              escalation; pointer-leave disarms).
└── ResetSection.tsx             Two-click reset of all preferences. Deliberately PRESERVES
                               onboardingVersionSeen — reset must not re-trigger first-boot
                               onboarding.
```

## The edge slide-out redesign (2026-08-03, corrected same day)

The settings drawer was a full-height scrimmed slide-out from the right edge at z-91 through 2026-08-02. A first pass (89b6ee2) replaced that with a non-modal floating "bubble" — a rounded-2xl `floating-surface` card popping open near the gear icon with a scale+fade motion. The founder clarified same-day that this wasn't the intended shape: the reference was an edge slide-out menu — a panel anchored flush to the screen edge that slides out horizontally on hovering that edge. This second pass keeps the interaction contract from the first (no scrim, grid stays interactive, hover-open-with-intent + click-to-pin, Escape/outside-click, z-[200]) and changes the presentation: the panel is now anchored FLUSH to the screen's right edge, sliding in via `translateX(100% → 0)` over `BUBBLE_SLIDE_MS`, rounded only on its inner (left) edge — the outer edge is flush with the screen. A new `EdgeHoverZone` (right side) feeds the same `triggerProps` hover handlers as the gear icon, so hovering the bare screen edge opens the panel too, not just the icon.

The hover/pin state machine (`useBubbleTrigger`) lives in `library-drawer/`, not here — imported via that folder's public barrel (`@/components/library-drawer`), which also hosts `EdgeHoverZone`, `BUBBLE_SLIDE_MS`/`BUBBLE_SLIDE_EASE`, and `BUBBLE_EDGE_HOTZONE_PX`. It's homed there rather than duplicated because the interaction contract (hover-enter delay, leave-grace, panel-hover cancels the pending close, click-toggles-pin, edge-hover geometry) is byte-identical for both panels; see `library-drawer/CLAUDE.md` for the hook itself and its tests. This folder's `index.tsx` stays a pure consumer: it takes `open`/`pinned`/`onClose`/`panelProps`/`triggerRef`/`triggerProps` as props and owns only Escape/outside-click wiring, focus-in/focus-return, and rendering its own mirrored `EdgeHoverZone` — matching `LibraryDrawer.tsx`'s pattern exactly.

Mutual exclusion (opening one panel closes the other) is NOT implemented in either folder — it's a `useEffect` pair in the route (`pages/[...slug].tsx`), since the route is the only place holding both panels' hook instances. The onboarding-replay button deliberately keeps the panel mounted during replay (comment inline in `index.tsx`) — that invariant survived both redesigns unchanged; the panel still sits below the z-240 onboarding overlay and goes inert with the rest of the app the same way the old drawer did.

## Traps

- The preview breakdown's tier totals shrinking as size grows is CORRECT (eligibility), and all-zeros mid-pipeline is correct too (previews run last). Both were once reported as bugs; the UI now explains itself — don't "fix" the numbers, extend the narration.
- Base-480 completion is what `with_thumbnail` tracks; the "previews" phase is separate (1ac1ea5). Don't conflate the pill's phase with the base count.
- Don't reintroduce a full-height scrim or focus trap: this is deliberately non-modal (spec: "grid stays interactive underneath"). `aria-modal`/Tab-cycling belong to `ui/dialog.tsx`'s modal confirms, not this panel.
- Don't re-round the outer (flush) edge of the panel — only the inner edge takes `rounded-*`; the outer edge is deliberately square against the screen boundary. Re-rounding both edges silently reintroduces the "floating card" look the founder explicitly rejected.
