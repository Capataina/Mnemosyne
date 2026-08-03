# src/components/ui/

shadcn-style primitives, restyled to the app's design language (oklch tokens, tight tracking, numeric font weights, rounded-[10-14px]). Edit these to change a primitive app-wide; app-specific composites live one level up.

## Map

```
ui/
├── dialog.tsx    Radix dialog at z-[250] — AND the canonical documentation of the whole
│                 app z-ladder (see below). Change stacking anywhere → update the comment here.
├── confirm.tsx   ConfirmProvider/useConfirm — promise-returning confirm/alert built on
│                 dialog.tsx; the app's only destructive-confirm path.
├── popover.tsx   Radix popover, z-50 (fine: popovers portal to body and outrank siblings
│                 contextually; the ladder's "popovers 200" refers to top-level surfaces).
├── command.tsx   cmdk command palette primitives (used by SearchBar, TagDropdown).
├── button.tsx    cva variants: default/destructive/outline/secondary/ghost/link.
├── badge.tsx     cva pill badge variants.
├── card.tsx      Card slots (header/title/content/…).
└── skeleton.tsx  skeleton-tile shimmer div (animation lives in App.css).
```

## The z-ladder (authority: comment in dialog.tsx)

grid chrome 10-50 (includes the library/settings edge-hover strips at 45) · perf overlay 80/81 · detail modal 100 · popovers + gesture timer + library/settings edge slide-out panels 200 · timer config panel 220 · onboarding overlay 240 · modal dialogs 250 · boot splash 300.

The library and settings drawers held their own rung (90/91) as full-height scrimmed panels through 2026-08-02; the 2026-08-03 redesign (`components/library-drawer/`, `components/settings/`) replaced both with non-modal panels anchored flush to a screen edge that slide out on hover-with-intent, and retired that rung — they now join the popover tier like any other Radix popover. The edge-hover strip that opens each panel sits at 45, deliberately below the detail modal (100) so hovering near the screen edge while an image is open can't pop a panel out over it.

A modal confirm is the one layer nothing may cover: a dialog below a scrimmed drawer once rendered invisible while Radix still locked pointer events app-wide — the app appeared frozen (the folder-delete no-op, 244b87a). If a new surface rises above 250, dialogs must move above it in the same change.
