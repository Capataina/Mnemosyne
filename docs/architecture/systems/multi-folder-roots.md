# multi-folder-roots

*Maturity: comprehensive*

## Scope / Purpose

The "user can configure several folders, toggle them on and off independently, and remove them without losing other folders' data" subsystem. Owns the `roots` SQLite table, the per-root foreign-key relationship from `images.root_id` (with `ON DELETE CASCADE`), the per-root thumbnail directory layout, the legacy single-folder migration path, and the four CRUD Tauri commands that drive the Settings drawer's Folders section.

This is what made the Phase 6 transition from "one folder, replace to switch" to "any number of folders, toggle individually" possible.

## Boundaries / Ownership

- **Owns:** the `roots` table schema + CRUD (including the `bookmark BLOB` column, see below), `images.root_id` FK + cascade behaviour, the `set_scan_root` "replace all roots" semantic, `add_root` / `remove_root` / `set_root_enabled` granular semantics, `migrate_legacy_scan_root`, `wipe_images_for_new_root`, `paths::thumbnails_dir_for_root(root_id)`, the *wiring* of when to create/resolve/release a macOS security-scoped bookmark around a root mutation.
- **Does not own:** the indexing pipeline that gets re-spawned after every root mutation (delegates to `indexing::try_spawn_pipeline`), the fusion cache invalidation mechanism itself (delegates to `FusionIndexState::invalidate_all` — see `systems/multi-encoder-fusion.md`), the watcher reconfiguration (delegates to `watcher::restart`, which every root mutation now calls — see `systems/watcher.md`), the Cocoa security-scoped-bookmark API itself (delegates to `security_scope.rs` — three free functions, no roots-table awareness; see "macOS security-scoped bookmarks" below).
- **Public API:** `db.list_roots()`, `db.add_root(path, bookmark)`, `db.remove_root(id)`, `db.set_root_enabled(id, enabled)`, `db.migrate_legacy_scan_root(path)`, `db.wipe_images_for_new_root()`, `db.get_root_id_by_path(path)`, `db.enabled_roots_with_bookmarks()`, `db.get_root_bookmark(id)`. Tauri commands: `list_roots`, `add_root`, `remove_root`, `set_root_enabled`, `set_scan_root`, `get_scan_root`.

## Current Implemented Reality

### Schema

```sql
CREATE TABLE roots (
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    enabled   INTEGER NOT NULL DEFAULT 1,
    added_at  INTEGER NOT NULL,   -- unix epoch seconds
    bookmark  BLOB                -- macOS security-scoped bookmark, nullable
);

-- images.root_id added via Phase 6 migration:
ALTER TABLE images
ADD COLUMN root_id INTEGER REFERENCES roots(id) ON DELETE CASCADE;
```

`db/mod.rs:~188` for the create (now including `bookmark BLOB` in the `CREATE TABLE`). `db/schema_migrations.rs` for the idempotent ALTER TABLEs — `migrate_add_roots_bookmark_column` (`schema_migrations.rs:230`) adds `roots.bookmark` for DBs created before the security-scoped-bookmark feature landed (`1c36143`); existing rows get `NULL`, meaning "no persisted grant — fall back to plain filesystem access" (see below), not an error state.

`PRAGMA foreign_keys = ON` is set in `initialize` — without it, `ON DELETE CASCADE` would silently no-op. This is the explicit fix that made root removal actually wipe its images.

### Two distinct UX semantics

The system exposes two ways to change which folders are indexed:

| Command | Semantic | When used |
|---------|----------|-----------|
| `set_scan_root(path)` | **Replace all roots with one new one.** Removes every existing root (CASCADE wipes their images), wipes orphan rows from older NULL-root_id imports, adds the new root, clears the cosine cache, spawns the indexing pipeline. | No frontend caller after the 2026-04-26 top-bar rename ("Choose folder" → "Add folder"). Tauri command + tests retained for the legacy mental model in case a "Reset library" UX is reintroduced. |
| `add_root(path)` / `remove_root(id)` / `set_root_enabled(id, enabled)` | **Granular per-root mutation.** `add_root` inserts a new row + spawns reindex (existing roots untouched). `remove_root` CASCADE-deletes the root's images + per-root thumbnail subfolder. `set_root_enabled` toggles the `enabled` column — no reindex needed because the grid query filters by enabled status. | Both the top-bar "Add folder" pill and the Settings drawer Folders section call `add_root` via the `useAddRoot` mutation, so the new row immediately appears in the Folders list (the mutation invalidates `["roots"]`). The drawer also exposes per-row toggle + remove. |

