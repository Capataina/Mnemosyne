# cosine-similarity

*Maturity: comprehensive · Stability: unstable*

## Scope / Purpose

Per-encoder embedding storage and cosine-similarity scoring. Provides three retrieval
modes over ONE encoder's rows at a time: random-sampled top-N (diversity), strictly-sorted
top-N (semantic search), and Pinterest-style tiered sampling (visual similarity). There is
no longer a single "primary" resident cache — every caller borrows a per-encoder slot from
`FusionIndexState` (`systems/multi-encoder-fusion.md`), which owns `CosineIndex` instances
keyed by encoder id. This file covers the `CosineIndex`/`FlatStore` machinery itself: what
it stores, how it scores, and how it persists to disk. The T3-2 perf round
(`fc6667a` + `1514a90`) rewrote this subsystem end to end — it went ID-native, the storage
flattened into three arrays per encoder, and the primary index this file used to document
was removed outright. Read `notes/performance-decisions.md` for the round's full narrative
and honest residuals.

## Boundaries / Ownership

- **Owns:** the per-encoder `FlatStore` (id column + inverse-norm column + row-major f32
  embedding block, heap-owned or mmap-backed), the cosine math (`dot × q_inv × c_inv`) +
  NaN-aware comparator, the three retrieval methods, the generation-token freshness check,
  the versioned-file mmap persistence (`embstore_<encoder>.bin`).
- **Does not own:** persistence canonicality (the embeddings themselves live in SQLite as
  BLOBs; the flat store is a load-time optimisation), embedding generation (delegates to
  the encoder crates), which encoder(s) are active/enabled (`FusionIndexState` + Settings),
  cache lifetime/lock discipline across encoders (that's `multi-encoder-fusion.md`'s job —
  `CosineIndex` itself has no lock; it is wrapped in the fusion `RwLock` by its caller).
- **Public API:** `CosineIndex::new()`, `add_image(image_id: i64, embedding: Array1<f32>)`,
  `populate_from_db_for_encoder(&db, encoder_id)`, `populate_from_db(&db)` (legacy,
  encoder-agnostic), `refresh_if_stale(&db, encoder_id) -> bool`, `cosine_similarity(a, b)`
  (associated fn, thin delegate to `math::`), `get_similar_images(emb, top_n, exclude_id)`,
  `get_similar_images_sorted(emb, top_n, exclude_id)`, `get_tiered_similar_images(emb,
  exclude_id)`, `save_to_disk()`, `save_store_for(encoder_id)`, `save_store_to(path,
  encoder_id)`, `load_store_if_valid(&db, encoder_id) -> bool`. `cached_images: FlatStore`
  is `pub` — the field name is preserved (not renamed to e.g. `store`) so the untouchable
  indexing pipeline's `idx.cached_images.is_empty()` and the command layer's `.len()` keep
  resolving unchanged; only the type underneath changed.

## Current Implemented Reality

### Submodule layout

