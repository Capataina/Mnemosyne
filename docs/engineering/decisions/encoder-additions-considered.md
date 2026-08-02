# Encoder additions considered

Inventory of encoders we could add as a 4th (or 5th) family for fusion. Keep this updated as candidates emerge so a future session can act without re-deriving research.

## Current set (3 encoders)

| Encoder | Modality | Strength | Trained on | Licence |
|---|---|---|---|---|
| **CLIP ViT-B/32** (OpenCLIP, `immich-app/ViT-B-32__laion2b-s34b-b79k`) | image + text (512-d) | Concept overlap, text-image alignment | LAION-2B (web image-caption pairs) — re-sourced 2026-07 from OpenAI's WIT-400M-trained weights for commercial licensing; weights-only swap, same architecture/preprocessing/output space | MIT |
| **DINOv2-Base** | image-only (768-d) | Visual / structural similarity, identity, art style | Meta self-supervised (no captions) | Apache-2.0 |
| **SigLIP-2 Base 256** | image + text (768-d) | Descriptive content, modern English alignment | Google sigmoid loss, large web crawl | Apache-2.0 |

Together they cover concept (CLIP), structure (DINOv2), and descriptive content (SigLIP-2). The natural complementarity is what makes RRF fusion work well. All three are now commercially licensed — see `systems/model-download.md` and `systems/clip-image-encoder.md` (Durable Notes) for the CLIP swap.

## Decision rule for adding a 4th

**Don't add until there's a query class the current 3 demonstrably miss.** Each new encoder costs:

- 350-500 MB model weights on disk (download time + storage)
- ~1/3 of indexing wall-clock per image (parallel encoding mitigates somewhat)
- ~6 MiB resident RAM per 2000 images for the fusion cache
- Maintenance surface (preprocessing variants, ONNX export quirks, version bumps)

The threshold to add: a labelled retrieval-quality test set where the candidate encoder catches matches the current 3 miss. Without that evidence, additions are speculative.

## Candidates

### Tier A — most differentiated

#### OpenCLIP ViT-L/14 trained on LAION-2B

- **Baseline changed 2026-07:** this entry originally compared against OpenAI-WIT-trained CLIP-B/32. The shipped CLIP encoder is now itself OpenCLIP LAION-2B ViT-B/32 (see the table above) — so this candidate's differentiation from the current baseline is now about **scale (L/14 vs B/32) only**, not training corpus. The "LAION includes more illustrations/anime/art/screenshots vs OpenAI WIT" argument for adding this as a 4th encoder no longer holds; that corpus is already represented by the current CLIP-B/32.
- **What it adds:** A larger ViT-L/14 backbone at the same LAION-2B training corpus the current CLIP-B/32 already uses. Would need re-evaluating on scale alone.
- **Trade-off:** ~890 MB model. ~2-3× slower than ViT-B/32. Same conceptual lens as CLIP, so the RRF gain over the current CLIP-B/32 is likely smaller than originally estimated now that the corpus argument is gone.
- **Verdict:** Lower priority than originally assessed — re-evaluate against the labelled retrieval-quality test set (see "What would change my mind" below) before considering, since the strongest original argument (corpus diversity) is moot.
- **ONNX availability:** [openai-clip-onnx-models](https://huggingface.co/openai/clip-vit-large-patch14) and Xenova exports. Confirmed available (not re-verified after the 2026-07 swap).

#### EVA-CLIP ViT-B/16

- **What it adds:** ~+5% IN-1k accuracy over OpenAI ViT-B/32 with the same parameter count. Different architecture detail: scaled-up training, longer context.
- **Trade-off:** Same 768-d as SigLIP-2 image side. Some redundancy with SigLIP-2 (both improve over CLIP via training-process changes).
- **Verdict:** Marginal differentiation from SigLIP-2; lower priority.

#### SigLIP-2 Large 384 (upgrade, not add)

- **What it adds:** Same family as the current SigLIP-2 Base 256 but ~3× the parameter count and 384×384 input. Higher fidelity for fine-grained content.
- **Trade-off:** ~3× the disk + RAM, 3-4× the inference time. Could replace SigLIP-2 Base 256 rather than coexist.
- **Verdict:** A potential swap, not an addition. Worth A/B-ing if SigLIP-2 Base 256 starts to feel like a bottleneck on retrieval quality.

### Tier B — different niches

#### MobileCLIP-S2 / MobileCLIP2-S2 (Apple)

- **What it adds:** Speed. Apple's published numbers on iPhone Neural Engine are dramatic. CPU numbers on M2 are less impressive — a HuggingFace user reports MobileCLIP-S2 *slower* than ViT-B/32-256 on CPU.
- **Trade-off:** Likely a wash on M2 Mac CPU. Real win is on iPhone / when CoreML EP is functional (it isn't, today).
- **Verdict:** Hold for a future Phase that revisits CoreML; not a CPU win today.

#### Perceptual hash (pHash, dHash, aHash)

- **What it adds:** Genuinely orthogonal — pixel-level near-duplicate detection. Catches "same JPEG re-encoded twice", "same image at slightly different crops", etc.
- **Trade-off:** Not a learned embedding. Fixed-length hash; cosine fusion against learned embeddings doesn't work cleanly. Better as a **separate "Find Duplicates" feature** than as a fusion participant.
- **Verdict:** Add as a separate system, not a fusion encoder. Cross-link to `enhancements/recommendations/11-auto-tagging-and-dedup.md` which discusses this explicitly.

### Tier C — research bets, large investment

#### BLIP-2 / BLIP-3 image embeddings

- **What it adds:** Captioning models with strong visual understanding. Could enable "describe this image" features beyond pure similarity.
- **Trade-off:** ~3-5 GB models. Inference is more like a generation model than an encoder; may not slot cleanly into the cosine-fusion pattern.
- **Verdict:** Different architecture surface; skip for now.

#### SAM (Segment Anything) features

- **What it adds:** Object-aware features. Could power "find images with the same object."
- **Trade-off:** SAM is a segmentation model; using it for similarity requires extracting a global feature from per-pixel masks. Non-trivial.
- **Verdict:** Skip; not the right shape for the current fusion design.

## What would change my mind

Three things would lower the bar to adding a 4th encoder:

1. **A labelled retrieval-quality test set** of (query, expected matches) pairs from the user's actual library. Without this, every "this might help" claim is unfalsifiable.
2. **Visible misses by all 3 current encoders** that a candidate encoder demonstrably catches. E.g. art-style queries that CLIP+DINOv2+SigLIP-2 all rank poorly but OpenCLIP-LAION nails.
3. **A shrinking-marginal-cost regime** — if FP16/INT8 quantisation lands and per-encoder cost halves, the threshold to add another encoder drops because the marginal cost of one more encoder is smaller.

## Update log

- **2026-04-26** — initial inventory. Decision: ship with 3 encoders. Revisit when (1) golden set exists or (2) a user-reported quality complaint maps cleanly to a known gap.
- **2026-07** — commercialisation refactor swapped the shipped CLIP encoder from OpenAI's non-commercial WIT-400M-trained weights to OpenCLIP's MIT-licensed LAION-2B weights (same ViT-B/32 size, weights-only swap — no behaviour change). Updated the "Current set" table's licence/training-corpus columns and re-flagged the OpenCLIP ViT-L/14 candidate, whose original differentiation argument (LAION corpus vs OpenAI WIT) no longer applies now that the baseline CLIP is itself LAION-trained.
