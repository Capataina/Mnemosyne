# design/mark/ — the ringed-almond brand mark

Lynceus's face: a 3D black almond eye with a blue iris echoing the app primary, on a dark navy ground with a hairline rim (repainted 2026-08-03, rim added same day after a founder Dock screenshot; see below). Won a seven-candidate multi-model logo round; authored as hand-written SVG throughout.

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

The lens (near-black, `#080A0E`→`#414853`) sat close enough to the new near-black ground to risk dissolving, so a soft radial `lift` gradient (`#26374F` at 60% opacity, fading to transparent, `r="52%"` centred on the eye) sits behind the almond before the contact-shadow ellipse — a faint glow, not a shape, that keeps the lens's rim stroke and highlight ellipses legible without touching the eye geometry itself. The existing grey contact-shadow ellipse's opacity dropped `.22` → `.14` since a light grey blur reads as a soft halo rather than a shadow once the ground beneath it is dark. Verified by rendering `icon.png` (512px), `128x128.png`, and `32x32.png`: the iris ring stays clearly separated from the ground at every size checked, including 32px where the mark is still legible as a blue-ringed eye rather than a dark blur.

## The corner rim (2026-08-03, same day)

Founder feedback on the ground repaint, from a Dock screenshot: "looks like it has no corners at all now — increase the contrast between the eye and the background or add a minimal line or something in between." The deep blue-slate card was blending straight into a dark Dock/desktop, so the squircle silhouette vanished and the eye read as floating with no frame. Fixed with both levers the feedback named, applied together:

1. **The ground itself got lighter and wider-ranged**: `bg` moved from `#141D2B`→`#0D121C` to `#1C2840`→`#0E1420`, so the card reads as a lit surface rather than near-matching a pure-dark backdrop. The `lift` radial behind the eye moved with it (`#1B2636` → `#26374F`, opacity `.55` → `.6`) to keep the lens separated now that the ground under it is a touch brighter.
2. **A two-line hairline rim traces the squircle edge**, inset from the card's true edge rather than drawn on it (an edge-aligned stroke would straddle the OS mask boundary and get partly cropped): an outer line at `x/y=8`, `rx=221`, `stroke="#3E4F6B"` at `.45` opacity, `stroke-width="2.6"` (final ≈2.1px at the 1024 canvas once the 0.8047 card scale applies), and a second, tighter, darker line at `x/y=14`, `rx=215`, `stroke="#070A0F"` at `.3` opacity, `stroke-width="1.3"` (final ≈1.0px) for a faint bevel read. Both sit fully inside the drop-shadow rect's existing Big Sur margin, so neither is at risk from icon-mask cropping.

Verified by compositing the regenerated `icon.png` (512px), `128x128.png`, and `32x32.png` onto both a `#1a1a1a` dark and a mid-grey `#5a5a5f` backdrop (Pillow alpha-composite, not a bare Read against the default white canvas — the default canvas hides exactly the failure mode being fixed). At 512px and 128px the rim reads as a clean, fine edge tracing the corner, not a ring, and the squircle is unambiguous against both backdrops. At 32px the rim itself anti-aliases away (expected at that stroke width) but the brightened, wider-range ground alone is enough to keep the corner silhouette legible against dark — the eye stays a recognisable blue-ringed mark rather than a cornerless blur.
