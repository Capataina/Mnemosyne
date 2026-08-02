# apps/lynceus/src-tauri/src/similarity_and_semantic_search/

Image/text encoder orchestration, ONNX sessions, preprocessing, and fused retrieval.
Cosine ranking + RRF fusion themselves live in the engine (`mnemosyne::cosine`,
re-exported by `mod.rs` so old call-site paths keep resolving); this folder owns the
model-specific halves: loading, tokenising, preprocessing, and running the ONNX
graphs.

## Map

```
similarity_and_semantic_search/
├── mod.rs               engine re-exports (cosine, cosine_similarity) + submodule wiring
├── encoders.rs          ImageEncoder / TextEncoder traits — object-safe, L2-normalised
│                        output required, &mut self because ORT sessions aren't
│                        concurrency-safe
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

## Invariants

- Preserve per-encoder dimensionality/preprocessing contracts and fuse rankings
  rather than raw scores across unlike models. The three preprocessing pipelines are
  deliberately distinct and must each match the model's training recipe:
  CLIP = bicubic shortest-edge 224 + center-crop, CLIP mean/std;
  DINOv2 = bicubic shortest-edge 256 + center-crop 224, ImageNet mean/std;
  SigLIP-2 = exact 256×256 stretch (no aspect preservation, no crop), mean=std=0.5.
- SigLIP-2 and DINOv2 override the encoder default with real batched `[N,3,H,W]`
  inference. CLIP remains fixed-batch-one until a provenance-verified model
  re-export passes equivalence gates
  (`tests/batched_encode_equivalence_diagnostic.rs` is the gate).
- Search state is fusion-slot-only under one `RwLock`; generation-token refresh
  replaces the removed primary-index population path.
- Encoder pairs share one embedding space: never mix families across the modality
  gap (SigLIP image + CLIP text = random rankings). DINOv2 has no text half at all.

## Traps

- **ONNX I/O node names, dtypes, and shapes only fail at `session.run` time**, behind
  a green compile and green mocked tests. The OpenCLIP swap kept old node names and
  broke all real inference (`tests/audit_openclip_io_names_diagnostic.rs` is the
  regression pin — run it with real models after any I/O-contract change). The CLIP
  text input is int32 here where the old export was int64.
- CoreML decisions are per-graph and measured, not policy: skipped for the CLIP
  image encoder (runtime inference failure despite successful session-create) and
  for text (poor transformer coverage, 6-15s session-create). Re-test before
  re-enabling anywhere.
- ORT thread sizing is M2-deliberate: the default 8 threads pins work across the
  mixed cluster and collapses P-core frequency to E-core levels; 4 keeps the
  P-cluster at full frequency. Don't "fix" it to num_cpus.
- Model files resolve via `paths::models_dir()` + precision-variant resolution
  (int8 default via `Settings::effective_model_precision`); the store bundle ships
  only int8 + tokenizers. Loading code that assumes bare fp32 filenames breaks the
  sandboxed build.

## Place in the whole

Instances live in Tauri-managed state (`TextEncoderState` slots, lazy-loaded and
kept resident for free picker switches) and inside the indexing pipeline's encoder
phase. Consumers are `commands/{semantic,semantic_fused,similarity}.rs` through
`FusionIndexState`. Embedding-distribution changes (filter swaps, preprocessing
edits) require an embedding-pipeline version bump so existing libraries re-encode.