```text
crates/engine/src/cosine/
├── mod.rs           — pub use index::CosineIndex; pub use store::FlatStore; module decls
├── math.rs          — dot_slice (sequential fold), inv_norm (1/|v|, cached at populate
│                       time), cosine_similarity_slice/cosine_similarity (reference formula,
│                       recomputes both norms — used by the equivalence tests, NOT the hot
│                       path), score_cmp_desc (NaN-aware desc comparator) + math tests
├── store.rs         — FlatStore: dim, ids: Vec<i64>, inv_norms: Vec<f32>, block: Block.
│                       Block is Owned(Vec<f32>) or Mapped{mmap: Arc<Mmap>, byte_start,
│                       byte_len} (zero-copy view). is_empty/len/clear/dim/ids/inv_norms/
│                       block/row(r) — the whole surface both index.rs and diagnostics.rs
│                       consume. push_owned(id, emb) is the build-path append (computes
│                       inv_norm inline); from_parts(...) is the load-path constructor.
├── index.rs         — CosineIndex struct (cached_images: FlatStore, encoder_id: Option
│                       <String>, gen_token: u64) + populate_from_db_for_encoder +
│                       populate_from_db (legacy) + refresh_if_stale + score_all (the rayon
│                       scan) + 3 retrieval methods + diagnostic emissions
├── rrf.rs           — Phase 5: pure Reciprocal Rank Fusion (Cormack 2009, k=60), ID-native
│                       (RankedList.items: Vec<(i64, f32)>). Full canonical home:
│                       systems/multi-encoder-fusion.md.
├── diagnostics.rs   — 4 stateless helpers, now take `&FlatStore` instead of the old
│                       `&Vec<(PathBuf, Array1<f32>)>`: embedding_stats,
│                       pairwise_distance_distribution, self_similarity_check,
│                       score_distribution_stats
└── cache.rs         — T3-2/#8+#20 mmap persistence: save_to_disk / save_store_for /
                        save_store_to / load_store_if_valid + load_flat_store (private
                        parser shared with the format tests) + 7 disk-persistence /
                        format-rejection tests

crates/engine/src/cosine_similarity.rs  — 9-line shim: `pub use crate::cosine::*;`

apps/lynceus/src-tauri/src/similarity_and_semantic_search/
├── mod.rs            — re-exports `mnemosyne::{cosine, cosine_similarity}` so
│                        `crate::similarity_and_semantic_search::cosine[_similarity]::…`
│                        call sites across the product crate keep resolving unchanged
└── ort_session.rs     — shared M2-tuned ort Session builder; unrelated to this round
```

