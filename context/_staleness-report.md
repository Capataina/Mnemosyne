# Context Staleness Report

_Final snapshot from the upkeep-context run at HEAD `a547c8e` (commercialisation refactor: Mnemosyne engine + Lynceus product monorepo, OpenCLIP swap, repo-local models). Overwritten each run._

## Summary

- 137 `.md` files walked + `context/arch/` (data.js authored + 21 window.ARCH sections + script-owned callgraph/shell).
- `context/architecture.md` **retired** this run and migrated to `context/architecture.html` (built from `arch/data.js`, 21 subsystem nodes, 30 relationships, 22-step semantic-search dataflow trace).
- 11 systems + 5 notes + 1 reference reconciled against the engine/product split, the rename, the OpenCLIP swap, and the repo-local models tree.

## Per-file staleness

| File | Verdict | Evidence |
|------|---------|----------|
| arch/data.js | authored | 21 subsystem nodes reseeded from the new tree; all agent sections authored fresh for the engine/product split; arch_lint 0/0/0, arch_verify PASSED |
| arch/callgraph.js | up-to-date | regenerated wholesale by callgraph_scan.py (rust: 53 files, 247 fns) |
| arch/{index.html,styles.css,graph.js,app.js,features.js} | preserved | stamped from skills/upkeep-context/scripts/_templates/arch/ |
| architecture.html | authored | bundled from arch/ this run; replaces the retired architecture.md |
| _staleness-report.md | up-to-date | - |
| arch/_merge-report.md | up-to-date | - |
| enhancements/_research/_source_count.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/currents.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/firm-hiring/anthropic-infra-rust.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/firm-hiring/apple-pcc.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/firm-hiring/cloudflare-workers-ai.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/firm-hiring/huggingface-rust-eng.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/forums/brute-vs-hnsw-small.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/forums/clip-vs-dinov2-similarity.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/forums/coreml-vs-onnx.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/forums/framer-motion-perf.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/forums/react-19-best-practices.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/forums/sqlite-wal-mode.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/forums/tauri-vs-electron-2025.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/funding/vector-db-funding-2024.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/industry-analyst/oss-license-2025.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/ann-benchmarks-aumueller-2018.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/ckks-inner-product-2024.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/clip-zero-shot-classification.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/dfn-clip-apple-2023.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/dinov2-meta-2023.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/diskann-microsoft-2019.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/dpp-kulesza-2012.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/eva-clip-2023.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/hnsw-malkov-2018.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/imagebind-meta-2023.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/mmr-carbonell-1998.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/mobileclip-apple-2024.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/mteb-evaluation.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/onnx-int8-quantization.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/pacmann-panther-2024.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/perceptual-hash-vs-cnn-dedup.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/pinterest-visual-search.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/scann-google-2020.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/siglip-zhai-2023.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/siglip2-2025.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/simclr-chen-2020.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/spotify-diversity-recommendation.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/tinyclip-2023.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/papers/wally-apple-2024.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/awesome-tauri.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/burn-tract.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/bytemuck.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/candle-stable-diffusion.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/candle.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/criterion-rs.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/czkawka.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/eagle-app.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/faiss-meta.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/firefox-translate-onnx.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/hf-tokenizers.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/hydrus.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/image-rs-crate.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/immich.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/instant-distance.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/lancedb.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/notify-rs.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/open-clip.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/optimum-onnx-export.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/ort-pyke.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/parking-lot-mutex.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/photoprism-self-hosted.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/qdrant.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/rayon-rs.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/rust-exif-libs.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/siglip2-hf-models.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/silentkeys-tauri-ort.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/spacedrive.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/swift-homomorphic-encryption.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/tanstack-query-optimistic.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/tauri2-stable.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/tfhe-rs-zama.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/tokio-tracing.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/usearch.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/projects/zama-concrete-ml.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/rfcs-and-issues/ort-coreml-issues.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/rfcs-and-issues/tauri-asset-protocol-csp.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/rfcs-and-issues/tauri-dialog-folder-picker.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/talks/eurorust-rust-ml.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/_research/talks/rustconf-2024-wasm.md | preserved | external research paper/source discussing its own subject; repo-layout-independent |
| enhancements/audience.md | flagged-deferred | project-enhancement artefact with now-stale current-state claims; refresh belongs to a project-enhancement pass, outside upkeep-context edit scope |
| enhancements/index.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/recommendations/01-encoder-and-index-traits.md | flagged-deferred | project-enhancement artefact with now-stale current-state claims; refresh belongs to a project-enhancement pass, outside upkeep-context edit scope |
| enhancements/recommendations/02-hnsw-index-behind-trait.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/recommendations/03-clip-encoder-upgrade-audit.md | flagged-deferred | project-enhancement artefact with now-stale current-state claims; refresh belongs to a project-enhancement pass, outside upkeep-context edit scope |
| enhancements/recommendations/04-dinov2-image-only-encoder.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/recommendations/05-mmr-and-dpp-retrieval-modes.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/recommendations/06-int8-quantisation-encoders.md | flagged-deferred | project-enhancement artefact with now-stale current-state claims; refresh belongs to a project-enhancement pass, outside upkeep-context edit scope |
| enhancements/recommendations/07-encrypted-vector-search-mvp.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/recommendations/08-tauri-csp-asset-scope-hardening.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/recommendations/09-typed-error-enum-and-mutex-replacement.md | flagged-deferred | project-enhancement artefact with now-stale current-state claims; refresh belongs to a project-enhancement pass, outside upkeep-context edit scope |
| enhancements/recommendations/10-tracing-otlp-export.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/recommendations/11-auto-tagging-and-dedup.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/research_plan.md | preserved | project-enhancement forward-looking proposal; layout-independent |
| enhancements/synthesis.md | flagged-deferred | project-enhancement artefact with now-stale current-state claims; refresh belongs to a project-enhancement pass, outside upkeep-context edit scope |
| notes.md | up-to-date | index re-verified: all 10 note entries resolve; CLIP mention corrected to OpenCLIP |
| notes/clip-preprocessing-decisions.md | updated | stale id/env/CLIP/layout claims reconciled this run |
| notes/conventions.md | updated | stale id/env/CLIP/layout claims reconciled this run |
| notes/dead-code-inventory.md | updated | stale id/env/CLIP/layout claims reconciled this run |
| notes/encoder-additions-considered.md | updated | stale id/env/CLIP/layout claims reconciled this run |
| notes/fusion-architecture.md | up-to-date | rationale note; no repo-layout claim affected by the move |
| notes/local-first-philosophy.md | updated | stale id/env/CLIP/layout claims reconciled this run |
| notes/mutex-poisoning.md | up-to-date | rationale note; no repo-layout claim affected by the move |
| notes/path-and-state-coupling.md | up-to-date | rationale note; no repo-layout claim affected by the move |
| notes/preprocessing-spatial-coverage.md | up-to-date | rationale note; no repo-layout claim affected by the move |
| notes/random-shuffle-as-feature.md | up-to-date | rationale note; no repo-layout claim affected by the move |
| plans/code-health-audit/PASS-1-CHECKPOINT.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/PASS-2-SYSTEMS-AUDITED.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/area-1-indexing.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/area-2-fusion-and-search.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/area-3-encoders.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/area-4-database.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/area-5-frontend-and-misc.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/index.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| plans/code-health-audit/obligation-evidence-map.md | preserved | completed 2026-04-26 audit archive; 3 diagnostic tests shipped to apps/lynceus/src-tauri/tests/; internal src-tauri/ citations archival — owned by code-health-audit |
| references/m2-perf-options-2026-04.md | updated | added Current Relevance marking shipped M2 perf options (fast_image_resize, scaled JPEG decode, ort thread tuning) |
| systems/clip-image-encoder.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/clip-text-encoder.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/cosine-similarity.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/database.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/dinov2-encoder.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/filesystem-scanner.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/frontend-state.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/indexing.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/masonry-layout.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/model-download.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/multi-encoder-fusion.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/multi-folder-roots.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/paths-and-state.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/profiling.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/search-routing.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/siglip2-encoder.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/tag-system.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/tauri-commands.md | updated | refactor facts reconciled this run (paths -> engine/product split; names; OpenCLIP; models) |
| systems/thumbnail-pipeline.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |
| systems/watcher.md | up-to-date | no stale-layout tokens; pure-move refactor left behaviour unchanged; cited paths re-verified against new tree |

## Coverage-gap report

Source roots inspected: `crates/engine/src/` (db, cosine, cosine_similarity, paths, perf, domain structs), `apps/lynceus/src-tauri/src/` (commands, similarity_and_semantic_search, thumbnail, indexing, watcher, filesystem, settings, model_download, lib/main), `apps/lynceus/src/` (components, queries, hooks, services, pages), `scripts/`, `models/`.

No uncovered subsystem needs a net-new system file — the refactor moved code between crates without adding a subsystem. New surfaces fold into existing files:

| New/changed surface | Home |
|---|---|
| scripts/download_models.py | systems/model-download.md |
| commands/semantic_fused.rs (get_fused_semantic_search) | systems/multi-encoder-fusion.md + tauri-commands.md |
| similarity_and_semantic_search/preprocess.rs | folded into the four encoder system files |
| models/{image,audio,3d}/ weights tree | systems/paths-and-state.md + model-download.md |
| engine/product boundary | context/architecture.html (the split is its spine) |

