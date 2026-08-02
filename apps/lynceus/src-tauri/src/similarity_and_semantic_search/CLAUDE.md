# apps/lynceus/src-tauri/src/similarity_and_semantic_search/

Image/text encoder orchestration, ONNX sessions, preprocessing, and fused retrieval.

## Invariants

- Preserve per-encoder dimensionality/preprocessing contracts and fuse rankings rather than raw scores across unlike models.
- SigLIP-2 and DINOv2 override the encoder default with real batched `[N,3,H,W]` inference. CLIP remains fixed-batch-one until a provenance-verified model re-export passes equivalence gates.
- Search state is fusion-slot-only under one `RwLock`; generation-token refresh replaces the removed primary-index population path.
