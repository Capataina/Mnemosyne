// 6b — relax `clippy::doc_lazy_continuation`. The lint flags
// rustdoc-style bullet lists where a continuation line is not
// indented under its bullet — a stylistic preference that doesn't
// match this codebase's docstring conventions (we use //! and ///
// blocks heavily with consistent left-aligned continuations on
// purpose, for terminal readability with `cargo doc --open` AND
// when the file is read directly). Re-enabling per-line would
// require touching ~10 files with no behavioural value.
#![allow(clippy::doc_lazy_continuation)]

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tracing::{error, info, warn};

use crate::{db::ImageDatabase, indexing::IndexingState};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//
// Media-agnostic modules now live in the Mnemosyne engine crate. They are
// re-exported here under their original crate-root paths so every existing
// `crate::paths::…`, `crate::db::…`, `crate::perf::…` call site keeps
// resolving unchanged — the engine extraction is a move, not an API change.
pub use mnemosyne::{db, image_struct, paths, perf, perf_report, root_struct, tag_struct};

// Product-specific modules — the image encoders, thumbnailer, indexing
// pipeline, watcher, and Tauri command surface — stay in this crate.
pub mod commands;
pub mod filesystem;
pub mod indexing;
pub mod model_download;
#[cfg(target_os = "macos")]
pub mod security_scope;
pub mod settings;
pub mod similarity_and_semantic_search;
mod state;
pub mod thumbnail;
pub mod watcher;

// The managed-state types (`FusionIndexState`, `TextEncoderState`) and
// the two shared managed-state aliases (`FusionSlots`, `WatcherSlot`)
// live in `state.rs` now — address-only extraction, re-exported here so
// every existing `crate::FusionIndexState`/`crate::TextEncoderState`
// call site keeps resolving unchanged [code-health-audit 2026-08-02].
pub use state::{FusionIndexState, FusionSlots, TextEncoderState, WatcherSlot};

