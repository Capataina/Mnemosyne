# src/services/

Typed Tauri-command clients, feed-delta logic, image/note/root services, and
service tests. This layer is the IPC boundary: it mirrors backend payloads and
converts errors; caching and optimistic state live in `queries/`.

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

## Invariants

- Mirror Tauri command payloads exactly; keep optimistic updates reconcilable with authoritative host state.
- `feedDelta.ts` is the canonical incremental feed-reconciliation boundary; preserve ordered, idempotent insert/remove handling and test out-of-order or repeated events.
- Telemetry keeps a flat snake_case event vocabulary and remains opt-in with zero overhead when disabled.

## Traps

- The profiling flag is `--profiling`; a doc comment in perf.ts still says
  `--profile`, which is exactly the cargo-colliding spelling that does NOT
  work. Trust `src-tauri/src/main.rs` and the `just lynceus-dev-telemetry`
  recipe.
- Identity preservation in mergeFeedDeltaRows is a performance contract, not a
  style choice — replacing untouched entries re-renders every tile during
  indexing churn.
