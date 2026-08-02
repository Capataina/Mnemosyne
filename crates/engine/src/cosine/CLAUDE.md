# crates/engine/src/cosine/

Cosine retrieval, cache/store, diagnostics, name matching, top-k indexing, and reciprocal-rank fusion. Split into submodules that all contribute to one `CosineIndex` inherent impl, so the public API reads as if it were one file. The T3-2 perf round (fc6667a + 1514a90, 2026-07) rewrote this subsystem end to end: ID-native signatures, the flat store, and the removal of the old primary resident index. Decisions recorded here remain true as decisions even when code moves on; the code wins only on current state.

## Map

```
cosine/
├── mod.rs           the split's rationale and re-export wiring; `cache` is in scope purely
│                    for its `impl CosineIndex` side-effect.
├── math.rs          pure helpers: the cosine formula, `dot_slice`, `inv_norm`, and the
│                    shared `score_cmp_desc` NaN-aware comparator. `dot_slice` is
│                    deliberately a plain sequential fold, not a BLAS reduction: the hot
│                    scan and the serial-reference equivalence tests route through the
│                    same function, so summation order — and therefore the bit pattern —
│                    is identical, which is what makes the equivalence tests meaningful
│                    rather than "close enough". `cosine_similarity_slice` (recomputes
│                    both norms) is the reference formula for tests and diagnostics, NOT
│                    the hot path.
├── store.rs         `FlatStore`: `dim` + `ids: Vec<i64>` + `inv_norms: Vec<f32>` - one
│                    row-major f32 block, `Block::Owned(Vec<f32>)` or `Block::Mapped`
│                    (zero-copy `Arc<Mmap>` view, alignment-validated at load). Replaced
│                    the per-row `Vec<(PathBuf, Array1<f32>)>` — ~400k boxed allocations
│                    at 100k images × 3 encoders. `push_owned` computes the inverse norm
│                    at append time; `row(r)` slices `block[r*dim..(r+1)*dim]`. Memory
│                    shape: ~2 KB/row at 512-d, ~3 KB/row at 768-d, ~800 MB total at
│                    100k × 3 encoders — but a warm launch maps rather than allocates it,
│                    so RSS tracks what the OS pages in.
├── index.rs         `CosineIndex { cached_images: FlatStore, encoder_id, gen_token }`:
│                    ingestion (`add_image`, `populate_from_db_for_encoder`), the shared
│                    `score_all` scan, the three retrieval methods, and `refresh_if_stale`
│                    (the token-gated repopulate the indexing pipeline calls at Ready).
│                    The `cached_images` field name is preserved (not renamed to `store`)
│                    so product-crate call sites like `idx.cached_images.is_empty()` keep
│                    resolving — only the type changed.
├── cache.rs         persistence: `embstore_<encoder_id>.bin` per encoder, 64-byte
│                    versioned header (magic `LYNEMB01`, format version, encoder FNV hash,
│                    dim, row count, generation token), 64-aligned sections, temp-file +
│                    atomic rename, mmap load. The full byte layout is in this file's
│                    module doc. `memmap2` is confined entirely to this file.
├── rrf.rs           Reciprocal Rank Fusion (Cormack/Clarke/Büttcher 2009, `k_rrf = 60`)
│                    over per-encoder rankings, ID-native (`RankedList.items:
│                    Vec<(i64, f32)>`); replaced the old tiered sampler because encoder
│                    disagreement supplies diversity for free.
├── name_match.rs    fuzzy filename scoring (containment + token + Levenshtein,
│                    dependency-free), producing a `RankedList` so filename relevance
│                    enters the same RRF as the encoders; ranks even never-encoded images.
└── diagnostics.rs   embedding-quality statistics (norms, NaNs, pairwise distances,
                     self-similarity) emitted into the profiling report; four stateless
                     helpers taking `&FlatStore` (migrated from the old tuple-vec
                     signature in 1514a90 — same algorithms, same output shapes; samples
                     are tagged `image_id` instead of path, consistent with ID-native
                     identity).
```

`crates/engine/src/cosine_similarity.rs` (the sibling shim) plus the product crate's `similarity_and_semantic_search/mod.rs` re-export stack to keep pre-split import paths alive; neither needs to change when internals move, only when public names do.

## The two loops (the conceptual model — conflating them is the most common confusion)

- **Indexing (background, per image, once):** every enabled _image_ encoder runs on each new image and writes one row to `embeddings(image_id, encoder_id, embedding)`. Text encoders never run here — they encode queries, not the library.
- **Search (foreground, per action, every time):** per enabled encoder, score the query vector against that encoder's `FlatStore` slot → ranked list → RRF-fuse the lists → hydrate ids to rows in one batched `WHERE id IN` query. Text-image fusion is asymmetric by nature: DINOv2 has no text branch, so it fuses over at most the text-capable encoders — fine, RRF works with any number of lists ≥ 1.

**Why RRF and not score-fusion:** different encoders produce cosines on different distributions — one encoder's 0.85 is not another's 0.85, and L2 normalisation doesn't fix distribution shape. RRF discards the score and uses only rank: `score = Σ 1/(k + rank)` over encoders, k = 60 canonical. Consensus is rewarded while each encoder's unique signal survives. Never fuse raw scores from unlike encoders.

**Why fusion replaced the single-encoder picker:** no single encoder is best (CLIP = concept overlap, DINOv2 = visual structure, SigLIP-2 = descriptive content), and picking one left the others' embeddings — paid for at indexing time — unread.

## Invariants

