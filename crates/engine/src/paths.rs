//! Platform-default paths for app data, thumbnails, models, settings,
//! and exports.
//!
//! All user-state lives under the platform's standard app-data
//! directory regardless of build mode (debug or release). Layout:
//!
//! ```text
//! <platform_data_dir>/com.capataina.lynceus/
//!   images.db
//!   settings.json
//!   cosine_cache.bin
//!   models/
//!     model_image.onnx
//!     model_text.onnx
//!     tokenizer.json
//!   thumbnails/
//!     root_1/thumb_42.jpg
//!     root_2/thumb_99.jpg
//!   exports/
//!     perf-<unix-ts>/{report.md,raw.json,timeline.jsonl}
//! ```
//!
//! On macOS the base is `~/Library/Application Support/`; on Linux
//! `$XDG_DATA_HOME` (default `~/.local/share`); on Windows
//! `%APPDATA%`. The bundle id segment matches `tauri.conf.json`.
//!
//! `LYNCEUS_DATA_DIR` env var overrides the default for ad-hoc
//! redirection (testing, side-by-side instances, CI fixtures).

use std::borrow::Cow;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Strip the Windows extended-path prefix `\\?\` if present. Returns
/// the input borrow unchanged when the prefix is absent (the common
/// case on every non-Windows platform), so call sites pay no
/// allocation when the path doesn't need normalising.
///
/// Why this exists as a function (not a closure copied per command):
/// audit finding — the same 7-line closure was triplicated across
/// `semantic_search`, `get_similar_images`, and `get_tiered_similar_images`.
/// The project notes already flagged "don't add a fourth normalisation
/// closure"; the third one was already the redundancy. This helper is
/// the single place to fix Windows path handling if the schema ever
/// changes (e.g., normalising at insert time).
pub fn strip_windows_extended_prefix(path_str: &str) -> Cow<'_, str> {
    // 6b — clippy::manual_strip. strip_prefix returns the suffix
    // directly when the prefix matches.
    match path_str.strip_prefix("\\\\?\\") {
        Some(stripped) => Cow::Owned(stripped.to_string()),
        None => Cow::Borrowed(path_str),
    }
}

use tracing::warn;

/// Tauri bundle identifier — must stay in sync with `tauri.conf.json::identifier`.
const BUNDLE_ID: &str = "com.capataina.lynceus";

/// Root of all app-managed state.
///
/// Always resolves to the platform's standard app-data directory so
/// debug and release builds share state. On macOS that's
/// `~/Library/Application Support/com.capataina.lynceus/`; on
/// Linux `$XDG_DATA_HOME/com.capataina.lynceus/`; on Windows
/// `%APPDATA%/com.capataina.lynceus/`.
///
/// The `LYNCEUS_DATA_DIR` env var overrides this for ad-hoc
/// redirection (testing against a separate state, running multiple
/// instances side by side, pointing CI at a fixture directory). Set
/// it to an absolute path; the env var wins over the platform
/// default.
///
/// Why platform-default rather than project-local: dev and release
/// builds compile differently (debug vs --release) but should see
/// the same DB, the same downloaded models (1.1GB), and the same
/// thumbnails. A `cfg(debug_assertions)` split would force a
/// re-download every time you switched build modes — which is
/// exactly the bite that prompted reverting to the standard path.
pub fn app_data_dir() -> PathBuf {
    // Env-var override comes first — useful for testing against a
    // separate state, running multiple instances, or pointing at a
    // fixture directory.
    if let Ok(override_path) = std::env::var("LYNCEUS_DATA_DIR") {
        if !override_path.is_empty() {
            let dir = PathBuf::from(override_path);
            let _ = ensure_dir(&dir);
            return dir;
        }
    }

    let base = dirs::data_dir().unwrap_or_else(|| {
        warn!(
            "dirs::data_dir() returned None; falling back to ./app-data — \
             your platform may not be fully supported"
        );
        PathBuf::from("./app-data")
    });
    let dir = base.join(BUNDLE_ID);
    let _ = ensure_dir(&dir);
    dir
}

/// Path to the SQLite database file. Parent directory is created if missing.
pub fn database_path() -> PathBuf {
    app_data_dir().join("images.db")
}

/// Top-level directory under which all thumbnails live, organised by
/// root id (Phase 9 reorg per user feedback).
pub fn thumbnails_dir() -> PathBuf {
    let p = app_data_dir().join("thumbnails");
    let _ = ensure_dir(&p);
    p
}

/// Per-root thumbnail directory.
///
/// Layout:
///   app_data_dir/thumbnails/
///     root_1/thumb_42.jpg
///     root_2/thumb_99.jpg
///
/// Per-root segregation means removing a root from the multi-folder
/// list can also cascade-delete its thumbnails on disk in one
/// `rm -rf` rather than per-row file deletion.
///
/// Legacy layout (pre-multi-folder) put every thumbnail flat under
/// `thumbnails/`. Old DBs with that layout still work because the
/// thumbnail_path column stores absolute paths; new thumbnails just
/// land under the per-root subfolder going forward.
pub fn thumbnails_dir_for_root(root_id: i64) -> PathBuf {
    let p = thumbnails_dir().join(format!("root_{root_id}"));
    let _ = ensure_dir(&p);
    p
}

/// Directory where the ONNX encoder models and their tokenizers live.
///
/// Resolution order:
///
/// 1. **`LYNCEUS_MODELS_DIR` env var** — an explicit absolute path. This is the
///    development workflow now that weights live inside the repo tree: point it
///    at `<repo>/models/image` (populated by `scripts/download_models.py`) so
///    the app loads the same commercially-licensed weights it will eventually
///    ship, and they stay inspectable on disk instead of buried under
///    `~/Library/Application Support/…`.
/// 2. **`<app_data_dir>/models`** — the historical default, kept as a fallback
///    so an unconfigured run still works.
///
/// For a shipped Mac App Store build the weights are bundled into the .app and
/// loaded from Tauri's read-only resource dir; wiring that resolution through
/// here (the engine can't reach Tauri's resolver directly, so the product
/// crate will pass it in) is tracked as a productisation follow-up.
/// Set once at Tauri app startup (release builds only) with the
/// resolved `BaseDirectory::Resource` path for the bundled `models/`
/// tree — `tauri.conf.json`'s `bundle.resources` copies
/// `../../models` into the signed `.app`'s `Contents/Resources/`
/// (macOS) at build time, and only the product crate can resolve that
/// path (`app.path().resolve(...)`, a Tauri API the engine crate
/// deliberately doesn't depend on — see the module-level doc comment
/// on this file about the engine staying media/framework-agnostic).
/// A `OnceLock` rather than a parameter threaded through every path
/// call keeps `models_dir()`'s signature unchanged for the ~10
/// existing call sites; `set_bundled_resource_dir` is a one-time
/// startup call, not something that varies per-call the way
/// `model_precision` does.
static BUNDLED_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Called once from the Tauri app's `setup` callback in a bundled
/// (release) build. No-op in dev — `LYNCEUS_MODELS_DIR` already covers
/// that case and takes priority over this tier regardless. Calling
/// this more than once is a logic error (`OnceLock::set` returns
/// `Err` and is silently ignored here rather than panicking, since a
/// stale resolved path from a prior call is still a valid directory,
/// not corrupt state worth crashing over).
pub fn set_bundled_resource_dir(dir: PathBuf) {
    let _ = BUNDLED_RESOURCE_DIR.set(dir);
}

/// Resolution order:
///
/// 1. **`LYNCEUS_MODELS_DIR` env var** — dev workflow, see below.
/// 2. **Bundled resource dir** (`set_bundled_resource_dir`, release
///    builds only) — the weights shipped inside the signed `.app`,
///    read-only. Only used if the directory actually contains files;
///    an empty or unpopulated resource dir (e.g. a dev build that
///    called `set_bundled_resource_dir` with nothing copied there
///    yet) falls through to tier 3 rather than returning a directory
///    with nothing in it.
/// 3. **`<app_data_dir>/models`** — the historical default/fallback,
///    also where a first-launch download (pre-bundling era) landed.
///
/// This is the resolution that App Store distribution depends on:
/// once `bundle.resources` in `tauri.conf.json` ships the weights and
/// `set_bundled_resource_dir` is wired into `lib.rs`'s setup
/// callback, a fresh install works fully offline from first launch —
/// no first-run download, no App Review risk from network flakiness
/// during review (the concrete failure mode: "reviewer environment
/// hits HuggingFace rate-limiting, app looks non-functional, gets
/// rejected").
pub fn models_dir() -> PathBuf {
    if let Ok(override_path) = std::env::var("LYNCEUS_MODELS_DIR") {
        if !override_path.is_empty() {
            let dir = PathBuf::from(override_path);
            let _ = ensure_dir(&dir);
            return dir;
        }
    }
    if let Some(resource_dir) = BUNDLED_RESOURCE_DIR.get() {
        let has_files = fs::read_dir(resource_dir)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false);
        if has_files {
            return resource_dir.clone();
        }
    }
    let p = app_data_dir().join("models");
    let _ = ensure_dir(&p);
    p
}

/// Resolve the on-disk path for an encoder model at a given precision,
/// falling back to the FP32 original when the requested precision
/// isn't on disk.
///
/// `base_filename` is the FP32 name (e.g. `"clip_vision.onnx"`).
/// `precision` is `"fp16"`, `"int8"`, or anything else (including
/// `"fp32"` and empty string), which all mean "use the FP32 file
/// unchanged" — this makes an unrecognised or missing setting value
/// behave identically to `None`, rather than erroring.
///
/// `scripts/quantize_models.py` writes `<stem>_fp16.onnx` /
/// `<stem>_int8.onnx` next to the original and never touches the
/// original file, so the fallback here is never a lossy operation —
/// worst case the user picked a precision that hasn't been generated
/// yet (they never ran the quantize script, or ran it for a different
/// precision) and gets the original weights instead of a load error.
/// A future pass could surface "quantized variant missing, using
/// fp32" as a one-time settings-drawer notice rather than silently
/// falling back; not done here since there's no UI surface for it yet.
pub fn model_path_for(base_filename: &str, precision: &str) -> PathBuf {
    model_path_for_in(&models_dir(), base_filename, precision)
}

/// Same precision-variant resolution as `model_path_for`, against an
/// explicit directory — for callers that already hold a models dir.
/// The first-launch presence check uses this so "is this model
/// satisfied" is judged by the same rule the loaders use; without it, a
/// store build shipping only int8 files looked perpetually incomplete
/// and tried to download the whole fp32 set on every launch.
pub fn model_path_for_in(
    dir: &std::path::Path,
    base_filename: &str,
    precision: &str,
) -> PathBuf {
    let suffix = match precision {
        "fp16" => "_fp16",
        "int8" => "_int8",
        _ => "",
    };
    if !suffix.is_empty() {
        if let Some(stem) = base_filename.strip_suffix(".onnx") {
            let quantized = dir.join(format!("{stem}{suffix}.onnx"));
            if quantized.exists() {
                return quantized;
            }
        }
    }
    dir.join(base_filename)
}

/// Path to the user-facing settings JSON file. The file may not exist
/// yet on first launch; callers should treat absence as "use defaults."
pub fn settings_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

/// Path to the on-disk cached cosine index (a bincode-encoded
/// Vec<(PathBuf, Vec<f32>)>). Loaded eagerly at app startup if it
/// exists and is fresher than the SQLite DB; populated again from
/// the DB whenever the indexing pipeline finishes encoding.
///
/// Lives in app_data_dir rather than in the DB itself because the
/// embedding BLOB column already holds the canonical data — the cache
/// just speeds up the load path.
pub fn cosine_cache_path() -> PathBuf {
    app_data_dir().join("cosine_cache.bin")
}

/// User-facing exports directory. Anything the user might want to
/// share, archive, or compare goes here:
///   - perf-<unix-ts>/ — profiling sessions written by perf_report
///   - (future) selected-set.csv, query-history.json, etc.
///
/// Lives under app_data_dir() so it follows the same "all generated
/// files in one place" rule as everything else.
pub fn exports_dir() -> PathBuf {
    let p = app_data_dir().join("exports");
    let _ = ensure_dir(&p);
    p
}

fn ensure_dir(path: &PathBuf) -> io::Result<()> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_data_dir_lives_under_platform_data_dir() {
        // app_data_dir() always resolves to <platform_data_dir>/<bundle_id>/
        // regardless of build mode. Verify the basename matches the
        // bundle id (last path segment).
        let dir = app_data_dir();
        assert_eq!(
            dir.file_name().and_then(|s| s.to_str()),
            Some(BUNDLE_ID),
            "app_data_dir basename should be the bundle id, got: {}",
            dir.display()
        );
    }

    // LYNCEUS_DATA_DIR override has no automated test because
    // process-wide env mutation races with the other paths tests when
    // cargo runs them in parallel. The override is a one-line read +
    // PathBuf construct; manual smoke-test from a shell:
    //   LYNCEUS_DATA_DIR=/tmp/foo cargo run --bin lynceus
    // and verify the binary writes images.db under /tmp/foo/.

    #[test]
    fn model_path_for_falls_back_to_fp32_when_quantized_variant_missing() {
        // No quantized file exists on disk for a made-up base name, so
        // every precision should resolve to the same FP32 path.
        let base = "does_not_exist_anywhere.onnx";
        let fp32_path = model_path_for(base, "fp32");
        assert_eq!(model_path_for(base, "fp16"), fp32_path);
        assert_eq!(model_path_for(base, "int8"), fp32_path);
        assert_eq!(model_path_for(base, ""), fp32_path);
        assert_eq!(model_path_for(base, "garbage"), fp32_path);
        assert!(fp32_path.ends_with(base));
    }

    #[test]
    fn model_path_for_prefers_quantized_variant_when_present() {
        // Use the real models_dir() (respects LYNCEUS_MODELS_DIR in
        // dev) and create a throwaway _int8 sibling to prove the
        // preference actually reads the filesystem rather than just
        // string-formatting a name that happens to look right.
        let dir = models_dir();
        let base = "paths_test_temp_model.onnx";
        let int8_path = dir.join("paths_test_temp_model_int8.onnx");
        std::fs::write(&int8_path, b"fake").expect("write temp quantized file");

        let resolved = model_path_for(base, "int8");
        assert_eq!(resolved, int8_path);

        // fp16 wasn't created, so it must still fall back to fp32.
        assert_eq!(model_path_for(base, "fp16"), dir.join(base));

        let _ = std::fs::remove_file(&int8_path);
    }

    #[test]
    fn test_paths_are_under_app_data_dir() {
        let root = app_data_dir();
        assert!(database_path().starts_with(&root));
        assert!(thumbnails_dir().starts_with(&root));
        assert!(models_dir().starts_with(&root));
        assert!(settings_path().starts_with(&root));
    }

    #[test]
    fn thumbnails_dir_for_root_creates_subfolder() {
        // Phase 9 reorganisation — each root gets its own thumbnail
        // subfolder so remove_root can rm -rf it cleanly.
        let dir = thumbnails_dir_for_root(42);
        assert!(dir.exists(), "thumbnails_dir_for_root should create the dir");
        assert_eq!(
            dir.file_name().and_then(|s| s.to_str()),
            Some("root_42")
        );
    }

    #[test]
    fn cosine_cache_path_is_under_app_data_dir() {
        let cache = cosine_cache_path();
        assert!(cache.starts_with(app_data_dir()));
        assert_eq!(
            cache.file_name().and_then(|s| s.to_str()),
            Some("cosine_cache.bin")
        );
    }

    #[test]
    fn test_filenames_are_stable() {
        assert_eq!(
            database_path().file_name().unwrap().to_string_lossy(),
            "images.db"
        );
        assert_eq!(
            settings_path().file_name().unwrap().to_string_lossy(),
            "settings.json"
        );
    }
}
