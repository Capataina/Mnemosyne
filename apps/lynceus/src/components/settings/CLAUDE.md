# src/components/settings/

The settings bubble panel (⌘, or the gear icon, top-right of the header), one file per section so each stays focused on its own controls.

## Map

```
settings/
├── index.tsx                 Panel shell (non-modal, z-[200], pops out near the gear icon)
│                              + section order; carries the "Restart onboarding" row
│                              immediately above Reset — replays via
│                              useOnboarding().restart without touching persistence. Also
│                              re-exports SettingsMenuButton as this folder's trigger.
├── index.test.tsx             Onboarding-replay wiring (sections mocked out) + the bubble
│                              interaction contract: Escape/outside-click close, trigger
│                              excluded from "outside", pin-only focus-in/focus-return,
│                              hover handoff, and the z-[200]-below-dialogs-[250] check.
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

## The bubble-panel redesign (2026-08-03)

The settings drawer was a full-height scrimmed slide-out from the right edge at z-91 through 2026-08-02. The founder spec replaced that with a non-modal floating "bubble": rounded-2xl `floating-surface` panel, no scrim, grid stays interactive underneath, opens on hover-with-intent over the gear icon and toggles pinned on click.

The hover/pin state machine (`useBubbleTrigger`) lives in `library-drawer/`, not here — imported via that folder's public barrel (`@/components/library-drawer`). It's homed there rather than duplicated because the interaction contract (hover-enter delay, leave-grace, panel-hover cancels the pending close, click-toggles-pin) is byte-identical for both bubbles; see `library-drawer/CLAUDE.md` for the hook itself and its tests. This folder's `index.tsx` stays a pure consumer: it takes `open`/`pinned`/`onClose`/`panelProps`/`triggerRef` as props and owns only Escape/outside-click wiring and focus-in/focus-return, matching `LibraryDrawer.tsx`'s pattern exactly.

Mutual exclusion (opening one bubble closes the other) is NOT implemented in either folder — it's a `useEffect` pair in the route (`pages/[...slug].tsx`), since the route is the only place holding both bubbles' hook instances. The onboarding-replay button deliberately keeps the panel mounted during replay (comment inline in `index.tsx`) — that invariant survived the redesign unchanged; the panel still sits below the z-240 onboarding overlay and goes inert with the rest of the app the same way the old drawer did.

## Traps

- The preview breakdown's tier totals shrinking as size grows is CORRECT (eligibility), and all-zeros mid-pipeline is correct too (previews run last). Both were once reported as bugs; the UI now explains itself — don't "fix" the numbers, extend the narration.
- Base-480 completion is what `with_thumbnail` tracks; the "previews" phase is separate (1ac1ea5). Don't conflate the pill's phase with the base count.
- Don't reintroduce a full-height scrim or focus trap: this is deliberately non-modal (spec: "grid stays interactive underneath"). `aria-modal`/Tab-cycling belong to `ui/dialog.tsx`'s modal confirms, not this panel.
