# crates/engine/src/db/

SQLite schema/migrations and persistence queries for assets, roots,
embeddings, tags, notes, and manual layout. One `ImageDatabase` struct; each
submodule contributes its own `impl ImageDatabase` block, so the public API
is identical to the old monolithic `db.rs` it was split from.

## Map

- `mod.rs` — the struct, connection management, and `initialize()`: schema
  creation, WAL setup, PASSIVE checkpointing, and the dual-connection
  topology (writer + read-only secondary).
- `schema_migrations.rs` — idempotent ALTER TABLE helpers, each gated by a
  `PRAGMA table_info` check so it only fires when the column is missing;
  safe to run every launch. New columns for old DBs go here, never inline.
- `images_query.rs` — the grid SELECTs; four queries share one
  images↔images_tags↔tags row shape rolled up by `aggregate_image_rows`.
  Includes the manifest-first feed reads and chunked details-by-ID fetches.
- `notes_orphans.rs` — `add_image` (the single insertion point), per-image
  notes, and `mark_orphaned` (the deleted-from-disk lifecycle).
- `content_hash.rs` — the DB side of move relinking: store `(size,
  content_hash)`, and `relink_or_insert` matching orphaned rows in an
  IMMEDIATE transaction, lowest-id-first. Hashing itself is
  `crate::content_hash`.
- `embeddings.rs` — per-encoder embeddings as raw LE f32 BLOBs via
  `bytemuck::cast_slice`, plus `embedding_generation_token` (the FNV fold
  the cosine stores key freshness on).
- `roots.rs` — roots CRUD; `images.root_id` FK with `ON DELETE CASCADE`.
- `tags.rs` — tag catalogue + `images_tags` many-to-many mutations; the
  JOINing reads live in `images_query.rs`.
- `manual_layout.rs` — drag-reorder/resize persistence; `set_manual_order`
  rewrites the whole visible ordering 0..N-1 instead of fractional indexing.
- `thumbnails.rs` — thumbnail path + original dimensions (the file itself is
  product-side).
- `test_helpers.rs` — shared `fresh_db()` for the submodule tests.

## Invariants

- Preserve WAL/read-routing and migration compatibility; never hold read
  locks across write-heavy indexing phases.
- Feed reads are manifest-first (`get_feed_manifest`) with details fetched
  by ID plus incremental feed-delta events — never return the whole image
  corpus as one materialised payload.
- Batch scan inserts, and keep the `idx_images_tags_tag` reverse index
  aligned with include/exclude tag filtering.
- Generation tokens derive from persisted enabled/orphaned state and
  invalidate per-encoder stores — never restart-local counters.

## Operating manual

- Every write goes through the writer connection; reads route to the
  read-only secondary (`read_lock`), which is opened by `initialize()` only
  after WAL mode and schema exist. For `:memory:` DBs — i.e. most tests —
  the secondary cannot exist (memory is per-connection), so reads fall back
  to the writer; test behaviour therefore doesn't exercise the dual
  topology.
- Checkpointing is PASSIVE by design: it never blocks readers or the
  writer, avoiding the multi-second auto-checkpoint stalls it replaced.

## Key findings

- **Relink ordering is load-bearing** (6eb05b8, 2026-07-19): `mark_orphaned`
  must run *before* the relink pass, or a move within a single rescan is
  undetectable — the source row would not yet be flagged. The scan pipeline
  was reordered around exactly this.
- **Failed scans must not orphan** (6eb05b8): the orphan pass skips any root
  with no scan entry, while an Ok-but-empty scan still orphans (folder
  genuinely emptied). Before this guard, a fail-fast scan failure plus
  relink would have let byte-identical files in other roots silently steal
  the orphaned rows' tags and placements — a HIGH-severity corruption vector
  caught in adversarial review, not in tests.
- **The hash index is single-column by decision** (6eb05b8): BLAKE3 is
  near-unique, so the lookup collapses to one or two candidates before the
  orphaned/size post-filter; a composite index bought nothing. SQL NULL
  semantics guarantee un-hashed orphans never match.

## Traps

- Relink duplicate handling is lowest-id-first and byte-identical files
  share one identity — a rescue can drain orphans arbitrarily among
  duplicates. Documented as a bounded limitation, not a bug.
- Migrations have no schema-version counter; idempotence via
  `PRAGMA table_info` *is* the versioning scheme. A migration that isn't
  safe to re-run every launch doesn't fit this module's contract.
