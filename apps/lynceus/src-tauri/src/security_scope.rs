//! macOS App Sandbox security-scoped bookmarks.
//!
//! **Not yet verified under a real sandboxed build.** Written against
//! `objc2-foundation`'s generated `NSURL` bindings (method signatures
//! confirmed by reading the crate's generated source, not guessed)
//! and against Apple's documented `NSURL` bookmark API contract, but
//! this project has no signed, entitled Mac App Store build to run it
//! against in the environment this was written in — App Sandbox only
//! actually enforces (and therefore only genuinely tests) the access
//! restriction this module exists to work around once the app is
//! built with `com.apple.security.app-sandbox` and
//! `com.apple.security.files.bookmarks.app-scope` entitlements and
//! launched from a proper code-signed bundle. Compiles and the
//! non-sandboxed dev-mode path (plain filesystem access, bookmarks
//! created and resolved but never actually gated by anything) has
//! been exercised; the actual sandbox-gated behaviour has not.
//!
//! ## Why this exists
//!
//! Outside its own container (`~/Library/Containers/com.ataca.lynceus/
//! Data/`), a sandboxed app has no filesystem access by default — not
//! even to a folder the user explicitly picked, past the current
//! process's lifetime. When the user picks a folder via the native
//! file dialog, macOS grants the *process* temporary access to that
//! folder; without doing anything further, that access is gone the
//! moment the app relaunches, and the user would have to re-pick every
//! root folder on every single launch. A **security-scoped bookmark**
//! is how you turn that one-time grant into something you can persist
//! (as opaque bytes, e.g. a BLOB column next to the plain path string
//! in the `roots` table) and later resolve back into working access —
//! without prompting the user again.
//!
//! ## The three operations
//!
//! 1. [`create_bookmark`] — called once, synchronously, right after
//!    the user picks a folder via the dialog (while the sandbox's
//!    temporary grant for that folder is still active). Returns the
//!    bookmark bytes to persist.
//! 2. [`start_accessing`] — called once per app launch, for every
//!    enabled root, before the watcher or scanner touches that path.
//!    Resolves the persisted bookmark back to a URL and calls
//!    `startAccessingSecurityScopedResource`. Deliberately **not**
//!    paired with an immediate `stopAccessingSecurityScopedResource`
//!    — the access needs to stay open for as long as the app is
//!    indexing/watching that folder, i.e. for the app's session
//!    lifetime, not for one file read. [`stop_accessing`] exists for
//!    the one case that does need it: the user disabling or removing
//!    a root.
//! 3. [`stop_accessing`] — release the scope explicitly when a root is
//!    disabled/removed, so a stale, no-longer-needed grant doesn't
//!    linger for the rest of the process's life.
//!
//! ## What this module does NOT do
//!
//! It doesn't touch the file dialog itself (Tauri's `dialog` plugin,
//! already in use for "Add folder", already goes through `NSOpenPanel`
//! and already gets the sandbox grant `create_bookmark` depends on —
//! no change needed there). It doesn't decide *when* to call these
//! functions — that's the `roots`-table wiring in `commands/roots.rs`
//! and the startup path in `lib.rs`, tracked as follow-up work, not
//! done in this pass. And on non-macOS targets this whole module is
//! compiled out (`#[cfg(target_os = "macos")]` at the call sites) —
//! there is no App Sandbox concept anywhere else Tauri could target.

use std::path::{Path, PathBuf};

use objc2::rc::Retained;
use objc2_foundation::{
    NSData, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
};

/// Create a security-scoped bookmark for `path`.
///
/// Must be called while the process still holds sandbox access to
/// `path` — in practice, synchronously in the callback for the file
/// dialog that let the user pick it. Calling this on a path the
/// process has no current access to (e.g. an arbitrary path typed in
/// rather than picked via the dialog) will fail with an `NSError`
/// from the underlying Cocoa call, surfaced here as `Err`.
///
/// Returns the opaque bookmark bytes — store these, not just the
/// plain path, if the app is sandboxed. In an unsandboxed dev build
/// this still works (bookmarks are a general NSURL feature, not
/// sandbox-exclusive) but buys nothing extra, since dev builds have
/// unrestricted filesystem access regardless.
pub fn create_bookmark(path: &Path) -> Result<Vec<u8>, String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| format!("path is not valid UTF-8: {}", path.display()))?;
    let ns_path = NSString::from_str(path_str);
    let url: Retained<NSURL> = NSURL::fileURLWithPath(&ns_path);

    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| format!("bookmarkDataWithOptions failed for {}: {e:?}", path.display()))?;

    Ok(data.to_vec())
}

