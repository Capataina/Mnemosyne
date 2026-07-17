//! Cosine-similarity index split into focused submodules:
//!
//! - `math`  — pure helpers: the `cosine_similarity` formula and the
//!   `score_cmp_desc` comparator shared by all retrieval methods.
//! - `store` — the `FlatStore`: contiguous id / inverse-norm / row-major
//!   f32 arrays, heap-owned or mmap-backed (T3-2 / #8 + #20).
//! - `index` — the `CosineIndex` struct, embedding ingestion
//!   (`add_image`, `populate_from_db`), and the three retrieval
//!   methods (`get_similar_images`, `get_similar_images_sorted`,
//!   `get_tiered_similar_images`).
//! - `cache` — the persisted flat store: `save_to_disk` / `save_store_for`
//!   / `save_store_to` and `load_store_if_valid`.
//!
//! The struct lives in `index` and the cache impl block lives in
//! `cache`; both contribute to the same `CosineIndex` inherent impl,
//! so the public API stays exactly as it was when everything lived in
//! a single file. `cache` is brought into scope here only for its
//! `impl CosineIndex` side-effect.
//!
//! `cosine_similarity.rs` is preserved as a re-export shim so existing
//! `crate::cosine_similarity::CosineIndex`
//! imports continue to work without any caller changes.

mod cache;
pub mod diagnostics;
pub mod index;
pub(crate) mod math;
pub mod name_match;
pub mod rrf;
pub mod store;

pub use index::CosineIndex;
pub use store::FlatStore;
