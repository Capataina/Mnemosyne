# Masonry Gesture System — Complete Rebuild Plan & Implementation Spec

> **Status:** Authoritative spec for a full rebuild of the masonry drag/resize layout
> engine. Written 2026-07-18 after ~10 hours of iteration, a 14-agent diagnosis,
> a 3-architect + 2-council design phase, a full rework that FAILED live testing,
> and a final 25-agent workflow + cross-family council + prior-art research sweep.
> **This document is the single source of truth. It is self-contained: an
> implementer with no prior context can execute it end to end.**

---

## SESSION OUTCOME (2026-07-18 evening — where we actually got to)

The rebuild + a follow-up animation fix both LANDED (uncommitted → committed this
session). Status: **correctness solved and verified; feel close but not perfect;
finishing tomorrow.**

- **Rebuild (occupancy packer)** — implemented by GPT 5.6 Sol (max effort). Replaced
  the scalar-frontier packer with the occupancy model (per-column free intervals +
  `lowestFreeY`), the 2D `gestureFootprint`, deleted commit-adopt. **Fixed the
  correctness**: an adversarial critic fuzzed the new packer over 2000 trials →
  **zero overlaps**; the live video + telemetry confirm the grid is now DENSE with no
  gaps and no overlaps. The old gaps/overlaps nightmare is genuinely solved.
- **Animation fix** — implemented by GPT 5.6 Sol (xhigh). The rebuild had thrown out
  the *feel* (it handed the active tile's position to the packer, killing the
  imperative pointer-follow). The fix restored the **two-layer model**: the ACTIVE
  dragged/resized tile follows the pointer 1:1 via an imperative `translate3d` (the
  good old behaviour), while NEIGHBOURS reflow via the occupancy pack around the
  reserved footprint. Also fixed: release targeting now uses the PRE-gesture geometry
  (the "drops in an unrelated area" bug — release was scoring against the already-
  displaced grid); smooth aspect-locked resize preview; the hero-displacement edge bug
  (resize handles hidden/cancelled when an image is open).
- **Multi-span (2×2/3×3) confirmed handled** (the old `c6efd40`/`f94b421` "acts like
  1×1" trap): drag positions by the tile's CENTRE (`desiredX + width/2`) and carries
  `span`; release targets by MAXIMUM RECTANGLE-OVERLAP AREA of the full footprint, not
  a cursor point. `useTileDrag.ts` + `masonryReorder.ts` `spatialTargetId`.
- **Verification**: tsc clean; full suite **179/179** (the 21 steady-state equivalence
  tests untouched + 10 new animation regression tests). Version **0.5.4 → 0.6.0**.
  `context/systems/masonry-layout.md` rewritten to the two-layer model.

### WHAT'S LEFT (tomorrow's start)
The live test showed it is **"still not perfectly fixed"** — the residual feel issues
were not fully characterised in-session (the user stopped for the night). Tomorrow:
1. Fresh clean-restart live test (`just lynceus-dev-telemetry`), record a video +
   telemetry, and pin down the EXACT residual issues (the mechanism is right; this is
   polish, not a re-diagnosis).
2. Polish the remaining feel against those specifics.
3. **Fallback if polish stalls:** ship the app WITHOUT drag/resize for v1 — disable
   `reorderEnabled` and hide the resize handles (a few reversible lines; the grid stays
   a gorgeous dense viewer), and finish the gesture work on a branch post-launch. The
   correctness foundation is done either way, so re-enabling later is bounded UX work.

### Launch-adjacent (tracked on the Operation board, Image Browser Release)
The drag/resize is the app's "hero shot" for the intro/tutorial — worth finishing.
Launch-polish items (app logo/icon, launch animation on open, first-time + replayable
tutorial) are tracked as sub-issues #16/#17/#18.

---

## DIAGNOSIS 2026-07-19 (video + telemetry + 6 independent hunters — supersedes "this is polish")

The morning live test (28s video + perf-1784453601) was characterised frame-by-frame,
cross-read against telemetry, and handed to six independent hunters (3 Claude debuggers,
1 adversarial critic, 1 test-writer, GPT-5.6 Sol xhigh), each blind to the others. All
six converged. The §"SESSION OUTCOME" framing ("mechanism right, polish left") was wrong:
the packer IS correct (critic's 300-tile probe: zero fillable gaps; diag tests: largest
steady-state gap 27px), but the orchestration layers around it carry five real defects.

1. **Release self-target no-op** (`masonryReorder.ts:102-133` + `useTileDrag.ts:246-252`).
   `spatialTargetId` scores the drop rect against a pre-gesture snapshot that INCLUDES the
   active tile; for span≥2 a one-column move keeps `width−stride` of self-overlap (span-2:
   68,672 px² self vs 31,808 px² best neighbour — 2.16×), self wins, `reorderWithinList`
   no-ops, no `masonry_reorder` fires, and the settle pack reproduces the pre-drag layout.
   The dead zone scales with tile width (span-2 needs >2 columns, span-3 ~>3). Ground
   truth: all three 2×2 drags in the session left tile 876 at (240,296) — hard no-ops;
   both span-1 drags committed. Confirmed by 6/6 hunters, three numeric reproductions.
2. **Even-span off-by-one in the drag footprint** (`useTileDrag.ts:165-172` publishes
   `centreCol = floor((desiredX+width/2)/stride)` with edge:2; `resolveFootprintLeft`
   subtracts `span>>1`). For even spans the two conventions disagree by one column: a
   still span-2 tile at column c is reserved at column c−1 from the first drag frame, so
   the reserved obstacle never sits under the ghost and neighbours dodge the wrong
   column. Odd spans are correct — `masonryGestureAnchor.test.ts` tests edge modes only
   at span 3, which is why every existing 3×3 assertion passes.
3. **No positional carry on release/settle** (`masonryPacking.ts:435-458` + resize path).
   Only the SPAN persists; the settle pack re-derives the column by global argmin with no
   memory of the gesture's anchor. Deterministic repro: skyline [T,S,T,T,T,T] → settle
   jumps dx=−240. T3's −240/+240 pair = the left-corner preview pinning x=480 (right edge
   fixed, by design) then the settle pack re-deriving x=720. The felt post-resize wobble.
