# gesture-timer

*Maturity: working · Stability: unstable*

## Scope / Purpose

A figure-drawing practice mode: starting from an image the user is inspecting, cycle
through a sequence of similar images on a fixed interval, giving the user a fixed amount of
time to sketch each one before it advances — the classic "gesture drawing" timed-reference
exercise, built on top of the app's own similarity search instead of a separate curated
image set.

Two entry points exist into the same running session component: an inline setup panel
docked in the image inspector's right panel, and a compact "quick-start" pill overlaid on
the selected hero tile in the main grid. Both produce an identical `GestureTimerConfig` and
hand it to the same `GestureTimer` orchestrator, which is the sole owner of whether a
session is running.

The timer UX was overhauled once already (`fcad704`, following the initial build in
`e60fb70`): the original two-step flow (a "Start timer" button under the fullscreen image,
opening a separate config dialog) was deleted outright in favour of the inline-setup +
quick-start-pill shape described here.

## Boundaries / Ownership

- **Owns:** session sequencing (which image is current, how the sequence is built and
  advances), interval countdown, pause/resume/restart, the running fullscreen overlay UI,
  the inline setup UI, the quick-start pill UI, config validation/normalisation, one-shot
  predecode of the next reference image.
- **Does not own:** where `candidateImages` comes from (delegates entirely to the caller —
  in practice the tiered-similarity-search results computed by `pages/[...slug].tsx`; see
  `search-routing`), the inspector panel it's docked inside (`PinterestModal` owns layout,
  tags, and notes around it), the hero tile it overlays (`masonry-layout` owns mounting
  `heroOverlay` and the CSS hover/focus reveal), tag/note persistence, image loading
  infrastructure beyond its own predecode helper.
- **Public API (top-level):** `<GestureTimer startingImage candidateImages
  initialConfig? autoStart? className? disabled? onOpenChange? />` — see `types.ts` for the
  full shape. Also individually exported: `GestureTimerConfigPanel`, `GestureTimerView`, and
  the pure `session.ts` functions (`createDefaultGestureTimerConfig`,
  `normaliseGestureTimerConfig`, `mergeGestureTimerConfig`, `getEligibleCandidates`,
  `formatTimerDuration`).

## Current Implemented Reality

### File map

```
features/gesture-timer/
  types.ts                    — GestureTimerConfig, *Image, *SessionLength, *Props, RankRange
  session.ts                  — pure config defaults/normalisation/merge + sequence building
  useGestureTimer.ts           — the running session's state machine (sequence, countdown, nav)
  GestureTimer.tsx             — top-level orchestrator: owns config/running state, wires the
                                 three UI pieces below, the autoStart adoption effect
  GestureTimerSetup.tsx        — inline setup UI (lives in the inspector's right panel)
  GestureTimerView.tsx         — the running fullscreen session (portal-mounted)
  useGestureZoom.ts            — the running view's zoom/pan interaction hook (e31a809)
  GestureTimerConfigPanel.tsx  — the "adjust settings" overlay reachable from a RUNNING session
  GestureTimerProgress.tsx     — the circular countdown ring in the running view's header
  gesture-timer.css            — session-scoped CSS custom properties (--gesture-*)
  index.ts                     — public exports
components/SelectedImageTimerPill.tsx  — the hero-tile quick-start pill (separate from this folder)
```

### The running view's stage and zoom (e31a809)

