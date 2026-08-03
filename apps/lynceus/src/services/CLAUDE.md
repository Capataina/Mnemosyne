# src/services/

Typed Tauri-command clients, feed-delta logic, image/note/root services, and service tests. This layer is the IPC boundary: it mirrors backend payloads and converts errors; caching and optimistic state live in `queries/`.

## Map

```
services/
├── images.ts         Feed manifest + detail fetch (mapFeedManifestRow), thumbnail
│                     resolution, fused similar/semantic fetches, folder picker, manual
│                     spans, orphan purge. Un-thumbnailed placeholder is 1:1 400×400
│                     (deliberate: minimal reflow either way; was 4:3, caused jank).
├── feedDelta.ts      Canonical incremental feed reconciliation: mergeFeedDeltaRows patches
│                     ONLY the unfiltered manifest (UNFILTERED_MANIFEST_KEY); filtered
│                     manifests are invalidated instead because a delta row's tag
│                     membership is unknown. Delta rows omit manual_col_span, and the merge
│                     preserves the cached span — a re-thumbnail can never wipe a resize.
├── feedDelta.test.ts Merge must equal a fresh refetch (membership, order, values) while
│                     preserving object identity for untouched entries — memo comparators
│                     and the shuffle fast path key off identity.
├── apiError.ts       Backend ApiError discriminated union (kind/details) + guard for
│                     legacy string errors; lets the UI branch on failure kind.
├── roots.ts          list/add/remove/set-enabled root commands.
├── tags.ts           Tag CRUD + getTagCounts (per-tag counts under the grid's visibility
│                     predicate, so folder numbers match what opening one shows).
├── notes.ts          Per-image free-text notes; "" and NULL collapse to none backend-side.
├── stats.ts          get_pipeline_stats → PipelineStats (mirrors db/images_query.rs).
├── perf.ts           Profiling IPC: isProfilingEnabled (cached; the CLI flag is
│                     --profiling), recordAction timeline appends (no-op when off),
│                     perfInvoke wrapper, snapshot/reset/export for PerfOverlay.
├── telemetry.ts      Telemetry v2 automatic capture: interactions with ancestor DOM
│                     paths, errors/rejections/console tee, image + slow-resource
│                     observability, ⌘⇧M / on-error state bundles (query keys + status,
│                     never data; typed text never captured). Profiling mode only;
│                     nothing leaves the machine.
├── telemetry.test.ts Capture-layer contracts.
└── services.test.ts  IPC wrapper tests over the shared mockInvoke.
```

## Telemetry architecture (decided 2026-07-17)

The profiling system is deliberately split: the **sink lives in the engine** (`crates/engine/src/perf.rs` + `perf_report.rs` — timeline, JSONL flush, on-exit report), the **capture layer is app-local** (`perf.ts`, `telemetry.ts`, `components/PerfOverlay.tsx`), and the **event vocabulary is per-app by design** — breadcrumb names live at call sites, this layer stays generic. Do NOT extract the TS capture layer into a shared workspace package while it has one consumer; the trigger is the session that scaffolds Syrinx lifting `perf.ts` + `PerfOverlay` into `packages/` in the same pass (the pnpm workspace was adopted partly for this). Until then: keep `perf.ts` free of app-specific logic, use consistent event names when instrumenting new surfaces (timer setup panel and pill controls are currently uninstrumented). Boundary: this is local, opt-in diagnostics written to the user's own disk — never conflate with phone-home product analytics, which would be a separate consented system.

`perfInvoke` is opt-in per call site, not an automatic interceptor — a global interceptor would profile every IPC including uninteresting ones; the explicit wrapper makes profiling intent visible where it's used. `recordAction` breadcrumbs are fire-and-forget (awaiting the IPC would add latency to every user-action handler for nothing); the backend correlates the next ≤500ms of span activity to each action in the on-exit report.

## The masonry layout monitor