- Per-encoder `FlatStore` mmap files are the only similarity-index state; preserve the 64-byte versioned header, generation token, temp-file-plus- atomic-rename writes, and explicit mismatch-rejection tests. Load validation order: magic → format version → encoder hash → generation token → reconstructed section lengths vs actual file length (catches a corrupt/truncated dim/row_count); any mismatch returns `None` and the caller falls back to a DB populate — the failure mode is always "rebuild", never "serve a wrong population" (a DB error during populate leaves `gen_token = 0`, which is always treated as stale).
- Retrieval returns image IDs and fuses rankings with RRF — never fuse raw scores from unlike encoders, and never reintroduce path resolution on hot search paths (the old `resolve_image_id_for_cosine_path` round-tripped ids through paths that were ids to begin with, at a 200-300k-row join per request).
- Rankings are contract: any change to scoring or storage must pass ranking-equivalence diagnostics (serial-reference pattern, deterministic id tie-breaks). FP summation-order effects near ties are the known hazard class.
- Real norms, never assumed unit: legacy CLIP rows predate encode-time L2 normalisation and still score exactly via the cached inverse norm.
- Search stays exact full-corpus by product decision — do not introduce HNSW/ANN; missed neighbours change what the user sees. The flat store makes the linear scan fast (cached norms, mmap, rayon), not sublinear; that trade is deliberate.
- Build refreshed stores outside write locks and swap under the shortest practical lock window. (Known gap: the Phase::Ready per-encoder refresh currently populates+persists _under_ the fusion write lock — ~0.5-1 s per changed encoder at 100k, ~3 s for a full three-encoder import, during which searches against that encoder block. Token-gating makes no-op rescans free. Fix shape: build outside, swap under a brief lock. Trigger: the post-import pause is felt in real use.)

## Scoring and retrieval

`score_all(&self, embedding, exclude_id)` is the shared hot path: per row, `dot(q, row) × q_inv × inv_norms[row]` — the cached-inverse-norm cosine, skipping the per-candidate sqrt — with exclusion as an inline id compare. Rayon `into_par_iter().collect()` over the row range **preserves row order**, so the result is deterministic and downstream `select_nth_unstable_by` + re-sort is a pure function of it — ranking is provably identical to the serial loop (test-locked to 1e-6 against a fresh full-cosine serial reference). A query/store dim mismatch warns and returns empty rather than panicking (an improvement over the old ndarray shape-panic) — but the user just sees 0 results; the dispatch layer is supposed to prevent it. `&self` scoring (not `&mut`) is what lets the fusion state score a warm slot under a shared read lock.

Three retrieval modes on top of it: `get_similar_images` (sample top_n from the top-20% pool — the diversity sampling is intentional UX, not a bug), `get_similar_images_sorted` (strict top-N — semantic search and fusion inputs), `get_tiered_similar_images` (7 similarity tiers × 5 random each, legacy tiered UX). Partial-select (`select_nth_unstable_by` O(N) + O(K log K) re-sort) over a full O(N log N) sort is the standing algorithmic call.

Population order per slot: `load_store_if_valid` (mmap) first, then `populate_from_db_for_encoder` (one SELECT, with a legacy `images.embedding` fallback for `clip_vit_b_32` on pre-schema installs). `populate_from_db` (encoder-agnostic) survives only for tests and hand-built indexes.

## Key findings

- **Freshness is easy to break silently** (1514a90, 2026-07-17): rerouting the primary search commands onto fusion slots without giving the indexing pipeline a handle to refresh them made post-index search stale until relaunch — the old architecture's freshness had been an accident of a duplicate populate. No test caught it (no end-to-end pipeline harness); it was found by tracing the invalidation path as a mandated step of the removal. The fix is the pattern to keep: `refresh_if_stale` recomputes the generation token and repopulates only on mismatch, so a no-op rescan costs one SQL aggregate per encoder.
- **No id→row lookup structure exists by decision** (fc6667a): scoring is a full linear scan with inline id exclusion; a 100k `HashMap<i64, usize>` (~10 MB across encoders) would have had zero consumers — every caller scans everything or looks the query embedding up via the DB. Don't add one without a consumer.
- **Real norms, never assumed unit** (fc6667a): legacy pre-normalised CLIP rows keep exact scores because inverse norms are computed, test-proven by a serial-reference equivalence test that survived the whole migration.
- **Mmap over bincode was a load-time decision**: the old `cosine_cache.bin` paid a full deserialise-into-fresh-allocations of ~800 MB on every warm launch; the hand-rolled fixed header + flat sections is what makes the zero-copy `bytemuck` load possible — bincode's format isn't laid out for that. Warm-launch cost is now what the OS actually pages in.

## Traps

- The store format is native-little-endian by construction — zero-copy f32 casts are inherently native-endian and the header has no endianness flag. A documented non-issue for this desktop-only, single-arch-per-install app; a known landmine if the format ever travels cross-arch (a synced-library or export feature) — flag it explicitly then.
- The generation token derives from the DB's enabled/orphaned population (see `db/`); a bare mtime check was rejected because it cannot see a root toggle that changes the row-set without touching the embeddings table — at 100k scale that silently served the wrong population. Never substitute mtime or a restart-local counter.
- `save_to_disk` (whole-index legacy entry) has no production caller since 1514a90, and its old target `paths::cosine_cache_path()` is equally orphaned; live persistence goes through `save_store_for`/`save_store_to`. Left in place for their files' next pass — don't build on them. A pre-existing `cosine_cache.bin` on a user's disk is permanently stale and harmless.
- Fusion is one `RwLock`: pipeline takes `write()` per encoder released between encoders, searches take `read()` with a double-checked `write()` populate. The old two-lock order died with `CosineIndexState`; don't reintroduce a second lock or a second resident cache per encoder.
- `push_owned` silently drops a row whose length disagrees with the established dim (a corrupt write or migration bug would vanish, not surface) — consistent with pre-round behaviour, but easy to miss at scale if it ever fires.
