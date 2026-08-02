# src/components/settings/

The right-edge settings drawer (⌘, or the gear icon), one file per section so each stays focused on its own controls.

## Map

```
settings/
├── index.tsx                Drawer shell (z-[90]/z-[91]) + section order; carries the
│                            "Restart onboarding" row immediately above Reset — replays
│                            via useOnboarding().restart without touching persistence.
├── index.test.tsx           Onboarding-replay wiring, sections mocked out.
├── controls.tsx             Shared primitives: Section, Field, Slider, SegmentedButtons,
│                            Toggle — lifted out of the old monolithic SettingsDrawer.
├── ThemeSection.tsx         system/light/dark segmented control → useUserPreferences.
├── DisplaySection.tsx       Columns (0 = auto), tile min width/scale, animation level;
│                            embeds ResetResizesSection.
├── SearchSection.tsx        Similar/semantic result-count sliders, tag filter mode.
├── FoldersSection.tsx       Root add/remove/enable via queries/useRoots. Remove and toggle
│                            AWAIT mutateAsync and raise the alert dialog on failure — a
│                            silently-rolled-back optimistic mutation is indistinguishable
│                            from a dead button (244b87a); keep any new mutation loud.
├── EncoderSection.tsx       Per-encoder enable toggles (set_enabled_encoders IPC); backend
│                            enforces non-empty set, dedupe, known ids.
├── StatsSection.tsx         Pipeline counts + collapsible per-size preview breakdown
│                            (480/960/1440/2048). Denominators are ELIGIBLE counts (source
│                            wider than bucket), not library total; the breakdown query is
│                            enabled only while expanded (5s poll); incomplete tiers narrate
│                            the pipeline ("queued — runs after encoding" / "generating
│                            now…" per phase, cad6cfc). Also hosts the orphan "Clean up".
├── StatsSection.test.tsx    Collapsed-by-default + expand-with-eligible-denominators.
├── ResetResizesSection.tsx  Two-click armed reset of all manual col spans (red-highlight
│                            escalation; pointer-leave disarms).
└── ResetSection.tsx         Two-click reset of all preferences. Deliberately PRESERVES
                             onboardingVersionSeen — reset must not re-trigger first-boot
                             onboarding.
```

## Traps

- The preview breakdown's tier totals shrinking as size grows is CORRECT (eligibility), and all-zeros mid-pipeline is correct too (previews run last). Both were once reported as bugs; the UI now explains itself — don't "fix" the numbers, extend the narration.
- Base-480 completion is what `with_thumbnail` tracks; the "previews" phase is separate (1ac1ea5). Don't conflate the pill's phase with the base count.
