# paths-and-state

*Maturity: working*

## Scope / Purpose

Single source of truth for every disk path the app uses. Provides the small handful of helpers (`paths::*_dir()`) that every other system reads. Also owns the `Settings` struct that persists user-managed knobs (`scan_root`, `priority_image_encoder` legacy field, `enabled_encoders` Phase 11c).

This is a small but load-bearing module: every system that reads or writes state goes through here. A bug in `paths::app_data_dir()` would put state files in the wrong place silently.

## Boundaries / Ownership

- **Owns:** `paths::app_data_dir()`, `paths::database_path()`, `paths::thumbnails_dir()`, `paths::thumbnails_dir_for_root(id)`, `paths::models_dir()`, `paths::settings_path()`, `paths::cosine_cache_path()` (caller-less since `1514a90` — see below), `paths::exports_dir()`, `paths::strip_windows_extended_prefix(&str) -> Cow<'_, str>` (also caller-less since `1514a90`), the `Settings` struct + its load/save methods + `resolved_enabled_encoders()` helper. **Not owned here but downstream of this module:** the per-encoder flat embedding store's own path helper, `cosine::cache::embstore_path(encoder_id) -> PathBuf` (nests directly under `paths::app_data_dir()`, but lives in `crates/engine/src/cosine/cache.rs` since it's cosine-format-specific — see `systems/cosine-similarity.md`).
- **Does not own:** the file contents themselves (each owning system writes its own format), the app-data directory itself (created on first call to `app_data_dir`), the bundle-id (just stores a constant for the platform-default fallback).
- **Public API (paths):** see Owns above.
- **Public API (settings):** `Settings::default()`, `Settings::load() -> Self`, `Settings::save(&self) -> io::Result<()>`, `Settings::resolved_enabled_encoders() -> Vec<String>`.

## Current Implemented Reality

### App-data layout

Every state file lives under one root, the platform's standard app-data directory. Same layout in dev and release — there is **no `cfg(debug_assertions)` branching anymore**. (See "What changed" below for why.)

```
<app_data_dir>/                       # platform-standard, see paths.rs:81 for resolution
  images.db                           # SQLite (WAL adds .db-wal + .db-shm)
  settings.json                       # scan_root + enabled_encoders + (legacy) priority_image_encoder
  embstore_<encoder_id>.bin            # per-encoder flat mmap embedding store (see below; the current on-disk cache format)
  cosine_cache.bin                    # LEGACY — bincode-encoded Vec<(PathBuf, Vec<f32>)>, orphaned (see below)
  models/
    clip_vision.onnx                  # CLIP image (~352 MB)
    clip_text.onnx                    # CLIP text (~254 MB)
    clip_tokenizer.json               # CLIP BPE
    dinov2_base_image.onnx            # DINOv2 base (~347 MB)
    siglip2_vision.onnx               # SigLIP-2 image (~372 MB)
    siglip2_text.onnx                 # SigLIP-2 text (~1.13 GB)
    siglip2_tokenizer.json            # Gemma SentencePiece
  thumbnails/
    root_<id>/                        # one subfolder per root (Phase 9)
      thumb_<image_id>.jpg
    thumb_<image_id>.jpg              # legacy flat layout for root_id = NULL rows
  exports/
    perf-<unix_ts>/
      timeline.jsonl                  # raw event stream from PerfLayer
      report.md                       # rendered on app exit
      raw.json                        # snapshot at exit
    perf-<unix_ts>.json               # one-off snapshot from "Export" button
```

Where `<app_data_dir>` resolves to (in order):
1. `$LYNCEUS_DATA_DIR` if set and non-empty (env-var override for testing / multi-instance / CI fixtures)
2. `dirs::data_dir()/com.capataina.lynceus/` — the platform default:
   - **macOS:** `~/Library/Application Support/com.capataina.lynceus/`
   - **Linux:** `$XDG_DATA_HOME/com.capataina.lynceus/` (typically `~/.local/share/...`)
   - **Windows:** `%APPDATA%/com.capataina.lynceus/`
