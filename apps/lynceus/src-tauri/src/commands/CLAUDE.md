# apps/lynceus/src-tauri/src/commands/

Tauri command boundary exposed to the React frontend — 34 registered commands. Each
submodule owns the `#[tauri::command]` functions for one concern; every command must
also be registered in lib.rs's `invoke_handler` or it silently doesn't exist to the
frontend. Every handler carries `#[tracing::instrument(name = "ipc.<command>")]` so
the perf report attributes per-command latency.

## Map

```
commands/
├── mod.rs             module doc + shared re-exports (ApiError); ImageSearchResult +
│                      hydrate_search_results + resolve_image_id_for_cosine_path
├── error.rs           ApiError — the serialised error shape the frontend matches on
├── images.rs          feed manifest, ID-detail batches, pipeline stats, thumbnails,
│                      preview breakdown, manual order/span, orphan purge;
│                      THUMBNAIL_BUCKETS const
├── roots.rs           scan-root legacy shim + multi-root CRUD; restart_watcher helper
│                      called at the end of all four root mutations
├── encoders.rs        list/get/set enabled encoders (decide_enabled_write validates)
├── tags.rs            tag CRUD + image-tag links + get_tag_counts
├── notes.rs           per-image notes get/set
├── semantic.rs        single-encoder text→image search (CLIP or SigLIP-2 slot)
├── semantic_fused.rs  RRF-fused text→image across text-capable enabled encoders
├── similarity.rs      image→image: single, tiered, and RRF-fused variants
└── profiling.rs       is_profiling_enabled, perf snapshot/reset/export, user actions
```

## The wire contracts

**`ApiError`** (`error.rs`) — 10 variants, `#[serde(tag = "kind", content =
"details", rename_all = "snake_case")]` pins the JSON shape
(`{"kind":"db","details":"..."}`); the frontend switches on `kind` with a default
arm, so adding a variant is forward-compatible. `From`-impls power bare `?`:
`rusqlite::Error::QueryReturnedNoRows → NotFound` (frontend branches on kind, not
message strings), other rusqlite → `Db`, `io::Error → Io`, and
`PoisonError<T> → Cosine("lock poisoned: …")` **generic over every guard type** —
so a poisoned text-encoder Mutex mislabels as a cosine error (source comment
acknowledges it). The typed `TextModelMissing`/`TokenizerMissing` variants exist so
the frontend's `isMissingModelError` can trigger a re-download flow rather than a
generic toast. The three profiling commands predate the migration and still return
`Result<_, String>` — cosmetic inconsistency, handled by the frontend fallback.