Both paths preserve the `tags` and `images_tags` tables — tag catalog persists across root reorganisation.

### Grid filtering

Every `get_images_with_thumbnails` SQL gates on:

```sql
WHERE images.orphaned = 0
  AND (
    images.root_id IS NULL
    OR images.root_id IN (SELECT id FROM roots WHERE enabled = 1)
  )
```

`db/images_query.rs:236-242`. `root_id IS NULL` rows are legacy un-migrated images (from before Phase 6) and are kept in the grid so existing libraries don't disappear after upgrade.

Disabling a root is instant — the row stays, the SQL filter excludes its images, re-enabling just shows them again. No re-encode, no re-thumbnail, no DB change beyond the `enabled` column.

### Per-root thumbnail layout

Pre-Phase-9 layout was flat:
```
<app_data_dir>/thumbnails/thumb_42.jpg
<app_data_dir>/thumbnails/thumb_43.jpg
...
```

Post-Phase-9 layout is per-root:
```
<app_data_dir>/thumbnails/root_1/thumb_42.jpg
<app_data_dir>/thumbnails/root_2/thumb_99.jpg
```

The reorg means `remove_root` can `rm -rf` the root's subfolder in one filesystem call, instead of per-row file deletion. Old `root_id = NULL` images still write to the flat layout via `paths::thumbnails_dir()` directly.

The `ThumbnailGenerator::generate_thumbnail(path, image_id, root_id: Option<i64>)` API takes the root_id; `None` falls back to the flat layout.

### Legacy migration

```rust
// lib.rs::run::setup, runs once at app launch
let user_settings = settings::Settings::load();
if let Some(legacy_path) = user_settings.scan_root.clone() {
    if let Ok(temp_db) = ImageDatabase::new(&db_path) {
        let _ = temp_db.initialize();
        match temp_db.migrate_legacy_scan_root(legacy_path.to_string_lossy().into_owned()) {
            Ok(Some(root)) => {
                info!("migrated legacy scan_root -> roots[{}] ({})", root.id, root.path);
                let mut s = user_settings.clone();
                s.scan_root = None;
                let _ = s.save();   // clear so we don't re-migrate
            }
            Ok(None) => {} // already migrated
            Err(e) => warn!("legacy migration failed: {e}"),
        }
    }
}
```

`migrate_legacy_scan_root` is idempotent: if a row already exists for that path, it returns `Ok(None)` and nothing happens. The post-success `scan_root = None` clear means subsequent launches don't re-attempt the migration. Backfills any `images.root_id = NULL` rows whose path starts with the legacy path so they get associated with the new root.

### Fusion cache invalidation (1514a90 — replaces the old primary-cosine clear)

Every root-mutating command clears the fusion slots directly:

```rust
fusion_state.invalidate_all();   // FusionIndexState::invalidate_all — clears every per-encoder slot
```

This used to clear `CosineIndexState.index.cached_images` (the single primary cosine cache every legacy search command read). That primary index was removed outright in `1514a90` — every search command now borrows the per-encoder fusion slots, so `set_scan_root` / `add_root` / `remove_root` / `set_root_enabled` all call `FusionIndexState::invalidate_all()` on the same `fusion_state: State<'_, FusionIndexState>` instead. `invalidate_all` clears the whole `per_encoder: Arc<RwLock<HashMap<String, CosineIndex>>>` map — the next similarity/semantic query cold-populates whichever encoder slot it needs from the (now post-mutation) DB, and the re-spawned indexing pipeline's step 7 re-persists each slot's flat-store file (`embstore_<encoder_id>.bin`) once it's warm again. See `systems/multi-encoder-fusion.md` § Invalidation for the full mechanism and `systems/cosine-similarity.md` for the flat-store format.

