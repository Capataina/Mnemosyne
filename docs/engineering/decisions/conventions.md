# conventions

This file captures patterns that are recurrent in the codebase and not enforced by any tool. New code should follow these unless there is a documented reason to deviate.

## Tracing instrumentation

Every Tauri command, every indexing-pipeline phase, every long-running backend operation gets a `tracing::info_span!` or `#[tracing::instrument]` annotation. Span names follow these prefixes:

| Prefix | Used for | Example |
|--------|----------|---------|
| `ipc.` | `#[tauri::command]` handlers | `#[tracing::instrument(name = "ipc.semantic_search", skip(...))]` |
| `pipeline.` | Indexing pipeline phases | `tracing::info_span!("pipeline.scan_phase").entered()` |
| `cosine.` | Cosine retrieval methods + populate | `#[tracing::instrument(name = "cosine.populate_from_db", skip(...))]` |
| `model_download.` | Model download HTTP work | `model_download.all`, `model_download.head`, `model_download.file` |
| `watcher.` | Filesystem watcher | `watcher.start`, `watcher.event` |

Levels: `info` for spans + state transitions, `debug` for per-result detail (e.g., the top-5 results inside semantic_search), `warn` for non-fatal failures (e.g., a thumbnail decode that fails for one image), `error` for fatal pipeline failures.

The previous `[Backend] ...` `println!` convention is gone. New code should not introduce new `println!`-shaped logging.

The profiling system (`systems/profiling.md`) consumes these spans via `PerfLayer` — adding `#[tracing::instrument]` to a new function automatically gives it perf attribution under `--profiling`.

## Domain diagnostics via `record_diagnostic`

Spans answer "how long?". Domain diagnostics answer "what was the system actually doing?" — embedding L2 norms, tokenizer outputs, score distributions, encoder run summaries. The pattern is widespread (17 call sites across `commands/`, `indexing.rs`, `lib.rs`, `cosine/index.rs` as of 2026-04-26):

```rust
crate::perf::record_diagnostic(
    "diagnostic_name",
    serde_json::json!({
        "encoder_id": "siglip2_base",
        "field_a": ...,
        "field_b": ...,
        "interpretation": if condition_a {
            "OK — normalised unit vector"
        } else if condition_b {
            "WARNING — near-zero norm; encoder produced degenerate output"
        } else {
            "BROKEN — NaN/Inf in embedding"
        },
    }),
);
```

Conventions:

- **Diagnostic name** is `snake_case` with no prefix — they are first-class artifacts in the perf report's `## Diagnostics` section.
- **Always include an `encoder_id` field** when the diagnostic is per-encoder so the report can group across all three.
- **Include an `interpretation` field** with a short human-readable verdict (`"OK"` / `"WARNING — ..."` / `"BROKEN — ..."`). The detailed numbers are for follow-up; the interpretation is what someone reading the report scans first to decide whether to dig deeper.
- **No-op when `--profiling` absent** — the function returns early without building the JSON. Cheap to call from any code path.
- **Emit at the call site, not via tracing** — diagnostics are richer than fields-on-a-span and fire selectively (per-search, per-cache-load, once-per-session). Use `#[tracing::instrument]` for timing; use `record_diagnostic` for content.

The full diagnostic catalogue lives in `systems/profiling.md` § Domain diagnostics.

## Mutex acquire-then-execute

Every `ImageDatabase` method follows the same shape (~30 lock sites across `db/`):

```rust
self.connection.lock().unwrap().execute("SQL", params)?;
```

The `.unwrap()` is intentional — the project treats Mutex poisoning as unrecoverable; a panic with the lock held should bring down the session and force a restart. See `notes/mutex-poisoning.md`. Match this pattern for new DB methods.

For Tauri command bodies that need to lock cosine / text-encoder / indexing state, use `?` instead of `unwrap`:

```rust
let mut idx = cosine_state.index.lock()?;          // From<PoisonError> in ApiError handles it
```

The `From<PoisonError<T>> for ApiError` impl maps poisoning to `ApiError::Cosine("mutex poisoned: ...")`. The user gets a typed signal instead of a panic.

## Typed errors via `?` and `From`-impls

Every Tauri command returns `Result<T, ApiError>`. Bodies use `?` directly:

```rust
#[tauri::command]
pub fn get_tags(db: State<'_, ImageDatabase>) -> Result<Vec<Tag>, ApiError> {
    Ok(db.get_tags()?)   // From<rusqlite::Error> handles the conversion
}
```

