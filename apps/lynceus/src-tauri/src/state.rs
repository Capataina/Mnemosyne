//! Managed-state types the Tauri app holds for its whole session: the
//! per-encoder fusion caches, the lazy text-encoder slots, and the
//! background cache-warm thread that populates the former at launch.
//!
//! Also the home of the two shared type aliases every declaration site
//! must agree on exactly — **Tauri resolves managed state by exact
//! type** (2c07add), so `FusionSlots`/`WatcherSlot` written out by hand
//! at each site (as they were before this split) compile clean even on
//! a flavour mismatch and panic at first invoke. One published alias
//! per pair turns that trap into a compile-time invariant.
//!
//! Re-exported at the crate root (`lib.rs`) so every existing
//! `crate::FusionIndexState`/`crate::TextEncoderState` call site keeps
//! resolving unchanged — address-only extraction out of `lib.rs`
//! [code-health-audit 2026-08-02].

use std::sync::{Arc, Mutex, RwLock};
use tracing::{info, warn};

use crate::db::ImageDatabase;
use crate::similarity_and_semantic_search::cosine_similarity::CosineIndex;
use crate::similarity_and_semantic_search::encoder_text::ClipTextEncoder;
use crate::watcher;

/// The per-encoder fusion caches (`FusionIndexState.per_encoder`). Also
/// the pipeline's own handle on the same slots (`indexing::mod.rs`,
/// `watcher.rs`) — declared identically at every site before this split
/// (indexing.rs:58 ≡ watcher.rs:57,126 ≡ lib.rs:63,254), now one alias.
pub type FusionSlots = Arc<RwLock<std::collections::HashMap<String, CosineIndex>>>;

/// Managed slot holding the live filesystem-watcher handle (see
/// `lib.rs`'s setup and `watcher.rs`). Every root mutation ends by
/// rebuilding the watcher through this, so the watch set tracks the
/// enabled root list instead of freezing at whatever startup saw.
/// Declared identically at every site before this split
/// (roots.rs:19 ≡ lib.rs:348), now one alias — the `WatcherSlot`
/// flavour (`std::sync::Mutex`, not `tokio` or `parking_lot`) must
/// match lib.rs's managed-state declaration exactly, or a mismatch
/// compiles clean and panics at first invoke (2c07add).
pub type WatcherSlot = Arc<Mutex<Option<watcher::WatcherHandle>>>;

/// Per-encoder cosine caches — the ONLY resident embedding cache in the
/// app (T3-2/#8). Every search command borrows a slot here: image-image
/// and text-image fusion score each enabled encoder's slot via
/// `ranked_for_encoder` (a delegation onto `with_encoder_index` +
/// `get_similar_images_sorted`, CHA-TAURI-P2) and RRF the results. All
/// three encoders' caches stay resident simultaneously so a fused query
/// never pays a populate-roundtrip per call.
///
/// Populated lazily on first use OR mapped zero-copy from the persisted
/// flat store by `spawn_cache_warm` at launch; refreshed + re-persisted
/// by the indexing pipeline at Ready (token-gated) so post-index search
/// is fresh. `invalidate_all()` clears every slot on a root-change IPC.
pub struct FusionIndexState {
    /// `RwLock` (not `Mutex`) so a burst of concurrent fused queries can
    /// score under shared read locks once the per-encoder caches are
    /// warm; a `Mutex` here serialised every fused query on the whole
    /// map even when they touched disjoint encoders. Populate (first use,
    /// startup warm) takes the write lock via the double-checked path in
    /// `ranked_for_encoder`.
    pub per_encoder: FusionSlots,
}

