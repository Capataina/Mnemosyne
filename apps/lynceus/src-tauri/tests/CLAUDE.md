# apps/lynceus/src-tauri/tests/

Integration and diagnostic suites for the app crate. Two distinct kinds live here
and must not be conflated: **regression gates** that run on every `cargo test`, and
**`#[ignore]`-marked diagnostics** that either need real ONNX models/images on disk
or exist to pin a code-health-audit finding (running those in CI would lock in the
behaviour the audit recommends changing). Run diagnostics with `-- --ignored`;
model-dependent ones need `models/image/*` present (`scripts/download_models.py`).

## Map

```
tests/
├── indexing_pipeline.rs                          gate: scan + roots table + thumbnail +
│                                                 orphan-detection glue, real temp JPEGs;
│                                                 stops short of the encoder phase (no
│                                                 models in the repo). Passes against the
│                                                 6eb05b8 reordered pipeline (mark_orphaned
│                                                 before relink).
├── similarity_integration_test.rs                ignored: real-image cosine search through
│                                                 ClipImageEncoder against a local
│                                                 references/ corpus
├── audit_openclip_io_names_diagnostic.rs         ignored: real-inference pin on the
│                                                 OpenCLIP I/O node rename (text/embedding,
│                                                 image/embedding) — the bug class a green
│                                                 mocked suite cannot catch
├── batched_encode_equivalence_diagnostic.rs      ignored: SigLIP-2/DINOv2 encode_batch
│                                                 must equal the serial path per image,
│                                                 real models required
├── cosine_topk_partial_sort_diagnostic.rs        pure-Rust equivalence + timing pin for
│                                                 the full-sort → partial-select top-K
│                                                 audit finding
├── audit_db_read_lock_routing_diagnostic.rs      ignored: pins that switching foreground
│                                                 SELECTs to read_lock() is behaviour-free
│                                                 (I-DB-1/2, I-ENC-4)
├── audit_fusion_no_text_capable_encoders_diagnostic.rs
│                                                 ignored: DINOv2-only config makes fused
│                                                 semantic search return empty — the K-FUS-1
│                                                 UX collision, documented not fixed
└── audit_indexing_parallel_encoder_diagnostic.rs ignored: pins run_encoder_phase's dead
                                                  cosine_index parameters (D-IDX-1)
```

## Conventions and traps

- Audit diagnostics cite their findings in `docs/history/code-health-audit/area-*.md`;
  keep the docstring citation current if a finding is resolved, and delete the test
  when its finding lands (a resolved diagnostic left running documents a lie).
- Test JPEGs are generated in-code via the image crate (gradient fill so the file has
  heft) — no fixtures are committed; keep it that way.
- The encoder phase is deliberately untested at the integration level without models;
  the two real-inference diagnostics are the only proof of ONNX I/O contracts. After
  touching encoder I/O names, tokenisation, or batching, run them with models present
  — the compile proves nothing there.
- Suite size as of 2026-08-02: 44 lib tests (in `src/`) plus these files, green.
  Engine-level behaviour (relink, purge, eligibility SQL) is tested in
  `crates/engine/`, not here — don't duplicate.
