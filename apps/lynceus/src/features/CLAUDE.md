# src/features/

Self-contained product features: everything a feature needs (components, hooks, motion tokens, CSS, tests) lives inside its folder behind an `index.ts`, unlike `components/` (shared presentation) and `hooks/` (shared logic).

```
features/
├── gesture-timer/   Fullscreen timed drawing-reference session — see its file.
└── onboarding/      Six looping skeleton demos with a fake cursor — see its file.
```