Two shims stack to keep the old import path alive across the crate split: the engine's own
`cosine_similarity.rs` re-export shim, plus the product's `similarity_and_semantic_search/
mod.rs` re-export of `mnemosyne::{cosine, cosine_similarity}`. Neither shim needed to change
this round — the module-path surface is untouched; only what lives inside `CosineIndex`
changed.

### ID-native end to end (T3-2/#6, `fc6667a`)

Every retrieval method now takes and returns `image_id: i64`, not `PathBuf`. Exclusion is
`Some(ids[row]) == exclude_id` inside the scan, not a path comparison. This killed two
things at once: the up-front `db.get_all_images()` join every search command used to run
purely to map paths back to ids (a 200-300k-row `LEFT JOIN` unroll per request at 100k,
fired 20-30× per settled viewport by the visible-tile prefetch), and the per-result
thumbnail N+1. Both are replaced by one shared `hydrate_search_results` (`commands/mod.rs`)
doing a single `WHERE id IN (...)` fetch over the ~30 result rows, called once per command
after scoring — see `commands/similarity.rs::get_fused_similar_images` /
`get_tiered_similar_images` / `get_similar_images` and `commands/semantic.rs::
semantic_search`. The old path→id resolution helper (`resolve_image_id_for_cosine_path`)
died outright — ids were being round-tripped through paths that were ids to begin with.

### The flat store (T3-2/#8+#20, `crates/engine/src/cosine/store.rs`)

```rust
pub struct FlatStore {
    dim: usize,
    ids: Vec<i64>,
    inv_norms: Vec<f32>,
    block: Block,   // Owned(Vec<f32>) | Mapped { mmap: Arc<Mmap>, byte_start, byte_len }
}
```

Replaces the old per-row `Vec<(PathBuf, Array1<f32>)>` — ~400k separate heap allocations at
100k images × 3 encoders (one boxed `Array1` per row per encoder) — with three flat arrays
per encoder: an id column, an inverse-norm column, and one contiguous row-major f32 block.
`row(r)` slices `block[r*dim .. (r+1)*dim]`. The inverse norm is computed once at
`push_owned` time (T1-4 cached norms, absorbed into the store's birth rather than built as
a separate pass) — **real norms, never assumed unit**, so legacy pre-normalise CLIP rows
(which are not unit vectors) still score exactly via the cached-norm formula. Proven by
`legacy_off_unit_norm_row_scores_via_cached_norm` (`index.rs` tests): a deliberately
non-unit-norm row scored through the flat cached-norm path matches the direct recomputed-
norm cosine formula to 1e-6.

`Block::Mapped` is a zero-copy view into an `Arc<Mmap>` — validated 4-byte-aligned once at
load time (`cache.rs`) before construction, so `as_slice`'s `bytemuck::cast_slice` is always
sound. Holding the `Arc<Mmap>` keeps the mapping alive for the store's lifetime; clearing or
replacing the store drops the Arc and unmaps. `push_owned` copies a mapped block to owned
first if the build path is ever reached on a mapped store (in practice this never fires —
build always follows a `clear()`).

**No id→row lookup structure was built — deliberate design call.** Scoring is a full linear
scan (`score_all`, below) and exclusion is an inline id compare; a 100k-entry `HashMap<i64,
usize>` (~10 MB across encoders) would have had zero consumers, since nothing needs random
access to a row by id — every caller either scans everything or looks a query embedding up
via the DB, not via the flat store.

### Scoring — `score_all` (rayon parallel scan, `index.rs`)

```rust
fn score_all(&self, embedding: &Array1<f32>, exclude_id: Option<i64>) -> Vec<(usize, f32)> {
    // dim mismatch → warn + return empty (never panic)
    let q_inv = inv_norm(q);
    (0..store.len())
        .into_par_iter()
        .filter_map(|row| {
            if Some(ids[row]) == exclude_id { return None; }
            let c = &block[row * dim..(row + 1) * dim];
            Some((row, dot_slice(q, c) * q_inv * inv[row]))
        })
        .collect()
}
```

Every candidate row's score is `dot(q, row) × q_inv × c_inv` — the cached-inverse-norm form
of cosine similarity, skipping the per-candidate `sqrt` the old per-call formula paid.
Parallelised via rayon's `into_par_iter().collect()` over the row range, which **preserves
row order** — the returned `Vec<(usize, f32)>` is deterministic and the downstream
`select_nth_unstable_by`/`sort_unstable_by` calls are pure functions of that sequence, so
ranking is provably identical to the old serial loop. Pinned by
`parallel_scoring_matches_serial_reference` (400 rows × dim 16, compares against a fresh
full-cosine serial reference to 1e-6) and `parallel_scoring_excludes_query_id`. A
cross-encoder dim mismatch (query dim ≠ cache dim) returns an empty Vec with a `warn!`
rather than panicking — the dispatch layer is supposed to prevent this (each fusion slot
holds one encoder's dim), so this is a defensive floor, not an expected path.

`&self` scoring (not `&mut self`) is what lets `FusionIndexState`'s double-checked-locking
score a warm slot under a **shared read lock** — see `multi-encoder-fusion.md`.

### Population paths

| Method | When | Source |
|--------|------|--------|
| `populate_from_db_for_encoder(&db, encoder_id)` | Cold fusion slot (first use or after invalidation) | `db.get_all_embeddings_for(encoder_id)` — one SELECT, filtered to one encoder. Falls back to legacy `images.embedding` (`get_all_embeddings()`) for `clip_vit_b_32` specifically if the per-encoder table is empty (pre-schema installs). |
| `populate_from_db(&db)` | Legacy, encoder-agnostic — no caller left in the product crate; kept for the integration test and hand-built indexes | `db.get_all_embeddings()` — every encoder's rows mixed together (only correct for a single-encoder DB). |
| `add_image(id, embedding)` | Tests, temporary indexes (`run_cross_encoder_comparison` builds one per other encoder for the diagnostic) | One row at a time via `push_owned`. |
| `load_store_if_valid(&db, encoder_id)` | Every slot populate now tries this FIRST | Mmap the persisted `embstore_<encoder>.bin` if its header + generation token match the DB (see below). |

Both DB-populate paths clear + `reserve(total, dim)` the store up front, then
`push_owned(id, &embedding)` per non-empty row, and (in the per-encoder path) set
`encoder_id` + `gen_token = db.embedding_generation_token(encoder_id).unwrap_or(0)` — a DB
error here leaves the token at 0, which is always treated as stale on the next load, so the
failure mode is "rebuild," never "serve a wrong population."

### Generation-token freshness (T3-2/#20) — replaces bare mtime

```rust
pub fn embedding_generation_token(&self, encoder_id: &str) -> rusqlite::Result<u64> {
    // SELECT COUNT(*), SUM(e.rowid), MAX(e.rowid) FROM embeddings e
    // JOIN images i ON i.id = e.image_id
    // WHERE e.encoder_id = ?1 AND i.orphaned = 0
    //   AND (i.root_id IS NULL OR i.root_id IN (SELECT id FROM roots WHERE enabled = 1))
    // → FNV-1a fold of (count, sum, max) as three little-endian i64s
}
```

`crates/engine/src/db/images_query.rs:597`. The old `cosine_cache.bin` freshness check
compared the cache file's mtime against the SQLite DB file's mtime — a bare mtime cannot
distinguish "a root got disabled" (which changes the enabled/orphaned row set without
touching a single `embeddings` row, so the DB file's own mtime may not even move on a
pure-toggle) from "nothing changed." At 100k scale this silently served the wrong
population. The generation token folds `COUNT`/`SUM(rowid)`/`MAX(rowid)` over the exact
same enabled/orphaned JOIN the store is built from, so insertions (count/sum/max climb),
deletions (count/sum drop), and root enable/disable toggles (rows enter/leave the filtered
set) all move the token. `CosineIndex::refresh_if_stale(&db, encoder_id)` recomputes this
token and only repopulates on a mismatch — a no-op rescan costs one cheap SQL aggregate per
encoder and no repopulate.

### Persisted flat store — one versioned mmap file per encoder (`cache.rs`)

```text
app_data_dir()/embstore_<encoder_id>.bin

