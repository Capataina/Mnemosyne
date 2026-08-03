//! Guard for the needs-set path contract established 2026-08-03.
//!
//! `get_images_without_thumbnails` returns each row's path EXACTLY as stored
//! (`images.path`, the raw string) — it must never canonicalize. The indexing
//! pipeline keys `path_to_root` (from `get_paths_to_root_ids`) on the same raw
//! strings, so thumbnail generation resolves the owning root, and therefore the
//! per-root thumbnail directory, only if both sides use identical keys.
//!
//! History: the pre-audit implementation returned `ImageData::new(...)`, whose
//! constructor canonicalized the path when the file existed. Under any
//! symlinked path component (macOS `/tmp` -> `/private/tmp`, `/var`,
//! network mounts) the canonical form missed the raw-keyed root map, and the
//! thumbnail silently landed in the flat legacy location instead of its
//! `root_<id>/` directory. The 2026-08-02 audit's needs-set rewrite dropped
//! the canonicalization; the verification pass classified that as a deliberate
//! consistency fix rather than a regression, and this test pins the contract
//! so neither side of the raw-key agreement drifts again.

use mnemosyne::db::ImageDatabase;
use std::fs;

#[test]
fn needs_set_paths_are_raw_stored_strings_matching_root_map_keys() {
    let dir = std::env::temp_dir().join(format!("cha_rawpath_{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let real = dir.join("real_root");
    fs::create_dir_all(&real).unwrap();
    let link = dir.join("linked_root");
    #[cfg(unix)]
    {
        let _ = fs::remove_file(&link);
        std::os::unix::fs::symlink(&real, &link).unwrap();
    }
    #[cfg(not(unix))]
    let link = real.clone();

    // A real file reachable through the symlinked (non-canonical) path, so the
    // old ImageData::new canonicalize() branch would have rewritten it.
    let file_real = real.join("img.jpg");
    fs::write(&file_real, b"jpegish").unwrap();
    let stored_path = link.join("img.jpg").to_string_lossy().to_string();

    let db = ImageDatabase::new(":memory:").unwrap();
    db.initialize().unwrap();
    let root = db
        .add_root(link.to_string_lossy().to_string(), None)
        .unwrap();
    db.add_image(stored_path.clone(), Some(root.id)).unwrap();

    let needs = db.get_images_without_thumbnails().unwrap();
    assert_eq!(needs.len(), 1);
    // The contract: byte-identical to the stored string, no canonicalization.
    assert_eq!(needs[0].path, stored_path);

    // And the raw-key agreement the pipeline relies on: the needs-row path is
    // a direct hit in the root map, so the owning root (and with it the
    // per-root thumbnail directory) resolves.
    let root_map = db.get_paths_to_root_ids().unwrap();
    assert_eq!(root_map.get(&needs[0].path), Some(&Some(root.id)));

    let _ = fs::remove_dir_all(&dir);
}
