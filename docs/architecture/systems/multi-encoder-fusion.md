# Multi-Encoder Rank Fusion

*Maturity: working · Stability: unstable*

## Scope / Purpose

Image-image similarity ("View Similar") and text-image search (typed queries) both combine rankings from every enabled, applicable encoder via Reciprocal Rank Fusion (RRF) instead of returning top-K from a single encoder. This system covers the fusion algorithm, the per-encoder cache state shared by both paths, the two IPC entry points, and how the previous tiered random-sampling diversity strategy was retired.

**Since the T3-2 perf round (`fc6667a` + `1514a90`), `FusionIndexState` is the ONLY resident
embedding cache in the app.** The old primary `CosineIndexState` (a separate
`Arc<Mutex<CosineIndex>>` the single-encoder search commands and the indexing pipeline used
to read/write directly) is gone entirely — `get_similar_images`, `get_tiered_similar_images`,
and `semantic_search` all now borrow a `FusionIndexState` slot via `with_encoder_index`
instead of holding a duplicate cache. This file is now the canonical home for the shared
search-state lifecycle, not just the RRF-specific fusion callers. See
`systems/cosine-similarity.md`'s Durable Notes for the removal's full story (it also fixed a
latent staleness regression) and `notes/mutex-poisoning.md` for the resulting lock inventory.

## Boundaries / Ownership

| Component | Path | Role |
|-----------|------|------|
| RRF algorithm | `crates/engine/src/cosine/rrf.rs` | Pure: takes N ranked lists, returns one fused list. `RankedList.items: Vec<(i64, f32)>` — ID-native since T3-2/#6. 6 unit tests pin the contract (fixtures use `i64` ids, not paths). Re-exported unchanged at `similarity_and_semantic_search::cosine::rrf`. |
| Per-encoder cache state | `apps/lynceus/src-tauri/src/lib.rs::FusionIndexState` | `Arc<RwLock<HashMap<String, CosineIndex>>>` — an `RwLock`, not a `Mutex`, since T3-2/#8: a burst of concurrent queries against an already-warm encoder scores under a shared read lock instead of serialising on a Mutex. Lazy-populated per encoder on first use (see Cache lifecycle below), and the ONLY resident cache in the app — the primary `CosineIndexState` this table used to also list is removed. |
| Image-image IPC entry point | `apps/lynceus/src-tauri/src/commands/similarity.rs::get_fused_similar_images` | One Tauri command. Calls `ranked_for_encoder` per enabled encoder, fuses, hydrates ids → `ImageSearchResult[]` via one batch `WHERE id IN` query. |
| Single-encoder image-image commands | `apps/lynceus/src-tauri/src/commands/similarity.rs::{get_similar_images, get_tiered_similar_images}` | Non-fused single-encoder search, now borrowing the same `FusionIndexState` slot via `with_encoder_index` rather than a separate primary cache. |
| Text-image IPC entry point | `apps/lynceus/src-tauri/src/commands/semantic_fused.rs::get_fused_semantic_search` | Mirrors `get_fused_similar_images` for text queries — encodes the query through every enabled text-capable encoder (CLIP, SigLIP-2; DINOv2 has no text branch), fuses via the same RRF. See the dedicated subsection below. |
| Single-encoder text-image command | `apps/lynceus/src-tauri/src/commands/semantic.rs::semantic_search` | Also borrows a `FusionIndexState` slot (the matching image-encoder family for the chosen text encoder) via `with_encoder_index`. |
| Frontend dispatch (image-image) | `apps/lynceus/src/queries/useSimilarImages.ts::useTieredSimilarImages` | Hook keeps its previous name (caller stability) but routes through `fetchFusedSimilarImages` under the hood. |
| Frontend service (image-image) | `apps/lynceus/src/services/images.ts::fetchFusedSimilarImages` | IPC wrapper. |
| Frontend service (text-image) | `apps/lynceus/src/services/images.ts::fetchFusedSemanticSearch` | IPC wrapper for `get_fused_semantic_search`. |

## Current Implemented Reality

### Algorithm

