# design/mark/ — the ringed-almond brand mark

Lynceus's face: a 3D black almond eye with a blue iris echoing the app primary, on a dark navy ground (repainted 2026-08-03; see below). Won a seven-candidate multi-model logo round; authored as hand-written SVG throughout.

```
mark/
├── ringed-almond-r1.svg                     round-1 original, preserved verbatim (c809fdb) —
│                                            THIS is what ships; it beat its own softened
│                                            variants on simplicity (b5005e4)
├── app-icon-master.svg                      the composed icon source: r1 card scaled to 824px,
│                                            centred on a transparent 1024 canvas with drop
│                                            shadow (Big Sur ~10% margin convention); corner
│                                            radius pre-compensated 184 -> 229 for the 0.8047 scale.
│                                            Card fill now diverges from r1/LynceusMark (dark
│                                            ground vs off-white) — see the ground note below
├── logo-terra-r2-1-softer-gaze.svg          round-2 softening variants (fa7f561), one lever
├── logo-terra-r2-2-lighter-material.svg     each: gaze, material, geometry, ambience.
├── logo-terra-r2-3-friendlier-geometry.svg  Vaulted UNSHIPPED — kept for future family
└── logo-terra-r2-4-warmer-ambience.svg      marks, not pending decisions
```

Regenerating the icon set: `pnpm tauri icon design/mark/app-icon-master.svg` from `apps/lynceus/` writes icns/ico/png into `../../src-tauri/icons/`; delete the android/, ios/, and (as of this tauri CLI version) the Windows Square*Logo.png/StoreLogo.png sets it also emits (macOS-only app, none of the three regenerate on demand and none are named in `tauri.conf.json`'s `bundle.icon` list). The in-app `LynceusMark` component carries the same eye cropped to the almond, gradient ids namespaced `mark-*` — an SVG edit here does not propagate to it automatically; `LynceusMark` has no background card, so it needed no change for the ground repaint below.

The r1-ships decision is closed (2026-07-19): the base won as the anchor the rest of the product family's marks will align to. Don't reopen it by "helpfully" shipping a softened variant.

## The ground repaint (2026-08-03)

The app-icon card shipped off-white (`#F8F8FA` → `#ECEEF2`, matching r1) since b5005e4 — jarring against a Dock and a `#131519`-slate in-app theme (founder report: "literally white background... looks so jarring"). `app-icon-master.svg`'s `bg` gradient is now a deep blue-slate that echoes the iris rather than a flat near-black: `#141D2B` (top) → `#0D121C` (bottom), a ~3% lightness ramp so the card isn't visually flat. This is the one deliberate divergence from r1/`LynceusMark` — the in-app mark carries no card at all (see above), so only the icon's ground moved; r1.svg itself is untouched (still the vaulted round-1 original, off-white ground, preserved verbatim per its own note).

The lens (near-black, `#080A0E`→`#414853`) sat close enough to the new near-black ground to risk dissolving, so a soft radial `lift` gradient (`#1B2636` at 55% opacity, fading to transparent, `r="52%"` centred on the eye) sits behind the almond before the contact-shadow ellipse — a faint glow, not a shape, that keeps the lens's rim stroke and highlight ellipses legible without touching the eye geometry itself. The existing grey contact-shadow ellipse's opacity dropped `.22` → `.14` since a light grey blur reads as a soft halo rather than a shadow once the ground beneath it is dark. Verified by rendering `icon.png` (512px), `128x128.png`, and `32x32.png`: the iris ring stays clearly separated from the ground at every size checked, including 32px where the mark is still legible as a blue-ringed eye rather than a dark blur.