`From`-impls in `commands/error.rs` cover:
- `rusqlite::Error` → `ApiError::Db` (with `QueryReturnedNoRows` → `ApiError::NotFound`)
- `std::io::Error` → `ApiError::Io`
- `std::sync::PoisonError<T>` → `ApiError::Cosine("mutex poisoned: ...")`

For specific failure modes that don't map cleanly, construct the variant explicitly:

```rust
return Err(ApiError::TextModelMissing(model_path.display().to_string()));
return Err(ApiError::BadInput(format!("Not a directory: {path}")));
```

The frontend's `services/apiError.ts` mirrors the union and `formatApiError(unknown)` handles ApiError + legacy strings + Error instances uniformly.

The 3 profiling commands (`reset_perf_stats`, `export_perf_snapshot`, `record_user_action`) still use `Result<_, String>` for legacy reasons; not a blocker but should be migrated for consistency.

## Optimistic mutation pattern (frontend)

All TanStack Query mutations follow this shape (~5 occurrences across `useImages.ts`, `useTags.ts`, `useRoots.ts`):

```ts
useMutation({
    mutationFn: (params) => /* IPC call via service */,
    onMutate: async (params) => {
        await queryClient.cancelQueries({ queryKey: [...] });
        const prevData = queryClient.getQueryData([...]);
        queryClient.setQueriesData([...], optimistic update);
        return { prevData };
    },
    onError: (_err, _vars, context) => {
        if (context?.prevData) {
            queryClient.setQueryData([...], context.prevData);
        }
    },
    onSuccess: (data) => { /* swap optimistic placeholder for real data */ },
});
```

Use this exact pattern for any new mutation. The reasoning is in `systems/frontend-state.md` — the `staleTime: Infinity` default makes optimistic updates the only way the UI feels responsive after a mutation, and the rollback handles transient IPC failures.

## `paths::*_dir()` helpers as the single disk-path source

Every file the backend reads or writes goes through a helper in `crates/engine/src/paths.rs` (the Mnemosyne engine crate; re-exported into the product as `crate::paths::*` — see § Engine/product re-export facade below):

