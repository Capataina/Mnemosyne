# apps/lynceus/src-tauri/src/similarity_and_semantic_search/

Image/text encoder orchestration, ONNX sessions, preprocessing, and fused retrieval. Cosine ranking + RRF fusion themselves live in the engine (`mnemosyne::cosine`, re-exported by `mod.rs` so old call-site paths keep resolving); this folder owns the model-specific halves: loading, tokenising, preprocessing, and running the ONNX graphs. All three encoder families are commercially licensed: OpenCLIP MIT, DINOv2 Apache-2.0 (Meta), SigLIP-2 Apache-2.0 (Google). One open provenance flag: `clip_tokenizer.json` is still fetched from a Xenova-hosted mirror rather than an explicitly MIT-licensed upstream — functionally the standard `open_clip` BPE vocab/merges (no behavioural risk), but re-source it before a paid release so every shipped file's licence chain is unambiguous.

## Map

```
similarity_and_semantic_search/
├── mod.rs               engine re-exports (cosine, cosine_similarity) + submodule wiring
├── encoders.rs          ImageEncoder / TextEncoder traits — object-safe, L2-normalised
│                        output required, &mut self because ORT sessions aren't
│                        concurrency-safe; default encode_batch = serial map + collect
├── encoder.rs           ClipImageEncoder — OpenCLIP ViT-B/32, 512-d; input `image`
│                        [1,3,224,224], output `embedding`; CPU-only on macOS (CoreML
│                        partitions ~54% of nodes then fails at inference, tested)
├── encoder_text/        CLIP text encoder, BPE (own CLAUDE.md)
├── encoder_siglip2.rs   SigLIP-2 Base 256 image + text pair, 768-d shared space;
│                        Gemma SentencePiece (256k vocab), pad id 0 to exactly 64 —
│                        longer sequences crash the fixed-size position embedding
├── encoder_dinov2.rs    DINOv2-Base, 768-d, image-only (no text branch); dominates
│                        CLIP on image→image
├── ort_session.rs       build_tuned_session: intra_threads(4) for the M2 P-cluster,
│                        inter_threads(1), Level3 graph optimisation — every encoder
│                        builds through here
└── preprocess.rs        shared fast_image_resize Lanczos3 RGB8 resize (7-13× the
                         image crate); falls back to imageops with a labelled warning
```

## Per-encoder ONNX contracts (each verified against the real export)

|  | CLIP (OpenCLIP ViT-B/32) | DINOv2-Base | SigLIP-2 Base 256 |
| --- | --- | --- | --- |
| Image input | `image` [1,3,224,224], **fixed batch dim 1** | `pixel_values` [N,3,224,224], dynamic | `pixel_values` [N,3,256,256], dynamic |
| Image output | `embedding` [1,512] | CLS slice of `last_hidden_state` [N,257,768] — **no pooler_output exported** | `pooler_output` [N,768] (MAP head — CLS slicing would be wrong-space) |
| Resize | bicubic (CatmullRom) shortest-edge 224 + centre-crop | bicubic shortest-edge 256 + centre-crop 224 | **exact 256×256 stretch, bilinear, no crop** |
| Mean/std | CLIP-native | ImageNet | 0.5/0.5 → [-1, 1] |
| Text | `text` [1,77] **int32**, no mask (see encoder_text/) | none | `input_ids` [1,64] int64 only — **no attention_mask** (position lookup inlined as fixed Slice; passing a mask errors), pad id 0, hard cap 64 |

