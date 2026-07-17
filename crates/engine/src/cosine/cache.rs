//! Persisted flat embedding store (T3-2 / #8 + #20).
//!
//! One file per encoder, `app_data_dir()/embstore_<encoder_id>.bin`,
//! with a fixed 64-byte header followed by the id table, the inverse-norm
//! table, and the row-major f32 block. Loaded via `mmap` so a warm launch
//! pages the block in on demand (clean, file-backed, OS-evictable)
//! instead of the old bincode path's deserialise-into-fresh-allocations.
//!
//! Freshness is a **generation token** (`db::embedding_generation_token`),
//! not the bare mtime the old `cosine_cache.bin` used — mtime cannot tell
//! a root toggle from a no-op and silently serves the wrong population at
//! scale. Any header-field mismatch (magic, version, encoder, dim/row via
//! file-length, or token) is detected and the store is rebuilt from the DB.
//!
//! Layout (little-endian; native — the app is desktop LE only, and a
//! zero-copy f32 cast is inherently native-endian):
//! ```text
//! 0    8   magic  b"LYNEMB01"
//! 8    4   format_version u32
//! 12   4   _pad
//! 16   8   encoder_hash u64 (FNV-1a of encoder_id)
//! 24   4   dim u32
//! 28   4   row_count u32
//! 32   8   gen_token u64
//! 40   24  reserved (zeroed)  → header is exactly 64 bytes
//! 64        row_count*8  id table (i64)
//! ...       row_count*4  inv_norm table (f32)
//! ...       pad → next 64-byte boundary (so the block is 64-aligned)
//! ...       row_count*dim*4  embedding block (f32)
//! ```

use super::index::CosineIndex;
use super::store::{Block, FlatStore};
use crate::db::ImageDatabase;
use crate::paths;
use memmap2::Mmap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{info, warn};

const MAGIC: [u8; 8] = *b"LYNEMB01";
const FORMAT_VERSION: u32 = 1;
const HEADER_LEN: usize = 64;