4. **Mid-drag chaos cluster**: (i) the reserved footprint renders EMPTY — no placeholder
   element exists; (ii) footprint `top` is the raw pointer Y, so every pointer frame
   re-solves the whole grid; (iii) correctness is endpoint-only — Sol's probe showed 0
   intersections at pack endpoints but 54–112 along the interpolated 400ms paths, so
   neighbours provably cross/stack mid-flight and vacated regions read as black holes.
   Together this is the whole "empties the boxes and everything under it" report.
5. **T2's persistent ~306px "gaps" are a telemetry artefact** (`telemetry.ts:306-310`):
   the gap detector bins tiles by left-edge x only, so a span-2 tile never registers in
   its second column — the reported gap is the tile itself (Sol reconstructed capture
   ts=20064 numerically: 692 covers x=960 y=296–570; 586−(148+132)=306). Third
   measurement-artefact wrong-lead of this saga. Dissent recorded: hunt-a proved greedy
   packing CAN strand small real gaps (150px in a 7-item fixture; 27–109px at realistic
   scale) — real but sub-tile-size, not the reported defect. Fix the monitor before
   trusting any future gap report.

Test-gap verdict (why 179/179 stayed green): reorder tests use only span-1 rects moved
further than their own width; edge-mode tests only span 3; regression tests assert
no-intersections (a pointer-disagreeing geometry passes) and relative-not-absolute gap
counts; nothing tests cross-pack position stability; the fuzz checked overlaps, never
density or pointer-agreement. Characterisation tests now exist at
`masonryPacking.diag.test.ts` / `masonryReorder.diag.test.ts` (deliberately weak
assertions; harden into failing-until-fixed gates as part of the fix round). Full hunter
reports live in the session scratchpad (hunt-a/b/c, hunt-critic, hunt-tests,
sol-findings).

What survived review: the occupancy packer, the release state machine (no strand found),
and the two-layer split as architecture. The fix round targets the layers around them.

---

## 0. THE MISSION (what the masonry is supposed to do — from the getgo)

The grid is not just a viewer; **free spatial manipulation is the point**:

1. **Drag any tile, any direction, any velocity** — up, down, diagonally, thrown
   fast across the grid — to reposition it. Displacing many tiles at once is
   DESIRED, not a bug.
2. **Drag multi-span tiles** — a 2×2 displaces its 4-tile footprint, a 3×3 its 9 —
   just as freely as a 1×1.
3. **Resize from all four corners** — top-left, top-right, bottom-left, bottom-right —
   with the grabbed corner behaving like a real handle.
4. **No visual bugs, ever**: no overlaps, no black/empty gaps, no teleports.
5. **The grid stays DENSE** — tiles reflow to fill space; the layout is always tight.
6. **Beautiful animation** — every tile SLIDES to its new position, snappy but never
   an instant teleport.

Images are variable-dimension (real photo/art aspect ratios), tens of thousands of
them, local-first, packed shortest-column masonry.

**The acceptance test (section 8):** move images of any size/dimension anywhere at
any velocity with zero visual artefacts, and resize from all four corners cleanly.

---

## 1. FULL BUG HISTORY (the arc that led here)

