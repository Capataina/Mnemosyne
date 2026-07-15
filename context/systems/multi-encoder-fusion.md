# Multi-Encoder Rank Fusion

*Maturity: working*

## Scope / Purpose

Image-image similarity ("View Similar") and text-image search (typed queries) both combine rankings from every enabled, applicable encoder via Reciprocal Rank Fusion (RRF) instead of returning top-K from a single encoder. This system covers the fusion algorithm, the per-encoder cache state shared by both paths, the two IPC entry points, and how the previous tiered random-sampling diversity strategy was retired.

## Boundaries / Ownership

| Component | Path | Role |
|-----------|------|------|
| RRF algorithm | `crates/engine/src/cosine/rrf.rs` | Pure: takes N ranked lists, returns one fused list. 6 unit tests pin the contract. Moved into the Mnemosyne engine crate by the 2026-07 monorepo extraction; re-exported unchanged at `similarity_and_semantic_search::cosine::rrf` so every call site in the product crate keeps resolving. |
| Per-encoder cache state | `apps/lynceus/src-tauri/src/lib.rs::FusionIndexState` | `Arc<Mutex<HashMap<String, CosineIndex>>>` lazy-populated per encoder on first fusion call. |
| Image-image IPC entry point | `apps/lynceus/src-tauri/src/commands/similarity.rs::get_fused_similar_images` | One Tauri command. Calls `ranked_for_encoder` × 3, fuses, resolves paths, returns `ImageSearchResult[]`. |
| Text-image IPC entry point | `apps/lynceus/src-tauri/src/commands/semantic_fused.rs::get_fused_semantic_search` | Mirrors `get_fused_similar_images` for text queries — encodes the query through every enabled text-capable encoder (CLIP, SigLIP-2; DINOv2 has no text branch), fuses via the same RRF. See the dedicated subsection below. |
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

- **Lazy populate.** The first `get_fused_similar_images` call for encoder X triggers `populate_from_db_for_encoder(db, X)` and caches the result in `FusionIndexState.per_encoder["X"]`. Subsequent calls hit the warm cache.
- **Invalidation.** `FusionIndexState::invalidate_all()` clears every slot. Wired into the same root-mutation IPCs that already invalidate `CosineIndexState`: `set_scan_root`, `remove_root`, `set_root_enabled`. Without this, fusion would happily return images from a now-disabled root.
- **Memory cost.** ~6 MiB per encoder for 2000 images × 768 floats × 4 bytes. ~18 MiB total across CLIP+SigLIP-2+DINOv2.

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
                      ├── db.get_all_images()                     ← exclude self
                      ├── for each encoder in [CLIP, SigLIP-2, DINOv2]:
                      │    ├── db.get_embedding(imageId, encoder) ← query vector
                      │    └── fusion_state.ranked_for_encoder(
                      │          db, encoder, &q, top_k=150, exclude_path
                      │        )                                  ← lazy populate + score
                      ├── reciprocal_rank_fusion(lists, k=60, top_n=30)
                      ├── for each fused entry: resolve_image_id_for_cosine_path
                      └── return ImageSearchResult[]              ← scored by fused score
```

`per_encoder_top_k` defaults to `5 * top_n` (so 150 when `top_n=30`) — chosen empirically as enough candidate diversity from each encoder without inflating fusion cost.

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
- **First fusion call after launch is cold.** ~150 ms × 3 encoders ≈ 450 ms one-time warmup. **Downstream impact:** the first View-Similar click after app start feels slightly slower than subsequent clicks. Subsequent clicks are fast because the per-encoder caches are warm.

## Partial / In Progress

- None. The fusion path is feature-complete for both image-image (`get_fused_similar_images`) and text-image (`get_fused_semantic_search`, Phase 11d) — see the dedicated subsection above.

## Planned / Missing / Likely Changes

- **User-tunable `k_rrf`.** Currently fixed at the canonical 60. Could be exposed as a Settings slider for power users. Low priority unless retrieval-quality issues motivate it.
- **Per-encoder weighting.** RRF treats every encoder equally. A future variant could weight encoders (e.g. DINOv2 × 1.5 for image-image). Adds complexity without clear evidence that uniform weighting underperforms.

## Durable Notes / Discarded Approaches

- **Why RRF rather than score-fusion.** Score-fusion (sum or mean of normalised cosines) sounds simpler but is fragile: encoders produce cosines on different distributions (CLIP cosines cluster differently than DINOv2's), so one encoder's "0.85" is not comparable to another's "0.85". RRF discards the score entirely — only the rank matters — which makes it robust to encoder-distribution differences. This is documented at length in `cosine/rrf.rs`'s module docstring.
- **Why uniform `k_rrf=60` rather than per-encoder.** Per-encoder `k_rrf` would let us say "DINOv2's contribution decays slower because we trust its visual judgement more." Tempting but unprincipled — every weighting scheme requires a held-out validation set to tune. The Cormack 2009 paper picks 60 specifically because it balances top-of-list dominance vs consensus contribution across diverse retrieval tasks. Until we have a labelled retrieval-quality test set, uniform 60 is the right default.
- **Why per-encoder caches not single shared cache.** The primary `CosineIndex` holds one encoder at a time (the user's "active" image encoder). Fusion needs all three resident *simultaneously* so it can score the same query in each space without paying populate-roundtrip per fusion call. ~18 MiB total is a small price for skipping ~150 ms × 3 cold populates per click.
- **Why route through `useTieredSimilarImages` rather than introduce `useFusedSimilarImages`.** Renaming the hook would force a wave of import updates across PinterestModal and any future consumers without changing behaviour. Caller stability won; the hook's docstring documents that it now does fusion under the hood.
- **The previous tiered-random-sampling system is preserved** at `cosine/index.rs::get_tiered_similar_images` for reference, but the frontend no longer calls it. Could be deleted in a future hygiene pass; kept for now in case fusion behaves unexpectedly and we need a fallback.

## Obsolete / No Longer Relevant

The previous diversity strategy `cosine/index.rs::get_tiered_similar_images` (7-tier sampling: 5 of top 5%, 5 of 5-10%, etc.) is no longer called from the frontend — `useTieredSimilarImages` hook now routes through `fetchFusedSimilarImages`. The function still exists in the codebase as a fallback reference and is exercised by its own unit tests, but a future cleanup pass could delete it once we have a few sessions of confidence in fusion's behaviour.

## Related Systems

- `cosine-similarity` — RRF reuses `CosineIndex::populate_from_db_for_encoder` and `get_similar_images_sorted` per encoder.
- `database` — fusion reads from the per-encoder `embeddings` table via `get_embedding` and `get_all_embeddings_for`.
- `search-routing` — the frontend dispatch path. `useTieredSimilarImages` is consumed by `PinterestModal` for the "View Similar" UX.
- `tauri-commands` — `get_fused_similar_images` is registered in `lib.rs::run`'s `invoke_handler!`.

## References

- Cormack, Clarke & Büttcher (2009), *Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods*, SIGIR '09. [PDF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf).
- `notes.md` § Active work areas — Phase 5 (image-image fusion) + Phase 11d (text-image fusion). The original perf plan + autonomous session report were deleted post-ship.
