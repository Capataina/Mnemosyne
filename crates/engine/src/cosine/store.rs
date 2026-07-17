//! Flat, contiguous per-encoder embedding store (T3-2 / #8 + #20).
//!
//! Replaces the old per-row `Vec<(i64, Array1<f32>)>` — ~400k separate
//! allocations at 100k images × 3 encoders, each embedding its own heap
//! box — with **three arrays**: an id column, an inverse-norm column
//! (T1-4 cached norms, absorbed here), and one row-major f32 block. The
//! block is either heap-owned (built from the DB) or a zero-copy view
//! into a memory-mapped store file, so a warm launch pages embeddings in
//! on demand instead of faulting + copying the whole ~800 MB up front.
//!
//! `CosineIndex.cached_images` keeps this type as its public field so the
//! untouchable indexing pipeline's `idx.cached_images.is_empty()` and the
//! command layer's `.len()` keep resolving — the storage underneath is
//! flat, but the small method surface those callers use is preserved.

use super::math::inv_norm;
use memmap2::Mmap;
use std::sync::Arc;

/// Backing storage for the row-major f32 embedding block.
pub(crate) enum Block {
    /// Heap-owned floats, built from a DB populate or `add_image`.
    Owned(Vec<f32>),
    /// Zero-copy view: `byte_start .. byte_start+byte_len` within `mmap`
    /// is an f32-aligned run of `byte_len / 4` floats. Alignment is
    /// validated once at load time (`cache.rs`) before this variant is
    /// constructed, so `as_slice`'s cast is always sound. Holding the
    /// `Arc<Mmap>` keeps the mapping alive for the store's lifetime; when
    /// the store is cleared or replaced the Arc drops and unmaps.
    Mapped {
        mmap: Arc<Mmap>,
        byte_start: usize,
        byte_len: usize,
    },
}

impl Block {
    #[inline]
    pub(crate) fn as_slice(&self) -> &[f32] {
        match self {
            Block::Owned(v) => v,
            Block::Mapped {
                mmap,
                byte_start,
                byte_len,
            } => bytemuck::cast_slice(&mmap[*byte_start..*byte_start + *byte_len]),
        }
    }
}

/// Flat store: `ids[r]`, `inv_norms[r]`, and `block[r*dim .. (r+1)*dim]`
/// describe row `r`. Empty when `dim == 0`.
pub struct FlatStore {
    dim: usize,
    ids: Vec<i64>,
    inv_norms: Vec<f32>,
    block: Block,
}

impl Default for FlatStore {
    fn default() -> Self {
        Self::new()
    }
}

impl FlatStore {
    pub fn new() -> Self {
        FlatStore {
            dim: 0,
            ids: Vec::new(),
            inv_norms: Vec::new(),
            block: Block::Owned(Vec::new()),
        }
    }

    // ---- the small surface the untouchable/foreign callers use ----

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    /// Drop every row and unmap any backing file. Restores the empty
    /// state so the next populate rebuilds from scratch. Reached via
    /// `FusionIndexState::invalidate_all` on a root toggle.
    pub fn clear(&mut self) {
        self.dim = 0;
        self.ids.clear();
        self.inv_norms.clear();
        // Replacing the Block drops any Arc<Mmap>, unmapping the file.
        self.block = Block::Owned(Vec::new());
    }

    // ---- accessors for the hot scan + diagnostics ----

    #[inline]
    pub(crate) fn dim(&self) -> usize {
        self.dim
    }
    #[inline]
    pub(crate) fn ids(&self) -> &[i64] {
        &self.ids
    }
    #[inline]
    pub(crate) fn inv_norms(&self) -> &[f32] {
        &self.inv_norms
    }
    #[inline]
    pub(crate) fn block(&self) -> &[f32] {
        self.block.as_slice()
    }
    /// True when the embedding block is a zero-copy view into a mapped
    /// store file (rather than a heap-owned copy). Used by the load tests
    /// to prove the zero-copy path is actually taken.
    #[cfg(test)]
    #[inline]
    pub(crate) fn is_mapped(&self) -> bool {
        matches!(self.block, Block::Mapped { .. })
    }
    /// Row `r`'s embedding slice. Panics on out-of-range `r` (caller
    /// iterates `0..len()`).
    #[inline]
    pub(crate) fn row(&self, r: usize) -> &[f32] {
        &self.block()[r * self.dim..(r + 1) * self.dim]
    }

    // ---- build path (DB populate + add_image) ----

    /// Pre-size the arrays for a known row count and dim.
    pub(crate) fn reserve(&mut self, rows: usize, dim: usize) {
        self.ids.reserve(rows);
        self.inv_norms.reserve(rows);
        if let Block::Owned(v) = &mut self.block {
            v.reserve(rows * dim.max(1));
        }
    }

    /// Append one embedding, computing its inverse norm. Sets `dim` from
    /// the first row; silently skips a row whose length disagrees with
    /// an already-established dim (the old populate loop's implicit
    /// contract — one encoder, one dim). If the store is currently
    /// mmap-backed it is copied to owned first (build only ever follows
    /// a `clear`, so in practice this never fires).
    pub(crate) fn push_owned(&mut self, id: i64, emb: &[f32]) {
        if emb.is_empty() {
            return;
        }
        if let Block::Mapped { .. } = self.block {
            let copy = self.block.as_slice().to_vec();
            self.block = Block::Owned(copy);
        }
        if self.ids.is_empty() {
            self.dim = emb.len();
        } else if emb.len() != self.dim {
            return;
        }
        if let Block::Owned(v) = &mut self.block {
            v.extend_from_slice(emb);
        }
        self.ids.push(id);
        self.inv_norms.push(inv_norm(emb));
    }

    // ---- load path (cache.rs mmap) ----

    /// Construct a store directly from persisted parts — used by the
    /// mmap loader. `block` may be `Owned` (copied fallback) or `Mapped`
    /// (zero-copy). Caller guarantees `ids.len() == inv_norms.len()` and
    /// `block.len() == ids.len() * dim`.
    pub(crate) fn from_parts(
        dim: usize,
        ids: Vec<i64>,
        inv_norms: Vec<f32>,
        block: Block,
    ) -> Self {
        FlatStore {
            dim,
            ids,
            inv_norms,
            block,
        }
    }
}