### 1.1 The original three bugs (reported after a live test, 2026-07-18)
1. **Dragging a 3×3 tile was completely broken** — it would not reorder.
2. **Diagonal drags broke the layout** — pure up/down slid fine, but crossing
   columns and rows at once corrupted the grid.
3. **Resizing bigger from a TOP corner dropped the tile ~2 rows** on release.

### 1.2 The telemetry-driven debugging arc (2026-07-17, commits `69caf68` → `afb9dc4`)
A long prior arc built an always-on layout monitor (`services/telemetry.ts`,
`startLayoutMonitor`) emitting one classified `reflow` event per settled reflow
(per-tile teleport-vs-slide via `classifyMove`, grid geometry with overlaps/gaps).
Earlier teleport fixes landed here: viewport-cull fix (`a9f4fcb`), the framer-`layout`
vs CSS-transition double-animator fix (`c6b2548` — dropped framer `layout`, CSS
transition on `MasonryAnchor` now owns position), the id-sorted render order
(`91564f0` — render tiles in stable id order so React never re-inserts a node and
kills its transition start-frame → every reflow animates), and a single-column drag
anchor (`e3adc2e` — pin the dragged tile's slot to the hovered column).

### 1.3 The 14-agent diagnosis (2026-07-18)
A swarm diagnosed a single **base cause**: the packer's only per-gesture stability
primitive was a **single scalar column pin** (X-only, span-unaware, one tile) bolted
onto a global, order-dependent greedy re-pack. Each bug was a different uncovered gap
in that one pin. Captured in `context/notes/masonry-gesture-bugs.md`.

### 1.4 The design phase
3 competing architects + GPT and Gemini councils + an adversarial critic. The chosen
design ("keep the greedy cascade, make it coherent"): a two-axis span-aware anchor +
a `prevCols` coherence tie-break + commit-adopt on release. **This design was
adopted and it is what failed — see section 3.**

### 1.5 The rework (commits, 2026-07-18)
| Commit | Time | What it did |
|---|---|---|
| `9f6cd7b` | 19:45 | **Part 1** — `resolveAnchorLeft(startCol, edge, span)` (two-axis span-aware X anchor, edge 0/1/2); `updateAnchorCol` (drag anchor tracks the pointer centre every frame, decoupled from the swap guard); **deleted the `offsetY` upward-growth illusion** (top corners grow top-anchored/down); `prevCols` tie-break added to the packer (inert unless a gesture supplies it). |
| `5e829dc` | 19:57 | **Part 2** — engine builds `prevCols` per-pack by tile-id (gesture-gated); **commit-adopt**: on gesture end, re-commit the last anchored geometry instead of re-packing (defers densification). Version 0.5.3 → 0.5.4. |
| `8fa6288` | 20:05 | **Adopt fix** — guard commit-adopt on selection match too (a same-tick selection change was dropping the selected tile); `onFailure` generation check. |

### 1.6 The live-test FAILURE (this is why we are here)
Two screen recordings + two telemetry sessions on the reworked, live (HMR) code:
- `Bug video.mov` (20:02:55, 52s) ↔ `perf-1784401362`
- `Bug video 2.mov` (20:05:41, 25.6s, post-adopt-fix) ↔ `perf-1784401528`
Both ran on ONE `just lynceus-dev-telemetry` launch at 20:02:34 (`tauri dev`, Vite
HMR, live source — **not** the stale July-15 `dist` bundle; confirmed via fish
history + the `start_lynceus.sh dev-telemetry` → `pnpm run tauri dev` chain).
**The bugs persisted. The rework did not fix them.**

### 1.7 The final sweep (25-agent workflow + council + research)
- Prior-art research (Muuri/Packery/GridStack/react-grid-layout).
- GPT 5.6 Sol (xhigh) + GPT 5.6 Terra (xhigh) cross-family reads.
- 2 focused debuggers (build-liveness + footprint; commit-adopt + resize-down).
- An 18-hunter whole-project workflow (data/dims/thumbnails/feed/backend/worker/
  render/state) + adversarial verify.
- **All converge on one root cause and one fix (sections 3, 6).**

---

## 2. THE FIXES WE TRIED AND WHY EACH FAILED (with proof)

| Fix (commit) | Intent | Why it FAILED — with proof |
|---|---|---|
| Single-column pin `e3adc2e` | Keep the dragged slot under the pointer | X-only; the pin's Y still comes from the greedy `colHeights` frontier. Superseded. |
| `resolveAnchorLeft` span-aware X `9f6cd7b` | 3×3 footprint reaches its true columns | Fixed X placement only. The **Y** still comes from `bestMax` of the widened window → down-push unaddressed. |
| `updateAnchorCol` `9f6cd7b` | Kill the 3×3 anchor freeze | Genuinely fixed the freeze, but the freeze was never the layout-breakage cause. |
| Delete `offsetY` illusion `9f6cd7b` | Kill the resize "drop 2 rows" | Removed the *fake* animation snap, but the tile STILL packs lower (real `bestMax` down-push) AND leaves an unbackfillable gap. Symptom persisted. |
| `prevCols` tie-break `9f6cd7b`/`5e829dc` | Stop shimmer | Correct but irrelevant to the actual bug (gaps). |
| **commit-adopt** `5e829dc` | Stop the release "jump" | **Actively made gaps worse**: it re-commits the last anchored pack and *defers densification indefinitely*, freezing a non-dense layout with the gesture-time gaps until the next filter/shuffle. |

### 2.1 The proof (repro tests written during the sweep — all pass, diagnosis-only)
- `masonryResizeDown.repro.test.ts`: a mid-grid tile at span 1 (col3, frontier 50px)
  resized to span 2, pulled into col2 (frontier 250px) → **jumps y=50 → y=250**, a
  **200px permanent void** in col3 between y=50 and y=250. Reproduces on the FIRST
  pack after resize — independent of commit-adopt.
- `masonryPacking.gaps.repro.test.ts`:
  - Footprint IS reserved correctly (span-3 anchored tile → zero overlap). **Hypothesis
    "footprint not reserved" REFUTED.**
  - commit-adopt freezing the pack costs **1232px vs 965.85px height — 266px (27.6%)
    extra dead space** that persists indefinitely; resized tile sits 495px lower than a
    free repack would place it.
- `masonryCommitAdopt.repro.test.ts`: the adopt re-commit places the tile in a
  different column with a live 200px void that a genuine repack would self-heal.
- Telemetry: settled "overlaps" (20–29k px²) are almost certainly the **floating
  dragged tile's `getBoundingClientRect`** (which includes the follow-pointer
  transform), not committed-geometry overlaps — **the pure packer cannot produce a
  settled overlap** (proven). The scary overlap numbers were largely a measurement
  artefact.
