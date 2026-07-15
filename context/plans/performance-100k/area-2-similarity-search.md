# Area 2 — Similarity and semantic search

Ideas 6–10. Mostly backend (`crates/engine/src/cosine/*`, `src-tauri/src/commands/*`). Already
landed: rayon-parallel cosine, startup cache-warm, hover/visible prefetch. These extend it while
keeping EXACT full-corpus search — no approximate index (HNSW) because missed neighbours change
results. RRF itself is already cheap (fuses only per-encoder top-K, `cosine/rrf.rs:103-142`).

**Verification note:** all five are plausible standard optimisations cited with `file:line`, but
were NOT line-verified this session — confirm each against the code before implementing.

---

### 6. Carry IDs through the cosine and fusion indices  ·  M  ·  ⚠️ backend, plausible

- **What:** Change index entries from `(PathBuf, Array1<f32>)` to an ID-native entry with at least
  `image_id`, path/reference index, embedding offset. Return IDs from cosine and RRF. Batch-fetch
  final paths, thumbnail paths, dimensions in one `WHERE id IN (...)` — or from the catalogue
  metadata cache. Touches `cosine/index.rs:10-12,201-217`, `cosine/rrf.rs:73-94`,
  `commands/similarity.rs:163-168,235-267`, `commands/semantic_fused.rs:114-115,172-205`.
- **Why:** Every fused request calls `db.get_all_images()` (image/tag join, HashMap aggregation,
  materialise, sort — for the whole library), then `get_image_thumbnail_info` once per result.
  Removes O(100k) metadata work + 30–50 N+1 lookups per search.
- **Functionality preserved:** Ranking, scores, paths, thumbnail metadata, exclusions identical;
  IDs become the internal join key.
- **Risk:** The on-disk cosine cache format must be versioned and invalidated safely on migration.

---

### 7. Compute cosine norms once, not per candidate  ·  S  ·  ⚠️ backend, plausible (top quick win)

- **What:** Compute the query inverse norm once and cache each corpus vector's inverse norm at index
  load. Score with `dot × query_inv_norm × corpus_inv_norm`. Current `cosine_similarity` does `a·b`,
  `a·a`, `b·b` per candidate (`cosine/math.rs:38-47`).
- **Why:** At 100k × 3 encoders, removes ~two-thirds of the vector arithmetic from the brute-force
  scan. Cached norms preserve exact cosine semantics for legacy/off-unit embeddings (better than
  assuming perfect normalisation).
- **Functionality preserved:** Same cosine formula, exact ranking contract.
- **Risk:** FP operation order may alter last-bit scores. Test tie handling + top-K equivalence
  against current.
- **Verification:** partial — confirmed `cosine/index.rs:201` `score_all` uses a rayon `par_iter`
  dot-product scan (comment at `:189` names "serial 100k-dot-product scan was the bottleneck"); did
  not open `cosine/math.rs` to confirm per-candidate norm recompute. Likely correct; verify.

---

### 8. Flatten and unify the embedding caches  ·  L  ·  ⚠️ backend, plausible

- **What:** Store each encoder's corpus as one aligned row-major `Vec<f32>`/mapped file + parallel
  ID/offset arrays. Legacy single-encoder commands borrow the corresponding `FusionIndexState` slot
  instead of a duplicate `CosineIndexState`. Chunked SIMD or Accelerate/BLAS matrix-vector ops,
  preserving exact full-corpus search. Touches `cosine/index.rs`, `cosine/cache.rs`,
  `src-tauri/src/lib.rs:138-243,377-409`.
- **Why:** Raw embeddings at scale: `100,000 × (512+768+768) × 4 bytes ≈ 819 MB`. The separate
  primary cache duplicates another selected encoder (~205–307 MB) before `PathBuf`/`Array1`/HashMap
  overhead. Flat shared storage removes the duplicate, improves sequential access, and is far
  SIMD/cache-friendlier.
- **Functionality preserved:** All enabled encoders resident, fusion scans every vector exactly, no
  ANN recall loss.
- **Risk:** BLAS/SIMD reductions can shift scores near ties. Keep deterministic ID tie-breaking; run
  ranking-equivalence diagnostics.

---

### 9. Batch and govern visible-tile prefetch  ·  L

- **What:** Replace the per-visible-tile fused-query loop (`Masonry.tsx` prefetch effect) with a
  batched backend command: score a matrix of visible query embeddings against each contiguous
  corpus, then seed the existing React Query keys. Add admission control — one low-priority visible
  batch, hover/click jump the queue, fast-scroll batches cancelled by generation, backend checks
  cancellation between chunks.
- **Why:** A settled 20–30 tile viewport implies 60–90 full 100k-vector scans across three encoders.
  React Query dedupes repeat IDs but can't reduce first-time corpus work. Batching cuts IPC +
  improves cache reuse; cancellation stops speculative work for scrolled-away tiles.
- **Functionality preserved:** Every click still yields the same full fused result, hover stays
  instant-priority, visible prefetch remains; only scheduling/execution consolidate.
- **Risk:** One overly large batch can monopolise CPU and harm scrolling. Cap batch size, yield
  between corpus chunks.

---

### 10. Cancel stale semantic searches end-to-end  ·  M

- **What:** Thread React Query's abort signal into a request-ID protocol. A newer debounced query
  marks the older backend request cancelled; text encoding + corpus scans check the token at
  encoder/chunk boundaries. Touches `useSemanticSearch.ts:25-35`, `services/images.ts:295-305`,
  `commands/semantic_fused.rs:73-165`.
- **Why:** The frontend stops showing stale results, but an old synchronous Tauri command keeps
  using all cores while a newer query waits. Cancellation removes whole two-encoder scans during
  fast typing.
- **Functionality preserved:** Every non-superseded query returns the same results; only
  no-longer-showable work stops.
- **Risk:** Cancellation must never leave an encoder mutex or fusion read lock held. Check only at
  safe boundaries.
</content>
