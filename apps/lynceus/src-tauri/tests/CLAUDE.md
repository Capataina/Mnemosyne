# apps/lynceus/src-tauri/tests/

Integration and diagnostic suites for the app crate. Two distinct kinds live here and must not be conflated: **regression gates** that run on every `cargo test`, and **`#[ignore]`-marked diagnostics** that either need real ONNX models/images on disk or exist to pin a code-health-audit finding (running those in CI would lock in the behaviour the audit recommends changing). Run diagnostics with `-- --ignored`; model-dependent ones need `models/image/*` present (`scripts/download_models.py`).

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
└── audit_fusion_no_text_capable_encoders_diagnostic.rs
                                                  ignored: DINOv2-only config makes fused
                                                  semantic search return empty — the K-FUS-1
                                                  UX collision, documented not fixed
```

## The audit findings the diagnostics pin

From the April 2026 code-health audit; the full audit corpus lives in git history.

Each `audit_*` test's doc-comment states its finding inline and is the finding's current home. Delete the test when its finding lands (a resolved diagnostic left running documents a lie). Status as of 2026-08-03:

- **K-FUS-1** (`audit_fusion_no_text_capable_encoders_diagnostic.rs`) — `get_fused_semantic_search` returns `Ok(Vec::new())` when no enabled encoder is text-capable. `decide_enabled_write` blocks disabling _every_ encoder but permits a DINOv2-only config (valid for image→image, silently bricks text search); the empty result is indistinguishable from "no matches". Proposed remedy was a typed `ApiError::BadInput` naming the fix ("enable CLIP or SigLIP-2"); **unresolved by choice** — an Ok→Err change to the IPC contract.
- **I-DB-1 / I-DB-2 / I-ENC-4** (`audit_db_read_lock_routing_diagnostic.rs`) — the codebase convention routes foreground IPC SELECTs through `read_lock()` (the read-only secondary connection), but two `db/embeddings.rs` methods still take the writer mutex: `get_embedding` (called from four foreground paths including the `get_fused_similar_images` hot path) and `get_images_without_embedding_for` (indexing-thread-only, which already owns its writer, so convention-only there). `get_image_embedding` — the third method this finding originally named — is no longer part of the surface: its only foreground callers were `commands/similarity.rs`'s `get_similar_images`/`get_tiered_similar_images`/`run_cross_encoder_comparison`, all deleted 2026-08-03 with the legacy single-encoder search surface (`commands/CLAUDE.md`); the function itself is untouched (engine-owned, still has its own unit tests) but this finding's remaining surface is `get_embedding` alone. The test pins that the switch is behaviour-free (`:memory:` DBs fall back to the writer under `read_lock()`); the win is freeing the writer at encode-batch boundaries. **Unresolved.**
- **D-IDX-1** (was `audit_indexing_parallel_encoder_diagnostic.rs`, now deleted) — `run_encoder_phase` took `cosine_index` + `cosine_current_encoder` Arcs and discarded both — leftovers of the retired priority-encoder hot-populate. **Landed** (the signature dropped both parameters); the diagnostic was vacuous once landed (its assertions duplicated existing lib tests, and it was `#[ignore]`d so it guarded nothing in CI) and was deleted per this folder's own rule, 2026-08-03.

## Knowledge (2026-08-02 audit)

- **The failed-scan-must-not-orphan guard has no regression test** — the guard at `src/indexing/mod.rs:456-471` protects against the HIGH-severity corruption vector 6eb05b8 documented (fail-fast scan failure → whole root orphaned → relink lets byte-identical files in other roots steal tags/placements), and `db/CLAUDE.md` itself records it was caught in adversarial review, not tests. No failed-scan scenario exists in `indexing_pipeline.rs`; the highest-severity known bug class rides a green suite. A test that fails one root's scan and asserts zero orphaning would close it. [code-health-audit 2026-08-02]

## Conventions and traps

- Test JPEGs are generated in-code via the image crate (gradient fill so the file has heft) — no fixtures are committed; keep it that way.
- The encoder phase is deliberately untested at the integration level without models; the two real-inference diagnostics are the only proof of ONNX I/O contracts. After touching encoder I/O names, tokenisation, or batching, run them with models present — the compile proves nothing there.
- Suite size as of 2026-08-03: 44 lib tests (in `src/`) plus these six files (down from seven — `cha_fusion_wrapper_equivalence.rs` and `audit_indexing_parallel_encoder_diagnostic.rs` retired the same day, see above), green. Engine-level behaviour (relink, purge, eligibility SQL) is tested in `crates/engine/`, not here — don't duplicate.