`add_root` itself does *not* call `invalidate_all` — a brand-new root's images aren't scored by any encoder until they're actually encoded regardless, so there's nothing stale to clear yet; the pipeline's token-gated `refresh_if_stale` (step 7) picks the new images up once encoding finishes. `remove_root` and `set_root_enabled` do call it, because those can make previously-cached rows wrong immediately (a removed/disabled root's images must stop appearing in results right away, not just after the next encode pass).

## Key Interfaces / Data Flow

### `set_scan_root(path)` lifecycle

```
Frontend (FoldersSection or empty-state):
  invoke("set_scan_root", { path })
        └─── Tauri IPC ───
commands::roots::set_scan_root:
  • Validate path is a directory; else ApiError::BadInput
  • db.list_roots() → for each: db.remove_root(r.id)  ← CASCADE wipes images
  • db.wipe_images_for_new_root()  ← clears any NULL-root_id legacy rows
  • (macOS) security_scope::create_bookmark(path) → Option<Vec<u8>>, best-effort (None on failure/non-macOS)
  • db.add_root(path, bookmark)
  • fusion_state.invalidate_all()  ← clears every per-encoder fusion slot
  • try_spawn_pipeline(...)   ← background indexing starts
  Returns Ok(())
        ─── Tauri IPC ───
Frontend:
  Settings drawer or empty-state UI updates (useRoots query refetches)
  IndexingStatusPill starts showing progress events
```

### `add_root(path)` lifecycle

```
Frontend:
  invoke("add_root", { path })
        ─── Tauri IPC ───
commands::roots::add_root:
  • Validate is_dir; else ApiError::BadInput
  • (macOS) security_scope::create_bookmark(path) → Option<Vec<u8>>, best-effort
  • db.add_root(path, bookmark) → returns Root (including new id)
  • try_spawn_pipeline(...)  ← incremental rescan picks up the new root
    (no fusion_state.invalidate_all() here — new images aren't scored by
    any encoder until encoded; step 7's refresh_if_stale picks them up)
  Returns Ok(root)
        ─── Tauri IPC ───
Frontend:
  useAddRoot mutation onSuccess invalidates ["roots"] query
  IndexingStatusPill renders progress
```

### `remove_root(id)` lifecycle

```
Frontend (FoldersSection × button):
  invoke("remove_root", { id })
        ─── Tauri IPC ───
commands::roots::remove_root:
  • (macOS) db.get_root_bookmark(id) → if Some, security_scope::stop_accessing(bookmark)
    (fetch-then-delete: the scope must be released BEFORE the row — and its
    bookmark — is gone, or there's nothing left to resolve stop_accessing against)
  • db.remove_root(id) → CASCADE wipes every images.row whose root_id = id
  • paths::thumbnails_dir_for_root(id) → if exists, rm -rf (best-effort, log warn on fail)
  • fusion_state.invalidate_all()
  Returns Ok(())
        ─── Tauri IPC ───
Frontend:
  useRemoveRoot mutation onSuccess invalidates ["roots"] AND ["images"] queries
```

### `set_root_enabled(id, enabled)` lifecycle

```
Frontend (FoldersSection toggle):
  invoke("set_root_enabled", { id, enabled })
        ─── Tauri IPC ───
commands::roots::set_root_enabled:
  • db.set_root_enabled(id, enabled)
  • fusion_state.invalidate_all()  ← so similarity reflects active set
  Returns Ok(())
        ─── Tauri IPC ───
Frontend:
  useSetRootEnabled mutation onSuccess invalidates ["roots"] AND ["images"]
  Grid re-renders without the disabled root's images (or with them, on enable)
```

### macOS security-scoped bookmarks (`1c36143`)

A root the user picks via the native folder dialog only grants the *process* temporary filesystem access — under App Sandbox that grant evaporates the moment the app quits, so without persisting something, every root would need re-picking on every launch. `security_scope.rs` (not owned by this file — three free functions, no roots-table awareness) wraps the Cocoa `NSURL` security-scoped-bookmark API for that:

| Function | Called from | When |
|----------|-------------|------|
| `create_bookmark(path) -> Result<Vec<u8>, String>` | `commands::roots::set_scan_root` / `add_root` | Synchronously, right after the user picks the folder — while the sandbox's temporary grant for that path is still live. `#[cfg(target_os = "macos")]`; `None` on every other target and best-effort (`.ok()`) on failure — a failed bookmark isn't fatal to adding the root, it just means startup falls back to plain filesystem access for that root, same as before this feature existed. |
| `start_accessing(bookmark) -> Result<(PathBuf, bool), String>` | `lib.rs::run` setup, once per enabled root, before `watcher::start` / `try_spawn_pipeline` touch any path | Every app launch. Resolves the bookmark and calls `startAccessingSecurityScopedResource`; deliberately not paired with an immediate `stop_accessing` — the scope stays open for the app's session, not one file read. |
| `stop_accessing(bookmark)` | `commands::roots::remove_root` | Root removal, fetch-then-delete ordered (see lifecycle above). Not called on disable (`set_root_enabled`) — a disabled-but-not-removed root keeps its access grant open; only removal releases it. |

The bookmark bytes live in `roots.bookmark` (nullable — `NULL` means "no persisted grant," which is the normal state for every non-macOS install and every macOS dev build outside a real sandbox, where nothing needs one). `db.enabled_roots_with_bookmarks()` is the batch read the startup loop uses; `db.get_root_bookmark(id)` is the single-row read `remove_root` uses before deleting.

**Not yet verified under a real sandboxed build** — `security_scope.rs`'s own module doc is explicit about this: the FFI plumbing (bookmark create/resolve round-trip) is tested outside a sandbox (where it works but proves nothing about enforcement), and the non-sandboxed dev-mode path (bookmarks created and resolved but never actually gated by anything) has been exercised. The actual sandbox-gated behaviour — a signed, entitled Mac App Store build with the `com.apple.security.app-sandbox` + `com.apple.security.files.bookmarks.app-scope` entitlements — has not been run against this code yet. Tracked as a pre-sale verification item, not a known bug.

## Implemented Outputs / Artifacts

- 4 root-management Tauri commands + 1 legacy `set_scan_root` that wraps them + 1 `get_scan_root` for backwards-compat with the empty-state UI
- 1 system table (`roots`) + 1 column on `images` (`root_id`)
- 1 thumbnail subdirectory per root, `<app_data_dir>/thumbnails/root_<id>/`
- The Settings drawer's Folders section
- `useRoots` query hook + `useAddRoot` / `useRemoveRoot` / `useSetRootEnabled` mutations
- 11 unit tests in `db/roots.rs` covering add/remove/list/enable/migration semantics
- 1 nullable `bookmark BLOB` column on `roots` + its idempotent `migrate_add_roots_bookmark_column` ALTER TABLE, `security_scope.rs`'s 3 free functions (`create_bookmark` / `start_accessing` / `stop_accessing`) + 1 round-trip test proving the FFI plumbing (not sandbox enforcement — see Known Issues)

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| `paths.path` is stored verbatim (no normalisation) | User picks `/Users/me/Photos/` then later `/Users/me/Photos` (trailing slash) | Two distinct rows because the UNIQUE constraint compares strings literally. Cosmetic — both work, just shows up twice in the Folders list. |
| `add_root` propagates a UNIQUE constraint error as `ApiError::Db` | User adds the same folder twice via add_root | Frontend gets a typed-but-generic DB error. Could be improved to `ApiError::BadInput("already added")`. |
| Removing the only enabled root leaves the user with empty grid + no obvious "add another folder" CTA | Last-root removal | The grid empties cleanly but the empty-state UI uses `pickScanFolder` which goes through `set_scan_root` (replace-all semantic). User has to know to use the Settings drawer's Add Folder button to add additional roots from there. |
| `wipe_images_for_new_root` only fires inside `set_scan_root`, not `add_root` | Legacy NULL-root_id rows persist when only `add_root` is used | Documented; the rows still display because the grid query keeps NULL-root_id rows. Functionally fine. |
| Per-root thumbnail directory removal is best-effort | Filesystem busy / permissions | Logs warn; user can manually clean. The DB rows are gone (CASCADE), so the orphaned files are inert. |
| Security-scoped bookmark support is unverified under a real sandboxed build | A signed, entitled Mac App Store release | The FFI round-trip is proven outside a sandbox; actual enforcement (does a stale/revoked bookmark degrade the way the code assumes?) has not been exercised. See "macOS security-scoped bookmarks" above. |
| `create_bookmark` failure is silent (`.ok()`, best-effort) | Adding a root the process doesn't currently have sandbox access to (e.g. typed path rather than dialog-picked, on a sandboxed build) | `roots.bookmark` stays `NULL` for that row; the root is added and indexed as normal on an unsandboxed dev build, but on a real sandboxed release the next launch's `start_accessing` loop simply has nothing to resolve for it — the root silently stops being watched/scanned after restart with no user-visible error. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Path normalisation at insert time** to deduplicate trailing-slash variants and cross-platform path differences (cross-cutting with `notes/path-and-state-coupling.md`).
- **Specific ApiError for duplicate-path adds** instead of letting the DB UNIQUE error bubble.
- **Per-root scan-priority or include/exclude patterns** — nothing implemented yet, but the schema could grow (`exclude_patterns TEXT NULL`, `priority INTEGER NULL`) without breaking compatibility because the grid query doesn't reference those columns.
- **Re-create-and-re-persist a stale bookmark.** `start_accessing` already surfaces `is_stale` (the OS resolved the bookmark but flags it as due for renewal, e.g. the folder moved without being deleted); today the startup loop only logs a warn. A follow-up would call `create_bookmark` again from the resolved path and `db.set_root_enabled`-style update the stored `bookmark` blob, so a moved-but-not-deleted root doesn't eventually fail to resolve at all.
- **Verify the sandboxed bookmark path against a real signed build** — the standing pre-sale checklist item; see "macOS security-scoped bookmarks" above.