impl FusionIndexState {
    pub fn new() -> Self {
        Self {
            per_encoder: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Clear every per-encoder cache. Called from the root-change IPCs so
    /// a disabled-root toggle flushes the fusion caches; without this,
    /// search would happily return images from a now-disabled root because
    /// its cached entries weren't cleared. The indexing pipeline these
    /// IPCs then re-spawn repopulates the slots fresh at Ready.
    pub fn invalidate_all(&self) {
        if let Ok(mut m) = self.per_encoder.write() {
            m.clear();
        }
    }

    /// Lazy populate (or reuse) the per-encoder cache for `encoder_id`,
    /// then run the cosine query against it. Returns the top-K
    /// (id, score) list excluding `exclude_id`.
    ///
    /// Caller hands in `top_k` — fusion tops out at ~50 per encoder
    /// in practice (the rank-fusion contribution at rank 50 with
    /// k_rrf=60 is ~0.009, smaller still beyond that).
    ///
    /// A one-line delegation onto `with_encoder_index` +
    /// `CosineIndex::get_similar_images_sorted` (CHA-TAURI-P2): this and
    /// `with_encoder_index` used to hand-roll the same double-checked
    /// populate sequence independently (~40 duplicated locking lines);
    /// `tests/cha_fusion_wrapper_equivalence.rs` pinned the two paths as
    /// observationally equivalent before the delegation landed, then
    /// retired once this became provably a wrapper.
    pub fn ranked_for_encoder(
        &self,
        db: &ImageDatabase,
        encoder_id: &str,
        query: &ndarray::Array1<f32>,
        top_k: usize,
        exclude_id: Option<i64>,
    ) -> Result<Vec<(i64, f32)>, String> {
        self.with_encoder_index(db, encoder_id, |idx| {
            idx.get_similar_images_sorted(query, top_k, exclude_id)
        })
    }

    /// Run an arbitrary read-only query against the warm fusion slot for
    /// `encoder_id`, ensuring the slot is populated first. This is the
    /// shared populate-and-score primitive every search command borrows
    /// through: `ranked_for_encoder` is a one-line delegation onto this
    /// method, so there is exactly one double-checked-locking populate
    /// path in the crate rather than two independently maintained copies
    /// (T3-2/#8, CHA-TAURI-P2).
    ///
    /// Double-checked locking: the warm case scores under a shared read
    /// lock (so the prefetch burst stays parallel); only a cold slot
    /// takes the write lock to map-or-populate. The closure is handed the
    /// populated index; on an encoder with no embeddings it runs against
    /// an empty index (returning empty), and if the slot is concurrently
    /// invalidated between locks the result defaults — both degrade to
    /// "no results", never an error.
    pub fn with_encoder_index<R: Default>(
        &self,
        db: &ImageDatabase,
        encoder_id: &str,
        f: impl FnOnce(&CosineIndex) -> R,
    ) -> Result<R, String> {
        // Fast path: warm slot, run under a shared read lock.
        {
            let map = self
                .per_encoder
                .read()
                .map_err(|e| format!("fusion rwlock poisoned: {e}"))?;
            if let Some(entry) = map.get(encoder_id) {
                if !entry.cached_images.is_empty() {
                    return Ok(f(entry));
                }
            }
        }
        // Slow path: map the persisted store, else DB-populate.
        {
            let mut map = self
                .per_encoder
                .write()
                .map_err(|e| format!("fusion rwlock poisoned: {e}"))?;
            let entry = map
                .entry(encoder_id.to_string())
                .or_insert_with(CosineIndex::new);
            if entry.cached_images.is_empty()
                && !entry.load_store_if_valid(db, encoder_id)
            {
                entry.populate_from_db_for_encoder(db, encoder_id);
            }
        }
        let map = self
            .per_encoder
            .read()
            .map_err(|e| format!("fusion rwlock poisoned: {e}"))?;
        Ok(map.get(encoder_id).map(f).unwrap_or_default())
    }
}

impl Default for FusionIndexState {
    fn default() -> Self {
        Self::new()
    }
}

/// State for the text encoders used in semantic search.
///
/// Each encoder is lazy-loaded on first use. We hold one slot per
/// supported family (CLIP — 512-d English BPE; SigLIP-2 — 768-d
/// Gemma SentencePiece) so the user can switch the text encoder in
/// the picker mid-session without paying the model-load cost again
/// when they swap back.
///
/// Two slots not three because DINOv2 is image-only — there is no
/// DINOv2 text branch to dispatch through.
pub struct TextEncoderState {
    /// CLIP English text encoder. 512-d output. Default.
    pub encoder: Mutex<Option<ClipTextEncoder>>,
    /// SigLIP-2 base 256 text encoder. 768-d output, Gemma SentencePiece
    /// tokenizer (256k vocab). The picker dispatches semantic_search
    /// here when the user has SigLIP-2 selected as the text encoder.
    pub siglip2_encoder: Mutex<
        Option<crate::similarity_and_semantic_search::encoder_siglip2::Siglip2TextEncoder>,
    >,
}

/// Background cache warm, spawned right at launch so the FIRST similarity
/// click — and the frontend's prefetch burst across every on-screen tile
/// — is instant on a cold session instead of paying the DB→memory populate
/// lazily on first use.
///
/// **Fusion slots only (T3-2/#8).** Every search command now borrows the
/// per-encoder `FusionIndexState` slot (via `with_encoder_index` /
/// `ranked_for_encoder`), so warming a separate primary cache here
/// too would be the ~205 MB duplicate the flat-store work exists to
/// remove — the primary is left to the indexing pipeline, which populates
/// and persists it as a side effect. For each enabled encoder we prefer
/// the persisted flat store (`embstore_<encoder>.bin`, mapped zero-copy);
/// on a miss/stale file we DB-populate AND write the store so the NEXT
/// launch maps it. One write lock per encoder (not one held across all
/// three) so a real fused query can slip in between populates.
///
/// Runs on its own thread and returns immediately; the window opens
/// without waiting. On a first-ever launch the DB has no embeddings yet,
/// so nothing loads and the pipeline populates as it indexes; the payoff
/// is every subsequent (already-indexed) launch.
///
/// `pub(super)`: only `lib.rs::run()` (this module's parent) calls it.
pub(super) fn spawn_cache_warm(db_path: String, fusion: FusionSlots) {
    std::thread::spawn(move || {
        let db = match ImageDatabase::new(&db_path) {
            Ok(d) => d,
            Err(e) => {
                warn!("cache warm: DB open failed: {e}");
                return;
            }
        };
        if let Err(e) = db.initialize() {
            warn!("cache warm: DB init failed: {e}");
            return;
        }
        let settings = crate::settings::Settings::load();

        for enc in settings.resolved_enabled_encoders() {
            // Map the persisted store if valid; only DB-populate (and then
            // persist) on a miss/stale file. Guarded by is_empty so we
            // never fight a populate that already landed.
            if let Ok(mut map) = fusion.write() {
                let entry = map.entry(enc.clone()).or_insert_with(CosineIndex::new);
                if entry.cached_images.is_empty() && !entry.load_store_if_valid(&db, &enc) {
                    entry.populate_from_db_for_encoder(&db, &enc);
                    if !entry.cached_images.is_empty() {
                        entry.save_store_for(&enc);
                    }
                }
            }
        }
        info!("cache warm complete");
    });
}
