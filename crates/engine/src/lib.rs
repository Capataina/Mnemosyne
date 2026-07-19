//! Mnemosyne — the media-agnostic core engine.
//!
//! This crate is the reusable substrate shared across every asset-browser
//! product in the monorepo (Lynceus for images today; Syrinx for audio and
//! Daedalus for 3D assets in future). It owns the parts of an asset browser
//! that do not care what the assets *are*:
//!
//! - **catalogue** (`db`) — SQLite/WAL storage of assets, roots, tags, notes,
//!   and per-encoder embeddings, with the dual writer/read-only connection
//!   topology.
//! - **retrieval** (`cosine`, `cosine_similarity`) — cosine ranking plus
//!   Reciprocal Rank Fusion over an arbitrary set of encoders.
//! - **domain types** (`image_struct`, `root_struct`, `tag_struct`) — the row
//!   shapes the catalogue stores. Named for the image vertical for now; these
//!   generalise to `Asset` when the second product lands, not before.
//! - **paths** (`paths`) — resolution of the on-disk locations for the DB,
//!   thumbnails, models, settings, and exports.
//! - **profiling** (`perf`, `perf_report`) — the opt-in span/diagnostic layer
//!   and its on-exit markdown report.
//!
//! Everything media-specific — encoders, thumbnailers, the indexing pipeline
//! that wires them, the filesystem watcher, and the Tauri command surface —
//! lives in the product crate that depends on this one, never here.

// Matches the app crate: the codebase uses //! and /// blocks with
// left-aligned continuations on purpose, for terminal readability.
#![allow(clippy::doc_lazy_continuation)]

pub mod content_hash;
pub mod cosine;
pub mod cosine_similarity;
pub mod db;
pub mod image_struct;
pub mod paths;
pub mod perf;
pub mod perf_report;
pub mod root_struct;
pub mod tag_struct;