## Durable Notes / Discarded Approaches

- **`PRAGMA foreign_keys = ON` is required.** SQLite defaults this OFF for backwards compatibility. Without it, `ON DELETE CASCADE` is a no-op — root removal would leave orphan image rows forever. The pragma is set in `initialize` after every connection open.
- **The `set_scan_root` "replace all" semantic exists but no longer has a frontend caller.** It was originally wired to the top-bar "Choose folder" button under the assumption a no-roots user wanted a clean slate. In practice this silently destroyed previously-added roots when users clicked the button after their first add — the picker looked like an *add* affordance but behaved like a *reset*. The 2026-04-26 fix swapped the button to `add_root` (additive, idempotent on duplicates via a frontend pre-check + backend UNIQUE constraint), renamed it "Add folder", and switched the icon to `FolderPlus` to match. The Tauri command + service test stay in place so the replace-all flow can be reintroduced behind an explicit "Reset library" affordance later without re-implementing the lifecycle.
- **`migrate_legacy_scan_root` is idempotent because settings.json could persist across binary upgrades.** A user who did a legacy → multi-folder migration once should not get duplicate roots if they later downgrade, edit settings.json, and upgrade again.
- **The per-root thumbnail directory layout is a reorg that does not break legacy rows.** `ThumbnailGenerator::generate_thumbnail(path, image_id, None)` writes to the flat layout; `Some(root_id)` writes to the subfolder. The DB stores absolute thumbnail paths so both layouts coexist.
- **Fusion cache is cleared wholesale on a mutating root change, not selectively pruned.** `remove_root` / `set_root_enabled` call `FusionIndexState::invalidate_all()`, clearing every encoder's slot rather than filtering out just the rows whose root_id no longer matches. The simplicity of "just rebuild from the active DB" is worth more than the milliseconds saved; each slot's repopulate is one SQL query + a flat in-memory rebuild, not a disk-format deserialise. (Historical note: before `1514a90` this cleared the single primary `CosineIndexState.index.cached_images`; the removal of that primary index retargeted every call site onto `fusion_state.invalidate_all()` with the same wholesale-clear philosophy.)
- **`create_bookmark` is called synchronously inline in the command handler, not deferred to a background task.** The whole reason it works is that it must run while the sandbox's temporary per-process grant for the just-picked folder is still live — deferring it even to the next event-loop tick risks the grant having already lapsed. Best-effort (`.ok()`) rather than propagating the error as `ApiError` because a failed bookmark degrades to "no persisted access" (dev-build-equivalent behaviour), not a fatal failure to add the root.

## Obsolete / No Longer Relevant

The pre-Phase-6 model where `settings.json::scan_root` was the single source of truth is gone. The field is preserved for the legacy migration path but never re-set after migration. New installations never write to it.