| Helper | Returns |
|--------|---------|
| `paths::app_data_dir()` | Root of all app-managed state. Always the platform default (`dirs::data_dir()/com.ataca.lynceus/` — on macOS that's `~/Library/Application Support/com.ataca.lynceus/`). Override via `LYNCEUS_DATA_DIR` env var. **No dev/release split** as of 2026-04-26. |
| `paths::database_path()` | `app_data_dir / "images.db"` |
| `paths::thumbnails_dir()` | `app_data_dir / "thumbnails"` |
| `paths::thumbnails_dir_for_root(id)` | `thumbnails / "root_<id>"` (Phase 9 reorg) |
| `paths::models_dir()` | `$LYNCEUS_MODELS_DIR` if set, else `app_data_dir / "models"` — see `systems/paths-and-state.md` § `models_dir()` resolution order |
| `paths::settings_path()` | `app_data_dir / "settings.json"` |
| `paths::cosine_cache_path()` | `app_data_dir / "cosine_cache.bin"` |
| `paths::exports_dir()` | `app_data_dir / "exports"` (perf snapshots, future shareable artefacts) |

Do not hardcode paths. If a new state file is added, add a helper. The dev-vs-release branching in `app_data_dir()` is then transparent to the caller.

## `paths::strip_windows_extended_prefix(&str) -> Cow<'_, str>`

The single helper for stripping `\\?\` prefixes off Windows paths. Returns `Cow::Borrowed` on the common path (no allocation when the prefix is absent). Used by `commands::resolve_image_id_for_cosine_path` for the cosine-path → DB-id mapping fallback.

Do not write inline `if path.starts_with("\\\\?\\") { ... }` closures — that pattern was triplicated pre-audit and the audit explicitly extracted it. The previous `notes/path-and-state-coupling.md` "don't add a fourth normalisation closure" warning is now satisfied by the existence of this helper.

## Engine/product re-export facade

The commercialisation refactor split the backend into two crates: `mnemosyne` (the media-agnostic engine, `crates/engine/`, owning `db`, `cosine`/`cosine_similarity`, `paths`, `perf`/`perf_report`, `image_struct`/`root_struct`/`tag_struct`) and `lynceus` (the image product, `apps/lynceus/src-tauri/`, owning everything image-specific — encoders, thumbnailer, indexing pipeline, watcher, Tauri commands). Rather than rewrite every in-crate call site for the moved modules, the product crate re-exports them at the same names they used to live under:

```rust
// apps/lynceus/src-tauri/src/lib.rs
pub use mnemosyne::{db, image_struct, paths, perf, perf_report, root_struct, tag_struct};

// apps/lynceus/src-tauri/src/similarity_and_semantic_search/mod.rs
pub use mnemosyne::{cosine, cosine_similarity};
```

Every existing `crate::db::…`, `crate::paths::…`, `crate::cosine::…`, `crate::perf::…` call site inside the product crate resolves unchanged. This facade is what made the extraction a pure move with zero behaviour change (125 backend tests before the split → 36 in `lynceus` + 89 in `mnemosyne` = 125 after). When adding a **new** module to the engine, add it to both `crates/engine/src/lib.rs`'s `pub mod` list and the matching `pub use mnemosyne::{...}` re-export on the product side — forgetting the second breaks every product-side `crate::<module>::…` reference at compile time (a missing-import error, not a silent one, so the failure mode is cheap to catch).

## Submodule layout: `mod.rs` orchestrates, files own concerns

The `db/`, `cosine/` (engine crate, `crates/engine/src/`) and `commands/`, `encoder_text/` (product crate, `apps/lynceus/src-tauri/src/`) directories all follow the same pattern:

```
<crate>/src/<concern>/
├── mod.rs           — pub use re-exports + the public struct/enum + shared helpers
└── <subconcern>.rs  — impl <Type> { ... } block with the per-subconcern methods + tests
```

Rust merges multiple `impl` blocks for the same type across files in the same crate. The result: `db.add_image(...)` works whether the method is defined in `db/mod.rs` or `db/notes_orphans.rs` — the caller doesn't know.

When adding a new submodule, declare it in `mod.rs` (`mod foo;` or `pub mod foo;`) and add the `impl ImageDatabase { ... }` block in `foo.rs`. Tests for `foo`'s methods live in `#[cfg(test)] mod tests` inside `foo.rs`.

## RAII guards for atomic state

The indexing pipeline's single-flight `AtomicBool` is cleared via an RAII guard:

```rust
struct RunningGuard(Arc<IndexingState>);
impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.is_running.store(false, Ordering::SeqCst);
    }
}
let _guard = RunningGuard(state.clone());
```

Use this pattern when an atomic flag must be cleared on success, error, AND panic. A simple `store(false)` at the end of a function would skip the panic case.

## `lock_result.is_ok()` defensive locking in setup

The lib.rs setup callback and the watcher closure use defensive locking instead of `?`:

```rust
if let Ok(mut slot) = watcher_state.lock() {
    *slot = handle;
}
```

Reason: setup runs early during app launch when error handling is awkward (no IPC channel exists yet to surface failures). Silent failure-to-acquire here is the right trade-off — the app continues launching. Reserve `?` for command bodies where ApiError can flow back to the user.

## `info!` / `debug!` / `warn!` / `error!` levels

| Level | Use for |
|-------|---------|
| `error!` | Pipeline failures that bring down the indexing run |
| `warn!` | Per-image failures (one bad thumbnail), missing-but-non-fatal models, partial scans |
| `info!` | State transitions (pre-warm started, root added, watcher started, populate complete) |
| `debug!` | Per-result detail (top-5 semantic-search results) |

The default env filter is `warn,lynceus_lib=info,lynceus=info,mnemosyne=info`. Without `--profiling`, `debug!` lines don't fire.

## File-organisation conventions

Since the commercialisation refactor the backend spans two crates — see § Engine/product re-export facade below for how call sites stay unchanged across the split:

- `crates/engine/src/db/` — SQLite layer (engine); one submodule per concern, all impl `ImageDatabase`
- `crates/engine/src/cosine/` — cosine ranking + RRF fusion (engine); `crates/engine/src/cosine_similarity.rs` is its re-export shim
- `crates/engine/src/{paths,perf,perf_report}.rs` — path resolution and the profiling layer (engine) — single-file modules at the engine crate root
- `apps/lynceus/src-tauri/src/commands/` — Tauri command handlers (product); one submodule per concern, all `#[tauri::command]`
- `apps/lynceus/src-tauri/src/similarity_and_semantic_search/` — ML/search subsystem (product); encoder + encoder_text are submodules under it, plus a `mod.rs` re-export of the engine's cosine module
- `apps/lynceus/src-tauri/src/{indexing,watcher,model_download,settings}.rs` — single-file modules at the product crate root
- `src/queries/` — TanStack Query hooks; one file per resource family
- `src/services/` — `invoke()` wrappers; one file per resource. Hooks call services; components do not call `invoke` directly.
- `src/components/ui/` — shadcn-generated. Treat as derivative; do not modify by hand.
- `src/components/` — hand-written per-feature components.
- `src/components/settings/` — per-section settings drawer split (Phase 9 + audit Modularisation finding); `index.tsx` is the shell, `*Section.tsx` files are the per-section content.
- `src/hooks/` — utility hooks (debounce, prefs, indexing-progress).

## Naming

- Rust modules and files: `snake_case`.
- Rust types: `PascalCase`.
- TypeScript components: `PascalCase` files (`Masonry.tsx`); hooks and helpers `camelCase` files.
- TypeScript types: `PascalCase`.
- Tauri command names: `snake_case` matching the Rust function name. Frontend invokes via `invoke("get_similar_images", ...)`.
- Tracing span names: `dotted.snake_case` with the prefix conventions above (`ipc.semantic_search`, `pipeline.encode_phase`, `cosine.get_similar_images_sorted`).
- Audit-finding comments: when a piece of code traces back to a specific audit finding, comment it with the commit short-hash:

```rust
// Audit finding (extracted from triplicated inline closures). The project
// notes already flagged "don't add a fourth normalisation closure"
// — the third one was the redundancy.
```

## Test locations

- Backend: `#[cfg(test)] mod tests` inside each submodule. The `db/test_helpers.rs::fresh_db()` helper creates an in-memory DB with `initialize` already run. Split across two crates post-refactor: 115 tests in the engine (`crates/engine`), 44 in the product (`apps/lynceus/src-tauri`) as of the perf round's close — counts move with every session, so treat these as a snapshot, not a target.
- Backend integration: `apps/lynceus/src-tauri/tests/*.rs` for cross-module tests (`cosine_topk_partial_sort_diagnostic.rs`, `indexing_pipeline.rs`, `similarity_integration_test.rs`, `batched_encode_equivalence_diagnostic.rs` — real-weights-gated, `#[ignore]`d by default — plus the `audit_*_diagnostic.rs` files, also `#[ignore]`d). The old `cosine_cache_invalidation_diagnostic.rs` was deleted when the primary cosine index it tested was removed (`1514a90`); the flat store's equivalent freshness tests live inline in `crates/engine/src/cosine/cache.rs` and `index.rs`.
- Frontend unit: alongside the source file (`useUserPreferences.test.ts`, `services.test.ts`).
- Frontend component: alongside the source file (`IndexingStatusPill.test.tsx`).

## `pub use submodule::*` re-export pattern

Every concern directory uses `pub use submodule::*` (or selective re-exports) in `mod.rs` to flatten the public API:

```rust
// src/commands/mod.rs
pub use error::ApiError;
pub use images::*;
pub use notes::*;
pub use profiling::*;
// ...
```

This means callers `use crate::commands::ApiError` not `use crate::commands::error::ApiError`. The internal split is invisible at the import level, which keeps refactoring (further splits, renames within the directory) cheap.

## Atomic file save (`tmp` + rename)

When persisting structured data to disk:

```rust
let tmp = path.with_extension("json.tmp");
fs::write(&tmp, content)?;
fs::rename(&tmp, &path)?;
```

Used by `Settings::save`. Survives a crash mid-write — the original file is unchanged until the rename completes. No explicit fsync; sufficient for non-critical state on every modern filesystem the app realistically runs on.

For very-critical state (cosine cache, models) the same pattern applies but isn't currently implemented (the cache uses a single-shot bincode write; a model download writes to `.part` then renames). Worth adding to the cosine cache path in the future.

## Numbered-recommendation annotation pattern (`R<n>`, then `T<n>-<n>`)

Every line landed against a numbered perf/roadmap plan carries that plan's task ID as an inline-comment prefix. The 2026-04-26 perf bundle used `R<n>` (recommendation number from that plan); the 100k performance round (`docs/engineering/decisions/performance-decisions.md`) used `T<n>-<n>` (tier-task IDs from the verified roadmap, e.g. `T1-2`, `T3-2`) — same pattern, new plan, new prefix scheme, since each plan owns its own numbering:

```rust
/// T3-1 — the compact layout manifest that replaces the full-catalogue
/// `get_images` fetch for the main feed. Same filter surface and the
/// same visibility membership as `get_images` (test-locked engine-side),
/// but each row is a handful of scalars plus one thumbnail path: no
/// tags join, no notes, no original path.
#[tauri::command]
pub fn get_feed_manifest(...) -> Result<Vec<FeedManifestRow>, ApiError> { ... }
```

The pattern serves three purposes:

1. **Forward traceability** — a reader scanning a file can grep the task ID and immediately find every line that landed for it, then follow the trail to the plan's (or, once the plan retires, `performance-decisions.md`'s) reasoning.
2. **Reverse traceability** — when a later perf report flags a regression, grep the relevant ID to see exactly what that task touched.
3. **Review aid** — commit reviewers can correlate diff hunks against the plan's ranking without mentally cross-referencing.