- Video: at **video1 ~16.2–16.4s** (resize tile 1240 → colSpan 2, telemetry ts=29552)
  the resized tile drops lower and a **big black gap opens** where it sat. Black gaps
  are visible throughout both videos including the post-fix one.

### 2.2 Why the whole rework missed it (the honest root)
`context/notes/masonry-gesture-bugs.md:17,40` **explicitly flagged** that "the anchored
tile's own Y still comes from `colHeights`" and that a structural fix was required.
The implementation fixed the **X anchor** and **release stability** and stopped — it
improved the easy parts and left the actual structural cause (Y placement + the
frontier model's inability to backfill) untouched. The tests reinforced the blind
spot: they assert no-overlap *within one pack*, never that the reserved rectangle
equals the rendered pointer rectangle, that a resized tile preserves its top, or that
release cannot increase the gap count.

---

## 3. ROOT CAUSE (consolidated — 5+ independent sources agree)

### 3.1 Primary: the packer is a SCALAR-FRONTIER (skyline) model that cannot backfill
`masonryPacking.ts` tracks **one height per column** (`colHeights: number[]`). It has
NO memory of empty space *below* a frontier. Two consequences it structurally cannot
avoid:

1. **Resize/move down-push + unfillable gap.** When a tile's footprint widens (or
   moves) into a column with a taller frontier, `bestMax = max(colHeights[window])`
   forces the tile down to that frontier. Its *own* vacated (shorter) column then has
   its frontier raised past the tile (`colHeights[k] = bestMax + itemHeight + gap` for
   every column in the span) → the space below becomes **dead**. No later tile can ever
   backfill it, because later tiles only ever see the raised frontier.
   (`masonryPacking.ts` pack loop ~lines 312–377; anchor branch + the frontier update.)

2. **The anchor is X-ONLY** (`columnAnchor: {id, startCol, edge}`) — it never carries
   the tile's actual pointer **Y**, so the reserved slot never matches the rendered
   rectangle. The dragged tile floats at the pointer while the pack reserves a slot
   at the frontier elsewhere.

### 3.2 Compounding: commit-adopt freezes the non-dense layout
`useMasonryEngine.ts` requestPack `justEnded` branch re-commits `prev.geometry` and
`return`s before any repack — densification deferred to "the next steady-state pack",
which may never come. The gesture-time gaps persist indefinitely.

### 3.3 Corrected: the "overlaps" were mostly a measurement artefact
The pure packer cannot produce a settled overlap. The telemetry overlaps are the
floating dragged tile's live transform box. The REAL visible bug is **gaps**, plus the
floating tile reading messy over those gaps.