Each pipeline matches its model's training recipe; feeding one encoder another's stats/geometry silently degrades quality with no error signal — that's why the three pipelines are separate rather than a shared generic one. CatmullRom is the canonical PIL-BICUBIC match (not bit-exact, standard for non-Python ONNX deployments). DINOv2's 257 = 1 CLS + 256 patch tokens; the CLS row is the official representation. Every encoder L2-normalises at output (the exports return un-normalised projections). Model files load in ~1-2s (CLIP text) up to the 1.13GB `siglip2_text.onnx` (mostly Gemma's 256k-vocab embedding matrix); image encoders are recreated per pipeline run, text encoders live in `TextEncoderState`.

## Preprocessing history and the pipeline-version rule

The original CLIP path was wrong three ways: `resize_exact(224,224)` squashed non-square images (CLIP trained on aspect-preserving + crop), ImageNet mean/std skewed the distribution vs CLIP-native stats, and no output L2-normalise. DINOv2 had the same `resize_exact` bug. Fixed 2026-04-26 against each model's `preprocessor_config.json`; `migrate_embedding_pipeline_version` wiped legacy embeddings so libraries re-encoded cleanly. The durable rule: **any change that shifts the embedding distribution — preprocessing edits, filter swaps, decode changes upstream in the thumbnailer — requires a `CURRENT_PIPELINE_VERSION` bump** so existing libraries re-encode; mixing distributions corrupts cosine ranking silently. The 2026-07 OpenCLIP weights swap did _not_ bump it (same 512-d output space), which is the correct precedent for weights-only swaps. Validation lives in the profiling diagnostics (`preprocessing_sample`, `embedding_stats`, `pairwise_distance_distribution`) rather than a Python comparison harness.

**Open concern, undecided by design (2026-04-26): spatial coverage.** CLIP and DINOv2 centre-crop — they never see image edges, so "green forest" misses images whose green lives in the periphery; SigLIP-2 stretches and sees every pixel at the cost of aspect distortion. All three are canonical for their models; deviating would degrade quality. This matters for a splash-art-heavy library where scenery, colour washes and secondary characters live at the edges. Candidate directions (none chosen): accept + document in the picker; smart per-query routing (colour/scenery → SigLIP-2, concepts → CLIP, image→image → DINOv2 — the user's long-term preference); tile-based multi-crop encoding (~5× storage). Not blocking: the picker already lets a motivated user choose per query.

## Fusion and the shared cache (`FusionIndexState`, lib.rs)

`fused_score(p) = Σ_e 1/(k + rank_e(p))`, k = 60 (the canonical Cormack/Clarke/ Büttcher SIGIR '09 value: balances top-of-list dominance vs consensus; smaller k lets one encoder's #1 outrank three-encoder consensus). Rank fusion over score fusion because cosine distributions are not comparable across encoders — CLIP's 0.85 ≠ DINOv2's 0.85; discarding the score entirely is what makes fusion robust. Uniform k and uniform encoder weights until a labelled retrieval test set exists to tune against. Diversity emerges free from encoder disagreement (CLIP = concepts, DINOv2 = visual structure, SigLIP-2 = descriptive content) — this retired the old tiered-random-sampling diversity strategy. Text fusion intersects enabled encoders with the text-capable set (CLIP + SigLIP-2; DINOv2 implicitly excluded), so at most 2 lists fuse there.

Cache lifecycle, in one place:

- **Double-checked locking**: read lock → if warm, score under the shared read lock (concurrent warm queries run in parallel); on miss take the write lock, re-check, populate. Populate prefers `load_store_if_valid` — zero-copy mmap of `embstore_<encoder>.bin` when its header + generation token are fresh — over a DB rebuild, so warm memory is a mapped ceiling, not an allocated floor.
- **`spawn_cache_warm`** (lib.rs) pre-populates every enabled slot at launch on its own thread; the indexing pipeline's post-encode `refresh_if_stale` + `save_store_for` keeps slots fresh after indexing (token-gated; one write lock per encoder — a query against the encoder mid-refresh blocks ~0.5-1s at 100k).
- **`invalidate_all()`** on root remove/disable (and orphan purge) clears every slot wholesale; `add_root` deliberately doesn't (nothing cached to go stale).
- This `RwLock` is the **only** lock in the embedding-cache path (the old primary `CosineIndexState` is gone), so there's no lock-ordering discipline — but one poisoning panic fails every encoder's search until restart.

## Invariants

- Preserve per-encoder dimensionality/preprocessing contracts and fuse rankings rather than raw scores across unlike models.
- SigLIP-2 and DINOv2 override the encoder default with real batched `[N,3,H,W]` inference — a 1.2-2× win on the inference portion on CPU-only ORT (not a GPU-style collapse; preprocessing still dominates). Verified equivalent to serial encode against real models at cosine ≥ 0.9999996 per image (float accumulation order, not exact 1.0); the committed gate in `tests/batched_encode_equivalence_diagnostic.rs` is a looser `> 0.999`. The overrides deliberately **preserve whole-chunk failure semantics** (`?` short-circuits the chunk, same as the trait default's `collect()`) — per-image isolation would be a behaviour change, not a preservation.
- CLIP remains fixed-batch-one until a provenance-verified model re-export passes the equivalence gate. The constraint is the export, not code: its `image` input declares `dim_value == 1`, and a stacked call fails at `session.run` with "Got invalid dimensions". Discovered the hard way (b58dd46, 2026-07-15): the batched attempt failed _silently_ — `encode_batch` swallowed the error into `failed_paths` (surfaced only under `--profiling`), so CLIP wrote zero embeddings for whole runs while the other encoders worked. Re-exporting with a dynamic batch dim means re-running an export pipeline over weights whose provenance the project doesn't control — exactly the supply-chain risk the MIT-licence swap existed to eliminate — so CLIP stays per-image (preprocessing still chunked at 32 for memory bounding).
- Search state is fusion-slot-only under one `RwLock`; generation-token refresh replaces the removed primary-index population path.
- Encoder pairs share one embedding space: never mix families across the modality gap (SigLIP image + CLIP text = random rankings). DINOv2 has no text half at all.

## Traps

- **ONNX I/O node names, dtypes, and shapes only fail at `session.run` time**, behind a green compile and green mocked tests. The OpenCLIP swap kept old node names and broke all real inference (`tests/audit_openclip_io_names_diagnostic.rs` is the regression pin — run it with real models after any I/O-contract change). The CLIP text input is int32 here where the old export was int64.
- CoreML decisions are per-graph and measured, not policy: skipped for the CLIP image encoder (session-create succeeds, GetCapability accepts ~54% of nodes, then inference fails at runtime with error code -1 — reproducible across ort releases; and for transformer text graphs the failure mode is _wrong outputs_, not crashes) and for text (poor coverage, 6-15s session-create vs ~1-2s CPU). Re-test before re-enabling anywhere. upstream `pyke/ort` has signalled minimal further macOS work — plan on CPU-only, not on an EP fix.
- ORT thread sizing is M2-deliberate (research finding shipped as `build_tuned_session`): the default 8 threads pins work across the mixed 4P+4E cluster, and Apple's hybrid scheduler matches frequency across an active cluster — so E-core involvement collapses P-core frequency; `intra_threads(4)` keeps the P-cluster at full speed (~5-20% measured class of win). `inter_threads(1)` because inference is sequential batching, not parallel sub-graphs; `Level3` because models load once and infer millions of times. Don't "fix" any of it to num_cpus. The indexing pipeline divides the 4-thread budget across concurrent encoder sessions (`build_tuned_session_with_intra`).
- Model files resolve via `paths::models_dir()` + precision-variant resolution (int8 default via `Settings::effective_model_precision`); the store bundle ships only int8 + tokenizers. Loading code that assumes bare fp32 filenames breaks the sandboxed build.
- SigLIP-2's exact-square stretch is training-canonical — "fixing" it to aspect-preserving + crop would deviate from training geometry and degrade quality. No prompt template either (verified against the released processor). Its pad/eos/bos/unk are distinct tokens (pad = 0), unlike CLIP's EOS-as-pad.

## Place in the whole

Instances live in Tauri-managed state (`TextEncoderState` slots, lazy-loaded and kept resident for free picker switches) and inside the indexing pipeline's encoder phase. Consumers are `commands/{semantic,semantic_fused,similarity}.rs` through `FusionIndexState`. Embedding-distribution changes (filter swaps, preprocessing edits) require an embedding-pipeline version bump so existing libraries re-encode.