The telemetry surface that made reflow bugs observable rather than guessed (the instrument behind the teleport and reorder-drift fixes, 91564f0/e3adc2e). Event-armed, never free-running: capture-phase pointerdown/held-pointermove arm it for gestures, a masonry-scoped MutationObserver catches non-pointer reflows (feed-delta merges). It samples every second animation frame while motion is live or was seen within 1.5s, then stops completely — the earlier free-running version read every visible tile at 60fps forever, allocated fresh maps per frame, and interleaved geometry with computed-style reads, both costing frames and manufacturing the jank it reported. It emits ONE `reflow` event per reflow (after ~6 still frames): trigger context, per-tile `moved` list with a `classifyMove` verdict, mounted/unmounted ids, `teleportCount`, and a settled geometry snapshot. The teleport threshold is capped at 0.75 of the displacement per two-frame sample, not 1.0 — requiring the entire displacement in one sample silently missed teleports diluted by co-occurring motion (detection SENSITIVITY changes with sampling cadence, not just cost; 0.75 sits above the steepest smooth ease's measured ~59%-per-sample peak). It reads committed geometry from `data-masonry-*` attributes, never live visual transforms. Reading traps that each cost a wrong diagnosis once: gap events' `above`/ `below` are tile IDS, not y-coordinates; a left-edge-binned gap detector is blind to span-2 tiles (the phantom "306px gaps").

## Invariants

- Mirror Tauri command payloads exactly; keep optimistic updates reconcilable with authoritative host state.
- `feedDelta.ts` is the canonical incremental feed-reconciliation boundary; preserve ordered, idempotent insert/remove handling and test out-of-order or repeated events.
- Telemetry keeps a flat snake_case event vocabulary and remains opt-in with zero overhead when disabled. Privacy is enforced in code and test-locked: plain typing into editable targets is never recorded; descriptors and DOM outlines never read form-control values.

## Traps

- The profiling flag is `--profiling`; a doc comment in perf.ts still says `--profile`, which is exactly the cargo-colliding spelling that does NOT work. Trust `src-tauri/src/main.rs` and the `just lynceus-dev-telemetry` recipe.
- Identity preservation in mergeFeedDeltaRows is a performance contract, not a style choice — replacing untouched entries re-renders every tile during indexing churn.
- The filtered-vs-unfiltered split is deliberate: a delta row's tag membership is unknown client-side, so patching a filtered manifest could show an image that doesn't match the filter — filtered queries are invalidated instead, keeping "a filter always acts on what you can see" honest. But the `isUnfiltered` predicate hardcodes the key shape `["feed-manifest", [], false, []]`: adding a fourth filter dimension to `useFeedManifest`'s key without updating it would silently misclassify the new dimension as unfiltered and patch it with unknown-membership rows. No test pins this against a hypothetical extra key segment.
- Deltas deliberately omit `manual_col_span` at the TYPE level (`Omit<…, "manual_col_span">`): a delta only asserts "this image now has a thumbnail with these dims" — carrying the field would tempt a merge-path write that clobbers a persisted resize on re-thumbnail; the type makes that a compile error instead of runtime data loss.
- New-id inserts merge at the id-sorted position via one linear merge (sort the small batch, one O(N + k log k) splice) so a delta-patched cache and a fresh refetch produce the identical array.
- **Error dialect 1 renders `${error}` on ApiError objects** — `Failed to list roots: [object Object]` is the live failure mode for the roots/tags/notes wrappers. Converging onto `formatApiError` was audited and KILLED as not-free (it changes user-visible message text that services.test.ts pins) — fixing it is a real UX change to schedule deliberately, not a cleanup. [code-health-audit 2026-08-02]

## Planned work

- **Delete the ~85-line legacy export block in `images.ts`** (dead code; refuter-proven in a worktree: block + its three orphaned `services.test.ts` assertions deleted → `tsc --noEmit` exit 0, suite 247/247). The five symbols (`getScanRoot`, `setScanRoot`, `fetchSimilarImages`, `fetchTieredSimilarImages`, `semanticSearch`) have zero non-test importers; Tauri registration is independent (`src-tauri/src/lib.rs:596-602`), so nothing deregisters; `mapImageSearchResult`/`perfInvoke` stay alive via the fused functions. This is the TS half of the cross-crate legacy-surface removal — the Rust half and the full batch live in `src-tauri/src/commands/CLAUDE.md`'s planned work; land together. [code-health-audit 2026-08-02]
- **Split `telemetry.ts` (915 lines) at its own header-drawn seam** (modularisation; gate-promoted): the ~466-line masonry-monitor half (lines 197-663) moves out; coupling proven one-directional (zero generic-half symbols referenced in the monitor half; `monitorContext` is self-defined). Reference batch: `App.tsx:12` (initTelemetry, stays), `services/telemetry.test.ts:13` (four masonry names move import lines). Distinct from the documented Syrinx package-lift trigger — this is the app-local split the file's own header comment (197-206) plans for. Settle: suite + a `--profiling` overlay smoke. [code-health-audit 2026-08-02]
- Pointer: the tree-wide zero-importer batch in `../CLAUDE.md` un-exports `tileUnderPoint` in `telemetry.ts` — land with that batch, not separately.