Apply the same pattern to future numbered recommendation bundles, picking a prefix scheme that doesn't collide with an already-shipped one. Don't introduce numbered tags for ad-hoc fixes — the plan-traceability is what makes them worth their visual cost.

## BEGIN IMMEDIATE for batched writes

When the encoder pipeline (or any future bulk-insert path) writes many rows in a row, wrap the batch in `BEGIN IMMEDIATE` rather than relying on per-row autocommit:

```rust
let mut conn = self.connection.lock().unwrap();
let tx = conn.transaction_with_behavior(
    rusqlite::TransactionBehavior::Immediate,
)?;
{
    let mut stmt = tx.prepare("INSERT OR REPLACE INTO ...")?;
    for row in rows { stmt.execute(...)?; }
}
tx.commit()?;
```

`IMMEDIATE` rather than the default `DEFERRED`: `DEFERRED` upgrades to a write lock on the first INSERT, racing with any concurrent reader; `IMMEDIATE` takes the write lock up-front. The canonical example is `db/embeddings.rs::upsert_embeddings_batch`. Per-row autocommit produces N implicit transactions + N fsyncs; the batched form produces one of each, which is 10-100× faster for bulk inserts and eliminates the per-row mutex-and-checkpoint churn that produced the perf-1777212369 22 s freezes.