/// FNV-1a of an encoder id — a fixed-size stand-in for the (variable-
/// length) id in the header, cross-checking the filename.
fn fnv1a_str(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in s.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// `app_data_dir()/embstore_<encoder_id>.bin`, with the encoder id
/// sanitised to `[A-Za-z0-9_]` (the ids are fixed slugs like
/// `clip_vit_b_32`, but never build a path from an unsanitised string).
fn embstore_path(encoder_id: &str) -> PathBuf {
    let safe: String = encoder_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    paths::app_data_dir().join(format!("embstore_{safe}.bin"))
}

#[inline]
fn round_up_64(n: usize) -> usize {
    (n + 63) & !63
}

impl CosineIndex {
    /// Persist the active-encoder store to disk (called by the indexing
    /// pipeline after it populates the priority encoder). Writes the flat
    /// store for `self.encoder_id`; a hand-built index with no encoder id
    /// (pure `add_image`) is skipped — there is nothing to key the file on.
    pub fn save_to_disk(&self) {
        match &self.encoder_id {
            Some(enc) => self.save_store_for(enc),
            None => warn!("save_to_disk: index has no encoder_id; skipping store write"),
        }
    }

    /// Write the flat store for `encoder_id` to its canonical path.
    pub fn save_store_for(&self, encoder_id: &str) {
        self.save_store_to(&embstore_path(encoder_id), encoder_id);
    }

    /// Path-explicit store writer (tests write into a tempdir). Serialises
    /// header + id table + inv-norm table + f32 block, via a temp file +
    /// atomic rename so a torn write is never mmap'd. Non-fatal on error.
    pub fn save_store_to(&self, path: &Path, encoder_id: &str) {
        let store = &self.cached_images;
        let rows = store.len();
        let dim = store.dim();

        let id_bytes: &[u8] = bytemuck::cast_slice(store.ids());
        let norm_bytes: &[u8] = bytemuck::cast_slice(store.inv_norms());
        let block_bytes: &[u8] = bytemuck::cast_slice(store.block());

        let id_off = HEADER_LEN;
        let norm_off = id_off + id_bytes.len();
        let block_off = round_up_64(norm_off + norm_bytes.len());
        let total = block_off + block_bytes.len();

        let mut buf = vec![0u8; total];
        buf[0..8].copy_from_slice(&MAGIC);
        buf[8..12].copy_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf[16..24].copy_from_slice(&fnv1a_str(encoder_id).to_le_bytes());
        buf[24..28].copy_from_slice(&(dim as u32).to_le_bytes());
        buf[28..32].copy_from_slice(&(rows as u32).to_le_bytes());
        buf[32..40].copy_from_slice(&self.gen_token.to_le_bytes());
        buf[id_off..norm_off].copy_from_slice(id_bytes);
        buf[norm_off..norm_off + norm_bytes.len()].copy_from_slice(norm_bytes);
        buf[block_off..block_off + block_bytes.len()].copy_from_slice(block_bytes);

        let tmp = path.with_extension("tmp");
        match fs::write(&tmp, &buf).and_then(|_| fs::rename(&tmp, path)) {
            Ok(_) => info!(
                "embedding store saved to {} ({rows} rows, dim {dim}, token {:#x})",
                path.display(),
                self.gen_token
            ),
            Err(e) => {
                warn!("embedding store write failed: {e}");
                let _ = fs::remove_file(&tmp);
            }
        }
    }

    /// Load the flat store for `encoder_id` from disk IF it exists and its
    /// header + generation token match the current DB population. Returns
    /// true on a successful zero-copy (or copied-fallback) load; false
    /// otherwise (caller falls back to `populate_from_db_for_encoder`).
    pub fn load_store_if_valid(&mut self, db: &ImageDatabase, encoder_id: &str) -> bool {
        let expected_token = match db.embedding_generation_token(encoder_id) {
            Ok(t) => t,
            Err(e) => {
                warn!("load_store_if_valid: token query failed for {encoder_id}: {e}");
                return false;
            }
        };
        let expected_hash = fnv1a_str(encoder_id);
        match load_flat_store(&embstore_path(encoder_id), expected_hash, expected_token) {
            Some(store) => {
                self.cached_images = store;
                self.encoder_id = Some(encoder_id.to_string());
                self.gen_token = expected_token;
                info!(
                    "embedding store mapped for {encoder_id}: {} rows",
                    self.cached_images.len()
                );
                true
            }
            None => false,
        }
    }

}

/// Parsed loader shared by `load_store_if_valid` and the format tests.
/// Returns a populated `FlatStore` only when every header field is
/// consistent AND the encoder hash + generation token match the caller's
/// expectations. The f32 block is mapped zero-copy when 4-byte aligned
/// (the layout guarantees it, on top of the page-aligned mmap base) and
/// copied into an owned buffer otherwise.
fn load_flat_store(path: &Path, expected_hash: u64, expected_token: u64) -> Option<FlatStore> {
    let file = fs::File::open(path).ok()?;
    // SAFETY: standard mmap-of-a-file caveat (external truncation is UB).
    // The file lives in our own app-data dir and is only replaced via
    // atomic rename, never truncated in place.
    let mmap = unsafe { Mmap::map(&file).ok()? };
    let bytes: &[u8] = &mmap;
    if bytes.len() < HEADER_LEN {
        return None;
    }

    if bytes[0..8] != MAGIC {
        return None;
    }
    if u32::from_le_bytes(bytes[8..12].try_into().ok()?) != FORMAT_VERSION {
        return None;
    }
    let encoder_hash = u64::from_le_bytes(bytes[16..24].try_into().ok()?);
    if encoder_hash != expected_hash {
        return None;
    }
    let dim = u32::from_le_bytes(bytes[24..28].try_into().ok()?) as usize;
    let rows = u32::from_le_bytes(bytes[28..32].try_into().ok()?) as usize;
    let gen_token = u64::from_le_bytes(bytes[32..40].try_into().ok()?);
    if gen_token != expected_token {
        return None;
    }

    // Reconstruct the section offsets from dim/rows and verify the file
    // is exactly long enough — this is the check that catches a corrupt
    // dim/row_count (the header's size fields disagreeing with reality).
    let id_off = HEADER_LEN;
    let id_len = rows.checked_mul(8)?;
    let norm_off = id_off + id_len;
    let norm_len = rows.checked_mul(4)?;
    let block_off = round_up_64(norm_off + norm_len);
    let block_len = rows.checked_mul(dim)?.checked_mul(4)?;
    if bytes.len() < block_off + block_len {
        return None;
    }

    // Id + inv-norm tables are small (12 B/row); copy them into owned
    // Vecs. Both are naturally aligned given the 64-byte header.
    let ids: Vec<i64> = bytemuck::try_cast_slice::<u8, i64>(&bytes[id_off..id_off + id_len])
        .ok()?
        .to_vec();
    let inv_norms: Vec<f32> =
        bytemuck::try_cast_slice::<u8, f32>(&bytes[norm_off..norm_off + norm_len])
            .ok()?
            .to_vec();

    // The block is the big win: map it zero-copy when the absolute
    // address is 4-aligned (guaranteed by the 64-aligned block_off on top
    // of the page-aligned mmap base). Fall back to an owned copy if some
    // exotic target ever violates that, rather than fail the load.
    let block_ptr = unsafe { bytes.as_ptr().add(block_off) } as usize;
    let block = if block_ptr.is_multiple_of(std::mem::align_of::<f32>()) {
        Block::Mapped {
            mmap: Arc::new(mmap),
            byte_start: block_off,
            byte_len: block_len,
        }
    } else {
        warn!("embedding store block not f32-aligned; copying (no zero-copy)");
        let floats: Vec<f32> = bytes[block_off..block_off + block_len]
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        Block::Owned(floats)
    };

    Some(FlatStore::from_parts(dim, ids, inv_norms, block))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::array;

    /// Build a small index with a known token, save it, and return the
    /// path it was written to plus the encoder hash used.
    fn write_fixture(dir: &Path, encoder: &str, token: u64) -> (PathBuf, u64) {
        let mut idx = CosineIndex::new();
        idx.add_image(10, array![3.0, 4.0, 0.0]); // |v| = 5
        idx.add_image(20, array![0.0, 0.0, 2.0]); // |v| = 2
        idx.add_image(30, array![1.0, 1.0, 1.0]);
        idx.gen_token = token;
        let path = dir.join("store.bin");
        idx.save_store_to(&path, encoder);
        (path, fnv1a_str(encoder))
    }

    #[test]
    fn store_round_trip_ids_norms_embeddings() {
        let dir = tempfile::tempdir().unwrap();
        let token = 0xdead_beef;
        let (path, hash) = write_fixture(dir.path(), "clip_vit_b_32", token);

        let store = load_flat_store(&path, hash, token).expect("valid store must load");
        // Zero-copy verdict: the block must be a mmap view, not a copy —
        // the 64-aligned block offset on a page-aligned base guarantees it.
        assert!(store.is_mapped(), "block must be mmap'd zero-copy, not copied");
        assert_eq!(store.dim(), 3);
        assert_eq!(store.len(), 3);
        assert_eq!(store.ids(), &[10, 20, 30]);
        // Inverse norms round-trip exactly (bit-for-bit f32).
        let inv = store.inv_norms();
        assert!((inv[0] - 1.0 / 5.0).abs() < 1e-7);
        assert!((inv[1] - 1.0 / 2.0).abs() < 1e-7);
        // Embedding block round-trips exactly.
        assert_eq!(store.row(0), &[3.0, 4.0, 0.0]);
        assert_eq!(store.row(1), &[0.0, 0.0, 2.0]);
        assert_eq!(store.row(2), &[1.0, 1.0, 1.0]);
    }

    #[test]
    fn store_rejected_on_token_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let (path, hash) = write_fixture(dir.path(), "clip_vit_b_32", 111);
        // Same file, but the DB now reports a different generation → stale.
        assert!(load_flat_store(&path, hash, 222).is_none());
        // Matching token still loads (control).
        assert!(load_flat_store(&path, hash, 111).is_some());
    }

    #[test]
    fn store_rejected_on_encoder_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let (path, _hash) = write_fixture(dir.path(), "clip_vit_b_32", 111);
        // Loading with a DIFFERENT encoder's hash must refuse (never serve
        // one encoder's vectors as another's — the wrong-dimension trap).
        let other = fnv1a_str("siglip2_base");
        assert!(load_flat_store(&path, other, 111).is_none());
    }

    #[test]
    fn store_rejected_on_bad_magic() {
        let dir = tempfile::tempdir().unwrap();
        let (path, hash) = write_fixture(dir.path(), "clip_vit_b_32", 111);
        let mut bytes = fs::read(&path).unwrap();
        bytes[0] = b'X'; // corrupt magic
        fs::write(&path, &bytes).unwrap();
        assert!(load_flat_store(&path, hash, 111).is_none());
    }

    #[test]
    fn store_rejected_on_version_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let (path, hash) = write_fixture(dir.path(), "clip_vit_b_32", 111);
        let mut bytes = fs::read(&path).unwrap();
        bytes[8] = 99; // bump format_version LSB
        fs::write(&path, &bytes).unwrap();
        assert!(load_flat_store(&path, hash, 111).is_none());
    }

    #[test]
    fn store_rejected_on_corrupt_dim_length() {
        let dir = tempfile::tempdir().unwrap();
        let (path, hash) = write_fixture(dir.path(), "clip_vit_b_32", 111);
        let mut bytes = fs::read(&path).unwrap();
        // Inflate dim so row_count*dim*4 exceeds the actual file length —
        // the dim/row header fields no longer agree with reality.
        bytes[24] = 255;
        fs::write(&path, &bytes).unwrap();
        assert!(load_flat_store(&path, hash, 111).is_none());
    }

    #[test]
    fn store_missing_file_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.bin");
        assert!(load_flat_store(&path, 1, 1).is_none());
    }

    #[test]
    fn mapped_block_scores_identically_to_owned() {
        // A store loaded zero-copy (mmap block) must score identically to
        // the same data held owned — the whole point of the flat store is
        // that mapping changes where the bytes live, not the results.
        let dir = tempfile::tempdir().unwrap();
        let token = 7;
        let mut owned = CosineIndex::new();
        owned.add_image(10, array![3.0, 4.0, 0.0]);
        owned.add_image(20, array![0.0, 0.0, 2.0]);
        owned.add_image(30, array![1.0, 1.0, 1.0]);
        owned.gen_token = token;
        let path = dir.path().join("store.bin");
        owned.save_store_to(&path, "clip_vit_b_32");

        let mut mapped = CosineIndex::new();
        mapped.cached_images =
            load_flat_store(&path, fnv1a_str("clip_vit_b_32"), token).unwrap();

        let query = array![1.0, 2.0, 3.0];
        let owned_scores = owned.get_similar_images_sorted(&query, 3, None);
        let mapped_scores = mapped.get_similar_images_sorted(&query, 3, None);
        assert_eq!(owned_scores, mapped_scores);
    }
}
