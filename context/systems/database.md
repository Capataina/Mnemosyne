# database

*Maturity: comprehensive · Stability: stable core, active edges (T3-1 manifest/detail split and the generation-token primitive landed this round)*

## Scope / Purpose

Owns SQLite persistence for the entire backend: the multi-folder root catalogue (with macOS security-scoped bookmarks), the images table with per-encoder embeddings in a dedicated `embeddings` table, free-text per-image notes, the orphan-detection flag, drag-reorder/drag-resize layout columns, the tag catalogue, and the `images_tags` join table. Wraps a single `rusqlite::Connection` per `ImageDatabase` instance in a `Mutex` (plus a lazily-opened read-only secondary connection for foreground SELECTs) and exposes idempotent insert / query / update methods. **WAL journal mode** + `synchronous = NORMAL` + `foreign_keys = ON` are set at `initialize` time. Single source of truth for what files are indexed, what their thumbnails look like, what their per-encoder embeddings are, what folders they came from, what notes the user wrote on them, how they are tagged, and — as of the 100k performance round — the compact feed manifest + per-id detail split that the masonry grid reads instead of the full tag-joined catalogue.

The module was previously a 1.6k-line `db.rs`; it is now split into focused submodules under `crates/engine/src/db/` (the Mnemosyne engine crate — see `notes/conventions.md` § Engine/product re-export facade) with a `pub struct ImageDatabase` defined in `mod.rs` and `impl ImageDatabase { ... }` blocks distributed across the submodules. Public API surface is unchanged across the split — `db::ImageDatabase::add_image(...)`, `db.get_tags()`, etc., all continue to work because Rust merges inherent-impl blocks across files in the same crate.

## Boundaries / Ownership