## `useSyncExternalStore` module-singleton for cross-tree event state

When several independent surfaces (a status pill, a route, a settings drawer) all need to
react to the same backend event stream, don't give each one its own `listen()` + `useState`.
That produces one duplicate Tauri listener per mount and re-renders every consumer on every
event, even for slices it doesn't read. Introduced fixing exactly this in
`apps/lynceus/src/hooks/useIndexingStatus.ts` (the render-storm fix, `ebe4006`):

```ts
let eventState: EventState = { phase: null, message: null, active: false, eventFraction: null };
const subscribers = new Set<() => void>();
let listenerStarted = false; // starts the single listen() call lazily, once

function notify() {
  for (const cb of subscribers) cb();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  /* ...lazily start the listener on first subscriber... */
  return () => subscribers.delete(cb);
}

// getSnapshot selectors each return one primitive slice, so a subscriber
// only re-renders when the slice it reads actually changes:
export function useIsIndexing(): boolean {
  return useSyncExternalStore(subscribe, getActive);
}
```

One module-level listener owns the event and runs the invalidation policy exactly once;
every hook (`usePipelineStats` / `useIsIndexing` / `useIndexingPhase`) subscribes to the same
store but reads a different scalar slice via its own `getSnapshot`. Use this pattern for any
future cross-tree event stream (a second Tauri event, a WebSocket feed) with more than one
consumer — a single `useState` + `useEffect(() => listen(...))` per consumer is the pattern
this replaced and should not be reintroduced.

## Scalar comparators over reference-identity `React.memo`

`MasonryItem` and similar high-fanout components take a scalar comparator (`React.memo(Item,
(prev, next) => prev.id === next.id && prev.width === next.width && ...)`) whose field list is
documented against the component's props type, rather than relying on default reference-identity
memoisation. Two failure modes motivated this: tiles keyed on `id+url` remounted their whole
subtree every time `useAdaptiveThumbnail` sharpened the image (a new `url` looks like a new
identity), and route handlers that weren't `useCallback`'d produced a new prop reference every
render regardless of whether the underlying value changed. Key tiles by stable `id` alone (never
`id+url`) and give any component sitting under a high-frequency parent (the feed grid, the
indexing pill) an explicit comparator naming exactly the fields that should trigger a re-render.

