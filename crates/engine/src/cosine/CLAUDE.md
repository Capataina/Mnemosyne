# crates/engine/src/cosine/

Cosine retrieval, cache/store, diagnostics, name matching, top-k indexing,
and reciprocal-rank fusion. Split into submodules that all contribute to one
`CosineIndex` inherent impl, so the public API reads as if it were one file.

## Map

- `mod.rs` — the split's rationale and re-export wiring; `cache` is in scope
  purely for its `impl CosineIndex` side-effect.
- `math.rs` — pure helpers: the cosine formula, `dot_slice`, `inv_norm`, and
  the shared `score_cmp_desc` comparator.
- `store.rs` — `FlatStore`: id column + inverse-norm column + one row-major
  f32 block, heap-owned or a zero-copy mmap view; replaced ~400k boxed
  `Array1` allocations at 100k images × 3 encoders.
- `index.rs` — `CosineIndex`: ingestion (`add_image`,
  `populate_from_db_for_encoder`), the three retrieval methods, and
  `refresh_if_stale` (the token-gated repopulate the indexing pipeline calls
  at Ready).
- `cache.rs` — persistence: `embstore_<encoder_id>.bin` per encoder, 64-byte
  versioned header (magic `LYNEMB01`, format version, encoder FNV hash, dim,
  row count, generation token), 64-aligned sections, temp-file + atomic
  rename, mmap load. The full byte layout is in this file's module doc.
- `rrf.rs` — Reciprocal Rank Fusion (Cormack/Clarke/Büttcher 2009,
  `k_rrf = 60`) over per-encoder rankings; replaced the old tiered sampler
  because encoder disagreement supplies diversity for free.
- `name_match.rs` — fuzzy filename scoring (containment + token +
  Levenshtein, dependency-free), producing a `RankedList` so filename
  relevance enters the same RRF as the encoders; ranks even never-encoded
  images.
- `diagnostics.rs` — embedding-quality statistics (norms, NaNs, pairwise
  distances, self-similarity) emitted into the profiling report on encoder
  swap.

## Invariants

- Per-encoder `FlatStore` mmap files are the only similarity-index state;
  preserve the 64-byte versioned header, generation token, temp-file-plus-
  atomic-rename writes, and explicit mismatch-rejection tests.
- Retrieval returns image IDs and fuses rankings with RRF — never fuse raw
  scores from unlike encoders, and never reintroduce path resolution on hot
  search paths.
- Build refreshed stores outside write locks and swap under the shortest
  practical lock window.

## Key findings

- **Freshness is easy to break silently** (1514a90, 2026-07-17): rerouting
  the primary search commands onto fusion slots without giving the indexing
  pipeline a handle to refresh them made post-index search stale until
  relaunch — the old architecture's freshness had been an accident of a
  duplicate populate. The fix is the pattern to keep: `refresh_if_stale`
  recomputes the generation token and repopulates only on mismatch, so a
  no-op rescan costs one SQL aggregate.
- **No id→row lookup structure exists by decision** (fc6667a): scoring is a
  full linear scan with inline id exclusion; a 100k HashMap would have had
  zero consumers. Don't add one without a consumer.
- **Real norms, never assumed unit** (fc6667a): legacy pre-normalised CLIP
  rows keep exact scores because inverse norms are computed, test-proven by
  a serial-reference equivalence test that survived the whole migration.

## Traps

- The store format is native-little-endian by construction — zero-copy f32
  casts are inherently native-endian. A non-issue for this desktop-only app;
  a known landmine if the format ever ships cross-arch.
- The generation token derives from the DB's enabled/orphaned population
  (see `db/`); a bare mtime check was rejected because it cannot see a root
  toggle that changes the row-set without touching the embeddings table.
  Never substitute mtime or a restart-local counter.
- `save_to_disk` (whole-index legacy entry) has no production caller since
  1514a90; live persistence goes through the per-slot store writes. Left in
  place for its file's next pass — don't build on it.
- Fusion is one `RwLock`: pipeline takes `write()` per encoder released
  between encoders, searches take `read()` with a double-checked `write()`
  populate. The old two-lock order died with `CosineIndexState`; don't
  reintroduce a second lock.
