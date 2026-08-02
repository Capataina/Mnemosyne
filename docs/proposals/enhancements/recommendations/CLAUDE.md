# docs/proposals/enhancements/recommendations/ — the 11 recommendations

## Purpose and format

The 11 surviving recommendations of the 2026-04-26 run, numbered in
audience-cluster order (see `../index.md`). Uniform YAML frontmatter per file:
`audience`, `secondary_audiences`, `coupling_grade` (plug-and-play vs
commitment-grade), `implementation_cost`, `status`. Every file says
`status: draft` and none has been updated since — the status field is dead;
reality lives in the code.

## The map

```
recommendations/
├── 01-encoder-and-index-traits.md            Encoder + VectorIndex trait abstractions (prerequisite for 2-7)
├── 02-hnsw-index-behind-trait.md             HNSW behind the trait + recall/QPS benchmark
├── 03-clip-encoder-upgrade-audit.md          embedding-quality audit + SigLIP-2/MobileCLIP swap option
├── 04-dinov2-image-only-encoder.md           DINOv2 for "View Similar", CLIP retained for semantic
├── 05-mmr-and-dpp-retrieval-modes.md         MMR + k-DPP modes benchmarked against the 7-tier sampler
├── 06-int8-quantisation-encoders.md          INT8-quantised encoder variant + per-EP benchmark matrix
├── 07-encrypted-vector-search-mvp.md         TFHE-rs encrypted CosineIndex, opt-in mode (8-12 weeks, commitment-grade)
├── 08-tauri-csp-asset-scope-hardening.md     CSP + asset-scope hardening
├── 09-typed-error-enum-and-mutex-replacement.md  typed ApiError enum + mutex posture change
├── 10-tracing-otlp-export.md                 OTLP export for the tracing layer
└── 11-auto-tagging-and-dedup.md              zero-shot auto-tagging + perceptual-hash dedup
```

## Current state (2026-08-02) — several already landed by other routes

The product overtook this corpus without ever consulting it as a tracker:
SigLIP-2 (rec 03's swap option) and DINOv2-as-View-Similar (rec 04) are shipped
encoders (`docs/architecture/systems/siglip2-encoder.md`, `dinov2-encoder.md`);
int8 became the real default in the v0.7.13 store-shaping round (rec 06's
territory); a typed `ApiError` union exists on the IPC surface (part of rec 09's
territory). Before acting on any file here: check the code and
`docs/engineering/decisions/` first, then treat what genuinely remains (e.g. 01,
02, 05, 07) as 2026-04 sketches needing re-validation against the v0.7.14
codebase, not ready plans. Parent folders' Hermes-era trust caveat applies to
every factual claim inside.
