# clip-image-encoder

*Maturity: comprehensive · Stability: stable — deliberately excluded from the T2-3 batch-inference work (`ebe4006`) because the export's fixed batch-dim-1 makes true batching unsafe; the write path was also verified and updated this pass (per-encoder needs-set + single-transaction batch write, legacy column no longer written)*

## Scope / Purpose

Loads OpenCLIP LAION-2B ViT-B/32's separate `visual/model.onnx` (cached on disk as `clip_vision.onnx`; MIT-licensed, swapped from OpenAI's non-commercial CLIP export 2026-07 — weights-only in intent, see Durable Notes) and produces 512-dimensional L2-normalised `f32` embeddings for image files. Runs CPU-only on macOS (CoreML's runtime inference fails on this graph) and tries CUDA on non-macOS, both with CPU fallback. Driven by the indexing pipeline's encode phase (`systems/indexing.md`) to populate the per-encoder `embeddings(image_id, encoder_id="clip_vit_b_32", embedding)` row for every image lacking one; the legacy `images.embedding` BLOB is no longer written by this path (see Key Interfaces below). Consumed by `systems/multi-encoder-fusion.md`'s RRF fusion across all three encoders.

## Boundaries / Ownership

- **Owns:** image preprocessing (aspect-preserving bicubic resize + center-crop + CLIP-native normalization), ONNX session lifecycle with EP fallback, single + batched inference, L2-normalize at output.
- **Does not own:** writing embeddings to disk (delegates to `db.upsert_embeddings_batch("clip_vit_b_32", rows, legacy_clip_too=false)`, one transaction per 32-chunk — see Key Interfaces below), CUDA / CoreML detection (relies on `ort`'s built-in fallback semantics), the model file on disk (delegates to `paths::models_dir()` + `model_download::CLIP_VISION_FILENAME`), text-side encoding (lives in `clip-text-encoder`).
- **Public API:** `ClipImageEncoder::new(model_path)`, `inspect_model`, `preprocess_image`, `batch_preprocess_image`, `encode`, `encode_batch`. Implements the `ImageEncoder` trait so the indexing pipeline can dispatch via `Box<dyn ImageEncoder>`.

## Current Implemented Reality

### Pipeline per image — canonical CLIP preprocessing (unchanged by the OpenCLIP weights swap)

```text
ImageReader::open → with_guessed_format → decode → to_rgb8
    │
    ▼
Aspect-preserving resize on shortest edge to 224 (CatmullRom — image-rs's bicubic-family
    filter, closest match to PIL's BICUBIC). NOT resize_exact (which would squash).
    │
    ▼
Center-crop to 224×224. Cuts away anything outside the central window — see
    notes/preprocessing-spatial-coverage.md for the implication on edge content.
    │
    ▼
Split RGB into 3 contiguous slices (R then G then B):
    [R0..R(224*224-1), G0..G(...), B0..B(...)]      # length 224*224*3
    │
    ▼
Normalise per-channel: x = (x/255 - mean[c]) / std[c]
    where mean = [0.48145466, 0.4578275, 0.40821073]   ← CLIP-native, from
                                                         Xenova preprocessor_config.json
          std  = [0.26862954, 0.26130258, 0.27577711]
    │
    ▼
Reshape to ndarray::Array4 with shape (1, 3, 224, 224)
    │
    ▼
ort::Tensor::from_array((shape, raw_vec))
    │
    ▼
Session::run with ONE input (separate visual/model.onnx — no dummy text inputs):
    image    ← image tensor
    │
    ▼
Output: embedding, shape [1, 512]
    │
    ▼
L2-normalize via super::encoder_text::pooling::normalize
    └─► return Vec<f32> length 512
```

**I/O node names are `image` → `embedding`, not `pixel_values` → `image_embeds`.** Those were the OLD Xenova export's names; the current OpenCLIP `visual/model.onnx` (immich-app) export renamed both (`image` was `pixel_values`, `embedding` was `image_embeds`). Calling the new export with the old names errors at `session.run` with "Invalid input name" — this was Bug 1 of three fixed together in `b58dd46` (2026-07-15), the same commit that fixed the fixed-batch-dim-1 issue described in Batch Encoding below.

### The "no dummy text inputs" change

Pre-2026-04-26 the encoder used Xenova's combined-graph CLIP export, which bundled image and text encoders in a single ONNX graph. Calling it for image-only inference required supplying dummy `input_ids: [[0]]` and `attention_mask: [[1]]` to satisfy the graph signature.

The current build uses the **separate** `visual/model.onnx`. Inputs are reduced to just the one image tensor (named `image` on the current export), simplifying the call shape and removing the unused text branch from session memory. This was part of the same change that switched the text encoder from the multilingual distillation to OpenAI English (see `clip-text-encoder.md`) — both halves were swapped together to keep the embedding space consistent. (At the time, the export still came from Xenova's OpenAI-CLIP repo, with I/O named `pixel_values`/`image_embeds`; the vision/text weights were later re-sourced from `immich-app/ViT-B-32__laion2b-s34b-b79k` — see Durable Notes below — which renamed the I/O to `image`/`embedding` and required the `b58dd46` fix noted above. The tokenizer export is the only piece still mirrored from Xenova.)

### Execution provider — CoreML disabled, CPU-only on macOS

```rust
#[cfg(target_os = "macos")]
fn build_session_with_accel(model_path: &Path) -> Result<Session, Box<dyn Error>> {
    // CoreML's GetCapability accepts ~54% of CLIP nodes (980 of 1827) and
    // session-create succeeds, but actual inference fails at runtime with
    // "Unable to compute the prediction using a neural network model
    // (error code: -1)". Documented in encoder.rs header comment block.
    Session::builder()?.commit_from_file(model_path)
}

#[cfg(not(target_os = "macos"))]
fn build_session_with_accel(model_path: &Path) -> Result<Session, Box<dyn Error>> {
    Session::builder()?
        .with_execution_providers([CUDAExecutionProvider::default().build()])?
        .commit_from_file(model_path)
}
```

CoreML was disabled mid-2026 after the runtime-failure pattern was confirmed across multiple ort releases. The encoder.rs file header carries the diagnosis: ort's CoreML EP partition decision is permissive at compile time but the resulting graph doesn't actually run. CPU on M-series is ~200–500 ms per image — acceptable for the project's library sizes (1500–10k images).

### Batch encoding — stays per-image, on purpose, unlike SigLIP-2/DINOv2

```rust
pub fn encode_batch(&mut self, paths: &[&Path]) -> Result<Vec<Vec<f32>>>
```

This is a **durable constraint, not an oversight**: `encode_batch` pre-processes `paths` in chunks of 32 (`batch_preprocess_image`, bounding peak decode memory), but the ONNX call inside each chunk still runs **one `[1, 3, 224, 224]` inference per image**, not a single stacked `[N, 3, 224, 224]` call. SigLIP-2 (`siglip2-encoder.md`) and DINOv2 (`dinov2-encoder.md`) both got a true batched-tensor override in T2-3 (commit `ebe4006`); CLIP was deliberately left out of that work because its export can't take it — see the fixed-batch-dim-1 reasoning below.

**Why CLIP can't take the same batching the other two encoders got.** The OpenCLIP `visual/model.onnx` export (`immich-app/ViT-B-32__laion2b-s34b-b79k`) declares a **FIXED** batch dimension of 1 on its `image` input — `onnx.load(...).graph.input[0].type.tensor_type.shape.dim[0].dim_value == 1`, not a dynamic `dim_param` — unlike the old Xenova export it replaced (dynamic batch dim) and unlike SigLIP-2's/DINOv2's exports (both still dynamic). A stacked `[N, 3, 224, 224]` call against this export fails at `session.run` with ORT's `"Got invalid dimensions for input: image"`.

This was discovered the hard way (`b58dd46`, 2026-07-15, landed the same day as the CLIP→OpenCLIP weights swap): the true-batched call silently failed on every indexing run, `encode_batch` returned `Err`, the whole chunk landed in `failed_paths`, and the only place that surfaces `failed_paths` is a perf diagnostic gated behind `--profiling` — so CLIP silently produced **zero** embeddings while DINOv2 and SigLIP-2 (still dynamic-batch at the time) encoded normally, with no error visible in the normal UI. Fixed by making `encode_batch` run one `[1, 3, 224, 224]` inference per image (same shape `encode()` already uses successfully) instead of trying to batch the ONNX call; the outer chunking by 32 stays for memory-bounding, but no longer feeds a multi-image tensor into the model.

**Re-exporting to a dynamic batch dim is blocked on weights provenance, not effort.** The vision weights come from a third-party MIT-licensed re-export (`immich-app/ViT-B-32__laion2b-s34b-b79k`) chosen specifically for its commercial-safe licence after the 2026-07 OpenAI→OpenCLIP swap (see Durable Notes below); re-exporting it with a dynamic batch dim would mean re-running the ONNX export pipeline against weights whose provenance chain the project does not control end-to-end, which is exactly the kind of unverified-supply-chain risk the commercial-licensing swap was trying to eliminate. Until a dynamic-batch CLIP export with equivalent verified licensing surfaces, CLIP stays per-image.

### Where it runs

The indexing pipeline calls `ClipImageEncoder::new(image_model_path)` once per pipeline run (so a re-spawn after `add_root` reloads the model — slightly wasteful, but the cost is bounded by how often pipelines re-spawn).

## Key Interfaces / Data Flow

```
indexing.rs::run_clip_encoder_with_intra:
    image_model_path = paths::models_dir().join(model_download::CLIP_VISION_FILENAME)  // "clip_vision.onnx"
    if image_model_path.exists():
        // Per-encoder needs-set, NOT the legacy images.embedding IS NULL column
        // (R8 stopped writing that column — see below — so the legacy query
        // would return the WHOLE library on every launch).
        needs_embed = db.get_images_without_embedding_for("clip_vit_b_32")
        for chunk in needs_embed.chunks(32):
            embeddings = encoder.encode_batch(chunk_paths)   // per-image ONNX calls, chunked preprocessing — see above
            batch_rows = chunk.zip(embeddings) as Vec<(ID, Vec<f32>)>
            db.upsert_embeddings_batch("clip_vit_b_32", &batch_rows, legacy_clip_too=false)  // R1: ONE transaction per chunk
            emit Phase::Encode(processed, total)
        emit "encoder_run_summary" diagnostic (attempted/succeeded/failed/mean ms)
        emit "preprocessing_sample" diagnostic on first batch
    else:
        warn "{CLIP_VISION_FILENAME} missing; embeddings will be empty until next launch."
```

The encode phase is gated on the model file existing. If it doesn't (first launch + download in progress, user manually deleted), the pipeline skips encode entirely. Semantic + similarity search on a no-embedding library returns empty Vec.

**Verified drift fix (this pass): the write path had moved on from what this doc described.** The doc previously showed `db.get_images_without_embeddings()` (the legacy whole-library query) plus a per-image `db.update_image_embedding` + `db.upsert_embedding` pair. Current code (`indexing.rs::run_clip_encoder_with_intra`) reads the per-encoder needs-set via `get_images_without_embedding_for("clip_vit_b_32")` and writes the whole chunk in one `upsert_embeddings_batch` call with `legacy_clip_too = false` — the legacy `images.embedding` column is no longer written at all (R8). Reading the per-encoder table instead of the legacy column matters operationally: under R8 the legacy column is never populated, so the old legacy-query would return the entire library on every launch and CLIP would silently re-encode everything it had already encoded, flashing a false "Encoding 100%" even on a fully-indexed library.

## Implemented Outputs / Artifacts

- `<app_data_dir>/models/clip_vision.onnx` (~352 MB) loaded at construction.
- 512-d L2-normalised `f32` embedding per image.
- One storage destination per embedding: `embeddings(image_id, encoder_id="clip_vit_b_32", embedding)` row, written in a single `upsert_embeddings_batch` transaction per 32-chunk. The legacy `images.embedding` BLOB column still exists in the schema (`update_image_embedding` is still a live method) but the indexing path stopped writing it — `upsert_embeddings_batch`'s `legacy_clip_too` flag is `false` at this call site. See the Key Interfaces drift note above for why this changed.
- Encoder is recreated per indexing-pipeline run; not held in long-lived Tauri state.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| Center-crop drops edge content | Tall/wide images with meaningful periphery | Embeddings reflect only the central 224×224 window. Splash arts / scenery / group photos with edge content are under-represented. See `notes/preprocessing-spatial-coverage.md`. |
| EP fallback is silent | CUDA init failure on non-macOS | Runs on CPU at 10× slower throughput with no UI signal. The user sees a slow encode phase but no error. |
| Encoder is re-instantiated per pipeline run | Frequent root mutations | Each `add_root` triggers a new pipeline → new `ClipImageEncoder::new` → re-load 352 MB model into ONNX session. Wasteful but bounded. |
| Sequential preprocessing within `encode_batch` | Large batches | Decoding 32 images sequentially before the ONNX batch is the bottleneck for some workloads. Could be rayon-parallelised. |
| Model file corruption surfaces only at session creation time | Disk corruption mid-download | `Session::builder().commit_from_file` errors → `ApiError::Encoder("ONNX session creation failed: ...")`. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Hold the encoder in Tauri state** to avoid re-loading on every pipeline re-spawn. Trade-off: ~352 MB resident memory always vs the load cost on rare re-spawns. Probably worth it now that the encoder is much smaller than before.
- **Rayon-parallel preprocessing** within `encode_batch` to overlap decode with the next batch's CPU work.
- **Smart per-query encoder routing** — long-term, route color/scenery queries to SigLIP-2 (no crop) and character/object queries to CLIP. Captured as an open concern in `notes/preprocessing-spatial-coverage.md`.
- **Int8 quantised image encoder** — would shrink the download by ~4× and speed up inference. Documented in `enhancements/recommendations/06-int8-quantisation-encoders.md`. Note: the user has explicitly rejected quantization on quality grounds for the current pipeline — revisit only if a use case justifies the trade-off.

## Durable Notes / Discarded Approaches

- **Combined-graph + dummy text inputs is gone.** The encoder now uses the separate `visual/model.onnx`. Old indexing data with dummy-text-input embeddings is invalidated by `migrate_embedding_pipeline_version` (DB version 2) — see `systems/database.md`. If a future ONNX export change requires re-invalidating, bump the version constant.
- **CoreML stays disabled even though "GetCapability" reports it can handle the graph.** The runtime inference failure pattern was reproducible across multiple ort releases. Re-enabling without verifying every op runs under inference is silent corruption waiting to happen.
- **Per-channel slice layout `[R..., G..., B...]` is intentional, not interleaved `[RGB, RGB, ...]`.** ONNX tensor convention is NCHW (channels first); interleaved would require a transpose at every encode call.
- **CatmullRom over Lanczos3 is the canonical bicubic match.** PIL's `BICUBIC` (resample=3) maps to a cubic family closer to CatmullRom than Lanczos3. Not bit-exact, but standard for ONNX deployments outside Python.
- **L2-normalize at output is required** — the `visual/model.onnx` export outputs un-normalised projected embeddings (true of both the original Xenova/OpenAI weights and the current OpenCLIP LAION-2B weights — same architecture, same un-normalised head). Cosine similarity still works without normalising (the math divides by norms) but pre-normalisation makes the resulting vectors interchangeable and the cache cosines well-conditioned.
- **2026-07 commercial-licensing swap: OpenAI CLIP (Xenova export, non-commercial research licence) → OpenCLIP LAION-2B ViT-B/32 (`immich-app/ViT-B-32__laion2b-s34b-b79k`, MIT).** Weights-only in the sense that the preprocessing pipeline, tokenizer vocab, and 512-d output space are unchanged — but the new export's I/O node names and dtypes DID differ from the old Xenova export, and the swap's own commit (`00ee2fa`) did not catch it: the encoder code kept calling the new export with the old names (`input_ids`/`pixel_values` instead of `text`/`image`) and the old int64 dtype (the new export wants int32 for text), and the new export's fixed batch-dim-1 vision graph broke the true-batched `encode_batch` call outright. All three bugs were silently failing (CLIP wrote zero embeddings on every indexing run) until `b58dd46` (same day, 2026-07-15) fixed them — see the "Batch encoding" section above for the batch-dim-1 half of that fix. No `CURRENT_PIPELINE_VERSION` bump was needed for either commit (see `systems/model-download.md` and `notes/clip-preprocessing-decisions.md`) since the output embedding space itself didn't change. CLIP is still English-only ViT-B/32 — this is a provenance and licence change in intent, though it did carry real code-level fallout in practice. All three encoders are now commercially licensed: OpenCLIP MIT, DINOv2 Apache-2.0 (Meta), SigLIP-2 Apache-2.0 (Google).
- **Resize is now implemented via the shared `similarity_and_semantic_search/preprocess.rs` helper** (introduced Phase 12e, pre-dating the commercialisation refactor), used identically by all three image encoders rather than each encoder inlining its own resize call.

## Obsolete / No Longer Relevant

The combined-graph code path with dummy text inputs (pre-2026-04-26). The `FilterType::Nearest` and ImageNet-stats shortcut documented in earlier versions of `notes/clip-preprocessing-decisions.md`. The 1.1 GB combined `model.onnx` filename `model_image.onnx` — files now use `clip_vision.onnx` and the migration system invalidates legacy data automatically.