/// Resolve a persisted bookmark back to a filesystem path and begin
/// accessing it. Returns the resolved path and whether the bookmark
/// was stale (the OS still resolved it — e.g. the folder was moved
/// but not deleted — but the caller should re-create and re-persist
/// the bookmark from the resolved path soon, or the next resolve may
/// fail outright).
///
/// The returned `bool` from `startAccessingSecurityScopedResource` is
/// checked and turned into an `Err` on `false` rather than silently
/// proceeding — a `false` here means the OS did NOT grant access
/// despite a successfully-resolved bookmark (a real, documented case:
/// e.g. the bookmark's security scope was already exhausted, or the
/// resource was revoked), and continuing to scan/watch the path
/// anyway would just fail more confusingly deeper in the pipeline
/// with an opaque filesystem permission error instead of this clear
/// one at the point where the real cause is known.
pub fn start_accessing(bookmark_data: &[u8]) -> Result<(PathBuf, bool), String> {
    let ns_data = NSData::with_bytes(bookmark_data);
    let mut is_stale = objc2::runtime::Bool::NO;

    let url: Retained<NSURL> = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &ns_data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut is_stale,
        )
    }
    .map_err(|e| format!("failed to resolve security-scoped bookmark: {e:?}"))?;

    let granted = unsafe { url.startAccessingSecurityScopedResource() };
    if !granted {
        return Err(format!(
            "startAccessingSecurityScopedResource returned false for a resolved bookmark \
             (path: {:?}) — the OS declined to grant access",
            url.path().map(|p| p.to_string())
        ));
    }

    let resolved_path = url
        .path()
        .map(|p| PathBuf::from(p.to_string()))
        .ok_or_else(|| "resolved NSURL has no path component".to_string())?;

    Ok((resolved_path, is_stale.as_bool()))
}

/// Release a previously-started security scope. Call when a root is
/// disabled or removed — not on every file operation, and not paired
/// 1:1 with every `start_accessing` call at shutdown (the OS reclaims
/// all security scopes when the process exits regardless).
///
/// Takes the same bookmark bytes `start_accessing` was given, not a
/// path — re-resolving the bookmark is required because
/// `stopAccessingSecurityScopedResource` must be called on the same
/// **kind** of NSURL object the scope was started on; there's no
/// "stop by path" API. Re-resolving here does not re-grant a new
/// scope by itself; it materialises the same NSURL identity so the
/// stop call has something valid to act on.
pub fn stop_accessing(bookmark_data: &[u8]) -> Result<(), String> {
    let ns_data = NSData::with_bytes(bookmark_data);
    let mut is_stale = objc2::runtime::Bool::NO;

    let url: Retained<NSURL> = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &ns_data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut is_stale,
        )
    }
    .map_err(|e| format!("failed to resolve security-scoped bookmark for stop: {e:?}"))?;

    unsafe { url.stopAccessingSecurityScopedResource() };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // No automated test creates a REAL security-scoped bookmark and
    // proves the sandbox actually gates access without one — that
    // needs a signed, entitled bundle (see the module doc comment).
    // This test covers what's mechanically checkable without one:
    // bookmark creation + resolution round-trips to the same path
    // when the process (unsandboxed, as this test runs) already has
    // ordinary access to it. It proves the FFI plumbing (NSString
    // conversion, NSData round-trip, the four Cocoa calls) is wired
    // correctly; it does NOT prove sandbox enforcement, because there
    // is no sandbox enforcing anything in a `cargo test` process.
    #[test]
    fn bookmark_round_trips_to_the_same_path_outside_a_sandbox() {
        let dir = std::env::temp_dir();
        let bookmark = create_bookmark(&dir).expect("create_bookmark should succeed for an accessible path");
        assert!(!bookmark.is_empty(), "bookmark data should not be empty");

        let (resolved_path, is_stale) =
            start_accessing(&bookmark).expect("start_accessing should resolve the bookmark just created");
        assert!(!is_stale, "a freshly-created bookmark should not resolve as stale");

        // std::env::temp_dir() on macOS is itself often a symlink
        // (e.g. /var -> /private/var), and NSURL resolves through
        // that — canonicalize both sides before comparing so the
        // assertion is about the bookmark round-trip, not about
        // whether macOS's temp dir happens to already be symlink-free
        // on the machine running the test.
        let expected = dir.canonicalize().unwrap_or(dir);
        let actual = resolved_path.canonicalize().unwrap_or(resolved_path);
        assert_eq!(actual, expected);

        stop_accessing(&bookmark).expect("stop_accessing should resolve the same bookmark cleanly");
    }
}
