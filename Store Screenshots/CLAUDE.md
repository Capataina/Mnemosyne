# Store Screenshots/ — App Store marketing pages, per app

The shipping App Store screenshot sets for every product in this monorepo, plus the sources that regenerate them. One subfolder per app under both tiers; Lynceus is the only occupant until a sibling ships.

## Map

```
Store Screenshots/
├── Lynceus/           the 8 final pages, upload-ready (2880×1800 PNG, no alpha, sRGB —
│                      the Apple-verified spec), numbered in upload order
└── Sources/
    └── Lynceus/       one self-contained HTML per page — the editable recipe each PNG
                       renders from (headless Chrome at 2880×1800); same basenames
```

## The design system — "Electric Curator"

Chosen by the founder from a three-direction bake-off (gallery-dark and paper-ink lost; the losing sets live outside the repo in `~/Pictures/LynceusStoreSets/`). The locked vocabulary every page speaks: heavy grotesk headlines with one cyan-accented phrase (cyan `#7EBACE`, sampled from the app's own Semantic badge), tracked-out uppercase eyebrow labels, zoom-lens callouts (24px radius, 2px connector line landing on the true in-window position), the app window large with deep shadow and deliberate edge bleed, and per-page atmospheric backgrounds (layered glows + grain + blurred colour echoes keyed to that page's artwork — never flat colour, per founder direction). Produced 2026-08-03 by nine parallel agents (one per page) over founder-shot raw captures; page 9 (a near-twin of page 3's raw) was cut by the founder, leaving eight of Apple's ten slots.

## Page order — a real workflow, privacy last (founder direction)

Browse → find → wander → inspect → organise → practise → trust: 01 the library, 02 semantic search, 03 search-to-trail, 04 visual similarity, 05 the inspector (tags/notes/timer config), 06 tags-as-folders, 07 the live gesture session, 08 private-by-architecture as the closer. Upload in filename order.

## Regenerating a page

Edit its HTML in `Sources/<App>/`, then:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --screenshot="<App>/<name>.png" --window-size=2880,1800 --hide-scrollbars "Sources/<App>/<name>.html"
sips -m "/System/Library/ColorSync/Profiles/sRGB Profile.icc" "<App>/<name>.png"
```

Verify after every render: `sips -g pixelWidth -g pixelHeight -g hasAlpha` must report 2880×1800, alpha no — Apple rejects transparency outright.

## Traps

- **The HTMLs reference the raw captures by absolute `file://` path** into `Lynceus Pics/` at the repo root (gitignored — local raw material, ~44MB). Deleting or moving that folder breaks every re-render; the PNGs are unaffected. New captures for a UI refresh go into that folder and the HTML paths get repointed.
- **Review red lines baked into the set** (App Review 2.3.x): real unmodified UI only inside the window, overlays outside it, no pricing, no competitor names, 4+-safe content. Any new page inherits these.
- The `.DS_Store` siblings are Finder noise; the repo `.gitignore` already covers them.