## Stable per-image keys over positional/derived ordering

The feed's ordering is a pure function of `hash(id, seed)`, not a stored index or a `Date`-based
sort. A tile's position depends only on its own id plus the session's current seed, so a refetch
that adds newly-thumbnailed rows never reshuffles existing tiles — the newcomer just drops into
its own gap. Apply the same principle anywhere state needs a stable per-item identity across a
changing collection (drag-reorder's `id→index` map, the masonry worker's generation-tagged
requests): derive the key from the item's own identity, never from its position in whatever
array is currently in scope.

## Generation-token invalidation for anything cached or computed off-thread

Two different subsystems independently converged on the same shape: a monotonically-changing
token that must match before a cached or in-flight result is trusted, rather than a timestamp or
a boolean dirty flag.

- **Embedding-cache freshness** (`crates/engine/src/db/images_query.rs::embedding_generation_token`,
  consumed by `crates/engine/src/cosine/cache.rs` and `cosine/index.rs::refresh_if_stale`): an
  FNV-1a fold of `COUNT(*)`, `SUM(rowid)`, and `MAX(rowid)` over the same enabled/orphaned JOIN
  the store is built from. A bare `mtime` check on the cache file can't see a root being
  disabled — the embeddings table is untouched, only the JOIN's row-set changes — so the token
  is derived from the query that actually determines "what's in the store," not from a
  filesystem timestamp.
- **Masonry worker staleness** (`apps/lynceus/src/hooks/useMasonryEngine.ts`,
  `isCurrentGeneration`): every pack request carries the engine's current generation number;
  a result — worker or synchronous fallback — is applied only if `resultGen === currentGen`.
  A rapid filter/resize/reorder sequence fires several requests before the first resolves; the
  token discards every result but the latest instead of applying stale geometry.

When introducing a new cache or off-thread computation whose input can change while a result is
in flight, reach for a comparable token — cheap to compute, derived from the actual
inputs-that-matter, and checked before a result is trusted — rather than a timestamp or a
same-reference check.

## Versioned binary headers on persisted caches

Any cache persisted to disk in a raw/binary format carries a fixed-size versioned header, not a
bare blob. The flat embedding store (`crates/engine/src/cosine/cache.rs`) is the canonical
example: a 64-byte header (8-byte magic `b"LYNEMB01"`, `format_version: u32`, `encoder_hash: u64`
(FNV-1a of the encoder id, cross-checked against the filename), `dim`/`row_count`, the
generation token, reserved padding) precedes the id table and the f32 embedding block, written
via temp-file + atomic rename. Every header field has its own rejection test (bad magic, version
mismatch, dim/row-count disagreement) so a stale or foreign file fails closed instead of being
mapped and silently misread. Apply the same shape — magic + version + content-identifying fields
+ a freshness token — to any future persisted binary cache; a bare `mtime` or an un-versioned
blob is the anti-pattern this replaced.

## Cached-not-assumed norms

Never assume a stored embedding is unit-normalised. The flat store
(`crates/engine/src/cosine/store.rs`) computes and caches a real inverse norm
(`math::inv_norm`, `1.0 / sqrt(dot(v, v))`, zero on a zero vector) for every row at insertion
time and scores as `dot × q_inv × c_inv`, rather than assuming `|v| == 1` and scoring as a bare
dot product. Legacy embeddings written before encode-time L2-normalisation was introduced are
not unit vectors; assuming otherwise would silently distort every score touching one of those
rows. When adding a new cached derived quantity (a norm, a hash, a checksum), compute and store
it from the real data rather than assuming an invariant the data doesn't actually guarantee.

## Read-only secondary `read_lock()` for foreground SELECTs

`ImageDatabase` has two connections per real on-disk DB: the writer (`self.connection.lock()`) and the read-only secondary (`self.read_lock()`). Foreground IPC SELECTs route through `read_lock()` so they don't queue behind in-flight encoder write batches. Foreground writes (tag mutations, root toggles) keep using the writer mutex.

When adding a new IPC SELECT, default to `read_lock()`. Use the writer only when the call genuinely writes. The two connections share the SQLite WAL, so reads are consistent without taking SQLite-level locks against the writer.

For tests using `:memory:`, `read_lock()` falls back to the writer connection (`:memory:` is per-connection storage; a second connection sees a separate empty DB). No special test plumbing required.