0    8   magic  b"LYNEMB01"
8    4   format_version u32
12   4   _pad
16   8   encoder_hash u64 (FNV-1a of encoder_id)
24   4   dim u32
28   4   row_count u32
32   8   gen_token u64
40   24  reserved (zeroed)  → header is exactly 64 bytes
64        row_count*8  id table (i64)
...       row_count*4  inv_norm table (f32)
...       pad → next 64-byte boundary (so the block is 64-aligned)
...       row_count*dim*4  embedding block (f32)
```

Write path (`save_store_to`): serialises the whole buffer in memory, then writes to a
`.tmp` sibling and `fs::rename`s it into place — a torn write from a crash mid-write is
never observed as the live file, so the mmap load never sees a partial file. Load path
(`load_flat_store`): opens + `mmap`s the file, validates magic → format_version →
encoder_hash → gen_token → reconstructed section lengths against actual file length (this
last check catches a corrupt/truncated `dim`/`row_count` — the header's size fields
disagreeing with reality), in that order, returning `None` on the first mismatch so the
caller falls back to a DB populate. The embedding block is mapped **zero-copy** when the
absolute address is 4-byte aligned — guaranteed by the 64-aligned `block_off` on top of the
page-aligned mmap base — and copied into an owned `Vec<f32>` only in the (never-expected-
to-fire) exotic-alignment fallback. `is_mapped()` (test-only) plus
`mapped_block_scores_identically_to_owned` prove the zero-copy path is both taken and score-
identical to the owned path.

**Native-little-endian by construction, and this is a deliberate landmine, not an
oversight.** The zero-copy `bytemuck::cast_slice` is inherently native-endian — there is no
byte-swap step. This is a documented non-issue for this desktop-only, single-architecture-
per-install app; it becomes a real bug the day the format ever needs to travel cross-arch
(e.g. a synced-library feature between an Intel and an Apple Silicon machine). New
dependency `memmap2 0.9`, confined entirely to `cache.rs`.

`save_to_disk()` (on `CosineIndex`) writes `self.encoder_id`'s store if set, warns and
skips otherwise (a hand-built `add_image`-only index has no encoder id to key the file on).
`save_store_for(encoder_id)` / `save_store_to(path, encoder_id)` are the path-explicit
variants tests and the indexing pipeline use directly.

### Three retrieval modes (unchanged contract, ID-native signatures)

```rust
pub struct CosineIndex {
    pub cached_images: FlatStore,
    pub(crate) encoder_id: Option<String>,
    pub(crate) gen_token: u64,
}
```

| Mode | Method | Returns | Used by |
|------|--------|---------|---------|
| Diversity-sampled | `get_similar_images(emb, top_n, exclude_id)` | Sort by cosine desc, take top max(top_n, 20% of pool), randomly pick top_n from that pool | `commands::similarity::get_similar_images` |
| Strict-sorted | `get_similar_images_sorted(emb, top_n, exclude_id)` | Top top_n by cosine desc — exactly | `commands::semantic::semantic_search`, per-encoder inputs to fusion |
| 7-tier | `get_tiered_similar_images(emb, exclude_id)` | 5 random per tier × 7 tiers (0-5%, 5-10%, 10-15%, 15-20%, 20-30%, 30-40%, 40-50%); deduplicated via `HashSet<usize>` | `commands::similarity::get_tiered_similar_images` |

All three now build on the shared `score_all` parallel scan rather than each doing its own
serial pass. The partial-sort optimisation (`select_nth_unstable_by` + re-sort the trimmed
top-K, replacing a full sort + `take(top_n)`) is unchanged from the pre-round design and
still the algorithmic win it was — see Durable Notes.

### Cosine math (`math.rs`)

```rust
pub(crate) fn dot_slice(a: &[f32], b: &[f32]) -> f32 { a.iter().zip(b).map(|(x, y)| x * y).sum() }
pub(crate) fn inv_norm(v: &[f32]) -> f32 { let sq = dot_slice(v, v); if sq == 0.0 { 0.0 } else { 1.0 / sq.sqrt() } }
pub(crate) fn cosine_similarity_slice(a: &[f32], b: &[f32]) -> f32 { /* recomputes both norms fresh */ }
```

`dot_slice` is deliberately a plain sequential fold rather than an ndarray/BLAS reduction:
both the flat-store hot scan and the serial-reference equivalence test route through this
one function, so the summation order — and therefore the bit-pattern — is identical between
the two, which is what makes the equivalence tests meaningful rather than "close enough."
`cosine_similarity_slice`/`cosine_similarity` (the reference formula, recomputing both norms
every call) is NOT on the hot path any more — it exists for the equivalence tests, the
`CosineIndex::cosine_similarity(&a, &b)` associated-fn back-compat surface (still used by
the startup sanity check and the integration test), and `diagnostics.rs`'s pairwise
histogram (which needs to score arbitrary row pairs, not query-vs-cache).

## Key Interfaces / Data Flow

### Inputs

| Source | Provides |
|--------|----------|
| `db.get_all_embeddings_for(encoder_id)` | (id, path, `Vec<f32>`) per non-null embedding, filtered to one encoder |
| `db.embedding_generation_token(encoder_id)` | `u64` FNV fold — the freshness signal for both the in-memory slot and the on-disk store header |
| `app_data_dir()/embstore_<encoder_id>.bin` (via mmap) | Persisted `FlatStore` from a previous session, one file per encoder |
| `FusionIndexState` (`multi-encoder-fusion.md`) | The only caller that constructs/holds `CosineIndex` instances — every search command reaches this module through a fusion slot, never directly |
| `indexing.rs::run_pipeline_inner` step 7 | `refresh_if_stale` + `save_store_for` per enabled encoder at `Phase::Ready` |

### Outputs

| Destination | What |
|-------------|------|
| `FusionIndexState::ranked_for_encoder` / `with_encoder_index` | `Vec<(i64, f32)>` scored results, consumed directly (ID-native — no path resolution needed) |
| `app_data_dir()/embstore_<encoder_id>.bin` | The versioned header + id/inv-norm/block sections |
| Tracing spans `cosine.*` | Per-method timings for the perf report |

### State

- Per encoder: `ids: Vec<i64>` (~8 bytes/row) + `inv_norms: Vec<f32>` (~4 bytes/row) +
  block (~dim×4 bytes/row — e.g. 512-d CLIP ≈ 2 KB/row, 768-d SigLIP-2/DINOv2 ≈ 3 KB/row).
  At 100k images × 3 encoders this is the ~800 MB the module docstring in `store.rs`
  references — but a warm launch now *maps* that instead of allocating and copying it, so
  resident RSS tracks what the OS actually pages in, not the full size up front.
  `embstore_<encoder_id>.bin` on disk, one file per encoder, same rough size as the
  in-memory block plus the 64-byte header and id/norm tables.

## Implemented Outputs / Artifacts

- 3 retrieval modes, ID-native, shared `score_all` rayon scan.
- Per-encoder `FlatStore`: id/inv-norm/block arrays, heap-owned or mmap-backed.
- Generation-token freshness (`embedding_generation_token` + `refresh_if_stale`), replacing
  bare-mtime invalidation.
- Versioned per-encoder mmap persistence (`embstore_<encoder>.bin`) with atomic-rename
  writes and header-validated, fail-safe-to-rebuild loads.
- `math.rs` (8+ unit tests), `cache.rs` (7 disk-persistence/format-rejection tests +
  1 zero-copy-equivalence test), `index.rs` (test suite covers add/populate, both retrieval
  contracts, the ID-native exclusion, the parallel/serial score equivalence, the legacy
  off-unit-norm-row equivalence, and `refresh_if_stale`'s three-call state machine).
- Tracing spans `cosine.populate_for_encoder`, `cosine.populate_from_db`,
  `cosine.get_similar_images`, `cosine.get_similar_sorted`, `cosine.get_tiered_similar` for
  perf attribution.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| Dimension mismatch returns empty (no longer panics) but is silent to the user | A model swap that changes embedding dim reaching `score_all` with a stale query vector | `score_all` now warns + returns `Vec::new()` rather than panicking — a real improvement over the old `ndarray` `.dot()` panic-on-shape-mismatch — but the caller (a search command) just sees "0 results" with no surfaced reason beyond the log. |
| Native-little-endian mmap format | Any future cross-arch sync/import of a `embstore_*.bin` file (e.g. Intel ↔ Apple Silicon) | A big-endian host would misread the block; the header has no endianness flag to detect this. Documented as a non-issue *today* (desktop-only, single-arch-per-install) — flag explicitly if a synced-library or export feature is ever built on top of this format. |
| `Phase::Ready`'s per-encoder refresh runs under the fusion write lock | A CHANGED encoder's `refresh_if_stale` → `populate_from_db_for_encoder` + `save_store_for` at ~0.5-1s/encoder at 100k images | A concurrent search against THAT encoder blocks for the populate+persist duration; a full three-encoder import blocks searches for ~3s total in that window (searches against other, unchanged encoders are unaffected — the write lock is per-encoder-iteration, not held across all three). Follow-up: build the refreshed store outside the lock, then swap it in. See `notes/performance-decisions.md`. |
| `save_to_disk` / `paths::cosine_cache_path` are orphaned | Nothing — no caller reaches either any more | Dead code left in place rather than deleted this round (`cache.rs`'s `save_to_disk` still compiles and is exercised by nothing outside its own module; `paths::cosine_cache_path()` similarly has no caller besides its own unit test). Low-risk clutter, not a bug — flagged for the next hygiene pass on these two files specifically. |
| `FlatStore` build path (`push_owned`) silently drops a row whose length disagrees with the already-established `dim` | A DB row with the wrong-length embedding (corrupt write, migration bug) | The row is dropped, not surfaced — consistent with the pre-round behaviour (the old `populate_from_db` loop had the same "one encoder, one dim" implicit contract), so not a regression, but still an easy failure to miss if it ever fires at scale. |

## Partial / In Progress

- **Build-outside-lock-then-swap for the Phase::Ready refresh.** Named follow-up from
  `1514a90` — see Known Issues above and `notes/performance-decisions.md` for the full
  writeup. Not started.

## Planned / Missing / Likely Changes

- **HNSW or similar approximate nearest neighbour** behind a trait. `score_all` is O(N) per
  query (now rayon-parallelised, but still a full scan); HNSW would be O(log N) at the cost
  of imperfect recall. The flat-store rewrite this round makes the *linear-scan* case fast
  (cached norms, zero-copy mmap, parallel scan) but does not by itself reduce the
  asymptotic — an ANN index remains the next lever if 100k-scale query latency becomes the
  bottleneck rather than the load-time cost this round targeted. Gated by real-world
  latency measurements at 100k+.
- **MMR / DPP retrieval modes** for diversity-aware re-ranking. Unaffected by this round;
  still speculative.
- **Per-query cache** for repeated "more like this image" calls within a session. Unaffected
  by this round; the flat-store scan is already fast enough that this hasn't been revisited.
- **Delete `save_to_disk`/`paths::cosine_cache_path`** — orphaned, see Known Issues.

## Durable Notes / Discarded Approaches

- **Bare mtime as freshness signal — abandoned this round because it silently served stale
  populations at scale.** The pre-round `cosine_cache.bin` invalidation compared file mtime
  against the DB file's mtime. This looked fine at low N because a mtime-based miss just
  meant an extra (cheap) repopulate. At 100k it went wrong the other way: a root-toggle can
  change which rows the enabled/orphaned filter includes without necessarily bumping the DB
  file's own mtime in a way the comparison caught reliably, so a stale in-memory or on-disk
  population could be served as fresh. The generation token (COUNT/SUM/MAX(rowid) over the
  exact filtered JOIN, FNV-folded) replaces this and is what the store's header now carries
  instead of a timestamp.
- **The primary in-memory `CosineIndexState` (`Arc<Mutex<CosineIndex>>` shared with the
  indexing thread) — REMOVED, and its removal fixed a latent bug the removal work itself
  had introduced.** Before this round, every search command read one shared primary index
  that the indexing pipeline repopulated at `Phase::Ready`. `fc6667a` rerouted the three
  primary search commands onto the (pre-existing) per-encoder `FusionIndexState` slots as
  part of going ID-native, but the indexing pipeline still only knew how to repopulate the
  now-readerless primary — fusion slots were cleared only by root add/remove/toggle IPCs,
  with no handle from the pipeline. The result: after a mid-session index (startup
  incremental scan, watcher rescan), image-image / tiered / semantic search would serve
  rankings **missing the newly-encoded images until the app was relaunched**. This was a
  regression the reroute itself created, not a pre-existing bug — before the reroute, those
  commands read the primary index the pipeline *did* keep fresh, so the old architecture's
  post-index freshness was, in hindsight, an accident of the very duplicate this round set
  out to remove. **No test caught it** — the repo has no end-to-end indexing-pipeline test —
  and it was found by tracing the invalidation path as a mandated step of the removal work,
  not by a bug report. `1514a90` fixed both problems in one change: it replaced the
  pipeline's step-7 primary-populate-and-save with a token-gated `refresh_if_stale` +
  `save_store_for` loop over every enabled encoder's *fusion* slot, and then deleted
  `CosineIndexState` outright (struct, `ensure_loaded_for`/`invalidate`, the `.manage()`
  registration, the two Arcs threaded through `try_spawn_pipeline` / `run_pipeline_inner` /
  `run_encoder_phase` / `watcher::start`) because it had no genuine reader left — every
  search command already borrowed fusion slots, and `roots.rs`'s old `invalidate()` calls on
  the primary were clearing a struct nothing ever read from again. The obsolete
  `cosine_cache_invalidation_diagnostic` test (which tested a marker bug in the now-deleted
  code path) was deleted rather than adapted, since the architecture it exercised no longer
  exists. See `notes/performance-decisions.md` for the fuller narrative and
  `notes/mutex-poisoning.md` for the lock-discipline simplification this enabled.
- **`select_nth_unstable_by` + re-sort the trimmed top-K** is still the right trade-off,
  unchanged by this round. A full sort is `O(N log N)`; partial select is `O(N)` for the
  partition + `O(K log K)` for the final sort.
- **The diversity-pool sampler is intentional UX, not a bug.** `get_similar_images` does not
  return the strict top-N — it samples within the top 20% pool. See
  `notes/random-shuffle-as-feature.md`.
- **The 7-tier sampler is load-bearing UX** for the (now legacy, fusion-superseded)
  tiered-similarity path — see `multi-encoder-fusion.md`'s Obsolete section for its current
  call status.
- **Flat arrays over `Vec<(i64, Array1<f32>)>`** because ~400k separate heap allocations at
  100k×3-encoders was the actual scaling wall this round exists to remove — see `store.rs`'s
  module docstring and the Current Implemented Reality section above.
- **`memmap2` over a bincode-deserialise-into-fresh-allocations reload** because the old
  `cosine_cache.bin` path paid a full deserialise (allocating every row again) on every warm
  launch; mmap pages the block in on demand instead, so a warm launch's dominant cost is
  what the OS actually touches, not the full file size.
- **No id→row lookup structure** — see Current Implemented Reality above; the design call
  was that a 100k-entry `HashMap` would have zero consumers given the scan-everything access
  pattern every retrieval mode actually uses.
- **`Arc<Mutex<CosineIndex>>` over channel-based ownership** — obsolete note: this described
  the now-removed primary index's concurrency model. The current shared-cache concurrency
  primitive is `FusionIndexState`'s single `RwLock`, documented in
  `multi-encoder-fusion.md` and `notes/mutex-poisoning.md`.
- **Persistent store uses a hand-rolled binary header, not bincode.** Bincode's
  `Vec<(PathBuf, Vec<f32>)>` deserialise-into-fresh-allocations was exactly the cost this
  round's mmap rewrite exists to avoid — a self-describing fixed header plus flat sections
  is what makes the zero-copy `bytemuck::cast_slice` load possible; bincode's format isn't
  laid out for that.

## Obsolete / No Longer Relevant

- **The primary `CosineIndexState` / `Arc<Mutex<CosineIndex>>` shared cache** — removed
  entirely in `1514a90`. See Durable Notes above for the full story.
- **`cosine_cache.bin` (bincode, single-file, mtime-gated)** — replaced by one versioned
  `embstore_<encoder_id>.bin` per encoder, mmap-loaded, generation-token-gated.
- **`save_to_disk()`'s old bincode implementation and `load_from_disk_if_fresh`** — both
  gone; `load_from_disk_if_fresh` became a documented no-op earlier in the round (the engine
  crate cannot see app settings to know the active encoder) before being fully superseded by
  `load_store_if_valid`. `save_to_disk()` itself still exists (delegating to
  `save_store_for`) but is now caller-less — see Known Issues.
- **`PathBuf`-keyed retrieval methods and the path→id resolution helper
  (`resolve_image_id_for_cosine_path`)** — gone; every method is `image_id: i64` end to end.
- **The old per-image N+1 SELECT inside `populate_from_db`** — was already replaced by
  `get_all_embeddings()` pre-round; unaffected by this round beyond the storage type it
  populates into.
- **The pre-split single-file `cosine_similarity.rs` (860 lines)** — gone (replaced by the
  shim), pre-dates this round.

## Related Systems

- `multi-encoder-fusion.md` — owns the `RwLock<HashMap<String, CosineIndex>>` every caller
  reaches this module through; the lock discipline, populate-or-borrow dispatch, and
  invalidation triggers live there.
- `indexing.md` — the pipeline's step 7 (`refresh_if_stale` + `save_store_for` per enabled
  encoder at `Phase::Ready`) is this module's only writer besides the fusion slots'
  lazy-populate path.
- `notes/performance-decisions.md` — the T3-2 round's full narrative: design calls, honest
  residuals, and the staleness-regression fix.
- `notes/fusion-architecture.md` — the conceptual model of the two loops (indexing vs
  search) this module's population/scoring split implements.
- `notes/mutex-poisoning.md` — the lock inventory, now simplified to one `RwLock` with no
  AB-BA surface following the primary index's removal.