### 3.4 What is NOT the cause (ruled out during the sweep)
- Footprint reservation (span is correctly reserved). REFUTED.
- The build being stale (it was live `tauri dev` HMR). REFUTED.
- `updateAnchorCol` freeze (fixed, but never the layout cause).
- [Upstream data / dimensions / thumbnails / feed — **see section 9, folded in after
  the 18-hunter workflow completes**.]

---

## 4. EVIDENCE LEDGER (paths for the implementer to verify against)

- Videos: `~/Documents/Bug video.mov`, `~/Documents/Bug video 2.mov`.
- Telemetry: `~/Library/Application Support/com.ataca.lynceus/exports/perf-1784401362/timeline.jsonl` (video1), `.../perf-1784401528/timeline.jsonl` (video2). Schema: JSONL, frontend events `kind:"user"`; `reflow` payload `{moved[], movedCount, teleportCount, trigger{kind,grabbed,cursor}, settled{overlaps[{a,b,area}], gaps}}`; grid tiles carry `packW`/`renderW`/`x`/`y`.
- Diagnosis note: `context/notes/masonry-gesture-bugs.md`.
- Repro tests (diagnosis-only, in `apps/lynceus/src/components/`): `masonryResizeDown.repro.test.ts`, `masonryPacking.gaps.repro.test.ts`, `masonryCommitAdopt.repro.test.ts`. (These prove the bugs; they should be superseded by real regression tests — section 7.)
- Sweep transcripts (full agent outputs): `/private/tmp/claude-501/-Users-atacanercetinkaya-Code-Mnemosyne/a253d316-2d08-4135-98dc-a79c0de9507b/scratchpad/` — `gpt-sol.md`, `gpt-terra.md`, `video-evidence.md`, `design-synthesis.md`, `findings-ledger.md`.

---

## 5. PRIOR ART (the industry-standard model — what every mature library does)

Verified against real source (Muuri, Packery, GridStack.js, react-grid-layout). They
**unanimously** do the opposite of our anchor-perturbation approach:

- **Do NOT perturb** the pack by pinning one tile. Instead: maintain a canonical
  ordered set; on every throttled drag tick, mutate the order/target, **re-run the full
  deterministic pack from scratch**, and **animate the diff by stable tile id**. The
  full repack IS the gap-free/overlap-free guarantee.
- **Exclude the dragged tile from the pack** entirely — it floats, with a cosmetic
  **placeholder** marking its reserved slot; everyone else densely repacks *without* it.
- **Multi-cell footprint is a first-class rect** through the SAME collision/repack
  routine — no special-casing 2×2/3×3.
- **Muuri/Packery use a free-rectangle (occupancy) packer**, precisely BECAUSE a
  skyline packer cannot backfill — which is exactly our bug.
- Anti-jitter is a **throttle** (~100–150ms sort interval) + a bounce-back-angle guard,
  not a perturbation shortcut.
- **Verdict:** "perturbation-for-speed is a false economy — it's what produces the
  overlap/gap/teleport bugs." (Full research + source links in `findings-ledger.md` /
  the researcher transcript.)

---

## 6. THE FIX — FULL IMPLEMENTATION SPEC (the aggregated consensus)

The rebuild replaces the anchor-perturbation gesture model with an **occupancy-aware
dense repack + a floating placeholder transaction**. This is the Muuri/Packery model
adapted to our variable-height shortest-column masonry with multi-span tiles.

### 6.1 Occupancy-aware packer (replaces scalar-frontier for gestures/spans)
Replace `colHeights: number[]` with **per-column sorted free-interval lists** so
smaller tiles can backfill space beneath a wider tile.

```ts
// Per column, the set of occupied [top, bottom) intervals (sorted).
// lowestFreeY finds the lowest y where a [start, start+span) × height rect fits.
function lowestFreeY(occupied: Interval[][], start: number, span: number, heightWithGap: number): number {
  let y = 0;
  for (;;) {
    let nextY = y;
    for (let col = start; col < start + span; col++) {
      const collision = firstOverlap(occupied[col], y, y + heightWithGap);
      if (collision) nextY = Math.max(nextY, collision.bottom);
    }
    if (nextY === y) return y;
    y = nextY;
  }
}
```

