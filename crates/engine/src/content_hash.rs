//! Full-content hashing for move/rename detection.
//!
//! When a file is renamed or moved between folders, its filesystem path
//! changes but its bytes do not. Image identity in the catalogue is the
//! path (`images.path UNIQUE`), so a move would otherwise orphan the old
//! row and insert the new path as a brand-new id — stranding the moved
//! file's tags, masonry placement, and embeddings (see the diagnosis in
//! `context/notes/image-identity-orphan-lifecycle.md`).
//!
//! `hash_file` gives every image a stable content fingerprint. The scan
//! pipeline stores it (`db::ImageDatabase::set_content_hash`) and looks
//! it up (`db::ImageDatabase::relink_or_insert`) so a moved file is
//! matched back to its orphaned row and updated in place — the row id
//! survives, so everything attached to it survives too.
//!
//! BLAKE3 over SHA-256 here for throughput: this runs once per file
//! during the scan, and the whole library is hashed on first index.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// Read a file fully and return its BLAKE3 hash (32 bytes) and byte size.
///
/// The file is streamed through a fixed read buffer rather than loaded
/// whole, so hashing a large asset never allocates its full length in
/// memory. The returned size is the exact number of bytes read, which is
/// the value stored alongside the hash as a cheap pre-filter on the
/// relink lookup (`WHERE size = ? AND content_hash = ?`).
pub fn hash_file(path: &Path) -> std::io::Result<([u8; 32], u64)> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = blake3::Hasher::new();
    let mut buf = [0u8; 64 * 1024];
    let mut size: u64 = 0;

    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }

    let hash: [u8; 32] = *hasher.finalize().as_bytes();
    Ok((hash, size))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Identical byte sequences must hash equal (so a moved file matches
    /// its orphaned row) and differing bytes must diverge (so an edited
    /// file is not mistaken for the original). The size must also track
    /// the exact byte count, since it participates in the relink WHERE.
    #[test]
    fn identical_bytes_hash_equal_and_differing_bytes_differ() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.bin");
        let b = dir.path().join("b.bin");
        let c = dir.path().join("c.bin");

        let mut fa = File::create(&a).unwrap();
        fa.write_all(b"the same eleven").unwrap();
        let mut fb = File::create(&b).unwrap();
        fb.write_all(b"the same eleven").unwrap();
        let mut fc = File::create(&c).unwrap();
        fc.write_all(b"a different set of bytes").unwrap();

        let (ha, sa) = hash_file(&a).unwrap();
        let (hb, sb) = hash_file(&b).unwrap();
        let (hc, sc) = hash_file(&c).unwrap();

        assert_eq!(ha, hb, "identical byte sequences must hash equal");
        assert_eq!(sa, sb, "identical byte sequences must report equal size");
        assert_eq!(sa, 15, "size must be the exact byte count");
        assert_ne!(ha, hc, "differing bytes must produce a different hash");
        assert_eq!(sc, 24);
    }
}