/// Startup diagnostics, gated on `perf::is_profiling_enabled()` and a
/// no-op otherwise. Two independent checks: a snapshot of what's on disk
/// and what's already encoded (lets the on-exit report's Diagnostics
/// section show "this session started with X CLIP embeddings, Y
/// SigLIP-2, Z DINOv2" — useful for the "I selected DINOv2 but got 0
/// results" bug class), and a cosine-math sanity check against synthetic
/// vectors with known expected outputs (if this ever returns a
/// surprising number, EVERY semantic-search / similarity result
/// downstream is suspect because the math itself is broken; cheap,
/// ~µs). Factored out of the `run()` setup closure so that closure
/// stays about setup, not diagnostics [code-health-audit 2026-08-02].
fn emit_startup_profiling_diagnostics(db_path: &str) {
    if !perf::is_profiling_enabled() {
        return;
    }

    if let Ok(temp_db) = ImageDatabase::new(db_path) {
        let _ = temp_db.initialize();
        let stats = temp_db.get_pipeline_stats().ok();
        let models_dir = paths::models_dir();
        let model_files: Vec<String> = std::fs::read_dir(&models_dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        perf::record_diagnostic(
            "startup_state",
            serde_json::json!({
                "db_path": db_path,
                "models_dir": models_dir.display().to_string(),
                "model_files_present": model_files,
                "embedding_counts_per_encoder": stats.as_ref().map(|s| {
                    s.with_embedding_per_encoder.iter().map(|e| {
                        serde_json::json!({
                            "encoder_id": e.encoder_id,
                            "count": e.count,
                        })
                    }).collect::<Vec<_>>()
                }),
                "total_images": stats.as_ref().map(|s| s.total_images),
                "with_thumbnail": stats.as_ref().map(|s| s.with_thumbnail),
                "orphaned": stats.as_ref().map(|s| s.orphaned),
            }),
        );
    }

    // Cosine math sanity check — synthetic vectors with known expected
    // outputs.
    {
        use ndarray::Array1;
        use crate::similarity_and_semantic_search::cosine::CosineIndex;
        let a = Array1::from_vec(vec![1.0_f32, 0.0, 0.0]);
        let b = Array1::from_vec(vec![0.0_f32, 1.0, 0.0]);
        let c = Array1::from_vec(vec![1.0_f32, 0.0, 0.0]);
        let d = Array1::from_vec(vec![-1.0_f32, 0.0, 0.0]);
        let zero = Array1::from_vec(vec![0.0_f32, 0.0, 0.0]);
        let high_dim_a: Array1<f32> = Array1::from_vec((0..512).map(|i| (i as f32).sin()).collect());
        let high_dim_b: Array1<f32> = Array1::from_vec((0..512).map(|i| (i as f32).cos()).collect());

        let orthogonal = CosineIndex::cosine_similarity(&a, &b);
        let parallel = CosineIndex::cosine_similarity(&a, &c);
        let opposite = CosineIndex::cosine_similarity(&a, &d);
        let zero_vec = CosineIndex::cosine_similarity(&a, &zero);
        let dim_mismatch = CosineIndex::cosine_similarity(&a, &high_dim_a);
        let high_dim_random = CosineIndex::cosine_similarity(&high_dim_a, &high_dim_b);

        perf::record_diagnostic(
            "cosine_math_sanity",
            serde_json::json!({
                "orthogonal_3d":   { "got": orthogonal,    "expected": 0.0,  "passes": orthogonal.abs() < 1e-5 },
                "parallel_3d":     { "got": parallel,      "expected": 1.0,  "passes": (parallel - 1.0).abs() < 1e-5 },
                "opposite_3d":     { "got": opposite,      "expected": -1.0, "passes": (opposite + 1.0).abs() < 1e-5 },
                "zero_vector_3d":  { "got": zero_vec,      "expected": 0.0,  "passes": zero_vec.abs() < 1e-5 },
                "dim_mismatch":    { "got": dim_mismatch,  "expected": 0.0,  "passes": dim_mismatch.abs() < 1e-5, "note": "3-d vs 512-d should return 0 via guard, not panic" },
                "high_dim_random": { "got": high_dim_random, "expected_range": "[-0.1, 0.1] for sin/cos quasi-orthogonal", "passes": high_dim_random.abs() < 0.2 },
                "interpretation": "All passes=true means cosine math is correct — bad search results are an encoder/data issue, not math.",
            }),
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(db: ImageDatabase, db_path: String) {
    use commands::encoders::{
        get_enabled_encoders, list_available_encoders, set_enabled_encoders,
    };
    use commands::images::{
        clear_all_manual_spans, get_feed_manifest, get_image_details, get_images,
        get_pipeline_stats, get_preview_breakdown, get_thumbnail, purge_orphaned_images, set_manual_col_span,
        set_manual_order,
    };
    use commands::notes::{get_image_notes, set_image_notes};
    use commands::profiling::{
        export_perf_snapshot, get_perf_snapshot, is_profiling_enabled, record_user_action,
        reset_perf_stats,
    };
    use commands::roots::{
        add_root, get_scan_root, list_roots, remove_root, set_root_enabled, set_scan_root,
    };
    use commands::semantic_fused::get_fused_semantic_search;
    use commands::similarity::get_fused_similar_images;
    use commands::tags::{
        add_tag_to_image, create_tag, delete_tag, get_tag_counts, get_tags,
        remove_tag_from_image,
    };

    // Text encoder state (lazy-loaded on first semantic search).
    // Phase 4 — both encoders coexist so the picker can switch
    // dispatch instantly without paying the model-load cost twice.
    let text_encoder_state = TextEncoderState {
        encoder: Mutex::new(None),
        siglip2_encoder: Mutex::new(None),
    };

    // Per-encoder fusion caches — the ONLY resident embedding cache now
    // (T3-2/#8): every search command borrows these slots, and the
    // indexing pipeline refreshes + persists them at Ready. The old
    // duplicate primary cache is gone entirely. Clone the
    // slot Arc for the warm thread + the pipeline/watcher wiring below,
    // before `fusion_state` is moved into `.manage()`.
    let fusion_state = FusionIndexState::new();
    let fusion_slots = fusion_state.per_encoder.clone();

    // Pre-warm the per-encoder fusion slots in the background right at
    // launch (mapping the persisted flat stores), so the first similarity
    // click — and the frontend's prefetch burst across every on-screen
    // tile — is instant on a cold session.
    state::spawn_cache_warm(db_path.clone(), fusion_slots.clone());

    // Single-flight guard for the indexing pipeline. Wrapped in Arc so
    // the .setup() callback (and later set_scan_root commands) can both
    // hand a clone to the indexing thread.
    let indexing_state = Arc::new(IndexingState::new());

    // Filesystem watcher handle is stashed here so it lives for the
    // duration of the app process. Dropping the handle cancels every
    // watch; we wrap in Mutex<Option<...>> so the setup callback can
    // initialise it (or replace it later if root list changes).
    let watcher_state: WatcherSlot = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db)
        .manage(text_encoder_state)
        .manage(fusion_state)
        .manage(indexing_state.clone())
        .manage(watcher_state.clone())
        .setup({
            let db_path = db_path.clone();
            let fusion_slots = fusion_slots.clone();
            let indexing_state = indexing_state.clone();
            let watcher_state = watcher_state.clone();
            move |app| {
                // Resolve the bundled models/ resource dir (release
                // builds only — tauri.conf.json's bundle.resources
                // copies it into Contents/Resources/ on macOS, alongside
                // the equivalent on other platforms) and register it
                // with the engine crate's models_dir() resolution, so
                // a shipped .app loads its own weights instead of
                // requiring a first-launch download. Dev builds have
                // no bundle at all, so `resolve` returning Err here is
                // the expected, silent, no-op case, not a startup
                // failure — LYNCEUS_MODELS_DIR (dev) or the app-data
                // fallback (an unbundled release build, which
                // shouldn't happen for a real Mac App Store artifact
                // but degrades gracefully rather than crashing if it
                // does) still resolve models_dir() correctly either way.
                if let Ok(resource_models_dir) = app
                    .path()
                    .resolve("models", tauri::path::BaseDirectory::Resource)
                {
                    paths::set_bundled_resource_dir(resource_models_dir);
                }

                // Startup diagnostics (profiling-only) — factored into a
                // file-local fn so the setup closure stays about setup,
                // not diagnostics [code-health-audit 2026-08-02].
                emit_startup_profiling_diagnostics(&db_path);

                // One-shot legacy migration: if the user upgraded from
                // a single-folder build, settings.json has a `scan_root`
                // field but the new `roots` table is empty. Convert it
                // here so the indexing pipeline (which only reads roots
                // table) sees the user's existing folder.
                {
                    let user_settings = settings::Settings::load();
                    if let Some(legacy_path) = user_settings.scan_root.clone() {
                        if let Ok(temp_db) = ImageDatabase::new(&db_path) {
                            let _ = temp_db.initialize();
                            match temp_db.migrate_legacy_scan_root(
                                legacy_path.to_string_lossy().into_owned(),
                            ) {
                                Ok(Some(root)) => {
                                    info!(
                                        "migrated legacy scan_root -> roots[{}] ({})",
                                        root.id, root.path
                                    );
                                    // Clear the legacy field so we don't
                                    // re-migrate on every launch.
                                    let mut s = user_settings.clone();
                                    s.scan_root = None;
                                    let _ = s.save();
                                }
                                Ok(None) => {} // already migrated previously
                                Err(e) => warn!("legacy migration failed: {e}"),
                            }
                        }
                    }
                }

                // Auto-spawn the indexing pipeline at app startup. This
                // refreshes the catalog whenever the user reopens the
                // app — picks up new images, regenerates missing
                // thumbnails, encodes anything missing.
                let app_handle = app.handle().clone();
                if let Err(e) = indexing::try_spawn_pipeline(
                    app_handle.clone(),
                    indexing_state.clone(),
                    db_path.clone(),
                    fusion_slots.clone(),
                ) {
                    error!("could not spawn indexing pipeline: {e}");
                }

                // Start the filesystem watcher. Listens to every
                // currently-enabled root and triggers a debounced
                // rescan when files change on disk.
                {
                    let temp_db = ImageDatabase::new(&db_path);

                    // Resolve every enabled root's security-scoped
                    // bookmark and start accessing it BEFORE the
                    // watcher or the indexing pipeline touch that
                    // path — under App Sandbox, nothing below this
                    // point can see the folder otherwise. Not paired
                    // with a matching stop_accessing here: this scope
                    // needs to stay open for the app's whole session,
                    // released only when a root is disabled/removed
                    // (commands/roots.rs) or the process exits (the OS
                    // reclaims every open scope automatically). A
                    // resolve failure is logged and that root is
                    // simply skipped — same degraded-but-not-fatal
                    // handling as a missing model file elsewhere in
                    // this same setup callback; the rest of the app
                    // still starts.
                    #[cfg(target_os = "macos")]
                    if let Ok(d) = &temp_db {
                        for (path, bookmark) in d.enabled_roots_with_bookmarks().unwrap_or_default() {
                            match crate::security_scope::start_accessing(&bookmark) {
                                Ok((resolved, is_stale)) => {
                                    if is_stale {
                                        warn!(
                                            "security-scoped bookmark for {path} resolved but is stale; \
                                             it should be re-created from {} soon",
                                            resolved.display()
                                        );
                                    }
                                }
                                Err(e) => warn!(
                                    "could not start security-scoped access for root {path}: {e}"
                                ),
                            }
                        }
                    }

                    let watch_paths: Vec<std::path::PathBuf> = match temp_db {
                        Ok(d) => d
                            .list_roots()
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|r| r.enabled)
                            .map(|r| std::path::PathBuf::from(r.path))
                            .filter(|p| p.exists())
                            .collect(),
                        Err(_) => vec![],
                    };
                    let handle = watcher::start(
                        app_handle,
                        watch_paths,
                        db_path,
                        indexing_state,
                        fusion_slots,
                    );
                    if let Ok(mut slot) = watcher_state.lock() {
                        *slot = handle;
                    }
                }
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_images,
            get_feed_manifest,
            get_image_details,
            get_pipeline_stats,
            get_preview_breakdown,
            get_thumbnail,
            set_manual_order,
            set_manual_col_span,
            clear_all_manual_spans,
            purge_orphaned_images,
            list_available_encoders,
            get_enabled_encoders,
            set_enabled_encoders,
            get_tags,
            get_tag_counts,
            create_tag,
            delete_tag,
            add_tag_to_image,
            remove_tag_from_image,
            get_fused_similar_images,
            get_fused_semantic_search,
            get_scan_root,
            set_scan_root,
            list_roots,
            add_root,
            remove_root,
            set_root_enabled,
            get_image_notes,
            set_image_notes,
            is_profiling_enabled,
            get_perf_snapshot,
            reset_perf_stats,
            export_perf_snapshot,
            record_user_action,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // RunEvent::Exit fires when the last window closes and the
            // app is genuinely shutting down. This is our last chance
            // to render the markdown report from the timeline.jsonl
            // that's been accumulating during the session.
            //
            // We deliberately don't render on ExitRequested — that
            // fires before windows are torn down and could be cancelled.
            // Exit is the point of no return, and the flush thread is
            // about to die with the process anyway.
            //
            // No-op when profiling isn't enabled (no session dir, no
            // timeline file, nothing to report).
            if let tauri::RunEvent::Exit = event {
                if perf::is_profiling_enabled() {
                    if let Some(dir) = perf::session_dir() {
                        match perf_report::render_session_report(&dir) {
                            Ok(_) => {
                                // Use eprintln rather than tracing here
                                // — the subscriber may already be tearing
                                // down at exit, and we want this line to
                                // make it to the terminal regardless.
                                eprintln!(
                                    "profiling report written to {}",
                                    dir.display()
                                );
                            }
                            Err(e) => {
                                eprintln!("failed to write profiling report: {e}");
                            }
                        }
                    }
                }
            }
        });
}
