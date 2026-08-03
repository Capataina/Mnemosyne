# crates/engine/src/db/

SQLite schema/migrations and persistence queries for assets, roots, embeddings, tags, notes, and manual layout. One `ImageDatabase` struct; each submodule contributes its own `impl ImageDatabase` block, so the public API is identical to the old monolithic 1.6k-line `db.rs` it was split from (the audit's top modularisation hotspot, score 0.98) — Rust merges inherent-impl blocks across files, so no caller changed. Decisions recorded here remain true as decisions even when code moves on; the code wins only on current state.

## Map

```
db/
├── mod.rs                  the struct, `type ID = i64`, connection management, and
│                           `initialize()`: schema creation, pragmas, indexes, migrations,
│                           and the dual-connection topology (writer + read-only
│                           secondary).
├── schema_migrations.rs    idempotent ALTER TABLE helpers, each gated by a `PRAGMA
│                           table_info` check so it only fires when the column is missing;
│                           safe to run every launch. New columns for old DBs go here,
│                           never inline. Also `migrate_embedding_pipeline_version` (see
│                           below).
├── images_query.rs         the grid SELECTs (~1.25k lines); four queries share one
│                           images↔images_tags↔tags row shape rolled up by
│                           `aggregate_image_rows` (`pub(super)` — `feed_manifest.rs`
│                           reuses it too; extracted from 4 duplicated ~25-line copies;
│                           reads its String/Option columns lazily, only when
│                           `HashMap::entry` is vacant). Also batch search-result
│                           hydration (`get_images_metadata_for_ids`), `get_pipeline_stats`,
│                           `count_images_without_embedding_for` (COUNT-only sibling of
│                           `embeddings.rs`'s needs-set query), `get_images_without_thumbnails`
│                           (no-join `ThumbnailNeedRow` tuple, derives its display name via
│                           `feed_manifest::basename_of`), and `embedding_generation_token`.
├── feed_manifest.rs        the compact feed manifest + id-batch detail hydration (T3-1):
│                           `FeedManifestRow`, `basename_of` (`pub(super)` — reused by
│                           `images_query.rs`'s needs-thumbnails read), `get_feed_manifest`,
│                           `get_image_names_for_search`, `get_image_details_by_ids`.
│                           Address-only split out of `images_query.rs` at the T3-1 seam,
│                           2026-08-03 [code-health-audit 2026-08-02].
├── notes_orphans.rs        `add_image` (single-row `INSERT OR IGNORE`, now the NULL-hash
│                           fallback), `add_images_batch` (superseded — see Traps),
│                           per-image notes, `mark_orphaned`, `purge_orphaned` +
│                           `list_orphaned_locations` (the orphan lifecycle).
├── content_hash.rs         the DB side of move relinking: store `(size, content_hash)`,
│                           and `relink_or_insert` matching orphaned rows in an IMMEDIATE
│                           transaction, lowest-id-first. Hashing itself is
│                           `crate::content_hash`.
├── embeddings.rs           per-encoder embeddings as raw LE f32 BLOBs via
│                           `bytemuck::cast_slice`, single-SELECT bulk reads for the
│                           cosine stores, and `upsert_embeddings_batch` (the encoder
│                           pipeline's batched write).
├── roots.rs                roots CRUD; `images.root_id` FK with `ON DELETE CASCADE`;
│                           macOS security-scoped bookmark storage (`roots.bookmark BLOB`,
│                           NULL on other platforms); `migrate_legacy_scan_root`,
│                           `wipe_images_for_new_root`.
├── tags.rs                 tag catalogue + `images_tags` many-to-many mutations +
│                           `get_tag_counts`; the JOINing feed reads live in
│                           `images_query.rs`.
├── manual_layout.rs        drag-reorder/resize persistence; `set_manual_order` rewrites
│                           the whole visible ordering 0..N-1 instead of fractional
│                           indexing.
├── thumbnails.rs           thumbnail path + original dimensions (generation itself is
│                           product-side).
└── test_helpers.rs         shared `fresh_db()` for the submodule tests.
```

## Schema — 6 tables, created/migrated in `initialize()`

- `roots(id, path UNIQUE, enabled, added_at, bookmark BLOB)` — created first because `images.root_id` references it.
- `images(id, path UNIQUE, embedding BLOB legacy, thumbnail_path, width, height, root_id FK CASCADE, notes, orphaned DEFAULT 0, manual_order, manual_col_span, content_hash BLOB, size)` — path is the row's primary identity (the only UNIQUE key a move could hang off); `content_hash` is the secondary identity signal that makes moves survivable.
- `tags(id, name UNIQUE, color)` / `images_tags(image_id, tag_id, PK both, CASCADE both ways)`.
- `embeddings(image_id, encoder_id, embedding)` — the per-encoder table; `images.embedding` is the legacy pre-per-encoder column, no longer written (R8 dropped the double-write).
- `meta(key, value)` — single key today: `embedding_pipeline_version`.

Three `CREATE INDEX IF NOT EXISTS` indexes, each with a measured reason:

| Index | Why |
| --- | --- |
| `idx_images_root_orphaned (root_id, orphaned)` | Every grid SELECT filters `orphaned = 0 AND (root_id IS NULL OR root_id IN (...))`; without it SQLite full-scans `images` and past a few thousand rows the scan dominates. `root_id` leads so both the OR-NULL and IN-list branches benefit; SQLite indexes NULLs in composites, so legacy un-migrated rows still match. |
| `idx_images_tags_tag (tag_id, image_id)` | The PK leads with `image_id`; `get_tag_counts` and the include-filter subquery key on `tag_id`. At 100k images × ~3 tags that was a ~300k-row scan per tag, and the library drawer fires dozens at once. Existence test-locked (`initialize_creates_reverse_tag_index`). |
| `idx_images_content_hash (content_hash)` | Turns each relink probe (`orphaned = 1 AND size = ? AND content_hash = ?`) into an index seek. Single-column by decision: BLAKE3 is near-unique, so the lookup collapses to one-or-two candidates before the orphaned/size post-filter; a composite bought nothing. SQL NULL semantics guarantee un-hashed orphans never match. |

## Pragmas at initialize (every connection open)

| Pragma | Why |
| --- | --- |
| `journal_mode = WAL` | The indexing pipeline opens a second connection to the same file; default DELETE journal blocks all readers for every write transaction — pre-WAL the grid froze for seconds during encode. WAL lets readers and the single writer coexist. |
| `synchronous = NORMAL` | Default FULL fsyncs every commit; every commit here is recoverable on next launch (tags re-doable, thumbnails/embeddings regenerable). NORMAL is SQLite's recommended pairing with WAL when "lose at most the last commit on power loss" is acceptable. |
| `busy_timeout = 5000` | Default 0 surfaces momentary contention (encoder batch commit vs foreground IPC) as `SQLITE_BUSY` errors. |
| `wal_autocheckpoint = 0` | The default 1000-dirty-page auto-checkpoint interleaved with encoder batch commits and produced multi-second stalls (a profiled 22 s freeze). We checkpoint manually via `checkpoint_passive()` between encoder batches so drains land at known quiet points. |
| `journal_size_limit = 64 MiB` | Caps WAL growth under bursty writes; forces truncate at the next quiet checkpoint. |
| `foreign_keys = ON` | SQLite defaults OFF; without it every `ON DELETE CASCADE` is a no-op — this pragma is what makes `remove_root` and `purge_orphaned` actually cascade. Per-connection, set once in `initialize()`, holds for the connection's lifetime. |

## Invariants

- Preserve WAL/read-routing and migration compatibility; never hold read locks across write-heavy indexing phases.
- Feed reads are manifest-first (`get_feed_manifest`) with details fetched by ID plus incremental feed-delta events — never return the whole image corpus as one materialised payload.
- Encoder writes are batched (`BEGIN IMMEDIATE` per chunk), and the `idx_images_tags_tag` reverse index stays aligned with include/exclude tag filtering.
- Generation tokens derive from persisted enabled/orphaned state and invalidate per-encoder stores — never restart-local counters, never mtime (an mtime check cannot see a root toggle that changes the filtered row-set without touching the embeddings table).
- The visibility predicate — `orphaned = 0 AND (root_id IS NULL OR root_id IN (SELECT id FROM roots WHERE enabled = 1))` — is inlined in FOUR places that must stay byte-equivalent: `get_images_with_thumbnails`, `get_feed_manifest`, `get_image_details_by_ids`, and `tags.rs::get_tag_counts`. Deliberately not hoisted (matches how `images_query.rs` already inlines its root filter per query); the cost — edit all together — is a named trade-off, and `get_tag_counts_matches_grid_visibility_predicate` pins the tags copy.
- Rankings-are-contract applies to anything feeding the cosine stores: a change that invalidates existing embeddings (preprocessing geometry, normalisation stats, output extraction, encoder-id rename) must bump `CURRENT_PIPELINE_VERSION`.

## Operating manual

- Every write goes through the writer connection (`Mutex<rusqlite::Connection>`); foreground reads route to the read-only secondary (`read_lock`), opened lazily by `initialize()` after WAL mode is set, so a foreground SELECT never queues behind an in-flight encoder write batch. For `:memory:` DBs — i.e. most tests — the secondary cannot exist (memory is per-connection), so reads fall back to the writer; test behaviour therefore doesn't exercise the dual topology.
- Checkpointing is PASSIVE by design: `checkpoint_passive()` (no-op on `:memory:`) never blocks readers or the writer, called between encoder batches under `wal_autocheckpoint = 0`.
- `upsert_embeddings_batch` uses `BEGIN IMMEDIATE`, not the default DEFERRED — DEFERRED upgrades to a write lock on first INSERT, racing concurrent reads; IMMEDIATE takes it up front. Bulk inserts under one transaction are 10-100× faster than per-row autocommit. Its `legacy_clip_too` flag is always `false` now.
- Migrations: additive columns only, `PRAGMA table_info`-gated; there is no schema-version counter — idempotence _is_ the versioning scheme, and a migration that isn't safe to re-run every launch doesn't fit this module's contract. The one non-additive mechanism is `migrate_embedding_pipeline_version`: `meta.embedding_pipeline_version` vs `CURRENT_PIPELINE_VERSION` (3); on a lower stored version it DELETEs embeddings the previous pipeline produced (legacy column + the encoder ids whose preprocessed input bytes changed) so the next pass re-encodes — users never silently carry stale embeddings across a pipeline change. It runs AFTER the embeddings table is created, since it deletes from it.
- Embedding BLOBs: `bytemuck::cast_slice` both directions (replaced 3 `unsafe slice::from_raw_parts` blocks — the `Pod` marker on f32 proves the cast at compile time, same zero-copy bytes). Decode keeps a belt-and-braces length-mod-4 check; an empty embedding is stored as an explicit empty BLOB, distinct from NULL, round-tripping as `Vec::new()`.
- Bulk-read shape: "fetch the whole table in one SELECT, caller filters in memory" (`get_all_embeddings[_for]`, `get_paths_to_root_ids`). Each replaced a per-row N+1 loop — the cosine populate was ~30× slower with per-row queries at 1000+ images, and the thumbnail-routing lookup held the Mutex 1500 times per first run.
- Notes semantics: `set_image_notes` trims and stores NULL when empty — "no annotation" is one user-facing state for both.
- `mark_orphaned(root_id, alive_paths)` is two-pass: reset the whole root to `orphaned = 0` (so a renamed-back file reappears), then re-mark whatever the fresh scan is missing, diffed via HashSet in Rust and UPDATEd in 500-id chunks (SQLite parameter limit).

## Feed manifest / detail split (the 100k round's biggest change here)

`get_images_with_thumbnails` unrolls one row per (image × tag) through its LEFT JOINs — 200-300k joined rows aggregated back down at 100k images with ~2-3 tags, on every feed load. The masonry tile needs none of that: `get_feed_manifest` returns `FeedManifestRow { id, name, width, height, thumbnail_path, manual_col_span }` with no joins, and its WHERE surface is a faithful copy of the legacy predicate (root/orphan visibility, OR/AND include, `NOT EXISTS` exclude) so membership is byte-identical for every filter combination — test-locked by `manifest_membership_matches_legacy_query`. `basename_of(path)` derives the display name Rust-side so the full filesystem path never crosses IPC for an unselected tile. Full detail (tags, path, layout) hydrates per id-batch via `get_image_details_by_ids` — same visibility predicate (invisible ids hydrate to nothing), unknown ids silently skipped, chunked at 500 ids, id-sorted across chunks, and it reuses `aggregate_image_rows` so tag aggregation never forks.

Rejected alternative: trimming the single query's SELECT list — the cost is the joins themselves, not the columns; only dropping the joins fixes the scaling. Also rejected: `get_changes_since(version)` as the feed's delta mechanism — it needs a persisted monotonic counter (schema commitment, or a crash-fragile in-memory one); in-process feed-delta events plus a full manifest refetch at Ready get losslessness free.

Tag filter SQL: OR is `EXISTS ... tag_id IN (...)`; AND is `id IN (SELECT image_id ... GROUP BY image_id HAVING COUNT(DISTINCT tag_id) = N)`; exclude is a `NOT EXISTS` appended after the include branch, binding after the include placeholders — an empty exclude set appends no clause at all, so pre-drawer callers are provably byte-identical (kept as a separate clause, not a rewritten unified predicate, for exactly that provability). `get_tag_counts` (tags.rs) is a separate catalogue-level query, not a `count` field on `Tag` — a field would force a meaningless global count onto every embedded `Tag` and change `get_tags`'s wire shape; the LEFT JOIN

- `COUNT(vis.id)` shape returns a 0-count row for every tag so the drawer never guesses. Served over the read-only secondary since the drawer polls it.

## Content-hash relink and the orphan lifecycle

The row lifecycle: discovered on scan → inserted `orphaned = 0`; every pipeline pass diffs DB rows against a fresh per-root disk scan and `mark_orphaned`s the difference. A file returning at the SAME path is auto-un-orphaned (test-locked). A file MOVED to a new path relinks when its `content_hash` is populated; with a NULL hash the old row is orphaned forever and the new path becomes a fresh id — stranding its tags (in `images_tags`), masonry placement (`manual_order`/`manual_col_span`), and embeddings, and forcing a real re-thumbnail + re-encode of unchanged bytes. Orphaned rows are hidden from the grid and excluded from encode queues, and nothing purges them except the explicit `purge_orphaned` command (remedy 2: scoped `DELETE WHERE orphaned = 1`, cascading via FKs, with `list_orphaned_locations` capturing thumbnail paths pre-delete), `remove_root`, and `wipe_images_for_new_root`.

`relink_or_insert(path, root_id, hash, size)` matches the LOWEST-id row with `orphaned = 1 AND size = ? AND content_hash = ?` and UPDATEs its path/root_id/orphaned in place — the id survives, so everything keyed on it survives. On a miss it INSERTs fresh carrying the hash. One `BEGIN IMMEDIATE` transaction per call, and calls are SERIAL, never batched: determinism requires each call's SELECT to see the previous call's UPDATE committed, so two identical moved files drain two distinct orphaned rows, lowest id first. This is why `add_images_batch` was retired from the pipeline — a bare batched `INSERT OR IGNORE` cannot distinguish "genuinely new" from "moved". A backfill pass (`get_images_without_content_hash` → `hash_file` → `set_content_hash`) hashes pre-existing NULL-hash alive rows after scan, before thumbnails; empty on fresh indexes and in steady state, real work only on first launch post-upgrade; a failed hash stays NULL and retries next launch.

Bounded limitations, by design (documented so nobody re-discovers them the hard way):

- **A NULL-hash orphan can never be retro-relinked** — there is no on-disk file left to hash; `purge_orphaned` is strictly destructive for those rows.
- **Byte-identical files share one identity** — N duplicates (degenerately, every 0-byte file) are one identity; which orphan's metadata lands on which reappeared path is arbitrary (lowest-id-first in scan order). Harm is low — a "wrong" tag sits on a visually identical image. The `size` prefilter does not help here; it only guards against true hash collisions, astronomically unlikely with BLAKE3-256.
- **An in-place edit goes stale silently** — an edited file keeps its path, is never re-flagged or re-hashed (backfill touches NULL only), so its stored hash reflects pre-edit bytes forever. A later move of that file misses the `(size, hash)` probe and degrades to a fresh untagged row — never a wrong relink. Re-hashing on mtime/size change would close this; deferred as scope.
- **A move out of a disabled root does not relink** — disabled roots are never scanned or orphaned, so there is no orphan to match; the file inserts fresh. Defensible (the user disabled the source deliberately) but silent.

## Key findings

- **Relink ordering is load-bearing** (6eb05b8, 2026-07-19): `mark_orphaned` must run _before_ the relink pass, or a move within a single rescan is undetectable — the source row would not yet be flagged. The scan pipeline was reordered around exactly this.
- **Failed scans must not orphan** (6eb05b8): the orphan pass skips any root with no scan entry, while an Ok-but-empty scan still orphans (folder genuinely emptied). Before this guard, a fail-fast scan failure plus relink would have let byte-identical files in other roots silently steal the orphaned rows' tags and placements — a HIGH-severity corruption vector caught in adversarial review, not in tests. The deeper cause — the fail-fast scanner (product-side `filesystem.rs`) — is untouched; a skip-and-continue scanner remains the recommended follow-up.
- **The 22 s IPC freezes were contention, not query plan** (100k perf round): `ipc.get_images` normally ran 70-125 ms but produced ~22 s outliers during heavy SigLIP-2 encode phases while the raw SQL took ~58 ms on a quiet system. The fixes were structural — R2 read routing, R1 write batching, manual PASSIVE checkpointing — and the `get_images.lock_wait/sql_prepare/row_iter/aggregate` sub-spans in `images_query.rs` exist to attribute any recurrence.
- **`add_images_batch`'s serial fallback is mandatory, never optional**: a failed chunk transaction rolls back and replays row-by-row through `add_image`, so one bad row never sinks its 255 batch-mates — batching was a pure performance win and changing failure semantics would have been an unannounced regression riding along. (Test-proven with an injected FK-violating row.) The method now has zero pipeline callers but the principle governs any future batch write here.
- **Stable id-ASC order replaced shuffle-on-every-read**: backend shuffle made every ~2 s indexing refetch reorder the whole grid ("the entire app refreshes"). Sort/shuffle now lives frontend-side with a session seed; the backend returns deterministic order.
- **AND/OR tag filtering is opt-in, default OR** for back-compat; the frontend cache key includes the mode so toggling re-fetches rather than serving cached OR results.

## Traps

- Relink duplicate handling is lowest-id-first and byte-identical files share one identity — a rescue can drain orphans arbitrarily among duplicates. Documented as a bounded limitation, not a bug.
- Migrations have no schema-version counter; idempotence via `PRAGMA table_info` _is_ the versioning scheme. A migration that isn't safe to re-run every launch doesn't fit this module's contract; the next genuinely non-additive schema change needs a real versioned framework first.
- **Dead-from-the-caller surface, kept deliberately, green tests and all:** `set_manual_order` (the v2 masonry split moved drag-reorder to an in-session route-held order — `manual_col_span` is NOT in this category, it is fully wired and persists drag-resize), `add_images_batch` (superseded by serial `relink_or_insert`), and `get_images_with_thumbnails` (wire-compat only — every frontend consumer moved to manifest + details; `get_all_images` and tests still route through it, so a tag-aggregation change must keep both `aggregate_image_rows` call sites correct).
- Embedding BLOBs assume little-endian; moving a DB cross-endianness would silently produce garbage f32s (cosine goes meaningless). bytemuck proves alignment, not endianness; an on-disk magic-header guard is the named future fix.
- A panic with the connection mutex held poisons it for the session — all subsequent DB calls fail until restart. ~30 lock sites across submodules.
- `get_image_id_by_path` is exact string match — trailing slashes, case, and Unicode normalisation differences miss. Mostly moot since search went ID-native, but any new path-keyed lookup inherits it.
- The `_filter_string` parameter of `get_images_with_thumbnails` is intentionally unused in SQL — it exists as a frontend cache-key discriminator; don't "fix" it into a filter.
- `add_root`'s UNIQUE violation surfaces as generic `ApiError::Db`; sharpening to `BadInput("already added")` is a known nicety, same for `create_tag`'s UNIQUE name.
- A materialised progress-counter table for `get_pipeline_stats` (which full-scans with four `SUM(CASE)` aggregates, ~9k scans per 100k run) was evaluated and deferred: background-only cost vs crash-drift + a startup reconcile path. Reopen only if profiling shows the stats scans starving the pipeline's own writes.
- **This file said `CURRENT_PIPELINE_VERSION` is 3; the code says 4** (`schema_migrations.rs:94`, bumped 2026-04-26 with the fast_image_resize swap). The code wins; the (3) in the migrations bullet above is the stale side, kept visible per the contradiction rule until the next owning edit corrects it. [code-health-audit 2026-08-02]
- **The one destructive migration has zero tests** (`schema_migrations.rs:83-165`, no test module in the file): nothing pins that the wipe fires exactly once, that `stored >= current` is a no-op, which encoder ids are wiped, or that the meta write round-trips. A miswritten bump either re-wipes every launch (hours of re-encode at 100k) or fails to wipe (mixed-distribution embeddings, silently corrupt rankings). [code-health-audit 2026-08-02]
- **A corrupt `meta.embedding_pipeline_version` silently triggers a full wipe** (`schema_migrations.rs:107-121`): a non-numeric stored value parses to `None` → `needs_migration` → unconditional wipe logged as a routine migration. Cheap fix when touched: treat unparseable-as-corrupt distinctly (warn + explicit choice). [code-health-audit 2026-08-02]

**Done 2026-08-03** (content-changes pass, proofs in `crates/engine/tests/`): Ready count via `COUNT(*)` — `get_pipeline_stats().total_images` is the drop-in the finder named, wired at the `indexing.rs` call site (see `apps/lynceus/src-tauri/src/CLAUDE.md`'s Done note for the caller-side half). The thumbnail needs-set query (`get_images_without_thumbnails`) drops its tag join for a no-join `ThumbnailNeedRow { id, path, name }` query with `ORDER BY id`, on the writer connection as the gate specified; its one live caller (`indexing.rs`'s two thumbnail passes) migrated, and the zero-caller second "caller" (`thumbnail/generator.rs::generate_all_missing_thumbnails`) was deleted rather than migrated, citing this audit. `get_preview_eligibility` is now one `SUM(CASE)`-per-bucket pass instead of one scan per bucket, parameterised (works for any bucket-width slice, not just the 3-item ladder) via `params_from_iter`. `aggregate_image_rows` reads its String/Option columns lazily — only on `Entry::Vacant` — instead of eagerly on every joined row. A new `count_images_without_embedding_for` (COUNT-only sibling of `embeddings.rs::get_images_without_embedding_for`) backs the encode-progress-denominator entry (see `apps/lynceus/src-tauri/src/CLAUDE.md`'s Done note — the caller lives in `indexing.rs`), added here rather than in `embeddings.rs` because that file was another seat's surface this pass. Proofs: `cha_l3_db_waste.rs`, `cha_b_ready_count.rs`, `cha_b_thumbnail_needs_shape.rs`, `cha_l3_alloc_and_hash.rs`, `cha_b_needs_count.rs` — all green (`cargo test -p mnemosyne`).

**Disclosed deliberate delta in the needs-set rewrite (verifier finding, accepted 2026-08-03):** the old return path built `ImageData::new(...)`, whose constructor CANONICALIZED the path when the file existed; `ThumbnailNeedRow.path` is now the raw stored string. That is a behaviour change under any symlinked path component (macOS `/tmp` → `/private/tmp`, network mounts): the pipeline's `path_to_root` map is raw-keyed, so the old canonical form MISSED it and the thumbnail silently landed in the flat legacy location instead of its `root_<id>/` directory — the raw path now HITs and per-root isolation is honoured. Classified a latent-bug fix, not a regression (raw keys are the pipeline's convention throughout); existing installs are safe (stored `thumbnail_path` values remain valid; only new generations land per-root). The contract is pinned by `cha_needs_set_raw_path_contract.rs` (needs-row path byte-equals the stored string AND direct-hits the root map under a symlinked root).

**Done 2026-08-03** (CHA Phase B structural move, proof: `cargo test --workspace` 229/0): `images_query.rs` split at the T3-1 seam into `feed_manifest.rs`, exactly per the entry this note replaces — `FeedManifestRow`, `basename_of`, and the `get_feed_manifest`/`get_image_names_for_search`/`get_image_details_by_ids` impl block moved, plus the four T3-1 tests. `aggregate_image_rows` widened to `pub(super)` (the reverse direction the entry didn't need to state: `basename_of` also widened to `pub(super)`, since `images_query.rs`'s `get_images_without_thumbnails` — added by the later content-changes pass above — still derives its `feed-delta` display name through it). `commands/images.rs`'s import split as specified.