The running view treats the reference as the viewport surface, not an image inside a padded
dialog: the stage is `inset-0` (the old `px-5 py-24` reservation and `calc(100dvh-9rem)`/`92vw`
caps are gone) and all chrome floats over the artwork — countdown ring top-centre in a frosted
shell, a bottom-left identity plaque (mineral-cyan reference counter + filename), controls
bottom-centre, and a zoom readout bottom-right only while away from fit. `useGestureZoom` owns
the full zoom model: wheel-toward-cursor, macOS trackpad pinch (ctrlKey-wheel), WebKit native
`gesturestart/change/end`, two-pointer touch pinch, drag-to-pan with edge clamping,
double-click/double-tap fit↔1:1, and `+`/`-`/`0` keys. Continuous transforms are written to the
element via refs — React re-renders only on the fit↔zoomed boundary (the same
transform-ownership discipline as `889b765`'s masonry gesture layer) — and a `useLayoutEffect`
resets zoom before paint on image advance so the incoming reference never flashes a stale
transform. The keyed `<img>` also carries a commit-time `markReadyIfComplete` ref callback
(`5ce6581`): a predecoded reference can be complete at mount, and WebKit may never deliver an
observable `load` event for it — without the callback the view's load-gated opacity left the
image permanently invisible (the "blank second image" bug).

### Config shape

```ts
type SimilarityRankRange = { min: number; max: number };  // 1-based, inclusive
type GestureTimerSessionLength =
  | { mode: "count"; count: number }
  | { mode: "continuous" };
type GestureTimerConfig = {
  intervalSeconds: number;
  similarityRange: SimilarityRankRange;
  sessionLength: GestureTimerSessionLength;
  repeatAllowed: boolean;
};
```

`session.ts` owns three related-but-distinct config functions, each with a specific caller:

- `createDefaultGestureTimerConfig(candidateCount)` — sensible defaults scaled to how many
  candidates exist (interval 60s; similarity range defaults to ranks 5-25, or 1-N if fewer
  than 5 candidates exist; session count clamped to `[2, 10]` bounded by eligible-candidate
  count).
- `normaliseGestureTimerConfig(config, candidateCount)` — clamps an arbitrary (possibly
  user-edited, possibly stale) config against the *current* candidate count: similarity
  ranks clamp into `[1, candidateCount]`, a `"count"` session length clamps into `[2,
  eligibleCount+1]` (or `[2, 999]` if repeats are allowed). Called every time a session is
  about to actually start, so a stale config (candidate count changed since it was built)
  can never request more images than exist.
- `mergeGestureTimerConfig(initialConfig, candidateCount)` — layers a partial
  `initialConfig` over the defaults, then normalises. Used whenever a component needs "start
  from defaults, but respect anything already specified."

`getEligibleCandidates` slices `candidateImages[min-1 .. max]` (converting the 1-based rank
range to a 0-based slice) and de-duplicates against the starting image's own id.
`buildGestureTimerSequence` then builds the actual image sequence from that eligible set:
non-repeat sessions shuffle once and slice to length; repeat-allowed sessions pick randomly
one image at a time, only constrained to avoid immediately repeating the previous image.

### `useGestureTimer` — the running session's state machine

Holds `sequence: GestureTimerImage[]`, `currentIndex`, `remainingMs`, `isRunning`,
`isComplete`. The countdown runs on a 100ms `setInterval` measured against
`performance.now()` (not a naive per-tick decrement), so drift from tab-throttling or a slow
frame doesn't accumulate. `suspended` (driven by the caller — see below) freezes the
countdown without resetting it.

**Continuous+repeat mode picks the next image randomly at advance time, not upfront** — this
is a deliberate, documented limit, not an oversight: `buildGestureTimerSequence` returns a
one-element sequence (`[startingImage]`) for `continuous + repeatAllowed`, and `next()`
appends one more `pickRandomImage(...)` pick to the sequence array each time the user
advances past the current end. Every OTHER combination (`count` mode, or `continuous`
without repeats) builds its full sequence upfront and is therefore fully known in advance.

**Predecode consequence:** `nextImageUrl` (exposed for the view's predecode effect) is
`sequence[currentIndex + 1]?.url` — deterministic and available ahead of time for every mode
except the continuous+repeat tail, where it is honestly `undefined` (nothing to predecode
because the next pick genuinely doesn't exist yet). `GestureTimerView`'s predecode effect
handles this correctly: it just predecodes nothing when `nextImageUrl` is undefined, rather
than guessing.

`next()` also handles session completion: if the sequence has run out and the session can't
expand (not continuous+repeat), it sets `isComplete = true` and stops the countdown rather
than erroring or looping silently.

### `GestureTimer.tsx` — the orchestrator

Owns `config` (committed) vs `draftConfig` (being edited, either in the inline setup or the
running-session settings overlay) as separate state, plus `running`, `configOpen`, and a
`sessionKey` that increments on every fresh start/restart (used to force-remount
`GestureTimerView`, resetting all its internal state cleanly).

`overlayOpen = configOpen || running` drives a body-scroll-lock effect — either the running
session or the settings overlay showing is enough to lock background scroll.

A candidate-count-changed effect re-derives `config`/`draftConfig` from
`mergeGestureTimerConfig` whenever `candidateImages.length` changes **and** no session is
currently running or being configured — so the similarity results refreshing underneath an
idle setup panel keeps the defaults sane, but never yanks the rug out from under an
in-progress session.

**Autoscopy: `configOpen` is only ever set `true` from `openRunningConfig`, which is only
reachable via `GestureTimerView`'s "settings" button — which only renders while a session is
already `running`.** There is no code path in the current wiring that opens
`GestureTimerConfigPanel` while `running` is false. Consequently `mode={running ? "restart"
: "start"}` passed to `GestureTimerConfigPanel` is effectively always `"restart"` today — the
`"start"` branch (different copy: "Set up timer" / "Start session" vs "Adjust timer" /
"Apply and restart") is real, tested-against code but currently unreachable given how
`GestureTimer` wires things up. This is a leftover from the pre-`fcad704` two-step flow,
where the config dialog *could* open before a session started; the inline `GestureTimerSetup`
now owns that pre-start step instead, and nothing routes back to the "start" mode of the
overlay. See Known Issues.

### The autoStart (quick-start pill) path

```ts
useEffect(() => {
  if (!autoStart || appliedAutoStartRef.current === autoStart) return;   // one start per identity
  if (running || configOpen || candidateImages.length === 0) return;
  appliedAutoStartRef.current = autoStart;
  const nextConfig = normaliseGestureTimerConfig(autoStart, candidateImages.length);
  setConfig(nextConfig); setDraftConfig(nextConfig);
  setRunning(true); setSessionKey(key => key + 1);
  onOpenChange?.(true);
}, [autoStart, candidateImages.length, configOpen, onOpenChange, running]);
```

Keyed on **object identity**, not value equality — `appliedAutoStartRef` guards against
re-firing for the same config object across re-renders, so exactly one session starts per
distinct `autoStart` object handed in. The route (`pages/[...slug].tsx`) is responsible for
guaranteeing that identity is fresh only when a genuinely new quick-start happened:

```ts
// pages/[...slug].tsx
const [pendingTimerStart, setPendingTimerStart] = useState<GestureTimerConfig | null>(null);
useEffect(() => { setPendingTimerStart(null); }, [selectedItem?.id]);   // selection change clears it
const handlePillStart = useCallback((config) => {
  setPendingTimerStart(config);
  setIsInspecting(true);                                                // opens the inspector too
}, []);
```

`pendingTimerStart` is cleared on selection change specifically so a stale config object can
never fire a session against a *different* image than the one it was built for — the guard
lives at the route level (clearing the ref's target), not inside `GestureTimer` itself.

### `SelectedImageTimerPill` (`components/SelectedImageTimerPill.tsx`)

Mounts as the `heroOverlay` on the selected hero tile (see `masonry-layout`), overlapping
the tile's bottom edge, revealed only on hover/focus-within of the hero wrapper
(`data-selected-hero` drives the CSS reveal in `App.css`). Holds its **own** local
`GestureTimerConfig` draft (seeded via `mergeGestureTimerConfig`, re-normalised whenever
`similarCount` changes) so the pill is fully interactive before a session ever starts —
seconds-per-image, an infinite/continuous toggle, compact min-max similarity rank inputs, a
count input (hidden in continuous mode), and a start button. `stopHeroActivation` on every
pointer/click event inside the pill prevents a pill interaction from also selecting/
navigating the hero tile underneath it. `onStart` hands `normaliseGestureTimerConfig(config,
similarCount)` up to the route's `handlePillStart` — the pill and the inline
`GestureTimerSetup` panel share the exact same merge/normalise functions from `session.ts`,
so both paths are guaranteed to produce configs the timer treats identically.

### `GestureTimerSetup.tsx` — inline inspector setup

Lives at the bottom of the inspector's right panel (`PinterestModal`, mounted directly as
`<GestureTimer startingImage candidateImages autoStart>` — `GestureTimer` itself renders
`GestureTimerSetup` inline as its first return value, always, regardless of running state).
Full controls: interval (numeric + 4 presets: 30s/60s/2m/5m), session length (count vs
continuous toggle, count input with a dynamic max), similarity rank range (two numeric
inputs), a repeat-allowed switch, a live "N images in about M:SS" / "Runs until you exit" /
"Uses N unique images" summary line, and a Start button disabled unless `intervalIsValid &&
rangeIsValid && countIsValid` (each independently computed and independently surfaced as an
inline validation message).

### `GestureTimerView.tsx` — the running fullscreen session

Portal-mounted to `document.body` (via `createPortal` in `GestureTimer.tsx`) so it always
renders above everything regardless of where `GestureTimer` itself lives in the tree.
`role="dialog" aria-modal="true"`, focus-trapped only loosely (focuses the root on mount and
whenever settings close). Controls auto-hide after 2.6s of no pointer movement/keyboard
input (`revealControls`/`clearIdleTimer`), except while paused, the settings overlay is open,
or the current image hasn't finished loading. Keyboard: Space toggles pause, ArrowLeft/Right
navigate, Escape exits — all suppressed while focus is on an interactive element inside the
view or while the settings overlay is open.

**One-deep next-image predecode:** `predecodeImage(url)` constructs an off-screen `Image`,
calls `.decode()` (swallowing `AbortError`, which is expected on rapid navigation, while
logging any other decode failure), and the returned element is held in a ref for the
duration — dropping the reference lets the decoded bitmap be reclaimed. This warms exactly
one image ahead (`timer.nextImageUrl`), re-triggered every time the current image advances;
see `useGestureTimer` above for why this is sometimes `undefined` (continuous+repeat tail).

**Image status state machine** (`"loading" | "ready" | "error"`) resets to `"loading"` every
time `timer.currentImage.id` changes, independent of the predecode above — the visible
`<img>` element still does its own `onLoad`/`onError`, so a predecode miss (or a session
where predecode simply hasn't happened yet) degrades to a normal decode rather than a stuck
skeleton. The countdown is `suspended` (via `useGestureTimer`'s `suspended` param) while
`imageStatus !== "ready"`, so the interval doesn't burn down while the image is still
loading.

Session completion renders an in-place "Session complete" panel with Exit / Restart actions
rather than auto-closing — the user chooses whether to leave or run the same setup again.

### `GestureTimerConfigPanel.tsx` — the running-session settings overlay

A full re-implementation of the same config surface as `GestureTimerSetup` (interval,
session length, similarity range, repeat toggle) but as a portal-mounted overlay reachable
from within `GestureTimerView`'s controls bar (the sliders icon). Takes a `mode: "start" |
"restart"` prop that only changes copy ("Set up timer"/"Start session" vs "Adjust timer"/
"Apply and restart") — see the Autoscopy note above for why `mode="start"` is currently
unreachable in practice.

## Key Interfaces / Data Flow

### Inputs

| Source | Provides |
|--------|----------|
| `pages/[...slug].tsx` → `PinterestModal` | `startingImage` (the inspected image), `candidateImages` (`timerCandidates`, from tiered similarity search — see `search-routing`), `autoStartTimer` (the pending quick-start config, or `null`) |
| `SelectedImageTimerPill` (mounted via `masonry-layout`'s `heroOverlay`) | its own locally-configured `GestureTimerConfig`, handed up through `onStart` → the route's `handlePillStart` → `pendingTimerStart` → `GestureTimer`'s `autoStart` prop |
| User interaction (inline setup, running-session settings, the pill) | every field of `GestureTimerConfig` |

### Outputs

| Destination | What |
|-------------|------|
| `onOpenChange?(open)` | Notifies a host when a session opens/closes — verified unused at the actual mount site: `PinterestModal` passes only `startingImage`, `candidateImages`, and `autoStart` to `<GestureTimer>`, so this callback is currently dead from the outside; internally `GestureTimer` still calls it on start/stop, so a future caller can opt in with no change to this component. |
| The DOM (via portal) | The fullscreen running view, or the settings overlay, mounted at `document.body` |
| Nothing persists to the backend | Every config field, the sequence, and progress are ephemeral React state — a session leaves no DB row and is fully gone once `GestureTimerView` unmounts. |

## Implemented Outputs / Artifacts

- 7 components/hooks + 1 pure module: `GestureTimer`, `GestureTimerSetup`,
  `GestureTimerView`, `GestureTimerConfigPanel`, `GestureTimerProgress`, `useGestureTimer`,
  `session.ts`, plus `SelectedImageTimerPill` (outside the feature folder, mounted through
  `masonry-layout`).
- Test coverage: `useGestureTimer.test.ts` (sequence/advance/predecode-url behaviour),
  `GestureTimer.test.tsx` (start-without-dialog and disabled-on-empty-candidates, added
  alongside the `fcad704` rewiring).
- Dedicated CSS custom-property scope (`gesture-timer.css`, `--gesture-*` tokens) layered
  on top of the app-wide v2 design tokens.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| `GestureTimerConfigPanel`'s `mode="start"` branch is currently unreachable | `GestureTimer`'s wiring only ever opens the panel via `openRunningConfig`, which requires `running` to already be true | Dead-but-tested code: the "Set up timer" / "Start session" copy variant has no live entry point. Not a correctness bug (nothing crashes), but a maintainer changing `GestureTimer`'s open-state wiring should know this branch exists and was reachable pre-`fcad704`, not that it's speculative/future work. |
| Continuous+repeat's next image is picked at advance time, so nothing can predecode ahead of it | A user in continuous+repeat mode reaching the end of the currently-built sequence | The advance to a not-yet-decoded image pays a real decode instead of swapping to a warm bitmap — a deliberate, documented trade (the alternative would require picking and predecoding speculatively, which conflicts with "genuinely random, no-repeat-of-previous" semantics). |
| Session state is entirely client-side and ephemeral | App restart, or even just navigating away from the inspector while a session runs (session unmounts with the modal) | No "resume my last gesture session" capability exists, by design — this is a lightweight practice-mode utility, not a tracked training log. |
| `SelectedImageTimerPill` and `GestureTimerSetup` are two independently-rendered config UIs over the same `GestureTimerConfig` shape | A future change to `GestureTimerConfig` (a new field) | Both call sites need updating in lockstep — they share `session.ts`'s merge/normalise functions (so *behaviour* stays consistent) but not the actual input markup (so a new field needs new inputs added to BOTH components by hand). |
| `disabled` and `onOpenChange` props are unused at the only real mount site | `PinterestModal` passes just `startingImage`, `candidateImages`, `autoStart` to `<GestureTimer>` — `disabled` defaults to `false` and `onOpenChange` is never supplied | `setupDisabled = disabled \|\| candidateImages.length === 0` still correctly disables the inline setup when there are zero candidates (the `candidateImages.length === 0` half does the real work today); the explicit `disabled` prop and the `onOpenChange` notification are live, tested surface with no current caller — safe to build on, not dead code, just unexercised in production today. |

## Partial / In Progress

None currently tracked as in-flight for this subsystem.

## Planned / Missing / Likely Changes

- No forward-looking roadmap items are recorded for this subsystem as of this pass; the
  `fcad704` rewrite frames itself as the completed UX overhaul, not a stepping stone to a
  further planned change. If a future session log names one, capture it here.

## Durable Notes / Discarded Approaches

- **Two-step flow (trigger button + separate config dialog) deleted, not iterated on**
  (`fcad704`). `GestureTimerTrigger.tsx` (the old "Start timer" button under the fullscreen
  image) was removed outright; inline setup in the inspector's right panel and the
  quick-start pill replaced it as the two entry points. The running session's own
  pause/adjust/restart overlay (`GestureTimerConfigPanel`) was deliberately KEPT — it
  belongs to a live session, and only the *initial* setup step moved inline.
  Cross-family-executor provenance: a GPT-driven pass (via the Codex harness) built the
  presentational surfaces (`GestureTimerSetup`, the redesigned inspector panel, the
  quick-start pill markup) against a packed brief that forbade touching the route; the
  route-side wiring (autoStart plumbing, `pendingTimerStart`, threading the pill through
  `masonry-layout` as a memoised `heroOverlay`) was done separately by the orchestrating
  session, because the route was mid-rewrite by the concurrent perf round when the executor
  ran.
- **The pill and the inline panel share `session.ts`'s pure functions, not just similar UI.**
  Deliberate: guarantees a config built via either path is normalised identically, even
  though the two components have entirely separate input markup and separate local draft
  state.
- **`sessionKey` remount over in-place session reset.** Incrementing a key and remounting
  `GestureTimerView` on every start/restart is simpler and more robust than manually
  resetting every piece of `useGestureTimer`'s internal state — a fresh mount is a fresh
  state machine by construction.
- **`performance.now()`-anchored countdown over a naive per-tick decrement.** Measuring
  elapsed time against a fixed start timestamp on each 100ms tick avoids drift accumulation
  from tab throttling or a slow frame; a naive `remainingMs -= 100` per tick would
  systematically run slow under any scheduling pressure.
- **One-element sequence + at-advance-time random pick for continuous+repeat**, over
  building and periodically extending a longer lookahead buffer. Keeps the "never
  immediately repeat the previous image" invariant trivially true (`pickRandomImage` filters
  out only the immediately-previous id) at the cost of the predecode gap noted above.

## Obsolete / No Longer Relevant

- `GestureTimerTrigger.tsx` and its associated second-menu config dialog flow — deleted in
  `fcad704`; superseded by inline setup + the quick-start pill.
- The two-click "open fullscreen image → find Start Timer button → configure in a dialog →
  actually start" path — collapsed to either "configure inline in the inspector, click
  Start" or "click Start directly on the quick-start pill."

Cross-link: the hero tile `SelectedImageTimerPill` mounts on (`heroOverlay`,
`data-selected-hero`), and the memoisation contract that keeps the pill's identity stable
across re-renders, live in `systems/masonry-layout.md`. Where `candidateImages`/
`timerCandidates` (the tiered similarity-search results) come from, and the selection/
inspector-open flow that the quick-start pill's `handlePillStart` also drives
(`setIsInspecting(true)`), live in `systems/search-routing.md`. `PinterestModal`'s broader
panel layout this subsystem is docked inside (tags, notes, the redesigned right-panel column
from `fcad704`) lives in `systems/frontend-state.md`.