- Pre-insert the **active gesture footprint** (its reserved rectangle) into every
  column it covers, **skip its ordinary feed-index placement**, then pack all other
  tiles from `y=0` against the occupancy — so future small tiles occupy lower free
  intervals beneath a wide/anchored tile (the backfill the frontier model can't do).
- **Keep the current fast `colHeights` path for the all-span-1, no-gesture steady
  state** (preserves the 21 equivalence tests — section 8). The occupancy path is used
  when a gesture is active OR any tile spans >1 column.
- Hero/selected tile inserted through the same occupancy mechanism.

### 6.2 Full 2D gesture footprint (replaces the X-only anchor everywhere)
```diff
-columnAnchor?: { id: number; startCol: number; edge?: number };
+gestureFootprint?: { id: number; startCol: number; top: number; edge?: number };
```
Thread through: `masonryPacking.ts` (`MasonryPackInput`, `buildPackInput`),
`useMasonryEngine.ts` (`MasonryEngineInput`), `Masonry.tsx` (the memo). Remove
`resolveAnchorLeft`'s X-only role in favour of the footprint's `{startCol, top}`.

- **Drag** (`useTileDrag.ts`): publish both X and Y from the pointer:
  ```ts
  const desiredX = base.x0 + (pointer.x - base.startX);
  const desiredY = Math.max(0, base.y0 + (pointer.y - base.startY));
  setDragFootprint({ startCol: Math.floor((desiredX + placement.width / 2) / stride), top: desiredY });
  ```
- **Resize** (`useTileResize.ts`): capture `placement.y` at pointer-down as `anchorTop`.
  Expanding the tile must **keep that top fixed** and **displace conflicting neighbours
  around the fixed rectangle**, not raise the tile to their frontier.

### 6.3 Exclude the dragged/resized tile from the pack; float a placeholder
The active tile is removed from occupancy and rendered as a floating element that
follows the pointer (its imperative transform). A cosmetic placeholder rectangle marks
where it will land. All other tiles densely repack around the reserved rect. (Muuri
`dragPlaceholder` / Packery `.packery-drop-placeholder`.)

- **Product choice after the live rebuild pass: pointer-exact floating ghost.**
  `MasonryAnchor` remains the sole owner of COMMITTED transform/size and the source
  telemetry reads. The active tile's inner wrapper owns only a cosmetic imperative
  delta: exact pointer X/Y for drag and exact aspect-locked width/height/offset for
  resize. The occupancy footprint remains the snapped structural placeholder around
  which every neighbour packs. On release, retain the wrapper until the dense pack
  commits, rebase it against the new anchor, then animate its delta to zero. This keeps
  packer correctness and direct-manipulation feel as separate responsibilities.

### 6.4 Delete commit-adopt; add a non-stranding release state machine
Remove the `justEnded`/`ordersAligned` adopt branch and its tests. On release, run a
**real dense repack** (animated settle via the existing id-sorted CSS transition):
```text
active → settling(finalGeneration) → idle
```
- Flush the pointer-up coordinate, request the final obstacle pack, retain the
  imperative transform until that generation commits. If a newer authoritative pack
  supersedes it, that newer result clears `settling`. **Cannot strand** (either the
  final or a newer generation completes the transition). This restores density; the
  animation makes the settle read as a slide, not a jump.

### 6.5 Resize — all four corners, opposite-corner fixed
`useTileResize.ts`: the corner grabbed determines which edges move. **The opposite
corner stays fixed**; the grabbed corner follows the pointer.
- `br`: top-left fixed, grow right+down. `bl`: top-right fixed, grow left+down.
- `tr`: bottom-left fixed, grow right+**up**. `tl`: bottom-right fixed, grow left+**up**.
- "Up" growth is REAL now (via the occupancy model + the placeholder reserving the
  target rect and displacing the tiles above through the same solver) — not the
  deleted `offsetY` illusion. Reserve the target rectangle before drawing it; reflow
  all intersected tiles through the same occupancy solver; commit the exact preview
  snapshot.
- `useTileResize.test.ts:38` currently asserts top/bottom corners are identical —
  update it: corners now have distinct vertical semantics.

### 6.6 Worker request coalescing (prevents pointer-lag backlog)
`masonryPacker.ts` sends every request FIFO; generation checks discard stale *results*
but don't cancel stale *computation*. Change to **one in-flight request + one
replaceable "latest pending"**: when a result returns, dispatch only the newest
pending generation. Otherwise a 60fps drag over a 100k feed builds a worker queue and
the grid trails the pointer. Keep the worker for full recomputes; use a synchronous,
bounded dirty-region solve per changed target cell rather than a 100k global pass per
pointer frame.

### 6.7 File-level migration map
| Surface | Change |
|---|---|
| `masonryPacking.ts` (`MasonryPackInput`, pack loop) | Add occupancy (per-column interval) representation + `lowestFreeY`; pre-insert the gesture footprint; keep `colHeights` fast path for all-span-1/no-gesture. Replace `anchorIndex/startCol/edge/prevCols` with the `gestureFootprint` rect. Keep typed-array output + worker-crossability. |
| `useTileDrag.ts` | Remove 1D hover-splice ownership. Emit the 2D footprint for packing and write a pointer-exact active-wrapper delta; retain it through dense release settlement. |
| `useTileResize.ts` | Publish a rounded structural footprint while writing the exact pixel preview to the active wrapper; capture `anchorTop`; hold persistence and dense settlement before clearing. Corner-distinct vertical semantics. |
| `Masonry.tsx` | Replace the three composed states (working order, span override, column anchor) with ONE `previewLayout` / gesture footprint. Single geometry source. |
| `useMasonryEngine.ts` | Delete commit-adopt; add the `settling` state machine; accept the final preview snapshot synchronously; background recomputes replace it only when input revision + geometry contract match. Build the footprint (not prevCols) for the gesture pack. |
| `MasonryAnchor.tsx` / `MasonryItem.tsx` | `MasonryAnchor` owns committed transform/size and telemetry; `MasonryItem` exposes one registered inner wrapper for active-only cosmetic writes. |
| `masonryReorder.ts` | Demote array insertion to a commit-time ordering tie-break. The active target comes from spatial placement, not DOM overlap or feed-index distance. |
| `masonryPacker.ts` | One-in-flight + latest-pending request coalescing. |

---

## 7. TESTS THAT WOULD HAVE CAUGHT THIS (write these as regression tests)
Replace the diagnosis-only `*.repro.test.ts` with real regression tests asserting:
1. **No settled gap**: after any resize/move, no column has dead space below its
   frontier that a smaller tile could fill (occupancy has no fillable vacancy).
2. **Committed rect stays authoritative; ghost follows the pointer**: anchor data
   attributes equal the reserved pack rectangle, while the active wrapper equals the
   exact pointer-derived rectangle and rebases across pack commits without a screen-space jump.
3. **Resized tile preserves its top** for a same-column-height resize; for a
   taller-neighbour resize, neighbours displace rather than the tile rising to their
   frontier.
4. **Release cannot increase the settled gap/overlap count** (repack, not adopt-hold).
5. **No rectangle intersections** in any settled preview frame (replay the video
   dimensions + pointer paths from the telemetry).
6. **All four resize corners** grow with the opposite corner fixed.
7. The **21 steady-state equivalence tests still pass** (all-span-1 fast path unchanged).

---

## 8. HARD CONSTRAINTS (must all hold)
1. **Steady-state (non-gesture, all-span-1) pack output stays bit-identical** — the 21
   packing equivalence tests in `masonryPacking.test.ts` + the object-pack equivalence
   and prefix suffix-independence in `masonryGeometry.test.ts` must stay green. Achieve
   this by keeping the `colHeights` fast path for that case.
2. **Worker-crossable**: the pack runs in a Web Worker over numeric typed arrays
   (Float64Array/Int32Array), structured-clone/transfer boundary. The occupancy
   representation must cross as numbers (e.g. flat interval arrays), not object refs.
3. **100k-scale**: per-frame gesture cost bounded (dirty-region solve, not a full 100k
   pass per pointer frame); full recompute stays worker-side + throttled.
4. **Survives delta-merge + shuffle-on-entry** (images arriving mid-session, feed
   reshuffles) — the gesture transaction keyed by stable tile id, not array index.
5. **tsc clean; full vitest suite green** before done.

---

## 9. UPSTREAM SWEEP FINDINGS (18-hunter workflow + adversarial verify — COMPLETE)
26 agents (18 hunters + verifiers), 0 errors. **No upstream data defect — the packer
rebuild is the correct and sufficient layer.** Every non-packer subsystem was ruled
out with high confidence, and two packer-adjacent refinements were confirmed.

### 9.1 RULED OUT (high confidence — do NOT chase these)
- **Image dimensions** clean end-to-end (backend decode → atomic DB write of
  width+height+thumbnail_path together → `get_feed_manifest` → `mapFeedManifestRow` →
  `FeedItem`). Telemetry: all rendered aspects sane (1.6–1.78), zero 0/NaN/Infinity dims.
- **Backend queries** (`images_query.rs`) return width/height/manual_col_span verbatim,
  no placeholder substitution, no ordering/id-set mismatch.
- **Thumbnail dims** (`thumbnails.rs`/`generator.rs`) written atomically, aspect
  preserved across buckets; a NULL-dims row is gated out of the feed by `hasThumbnail`.
- **Worker** runs the identical pure function as the sync fallback → cannot change
  geometry.
- **Virtualization/culling**: telemetry recorded **ZERO mounts and ZERO unmounts across
  all reflows** → the black gaps are REAL PACKER GAPS (empty space), NOT culled/missing
  tiles. (This kills the "black boxes = unmounted tiles" hypothesis.)
- **Settings** (columnCount/tileScale) physically clamped at the input; no bad value
  reaches the pack.
- **Hero/selected tile** structurally isolated from drag/resize by two gates; clean.
- **`manualColSpan` persistence** clean for the main feed.
- **Build liveness** re-confirmed: both telemetry sessions are fresh Tauri boots
  running the reworked packing code.

### 9.2 CONFIRMED — fold into the fix (these SHARPEN the rebuild)
1. **The telemetry "overlaps" are a MEASUREMENT ARTEFACT — definitive** (multiple
   hunters + verifiers, holdsUp=TRUE). `captureGridGeometry`/the overlap test read the
   grabbed tile's `getBoundingClientRect`, which includes the follow-pointer
   `translate3d` transform, so the *floating* dragged tile reads as overlapping settled
   tiles. The pure packer's monotonic per-column frontier makes a settled overlap
   provably impossible. **⇒ There are NO real settled overlaps. The only real visible
   bug is GAPS (+ the floating tile reading messy over them).** The rebuild must (a)
   eliminate the gaps, and (b) fix the layout monitor to compare the *committed*
   geometry, not the live transform, so future diagnosis isn't misled.
2. **NEW confirmed bug — resize-commit async race** (holdsUp=TRUE, sharpened). In
   `useTileResize.handleUp` (`useTileResize.ts:276-294`): `commitRef.current(id,
   previewSpan)` fires `useSetManualColSpan.mutate` (an async optimistic cache patch)
   AND `setResizeState(null)` in the SAME synchronous tick. `resizeState` is the ONLY
   source of the resized tile's `spanOverrides` entry (`Masonry.tsx:123`). So between
   the state clear and the optimistic manifest patch landing, there is an intermediate
   render where the resized tile has **no span override → the packer packs it as 1×1**,
   and commit-adopt then freezes that wrong geometry. This is a distinct resize defect;
   the §6.5 `ResizeIntent`/atomic-commit fix must explicitly cover it: **the persisted
   span (via the mutation's optimistic patch) and the local preview clear must be
   sequenced so the tile never packs without its span** — commit the final span into
   the feed/optimistic cache BEFORE (or atomically with) clearing the preview, and do
   not adopt a geometry packed during the gap.
3. **Rendered height is never set from the packer** (`MasonryAnchor` sets only `width`;
   the `<img>` auto-sizes by aspect to its CSS width; the packer `height` is
   internal-only). Steady-state is geometrically perfect (render matches), so this is
   inert normally — but it makes the reserved rect ≠ rendered rect the moment
   `writeTileVisual` imperatively drives width during a resize. `MasonryAnchor` must
   therefore own explicit committed height as well as width; the active wrapper may
   temporarily diverge as the pointer-exact cosmetic ghost, but telemetry and
   occupancy continue to agree on the anchor rectangle.
4. **Latent hardening (defensive, never observed firing):** `masonryPacking.ts:367`
   `ratio = placedWidth / widths[i]` has no guard against `widths[i]===0` → `Infinity`
   height → poisons the whole column. And `images.ts:47-48` uses `??`, which does NOT
   catch a literal `0` (only null/undefined). Add a `> 0` guard at the packer and/or
   sanitise `0` dims at the mapping boundary.
5. **Minor (cosmetic):** a final hover-swap fired at pointerup
   (`useTileDrag.handleUp:314 → reorderOverPoint`) sets `workingOrderRef` but is then
   discarded — a spurious last-instant reorder. The §6.7 `masonryReorder` demotion
   should remove this.
6. **Separate latent (not this bug):** no EXIF-orientation handling anywhere — a
   portrait phone photo stored with EXIF rotation renders auto-rotated by WebKit while
   its stored dims are the raw (unrotated) ones, distorting inside a self-consistent
   box. Does NOT cause cross-tile gaps/overlaps; note for later, out of scope here.

### 9.3 Net effect on the plan
The packer rebuild (sections 6–8) stands unchanged as the core fix. Add: the
resize-commit sequencing fix (§9.2.2), MasonryAnchor owning height (§9.2.3), the
`width=0` guards (§9.2.4), and the monitor-reads-committed-geometry fix (§9.2.1) so
overlaps stop being mis-measured. There is NO upstream data prerequisite.

---

## 10. ACCEPTANCE CRITERIA (definition of done)
- Move an image of ANY size/dimension ANYWHERE at ANY velocity (including fast diagonal
  throws) with **zero** visual artefacts: no overlaps, no black gaps, no teleports;
  every displaced tile slides.
- Drag 2×2 and 3×3 tiles freely, displacing their footprint's worth of neighbours.
- Resize from **all four corners** (tl/tr/bl/br) cleanly, opposite corner fixed, no
  drop, no gap, neighbours reflow.
- The grid is **always dense** — during and after every gesture.
- Verified LIVE in the running WebView (`just lynceus-dev-telemetry`), with the layout
  monitor showing zero settled overlaps/gaps, cross-checked against a re-recorded video.
- All constraints in section 8 hold; the regression tests in section 7 pass.
