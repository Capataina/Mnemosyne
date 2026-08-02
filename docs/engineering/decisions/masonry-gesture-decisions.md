# Masonry gesture system — the settled architecture and its decision ledger

> Distilled 2026-07-19 at the close of the gesture saga (2026-07-15 → 19, six fix
> rounds, four independent hunter swarms, three cross-family review waves), when
> the live pass confirmed every acceptance criterion and the plan file
> (`context/plans/masonry-gesture-rebuild.md`) was deleted per the plan-lifecycle
> rule. The full narrative lives in the commit history (arc:
> `889b765 → 6ac208a → f7f3e4b → 0d42833 → c3c18e7 → 102d1ad`); the current
> implementation contract lives in `docs/architecture/systems/masonry-layout.md`. This note
> holds what a future session must not re-derive: the decisions, their rejected
> alternatives, and the accepted costs.

## The architecture that won (live-verified 2026-07-19)

- **Occupancy packer** (per-column sorted free-interval lists, `lowestFreeY` /
  `firstOverlapBottom` / `occupy`): the only model that can backfill beneath
  multi-span tiles. The all-span-1, no-gesture, no-anchor feed keeps the
  historical scalar `colHeights` fast path byte-for-byte (21 equivalence tests).
- **Two-layer gesture model**: the ACTIVE tile's pixels follow the pointer 1:1
  via an imperative `translate3d` on an inner wrapper; its `MasonryAnchor` owns
  the committed slot, renders the drop placeholder, and NEIGHBOURS pack around
  the reserved footprint. Two writers never share one transform.
- **The footprint is the ghost's own quantised rectangle**: left column =
  `round(desiredX/stride)` (the edge-reference convention with its even-span
  centre ambiguity was DELETED, not fixed); top = origin-relative 48px steps
  (packs fire per step crossing; the first footprint equals the resting top).
- **WYSIWYG release**: the release scores the COMMITTED footprint rect against
  the pre-gesture snapshot with the active tile EXCLUDED; dropped-at-source is a
  slot comparison (raw-ghost y, tolerance min(height/2, 72px)); the hero is not
  a drop target.
- **Placement pins carry the telegraph**: every gesture commit stores
  `{startCol, top}` (drag: the committed footprint; resize: the previewed rect,
  on mutation success only). The settle pack reserves pinned rectangles FIRST —
  the same priority model as the live telegraph — with a `windowIsFree`
  collision fallback to the pinned column's `lowestFreeY`. Zero settled overlaps
  stay structural. Pins share `sessionOrder`'s lifecycle and ADDITIONALLY clear
  whenever the pack's coordinate basis changes (`sameGeometryBasis` /
  `onGeometryBasisChanged`), because pin tops are absolute pixels in that basis.
- **Render order is stable id order** (React never re-inserts a persistent
  node → every reflow animates); the keep-set frees culling only on genuine
  scrolls; the active tile is always force-mounted.

## Decision ledger — each with the alternative that lost

| Decision | Rejected alternative | Why it lost |
|---|---|---|
| Occupancy packer | Skyline/scalar frontier + anchor patches (3 rounds of them) | A scalar frontier structurally cannot represent free space beneath a wide tile; every anchor patch circled the wrong layer |
| Reserve-first placement pins | Column-only pins | A column pin steers one axis; settle Y was re-derived as max-of-N-frontiers, landing span≥2 one cell off 6/6 live |
| Reserve-first placement pins | Joint release solve (search insertion candidates for the densest match to the drop rect) | Pins achieve the same WYSIWYG outcome with a fraction of the machinery; joint-solve remains the escalation if pins ever prove insufficient |
| Pins reserved at feed-order turn → NO; reserved BEFORE the loop | Anchored-first placement AT column top / at feed turn | Feed-turn `lowestFreeY` was the round-2 bug itself; column-top placement teleports mid-grid tiles |
| Release targeting excludes self; source-drop = slot guard | Self-inclusive max-overlap ("dropping on your own slot no-ops naturally") | Self-overlap scales with tile width: a span-2 one-column move could NEVER commit (68.7k px² self vs 31.8k best neighbour) |
| Delete the edge-reference convention | Fix the centre formula for even spans | An absent mechanism cannot disagree with its caller again; the range concern motivating centre-reference applied to pointer-reads, not rectangle-reads |
| Real repack on release + pins | commit-adopt (freeze the last gesture geometry) | Adopt froze non-dense states and required racy guards (5e829dc/8fa6288 era); pins keep only the ONE intentional rectangle and re-solve density around it |
| Origin-relative 48px top quantum | Raw pointer Y per frame / absolute grid quantum | Raw Y re-solved the grid per pixel (mid-drag chaos); the absolute quantum phase-shifted the first footprint ±24px |
| Clear pins on geometry-basis change | Rescale pins proportionally | Pins are px in a specific basis; rescaling is speculative machinery for a rare event — releasing the arrangement is honest and cheap |

## Accepted costs and corners (deliberate, not oversights)

- Any pin retires the scalar fast path for the session (~2.3× pack cost at 48k
  items, measured, in-worker, near-linear — invisible live).
- Two pins with overlapping rects can swap priority across packs via feed order
  (corner state; never an overlap or void).
- A pinned tile can leave a small gap above/below when no later tile is short
  enough to backfill (inherent to honouring user placement — observed and
  accepted in the final live pass).
- Mid-flight tiles can cross during the 200ms live reflow or 260ms settle
  (painter-order flip, sub-second, accepted since 91564f0); the
  deliberate-collision choreography was never built because stable pack
  targets made it unnecessary.

## The hard-won process lessons

1. **Telemetry is evidence only after its own measurement is verified.** Three
   separate artefacts each cost a wrong diagnosis: transform-inflated
   "overlaps", gap `above`/`below` misread as coordinates, and phantom "306px
   gaps" that were span-2 tiles invisible to a left-edge-binned gap detector.
2. **Green tests measure what they assert, nothing more.** 179/179 coexisted
   with a broken feature because no test moved a tile by less than its own
   width, tested even spans on edge modes, or asserted cross-pack position
   stability. The suite now carries the gates that were missing (WYSIWYG settle
   equality, sign-flip variants, collision fallback, rect-pin fuzz, basis sweep).
3. **Blind swarms converge when the bug is real.** Both rounds: independent
   hunters with shared evidence and no shared hypotheses reproduced live
   telemetry rows to the pixel and agreed on one mechanism — the convergence
   itself was the confidence measure.
