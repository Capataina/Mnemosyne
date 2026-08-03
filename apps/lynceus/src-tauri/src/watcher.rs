//! Filesystem watcher for live integrity.
//!
//! Watches every enabled root recursively. Filesystem events are
//! debounced (5s default) and trigger an incremental rescan via the
//! indexing pipeline: new image files appear in the DB, files that
//! have disappeared get marked `orphaned = 1` (the orphan column is
//! set by the scan phase of `indexing.rs`, step B — see that file's
//! phase walkthrough).
//!
//! Lifecycle:
//! - `start` runs once during the Tauri setup callback.
//! - The returned debouncer holds the actual watch threads. Dropping
//!   it cancels everything (it's stored in a Tauri-managed state).
//! - `restart` rebuilds the watcher against the CURRENT enabled root
//!   list and swaps it into the managed slot (dropping the old
//!   debouncer cancels its watches). The root mutation commands call
//!   it, so an added root is live-watched immediately and a removed or
//!   paused root stops firing rescans — previously the watch set was
//!   frozen at whatever startup saw until the next app launch.
//!
//! Implementation notes:
//! - notify-debouncer-mini is used because raw notify events can
//!   fire dozens of times per "save" on macOS (every metadata change,
//!   every fsync). 5s of debouncing collapses a typical bulk add
//!   (dropping 100 photos into a folder) into one rescan.
//! - The rescan re-spawns the indexing pipeline. The single-flight
//!   guard in indexing::try_spawn_pipeline means rapid changes during
//!   an in-progress rescan are coalesced — the second event tries to
//!   spawn, gets AlreadyRunning back, and is silently dropped. The
//!   user sees a single rescan covering everything that changed.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::AppHandle;
use tracing::{debug, info, warn};

use crate::indexing;

/// Type alias to keep the Debouncer's full type out of public API
/// signatures (it's gnarly with the watcher backend's generics).
pub type WatcherHandle = Debouncer<notify::RecommendedWatcher>;

/// Spin up watchers for every enabled root path. The returned handle
/// must outlive the app — typically held in a Tauri-managed state
/// struct. Returns None if no roots are enabled or if the underlying
/// notify backend can't be initialised on the current platform.
#[tracing::instrument(name = "watcher.start", skip(app, indexing_state, fusion))]
pub fn start(
    app: AppHandle,
    paths_to_watch: Vec<PathBuf>,
    db_path: String,
    indexing_state: Arc<indexing::IndexingState>,
    fusion: crate::FusionSlots,
) -> Option<WatcherHandle> {
    if paths_to_watch.is_empty() {
        info!("watcher: no enabled roots, skipping watcher init");
        return None;
    }

    let app_for_handler = app.clone();
    let db_path_for_handler = db_path.clone();
    let indexing_state_for_handler = indexing_state.clone();
    let fusion_for_handler = fusion.clone();

    let mut debouncer = match new_debouncer(
        Duration::from_secs(5),
        move |result: DebounceEventResult| {
            // Wrap the event handler in a manual span so each debounce
            // batch gets timed individually. Closure-based callbacks
            // can't carry #[tracing::instrument] directly.
            let _span = tracing::info_span!("watcher.event").entered();
            match result {
                Ok(events) => {
                    debug!(
                        "watcher: {} events received, triggering rescan",
                        events.len()
                    );
                    let _ = indexing::try_spawn_pipeline(
                        app_for_handler.clone(),
                        indexing_state_for_handler.clone(),
                        db_path_for_handler.clone(),
                        fusion_for_handler.clone(),
                    );
                }
                Err(e) => {
                    warn!("watcher debounce error: {e:?}");
                }
            }
        },
    ) {
        Ok(d) => d,
        Err(e) => {
            warn!("could not initialise filesystem watcher: {e}");
            return None;
        }
    };

    let watcher = debouncer.watcher();
    for path in &paths_to_watch {
        match watcher.watch(path, RecursiveMode::Recursive) {
            Ok(()) => info!("watching {} (recursive)", path.display()),
            Err(e) => warn!("could not watch {}: {e}", path.display()),
        }
    }

    Some(debouncer)
}

/// Rebuild the watcher against the CURRENT enabled root list and swap
/// it into the managed slot. The old debouncer drops on assignment,
/// cancelling its watch threads; a debounce callback already in flight
/// may still fire one last rescan, which the single-flight guard in
/// try_spawn_pipeline coalesces harmlessly. Security scopes need no
/// handling here: an added root's picker grant covers this process,
/// and remove_root releases its scope itself.
#[tracing::instrument(name = "watcher.restart", skip_all)]
pub fn restart(
    app: AppHandle,
    db: &crate::db::ImageDatabase,
    db_path: String,
    indexing_state: Arc<indexing::IndexingState>,
    fusion: crate::FusionSlots,
    slot: &std::sync::Mutex<Option<WatcherHandle>>,
) {
    let watch_paths: Vec<PathBuf> = db
        .list_roots()
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.enabled)
        .map(|r| PathBuf::from(r.path))
        .filter(|p| p.exists())
        .collect();
    let handle = start(app, watch_paths, db_path, indexing_state, fusion);
    match slot.lock() {
        Ok(mut s) => {
            *s = handle;
            info!("watcher restarted against current enabled roots");
        }
        Err(e) => warn!("watcher restart skipped, state lock poisoned: {e}"),
    }
}