3. `./app-data/com.capataina.lynceus/` if `dirs::data_dir()` returns `None` (rare — only on stripped-down environments where the standard data dir can't be resolved). Logged at warn level.

### Why the dev-vs-release split was removed

An earlier version of this module branched on `cfg(debug_assertions)`: dev builds wrote to `<repo>/Library/`, release used the platform default. The split was removed because dev and release builds diverged on every code change, forcing the user to re-download all 2.5 GB of models whenever they switched build modes. Now both share state — the comment in `paths.rs::app_data_dir` explicitly cites this as the trigger for reverting.

The user can still sandbox a session via `LYNCEUS_DATA_DIR=/some/tmp/path` if they want isolation (the env-var override is the supported alternative to the old dev-path branching).

### `models_dir()` resolution order

Unlike the other `*_dir()` helpers, which nest unconditionally under `app_data_dir()`, `models_dir()` (`crates/engine/src/paths.rs::models_dir`) has its own two-step resolution — added by the commercialisation refactor now that encoder weights are fetched into the repo tree rather than only downloaded into app-data on first launch:

1. **`$LYNCEUS_MODELS_DIR`** if set and non-empty — an explicit absolute path. This is the development workflow now that weights live in the repo tree: point it at `<repo>/models/image/` (populated by `scripts/download_models.py`) so the dev app loads the same commercially-licensed weights it will eventually ship, inspectable on disk instead of buried under the platform app-data directory.
2. **`<app_data_dir>/models`** — the historical default, kept as a fallback so an unconfigured run (and `model_download.rs`'s first-launch download path, which still exists) still works.

Loading bundled weights from Tauri's resource dir in a release build is a documented productisation follow-up — the engine crate can't reach Tauri's resolver directly, so the product crate will need to pass the resolved path in.

### Per-root thumbnail subdirs

```rust
pub fn thumbnails_dir_for_root(root_id: i64) -> PathBuf {
    let p = thumbnails_dir().join(format!("root_{root_id}"));
    let _ = ensure_dir(&p);
    p
}
```

Phase 9 reorganisation: `remove_root` can `rm -rf` the per-root subfolder cleanly, instead of per-row file deletion. Legacy `root_id = NULL` rows continue writing to the flat `thumbnails_dir()` path.

### Windows path stripping — now orphaned (1514a90)

```rust
pub fn strip_windows_extended_prefix(path_str: &str) -> Cow<'_, str> {
    match path_str.strip_prefix("\\\\?\\") {
        Some(stripped) => Cow::Owned(stripped.to_string()),
        None => Cow::Borrowed(path_str),
    }
}
```

Historically used by `commands::resolve_image_id_for_cosine_path` to map cosine-result *paths* back to DB ids when the canonical form drifted (Windows-extended-prefix vs not). That resolver — and the whole path→id resolution step it existed for — died in the `fc6667a`/`1514a90` ID-native search rewrite: the cosine index, RRF fusion, and every search command now carry `image_id` directly (see `hydrate_search_results` in `commands/mod.rs`, which replaced the per-result resolve-then-hydrate pattern with one batched `WHERE id IN` lookup), so there is no longer a path string in the search result path to normalise. `strip_windows_extended_prefix` has **no production caller left** — confirmed by a repo-wide grep, nothing besides its own definition matches — and no test exercises it either. It is dead code, not yet removed. The `Cow` return (zero allocation for the common non-Windows case) and the `strip_prefix` idiom (Phase 6 clippy gate, over manual slice indexing) remain correct engineering *for the function*, just with nothing left to call it.

`notes/path-and-state-coupling.md` is the durable record of *why* this helper exists at all (the pre-ID-native path-normalisation story, the 3-strategy DB-id lookup it replaced a triplicated closure inside) — read it for that history. **That note is itself now partly stale as of this round**: its "What's still pending" and "Cross-references" sections still describe `resolve_image_id_for_cosine_path` as a live consumer pattern worth optimising; per the paragraph above, that function no longer exists. Flagged here rather than silently fixed, since `notes/` is outside this file's edit ownership for this pass.

### `cosine_cache_path()` — now orphaned (1514a90)

```rust
pub fn cosine_cache_path() -> PathBuf {
    app_data_dir().join("cosine_cache.bin")
}
```

This is the pre-flat-store cosine cache format: a single bincode-encoded `Vec<(PathBuf, Vec<f32>)>` for whichever one encoder was "primary". Its only caller was `CosineIndex::save_to_disk` (`cosine/cache.rs`), writing after the pipeline's primary-index populate step — both of which were removed outright in `1514a90` along with the rest of `CosineIndexState`. `cosine_cache_path()` itself is left in place (still compiles, still has its own unit test pinning the filename) but has **zero production callers** — a repo-wide grep turns up nothing but its own definition and its test. The current persisted-cache format is the per-encoder flat mmap store instead: `embstore_<encoder_id>.bin`, written by `CosineIndex::save_store_for` (also in `cosine/cache.rs`, see `systems/cosine-similarity.md` for the format) and invoked from the indexing pipeline's step 7 token-gated refresh, not from this module. Any pre-existing `cosine_cache.bin` on a user's disk is now permanently stale — nothing reads or rewrites it; it's a harmless orphaned file, cleaned up only if the user manually deletes their app-data directory.

`CosineIndex::save_to_disk` itself (the method, not this path helper) is in the same caller-less state — defined in `cosine/cache.rs`, referenced only in a code comment inside `indexing.rs` describing what it used to do, never actually invoked. Neither function has been deleted; both are candidates for a future dead-code sweep once the `1514a90` removal has had a release cycle to prove nothing external depended on the old cache format.

### `Settings` struct (current shape)

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub scan_root: Option<PathBuf>,

    /// LEGACY (Phase 11c) — was the user's "primary" image encoder
    /// when the picker was a single-choice dropdown. Now obsolete:
    /// fusion uses every enabled encoder. Kept on the struct so old
    /// settings.json files deserialise without erroring.
    #[serde(default)]
    pub priority_image_encoder: Option<String>,

    /// Phase 11c — encoder ids the user has enabled. The indexing
    /// pipeline only encodes for these; image-image and text-image
    /// fusion only fuse over these. None = use the default set
    /// (every supported encoder enabled).
    #[serde(default)]
    pub enabled_encoders: Option<Vec<String>>,
}
```

The `#[serde(default)]` on each field means newer binaries reading an older `settings.json` deserialise cleanly to defaults; older binaries reading a newer `settings.json` just ignore the unknown fields. Persisted atomically via write-to-`.tmp` + rename.

`Settings::resolved_enabled_encoders()` returns the user's pick when set, falling back to `DEFAULT_ENABLED_ENCODERS = ["clip_vit_b_32", "siglip2_base", "dinov2_base"]` when None or empty. Empty-list is treated as "use default" not "disable all" — the IPC validator (`commands::encoders::decide_enabled_write`) also rejects empty mutations, so the empty-set guard is belt-and-braces.

The `scan_root` field is the historical pre-multi-folder migration target. The `lib.rs::run::setup` callback consumes it once on first launch under the multi-folder schema, then clears it so the migration doesn't re-trigger.

Frontend `useUserPreferences` (theme, columns, sortMode, animation, similar/semantic result counts, tagFilterMode, legacy imageEncoder/textEncoder ids) lives separately in `localStorage`. The two stores don't overlap: backend Settings governs persistent per-install behaviour the indexing pipeline cares about; frontend prefs govern UI taste the backend doesn't see.

## Key Interfaces / Data Flow

### Read sites

| Caller | Function | Purpose |
|--------|----------|---------|
| `db::ImageDatabase::default_database_path` | `database_path()` | Open the SQLite file (writer + read-only secondary R2) |
| `lib.rs::run::setup` | `Settings::load()` | Check for legacy scan_root |
| `lib.rs::run::setup` | `Settings::save()` | Clear scan_root after legacy migration |
| `indexing.rs::run_pipeline_inner` | `models_dir().join(...)` | Verify model files exist |
| `indexing.rs::run_pipeline_inner` | `Settings::load().resolved_enabled_encoders()` | Pick which encoders to spawn parallel threads for (Phase 11c) |
| `indexing.rs::run_pipeline_inner` | `thumbnails_dir()` | Pass to ThumbnailGenerator::new |
| `indexing.rs::run_pipeline_inner` step 7 | `paths::app_data_dir()` (indirectly, via `cosine::cache::save_store_for` → `embstore_path`) | Persist each refreshed encoder's flat embedding store (`embstore_<encoder_id>.bin`) — the current replacement for the line below |
| `model_download.rs::download_models_if_missing` | `models_dir()` | Where to write downloads |
| `commands::semantic::semantic_search` (legacy) | `models_dir()` | Lazy-init text encoder for the single-encoder fallback path |
| `commands::semantic_fused::get_fused_semantic_search` | `models_dir()` + `Settings::load()` | Lazy-init enabled text encoders for RRF fusion (Phase 11d) |
| `commands::similarity::get_fused_similar_images` | `Settings::load().resolved_enabled_encoders()` | Iterate over enabled encoders for image-image RRF fusion (Phase 5) |
| `commands::encoders::{get,set}_enabled_encoders` | `Settings::{load,save}` | Per-encoder toggle persistence |
| `commands::roots::remove_root` | `thumbnails_dir_for_root(id)` | rm -rf the per-root subfolder |
| `commands::profiling::export_perf_snapshot` | `exports_dir()` | Write one-off perf snapshots |
| `main.rs` | `paths::exports_dir()` (via `perf::init_session`) | Initialize profiling session dir (only when `--profiling` flag or `PROFILING=1` env var is set) |

**No longer a read site (1514a90):** `cosine_cache_path()` and `strip_windows_extended_prefix(...)` — both functions still exist and still compile, but a repo-wide grep finds zero production callers for either. See "Windows path stripping" above and the note under `cosine_cache_path`'s own definition below.

### Write sites

`paths` itself doesn't write — `ensure_dir` is the only filesystem mutation, called transitively from every `*_dir()` accessor as a side effect of returning the path. Callers do all the actual file writes.

## Implemented Outputs / Artifacts

- One stable app-data layout, identical in dev and release builds (no compile-time split — see "Why the dev-vs-release split was removed" above).
- A small set of pure functions (no IO beyond `ensure_dir`) that every other system depends on.
- 6 unit tests in `paths.rs::tests` pinning the layout (dir basenames, per-root subfolder creation, file-name stability).
- Atomic save for `settings.json` (`.tmp` + rename pattern) — survives partial-write failure.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| `dirs::data_dir()` returning `None` in release | A platform without an XDG-or-equivalent data dir | Falls back to `./app-data` (relative to cwd) and logs a warn. The user might end up writing to wherever they launched the app from. macOS/Linux/Windows all have `dirs::data_dir()` support, so this is mostly theoretical. |
| `ensure_dir` failure swallowed | Filesystem full or permissions error | Returns the path anyway; subsequent file open fails. Gives a confusing error message that doesn't hint at the directory creation failure. |
| Settings.json corruption | Manual edit + invalid JSON | `Settings::load` logs error and returns `Settings::default()` — silently drops the legacy `scan_root` field. The migration path won't fire. Acceptable. |
| Atomic save uses `rename` not `fsync` | Power loss between `write` and `rename` | The `.tmp` file may exist on disk; on next launch settings.json is unchanged. If the rename succeeded but the directory entry didn't fsync, the new file may be partial. macOS / Linux ext4 / Windows NTFS handle this well in practice but no explicit fsync. |
| Hardcoded bundle id `com.capataina.lynceus` in release fallback | A future bundle-id rename | Two places to update: tauri.conf.json + this constant. There is no compile-time check that they match. |
| Per-root thumbnail dir creation is lazy | Calling `thumbnails_dir_for_root(99)` for a root that doesn't exist | Creates the subfolder anyway. Cleanup happens in `remove_root`; orphan subfolders for roots that were never used would persist. |
| Bundle id changed `com.ataca.image-browser` → `com.ataca.lynceus` (commercialisation rename) | Any pre-rename install launching the renamed binary | A library indexed under the old bundle id is orphaned — still on disk under `com.ataca.image-browser/`, unreferenced by the app. First launch under the new id starts from an empty catalogue (no DB, no cache) rather than migrating the old one. Acceptable at this stage (portfolio project, no external users yet): models now live in the repo tree rather than app-data, and DB re-indexing is cheap. See `notes/local-first-philosophy.md`. |
| Bundle id changed `com.ataca.lynceus` → `com.capataina.lynceus` (App Store rename, 2026-08-02 — Apple rejects personal-looking bundle IDs on non-personal teams) | Any pre-rename install launching the renamed binary | Same orphaning consequence as the row above, same acceptable-cost reasoning: no external users yet, models live in the repo tree, re-indexing is cheap. Both functional sites (tauri.conf.json + the `BUNDLE_ID` constant in `crates/engine/src/paths.rs`) were updated in the same commit. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **fsync-based atomic save** for settings.json. Today's `.tmp` + rename is good enough on every modern filesystem the app realistically runs on, but the trade-off is one syscall and could be added if a real corruption is observed.
- **Compile-time check that BUNDLE_ID matches tauri.conf.json**. Could be done via `build.rs` reading the conf and `concat!`-ing the const. Low priority.
- **Configurable app-data location for power users** (a network share, an external drive) beyond the existing `LYNCEUS_DATA_DIR` escape hatch — which already covers this case ad hoc but isn't surfaced as a Settings-drawer option. Not on the roadmap.
- **Cleanup on app uninstall**. If the user uninstalls a release build, the `~/Library/Application Support/...` directory persists (containing potentially many GBs of thumbnails and models). The README could document `rm -rf` instructions; the app itself doesn't surface a clean-up command.
- **Bundled-resource-dir model loading for release builds**. `models_dir()` currently resolves to `LYNCEUS_MODELS_DIR` or `<app_data_dir>/models` — neither is where a Mac App Store `.app` bundle would ship its weights. The engine crate can't reach Tauri's resource resolver directly, so the product crate will need to resolve the bundled path and pass it in. Tracked as a productisation follow-up, not yet implemented.

## Durable Notes / Discarded Approaches

- **`Library/` chosen over `app_data/` or `.image-browser/`** for the dev directory because the user wanted it visible in the IDE file tree and clearly named (Library is recognisably "platform-data-shaped" on macOS). It's project-local in dev to make wiping state trivial (one `rm -rf`).
- **The file is gitignored** (`.gitignore` covers `Library/`, `*.onnx`, `*.db`, `*.db-journal`, `cosine_cache.bin`, `*.part`) so generated state never lands in commits even if the user accidentally `git add .`s. `embstore_<encoder_id>.bin` — the flat store that made `cosine_cache.bin` obsolete — has **no matching `.gitignore` rule today**; harmless while `app_data_dir()` defaults outside the repo tree, but worth a rule (`embstore_*.bin`) the day anyone points `LYNCEUS_DATA_DIR` at a repo-local fixture path the way `LYNCEUS_MODELS_DIR` already does for models.
- **Per-root thumbnail subfolders were a Phase 9 reorg driven by user feedback.** The pre-Phase-9 flat layout meant `remove_root` left orphaned thumbnail files on disk forever (the DB rows were CASCADE-deleted but the JPEG files weren't). Per-root subfolders make `rm -rf` the cleanup path; legacy NULL-root_id rows still write to the flat layout.
- **`cfg(debug_assertions)` WAS the dev/release switch, discarded — see "Why the dev-vs-release split was removed" above.** An earlier version compile-time-branched dev builds to a project-local `<repo>/Library/` (resolved via `CARGO_MANIFEST_DIR`, chosen over a bare relative path because Cargo guarantees its absolute resolution) versus the platform-default app-data dir for release. It was reverted because dev and release diverging on every code change forced re-downloading all 2.5 GB of models on every build-mode switch. Neither `cfg(debug_assertions)` nor `CARGO_MANIFEST_DIR` appear in `paths.rs` any more; the env-var override (`LYNCEUS_DATA_DIR`) is the supported replacement for anyone who still wants isolation.
- **`Cow::Borrowed` return for `strip_windows_extended_prefix`** is the audit-extraction's payoff: zero allocation on every non-Windows code path. The previous inline closure always returned `String::to_string()` even when no strip happened. The function is now caller-less (see "Windows path stripping" above) but the design choice remains the right one if a future path-normalisation need brings a caller back.
- **Settings.json is intentionally not a god-config**. User preferences belong in the frontend localStorage layer (`useUserPreferences`); the backend Settings struct is exclusively for state that needs to survive across migrations or be readable before the frontend is alive (the legacy scan_root migration is the only example).

## Obsolete / No Longer Relevant

The pre-Phase-3 layout where `images.db` lived next to `src-tauri/Cargo.toml` (i.e., `src-tauri/../images.db`) is gone. Everything is under the centralised `Library/` directory. The `Settings.scan_root` field is preserved for migration but never written by current code paths.