**`ImageSearchResult`** — the one shape every cosine/semantic command returns
(id, path, score, thumbnail_path, width, height; dimensions from the DB row so the
frontend never does a per-tile Image-load round-trip). Assembled by
**`hydrate_search_results(db, &[(id, score)])`**: since the fusion layer is
ID-native, hydration is one `WHERE id IN (...)` batch query walked in score order —
this replaced a per-result path-resolution + thumbnail N+1. A DB failure degrades
to "everything missed" rather than erroring the whole search.
`resolve_image_id_for_cosine_path` (three lookup strategies for Windows
`\\?\`-prefix path instability) has **no live caller** on any search hot path —
kept with its tests for a future path-keyed caller; flagged as dead-code-inventory
material, don't reach for it in new code.

**Commands stay sync `fn`, not `async fn`** — SQLite, mutexes and ONNX are all
blocking; background work lives on the pipeline thread. The main-thread trap below
is handled by the macro attribute, not by async bodies.

## Search commands

All five (`get_similar_images`, `get_tiered_similar_images`,
`get_fused_similar_images`, `semantic_search`, `get_fused_semantic_search`) borrow
`FusionIndexState` slots and return ID-native results through
`hydrate_search_results`. `per_encoder_top_k` defaults to `5 × top_n`, minimum 50.
The frontend routes `useTieredSimilarImages` → `get_fused_similar_images` and
`useSemanticSearch` → `get_fused_semantic_search` (hooks kept their old names for
caller stability). The fused "score" is an unbounded RRF sum, not a cosine — label
it "Fused" if it ever surfaces in UI. `semantic.rs` keeps the lazy text-encoder
init (`if lock.is_none()` after the pipeline pre-warm — covers pre-warm racing a
first-launch download) and emits the typed missing-model errors before
constructing. A panic while any command or the pipeline holds the fusion write
lock poisons the one shared `RwLock` and fails every encoder's search until
restart.

## Root mutations (`roots.rs`)

- `set_scan_root(path)` — **replace-all** semantic: remove every root (CASCADE),
  wipe legacy NULL-root rows, add the new one. No frontend caller since the
  "Add folder" rename; kept for a future explicit "Reset library".
- `add_root` — validates `is_dir`, creates the macOS security-scoped bookmark
  **synchronously inline** (must run while the picker dialog's temporary sandbox
  grant is still live; even a deferred tick risks the grant lapsing) and
  best-effort (`.ok()` — a failed bookmark degrades to no-persisted-grant, not a
  failed add), inserts, spawns the pipeline. Deliberately does **not**
  `invalidate_all` — new images aren't in any encoder's cache until encoded;
  the pipeline's token-gated fusion refresh picks them up.
- `remove_root` — **fetch-then-delete order is load-bearing**: read the bookmark
  and `stop_accessing` *before* deleting the row that holds it; then CASCADE
  delete, `remove_dir_all` the root's thumbnail dir (best-effort), and
  `invalidate_all`.
- `set_root_enabled` — toggles the column and calls `invalidate_all` (a
  disabled root's images must vanish from search immediately, not after the next
  encode). No stop_accessing — disable keeps the grant.

Fusion invalidation is synchronous and wholesale (clear every slot, next query
rebuilds from current DB) — an async invalidation channel and selective pruning
were both rejected for race-freedom and simplicity. Every mutation ends with
`restart_watcher` so the watch set follows the root list instead of freezing at
startup (2c07add). `add_root` on a duplicate path surfaces the raw UNIQUE
constraint as generic `ApiError::Db` — a known sharpening candidate.

## Tags (`tags.rs`)

Six commands. `add_tag_to_image` is `INSERT OR IGNORE` — duplicate assignment is a
no-op user intent, not an error. `get_tag_counts` is a dedicated view (not a
`count` field on `Tag`, which would have forced a global count into every embedded
`Tag` and changed `get_tags`'s wire shape): LEFT JOIN + `COUNT(vis.id)` so
zero-image tags return a 0 row, served over the read-only secondary connection.
**Its visibility predicate (`orphaned = 0 AND root enabled-or-NULL`) is a
hand-duplicated copy of the grid/manifest queries' predicate** — deliberate
(matches `images_query.rs`'s per-query inlining), but the copies must be edited
together or the drawer's counts stop matching what opening a folder shows.
Exclude-tag filtering is a `NOT EXISTS` clause appended after the include (OR/AND)
branches, so an empty exclude set is provably a no-op; bind order is
include-set-then-exclude-set, test-locked engine-side.

## Invariants

- Command names, serialised payloads, and error shapes are frontend-facing APIs;
  update matching TypeScript services and tests together.
- Feed commands expose compact manifests and ID-detail batches; similarity and
  semantic commands return ID-native fused results from encoder slots.
- Keep orphan cleanup explicit: purge database rows, remove associated adaptive
  thumbnail files best-effort, and clear fusion caches so deleted IDs cannot
  resurface. `purge_orphaned_images` reads orphan locations **before** the DELETE
  (a delete returning only a count can't name the thumbnail files), removes
  `thumb_<id>.jpg` and `thumb_<id>_<width>.jpg` per-file (one purge can span roots),
  and ends with `fusion_state.invalidate_all()` — same hygiene as `remove_root`.

## Traps

- **Attribute-less commands run on the main thread** (Tauri v2; 244b87a). The slow
  commands are already `#[tauri::command(async)]`: the four root mutations,
  `purge_orphaned_images`, `get_preview_breakdown`. A new command that deletes,
  walks directories, or rebuilds a watcher gets the attribute; `get_thumbnail` and
  the similarity commands are deliberately sync (fast-path).
- Adding Tauri-injected parameters (`AppHandle`, managed state) does not change the
  frontend invoke surface — inject freely; but the `WatcherSlot` state type must
  match lib.rs's declaration exactly (managed state resolves by exact type; a
  flavour mismatch panics at first invoke).
- `get_fused_semantic_search` returns `Ok(Vec::new())` when no enabled encoder is
  text-capable (`decide_enabled_write` blocks disabling *everything* but permits a
  DINOv2-only config) — indistinguishable from "no matches"; a known audit finding
  (K-FUS-1), documented in
  `tests/audit_fusion_no_text_capable_encoders_diagnostic.rs`, unresolved by choice.
- `get_preview_breakdown` counts bucket files on disk (buckets are deliberately not
  DB-tracked); its denominators are eligibility counts (source strictly wider than
  the bucket), not the library total. Don't "correct" either.

## Place in the whole

Thin orchestration over engine DB methods, `FusionIndexState` /
`TextEncoderState` slots, `thumbnail/`, and `watcher::restart`. The frontend halves
of these contracts live in `apps/lynceus/src/` service modules (other agents'
surface) — coordinate, don't edit.
