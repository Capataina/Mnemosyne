# crates/engine/src/db/

SQLite schema/migrations and persistence queries for assets, roots, embeddings, tags, notes, and manual layout.

## Invariants

- Preserve WAL/read-routing and migration compatibility; never hold read locks across write-heavy indexing phases.
- Feed reads are manifest-first (`get_feed_manifest`) with details fetched by ID plus incremental feed-delta events — never return the whole image corpus as one materialised payload.
- Batch scan inserts, and keep the `idx_images_tags_tag` reverse index aligned with include/exclude tag filtering.
- Generation tokens derive from persisted enabled/orphaned state and invalidate per-encoder stores — never restart-local counters.