- **Owns:** the schema (5 tables), the WAL+NORMAL+FK pragma block, the embedding-BLOB encoding/decoding via `bytemuck::cast_slice` (replaces 3 unsafe blocks), the per-table CRUD, the AND/OR tag filter SQL branch, the orphan-mark chunked UPDATE, the legacy migration helper, the pipeline-stats single-SELECT.
- **Does not own:** path normalisation (lives in `paths::strip_windows_extended_prefix`), thumbnail generation (lives in `thumbnail-pipeline`), embedding generation (lives in `clip-image-encoder`), root id resolution from cosine paths (lives in `commands::resolve_image_id_for_cosine_path`).
- **Public API surface:** `ImageDatabase::new`, `initialize`, `default_database_path`, `read_lock` (R2 — read-only secondary connection helper for foreground SELECTs), `checkpoint_passive` (R3 — manual WAL drain between encoder batches), `add_image`, `add_images_batch` (T2-2 — chunked `BEGIN IMMEDIATE` scan-insert batching), `get_images`, `get_all_images`, `get_images_with_thumbnails`, `get_images_without_embeddings`, `get_images_without_thumbnails`, `get_image_id_by_path`, `get_images_metadata_for_ids` (T3-2/#6 — batch search-result hydration), `get_feed_manifest` / `get_image_details_by_ids` (T3-1 — compact manifest + per-id detail split), `embedding_generation_token` (T3-2/#8 — cosine-store staleness token), `get_image_source_for_thumbnail`, `get_paths_to_root_ids`, `get_pipeline_stats`, `update_image_embedding`, `get_image_embedding`, `get_all_embeddings`, `upsert_embedding`, `upsert_embeddings_batch` (R1 — BEGIN IMMEDIATE batch INSERT helper), `get_embedding`, `get_all_embeddings_for`, `get_images_without_embedding_for`, `count_embeddings_for`, `update_image_thumbnail`, `get_image_thumbnail_info`, `create_tag`, `delete_tag`, `get_tags`, `get_tag_counts` (library-drawer per-folder counts — see `systems/tag-system.md`), `add_tag_to_image`, `remove_tag_from_image`, `list_roots`, `add_root` (now takes an `Option<Vec<u8>>` macOS security-scoped bookmark), `enabled_roots_with_bookmarks`, `get_root_bookmark`, `remove_root`, `set_root_enabled`, `migrate_legacy_scan_root`, `wipe_images_for_new_root`, `get_root_id_by_path`, `mark_orphaned`, `relink_or_insert` / `set_content_hash` / `get_images_without_content_hash` (content-hash move/rename relink — see below), `get_image_notes`, `set_image_notes`, `set_manual_order` / `set_manual_col_span` (drag-reorder / drag-resize persistence — see the Known Issues note on `set_manual_order`'s frontend status). Plus type alias `pub type ID = i64`.

## Current Implemented Reality

### Submodule layout

```
crates/engine/src/db/
├── mod.rs                — ImageDatabase struct, type ID, new(), initialize() (WAL/NORMAL/FK + CREATE TABLE
│                            + idempotent migrations + the two composite indexes below), default_database_path;
│                            tests::initialize_is_idempotent, initialize_creates_reverse_tag_index
├── schema_migrations.rs  — migrate_add_thumbnail_columns, migrate_add_multifolder_columns,
│                            migrate_add_notes_and_orphaned_columns, migrate_add_manual_order_columns
│                            (images.manual_order / manual_col_span), migrate_add_content_hash_columns
│                            (images.content_hash / size), migrate_add_roots_bookmark_column
│                            (roots.bookmark), migrate_embedding_pipeline_version (all PRAGMA table_info gated)
├── images_query.rs       — aggregate_image_rows helper (audit extraction; was duplicated 4×),
│                            get_images / get_all_images / get_images_with_thumbnails (AND/OR + exclude branch),
│                            get_images_without_embeddings, get_images_without_thumbnails,
│                            get_paths_to_root_ids, get_image_id_by_path, get_pipeline_stats,
│                            get_images_metadata_for_ids (T3-2/#6 batch hydration), embedding_generation_token
│                            (T3-2/#8), get_image_source_for_thumbnail, get_feed_manifest +
│                            get_image_details_by_ids (T3-1 — see below); 1480 lines, largest submodule
├── embeddings.rs         — update_image_embedding + get_image_embedding via bytemuck::cast_slice,
│                            get_all_embeddings (single SELECT for cosine populate), upsert_embedding,
│                            upsert_embeddings_batch (R1), get_embedding / get_all_embeddings_for /
│                            get_images_without_embedding_for / count_embeddings_for (per-encoder surface)
├── manual_layout.rs      — set_manual_order (whole-ordering rewrite), set_manual_col_span (drag-resize
│                            persist) — see "Manual layout persistence" below
├── tags.rs               — create_tag, delete_tag, get_tags, get_tag_counts (library-drawer visible
│                            counts — see systems/tag-system.md), add_tag_to_image (INSERT OR IGNORE),
│                            remove_tag_from_image
├── thumbnails.rs         — update_image_thumbnail, get_image_thumbnail_info
├── roots.rs              — list_roots, add_root (path + Option<Vec<u8>> macOS security-scoped bookmark),
│                            enabled_roots_with_bookmarks, get_root_bookmark, remove_root, set_root_enabled,
│                            migrate_legacy_scan_root, wipe_images_for_new_root, get_root_id_by_path
├── notes_orphans.rs      — add_image (multi-folder aware, single-row), add_images_batch (T2-2 — chunked
│                            batch insert, see below; no longer the pipeline's live insert path — see
│                            "Content-hash relink" below), get_image_notes, set_image_notes,
│                            mark_orphaned (chunked UPDATE for SQLite param limit)
├── content_hash.rs       — set_content_hash, get_images_without_content_hash, relink_or_insert
│                            (move/rename detection via full-content BLAKE3 hash — see below)
└── test_helpers.rs       — fresh_db() helper used by every submodule's #[cfg(test)] block
```

The split was an audit Modularisation finding (composite hotspot score 0.98 — top in the repo). Public API was preserved exactly via Rust's automatic file-vs-directory module resolution and the `pub use` re-exports already in place — no caller changes anywhere. Post-split, `images_query.rs` has grown to the largest submodule (1480 lines) as both the T3-1 manifest/detail split and the T3-2 search-hydration additions landed as new `impl ImageDatabase` blocks in the same file rather than forcing a second split mid-round.

### Schema (5 tables)

```sql
CREATE TABLE roots (
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    enabled   INTEGER NOT NULL DEFAULT 1,
    added_at  INTEGER NOT NULL              -- unix epoch
);

CREATE TABLE images (
    id                INTEGER PRIMARY KEY,
    path              TEXT NOT NULL UNIQUE,
    embedding         BLOB,                    -- legacy raw little-endian f32 sequence (pre-per-encoder schema)
    thumbnail_path    TEXT,                    -- absolute path under <app_data_dir>/thumbnails/...
    width             INTEGER,
    height            INTEGER,
    root_id           INTEGER REFERENCES roots(id) ON DELETE CASCADE,  -- Phase 6 multi-folder
    notes             TEXT,                    -- Phase 11 free-text annotation
    orphaned          INTEGER NOT NULL DEFAULT 0,  -- Phase 7 deleted-from-disk marker
    manual_order      INTEGER,                 -- drag-reorder position; NULL = default masonry order
    manual_col_span   INTEGER,                 -- drag-resize width in columns; NULL = default single column
    content_hash      BLOB,                    -- full-content BLAKE3 digest; NULL until hashed
    size              INTEGER                  -- byte count paired with content_hash; the relink pre-filter
);

CREATE TABLE tags (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    color  TEXT NOT NULL                     -- hex string e.g. "#3489eb"
);

CREATE TABLE images_tags (
    image_id  INTEGER NOT NULL,
    tag_id    INTEGER NOT NULL,
    PRIMARY KEY (image_id, tag_id),
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)   REFERENCES tags(id)   ON DELETE CASCADE
);

-- roots gains `bookmark BLOB` (macOS security-scoped bookmark, nullable —
-- see roots.rs and commands/roots.rs::set_scan_root/add_root). NULL on
-- non-macOS and for pre-migration rows.
-- Plus the `embeddings(image_id, encoder_id, embedding)` per-encoder table
-- and the single-key `meta(key, value)` table (embedding_pipeline_version)
-- — both created in initialize() alongside the four tables above, for 6
-- tables total. See "Idempotent migrations" below for embeddings/meta.
```

Source: `db/mod.rs:90-143` (original 4-table core), extended by `schema_migrations.rs`'s idempotent `ALTER TABLE` helpers for `manual_order`/`manual_col_span` (`migrate_add_manual_order_columns`), `content_hash`/`size` (`migrate_add_content_hash_columns` — move/rename relink, see below) and `roots.bookmark` (`migrate_add_roots_bookmark_column`), and by `mod.rs::initialize()`'s `CREATE TABLE IF NOT EXISTS` for `embeddings` + `meta`. The `roots` table is created first because `images.root_id` references it.

### Pragmas at initialize

```rust
conn.pragma_update(None, "journal_mode", "WAL")?;
conn.pragma_update(None, "synchronous", "NORMAL")?;
conn.pragma_update(None, "busy_timeout", 5000)?;            // R3 — Tier 1 perf
conn.pragma_update(None, "wal_autocheckpoint", 0)?;         // R3 — manual via checkpoint_passive
conn.pragma_update(None, "journal_size_limit", 67_108_864)?; // R3 — 64 MiB cap
conn.execute("PRAGMA foreign_keys = ON;", [])?;
```

| PRAGMA | Why |
|--------|-----|
| `journal_mode = WAL` | The indexing pipeline opens its own `ImageDatabase` instance (a second SQLite connection to the same file). In default DELETE journal mode, the writer holds an exclusive lock for the duration of every write transaction, blocking all readers. WAL lets readers and the single writer coexist. SQLite's official recommendation for any multi-connection workload. |
| `synchronous = NORMAL` | Default `FULL` fsyncs after every commit — appropriate where torn writes corrupt structure, but unnecessary for this app where every commit is recoverable on next launch (tag mutations user can re-do, thumbnails / embeddings can be regenerated). NORMAL is SQLite's explicitly-recommended pairing with WAL when "lose at most the last commit on power loss" is acceptable. |
| `busy_timeout = 5000` (R3) | Default of 0 surfaces momentary lock contention (e.g. encoder batch commit while foreground IPC arrives) as `SQLITE_BUSY`. 5 s is generous enough that any real-world contention resolves transparently rather than reaching the user as an error. |
| `wal_autocheckpoint = 0` (R3) | SQLite's automatic checkpointer fires every 1000 dirty pages by default — and that cadence interleaves with encoder batch commits in a way that produces multi-second stalls (the trigger for the perf-1777212369 22 s freeze). We disable auto and call `checkpoint_passive()` ourselves between encoder batches so checkpoints land at known quiet points. |
| `journal_size_limit = 64 MiB` (R3) | Cap WAL file growth so it can't explode under bursty writes. The cap forces a truncate at the next quiet checkpoint, keeping disk usage bounded and reducing fsync cost at COMMIT. |
| `foreign_keys = ON` | SQLite defaults this OFF for backwards compatibility. Without it, `ON DELETE CASCADE` on `images.root_id → roots.id` is a no-op. The pragma is what made `remove_root` actually wipe the root's images. |

All pragmas are set in `initialize` after every connection open. WAL also persists across reopens (it's a property of the DB file). `pragma_update` is the rusqlite path that returns Result so we surface migration-time failures rather than ignoring them.

### Composite indexes (R9 + the reverse tag index)

Two indexes created in `initialize()` alongside the tables, both landing in the 100k performance round:

| Index | Columns | Why |
|-------|---------|-----|
| `idx_images_root_orphaned` (R9) | `images(root_id, orphaned)` | Every foreground grid SELECT filters by `orphaned = 0 AND (root_id IS NULL OR root_id IN (...))`. Without this, SQLite full-scans `images`; past a few thousand rows the scan cost becomes the dominant component of `get_images.row_iter`. `root_id` leads so both the OR-NULL and IN-list branches benefit; SQLite indexes NULLs in composite indexes, so legacy un-migrated rows still match. |
| `idx_images_tags_tag` | `images_tags(tag_id, image_id)` | `images_tags`'s only index was the PK `(image_id, tag_id)` — nothing leads with `tag_id`. But `get_tag_counts` (tags.rs) joins on `tag_id`, and the include-filter subquery (`images_query.rs`) keys on `tag_id` too; both had to full-scan `images_tags` to resolve one tag. At 100k images × ~3 tags that's a ~300k-row scan per tag, and the library drawer requests a count for every folder at once — dozens of those scans fire together. Leading with `tag_id` and covering `image_id` turns each into an index range scan. Verified present via `initialize_creates_reverse_tag_index` (queries `sqlite_master`). |
| `idx_images_content_hash` | `images(content_hash)` | The move/rename relink lookup (`db/content_hash.rs::relink_or_insert`) matches `WHERE orphaned = 1 AND size = ? AND content_hash = ?` once per genuinely-new path during a scan; without an index this full-scans `images`. Leading with `content_hash` (the selective column) turns each relink probe into an index seek — `size` stays a cheap post-filter on the few hash matches. |

All three are `CREATE INDEX IF NOT EXISTS`, so they're idempotent on every launch like the table creation above them.

### R2 — read-only secondary connection

`ImageDatabase` holds two connections per real on-disk database:

| Field | Type | Use |
|-------|------|-----|
| `connection` | `Mutex<rusqlite::Connection>` | The writer. Every INSERT/UPDATE/DELETE goes through this mutex. Encoder pipeline holds it for the duration of each batch transaction; foreground IPC writes (tag mutations, root toggles) take it briefly. |
| `reader` | `OnceLock<Mutex<rusqlite::Connection>>` | A separate `SQLITE_OPEN_READ_ONLY` connection on the same file, opened lazily by `initialize()` after WAL mode is set. Used by foreground IPC SELECTs via `read_lock()`. `OnceLock` so `initialize` can populate through `&self`. |

For `:memory:` databases (tests), `reader` stays empty — `:memory:` is per-connection storage so a second connection sees a separate empty DB. `read_lock()` falls back to the writer in that case; tests don't have foreground/background contention to worry about anyway.

**Routing.** Foreground SELECTs go through `self.read_lock()`:
- `get_images_with_thumbnails` (the IPC freeze case)
- `get_images`, `get_image_id_by_path`, `get_pipeline_stats`
- `get_all_embeddings`, `get_all_embeddings_for`, `count_embeddings_for` (cosine cache populate, foreground)

The encoder writer keeps using `self.connection.lock()` directly. So a foreground `get_images` call no longer queues behind an in-flight encoder write batch — the two contend only at the SQLite WAL layer (which is non-blocking against active reads).

### R1 — encoder write batching via `upsert_embeddings_batch`

The encoder loops in `indexing.rs` write a chunk of (image_id, embedding) rows under one `BEGIN IMMEDIATE` transaction:

```rust
pub fn upsert_embeddings_batch(
    &self,
    encoder_id: &str,
    rows: &[(ID, Vec<f32>)],
    legacy_clip_too: bool,
) -> rusqlite::Result<()>
```

`BEGIN IMMEDIATE` rather than the default `DEFERRED` — `DEFERRED` upgrades to a write lock on the first INSERT, racing with any concurrent read; `IMMEDIATE` takes the write lock up-front. `legacy_clip_too` is now always `false` from both encoder loops as of R8 (the legacy `images.embedding` double-write was dropped).

Per the [PDQ benchmark](https://www.pdq.com/blog/improving-bulk-insert-speed-in-sqlite-a-comparison-of-transactions/), bulk inserts are 10-100× faster under one transaction than per-row autocommit. Combined with R2, the writer can run flat-out without affecting UI responsiveness.

### R3 — `checkpoint_passive` between encoder batches

```rust
pub fn checkpoint_passive(&self) -> rusqlite::Result<()> {
    if self.reader.get().is_none() { return Ok(()); }   // :memory: — no WAL file
    self.connection.lock().unwrap()
        .pragma_update(None, "wal_checkpoint", "PASSIVE")?;
    Ok(())
}
```

Called from both encoder loops between batches. PASSIVE mode does not block readers or writers — it processes whatever pages are clean and returns. Drives the WAL drain manually under `wal_autocheckpoint=0` so checkpoints land at predictable quiet points instead of mid-batch.

### Idempotent migrations

```rust
// Schema deltas (idempotent ALTER TABLE)
self.migrate_add_thumbnail_columns()?;       // adds thumbnail_path, width, height
self.migrate_add_multifolder_columns()?;     // adds root_id
self.migrate_add_notes_and_orphaned_columns()?;  // adds notes, orphaned

// ... CREATE TABLE for tags / images_tags / embeddings (with idx) ...

// One-shot embedding-pipeline invalidation when CLIP/DINOv2 pipeline
// changes invalidate prior embeddings. Runs AFTER the embeddings
// table is created (it issues DELETE against that table).
self.migrate_embedding_pipeline_version()?;
```

Each schema delta probes `PRAGMA table_info(images)` and runs `ALTER TABLE images ADD COLUMN ...` only if the column is missing. Idempotent — re-running on an up-to-date schema is a no-op.

The **embedding-pipeline version migration** is a different beast — it uses a separate `meta(key, value)` key-value table to record `embedding_pipeline_version`. When the stored version is less than `CURRENT_PIPELINE_VERSION` (currently `3` as of 2026-04-26), it deletes embeddings that were produced by the previous pipeline so the next indexing pass re-encodes everything cleanly. The version 3 bump wipes:

- `images.embedding` (legacy CLIP column — invalidated by the move from combined-graph multilingual to separate vision_model + OpenCLIP English text; R8 stops writing it on first encode under v3)
- `embeddings WHERE encoder_id = 'clip_vit_b_32'` (R6 + R7 changed the preprocessed RGB buffer fed into the encoder — fast_image_resize Lanczos3 + JPEG scaled IDCT produce subtly different bytes than the old image-rs CatmullRom + full IDCT path)
- `embeddings WHERE encoder_id = 'dinov2_small'` (legacy id from before the upgrade to dinov2_base; orphaned)
- `embeddings WHERE encoder_id = 'siglip2_base'` (same R6 + R7 reason — preprocessing buffer change invalidates SigLIP-2 embeddings too)
- `embeddings WHERE encoder_id = 'dinov2_base'` (same R6 + R7 reason)

`SigLIP-2` rows are not wiped because the SigLIP path wasn't producing embeddings before this version — there's nothing to invalidate.

Bump `CURRENT_PIPELINE_VERSION` whenever a future change invalidates existing embeddings (preprocessing geometry change, normalization stat change, output-extraction-method change, encoder-ID rename). The pattern keeps users from carrying stale embeddings into a new code path silently.

```sql
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- After wipe completes:
INSERT INTO meta VALUES ('embedding_pipeline_version', '2')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
```

The `meta` table is a 6th table (in addition to roots, images, tags, images_tags, embeddings). Currently only one key. Future migrations could store schema_version, last_full_scan timestamp, etc. — kept minimal until a real need surfaces.

### Embedding BLOB encoding (now safe)

```rust
let embedding_bytes: &[u8] = bytemuck::cast_slice(&embedding);
self.connection.lock().unwrap().execute(
    "UPDATE images SET embedding = ?1 WHERE id = ?2",
    rusqlite::params![embedding_bytes, image_id],
)?;
```

`db/embeddings.rs:32-37`. `bytemuck::cast_slice` proves at compile time (via the `Pod` marker on `f32`) that the reinterpretation is safe — zero-copy view, same bytes hit the BLOB. Replaces 3 previous `unsafe { slice::from_raw_parts(...) }` blocks (audit Inconsistent Patterns finding `0bdb5f4`).

Symmetric decoding via `bytemuck::cast_slice::<u8, f32>(&bytes).to_vec()`. The decoder also retains the runtime length-mod-4 check as belt-and-braces against malformed BLOBs:

```rust
if bytes.len() % f32_size != 0 {
    return Err(rusqlite::Error::FromSqlConversionFailure(...));
}
```

Empty embeddings (length 0) are stored explicitly as `&[]` (distinct from NULL) and round-trip as `Vec::new()`.

### `get_all_embeddings` — single SELECT for cosine

```rust
pub fn get_all_embeddings(&self) -> rusqlite::Result<Vec<(ID, String, Vec<f32>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, embedding FROM images
         WHERE embedding IS NOT NULL AND length(embedding) > 0",
    )?;
    // ... cast each row's bytes via bytemuck, skip rows whose length isn't a multiple of f32 size
}
```

`db/embeddings.rs:97-127`. Replaces the per-row `get_image_embedding(id)` call inside the cosine populate loop, which was N+1 (one query per image, ~30× slower for 1000+ image libraries). The cosine module's `populate_from_db(&ImageDatabase)` is the only caller.

### `get_paths_to_root_ids` — single SELECT for thumbnail routing

```rust
pub fn get_paths_to_root_ids(&self) -> rusqlite::Result<HashMap<String, Option<ID>>> {
    let mut stmt = conn.prepare("SELECT path, root_id FROM images")?;
    // collect into HashMap
}
```

`db/images_query.rs:342-349`. Replaces the indexing pipeline's previous `get_root_id_by_path(path)` per-image call, which held the DB Mutex 1500 times in rapid succession on a typical first run. Aligned with the existing `get_all_embeddings` shape — "fetch the whole table in one SELECT, the caller filters in memory" is the established pattern.

### Image grid SQL — root + orphan filter + AND/OR tag filter

```sql
-- Common WHERE clause for grid query:
WHERE images.orphaned = 0
  AND (
    images.root_id IS NULL
    OR images.root_id IN (SELECT id FROM roots WHERE enabled = 1)
  )
```

Plus optionally:

```sql
-- OR semantic (default; matches images with ANY of the selected tags):
AND EXISTS (
    SELECT 1 FROM images_tags it2
    WHERE it2.image_id = images.id
      AND it2.tag_id IN (?, ?, ...)
)

-- AND semantic (match_all_tags = true; matches images with EVERY selected tag):
AND images.id IN (
    SELECT it2.image_id
    FROM images_tags it2
    WHERE it2.tag_id IN (?, ?, ...)
    GROUP BY it2.image_id
    HAVING COUNT(DISTINCT it2.tag_id) = N
)
```

Source: `db/images_query.rs::get_images_with_thumbnails`. The frontend's `useUserPreferences.tagFilterMode` ("any" vs "all") is threaded through `useImages` → `fetchImages` → the `match_all_tags` parameter on the Tauri command. The query key includes `matchAllTags` so toggling re-fetches with fresh SQL semantics rather than serving cached OR results.

As of the 100k performance round, `get_images_with_thumbnails` is **wire-compat only** — every frontend consumer migrated to `get_feed_manifest` + `get_image_details_by_ids` (below) for the main feed. The command (`get_images`) stays fully registered and tested, and `get_all_images()` and `resolve_image_id_for_cosine_path`'s fallback still call `get_images` internally, but no route or hook invokes `fetchImages`/`get_images` anymore — the only remaining strings are two explanatory comments in the frontend source.

Also gained an `exclude_tag_ids: Vec<ID>` fourth parameter (library drawer) — a `NOT EXISTS` clause appended to every branch (no-include / OR / AND), binding after the include placeholders. Empty (the default for every pre-existing caller) adds no clause, so behaviour is byte-identical to before the drawer shipped. See `systems/tag-system.md` for the drawer's include/exclude UX.

### T3-1 — Feed manifest + per-id detail hydration (`get_feed_manifest` / `get_image_details_by_ids`)

The single biggest schema-adjacent change of the 100k round. `get_images_with_thumbnails` unrolls to one row per (image × tag) via its LEFT JOINs — at 100k images with ~2-3 tags each that's 200-300k joined rows HashMap-aggregated back down, on every feed load and every ~5s indexing refetch. The masonry grid doesn't need any of that per tile: it needs an id, a name, dimensions, a thumbnail path, and a persisted column span.

```rust
pub struct FeedManifestRow {
    pub id: ID,
    pub name: String,                    // basename, derived Rust-side — full path never travels
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub thumbnail_path: Option<String>,   // None/empty until the thumbnail phase reaches this row
    pub manual_col_span: Option<i64>,
}

pub fn get_feed_manifest(
    &self,
    filter_tag_ids: Vec<ID>,
    match_all_tags: bool,
    exclude_tag_ids: Vec<ID>,
) -> rusqlite::Result<Vec<FeedManifestRow>>
```

`db/images_query.rs:798-882`. The WHERE surface is a **faithful copy** of `get_images_with_thumbnails`'s predicate — same root/orphan visibility, same include OR/AND semantics, same exclude `NOT EXISTS` — so manifest membership is byte-identical to the legacy query's for every filter combination (test-locked: `manifest_membership_matches_legacy_query`). What changed is the SELECT list and the absent LEFT JOINs: no tags array, no notes, no original path — the thumbnail path is the only path a feed tile genuinely renders. `basename_of(path)` derives the display name Rust-side so the full filesystem path never crosses the IPC boundary for a tile the user hasn't selected.

Full detail — tags, notes-adjacent metadata, the original path, manual-layout columns — hydrates per id-batch only for the selected image and its arrow-nav neighbours:

```rust
pub fn get_image_details_by_ids(&self, ids: &[ID]) -> rusqlite::Result<Vec<ImageData>>
```

`db/images_query.rs:895-940`. Same visibility predicate as the grid/manifest (an orphaned or disabled-root id hydrates to nothing — the frontend falls back to the active result list, exactly as the old catalogue's in-memory `find` used to miss). Unknown ids are silently skipped. Chunked at 500 ids to stay clear of SQLite's bind-variable limit; results are id-sorted across chunks. Reuses the same `aggregate_image_rows` helper as the legacy grid query, so tag-aggregation logic doesn't fork.

Consumed by the Tauri commands `get_feed_manifest` and `get_image_details` (`commands/images.rs`) — see `systems/tauri-commands.md`. Cross-link: the frontend-side manifest cache, delta-merge, and shuffle logic live in `systems/feed-protocol.md`.

### Batched scan inserts — `add_images_batch` (T2-2, superseded as the pipeline's live path)

`add_image(path, root_id)` is still the single-row insertion point (`INSERT OR IGNORE`, idempotent on the path UNIQUE constraint) — the scan phase now calls it as the NULL-hash fallback when a genuinely-new file's content hash can't be computed (see "Content-hash relink" below). `add_images_batch` itself is **no longer called by the indexing pipeline**: the content-hash relink round replaced the scan phase's insert path, because a bare `INSERT OR IGNORE` can't distinguish "genuinely new" from "moved" the way a content hash can. The method, its chunked-transaction behaviour, and its tests remain in place and green with zero callers in `apps/lynceus/src-tauri/src/` — the same dead-from-the-caller shape `set_manual_order` is in below (see Known Issues).

```rust
pub fn add_images_batch(&self, images: &[(String, Option<ID>)]) -> rusqlite::Result<()>
```

`db/notes_orphans.rs:104-` — one prepared `INSERT OR IGNORE` statement executed inside a single `BEGIN IMMEDIATE` transaction per 256-path chunk (~100k autocommits collapsing to ~400 transactions on a 100k first scan, when this was the live path). **The partial-failure fallback is mandatory, not optional**: if a chunk's transaction fails (a row hits a constraint the prepared statement can't `IGNORE`), the transaction rolls back and that chunk is replayed one row at a time through `add_image`, so a single bad row can never sink its batch-mates — proven by a test that injects an FK-violating row mid-chunk and asserts rows before it survive while the offending row's error propagates, byte-identical to the pre-batching per-path loop. `Some(root_id)` binds the two-column INSERT; `None` binds the one-column form — both produce the identical NULL `root_id` `add_image` would.

This was the same "batch with a serial fallback" shape as R1's `upsert_embeddings_batch` for embedding writes, applied one layer earlier in the pipeline (the scan phase, before any embedding exists to batch). Content-hash relink (below) needed a per-file hash before it could decide relink-vs-insert, which doesn't compose with a 256-path batch INSERT the same way — the scan phase's write path moved to a per-file serial call instead.

### Content-hash relink — move/rename detection at scan time

The scan phase's actual write path now: a moved or renamed file's bytes are unchanged, so a full-content hash lets a genuinely-new path be matched back to the orphaned row it moved from, instead of stranding that row's tags, manual layout, and embeddings under a fresh id. Closes remedy 1 of the diagnosis in `notes/image-identity-orphan-lifecycle.md`.

```rust
pub fn relink_or_insert(
    &self,
    path: &str,
    root_id: Option<ID>,
    hash: &[u8],
    size: i64,
) -> rusqlite::Result<RelinkOutcome>   // Relinked { id } | Inserted { id }
```

`db/content_hash.rs:90-142`. Matches the LOWEST-id row with `orphaned = 1 AND size = ? AND content_hash = ?` and, on a hit, UPDATEs that row's `path`/`root_id`/`orphaned` in place — the id survives, so everything keyed on it (tags, `manual_col_span`, embeddings) survives too. On a miss it INSERTs a fresh row carrying the hash and size. Runs inside one `BEGIN IMMEDIATE` transaction per call and is called SERIALLY, never batched: determinism depends on each call's SELECT seeing the previous call's UPDATE already committed, so two files with identical bytes drain two distinct orphaned rows, lowest id first, rather than both matching the same one.

The hash itself lives one layer up, in the `mnemosyne` engine crate's top-level `content_hash` module (not this DB submodule):

```rust
pub fn hash_file(path: &Path) -> std::io::Result<([u8; 32], u64)>
```

`crates/engine/src/content_hash.rs:30-48`. Streams the file through a 64 KiB buffer into a BLAKE3 hasher, returning the digest and the exact byte count read. BLAKE3 over SHA-256 for throughput — this runs once per file on every scan, and a first index hashes the whole library.

Two supporting methods round out the feature:

```rust
pub fn set_content_hash(&self, id: ID, hash: &[u8], size: i64) -> rusqlite::Result<()>
pub fn get_images_without_content_hash(&self) -> rusqlite::Result<Vec<(ID, String)>>
```

`db/content_hash.rs:41-66`. `get_images_without_content_hash` returns every alive (`orphaned = 0`) row whose `content_hash` is still NULL — pre-existing rows from before this feature shipped. The indexing pipeline's backfill pass (after scan/relink, before the thumbnail phase) hashes each and writes it back via `set_content_hash`; on a fresh index or a steady-state rescan this returns empty and the pass is a no-op, so it only does real work on the first launch after upgrading. A hash that fails to compute stays NULL and is retried on the next launch — idempotent.

**Schema**: `images.content_hash BLOB` + `images.size INTEGER` (both nullable — see the schema section above), added for existing DBs via the idempotent `migrate_add_content_hash_columns` (`schema_migrations.rs:233-251`), plus `idx_images_content_hash ON images(content_hash)` so the relink lookup is an index seek rather than a full-table scan (see the composite-indexes table above).

**The caveat that survives this feature**: an orphaned row whose file is already gone AND whose `content_hash` is NULL (indexed before this feature existed, never backfilled because there's no file left to hash) can never be retro-relinked. Only images hashed after the column existed — freshly indexed or backfilled — participate in a future relink.

Test coverage is split by layer. `content_hash.rs`'s `identical_bytes_hash_equal_and_differing_bytes_differ` proves the hash function; `db/content_hash.rs`'s eight tests (`move_detected_and_relinked_preserves_row_and_attachments`, `cross_root_move_relinks_and_updates_root_id`, `duplicate_hash_picks_lowest_id_deterministically`, `null_hash_orphan_is_never_relinked`, `relink_or_insert_stores_hash_on_insert`, `backfill_is_idempotent`, `purge_and_relink_coexist`, `size_participates_in_the_relink_match`) prove the relink/backfill/purge mechanics at the DB layer. The indexing pipeline's scan-phase reorder itself (hash → serial relink → backfill, ordered around `mark_orphaned`) is NOT end-to-end runtime-tested — there's no GUI in the build environment to drive `run_pipeline_inner` against a real filesystem move.

### Manual layout persistence — `manual_order` / `manual_col_span`

```rust
pub fn set_manual_order(&self, ordered_ids: &[ID]) -> rusqlite::Result<()>
pub fn set_manual_col_span(&self, id: ID, col_span: Option<i64>) -> rusqlite::Result<()>
```

`db/manual_layout.rs`. `set_manual_order` takes the WHOLE currently-visible ordering and rewrites every row's `manual_order` as a fresh `0..N-1` sequence inside one transaction, rather than splicing one moved item between fractional neighbours — this sidesteps fractional-indexing's classic failure modes (float precision exhaustion, renumbering races) at the cost of one UPDATE per visible image per drag, which is fine at this grid's sizes. Ids not present in `ordered_ids` are left untouched, and a previously-untouched image (`manual_order` NULL) joins the explicit sequence the first time any reorder happens.

`set_manual_col_span` persists a single image's drag-resize width; `None` clears back to the default single-column width, which the masonry packer treats as "1".

**Frontend status is asymmetric between the two columns.** `manual_col_span` is fully wired — `useImages.ts`, `services/images.ts::setManualColSpan`, and the masonry packer all read/write it, and it survives a reshuffle (position re-rolls, size is a stable per-image property). `manual_order` and the `set_manual_order` command are **backend-only as of the v2 masonry split** — the frontend's drag-reorder now holds a live in-session order in the route (no round-trip; drop sticks; reshuffle clears it), so nothing calls `setManualOrder`/`set_manual_order` anymore (confirmed: zero references in `apps/lynceus/src/`, versus `manual_col_span` referenced across nine frontend files). The command, the DB method, and their tests remain in place and green — see Known Issues below.

### `embedding_generation_token` — cosine-store staleness token (T3-2/#8)

```rust
pub fn embedding_generation_token(&self, encoder_id: &str) -> rusqlite::Result<u64>
```

`db/images_query.rs:597-627`. Derived from the exact filtered population an encoder's flat embedding store holds — `COUNT(*)`, `SUM(rowid)`, `MAX(rowid)` over `embeddings JOIN images` under the same `orphaned = 0 AND (root_id IS NULL OR root_id IN (enabled roots))` predicate as `get_all_embeddings_for` — folded via FNV-1a into one `u64`. This is strictly more sensitive than "did the embeddings table change": a root enable/disable toggle changes which rows pass the filter without touching any embedding row, and the token still moves (test-locked: `generation_token_moves_on_population_change`, including the round-trip back to the identical token on re-enable). Replaces the flat store's previous bare-mtime freshness check, which cannot survive at 100k scale and can't distinguish "this encoder's population changed" from "some unrelated write touched the DB file". Consumed by `CosineIndex::refresh_if_stale` in the indexing pipeline's step 7 — see `systems/indexing.md` and `systems/multi-encoder-fusion.md`.

### `aggregate_image_rows` helper (audit extraction)

The "images LEFT JOIN images_tags LEFT JOIN tags" row-aggregation pattern was duplicated across 4 different fetch methods (each ~25 lines). The audit extracted a single helper:

```rust
fn aggregate_image_rows(rows: &mut rusqlite::Rows<'_>)
    -> rusqlite::Result<Vec<(ID, String, Vec<Tag>, Option<String>, Option<i64>, Option<i64>)>>
```

Each caller emits the standard column aliases (img_id, img_path, thumbnail_path, width, height, tag_id, tag_name, tag_color) — callers that don't have thumbnail data emit `NULL AS thumbnail_path`, `NULL AS width`, `NULL AS height` so the helper's `row.get("thumbnail_path")` resolves to `None`. The next change to tag-aggregation logic happens in one place; ditto the thumbnail-column shape.

### Stable grid order (no shuffle)

```rust
images.sort_by_key(|i| i.id);    // get_images_with_thumbnails
```

The previous "shuffle on every read" caused the visible "entire app refreshes" behaviour during indexing — every refetch (every ~2s while thumbnails were generating) reordered the grid, making tiles jump around. Sort modes are now controlled via the user's `sortMode` preference and applied frontend-side when needed (the frontend can apply a deterministic shuffle with a session seed if the user picks "shuffle"). Default sort mode is `"added"` — oldest first by id.

The frontend's modal-close-bumps-shuffleSeed pattern (`shuffleSeed` state in `[...slug].tsx`) means deliberate refresh actions trigger a new order; routine indexing-progress invalidations refetch with the SAME seed so the order stays stable through background updates.

### Pipeline stats — single SELECT

```rust
pub fn get_pipeline_stats(&self) -> rusqlite::Result<PipelineStats>
```

Returns counts of total / with_thumbnail / with_embedding / orphaned in one full-table scan via four `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` aggregates. Lets the user see how much work the indexing pipeline has done without four separate Mutex acquisitions. Used by the upcoming pipeline-stats UI (planned).

### Orphan-detection chunked UPDATE

```rust
pub fn mark_orphaned(&self, root_id: ID, alive_paths: &[String]) -> rusqlite::Result<usize>
```

`db/notes_orphans.rs:27-80`. Two-pass approach without temp tables:
1. Reset every row in this root to `orphaned = 0` (so a renamed-back file reappears in the grid).
2. If `alive_paths` is empty, mark every row in this root orphaned (edge case: empty scan).
3. Otherwise, load all paths from the root, diff against the alive set in Rust (HashSet), and `UPDATE images SET orphaned = 1 WHERE id IN (...)` chunked at 500 ids per UPDATE to stay under SQLite's parameter limit on large libraries.

Returns the number of rows updated. Called by the indexing pipeline's scan phase, per root.

### Notes round-trip

```rust
pub fn get_image_notes(&self, image_id: ID) -> rusqlite::Result<Option<String>>
pub fn set_image_notes(&self, image_id: ID, notes: &str) -> rusqlite::Result<()>
```

`db/notes_orphans.rs:106-130`. `set_image_notes` trims whitespace and stores `None` (NULL) if the result is empty, otherwise the trimmed string. The user-facing semantic is "no annotation" for both empty and NULL.

### Locking model

- One `Mutex<rusqlite::Connection>` per `ImageDatabase` instance.
- Every method acquires `.lock().unwrap()` before SQL. ~30 lock sites across the submodules; a panic with the lock held poisons the mutex for the rest of the session (see `notes/mutex-poisoning.md`).
- The indexing pipeline opens a **second** `ImageDatabase::new(db_path)` connection on its background thread. Multiple connections to the same SQLite file under WAL is the supported pattern — readers don't block the single writer.

## Key Interfaces / Data Flow

| Read path | Used by | Returns |
|-----------|---------|---------|
| `get_feed_manifest(filter_tag_ids, match_all_tags, exclude_tag_ids)` | `commands::images::get_feed_manifest` — **the** main-feed read path | `Vec<FeedManifestRow>`, id-ASC, no tags join |
| `get_image_details_by_ids(ids)` | `commands::images::get_image_details` — selected image + arrow-nav neighbours | `Vec<ImageData>` (full detail), unknown/invisible ids silently absent |
| `get_images_metadata_for_ids(ids)` | `commands::hydrate_search_results` — every similarity/semantic command | `Vec<ImageResultMeta>` — one `WHERE id IN` batch, replaces the old per-result N+1 |
| `embedding_generation_token(encoder_id)` | indexing pipeline step 7 (`CosineIndex::refresh_if_stale`) | `u64` FNV fold — moves whenever the encoder's filtered population changes |
| `get_image_source_for_thumbnail(id)` | `commands::images::get_thumbnail` | `Option<(path, root_id, Option<width>)>` |
| `get_tag_counts()` | `commands::tags::get_tag_counts` — library drawer | `Vec<TagCount>`, one row per tag including zero-count |
| `get_images_with_thumbnails(filter_tag_ids, _filter_string, match_all_tags, exclude_tag_ids)` | `commands::images::get_images` — wire-compat only, no live frontend caller (see above) | `Vec<ImageData>` sorted by id; the `_filter_string` is preserved in the cache key but the SQL ignores it |
| `get_all_images()` | `commands::resolve_image_id_for_cosine_path` flexible-match fallback | `Vec<ImageData>` sorted by id |
| `get_images_without_embeddings()` | legacy `encode_all_images_in_database` test/back-compat path | Rows where `embedding IS NULL` (legacy column, not the per-encoder table) |
| `get_images_without_embedding_for(encoder_id)` | indexing pipeline encode phase, all three encoders | Rows with no row in `embeddings` for that `encoder_id` |
| `get_images_without_thumbnails()` | indexing pipeline thumbnail phase | Rows where `thumbnail_path IS NULL OR ''` |
| `get_image_embedding(id)` | `commands::similarity` (CLIP query embedding lookup) | `Vec<f32>` or `Err(QueryReturnedNoRows)` |
| `get_embedding(id, encoder_id)` | `commands::similarity` (SigLIP-2/DINOv2 query embedding lookup) | `Vec<f32>` or `Err` |
| `get_all_embeddings()` / `get_all_embeddings_for(encoder_id)` | `CosineIndex::populate_from_db[_for_encoder]` | `Vec<(ID, path, Vec<f32>)>` / per-encoder variant, non-null only |
| `get_image_id_by_path(path)` | `commands::resolve_image_id_for_cosine_path` strategies 1 + 2 | `i64` or `Err(QueryReturnedNoRows)` |
| `get_paths_to_root_ids()` | indexing pipeline thumbnail routing; also the scan phase's genuinely-new-path diff (content-hash relink) | `HashMap<path, Option<root_id>>` — single SELECT |
| `get_images_without_content_hash()` | indexing pipeline content-hash backfill pass | `Vec<(ID, String)>` — alive (`orphaned = 0`) rows with NULL `content_hash` |
| `get_image_thumbnail_info(id)` | legacy enrich path | `Option<(thumbnail_path, w, h)>` |
| `get_pipeline_stats()` | `commands::images::get_pipeline_stats` — Settings drawer StatsSection | `PipelineStats { total, with_thumbnail, with_embedding_per_encoder, orphaned }` |
| `get_tags()` | `commands::tags::get_tags`, SearchBar + TagDropdown | `Vec<Tag>` ordered by id |
| `list_roots()` | `commands::roots::list_roots`, indexing pipeline, watcher start | `Vec<Root>` ordered by added_at |
| `enabled_roots_with_bookmarks()` / `get_root_bookmark(id)` | macOS security-scoped bookmark re-grant on launch / `remove_root` | `Vec<(path, bookmark)>` / `Option<Vec<u8>>` |
| `get_image_notes(id)` | `commands::notes::get_image_notes` | `Option<String>` |

| Write path | Used by | Notes |
|------------|---------|-------|
| `add_image(path, root_id)` | indexing pipeline scan phase — NULL-hash fallback when a genuinely-new file's content hash can't be computed | `INSERT OR IGNORE` on path UNIQUE — idempotent. `root_id: Option<ID>` because legacy un-migrated rows are NULL. |
| `add_images_batch(images)` | none — superseded by `relink_or_insert` below (T2-2, no longer called by the pipeline; see "Batched scan inserts" above) | Chunked `BEGIN IMMEDIATE` batch INSERT with mandatory per-row fallback on chunk failure; method + tests remain, zero live callers |
| `relink_or_insert(path, root_id, hash, size)` | indexing pipeline scan phase — the live per-file write path for genuinely-new paths | Matches an orphaned row by `(size, content_hash)` and UPDATEs it in place (`Relinked`), else INSERTs fresh (`Inserted`) — see "Content-hash relink" above |
| `set_content_hash(id, hash, size)` | indexing pipeline content-hash backfill pass | Writes a computed hash/size onto a pre-existing NULL-hash row |
| `update_image_embedding(id, Vec<f32>)` | legacy single-embedding write path | bytemuck::cast_slice; empty Vec stored as empty BLOB explicitly |
| `upsert_embeddings_batch(encoder_id, rows, legacy_clip_too)` | indexing pipeline encode phase, all three encoders | R1 — one `BEGIN IMMEDIATE` per chunk of 32; `legacy_clip_too` always `false` now (R8 dropped the legacy double-write) |
| `update_image_thumbnail(id, &Path, w, h)` | indexing pipeline thumbnail phase, `commands::images::get_thumbnail` on-demand generation | Single UPDATE with all 3 columns at once |
| `set_manual_order(ordered_ids)` | `commands::images::set_manual_order` — **backend-only, no live frontend caller** (see Known Issues) | Rewrites `manual_order` for the given ids as a fresh 0..N-1 sequence in one transaction |
| `set_manual_col_span(id, col_span)` | `commands::images::set_manual_col_span` — drag-resize persist, fully wired | `None` clears back to the default single-column width |
| `mark_orphaned(root_id, alive_paths)` | indexing pipeline scan phase, per root | Reset-then-mark via HashSet diff + chunked UPDATE |
| `add_root(path, bookmark)` | `commands::roots::add_root`, `set_scan_root` | Returns the populated `Root`; `bookmark` is the macOS security-scoped bookmark (`None` on other platforms/failure); UNIQUE constraint surfaces as `Err` (mapped to `ApiError::Db`) |
| `remove_root(id)` | `commands::roots::remove_root` | CASCADE wipes images via the FK; caller also invalidates the fusion caches and releases the security scope first |
| `set_root_enabled(id, bool)` | `commands::roots::set_root_enabled` | Grid filter query reads the column directly — instant toggle, no re-index; caller invalidates fusion caches |
| `wipe_images_for_new_root()` | `commands::roots::set_scan_root` | Clears NULL-root_id legacy rows when replacing all roots |
| `migrate_legacy_scan_root(path)` | `lib.rs::run::setup` (one-shot) | Idempotent; backfills NULL-root_id rows whose path starts with the legacy root |
| `create_tag(name, color)` | `commands::tags::create_tag` | Returns the new `Tag` with last-insert-rowid |
| `delete_tag(id)` | `commands::tags::delete_tag` | CASCADE-deletes from `images_tags` |
| `add_tag_to_image(image_id, tag_id)` | `commands::tags::add_tag_to_image` | `INSERT OR IGNORE` — duplicate assignment is a silent no-op |
| `remove_tag_from_image(image_id, tag_id)` | `commands::tags::remove_tag_from_image` | Plain DELETE |
| `set_image_notes(id, &str)` | `commands::notes::set_image_notes` | Empty string clears (stores NULL) |

## Implemented Outputs / Artifacts

- The on-disk `<app_data_dir>/images.db` (+ `images.db-wal` + `images.db-shm` files when WAL is active). All gitignored.
- The `default_database_path()` helper returns the platform-correct path via `paths::database_path()` — on macOS `~/Library/Application Support/com.ataca.lynceus/images.db`. Same path in dev and release as of 2026-04-26; override via `LYNCEUS_DATA_DIR` env var.
- 60+ unit tests across the submodule `tests` blocks: schema idempotency, reverse-tag-index existence, AND/OR/exclude tag semantics, multi-folder filter, NULL-root_id legacy rows, orphan detection (incl. 1200-id chunking stress test), notes round-trip, embedding BLOB round-trip (incl. large + empty), pipeline stats correctness across each stage, manifest-membership-matches-legacy-query equivalence, batch metadata hydration (bundle-all-or-nothing + empty/missing-id cases), the embedding-generation-token population-change test, manual-order/manual-col-span persistence + NULL defaults, the add_images_batch partial-failure fallback, and content-hash relink correctness (BLAKE3 digest equality, lowest-id-first relink determinism, NULL-hash-orphan exclusion, size-gated matching, backfill idempotency, purge/relink coexistence).

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| `set_manual_order` is backend-only, unreachable from the frontend | The v2 masonry split moved drag-reorder to an in-session route-held order with no round-trip | The command, `db.set_manual_order`, and their tests are live and green but have zero callers in `apps/lynceus/src/` — dead-from-the-frontend surface that a future cleanup pass could either wire up (a "persist custom order" feature) or retire. `manual_col_span`/`set_manual_col_span` is NOT in this category — it is fully wired (nine frontend references) and persists drag-resize. See `notes/dead-code-inventory.md`. |
| `add_images_batch` (T2-2) is no longer called by the indexing pipeline | The content-hash relink round replaced the scan phase's insert path with per-file hash + `relink_or_insert` so a moved file can be matched to its orphaned row | The chunked `BEGIN IMMEDIATE` + per-row-fallback method and its two tests remain live and green with zero callers in `apps/lynceus/src-tauri/src/` — the same dead-from-the-pipeline shape `set_manual_order` is in above. `add_image` (single-row) is still live, as the scan phase's NULL-hash fallback when a file can't be read for hashing. |
| `get_images_with_thumbnails` / `get_images` is wire-compat only | T3-1's manifest/detail split migrated every frontend consumer to `get_feed_manifest` + `get_image_details_by_ids` | The LEFT-JOIN-unroll query and its 200-300k-row cost at 100k images are no longer on the hot path, but the command, the SQL, and the tests remain — a future schema change to tag aggregation must still keep both `aggregate_image_rows` call sites (manifest's sibling and this one) correct even though only the manifest path is live. |
| `save_to_disk` / `paths::cosine_cache_path` orphaned by the T3-2/#8 rework | The primary `CosineIndexState` was removed entirely in `1514a90` | Public, tested, but caller-less — flagged in `context/notes/performance-decisions.md`, left in place for the next pass through that file rather than deleted here. |
| Endianness assumption (little-endian) | Moving the DB across architectures with different endianness (none today, but ARM64 macOS happens to match little-endian by accident not by guarantee) | Embedding round-trip silently produces garbage f32s → cosine similarity becomes meaningless. Mitigated by bytemuck's compile-time alignment proof but not endianness guard. The flat mmap embedding store (`crates/engine/src/cosine/`) carries the same native-little-endian assumption — see `systems/multi-encoder-fusion.md`. |
| Mutex poisoning is unrecoverable | A panic with the connection mutex held | All subsequent DB calls fail with `Mutex poisoned` (surfaced as `ApiError::Db("...")` via the rusqlite path or as the foreground process getting stuck). The only recovery is restarting. See `notes/mutex-poisoning.md`. |
| `add_root` UNIQUE error surfaces as generic `ApiError::Db` | User adds the same folder twice via add_root | Frontend gets a typed-but-generic message. Could be sharpened to `ApiError::BadInput("already added")`. |
| No `WAL` checkpointing strategy | Long sessions with many writes | The `-wal` file can grow unboundedly. SQLite auto-checkpoints at 1000 pages by default but the user might see a large `-wal` file briefly. Cosmetic. |
| `_filter_string` parameter unused in SQL | Frontend passes searchText for cache-key purposes; backend doesn't filter on it | Wasted bandwidth (every keystroke creates a new cache entry containing identical data). Documented; minor perf issue. |
| No version table for schema migrations | A future fourth migration that needs ordering / backfill / data refactor | Today's `if column missing then ALTER TABLE` works for additive changes; non-additive changes need a real migration framework. |
| `mark_orphaned` chunks at 500 ids per UPDATE | Libraries with hundreds of newly-orphaned images | Multiple sequential UPDATEs run inside the indexing thread. Bounded but not parallel. |
| Path comparison in `get_image_id_by_path` is exact string match | Trailing slash, case differences (Windows), Unicode normalisation differences | Falls through to the flexible-match fallback in `commands::resolve_image_id_for_cosine_path` strategy 3. The fallback handles it but has its own cost. See `notes/path-and-state-coupling.md`. |
| Stale unit test — historical | Was: `test_scan_directory_finds_all_images` asserted len==4 against test_images/ | Resolved: that test is gone (commit `12d9b07` removed the paid dataset and the broken hardcoded-path tests). |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Versioned migration framework** before the next non-additive schema change. Add a `schema_version` table + numbered up/down migrations. Today's pattern works for one delta; it does not scale.
- **Sharper error types for known constraint violations** — `add_root`'s UNIQUE error should surface as `ApiError::BadInput("already added")` rather than generic `ApiError::Db`.
- **Endianness guard for embedding BLOBs** — write a magic byte sequence as a header so loading a wrong-endian BLOB errors loudly instead of producing garbage.
- **WAL checkpoint hint in shutdown** — call `wal_checkpoint(TRUNCATE)` on app exit so the `-wal` file shrinks. Cosmetic.
- **Pipeline stats UI** — `get_pipeline_stats` shipped to the Settings drawer's StatsSection in commit `8c55aa4` (per-encoder progress + total/with_thumbnail/with_embedding/orphaned counts).

## Durable Notes / Discarded Approaches

- **Manifest/detail split over a single richer query.** The alternative to `get_feed_manifest` + `get_image_details_by_ids` was to keep one query and just trim its SELECT list — rejected because the LEFT JOIN unroll (the 200-300k-row cost at 100k images) comes from the joins themselves, not the column list; only dropping the joins entirely fixes the scaling problem. A field audit of what the masonry tile component actually reads confirmed visible tiles need nothing beyond the manifest row.
- **`get_changes_since(version)` was considered and rejected** as the delta mechanism for the feed. It needs a persisted monotonic version counter — either a schema migration to add one, or an in-memory counter that's fragile across app restarts (a mid-session crash loses the counter's meaning). The in-process `feed-delta` events plus a full manifest refetch on `Phase::Ready` reconciliation gets losslessness for free without a new schema commitment. See `systems/indexing.md` for the delta event mechanics.
- **`add_images_batch`'s serial fallback is mandatory, never optional.** An earlier design considered letting a bad row simply abort the whole chunk (256 paths) on the theory that a malformed path is rare enough not to matter. Rejected: `add_image` in a loop never lost batch-mates to one bad row, and the batching change is supposed to be a pure performance win — changing failure semantics would be an unannounced behaviour regression riding along with an unrelated optimisation.
- **`embedding_generation_token` over a bare mtime check.** The flat embedding store's original freshness check compared the store file's mtime against the DB file's mtime — cheap, but conflates "the DB file changed at all" with "this encoder's population changed", and can't detect a root-toggle that changes zero embedding rows but changes which rows the encoder's store should hold. The token is a small SQL aggregate (COUNT/SUM/MAX over rowid) folded via FNV, computed on read rather than stored, so it needs no schema migration and moves precisely when the filtered population it's derived from moves.
- **Embedding-as-BLOB was an explicit choice.** Alternatives (one row per dimension; serialised JSON; bincode) were considered but BLOB is space-efficient and round-trips f32 directly. The trade-off is opacity to SQL — you can't do nearest-neighbour search inside SQLite — but that's fine because cosine logic lives in the cosine module operating on a Rust `Vec<(PathBuf, Array1<f32>)>` in memory.
- **`bytemuck::cast_slice` over `unsafe slice::from_raw_parts`** because the `Pod` marker on `f32` proves at compile time that the reinterpretation is safe. Same zero-copy view, same bytes; no `unsafe` block. Audit Inconsistent Patterns finding `0bdb5f4`.
- **The `_filter_string` parameter is intentionally unused inside the SQL.** It's part of the cache key on the frontend (`useImages.ts`) so React Query treats different search strings as different cache entries. The backend ignores it because tag filtering happens via `filter_tag_ids` and free-text search happens via the separate semantic-search command.
- **`get_images_with_thumbnails` does its own LEFT-JOIN aggregation in Rust** rather than using SQL `GROUP_CONCAT` because the result needs typed `Tag` rows, not flattened strings. The `aggregate_image_rows` helper centralises this so the next change happens in one place.
- **Stable sort by id (oldest first), not random shuffle.** The previous shuffle-on-every-read caused the visible "entire app refreshes" behaviour during indexing; every refetch reordered the grid. Sort modes now live in frontend `useUserPreferences`; the backend returns deterministic order. See `notes/random-shuffle-as-feature.md` for the historical context.
- **AND vs OR tag filter is opt-in.** Default is OR (`Any`) which preserves the previous behaviour. Users who want AND flip the toggle in Settings → Search → Tag filter. The query key includes `matchAllTags` so toggling re-fetches with fresh SQL semantics.
- **WAL was the explicit fix for foreground/background DB contention.** Pre-WAL, the indexing pipeline's writes blocked every UI read; the grid would freeze for seconds at a time during encode. WAL eliminates the blocking; foreground reads stay responsive while background writes proceed.
- **`PRAGMA foreign_keys = ON` is required for CASCADE to work.** SQLite defaults this OFF. Without it, removing a root would leave its image rows orphaned forever.

## Obsolete / No Longer Relevant

The pre-split single-file `db.rs` (1597 lines, audit's top hotspot) is gone. The `get_images()` "no thumbnail data" function still exists alongside `get_images_with_thumbnails` — the former backs `get_all_images()` and tests; the latter backs the `get_images` Tauri command, which itself is now wire-compat only (`get_feed_manifest` is what the grid actually reads — see the T3-1 section above). All three share the `aggregate_image_rows` helper.