```text
fused_score(p) = Σ over encoders e of  1 / (k_rrf + rank_e(p))
```

- `k_rrf = DEFAULT_K_RRF = 60` (canonical from Cormack, Clarke & Büttcher, SIGIR 2009).
- `rank_e(p)` is the 1-indexed position of `p` in encoder `e`'s ranking.
- Images that don't appear in encoder `e`'s top-K contribute 0 from that encoder (rank treated as ∞).
- Final list is sorted descending by fused score and truncated to `top_n`.

### Encoder set

Currently fixed: `["clip_vit_b_32", "siglip2_base", "dinov2_base"]`. Defined as a `&[&str]` in `commands/similarity.rs::get_fused_similar_images`. Adding a fourth encoder = appending the id (assuming the encoder's embeddings table has rows).

### Per-encoder evidence

Every fused result carries a `per_encoder: Vec<(encoder_id, 1-based-rank, encoder_score)>` so diagnostics can show *why* a given image was ranked highly. Surfaced in the `search_query` perf diagnostic under the `fused_top10_with_evidence` field.

### Trade-offs that emerge from RRF

- **Diversity emerges for free.** CLIP cares about concept overlap, DINOv2 about visual structure (pose, lighting, art style), SigLIP-2 about descriptive content. When all three rank the same image highly, that's genuine consensus → it wins. When one encoder loves an image and the others ignore it, that image still gets a contribution but sinks below the consensus picks. No random sampling step needed.
- **`k_rrf` is a sharpness knob.** Smaller k (e.g. 1) makes top-of-list dominate (a one-encoder #1 hit can outrank a three-encoder rank-5 consensus). Larger k flattens the contribution curve so consensus dominates. 60 is the canonical balance and is also what we ship.
- **The "score" surfaced to the frontend is no longer cosine similarity.** It's an unbounded RRF score (~0–0.05 for 3 encoders + k=60). Frontend tooltips that present this number should label it "Fused" rather than "Cosine similarity".

### Cache lifecycle

- **Double-checked locking, not a plain lazy populate.** `ranked_for_encoder` and
  `with_encoder_index` (both on `FusionIndexState`) share the same shape: take a **read**
  lock, and if the slot is already populated, score under that shared read lock and return
  — this is the common case and lets concurrent queries against a warm encoder run in
  parallel instead of serialising. Only on a miss does the caller take the **write** lock,
  re-check (another thread may have populated between the read and write locks), and
  populate. This replaces a plain `Mutex`-guarded lazy populate specifically to stop a
  fused query (which touches up to 3 encoders) and the frontend's per-tile prefetch burst
  from serialising on a single lock.
- **Populate prefers the persisted flat store over a DB rebuild (T3-2/#8+#20).** Both
  populate paths call `entry.load_store_if_valid(db, encoder_id)` FIRST — mapping the
  on-disk `embstore_<encoder_id>.bin` zero-copy if its header + generation token are fresh
  — and only fall back to `populate_from_db_for_encoder` on a miss or stale file. See
  `systems/cosine-similarity.md` for the store format and freshness check.
- **`spawn_cache_warm` pre-populates every enabled encoder's slot at launch**, on its own
  thread, before the window opens — same mmap-preferred / DB-populate-then-persist order
  as the lazy path above, so the FIRST similarity click after a warm (already-indexed)
  launch hits an already-populated slot instead of paying a cold populate. On a first-ever
  launch (empty DB) this is a no-op; the indexing pipeline populates as it indexes instead.
- **The indexing pipeline refreshes + re-persists stale slots at `Phase::Ready`
  (T3-2/#20).** For each enabled encoder, `refresh_if_stale` recomputes the generation
  token and repopulates ONLY if it changed since the slot was last warmed, then
  `save_store_for` re-persists the flat file so the next launch maps a current one. This is
  what gives post-index search freshness now that the primary index (which the pipeline
  used to repopulate directly) is gone — see `systems/cosine-similarity.md`'s Durable Notes
  for the staleness regression this replaced and fixed. One write lock is taken per encoder,
  released between encoders, so a concurrent query against an unaffected encoder never
  waits on the whole loop — but a query against the encoder actively being refreshed does
  block for that encoder's populate+persist duration (~0.5-1s at 100k; see
  `systems/cosine-similarity.md`'s Known Issues and `notes/performance-decisions.md`).
- **Invalidation.** `FusionIndexState::invalidate_all()` clears every slot (drops the
  `FlatStore`s, unmapping any mmap'd files). Wired into the root-mutation IPCs:
  `set_scan_root`, `remove_root`, `set_root_enabled`. Without this, fusion would happily
  return images from a now-disabled root. Adding a root does NOT explicitly invalidate — new
  images aren't scored until encoded and the next refresh picks them up, so there's nothing
  stale to clear.
- **Memory cost is now a mapped ceiling, not an allocated floor.** ~6 MiB per encoder for
  2000 images × 768 floats × 4 bytes still holds as a rough per-library-size estimate, but
  at 100k-image scale a warm slot loaded via `load_store_if_valid` is a zero-copy mmap view
  — resident memory tracks what the OS actually pages in on demand, not the full file size
  up front. A DB-populated (never-persisted, or stale-and-rebuilt) slot is still a fully
  owned in-memory allocation until the next `save_store_for` persists it.

### Text-image fusion (`get_fused_semantic_search`) — Phase 11d, implemented

Mirrors the image-image path above for text queries. `commands/semantic_fused.rs::get_fused_semantic_search`:

1. Resolves `enabled_encoders` from settings, intersects with the fixed `TEXT_CAPABLE_ENCODERS = [CLIP_TEXT_ENCODER_ID, SIGLIP2_TEXT_ENCODER_ID]` (`"clip_vit_b_32"`, `"siglip2_base"`) — DINOv2 is image-only and is implicitly excluded, so at most 2 ranked lists are fused (never 3).
2. For each surviving text-capable encoder, encodes the query (`ClipTextEncoder` or `Siglip2TextEncoder`), then scores it against that encoder's `FusionIndexState` cache via the same `ranked_for_encoder` used by image-image fusion — the image-side cache is shared between both fusion paths.
3. Fuses the (up to 2) ranked lists with the same `reciprocal_rank_fusion` (`k = DEFAULT_K_RRF = 60`).
4. Returns `Vec<ImageSearchResult>`, same shape as `get_fused_similar_images`.

If the user has disabled every text-capable encoder, the command returns an empty `Vec` with a `warn!` log rather than erroring. `per_encoder_top_k` defaults the same way as image-image fusion (`5 × top_n`, minimum 50). Frontend: `useSemanticSearch` → `fetchFusedSemanticSearch` (`services/images.ts`) → `invoke("get_fused_semantic_search", ...)`. This closes the "Planned" item from the previous version of this document — text-image RRF fusion is implemented, not speculative.

## Key Interfaces / Data Flow

```text
PinterestModal click
  └── useTieredSimilarImages(imageId)            (queries/useSimilarImages.ts)
       └── fetchFusedSimilarImages(imageId, 30)  (services/images.ts)
            └── invoke("get_fused_similar_images", { imageId, topN: 30, perEncoderTopK })
                 └── get_fused_similar_images    (commands/similarity.rs)
                      ├── exclude_id = Some(imageId)               ← ID-native (T3-2/#6),
                      │                                              no whole-library join
                      ├── for each encoder in enabled_encoders():
                      │    ├── db.get_embedding(imageId, encoder)  ← query vector
                      │    └── fusion_state.ranked_for_encoder(
                      │          db, encoder, &q, top_k=150, exclude_id
                      │        )                                   ← double-checked lock,
                      │                                               mmap-or-DB populate,
                      │                                               score
                      ├── reciprocal_rank_fusion(lists, k=60, top_n=30)
                      ├── hydrate_search_results(db, &[(image_id, fused_score)])
                      │        ← ONE `WHERE id IN (...)` batch query for all ~30 ids
                      └── return ImageSearchResult[]                ← scored by fused score
```

`per_encoder_top_k` defaults to `5 * top_n` (so 150 when `top_n=30`) — chosen empirically as
enough candidate diversity from each encoder without inflating fusion cost. `hydrate_search_
results` (`commands/mod.rs`) is the shared ID→`ImageSearchResult` batch hydrator every
search command uses (fused and single-encoder alike) — see `systems/cosine-similarity.md`
for its role in removing the old per-result thumbnail N+1.

## Implemented Outputs / Artifacts

- `commands/similarity.rs::get_fused_similar_images` — Tauri command (image-image), registered in `lib.rs::run`'s `invoke_handler!`.
- `commands/semantic_fused.rs::get_fused_semantic_search` — Tauri command (text-image), registered alongside it.
- `cosine/rrf.rs::reciprocal_rank_fusion` — pure RRF, now in the Mnemosyne engine crate.
- `cosine/rrf.rs::RankedList` + `FusedItem` — input + output types with per-encoder evidence.
- `lib.rs::FusionIndexState` — state managed by Tauri, shared by both fusion commands.
- `services/images.ts::fetchFusedSimilarImages` — frontend wrapper (image-image).
- `services/images.ts::fetchFusedSemanticSearch` — frontend wrapper (text-image).
- Diagnostic: `search_query` events with `type: "fused"` carry per-encoder timing, encoder evidence per result, and full top-10 with rank breakdown.

## Known Issues / Active Risks

- **Frontend score labelling.** The fused score is not a cosine similarity and is unbounded. Currently the masonry grid doesn't display the score, so this is invisible to users; if a future tooltip surfaces it, it should be labelled "Fused" or normalised to [0, 1] for display. **Downstream impact:** users could misinterpret a fused score as a similarity percentage.
- **Encoder set is hardcoded.** The list of fusion encoders lives in `commands/similarity.rs`. Adding a fourth requires editing one constant. **Downstream impact:** none; it's an additive change.
- **First fusion call after launch is cold only when `spawn_cache_warm` hasn't finished, or on a first-ever (unindexed) launch.** Since T3-2/#8, `spawn_cache_warm` races the window opening to pre-map every enabled encoder's persisted flat store on its own thread, so on a normal (already-indexed) relaunch the warm-up usually completes before the user reaches a View-Similar click. If it hasn't, or the store is stale/missing (first launch, or a root change since the last save), the call pays a DB populate (~150 ms × N encoders) before the write lock releases. **Downstream impact:** unpredictable — usually invisible now, occasionally the old ~450 ms-for-3-encoders feel on a cold or freshly-changed library.
- **A `Phase::Ready` refresh for a CHANGED encoder blocks queries against that encoder for its populate+persist duration (~0.5-1s at 100k).** See `systems/cosine-similarity.md`'s Known Issues and `notes/performance-decisions.md` for the full writeup and the named follow-up (build-outside-lock-then-swap).

## Partial / In Progress

- None. The fusion path is feature-complete for both image-image (`get_fused_similar_images`) and text-image (`get_fused_semantic_search`, Phase 11d) — see the dedicated subsection above.

## Planned / Missing / Likely Changes

- **User-tunable `k_rrf`.** Currently fixed at the canonical 60. Could be exposed as a Settings slider for power users. Low priority unless retrieval-quality issues motivate it.
- **Per-encoder weighting.** RRF treats every encoder equally. A future variant could weight encoders (e.g. DINOv2 × 1.5 for image-image). Adds complexity without clear evidence that uniform weighting underperforms.

## Durable Notes / Discarded Approaches

- **Why RRF rather than score-fusion.** Score-fusion (sum or mean of normalised cosines) sounds simpler but is fragile: encoders produce cosines on different distributions (CLIP cosines cluster differently than DINOv2's), so one encoder's "0.85" is not comparable to another's "0.85". RRF discards the score entirely — only the rank matters — which makes it robust to encoder-distribution differences. This is documented at length in `cosine/rrf.rs`'s module docstring.
- **Why uniform `k_rrf=60` rather than per-encoder.** Per-encoder `k_rrf` would let us say "DINOv2's contribution decays slower because we trust its visual judgement more." Tempting but unprincipled — every weighting scheme requires a held-out validation set to tune. The Cormack 2009 paper picks 60 specifically because it balances top-of-list dominance vs consensus contribution across diverse retrieval tasks. Until we have a labelled retrieval-quality test set, uniform 60 is the right default.
- **Why per-encoder caches not a single shared cache.** Fusion needs all three encoders' embeddings resident *simultaneously* so it can score the same query in each space without paying a populate-roundtrip per fusion call. This was true even before T3-2, and it's the reason the pre-round architecture's separate "primary" single-encoder cache was pure duplication once fusion shipped — the primary held one encoder, `FusionIndexState` already held all enabled ones, so the primary's only real content overlapped a slot fusion already had warm. T3-2/#8 recognised this fully and removed the primary, routing every single-encoder command through the same fusion slots (see `systems/cosine-similarity.md`'s Durable Notes). ~18 MiB (pre-100k estimate) to a few hundred MB mapped (at 100k) across encoders is a small price for skipping repeated cold populates per click.
- **Why the fusion `RwLock` replaced the old two-lock (`current_encoder_id` → primary index) order.** Before the primary's removal, a caller could in principle need both the primary index's lock AND a fusion slot's lock, in a fixed order, to avoid AB-BA deadlock. With the primary gone there is exactly one lock (`FusionIndexState`'s `RwLock`) in the whole embedding-cache path — no ordering discipline is needed because there's nothing left to order against. See `notes/mutex-poisoning.md`.
- **Why route through `useTieredSimilarImages` rather than introduce `useFusedSimilarImages`.** Renaming the hook would force a wave of import updates across PinterestModal and any future consumers without changing behaviour. Caller stability won; the hook's docstring documents that it now does fusion under the hood.
- **The previous tiered-random-sampling system is preserved** at `cosine/index.rs::get_tiered_similar_images` for reference, but the frontend no longer calls it. Could be deleted in a future hygiene pass; kept for now in case fusion behaves unexpectedly and we need a fallback.

## Obsolete / No Longer Relevant

The previous diversity strategy `cosine/index.rs::get_tiered_similar_images` (7-tier sampling: 5 of top 5%, 5 of 5-10%, etc.) is no longer called from the frontend — `useTieredSimilarImages` hook now routes through `fetchFusedSimilarImages`. The function still exists in the codebase as a fallback reference and is exercised by its own unit tests, but a future cleanup pass could delete it once we have a few sessions of confidence in fusion's behaviour.

## Related Systems

- `systems/cosine-similarity.md` — the `CosineIndex`/`FlatStore` machinery every fusion slot
  wraps: population, scoring, the generation-token freshness check, and mmap persistence.
  This file owns the shared-state lifecycle (locking, warm/refresh/invalidate); that file
  owns what's inside each slot.
- `systems/indexing.md` — the pipeline's step 7 (`refresh_if_stale` + `save_store_for`) is
  what keeps fusion slots fresh after an index; `spawn_cache_warm` is this file's launch-time
  counterpart.
- `notes/mutex-poisoning.md` — the lock inventory; the fusion `RwLock` is now the only lock
  in the embedding-cache path (no AB-BA surface).
- `notes/fusion-architecture.md` — the conceptual two-loop model (indexing vs search) this
  file's algorithm and cache lifecycle implement mechanically.
- `notes/performance-decisions.md` — the T3-2 round's full narrative, including the honest
  residual (Phase::Ready refresh blocking a changed encoder's queries) this file surfaces.
- `database` — fusion reads from the per-encoder `embeddings` table via `get_embedding` and `get_all_embeddings_for`.
- `search-routing` — the frontend dispatch path. `useTieredSimilarImages` is consumed by `PinterestModal` for the "View Similar" UX.
- `tauri-commands` — `get_fused_similar_images` is registered in `lib.rs::run`'s `invoke_handler!`.

## References

- Cormack, Clarke & Büttcher (2009), *Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods*, SIGIR '09. [PDF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf).
- `notes.md` § Active work areas — Phase 5 (image-image fusion) + Phase 11d (text-image fusion). The original perf plan + autonomous session report were deleted post-ship.
