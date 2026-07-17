/* ============================================================
   data.js - written by upkeep-context upkeep-context orchestrator (coverage re-applied post-final-merge)
   schema: v2
   Edit agent-owned sections per references/arch-pipeline.md.
   Re-runs of upkeep-context preserve agent prose via arch_merge.py.
   ============================================================ */
window.ARCH = JSON.parse(`{
  "_meta": {
    "deleted_node_ids": [
      "apps_lynceus",
      "crates_engine",
      "models_3d",
      "models_audio",
      "models_image",
      "scripts"
    ],
    "deleted_edge_keys": [
      "tauri_commands->cosine_similarity",
      "multi_folder_roots->cosine_similarity"
    ],
    "frontier_locked": false,
    "repotree_locked": true
  },
  "schema": "v2",
  "project": {
    "name": "Lynceus / Mnemosyne",
    "file": "context/architecture.html",
    "head": "e31a809",
    "headRange": "9b416de..e31a809",
    "regenerated": "2026-07-17",
    "stack": "Rust workspace (engine + Tauri 2 product) + React 19 · ONNX Runtime 2.0.0-rc.10 · SQLite/WAL · memmap2 flat embedding stores",
    "milestone": "100k-scale performance round shipped: ID-native fusion search, flat mmap embedding store, compact feed manifest + delta protocol, off-main-thread masonry — the v2 UI (single shuffle feed, library drawer, gesture timer) also landed just before it",
    "tests": "cargo test --workspace: 172 passed (lynceus_lib 44 + mnemosyne 115 + integration 7 + cosine-partial-sort diagnostic 6), 12 model-dependent diagnostics ignored (no real weights on this runner) · vitest 116/116 across 13 files",
    "commits": 55,
    "lines": 2411817,
    "tagline": "Lynceus is a local-first Tauri 2 + React 19 desktop image browser built on Mnemosyne, a reusable media-agnostic catalogue + embedding-retrieval engine extracted into its own crate. Three ONNX encoder families (OpenCLIP LAION ViT-B/32, DINOv2-Base, SigLIP-2 Base 256) feed an ID-native Reciprocal Rank Fusion search layer backed by a flat mmap embedding store per encoder — there is no longer a single 'primary' cosine cache. The grid is a single always-shuffled feed (the four legacy sort modes are gone) fed by a compact geometry-only manifest with per-id lazy hydration and batched live-update deltas during indexing, packed off the main thread by a Web Worker. A figure-drawing gesture-timer practice mode rounds out the v2 UI. Version 0.5.0, shipped just after the 100k-image performance round.",
    "purpose": "Orient a new engineer to the two-crate split (Mnemosyne engine vs Lynceus product), the runtime layers, ownership boundaries, dependency direction, and the main ID-native fusion-search plus compact-feed execution flows now that the 100k performance round has replaced the primary cosine cache with per-encoder mmap stores and the full-catalogue feed query with a manifest/delta protocol. This is the map, not the territory — subsystem deep-dives live in systems/*.md, rationale in notes/, and the enhancement backlog in enhancements/.",
    "overview": "A Cargo workspace (root Cargo.toml, members crates/engine + apps/lynceus/src-tauri) mirrored by a pnpm workspace (root package.json, workspaces apps/*). The engine crate mnemosyne owns the DB, cosine/fusion, paths, and perf layers; the product crate lynceus (lib lynceus_lib) re-exports them so in-crate crate::db / crate::paths / crate::cosine call sites resolve unchanged. The React 19 + TypeScript + TanStack Query + Vite frontend sits at apps/lynceus/src beside the Tauri 2 app crate, talking to it over a 34-command typed IPC surface (confirmed by direct count of lib.rs's invoke_handler![...] list). Rust runs CPU-only for ONNX on macOS (CoreML errors on these graphs), CUDA-with-CPU-fallback elsewhere. Tests: cargo test --workspace green (172 passed — lynceus_lib 44 + mnemosyne 115 + indexing_pipeline integration 7 + cosine_topk_partial_sort diagnostic 6 — plus 12 model-dependent diagnostics ignored without real weights on disk); pnpm run test green (116 vitest across 13 files).",
    "techStack": [
      {
        "name": "Rust",
        "meta": "2021 edition · Cargo workspace (engine + product)"
      },
      {
        "name": "Tauri",
        "meta": "v2 · protocol-asset · dialog + opener plugins"
      },
      {
        "name": "React",
        "meta": "19 · Vite 7 · TanStack Query 5 · Tailwind v4"
      },
      {
        "name": "ort (ONNX Runtime)",
        "meta": "2.0.0-rc.10 · CPU on macOS · CUDA fallback elsewhere"
      },
      {
        "name": "rusqlite",
        "meta": "0.37 bundled · WAL · dual writer/read-only conns"
      },
      {
        "name": "OpenCLIP / DINOv2 / SigLIP-2",
        "meta": "3 ONNX encoders · MIT / Apache-2.0 / Apache-2.0"
      },
      {
        "name": "HF tokenizers",
        "meta": "0.22 · CLIP BPE + Gemma SentencePiece"
      },
      {
        "name": "fast_image_resize + jpeg-decoder",
        "meta": "6.x NEON Lanczos3 · scaled IDCT"
      },
      {
        "name": "rayon",
        "meta": "parallel thumbnailing + encoding"
      },
      {
        "name": "HuggingFace weights",
        "meta": "fetched by scripts/download_models.py into gitignored models/"
      }
    ],
    "frameBudget": "16 ms target · rAF-coalesced scroll (400px band) + off-main-thread masonry pack"
  },
  "nodes": [
    {
      "id": "app_shell",
      "label": "app-shell",
      "kind": "entry",
      "layer": 0,
      "root": "apps/lynceus/src-tauri/src/",
      "tagline": "Tauri binary entry + builder: parses --profiling, opens SQLite, manages singletons (now FusionIndexState + TextEncoderState, not the removed CosineIndexState), wires the 34-command invoke handler, and launches the launch-time fusion cache warm.",
      "owns": "Owns main.rs bootstrap and lib.rs::run — the tauri::Builder that manages every state singleton (FusionIndexState, TextEncoderState, IndexingState, WatcherHandle), the .setup() legacy-migrate + security-scoped-bookmark resolution + pipeline-spawn + watcher-start, spawn_cache_warm (launch-time per-encoder flat-store mmap warm, independent of and running before the indexing pipeline), the 34-command invoke_handler (confirmed by direct count), and the on-Exit profiling report hook. Re-exports the engine modules (pub use mnemosyne::{db,paths,perf,...}) so product call sites resolve unchanged. Does NOT own any command body (commands/) or the engine, and no longer owns any cosine-cache-loading logic on entry — that moved to spawn_cache_warm plus the pipeline's own step 7.",
      "files": [
        "main.rs - binary entry: --profiling parse, tracing subscriber + opt-in PerfLayer, SQLite open + initialize, hands to lynceus_lib::run",
        "lib.rs - manage state (FusionIndexState, TextEncoderState, IndexingState, WatcherHandle) + setup (legacy migrate, bookmark resolution, spawn pipeline, start watcher) + spawn_cache_warm + invoke_handler![34] + on-Exit report; re-exports mnemosyne modules"
      ],
      "state": [
        "Tauri Builder",
        "managed-state singletons (FusionIndexState, TextEncoderState)",
        "invoke_handler[34]",
        "spawn_cache_warm launch thread"
      ],
      "_stale": true
    },
    {
      "id": "tauri_commands",
      "label": "tauri-commands",
      "kind": "boundary",
      "layer": 1,
      "root": "apps/lynceus/src-tauri/src/commands/",
      "tagline": "The 34-command IPC surface between the React frontend and the Rust backend, with typed ApiError wire format and one shared ID-native hydration path.",
      "owns": "Owns every Tauri command handler grouped by concern under commands/, the ApiError discriminated union (serde tag=kind, 10 variants), the unified ImageSearchResult shape, hydrate_search_results (the shared ID-native batch-hydration helper every similarity/semantic command now calls, replacing the old per-result path resolution + N+1 thumbnail lookup), the legacy resolve_image_id_for_cosine_path fallback (now caller-less on every fusion-borrowing hot path — kept for its own tests and the Windows-path-instability rationale it encodes), lazy + pre-warmed dual (CLIP/SigLIP-2) text-encoder init, and fusion-cache invalidation on root mutations (fusion_state.invalidate_all()). Does NOT own the business logic it calls into (db, cosine/fusion, encoders) — it is the thin typed boundary.",
      "files": [
        "mod.rs - re-exports + ImageSearchResult + hydrate_search_results (T3-2/#6) + resolve_image_id_for_cosine_path (legacy, callerless on the hot path)",
        "error.rs - ApiError enum (serde tag=kind, content=details); From-impls for rusqlite/io/poison; 5 unit tests",
        "images.rs - get_images (wire-compat), get_feed_manifest + get_image_details (T3-1), get_pipeline_stats, get_thumbnail (adaptive-resolution), set_manual_order (backend-only) + set_manual_col_span (live)",
        "tags.rs - get_tags, get_tag_counts, create_tag, delete_tag, add_tag_to_image, remove_tag_from_image",
        "notes.rs - get_image_notes, set_image_notes",
        "roots.rs - get_scan_root, set_scan_root, list_roots, add_root, remove_root, set_root_enabled; fusion invalidation + security-scoped bookmarks",
        "similarity.rs - get_similar_images, get_tiered_similar_images (FusionIndexState-borrowing), get_fused_similar_images (RRF)",
        "semantic.rs - semantic_search (CLIP/SigLIP-2 dual dispatch)",
        "semantic_fused.rs - get_fused_semantic_search (Phase 11d text-image RRF)",
        "encoders.rs - list_available_encoders, get_enabled_encoders, set_enabled_encoders",
        "profiling.rs - is_profiling_enabled, get_perf_snapshot, reset_perf_stats, export_perf_snapshot, record_user_action"
      ],
      "state": [
        "ApiError enum (10 variants)",
        "ImageSearchResult",
        "34-command surface",
        "hydrate_search_results"
      ],
      "_stale": true
    },
    {
      "id": "indexing",
      "label": "indexing",
      "kind": "boundary",
      "layer": 2,
      "root": "apps/lynceus/src-tauri/src/indexing.rs",
      "tagline": "Background pipeline that turns folders of images into a searchable, embedded, thumbnailed catalogue — now with per-encoder concurrent batch inference, batched scan inserts, and a token-gated fusion-slot refresh instead of a primary-cache repopulate.",
      "owns": "Owns run_pipeline_inner's phase spine: model-download -> scan (batched INSERT OR IGNORE, T2-2) -> orphan-mark -> thumbnail (base-480 pop-in pass + eager 960/1440/2048 bucket pre-warm pass, emitting batched feed-delta events) -> per-encoder concurrent encode (CLIP stays per-image due to a fixed batch-dim-1 export; SigLIP-2/DINOv2 run true [N,3,H,W] batch inference) -> step 7 token-gated fusion-slot refresh_if_stale + persist (replacing the old primary-cosine populate+save). Owns single-flight gating (AtomicBool + RAII clear-on-panic), the shared monotonic EncodeProgress counter (fixes the sticky-0/21 render bug under concurrent encoder threads), and the FeedDeltaRow/FeedDeltaBatch shape. Does NOT own the encoders' math, the cosine/fusion cache lifecycle itself (FusionIndexState — see multi_encoder_fusion), or launch-time cache warming (moved to lib.rs::spawn_cache_warm, outside this file entirely).",
      "files": [
        "indexing.rs - background pipeline (single-flight AtomicBool); model-download -> scan (batched) -> thumbnail (2 passes) -> per-encoder concurrent encode -> step 7 fusion refresh; emits indexing-progress + batched feed-delta"
      ],
      "state": [
        "IndexingState (AtomicBool)",
        "IndexingProgress events",
        "EncodeProgress shared monotonic counter",
        "FeedDeltaRow/FeedDeltaBatch buffer (flush every 64 rows)",
        "pipeline phase order"
      ],
      "_stale": true
    },
    {
      "id": "watcher",
      "label": "watcher",
      "kind": "boundary",
      "layer": 2,
      "root": "apps/lynceus/src-tauri/src/watcher.rs",
      "tagline": "Filesystem watcher that re-triggers indexing when watched roots change on disk; forwards the FusionIndexState slot map through every rescan so the pipeline's step 7 can refresh it.",
      "owns": "Owns the notify-debouncer-mini watch (5s debounce, recursive on every enabled root) and the debounced re-spawn of the indexing pipeline through try_spawn_pipeline, now threading Arc<RwLock<HashMap<String, CosineIndex>>> (the same fusion slot map FusionIndexState owns) instead of the removed primary Arc<Mutex<CosineIndex>> parameter. Does NOT own the pipeline, the fusion refresh itself (delegates to CosineIndex::refresh_if_stale inside the pipeline's step 7 — this is the fix for a staleness regression the fc6667a->1514a90 reroute had introduced), or watcher reconfiguration on root changes (known, still-unresolved gap).",
      "files": [
        "watcher.rs - notify-debouncer-mini start; rescan trigger via try_spawn_pipeline (single-flight coalesces bursts); forwards the fusion Arc<RwLock<...>> pass-through"
      ],
      "state": [
        "WatcherHandle slot",
        "debounce coalescing",
        "forwarded fusion Arc<RwLock<HashMap<String,CosineIndex>>> (pass-through only)"
      ],
      "_stale": true
    },
    {
      "id": "filesystem_scanner",
      "label": "filesystem-scanner",
      "kind": "foundation",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/filesystem.rs",
      "tagline": "Recursive image discovery over a directory with an extension whitelist; the algorithm itself is byte-for-byte unchanged since the last baseline — only how its output gets inserted changed.",
      "owns": "Owns ImageScanner: recursive read_dir + a 7-extension whitelist, called per enabled root by the pipeline. Does NOT own persistence, batching, or dedup — it yields candidate paths only; the pipeline aggregates every root's paths into 256-path chunks and hands them to db.add_images_batch (one BEGIN IMMEDIATE + prepared INSERT OR IGNORE per chunk, with a mandatory per-row fallback on chunk failure), replacing the old one-row-per-transaction insert loop.",
      "files": [
        "filesystem.rs - ImageScanner: recursive read_dir + 7-extension whitelist (unchanged); output now consumed via db.add_images_batch chunking, not per-path add_image"
      ],
      "state": [
        "extension whitelist",
        "ImageScanner",
        "per-root path lists (for mark_orphaned)"
      ],
      "_stale": true
    },
    {
      "id": "thumbnail_pipeline",
      "label": "thumbnail-pipeline",
      "kind": "foundation",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/thumbnail/",
      "tagline": "Adaptive-resolution thumbnail bucket ladder (480/960/1440/2048), generated in two indexing passes plus on-demand — replacing the old single fixed-400x400 thumbnail.",
      "owns": "Owns thumbnail bucket-file naming/layout, width-based (not bounding-box) sizing math, the eager base-480 pop-in pass and the separate eager higher-resolution bucket pre-warm pass (a second full-library rayon sweep, deliberately split so the base thumbnail never waits on the heaviest decode), ensure_variant's decode-on-cache-hit-never contract, generate_buckets' one-decode-many-buckets contract, and the get_thumbnail(id, target_px) IPC command's ladder-resolution + never-upscale contract. Does NOT own the SQL update itself, full-resolution rendering, or the frontend's bucket-selection policy (useAdaptiveThumbnail).",
      "files": [
        "mod.rs - pub use generator::ThumbnailGenerator",
        "generator.rs - width-based size_for_width; generate_thumbnail (base 480); ensure_variant (on-demand single bucket); generate_buckets (eager multi-bucket from one decode); scaled-IDCT JPEG decode + fast_image_resize NEON Lanczos3"
      ],
      "state": [
        "THUMBNAIL_BUCKETS = [480,960,1440,2048]",
        "thumbnails/root_<id>/thumb_<id>[_<bucket>].jpg layout",
        "ThumbnailGenerator"
      ],
      "_stale": true
    },
    {
      "id": "model_download",
      "label": "model-download",
      "kind": "boundary",
      "layer": 2,
      "root": "apps/lynceus/src-tauri/src/model_download.rs",
      "tagline": "First-launch fetch of encoder weights (now OpenCLIP LAION for commercial licensing) from HuggingFace, per-file fail-soft — now a fallback behind a repo-tree fetch script and LYNCEUS_MODELS_DIR.",
      "owns": "Owns the seven download URLs/filenames across three encoder families (CLIP constants live here; DINOv2/SigLIP-2 constants live in their own encoder modules), the HEAD-preflight + chunked-GET + progress-callback fetch. CLIP now points at OpenCLIP LAION (immich-app/ViT-B-32__laion2b-s34b-b79k, MIT) replacing the non-commercial OpenAI/Xenova export. As of the 2026-07 commercialisation refactor this in-app downloader is the FALLBACK path — scripts/download_models.py fetches all seven files into a gitignored repo-local models/ tree that LYNCEUS_MODELS_DIR points paths::models_dir() at first, for dev + eventual .app-bundle use. Does NOT own where weights resolve at runtime (paths::models_dir owns that resolution order).",
      "files": [
        "model_download.rs - first-launch HF download (HEAD preflight + chunked GET + progress); OpenCLIP LAION CLIP URLs; per-file fail-soft; .part + rename, no resume yet"
      ],
      "state": [
        "encoder weight URLs (7 files, 3 families)",
        "clip_vision/clip_text/clip_tokenizer filenames (OpenCLIP LAION source)",
        "models/{image,audio,3d}/ repo tree (populated by the sibling Python script, not this file)"
      ],
      "_stale": true
    },
    {
      "id": "clip_image_encoder",
      "label": "clip-image-encoder",
      "kind": "learner",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder.rs",
      "tagline": "OpenCLIP LAION-2B ViT-B/32 image encoder producing 512-d L2-normalised embeddings, deliberately excluded from the batch-inference work because its export has a fixed batch dim of 1.",
      "owns": "Owns image preprocessing (224 bicubic-shortest-edge + centre-crop + CLIP-native mean/std via the shared preprocess.rs helper), ONNX session lifecycle (CPU-only on macOS, CoreML disabled — confirmed runtime-inference failures, not just compile-time capability checks), and the per-image encode_batch (chunked preprocessing at 32, but ONE [1,3,224,224] inference per image, NOT a stacked [N,...] call — the export's fixed batch-dim-1 makes true batching error with 'Got invalid dimensions'). Writes via db.upsert_embeddings_batch('clip_vit_b_32', rows, legacy_clip_too=false) — the legacy images.embedding column is no longer written (R8) and the needs-set query reads the per-encoder table, not the stale legacy column. Does NOT own text encoding or fusion ranking.",
      "files": [
        "encoder.rs - ClipImageEncoder via ort; 224 bicubic-shortest-edge + centre-crop, CLIP mean/std, per-image inference only (fixed batch-dim-1 export), L2-normalise"
      ],
      "state": [
        "512-d CLIP image embedding",
        "clip_vision.onnx (OpenCLIP LAION, I/O names image/embedding, fixed batch dim 1)",
        "per-encoder needs-set query (get_images_without_embedding_for)"
      ],
      "_stale": true
    },
    {
      "id": "clip_text_encoder",
      "label": "clip-text-encoder",
      "kind": "learner",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_text/",
      "tagline": "OpenCLIP LAION-2B ViT-B/32 text encoder: CLIP BPE tokeniser, 512-d shared space, single int32 'text' input with no attention_mask.",
      "owns": "Owns ClipTextEncoder: HF tokenizers BPE (49408 vocab, max 77, pad id 49407), the separate clip_text.onnx (immich-app OpenCLIP export — single int32 'text' input, no attention_mask; renamed from the old Xenova export's input_ids/int64/text_embeds contract), 512-d L2-normalised output, lazy + pre-warmed init, and tokenizer_for_diagnostic() for the tokenizer_output perf diagnostic. Does NOT own image encoding or cosine ranking.",
      "files": [
        "mod.rs - pub use ClipTextEncoder",
        "encoder.rs - ClipTextEncoder via HF tokenizers BPE; single int32 'text' input, no attention_mask; CoreML off; tokenizer_for_diagnostic()",
        "pooling.rs - normalize (LIVE, shared by every encoder); try_extract_single_embedding + mean_pool (verified dead — no callers)"
      ],
      "state": [
        "512-d CLIP text embedding",
        "clip_text.onnx (OpenCLIP LAION, int32 'text' input, no attention_mask)",
        "clip_tokenizer.json"
      ],
      "_stale": true
    },
    {
      "id": "dinov2_encoder",
      "label": "dinov2-encoder",
      "kind": "learner",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_dinov2.rs",
      "tagline": "DINOv2-Base (Meta, Apache-2.0) self-supervised image-only encoder, 768-d, now with a batched encode_batch override for true [N,3,224,224] inference.",
      "owns": "Owns Dinov2ImageEncoder: 224 bicubic-shortest-edge-256 + centre-crop-224, ImageNet mean/std, CLS token from last_hidden_state, 768-d L2-normalised, image-only. The T2-3 batch-inference override runs one [N,3,224,224] session call per 32-chunk (the export's dynamic batch dim makes this safe, unlike CLIP's fixed-1), preserving the trait default's whole-chunk failure semantics exactly (no per-image isolation added), verified equivalent to serial encode at cosine >= 0.9999996. Does NOT do text.",
      "files": [
        "encoder_dinov2.rs - Dinov2ImageEncoder; resize-256 + centre-crop-224, ImageNet stats, CLS slice, 768-d; T2-3 batched encode_batch override, one [N,3,224,224] call per 32-chunk"
      ],
      "state": [
        "768-d DINOv2 image embedding",
        "dinov2_base_image.onnx (dynamic batch dim)",
        "batched [N,3,224,224] inference path"
      ],
      "_stale": true
    },
    {
      "id": "siglip2_encoder",
      "label": "siglip2-encoder",
      "kind": "learner",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_siglip2.rs",
      "tagline": "SigLIP-2 Base 256 (Google, Apache-2.0) image+text in a shared 768-d space; image branch batched (T2-3), text branch now wired into text-image RRF fusion (Phase 11d).",
      "owns": "Owns Siglip2ImageEncoder + Siglip2TextEncoder: image 256x256 exact-square bilinear + [-1,1] (no crop — the only encoder that sees the whole image); text Gemma SentencePiece 64 tokens, no attention_mask; both use pooler_output (MAP head), 768-d shared space. Image branch has a T2-3 batched encode_batch override (one [N,3,256,256] call per chunk, dynamic-batch export). Text branch is dispatched from get_fused_semantic_search (Phase 11d, implemented not speculative) alongside CLIP via TEXT_CAPABLE_ENCODERS, fused via RRF — DINOv2 has no text branch and is implicitly excluded from text-image fusion. Does NOT share preprocessing with CLIP/DINOv2.",
      "files": [
        "encoder_siglip2.rs - Siglip2ImageEncoder + Siglip2TextEncoder; 256 exact-square + [-1,1]; Gemma SP 64 tokens no mask; pooler_output 768-d; T2-3 batched image encode_batch override"
      ],
      "state": [
        "768-d SigLIP-2 shared embedding",
        "siglip2_vision.onnx / siglip2_text.onnx / siglip2_tokenizer.json",
        "batched [N,3,256,256] inference path (image branch only)"
      ],
      "_stale": true
    },
    {
      "id": "multi_encoder_fusion",
      "label": "multi-encoder-fusion",
      "kind": "boundary",
      "layer": 4,
      "root": "crates/engine/src/cosine/rrf.rs",
      "tagline": "Reciprocal Rank Fusion across CLIP + SigLIP-2 + DINOv2 for image-image AND text-image retrieval — now the ONLY resident embedding cache in the app.",
      "owns": "Owns the RRF algorithm (Cormack 2009, k=60, engine's cosine/rrf.rs, ID-native RankedList.items: Vec<(i64,f32)>), and FusionIndexState (Arc<RwLock<HashMap<String, CosineIndex>>>) — the sole per-encoder cache every search command (single-encoder and fused alike) now borrows via double-checked read/write locking (a burst of concurrent warm-slot queries scores under a shared read lock, only a miss escalates to write). Owns the cache lifecycle: populate prefers the persisted mmap flat store over a DB rebuild, spawn_cache_warm pre-populates every enabled encoder at launch on its own thread, the indexing pipeline's step 7 token-gated refresh_if_stale + re-persists stale slots, and invalidate_all() clears every slot on root mutation. get_fused_semantic_search (text-image RRF, Phase 11d) is implemented, not speculative. Does NOT own the per-encoder cosine math itself (cosine_similarity) — it fuses and caches its outputs. The primary CosineIndexState this file previously also described is REMOVED ENTIRELY (1514a90).",
      "files": [
        "rrf.rs - Reciprocal Rank Fusion (Cormack 2009, k=60); ID-native RankedList; 6 unit tests"
      ],
      "state": [
        "RRF fusion (k=60)",
        "FusionIndexState.per_encoder (Arc<RwLock<HashMap<String,CosineIndex>>>) — sole resident cache",
        "TEXT_CAPABLE_ENCODERS = [clip_vit_b_32, siglip2_base]"
      ],
      "_stale": true
    },
    {
      "id": "cosine_similarity",
      "label": "cosine-similarity",
      "kind": "foundation",
      "layer": 4,
      "root": "crates/engine/src/cosine/",
      "tagline": "Per-encoder FlatStore embedding storage and cosine scoring — ID-native, mmap-persisted, generation-token-gated, with no resident 'primary' cache of its own anymore.",
      "owns": "Owns the per-encoder FlatStore (id column + inverse-norm column + one contiguous row-major f32 block, heap-owned or zero-copy mmap-backed), the cosine math (dot x q_inv x c_inv, cached norms, no per-call sqrt), the three ID-native retrieval modes (diversity-sampled, strict-sorted, 7-tier — all built on the shared rayon-parallel score_all scan), the embedding_generation_token freshness check (FNV fold of COUNT/SUM/MAX(rowid) over the enabled/orphaned JOIN, replacing a bare-mtime check that silently served stale populations at scale), and the versioned embstore_<encoder>.bin mmap persistence format (64-byte header, atomic temp-file+rename writes, native-little-endian by construction — a documented cross-arch landmine, not an oversight). Does NOT own cache lifetime/lock discipline across encoders (that's multi_encoder_fusion's job — CosineIndex itself has no lock) or which encoder(s) are active. The primary CosineIndexState this file previously documented is REMOVED ENTIRELY (1514a90) — its removal also fixed a latent post-index staleness regression the removal work itself had introduced upstream.",
      "files": [
        "mod.rs - pub use index::CosineIndex + pub use store::FlatStore + pub mod rrf",
        "math.rs - dot_slice + inv_norm (cached) + cosine_similarity_slice (reference, non-hot-path) + score_cmp_desc",
        "store.rs - FlatStore: dim, ids, inv_norms, block (Owned|Mapped); push_owned/from_parts/row(r)",
        "index.rs - CosineIndex {cached_images: FlatStore, encoder_id, gen_token} + populate_from_db_for_encoder + refresh_if_stale + score_all (rayon scan) + 3 retrieval methods",
        "diagnostics.rs - embedding_stats, pairwise_distance_distribution, self_similarity_check, score_distribution_stats — now take &FlatStore",
        "cache.rs - save_to_disk/save_store_for/save_store_to/load_store_if_valid, memmap2-backed, 7 disk-persistence tests"
      ],
      "state": [
        "FlatStore{ids, inv_norms, block} per encoder",
        "embstore_<encoder>.bin mmap files",
        "embedding_generation_token (per encoder, FNV fold)"
      ],
      "_stale": true
    },
    {
      "id": "database",
      "label": "database",
      "kind": "foundation",
      "layer": 4,
      "root": "crates/engine/src/db/",
      "tagline": "SQLite/WAL catalogue: 6-table schema, per-encoder embeddings, dual writer/read-only connections, batched writes, and the compact feed manifest + per-id detail split that replaced the tag-joined full catalogue query.",
      "owns": "Owns the engine's ImageDatabase: 6-table schema (roots, images, tags, images_tags, embeddings, meta) + two composite indexes (root/orphaned R9, reverse tag idx_images_tags_tag), WAL+NORMAL+busy_timeout+wal_autocheckpoint=0+FK pragmas, bytemuck embedding BLOB encoding, the read-only secondary connection (R2, foreground SELECTs) + checkpoint_passive (R3, manual WAL drain between encoder batches), batched writers (add_images_batch T2-2, upsert_embeddings_batch R1, both BEGIN IMMEDIATE with mandatory per-row fallback), get_feed_manifest + get_image_details_by_ids (T3-1, the live main-feed read path — get_images/get_images_with_thumbnails are wire-compat only, zero live frontend callers), embedding_generation_token (T3-2/#8), and manual_order/manual_col_span persistence (manual_order is backend-only, zero frontend callers since the v2 masonry split; manual_col_span is fully wired). Media-agnostic. Does NOT own domain semantics of what is stored.",
      "files": [
        "mod.rs - ImageDatabase + WAL/NORMAL/busy_timeout/FK pragmas + 2 composite indexes + CREATE TABLE flow",
        "schema_migrations.rs - idempotent ALTER migrations + migrate_embedding_pipeline_version + migrate_add_roots_bookmark_column + migrate_add_manual_order_columns",
        "images_query.rs - aggregate_image_rows + get_images* + get_feed_manifest + get_image_details_by_ids (T3-1) + embedding_generation_token (T3-2/#8) + AND/OR/exclude tag SQL; largest submodule (1480 lines)",
        "embeddings.rs - bytemuck cast_slice; upsert_embeddings_batch (R1); get_all_embeddings_for / get_images_without_embedding_for (per-encoder surface)",
        "manual_layout.rs - set_manual_order (backend-only) + set_manual_col_span (live, drag-resize persist)",
        "tags.rs - create/delete/get tags + get_tag_counts (library drawer)",
        "thumbnails.rs - update_image_thumbnail, get_image_thumbnail_info",
        "roots.rs - roots CRUD (+ bookmark BLOB) + migrate_legacy_scan_root + wipe_images_for_new_root",
        "notes_orphans.rs - add_image + add_images_batch (T2-2) + get/set notes + mark_orphaned (chunked UPDATE)",
        "test_helpers.rs - fresh_db() for per-submodule tests"
      ],
      "state": [
        "images.db (WAL)",
        "6 tables (roots, images, tags, images_tags, embeddings, meta) + 2 composite indexes",
        "writer (Mutex<Connection>) + read-only secondary (OnceLock<Mutex<Connection>>)",
        "FeedManifestRow / ImageData"
      ],
      "_stale": true
    },
    {
      "id": "paths_and_state",
      "label": "paths-and-state",
      "kind": "foundation",
      "layer": 4,
      "root": "crates/engine/src/paths.rs",
      "tagline": "Single source of truth for every on-disk location: app-data dir, dual-resolution models dir (LYNCEUS_MODELS_DIR-first), thumbnails, exports — plus two now-orphaned helpers left over from the ID-native search rewrite.",
      "owns": "Owns the engine's paths::*_dir() helpers resolving under com.ataca.lynceus (LYNCEUS_DATA_DIR override), models_dir() (checks LYNCEUS_MODELS_DIR first for the repo-local dev tree, then falls back to app-data models/), and the product's settings.rs (legacy single-folder scan_root + enabled_encoders). strip_windows_extended_prefix and cosine_cache_path() are still defined and still compile, but have ZERO production callers — confirmed by repo-wide grep — since the ID-native search rewrite (1514a90) removed the path-resolution step both existed for; left in place rather than deleted, flagged as dead-code-sweep candidates. Does NOT own what is written to those paths.",
      "files": [
        "paths.rs (engine) - app-data + dual-resolution models-dir; LYNCEUS_DATA_DIR + LYNCEUS_MODELS_DIR overrides; strip_windows_extended_prefix (orphaned) + cosine_cache_path (orphaned)",
        "settings.rs (product, apps/lynceus/src-tauri/src/) - Settings{scan_root, priority_image_encoder legacy, enabled_encoders} pre-multifolder + Phase 11c encoder picks"
      ],
      "state": [
        "<app_data>/ layout",
        "BUNDLE_ID com.ataca.lynceus",
        "LYNCEUS_DATA_DIR / LYNCEUS_MODELS_DIR overrides",
        "settings.json",
        "orphaned: strip_windows_extended_prefix, cosine_cache_path — zero production callers"
      ],
      "_stale": true
    },
    {
      "id": "profiling",
      "label": "profiling",
      "kind": "observer",
      "layer": 4,
      "root": "crates/engine/src/perf.rs",
      "tagline": "Opt-in span timing + domain diagnostics, dormant unless --profiling is set; on-exit markdown report. Verified byte-for-byte unchanged this round except a diagnostics.rs FlatStore signature migration.",
      "owns": "Owns the engine's PerfLayer (tracing Layer, per-span aggregate stats, RawEvent log, JSONL flush thread), the 1Hz RSS/CPU system sampler, record_diagnostic, and the on-exit report renderer. The four cosine/diagnostics.rs stateless helpers now take &FlatStore instead of the old &Vec<(PathBuf, Array1<f32>)> — same algorithms (L2 norms, dim means/vars, pairwise cosine buckets, self-similarity), same output shape; the one payload difference is embedding_stats' sample-embedding tag switching from 'path' to 'image_id' to match the ID-native rewrite. The product mounts it only when --profiling is set; off by default = zero overhead (one tracing dispatch per call, no aggregator registers). Read-only observer of every other subsystem.",
      "files": [
        "perf.rs (engine) - PerfLayer, per-span stats, RawEvent log, JSONL flush thread, spawn_system_sampler_thread",
        "perf_report.rs (engine) - on-exit markdown report; section_stall_analysis + section_resource_trends"
      ],
      "state": [
        "PerfLayer",
        "RawEvent log",
        "perf-<ts>/{timeline.jsonl,report.md,raw.json}",
        "record_diagnostic + diagnostics.rs (now FlatStore-based)"
      ],
      "_stale": true
    },
    {
      "id": "multi_folder_roots",
      "label": "multi-folder-roots",
      "kind": "env",
      "layer": 2,
      "root": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "tagline": "Multiple watched library folders with per-root enable, migration, macOS security-scoped bookmarks, and thumbnail isolation.",
      "owns": "Owns the roots lifecycle: the roots table (+ nullable bookmark BLOB column, idempotent migrate_add_roots_bookmark_column), the engine db/roots.rs CRUD (ON DELETE CASCADE), the product commands/roots.rs (set_scan_root replace-all semantic, no live frontend caller, vs add_root/remove_root/set_root_enabled granular semantics, live UI), migrate_legacy_scan_root, per-root thumbnail directories via paths, and the macOS security-scoped-bookmark wiring (create_bookmark/start_accessing/stop_accessing around root mutations — FFI round-trip proven outside a sandbox, real sandboxed enforcement NOT yet verified, a pre-sale checklist item). Fusion invalidation now calls FusionIndexState::invalidate_all() on remove/enable-toggle (add_root deliberately does NOT invalidate — nothing stale to clear until the new root's images are actually encoded). Does NOT own the watch itself (known gap: not rebuilt on add_root/remove_root) or the Cocoa bookmark API's own FFI (security_scope.rs, 3 free functions, no roots-table awareness).",
      "files": [
        "roots.rs (product commands/) - get_scan_root, set_scan_root, list_roots, add_root, remove_root, set_root_enabled; security-scoped bookmark create/release; fusion_state.invalidate_all() on remove/toggle",
        "roots.rs (engine db/) - roots CRUD (+ bookmark BLOB) + migrate_legacy_scan_root + wipe_images_for_new_root"
      ],
      "state": [
        "roots table (+ bookmark BLOB)",
        "enabled flag",
        "per-root thumbnail dirs",
        "macOS security-scoped bookmarks (unverified under a real sandboxed build)"
      ],
      "_stale": true
    },
    {
      "id": "search_routing",
      "label": "search-routing",
      "kind": "boundary",
      "layer": 5,
      "root": "apps/lynceus/src/pages/",
      "tagline": "Frontend priority router over a three-tier chain (similar > semantic > manifest-filtered feed) built on the compact manifest, with seed-then-upgrade selection and one shared search-bar/library-drawer filter.",
      "owns": "Owns the catch-all route's priority resolution (similar / semantic / the manifest-driven feed, tag-or-exclude-scoped — collapsed from a four-tier to a three-tier chain since 'tag filter' and 'all images' are the SAME useFeedManifest call at different filter-argument values), the URL-slug seed-then-upgrade selection reconciliation (a load-bearing early-return guard prevents an infinite selectedItem<->displayImages oscillation), the 300ms semantic-search debounce, the shared searchTags/excludeTags state (search bar and library drawer are ONE filter, not two — exitToFeed() enforces 'a filter always acts on what you can see'), the similarity breadcrumb trail (simTrail, back-hop + rewind-to-index), and shuffle-seed/session-order coordination that re-rolls only on a genuine feed re-entry. Does NOT own any IPC, the cache/entity model, the manifest/delta wire contract, the shuffle ordering itself (useShuffledFeed), or Masonry rendering.",
      "files": [
        "pages/[...slug].tsx - catch-all route; three-tier priority chain; seed-then-upgrade selection; shared searchTags/excludeTags; similarity breadcrumb trail; shuffle-seed/session-order coordination; global keyboard shortcuts"
      ],
      "state": [
        "selection URL slug",
        "three-tier priority chain (similar > semantic > manifest feed)",
        "searchTags / excludeTags (one shared include/exclude filter)",
        "simTrail (similarity breadcrumb trail)",
        "shuffleSeed / sessionOrder"
      ],
      "_stale": true
    },
    {
      "id": "masonry_layout",
      "label": "masonry-layout",
      "kind": "observer",
      "layer": 5,
      "root": "apps/lynceus/src/components/",
      "tagline": "Off-main-thread Pinterest-style masonry: shortest-column packing in a Web Worker over typed arrays, hero promotion, viewport virtualization, and hand-rolled drag-to-reorder + drag-to-resize — no more 3D tilt.",
      "owns": "Owns column-count computation, the shortest-column packing algorithm (computeMasonryGeometry, a typed-array-only numeric core run identically on- or off-thread — computeMasonryLayout is a thin object-decorator over it), hero promotion for the selected item (up to 3 columns), viewport virtualization with a guard band (placement objects materialise only for the visible window plus a 240-item first-paint prefix), the drag-to-reorder pointer state machine (O(1) id->index map, live in-session order, NEVER persisted), the drag-to-resize state machine (continuous pixel tracking, not quantized; persists manual_col_span on release), and the v2 accent corner-bracket resize affordance (the 3D-tilt hover + amber brackets were removed outright, not reskinned — they caused a 'yellow line' edge flare). Does NOT own the image data itself, modal opening, tag/notes editing, or reorder/resize persistence semantics beyond firing onReorder/onResizeCommit once.",
      "files": [
        "Masonry.tsx - thin composition shell wiring the three hooks + shared refs",
        "MasonryItem.tsx - per-tile renderer, custom scalar comparator, v2 accent corner brackets",
        "MasonryAnchor.tsx - absolute-positioned wrapper",
        "masonryPacking.ts - pure geometry core (computeMasonryGeometry) + object-placement decorator (computeMasonryLayout)",
        "masonryPacker.ts / masonryWorker.ts - off-thread packer client + Worker entry, with a synchronous fallback",
        "masonryReorder.ts - pure id->index map maintenance for O(1) drag hover-swap"
      ],
      "state": [
        "MasonryGeometry (flat typed arrays: xs, ys, widths, heights, spans)",
        "Web Worker packer + sync fallback",
        "in-session drag order (unpersisted)",
        "manual_col_span (persisted per image)"
      ],
      "_stale": true
    },
    {
      "id": "tag_system",
      "label": "tag-system",
      "kind": "boundary",
      "layer": 5,
      "root": "apps/lynceus/src/components/",
      "tagline": "Tag CRUD, optimistic mutations, AND/OR/exclude filter semantics, and three UI surfaces — search-bar autocomplete, per-image TagDropdown, and the folders-as-tags library drawer with live per-folder counts.",
      "owns": "Owns the 6 tag Tauri commands including get_tag_counts (library-drawer per-folder visible counts, using the identical visibility predicate as the grid/manifest queries so a folder's number always matches what opening it shows), the exclude_tag_ids NOT EXISTS clause (the drawer's third boolean filter dimension, composable with the include OR/AND set), the SearchBar # autocomplete + create-on-no-match, TagDropdown, and the canonical optimistic add/remove/create/delete mutation pattern (cancelQueries -> snapshot -> optimistic -> onError rollback -> onSuccess/onSettled invalidate). Does NOT own the tag SQL itself, the AND/OR/exclude SQL (delegates to database), or the library drawer's own component tree / priority-chain wiring (delegates to search_routing).",
      "files": [
        "SearchBar.tsx - # autocomplete + tag pills + create/delete affordances",
        "TagDropdown.tsx - popover combobox (cmdk)",
        "library-drawer/ - folders-as-tags UI, include/exclude toggles, per-folder counts (component tree owned jointly with search_routing)"
      ],
      "state": [
        "tag pills",
        "AND/OR/exclude filter state (searchTags/excludeTags, shared with search_routing)",
        "get_tag_counts per-folder counts",
        "optimistic tag mutations"
      ],
      "_stale": true
    },
    {
      "id": "frontend_state",
      "label": "frontend-state",
      "kind": "env",
      "layer": 5,
      "root": "apps/lynceus/src/queries/",
      "tagline": "TanStack Query cache split into a manifest/detail entity model, localStorage preferences (sortMode retired), and the singleton useIndexingStatus event listener that replaced per-mount duplicated subscriptions.",
      "owns": "Owns queryClient (staleTime Infinity, no auto-refetch), the manifest/detail entity model (['feed-manifest', tagIds, matchAllTags, excludeTagIds] compact geometry + ['image-detail', id] hydrated-on-demand, replacing the old monolithic ['images', ...] cache — see feed_protocol for the wire contract), useUserPreferences (localStorage; the sortMode field is gone entirely — the feed is unconditionally shuffled, SortSection.tsx deleted), the singleton useIndexingStatus module (ONE Tauri listener for both indexing-progress AND feed-delta, primitive-slice exports usePipelineStats/useIsIndexing/useIndexingPhase via useSyncExternalStore so a churning message string only ever re-renders the pill, never the grid — useIndexingProgress is RETIRED as an importable per-mount hook, fixing the verified render-storm), useRoots + mutations, and the settings drawer's 9-section split. zustand is fully removed from package.json — it was declared-but-unused at the last audit and has since been dropped. Does NOT own the manifest/delta wire contract itself (feed_protocol owns the cross-boundary shapes) or per-page UI state.",
      "files": [
        "queries/ - useFeedManifest + useImageDetail + prefetchImageDetails (useImages.ts), useTags, useRoots, useSimilarImages (fused-RRF backed), useSemanticSearch (5-min staleTime)",
        "hooks/useIndexingStatus.ts - singleton listener (indexing-progress + feed-delta), useSyncExternalStore primitive-slice exports, replaces the retired useIndexingProgress",
        "hooks/ - useDebouncedValue, useUserPreferences (no sortMode)",
        "components/settings/ - 9-section drawer split (SortSection deleted; EncoderSection + StatsSection are the growth)",
        "services/ - invoke() wrappers translating Tauri JSON to UI types via ApiError"
      ],
      "state": [
        "QueryClient cache (manifest/detail entity split)",
        "useUserPreferences (localStorage, sortMode removed)",
        "useIndexingStatus singleton listener (module-level event state)",
        "settings drawer (9 sections)"
      ],
      "_stale": true
    },
    {
      "id": "gesture_timer",
      "label": "gesture-timer",
      "kind": "observer",
      "layer": 5,
      "root": "apps/lynceus/src/features/gesture-timer/",
      "tagline": "A figure-drawing practice mode: cycles through similar images on a fixed interval starting from an inspected image, entered via inline setup in the inspector or a hero-tile quick-start pill.",
      "owns": "Owns session sequencing (which image is current, how the sequence builds and advances — count-mode and continuous-without-repeat build the whole sequence upfront; continuous+repeat picks the next image randomly at advance time, a deliberate documented limit), interval countdown (performance.now()-anchored against drift, not a naive per-tick decrement), pause/resume/restart, the running fullscreen overlay (portal-mounted, auto-hiding controls), the inline setup UI (docked in the inspector's right panel) and the quick-start pill UI (overlaid on the selected hero tile) as two entry points into one shared config surface (session.ts's pure default/normalise/merge functions), and one-shot next-image predecode. Does NOT own where candidateImages comes from (delegates entirely to search_routing's tiered-similarity results, threaded through PinterestModal), the inspector panel it's docked inside, the hero tile it overlays (masonry_layout owns mounting heroOverlay), or tag/note persistence. Nothing in this subsystem persists to the backend — every session is ephemeral React state, gone once the view unmounts.",
      "files": [
        "session.ts - pure config defaults/normalise/merge + sequence building (createDefaultGestureTimerConfig, normaliseGestureTimerConfig, mergeGestureTimerConfig, getEligibleCandidates)",
        "useGestureTimer.ts - the running session's state machine (sequence, currentIndex, remainingMs, isComplete)",
        "GestureTimer.tsx - top-level orchestrator: config/draftConfig/running state, autoStart adoption effect, wires the three UI pieces",
        "GestureTimerSetup.tsx - inline setup UI (inspector right panel)",
        "GestureTimerView.tsx - the running fullscreen session (portal-mounted, one-deep predecode)",
        "GestureTimerConfigPanel.tsx - the running-session settings overlay",
        "GestureTimerProgress.tsx - circular countdown ring",
        "types.ts / index.ts - config types + public exports"
      ],
      "state": [
        "GestureTimerConfig (intervalSeconds, similarityRange, sessionLength, repeatAllowed)",
        "useGestureTimer session state (sequence, currentIndex, remainingMs, isComplete)",
        "sessionKey (forces clean remount on start/restart)"
      ],
      "_stale": true
    },
    {
      "id": "feed_protocol",
      "label": "feed-protocol",
      "kind": "boundary",
      "layer": 4,
      "root": "apps/lynceus/src/services/feedDelta.ts",
      "tagline": "The manifest+delta contract between the Rust backend and the React frontend: a compact geometry-only feed manifest with per-id lazy hydration, plus batched feed-delta events that patch the live feed during indexing without a full refetch.",
      "owns": "Owns the get_feed_manifest / get_image_details (backed by get_image_details_by_ids) command pair, the feed-delta Tauri event shape (FeedDeltaRow/FeedDeltaBatch, batched at 64 rows, terminal-flush ordered before the terminal Phase::Thumbnail progress emit so frontend phase-transition logic always runs after every delta lands), the ['feed-manifest', tagIds, matchAllTags, excludeTagIds] / ['image-detail', id] react-query entity model, mergeFeedDeltaRows (identity-preserving, patch-in-place at the existing array index with manualColSpan explicitly carried over, insert-sorted for newcomers via one linear merge), and the Phase::Ready full-reconcile backstop that makes the deliberately-lossy delta stream safe. Spans crates/engine/src/db/images_query.rs (manifest + hydration queries), apps/lynceus/src-tauri/src/indexing.rs (delta producer), and the frontend consumer trio services/feedDelta.ts + hooks/useIndexingStatus.ts + queries/useImages.ts — there is no single directory that holds this subsystem. Does NOT own the shuffle ordering applied on top of the manifest (frontend_state's useShuffledFeed), the masonry packing that consumes the ordered feed (masonry_layout), or the priority chain that decides whether the manifest or a search/similar result set drives the grid (search_routing) — this node owns only the wire contract those three build on.",
      "files": [
        "crates/engine/src/db/images_query.rs - get_feed_manifest (line ~798) + get_image_details_by_ids (line ~895); WHERE clause is a byte-faithful copy of the legacy predicate, test-locked (manifest_membership_matches_legacy_query)",
        "apps/lynceus/src-tauri/src/indexing.rs - FeedDeltaRow/FeedDeltaBatch types + emit_feed_delta (~line 131, 540-608); FEED_DELTA_BATCH=64",
        "apps/lynceus/src/services/feedDelta.ts - mergeFeedDeltaRows, UNFILTERED_MANIFEST_KEY",
        "apps/lynceus/src/hooks/useShuffledFeed.ts - the incremental fast path that consumes a delta-patched array under an unchanged shuffle seed (surviving half of a rejected fuller incremental-shuffle idea)",
        "apps/lynceus/src/queries/useImages.ts - useFeedManifest, useImageDetail, prefetchImageDetails"
      ],
      "state": [
        "FeedManifestRow / FeedItem",
        "FeedDeltaRow / FeedDeltaBatch (batch size 64)",
        "['feed-manifest', ...] / ['image-detail', id] cache keys",
        "UNFILTERED_MANIFEST_KEY"
      ],
      "_stale": true
    }
  ],
  "edges": [
    {
      "from": "search_routing",
      "to": "tauri_commands",
      "rel": "strong",
      "label": "invoke(get_fused_similar_images, get_fused_semantic_search) drives the similar/semantic tiers of displayImages; get_images/get_images_with_thumbnails is wire-compat only, no live caller"
    },
    {
      "from": "tag_system",
      "to": "tauri_commands",
      "rel": "dep",
      "label": "tag CRUD + AND/OR/exclude filter over invoke; get_tag_counts drives the library-drawer per-folder counts"
    },
    {
      "from": "frontend_state",
      "to": "tauri_commands",
      "rel": "dep",
      "label": "query hooks (useFeedManifest, useImageDetail, useTieredSimilarImages, useSemanticSearch, useRoots) call services/* invoke wrappers"
    },
    {
      "from": "masonry_layout",
      "to": "search_routing",
      "rel": "dep",
      "label": "receives displayImages (the active priority-chain tier) + selectedItem for hero promotion; tile w/h come from the manifest row, no DOM round-trip"
    },
    {
      "from": "tag_system",
      "to": "frontend_state",
      "rel": "dep",
      "label": "optimistic tag mutations invalidate [\\"feed-manifest\\"] and the touched [\\"image-detail\\", id] on settle (not [\\"images\\"] anymore)"
    },
    {
      "from": "frontend_state",
      "to": "indexing",
      "rel": "peer",
      "label": "the useIndexingStatus module-level singleton listener subscribes to indexing-progress; handleEvent invalidates [\\"pipelineStats\\"] every event and [\\"feed-manifest\\"]/[\\"fused-*\\"]/[\\"thumbnail\\"] on phase===ready"
    },
    {
      "from": "tauri_commands",
      "to": "database",
      "rel": "strong",
      "label": "every handler reads/writes ImageDatabase (WAL, read-only secondary via read_lock())"
    },
    {
      "from": "tauri_commands",
      "to": "multi_encoder_fusion",
      "rel": "strong",
      "label": "every search command (get_similar_images, get_tiered_similar_images, semantic_search, get_fused_similar_images, get_fused_semantic_search) borrows a FusionIndexState slot via with_encoder_index/ranked_for_encoder — the sole embedding-cache path since the primary CosineIndexState's removal (1514a90)"
    },
    {
      "from": "tauri_commands",
      "to": "clip_text_encoder",
      "rel": "dep",
      "label": "semantic_search locks TextEncoderState.encoder (CLIP slot), encodes the query"
    },
    {
      "from": "tauri_commands",
      "to": "siglip2_encoder",
      "rel": "dep",
      "label": "semantic_search/get_fused_semantic_search dispatch the SigLIP-2 text branch (TextEncoderState.siglip2_encoder) when text_encoder_id is siglip2_base"
    },
    {
      "from": "app_shell",
      "to": "tauri_commands",
      "rel": "strong",
      "label": "builder.invoke_handler![28+] mounts every command"
    },
    {
      "from": "app_shell",
      "to": "indexing",
      "rel": "dep",
      "label": "setup spawns the background pipeline via try_spawn_pipeline, passing FusionIndexState.per_encoder (not the removed primary Cosine Arc); also spawns spawn_cache_warm independently"
    },
    {
      "from": "app_shell",
      "to": "watcher",
      "rel": "dep",
      "label": "setup starts the watcher on every enabled root"
    },
    {
      "from": "app_shell",
      "to": "database",
      "rel": "strong",
      "label": "opens SQLite + initialize() (schema + WAL/NORMAL/FK pragmas + reverse tag index) before handing to run()"
    },
    {
      "from": "app_shell",
      "to": "profiling",
      "rel": "dep",
      "label": "mounts PerfLayer + on-Exit report only when --profiling set"
    },
    {
      "from": "indexing",
      "to": "filesystem_scanner",
      "rel": "dep",
      "label": "scans each enabled root for candidate image paths"
    },
    {
      "from": "indexing",
      "to": "thumbnail_pipeline",
      "rel": "dep",
      "label": "two-pass Phase::Thumbnail: base 480px pop-in pass (buffers FeedDeltaRow per success) then a separate eager 960/1440/2048 bucket pre-warm pass"
    },
    {
      "from": "indexing",
      "to": "clip_image_encoder",
      "rel": "write",
      "label": "run_clip_encoder_with_intra batches preprocessing at 32 but issues ONE [1,3,224,224] ONNX call per image (fixed batch-dim-1 export) -> embeddings BLOB write-back"
    },
    {
      "from": "indexing",
      "to": "dinov2_encoder",
      "rel": "write",
      "label": "run_trait_encoder(dinov2_base) true batched [N,3,224,224] ONNX inference per chunk (dynamic-batch export) -> per-encoder embeddings row"
    },
    {
      "from": "indexing",
      "to": "siglip2_encoder",
      "rel": "write",
      "label": "run_trait_encoder(siglip2_base) true batched [N,3,256,256] ONNX inference per chunk; also pre-warms Siglip2TextEncoder (Phase 12d) for the semantic-search text branch"
    },
    {
      "from": "indexing",
      "to": "clip_text_encoder",
      "rel": "dep",
      "label": "pre-warms ClipTextEncoder(clip_text.onnx, clip_tokenizer.json) into TextEncoderState.encoder to avoid first-query model-load latency"
    },
    {
      "from": "indexing",
      "to": "cosine_similarity",
      "rel": "dep",
      "label": "step 7 (Phase::Ready): CosineIndex::refresh_if_stale(db, encoder_id) recomputes the generation token and repopulates only on mismatch; on repopulate calls save_store_for to persist the flat mmap file"
    },
    {
      "from": "indexing",
      "to": "multi_encoder_fusion",
      "rel": "write",
      "label": "step 7 writes the refreshed/persisted per-encoder result back into FusionIndexState.per_encoder, one write lock per encoder released between encoders — replaces the removed primary-index populate"
    },
    {
      "from": "indexing",
      "to": "feed_protocol",
      "rel": "write",
      "label": "emit_feed_delta batches successfully-thumbnailed rows into feed-delta events (≤64 rows), terminal flush ordered before the terminal Phase::Thumbnail progress emit"
    },
    {
      "from": "indexing",
      "to": "model_download",
      "rel": "dep",
      "label": "phase 1 calls download_models_if_missing; missing files fetched from HuggingFace (OpenCLIP LAION for CLIP) with HEAD preflight + chunked GET"
    },
    {
      "from": "indexing",
      "to": "database",
      "rel": "strong",
      "label": "add_images_batch (256-path chunks, one BEGIN IMMEDIATE, serial fallback), mark_orphaned, get_paths_to_root_ids (single SELECT), upsert_embeddings_batch + checkpoint_passive per encoder chunk"
    },
    {
      "from": "watcher",
      "to": "indexing",
      "rel": "peer",
      "label": "debounced try_spawn_pipeline; single-flight AtomicBool coalesces bursts; a rescan this triggers ends in indexing's step-7 token-gated fusion refresh"
    },
    {
      "from": "multi_folder_roots",
      "to": "database",
      "rel": "dep",
      "label": "roots table CRUD + FK CASCADE on images.root_id; add_root now carries an Option<Vec<u8>> macOS security-scoped bookmark"
    },
    {
      "from": "multi_folder_roots",
      "to": "thumbnail_pipeline",
      "rel": "dep",
      "label": "per-root thumbnail dirs via paths::thumbnails_dir_for_root; remove_root rm -rfs the subfolder (now also sweeps every bucket file for free)"
    },
    {
      "from": "multi_folder_roots",
      "to": "multi_encoder_fusion",
      "rel": "write",
      "label": "set_scan_root/add_root/remove_root/set_root_enabled call FusionIndexState::invalidate_all(), clearing every per-encoder FlatStore slot (unmapping any mmap'd files); adding a root does NOT invalidate (nothing stale to clear until encoded)"
    },
    {
      "from": "multi_encoder_fusion",
      "to": "cosine_similarity",
      "rel": "dep",
      "label": "each FusionIndexState slot IS a CosineIndex; ranked_for_encoder scores under a shared read lock via CosineIndex's &self score_all rayon scan"
    },
    {
      "from": "multi_encoder_fusion",
      "to": "database",
      "rel": "dep",
      "label": "cold-slot populate calls db.get_embedding(image_id, encoder) for the query vector and db.get_all_embeddings_for(encoder_id) on a full repopulate; populate prefers load_store_if_valid (mmap) first"
    },
    {
      "from": "clip_image_encoder",
      "to": "database",
      "rel": "write",
      "label": "writes the 512-d embedding into the per-encoder embeddings table via upsert_embeddings_batch"
    },
    {
      "from": "model_download",
      "to": "paths_and_state",
      "rel": "dep",
      "label": "resolves target dir via models_dir() (LYNCEUS_MODELS_DIR first, else app-data models/)"
    },
    {
      "from": "database",
      "to": "paths_and_state",
      "rel": "dep",
      "label": "images.db path from app_data_dir()"
    },
    {
      "from": "cosine_similarity",
      "to": "paths_and_state",
      "rel": "dep",
      "label": "app_data_dir()/embstore_<encoder_id>.bin path resolution for the versioned per-encoder mmap store (replaces the single cosine_cache.bin path)"
    },
    {
      "from": "profiling",
      "to": "paths_and_state",
      "rel": "dep",
      "label": "exports/perf-<ts>/ path from paths"
    },
    {
      "from": "tauri_commands",
      "to": "profiling",
      "rel": "peer",
      "label": "record_user_action + record_diagnostic (no-op when profiling off)"
    },
    {
      "from": "thumbnail_pipeline",
      "to": "database",
      "rel": "write",
      "label": "update_image_thumbnail persists the base bucket path + w/h; get_thumbnail's 480-branch self-heals a missing base via the same call; get_image_source_for_thumbnail / get_paths_to_root_ids read the source path + root for bucket routing"
    },
    {
      "from": "feed_protocol",
      "to": "database",
      "rel": "dep",
      "label": "get_feed_manifest (byte-faithful copy of the legacy visibility predicate, no tags join) and get_image_details_by_ids (500-id chunked, id-sorted) are this protocol's read path (images_query.rs)"
    },
    {
      "from": "feed_protocol",
      "to": "frontend_state",
      "rel": "peer",
      "label": "the delta-consuming half (handleFeedDelta/applyBufferedDeltas) lives inside frontend_state's single useIndexingStatus module listener; feed_protocol owns the wire contract + cache-key shapes, frontend_state owns the one subscription both indexing-progress and feed-delta ride on"
    },
    {
      "from": "feed_protocol",
      "to": "masonry_layout",
      "rel": "dep",
      "label": "the shuffled/session-ordered FeedItem[] manifest is the items prop Masonry packs; mergeFeedDeltaRows' identity-preservation is what lets MasonryItem's memo comparator and the worker pack skip re-render/re-pack on an untouched entry"
    },
    {
      "from": "feed_protocol",
      "to": "search_routing",
      "rel": "dep",
      "label": "useFeedManifest + useShuffledFeed form the base/all tier (tag-or-exclude-filtered collapses into the same call) of the displayImages priority chain; useImageDetail drives the seed-then-upgrade selection dance"
    },
    {
      "from": "gesture_timer",
      "to": "search_routing",
      "rel": "dep",
      "label": "candidateImages (tiered-similarity results) + startingImage come from the route; pendingTimerStart/handlePillStart plumbing and the selection-change effect that clears a stale autoStart config both live in pages/[...slug].tsx"
    },
    {
      "from": "gesture_timer",
      "to": "masonry_layout",
      "rel": "dep",
      "label": "SelectedImageTimerPill mounts as the heroOverlay prop on the selected hero tile only, revealed via masonry's data-selected-hero CSS hook; heroOverlay is compared by reference in MasonryItem's memo so the route must memoise the pill element"
    },
    {
      "from": "masonry_layout",
      "to": "frontend_state",
      "rel": "dep",
      "label": "useUserPreferences (columnCount override, tileScale, animationLevel) feeds buildPackInput; MasonryItem's custom memo comparator absorbs the fresh-object-per-refetch identity churn TanStack Query hands back on every background manifest refetch"
    }
  ],
  "kindMeta": {
    "entry": {
      "label": "Entry point",
      "swatch": "neutral"
    },
    "foundation": {
      "label": "Foundation",
      "swatch": "slate"
    },
    "env": {
      "label": "Environment truth",
      "swatch": "cyan"
    },
    "boundary": {
      "label": "Control boundary",
      "swatch": "teal"
    },
    "learner": {
      "label": "Learner",
      "swatch": "violet"
    },
    "observer": {
      "label": "Observer (read-only)",
      "swatch": "amber"
    }
  },
  "layers": [
    {
      "name": "Frontend (React 19)",
      "role": "search_routing, tag_system, masonry_layout, frontend_state — UI, routing, caching; talks to the backend only through typed service wrappers over Tauri invoke/events."
    },
    {
      "name": "IPC boundary",
      "role": "tauri_commands — the 28-command typed surface; every handler returns Result<T, ApiError>. The only place frontend and backend meet."
    },
    {
      "name": "Product orchestration",
      "role": "app_shell, indexing, watcher, model_download, multi_folder_roots — Lynceus-specific wiring: state singletons, the background pipeline, the fs watcher, weight fetching, folder lifecycle."
    },
    {
      "name": "Product encoders",
      "role": "clip_image_encoder, clip_text_encoder, dinov2_encoder, siglip2_encoder, thumbnail_pipeline, filesystem_scanner — the image-specific media processing that turns files into embeddings + thumbnails."
    },
    {
      "name": "Mnemosyne engine",
      "role": "database, cosine_similarity, multi_encoder_fusion, paths_and_state, profiling — the media-agnostic catalogue, ranking, path resolution and profiling reused across future verticals."
    }
  ],
  "layersNote": "The engine/product boundary is enforced by a path-dependency (no frozen API) and a re-export facade: apps/lynceus/src-tauri/src/lib.rs does pub use mnemosyne::{db,image_struct,paths,perf,perf_report,root_struct,tag_struct} and similarity_and_semantic_search/mod.rs re-exports mnemosyne::{cosine,cosine_similarity}, so in-crate crate::db / crate::paths / crate::cosine call sites resolve unchanged after the pure-move extraction. profiling is the exception to strict layering — it observes every layer via tracing spans but must stay read-only (zero overhead when --profiling is absent). Domain row types (image_struct/root_struct/tag_struct) keep image-era names in the engine until a second product (Syrinx audio, Daedalus 3D) generalises them.",
  "dataFlow": {
    "intro": "The traced operation is feed render: the default no-selection/no-search tier of the priority chain, from app launch through the first painted masonry tile, plus the live delta merge indexing performs against the same manifest cache while a scan is running. This replaces the pre-round trace (semantic search over the retired full-catalogue join and the now-deleted CosineIndexState), because feed render is the actual steady-state hot path post the 100k round: T3-1 (012012c) replaced the tags-joined full-catalogue fetch with a compact, no-join manifest plus batched feed-delta events, and T3-3 moved the masonry pack itself off the main thread into a Vite worker over typed arrays. The trace crosses the route priority-chain decision, the compact-manifest IPC round-trip (with root/orphan and tag scoping folded inline), the stable-key shuffle's incremental fast path, the off-thread geometry pack with its synchronous first-paint prefix and generation-tagged suffix swap, the visible-window materialisation that finally renders a tile, and how a live indexing run's batched feed-delta events merge into the same cache identity-preservingly without a re-render storm.",
    "simsets": [
      "Manifest",
      "Shuffle",
      "Pack",
      "Paint",
      "Delta"
    ],
    "steps": [
      {
        "n": 1,
        "sys": "app_shell",
        "fn": "React root mount / QueryClient bootstrap",
        "set": "Manifest",
        "reads": "launch args, window chrome",
        "writes": "React root mounted; TanStack QueryClient created",
        "fail": false
      },
      {
        "n": 2,
        "sys": "search_routing",
        "fn": "Home route ([...slug].tsx) priority-chain resolution",
        "set": "Manifest",
        "reads": "selectedItem=null, searchText='', searchTags/excludeTags",
        "writes": "no similar/semantic tier active -> the all/tag-filtered tier drives displayImages via useFeedManifest({tagIds, matchAllTags, excludeTagIds})",
        "fail": false
      },
      {
        "n": 3,
        "sys": "feed_protocol",
        "fn": "useFeedManifest -> fetchFeedManifest",
        "set": "Manifest",
        "reads": "tagIds, matchAllTags, excludeTagIds",
        "writes": "invoke('get_feed_manifest', args) over IPC",
        "fail": false
      },
      {
        "n": 4,
        "sys": "tauri_commands",
        "fn": "commands::images::get_feed_manifest",
        "set": "Manifest",
        "reads": "invoke args",
        "writes": "dispatches to ImageDatabase::get_feed_manifest",
        "fail": false
      },
      {
        "n": 5,
        "sys": "database",
        "fn": "ImageDatabase::get_feed_manifest (images_query.rs:798)",
        "set": "Manifest",
        "reads": "images/roots/images_tags rows under the byte-faithful-to-legacy root/orphan + include/exclude predicate",
        "writes": "Vec<FeedManifestRow> id-ascending, no tags join, no notes, no original path",
        "fail": true
      },
      {
        "n": 6,
        "sys": "multi_folder_roots",
        "fn": "root enabled/orphan visibility predicate",
        "set": "Manifest",
        "reads": "roots.enabled, images.orphaned, images.root_id",
        "writes": "applied inline inside the manifest SQL's WHERE/EXISTS clause -- no separate query, no separate round-trip",
        "fail": false
      },
      {
        "n": 7,
        "sys": "tag_system",
        "fn": "include/exclude tag scoping (EXISTS / GROUP BY HAVING COUNT=n / NOT EXISTS)",
        "set": "Manifest",
        "reads": "tagIds, excludeTagIds mapped from searchTags/excludeTags",
        "writes": "scopes the manifest row set when a filter is active; a no-op predicate when both sets are empty (the 'tag filter' and 'all images' tiers are the same query)",
        "fail": false
      },
      {
        "n": 8,
        "sys": "feed_protocol",
        "fn": "mapFeedManifestRow -> FeedItem[] cache write",
        "set": "Manifest",
        "reads": "FeedManifestRow[] over IPC",
        "writes": "['feed-manifest', tagIds, matchAll, excludeIds] react-query cache entry; FeedItem shape with url/tags absent until per-id hydration lands",
        "fail": false
      },
      {
        "n": 9,
        "sys": "frontend_state",
        "fn": "useShuffledFeed -- stable per-image key hash(id, seed)",
        "set": "Shuffle",
        "reads": "manifest FeedItem[], shuffleSeed, sessionOrder",
        "writes": "shuffled order; when cache.seed===seed && cache.images!==images, the incremental branch patches/removes/merge-inserts instead of a full rebuild",
        "fail": true
      },
      {
        "n": 10,
        "sys": "search_routing",
        "fn": "displayImages memo",
        "set": "Shuffle",
        "reads": "shuffled feed, no active selection/semantic tier",
        "writes": "displayImages = feed",
        "fail": false
      },
      {
        "n": 11,
        "sys": "masonry_layout",
        "fn": "buildPackInput",
        "set": "Pack",
        "reads": "displayImages widths/heights/manualColSpan, selectedItem (hero)",
        "writes": "typed-array MasonryPackInput (Float64Array widths/heights, Int32Array spans)",
        "fail": false
      },
      {
        "n": 12,
        "sys": "masonry_layout",
        "fn": "useMasonryEngine.requestPack() -- genRef increment",
        "set": "Pack",
        "reads": "new pack input",
        "writes": "module-local generation token bumped; PREFIX_PACK_COUNT=240 / RESET_EXPANSION_RATIO=4 heuristic evaluated",
        "fail": true
      },
      {
        "n": 13,
        "sys": "masonry_layout",
        "fn": "synchronous prefix pack (computeMasonryGeometry, calling thread)",
        "set": "Paint",
        "reads": "first 240 items of the input arrays",
        "writes": "prefix MasonryGeometry committed immediately; committed height = max(prefixHeight, previously committed height)",
        "fail": false
      },
      {
        "n": 14,
        "sys": "masonry_layout",
        "fn": "createMasonryPacker().pack(gen, input) -- Worker postMessage transfer",
        "set": "Pack",
        "reads": "full typed-array input, transferred zero-copy",
        "writes": "dispatches computeMasonryGeometry to the Vite module Worker",
        "fail": false
      },
      {
        "n": 15,
        "sys": "masonry_layout",
        "fn": "masonryWorker.ts computeMasonryGeometry (off-thread, identical pure core)",
        "set": "Pack",
        "reads": "transferred widths/heights/spans",
        "writes": "full MasonryGeometry (xs/ys/widths/heights/spans typed arrays), transferred back zero-copy",
        "fail": false
      },
      {
        "n": 16,
        "sys": "masonry_layout",
        "fn": "isCurrentGeneration(resultGen, currentGen) gate",
        "set": "Paint",
        "reads": "worker result's generation tag vs. currentGen",
        "writes": "stale result discarded if superseded by a newer filter/resize/reorder input; else committed as a seamless suffix swap over the already-painted prefix",
        "fail": true
      },
      {
        "n": 17,
        "sys": "masonry_layout",
        "fn": "visible-window placement materialisation",
        "set": "Paint",
        "reads": "full flat geometry + [viewport.top, viewport.bottom] with an 800px overscan and a 400px guard band",
        "writes": "placement objects materialise only for the visible window, plus the always-included hero and the actively dragged tile",
        "fail": false
      },
      {
        "n": 18,
        "sys": "masonry_layout",
        "fn": "MasonryItem render (propsAreEqual scalar comparator)",
        "set": "Paint",
        "reads": "placement, FeedItem pixel-affecting fields (id, url, thumbnailUrl, hasThumbnail, width, height, name)",
        "writes": "DOM tile, keyed by id alone",
        "fail": false
      },
      {
        "n": 19,
        "sys": "indexing",
        "fn": "emit_feed_delta -- batched FeedDeltaRow flush",
        "set": "Delta",
        "reads": "thumbnail-phase DB writes that actually landed, buffered under the same mutex discipline as the progress high-water mark",
        "writes": "'feed-delta' Tauri event, <=64 rows, ~5s flush cadence; terminal flush ordered before the terminal Phase::Thumbnail progress emit",
        "fail": true
      },
      {
        "n": 20,
        "sys": "feed_protocol",
        "fn": "mergeFeedDeltaRows -- identity-preserving patch",
        "set": "Delta",
        "reads": "buffered FeedDeltaRow[], existing manifest cache entries",
        "writes": "UNFILTERED_MANIFEST_KEY patched in place (untouched entries keep exact object identity); any FILTERED feed-manifest query is invalidateQueries'd instead of patched",
        "fail": true
      },
      {
        "n": 21,
        "sys": "frontend_state",
        "fn": "useShuffledFeed incremental path re-triggered by the new manifest array reference",
        "set": "Delta",
        "reads": "patched manifest array under the unchanged seed",
        "writes": "newcomers merge-inserted at their (shuffleKey, id) slot; entries with no reference change return the same array by reference so the pack memo holds",
        "fail": false
      }
    ]
  },
  "failures": [
    {
      "step": "5",
      "link": "5 manifest-parity",
      "title": "The compact manifest must stay membership-identical to the retired full-catalogue query",
      "body": "get_feed_manifest's WHERE clause is a byte-faithful copy of the legacy get_images_with_thumbnails predicate -- same root/orphan visibility, same include OR/AND semantics, same exclude NOT EXISTS. This is test-locked by manifest_membership_matches_legacy_query, which runs both queries against the same fixture DB and diffs the id sets. If a future edit to the manifest's WHERE clause drifts from the legacy predicate without updating both call sites, the grid would silently show a different set of images than the tag/exclude filters promise, with no runtime error -- only the diff test would catch it."
    },
    {
      "step": "9",
      "link": "9 incremental-shuffle",
      "title": "useShuffledFeed's incremental path must stay provably identical to a full rebuild",
      "body": "The incremental branch (patch/remove over the previous order, merge-insert newcomers at their fixed (hash(id,seed), id) slot) only fires when the seed is unchanged and the manifest array reference changed -- exactly the shape a delta-patched update produces. Because an id's shuffle key is fixed for a given seed, no existing item can have moved, so the branch is provably identical to a full re-sort; this is the surviving half of the rejected 'incremental shuffle' idea (#4 in the perf roadmap) and is equivalence-tested. If a future change breaks the no-existing-item-moves invariant (e.g. a seed-dependent key that also depends on array position), the incremental path would silently desync from what a full rebuild would produce, and no existing test currently re-derives the full rebuild to cross-check it on every call -- only the dedicated equivalence suite catches it."
    },
    {
      "step": "12 -> 16",
      "link": "12 -> 16 generation-tag",
      "title": "Worker pack results are generation-tagged and stale results are discarded, never applied",
      "body": "Every requestPack() bumps a module-local generation counter; isCurrentGeneration (pure, unit-tested) discards any worker result whose generation has been superseded by a newer filter/resize/reorder input before it can commit. Without this gate, a rapid sequence of inputs (e.g. a fast filter toggle followed immediately by a resize) could let an in-flight worker computation for a now-stale input land AFTER a newer, correct result, visibly flickering the grid back to an outdated layout. The invariant is structural, not cosmetic: a 100k-image pack can take long enough off-thread that overlapping requests are the normal case, not an edge case."
    },
    {
      "step": "19",
      "link": "19 terminal-flush-order",
      "title": "The terminal feed-delta flush must be ordered before the terminal phase-transition emit",
      "body": "emit_feed_delta's terminal flush of the delta buffer is ordered strictly before the terminal Phase::Thumbnail progress emit that signals a phase transition. This ordering is what lets the frontend safely flush its OWN buffer purely in response to a phase-transition event (phase !== 'thumbnail') without a race -- if the ordering were reversed, the frontend could observe the phase transition and flush before the last <64-row tail of deltas had even been emitted, silently stranding those rows until the next full manifest invalidation at Phase::Ready papers over the gap (a real but delayed self-heal, not a crash) -- masking the bug rather than surfacing it."
    },
    {
      "step": "20",
      "link": "20 filtered-invalidate",
      "title": "Filtered manifest views invalidate wholesale; only the unfiltered cache is patched in place",
      "body": "mergeFeedDeltaRows patches the UNFILTERED_MANIFEST_KEY cache entry in place (identity-preserving: untouched ids keep their exact object reference so MasonryItem's comparator and useShuffledFeed's incremental path both skip re-render/re-sort work). Every FILTERED feed-manifest query is invalidateQueries'd instead, deliberately -- a delta row carries only id/name/dims/thumbnail path, so its tag membership is unknown client-side, and patching a filtered view in place would risk showing an image that doesn't actually match the active filter, or hiding one that does. This is the same 'a filter always acts on what you can see' invariant the 447e557 coherence pass established for the search bar / library drawer. Violating it (patching a filtered view directly) would reintroduce exactly the class of filter/reality-mismatch bug that pass was written to close."
    }
  ],
  "relationships": [
    {
      "a": "filesystem_scanner",
      "b": "indexing",
      "mech": "ImageScanner::scan_directory called per enabled root inside the pipeline's scan phase",
      "data": "candidate image paths",
      "breaks": "A scan permission error logs warn and the pipeline continues with what was collected; partial scans are safe because add_images_batch/add_image are idempotent (INSERT OR IGNORE)."
    },
    {
      "a": "indexing",
      "b": "database",
      "mech": "Scan phase batches (path, root_id) pairs at 256 through add_images_batch (one BEGIN IMMEDIATE, INSERT OR IGNORE, mandatory row-by-row fallback on chunk failure); get_paths_to_root_ids is a single SELECT feeding both thumbnail passes",
      "data": "image rows (scan), path->root_id map (thumbnail routing)",
      "breaks": "A malformed row in a 256-path chunk rolls back that transaction and replays serially so it can never sink its batch-mates — a deliberate behaviour-preserving trade, not an optional shortcut."
    },
    {
      "a": "indexing",
      "b": "database",
      "mech": "Both non-CLIP-batch-limited encoder loops call upsert_embeddings_batch once per ~32-image chunk under one BEGIN IMMEDIATE, with checkpoint_passive draining WAL between batches under wal_autocheckpoint=0",
      "data": "batched (image_id, embedding) rows per encoder",
      "breaks": "If a batch's transaction fails partway it rolls back wholesale — no embeddings from that batch land; the loop records the failure rather than pretending success."
    },
    {
      "a": "indexing",
      "b": "thumbnail_pipeline",
      "mech": "Pass 1 holds a ThumbnailGenerator(max_width=480) and rayon-pars over get_images_without_thumbnails, buffering a FeedDeltaRow per success; pass 2 (separate sweep, after every base has landed) calls generate_buckets for the eager 960/1440/2048 pre-warm from one decode",
      "data": "decoded image -> base JPEG (pop-in) + eager higher-resolution bucket JPEGs",
      "breaks": "A decode failure logs and the row stays unmarked (base) or that bucket is simply missing (eager); the next pipeline run retries the base, get_thumbnail retries a missing bucket on next request."
    },
    {
      "a": "indexing",
      "b": "clip_image_encoder",
      "mech": "run_clip_encoder_with_intra instantiates ClipImageEncoder(clip_vision.onnx) and preprocesses in chunks of 32, but the ONNX call itself stays one-image-at-a-time (OpenCLIP's fixed batch-dim-1 export)",
      "data": "512-d CLIP image embedding BLOB",
      "breaks": "If clip_vision.onnx is missing the encode phase is skipped (warn); non-fatal, semantic/similar search just returns fewer results from that encoder's ranked list."
    },
    {
      "a": "indexing",
      "b": "clip_text_encoder",
      "mech": "Pipeline pre-warms ClipTextEncoder(clip_text.onnx, clip_tokenizer.json) into TextEncoderState.encoder so the first CLIP-branch semantic search does not pay model-load latency",
      "data": "warm ONNX session + tokenizer",
      "breaks": "If pre-warm fails (warn), the lazy-init guard in commands::semantic covers it on first use — the double-init check (if lock.is_none()) costs nothing when pre-warm already succeeded."
    },
    {
      "a": "indexing",
      "b": "cosine_similarity",
      "mech": "Step 7 (Phase::Ready, not a Phase:: variant): for every enabled encoder, CosineIndex::refresh_if_stale(db, encoder_id) recomputes db.embedding_generation_token and repopulates the fusion slot ONLY on mismatch; a no-op rescan costs one SQL aggregate",
      "data": "generation-token comparison; on mismatch, fresh embeddings -> repopulated FlatStore -> persisted embstore_<encoder>.bin",
      "breaks": "This is the fix for the fc6667a staleness regression: without it, image-image/tiered/semantic search would serve rankings missing newly-encoded images until app relaunch — a bug the primary-index removal itself had introduced and then fixed in the same round."
    },
    {
      "a": "indexing",
      "b": "dinov2_encoder",
      "mech": "run_trait_encoder(dinov2_base, Dinov2ImageEncoder::new) issues true [N,3,224,224] batched ONNX inference per chunk (dynamic-batch export); ImageNet preprocessing distinct from CLIP",
      "data": "768-d DINOv2 embedding",
      "breaks": "If the model file is missing that encoder pass skips (warn); per-encoder fail-soft — other encoders' fusion contributions are unaffected."
    },
    {
      "a": "indexing",
      "b": "siglip2_encoder",
      "mech": "run_trait_encoder(siglip2_base) issues true [N,3,256,256] batched ONNX inference per chunk with 256 exact-square preprocessing; the same phase also pre-warms Siglip2TextEncoder for the semantic-search text branch",
      "data": "768-d SigLIP-2 image embedding + a warm text-encoder session",
      "breaks": "Same per-encoder fail-soft as DINOv2; a missing SigLIP-2 vision model skips only its own image-encode pass, independent of the text pre-warm's own fail-soft path."
    },
    {
      "a": "siglip2_encoder",
      "b": "tauri_commands",
      "mech": "commands::semantic and commands::semantic_fused dispatch the SigLIP-2 text branch when text_encoder_id (or a TEXT_CAPABLE_ENCODERS member) is siglip2_base, scoring against the shared image-side FusionIndexState cache",
      "data": "768-d text query vector -> SigLIP-2 cosine namespace via multi_encoder_fusion",
      "breaks": "If SigLIP-2 is selected before any SigLIP-2 image embeddings exist, that encoder's ranked list is empty (fusion just fuses fewer lists); if every text-capable encoder is disabled, get_fused_semantic_search returns an empty Vec with a warn! rather than erroring."
    },
    {
      "a": "indexing",
      "b": "watcher",
      "mech": "Both share Arc<IndexingState> (single-flight AtomicBool); the watcher's debounce callback calls try_spawn_pipeline, which returns Err(AlreadyRunning) and is silently coalesced if a run is already in flight",
      "data": "AlreadyRunning signal",
      "breaks": "If single-flight broke, two pipelines could run concurrently and race step 7's per-encoder embstore_<encoder>.bin write — one would lose. WAL + idempotent inserts keep correctness but CPU would be wasted."
    },
    {
      "a": "indexing",
      "b": "model_download",
      "mech": "Pipeline phase 1 calls download_models_if_missing; missing files fetched from HuggingFace (OpenCLIP LAION for CLIP) with HEAD preflight + chunked GET, writing to a .part sibling then renaming",
      "data": "ONNX weights + tokenizer JSON",
      "breaks": "Network failure logs warn and continues with whatever exists; encode/text-prewarm phases gate on path.exists(). A crash mid-download leaves a .part file the next launch re-downloads from scratch (not resumable)."
    },
    {
      "a": "watcher",
      "b": "app_shell",
      "mech": "The watcher closure captures app.clone() to call try_spawn_pipeline and emit indexing-progress; handle stashed in Arc<Mutex<Option<WatcherHandle>>>",
      "data": "AppHandle + WatcherHandle",
      "breaks": "The watcher is NOT rebuilt on add_root/remove_root/set_root_enabled (documented, still-open gap) — a root added after launch gets its immediate rescan via add_root's own try_spawn_pipeline call, but subsequent filesystem changes to that root go unwatched until the next app launch."
    },
    {
      "a": "multi_folder_roots",
      "b": "thumbnail_pipeline",
      "mech": "Each thumbnail (base + every bucket) lands in paths::thumbnails_dir_for_root(root_id) via the shared resolve_root_dir helper; remove_root's rm -rf sweeps every bucket file for that root's images for free",
      "data": "per-root thumbnail + bucket files",
      "breaks": "Without per-root layout, root removal would orphan thumbnail files forever; legacy root_id=NULL rows still use the flat layout."
    },
    {
      "a": "multi_folder_roots",
      "b": "database",
      "mech": "roots table; images.root_id REFERENCES roots(id) ON DELETE CASCADE; PRAGMA foreign_keys=ON makes CASCADE fire; add_root now carries an Option<Vec<u8>> macOS security-scoped bookmark",
      "data": "root rows + cascade deletes + bookmarks",
      "breaks": "Disabling the FK pragma silently turns CASCADE into a no-op — orphan image rows accumulate."
    },
    {
      "a": "tauri_commands",
      "b": "frontend_state",
      "mech": "ApiError wire format pinned by serde tag=kind, content=details; the frontend ApiError union mirrors the kinds via formatApiError; every catch site uses it for user-visible toasts",
      "data": "typed error kinds",
      "breaks": "Adding a backend variant without updating the TS union triggers no runtime error — the default case handles unknown kinds gracefully but loses the specific-branch UX (e.g. isMissingModelError's re-download affordance)."
    },
    {
      "a": "tauri_commands",
      "b": "multi_encoder_fusion",
      "mech": "Double-checked locking: ranked_for_encoder/with_encoder_index take a READ lock first and score under it if the slot is warm (the common case, lets concurrent queries against a warm encoder parallelise); only a miss takes the WRITE lock, re-checks, and populates (mmap-preferred, then DB)",
      "data": "query vector + top-k -> Vec<(image_id, f32)> per encoder, fused or single",
      "breaks": "RwLock poisoning (a panic while holding the write lock during populate) fails every subsequent search across every encoder since there is exactly one shared map now that the primary index is gone; recovery requires an app restart."
    },
    {
      "a": "profiling",
      "b": "indexing",
      "mech": "tracing spans (pipeline.scan_phase, pipeline.thumbnail_phase, pipeline.eager_bucket_pass, pipeline.fusion_refresh, per-encoder run_clip_encoder/run_trait_encoder spans) + record_diagnostic across every phase; collected by PerfLayer only under --profiling",
      "data": "span timings + diagnostic payloads (encoder_run_summary per pass)",
      "breaks": "Without --profiling, span construction still happens but no aggregator registers — overhead is one tracing dispatch per call, no allocation."
    },
    {
      "a": "profiling",
      "b": "frontend_state",
      "mech": "is_profiling_enabled resolved once at mount gates <PerfOverlay>; recordAction -> record_user_action appends to the timeline only when profiling is on; perfInvoke wraps invoke per opted-in call site (not a global interceptor)",
      "data": "profiling flag + action breadcrumbs",
      "breaks": "Without profiling all React profiling state is dead — useState(profiling) is false and every gated branch short-circuits."
    },
    {
      "a": "search_routing",
      "b": "tauri_commands",
      "mech": "pages/[...slug].tsx directly invokes get_fused_similar_images and get_fused_semantic_search for the similar/semantic priority tiers; get_images/get_images_with_thumbnails has no live caller left in the frontend (feed_protocol's get_feed_manifest/get_image_details are the base-tier path instead — see the feed_protocol relationships)",
      "data": "selection + query params -> ID-native result lists",
      "breaks": "If a command's JSON shape changes without a TS update, the priority chain silently falls back to whichever branch's query didn't error, rather than surfacing the mismatch."
    },
    {
      "a": "masonry_layout",
      "b": "search_routing",
      "mech": "Masonry receives displayImages (whichever priority-chain tier is active) + selectedItem for hero promotion; tile geometry comes from the manifest row's width/height (or the seeded interim ImageItem), never a DOM-Image round-trip",
      "data": "FeedItem[]/ImageItem[] with (w,h), selectedItem",
      "breaks": "If width/height are NULL (a not-yet-thumbnailed row) Masonry falls back to the 400x400 placeholder aspect until the delta/manifest refresh lands real dims."
    },
    {
      "a": "tag_system",
      "b": "database",
      "mech": "Tags use tags + images_tags; add_tag_to_image is INSERT OR IGNORE; delete_tag is wired; AND/OR via match_all_tags and exclude via NOT EXISTS on get_images_with_thumbnails/get_feed_manifest; get_tag_counts and the include-filter subquery both ride the idx_images_tags_tag(tag_id, image_id) reverse index",
      "data": "tag rows + join rows + per-folder visible-image counts",
      "breaks": "Without the reverse index, get_tag_counts (run once per drawer folder shown — dozens at once) and the include-filter subquery each full-scan images_tags; at 100k images x ~3 tags that is a ~300k-row scan per tag, dozens of times over."
    },
    {
      "a": "frontend_state",
      "b": "search_routing",
      "mech": "The useIndexingStatus singleton's handleEvent invalidates [\\"pipelineStats\\"] every indexing-progress event, and on phase===ready (de-duped via readyInvalidatedFor) drops [\\"feed-manifest\\"], [\\"fused-similar-images\\"], [\\"fused-semantic-search\\"], and [\\"thumbnail\\"] as the reconciliation backstop",
      "data": "cache-key invalidation (feed-manifest/fused-*/thumbnail, not images anymore)",
      "breaks": "A stale filtered-manifest cache after a tag mutation would show wrong membership; onSuccess/phase-ready invalidation handles it. The ready-invalidation's message-string de-dupe key means two consecutive runs sharing a terminal message would skip the second reconciliation (documented residual risk)."
    },
    {
      "a": "paths_and_state",
      "b": "database",
      "mech": "paths::app_data_dir()/images.db is the DB location; models_dir() checks LYNCEUS_MODELS_DIR then app-data; all disk paths flow from paths::*_dir()",
      "data": "every on-disk path",
      "breaks": "If app_data_dir() ever resolved to the wrong directory every state file would go to the wrong place; the com.ataca.lynceus bundle-id rename already orphaned old-id libraries once."
    },
    {
      "a": "paths_and_state",
      "b": "multi_folder_roots",
      "mech": "One-shot: lib.rs setup reads settings.json scan_root; if present, migrate_legacy_scan_root(path) then clears the field",
      "data": "legacy single-folder -> roots row",
      "breaks": "migrate_legacy_scan_root is idempotent (existing path -> no-op), so a manual settings.json edit cannot re-trigger destructively."
    },
    {
      "a": "profiling",
      "b": "cosine_similarity",
      "mech": "cosine/diagnostics.rs helpers (embedding_stats, pairwise_distance_distribution, self_similarity_check, score_distribution_stats) now take &FlatStore instead of &Vec<(PathBuf, Array1<f32>)>, returning serde_json payloads consumed by the search_query diagnostic",
      "data": "domain quality stats over the flat store",
      "breaks": "If a helper panicked on a malformed store the encoder populate would still succeed but the diagnostic payload would be missing; helpers early-return on empty cases rather than panicking."
    },
    {
      "a": "database",
      "b": "cosine_similarity",
      "mech": "schema_migrations::migrate_embedding_pipeline_version wipes legacy embeddings (including per-encoder rows for clip_vit_b_32/dinov2_base/siglip2_base) when CURRENT_PIPELINE_VERSION advances so the next pass re-encodes cleanly into fresh FlatStores",
      "data": "embedding-pipeline version gate",
      "breaks": "Bumping the version without a real preprocessing change wipes + re-encodes with no quality gain — wasteful but not broken; the bump must pair with a real pipeline change."
    },
    {
      "a": "tauri_commands",
      "b": "clip_image_encoder",
      "mech": "list_available_encoders serves the static ENCODERS list (clip_vit_b_32, siglip2_base, dinov2_base) to the frontend encoder-toggle picker",
      "data": "encoder metadata (id, dim, supports_text/image)",
      "breaks": "EncoderInfo is mirrored as a TS interface; adding a backend entry without updating the picker surfaces an option with empty rationale text."
    },
    {
      "a": "database",
      "b": "app_shell",
      "mech": "ImageDatabase writer (Mutex<Connection>) + read-only secondary (OnceLock<Mutex<Connection>>) opened on the same WAL file; foreground SELECTs use read_lock(), encoder/scan writes use the writer",
      "data": "serialised writes, non-blocking reads",
      "breaks": "If the secondary fails to open, read_lock falls back to the writer mutex — restores the old contended-but-correct behaviour; :memory: test DBs have no secondary at all."
    },
    {
      "a": "multi_encoder_fusion",
      "b": "search_routing",
      "mech": "useTieredSimilarImages routes through fetchFusedSimilarImages -> get_fused_similar_images -> FusionIndexState.ranked_for_encoder x3 -> reciprocal_rank_fusion(k=60) -> hydrate_search_results (ONE WHERE id IN batch, ID-native); get_fused_semantic_search does the text-image variant (up to 2 lists, DINOv2 excluded)",
      "data": "N per-encoder ranked lists -> one fused ImageSearchResult[]",
      "breaks": "If a user views similar before any encoder has indexed the clicked image, that encoder's per-encoder loop emits no_embedding_for_query_image and fusion returns whatever the other encoders contributed rather than crashing; if every encoder lacks the image, fusion returns empty."
    },
    {
      "a": "feed_protocol",
      "b": "database",
      "mech": "get_feed_manifest is a byte-faithful copy of the legacy visibility predicate with no tags/notes/original-path join (test-locked: manifest_membership_matches_legacy_query); get_image_details_by_ids hydrates the selected image + arrow-nav neighbours only, chunked at 500 ids",
      "data": "FeedManifestRow[] (id, name, w/h, thumbnail_path, manual_col_span) + ImageData[] (full detail)",
      "breaks": "This is what killed the 200-300k-row LEFT JOIN unroll at 100k images; an orphaned or disabled-root id hydrates to nothing, which the frontend treats exactly like the old catalogue's in-memory .find() miss."
    },
    {
      "a": "feed_protocol",
      "b": "indexing",
      "mech": "emit_feed_delta buffers a FeedDeltaRow per successfully-thumbnailed image, flushes every 64 rows, with a terminal flush ordered BEFORE the terminal Phase::Thumbnail progress emit",
      "data": "batched feed-delta events (id, name, w/h, thumbnail_path — no manual_col_span)",
      "breaks": "Only rows whose DB write actually landed become deltas; if this ordering were reversed, frontend phase-transition logic could run before every delta for that phase had arrived, stranding a partial tail."
    },
    {
      "a": "feed_protocol",
      "b": "frontend_state",
      "mech": "mergeFeedDeltaRows patches the UNFILTERED_MANIFEST_KEY cache in place (identity-preserving, patch-in-place, insert-sorted); any FILTERED feed-manifest query is invalidateQueries'd instead because a delta row's tag membership is unknown client-side",
      "data": "patched or invalidated [\\"feed-manifest\\", ...] cache entries",
      "breaks": "If the isUnfiltered predicate in services/feedDelta.ts were ever out of sync with a future added filter dimension on the query key, that new dimension would be misclassified as unfiltered and start receiving direct patches with unknown tag membership — a documented, currently-untested risk."
    },
    {
      "a": "feed_protocol",
      "b": "masonry_layout",
      "mech": "useShuffledFeed's incremental fast path patches/merge-inserts newcomers at their (shuffleKey, id) slot against an unchanged seed, returning the previous array by reference when nothing changed so the masonry pack memo holds without recomputation",
      "data": "ordered FeedItem[] the worker packs",
      "breaks": "Without reference-stability on the no-op case, every delta-driven manifest patch would force a full re-pack even when nothing visually needs to move."
    },
    {
      "a": "feed_protocol",
      "b": "search_routing",
      "mech": "useFeedManifest({tagIds, matchAllTags, excludeTagIds}) + useShuffledFeed forms the base/all tier of displayImages; the tag-or-exclude-filtered case and the unfiltered case are the SAME call at different argument values, not two tiers",
      "data": "the shuffled/session-ordered manifest feed",
      "breaks": "A filter-mutating handler that skips exitToFeed() would refetch the manifest silently underneath a visible similar/semantic view — the coherence-pass invariant this depends on lives in search_routing, not here."
    },
    {
      "a": "gesture_timer",
      "b": "search_routing",
      "mech": "PinterestModal mounts <GestureTimer startingImage candidateImages autoStart> where candidateImages is the route's tiered-similarity result set; handlePillStart writes pendingTimerStart (cleared on selection change) which becomes GestureTimer's autoStart prop",
      "data": "startingImage + candidateImages + an optional pending GestureTimerConfig",
      "breaks": "Without the route's selection-change effect clearing pendingTimerStart, a stale autoStart config object could in principle fire a session against a different image than it was built for; appliedAutoStartRef's identity-keyed guard is the second half of that protection."
    },
    {
      "a": "gesture_timer",
      "b": "masonry_layout",
      "mech": "SelectedImageTimerPill mounts as the heroOverlay prop on the selected hero tile only, revealed on hover/focus-within via the data-selected-hero CSS hook in App.css",
      "data": "an opaque overlay node (masonry never inspects its contents)",
      "breaks": "heroOverlay is compared by reference in MasonryItem's custom memo comparator; if the route ever passed a freshly-constructed pill element on every render instead of a memoised one, every hero re-render would repaint the pill for no reason."
    },
    {
      "a": "masonry_layout",
      "b": "frontend_state",
      "mech": "useUserPreferences supplies columnCount override, tileScale, and animationLevel into buildPackInput; separately, MasonryItem's custom propsAreEqual comparator absorbs the fresh-item-object-per-refetch identity churn that TanStack Query hands back on every background manifest refetch during an indexing run",
      "data": "layout preferences in; pixel-affecting-field-only re-render decisions out",
      "breaks": "Without the custom comparator, every visible tile would re-render on every background feed-manifest refetch even when none of its pixel-affecting fields changed — this is a direct instance of the render-storm class of bug the perf round targeted elsewhere."
    }
  ],
  "stateOwnership": [
    {
      "owner": "database",
      "items": "<app_data>/com.ataca.lynceus/images.db (WAL). TWO connections: writer Mutex<Connection> (encoder threads + foreground writes) + read-only secondary OnceLock (foreground SELECTs via read_lock()). idx_images_root_orphaned and idx_images_tags_tag composite indexes; the meta(key,value) table (embedding_pipeline_version). embedding_generation_token is derived on read, not stored. Read by every command; written by indexing + tag/root mutations."
    },
    {
      "owner": "cosine_similarity",
      "items": "Per-encoder FlatStore inside each CosineIndex instance: ids: Vec<i64>, inv_norms: Vec<f32> (cached at populate time), and one contiguous row-major f32 block (Owned(Vec<f32>) or Mapped{Arc<Mmap>}). CosineIndex itself owns no lock — it is wrapped in multi_encoder_fusion's RwLock by its only caller. Persisted as one versioned embstore_<encoder_id>.bin per encoder (64-byte header, generation-token-gated, atomic-rename writes). The primary CosineIndexState this entry used to also describe is REMOVED (1514a90)."
    },
    {
      "owner": "multi_encoder_fusion",
      "items": "FusionIndexState.per_encoder (Arc<RwLock<HashMap<String, CosineIndex>>>) — the ONLY resident embedding cache in the app since T3-2 (the old primary CosineIndexState is gone). Double-checked-locking populate; load_store_if_valid (mmap) preferred over a DB rebuild. spawn_cache_warm pre-populates every enabled encoder's slot at launch on its own thread. invalidate_all() wired to set_scan_root/remove_root/set_root_enabled. Refreshed + re-persisted per-encoder at Phase::Ready by indexing's step 7."
    },
    {
      "owner": "clip_text_encoder",
      "items": "TextEncoderState (Mutex<Option<...>>), two slots: .encoder (CLIP, 512-d) and .siglip2_encoder (SigLIP-2 Base 256, 768-d, Gemma SentencePiece). Both pre-warmed by the indexing thread (Phase 12d); lazy-init fallback in commands::semantic covers either slot if pre-warm failed or hasn't run yet. Heavy ONNX sessions, live until process exit."
    },
    {
      "owner": "indexing",
      "items": "IndexingState.is_running (Arc<AtomicBool>) single-flight guard with RAII clear-on-panic (RunningGuard). Shared with the watcher closure and every command that triggers an index. EncodeProgress (the shared monotonic per-run counter across concurrent encoder threads) is transient per-run state, not persisted."
    },
    {
      "owner": "watcher",
      "items": "WatcherHandle slot (Arc<Mutex<Option<WatcherHandle>>>). Filled by the setup callback; still never refreshed on root change as of this pass (documented gap — new roots unwatched until next launch)."
    },
    {
      "owner": "paths_and_state",
      "items": "settings.json (legacy scan_root + enabled_encoders + legacy priority_image_encoder) and the whole <app_data>/ + models/ path layout. BUNDLE_ID com.ataca.lynceus; LYNCEUS_DATA_DIR / LYNCEUS_MODELS_DIR overrides."
    },
    {
      "owner": "profiling",
      "items": "PROFILING_ENABLED + PERF_STATS process-global OnceLocks; RawEvent log; exports/perf-<ts>/{timeline.jsonl,report.md,raw.json}. Set once in main; read everywhere; dormant without --profiling."
    },
    {
      "owner": "frontend_state",
      "items": "TanStack QueryClient cache (staleTime Infinity), now split into the manifest/detail entity model ([\\"feed-manifest\\", tagIds, matchAllTags, excludeTagIds] -> FeedItem[]; [\\"image-detail\\", id] -> ImageItem|null) rather than one monolithic [\\"images\\", ...] key. The module-level useIndexingStatus singleton (one Tauri listen() call for indexing-progress AND feed-delta, event-derived state broadcast via useSyncExternalStore's primitive-slice subscribers) plus localStorage[imageBrowserPrefs] (theme, columnCount, tileScale, animationLevel, similarResultCount, semanticResultCount, tagFilterMode — sortMode no longer exists). zustand is fully removed, not just unused."
    },
    {
      "owner": "search_routing",
      "items": "selectedItem, isInspecting, searchTags (shared include-filter with the library drawer), excludeTags (drawer-only), searchText, settingsOpen, perfOpen, shuffleSeed, sessionOrder (in-session drag-reorder, cleared on reshuffle/filter-change), simTrail (similarity breadcrumb trail), pendingTimerStart, activeNotes — all React state in pages/[...slug].tsx. URL slug is the source of truth for selection; selection resolves via the seed-then-upgrade dance against feed_protocol's manifest/detail split."
    },
    {
      "owner": "feed_protocol",
      "items": "The feed-manifest/image-detail cache-key shapes and the delta merge/invalidation contract (mergeFeedDeltaRows, UNFILTERED_MANIFEST_KEY) are this system's canonical surface, but the literal module-level delta buffer and the single Tauri event subscription both live inside frontend_state's useIndexingStatus — feed_protocol owns the contract, frontend_state owns the listener it rides on."
    },
    {
      "owner": "gesture_timer",
      "items": "Per-GestureTimer-instance: config (committed) vs draftConfig (being edited) state, running/configOpen/sessionKey (remount counter incremented on every start/restart), appliedAutoStartRef (identity-keyed guard against re-firing the same autoStart object). useGestureTimer's own sequence/currentIndex/remainingMs/isRunning/isComplete state machine, keyed off performance.now() for drift-free countdown. Nothing persists to the backend — a session is fully ephemeral React state, gone once GestureTimerView unmounts."
    },
    {
      "owner": "masonry_layout",
      "items": "useMasonryEngine's placementsRef/placementByIdRef/columnWidthRef/columnCountRef shared refs (written in the visible-placements memo, read directly by the drag/resize hooks so pointer handlers avoid re-subscribing to renders), genRef (pack-request generation counter, discards superseded worker results), committedHeightRef (never shrinks under a partial prefix commit). useTileDrag/useTileResize hold their own imperative pointer-gesture state (workingOrder, previewSpan) outside React state until a discrete hover-swap or span-boundary crossing."
    }
  ],
  "coverage": {
    "cols": [
      "engine",
      "product",
      "encoders",
      "frontend",
      "git-log"
    ],
    "rows": [
      {
        "label": "app-shell",
        "node": "app_shell",
        "cells": {
          "product": 2,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "tauri-commands",
        "node": "tauri_commands",
        "cells": {
          "product": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "indexing",
        "node": "indexing",
        "cells": {
          "product": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "watcher",
        "node": "watcher",
        "cells": {
          "product": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "filesystem-scanner",
        "node": "filesystem_scanner",
        "cells": {
          "product": 2,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "thumbnail-pipeline",
        "node": "thumbnail_pipeline",
        "cells": {
          "frontend": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "model-download",
        "node": "model_download",
        "cells": {
          "product": 2,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "clip-image-encoder",
        "node": "clip_image_encoder",
        "cells": {
          "encoders": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "clip-text-encoder",
        "node": "clip_text_encoder",
        "cells": {
          "encoders": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "dinov2-encoder",
        "node": "dinov2_encoder",
        "cells": {
          "encoders": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "siglip2-encoder",
        "node": "siglip2_encoder",
        "cells": {
          "encoders": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "multi-encoder-fusion",
        "node": "multi_encoder_fusion",
        "cells": {
          "engine": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "cosine-similarity",
        "node": "cosine_similarity",
        "cells": {
          "engine": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "database",
        "node": "database",
        "cells": {
          "engine": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "paths-and-state",
        "node": "paths_and_state",
        "cells": {
          "engine": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "profiling",
        "node": "profiling",
        "cells": {
          "engine": 2,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "multi-folder-roots",
        "node": "multi_folder_roots",
        "cells": {
          "product": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "search-routing",
        "node": "search_routing",
        "cells": {
          "frontend": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "masonry-layout",
        "node": "masonry_layout",
        "cells": {
          "frontend": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "tag-system",
        "node": "tag_system",
        "cells": {
          "frontend": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "frontend-state",
        "node": "frontend_state",
        "cells": {
          "frontend": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "gesture-timer",
        "node": "gesture_timer",
        "cells": {
          "frontend": 3,
          "git-log": 3
        },
        "prev": {}
      },
      {
        "label": "feed-protocol",
        "node": "feed_protocol",
        "cells": {
          "frontend": 3,
          "git-log": 3
        },
        "prev": {}
      }
    ],
    "note": "Inspection scope for this pass (v2-UI + 100k-perf refresh). 3 = source read this pass; 2 = verified-by-diff / trusted from prior (model-download, filesystem-scanner, profiling, app-shell confirmed unchanged or near-unchanged, not re-read in full); 1 = structural inference. git-log = 3 across the board: the eight round commit bodies (ebe4006, fc6667a, 012012c, 1514a90, fcad704, 44737d9, b12ba46, 977e693) read in full as the primary rationale source. Known gaps left open: (a) all live-WebView behaviour (masonry drag/resize feel, pop-in animation, worker swap under scroll, post-index search freshness, pill reset feel) is code-trace + unit-test verified only, no headless interactive window; (b) GestureTimerConfigPanel mode='start' branch appears unreachable (flagged, not confirmed a bug); (c) the ~0.5-1s/encoder post-index write-lock window is reasoned from lock scope, not timed at 100k."
  },
  "milestones": [
    {
      "id": "m-foundation",
      "title": "Foundation: SQLite catalogue + masonry + tags",
      "status": "done",
      "note": "2025-11 — recursive scan, images.db, Pinterest grid, tag CRUD."
    },
    {
      "id": "m-retrieval",
      "title": "Retrieval: CLIP embeddings + cosine + semantic search",
      "status": "done",
      "note": "2025-11..12 — ONNX encoder, cosine index, similar-images, natural-language search."
    },
    {
      "id": "m-april-surge",
      "title": "April surge: pipeline, multi-encoder, profiling, code-health audit",
      "status": "done",
      "note": "2026-04 — async pipeline, multi-folder + watcher, DINOv2 + SigLIP-2, RRF fusion, opt-in profiling, 23-finding audit all shipped."
    },
    {
      "id": "m-commercial",
      "title": "Commercialisation: Mnemosyne engine + OpenCLIP + monorepo",
      "status": "done",
      "note": "2026-07-15 — engine extracted, all encoders commercially licensed, apps/ monorepo, Lynceus/Mnemosyne rename, weights in repo tree."
    },
    {
      "id": "m-scale",
      "title": "v2 gallery UI + 100k performance round",
      "status": "done",
      "note": "Single stable-key shuffle feed, masonry hook-split + off-thread worker, adaptive thumbnails, design-token visual layer, library drawer, gesture timer; feed manifest+delta protocol, flat mmap embedding store, ID-native fusion-only search, batch inference. Version 0.5.0."
    },
    {
      "id": "m-appstore",
      "title": "Mac App Store paid release (~$10-15)",
      "status": "next",
      "note": "Open: release-build resource-dir weight loading, INT8 quantisation with a golden retrieval set, App Store packaging + signing."
    },
    {
      "id": "m-verticals",
      "title": "Second vertical (Syrinx audio / Daedalus 3D)",
      "status": "planned",
      "note": "Reserved. The engine's Asset generalisation is deferred until a second, genuinely different consumer pushes on the encoder seam."
    }
  ],
  "criticalPaths": [
    {
      "name": "Feed render (manifest -> shuffle -> off-thread masonry pack -> paint, plus live delta merge)",
      "len": "21 steps · 10 subsystems",
      "steps": [
        "app_shell",
        "search_routing",
        "feed_protocol",
        "tauri_commands",
        "database",
        "multi_folder_roots",
        "tag_system",
        "frontend_state",
        "masonry_layout",
        "indexing"
      ],
      "blast": "The steady-state hot path every launch and every scroll exercises. Changing the manifest's row shape (FeedManifestRow), the feed-manifest query-key tuple, or the delta batch shape ripples across feed_protocol, frontend_state's shuffle, and masonry_layout's pack input simultaneously -- all three assume the current FeedItem contract. The root/orphan and tag-scoping predicates (multi_folder_roots, tag_system) are folded inline into the SAME manifest SQL rather than separate queries, so a change to either's schema must stay in lock-step with get_feed_manifest's WHERE clause or membership silently drifts from what the drawer/search-bar filters promise (see failures 5). The off-thread pack's generation-tagging (masonry_layout) is the sole thing keeping a rapid filter/resize/reorder sequence from visibly flickering to a stale layout; the delta merge's identity-preservation (feed_protocol, frontend_state) is what keeps an indexing run from triggering a full re-render storm on every ~5s batch. A regression anywhere in this chain either desyncs the visible grid from the DB's actual visible-image set, or reintroduces the render-storm the 100k round explicitly killed."
    },
    {
      "name": "Fused image-image similarity (View Similar) -- ID-native end-to-end",
      "len": "9 steps · 6 subsystems",
      "steps": [
        "search_routing",
        "tauri_commands",
        "database",
        "multi_encoder_fusion",
        "cosine_similarity",
        "masonry_layout"
      ],
      "blast": "selectedItem set -> useTieredSimilarImages/get_fused_similar_images (or the single-encoder get_tiered_similar_images) -> for each enabled encoder, db.get_embedding(imageId, encoder) resolves the query vector -> FusionIndexState::ranked_for_encoder/with_encoder_index borrows that encoder's slot under a shared RwLock READ lock (the common, already-warm case; only a cold slot escalates to a double-checked WRITE lock, populating from the persisted mmap FlatStore first and falling back to a DB rebuild) -> cosine_similarity's score_all rayon scan scores the slot (dot x q_inv x c_inv, cached norms, no id->row lookup structure -- a full linear scan by design) -> reciprocal_rank_fusion (k_rrf=60) fuses the per-encoder ranked lists -> hydrate_search_results issues ONE WHERE id IN batch query over the ~30 fused ids (database), replacing the old per-result thumbnail N+1 -> results render into masonry_layout. Every step is ID-native (image_id: i64) end-to-end since T3-2/1514a90 -- the old path->id resolution helper and the primary CosineIndexState are both gone, so there is exactly one lock (the fusion RwLock) in the whole path, no AB-BA ordering surface. The structural risk this path carries: each fusion slot's freshness is gated by an embedding-generation token (FNV fold of COUNT/SUM/MAX(rowid) over the same enabled/orphaned JOIN the store is built from) that CosineIndex::refresh_if_stale checks at Phase::Ready -- this is the fix for the 1514a90 regression, where fc6667a's reroute onto fusion slots had left newly-encoded images invisible to search until relaunch because nothing repopulated the fusion slots after a mid-session index. A future change that reintroduces a resident cache the pipeline doesn't refresh-gate the same way would reopen that exact staleness class. Blast radius otherwise: the encoder set is a hardcoded constant in commands/similarity.rs (adding a fourth is additive, low-risk); the FlatStore's native-little-endian mmap format has no cross-arch safety net; a CHANGED encoder's Phase::Ready refresh still runs its populate+persist under that encoder's write lock (~0.5-1s at 100k), blocking concurrent queries against that one encoder for the duration (named follow-up: build-outside-lock-then-swap, not yet started)."
    }
  ],
  "notes": [
    {
      "tag": "design",
      "sev": "",
      "title": "Engine/product split via a re-export facade",
      "body": "The pure-move extraction kept ~6 files of wiring instead of rewriting hundreds of call sites: apps/lynceus/src-tauri/src/lib.rs re-exports the engine modules (pub use mnemosyne::{db,paths,perf,...}) and similarity_and_semantic_search/mod.rs re-exports mnemosyne::{cosine,cosine_similarity}, so in-crate crate::db / crate::paths / crate::cosine paths resolve unchanged. Convention worth preserving: engine internals reference crate::cosine (not the old similarity_and_semantic_search::cosine wrapper, which does not exist in the engine)."
    },
    {
      "tag": "design",
      "sev": "",
      "title": "Per-encoder preprocessing is a load-bearing invariant",
      "body": "Each encoder must use the exact preprocessing its weights were trained with — CLIP 224 bicubic-shortest-edge + centre-crop + CLIP mean/std; DINOv2 resize-256 + centre-crop-224 + ImageNet stats; SigLIP-2 256 exact-square + [-1,1]. Mixing preprocessing across encoders silently degrades embedding quality with NO error signal. This convention spans code (each encoder module) + tests + the preprocessing_sample diagnostic — one rule, three layers."
    },
    {
      "tag": "live",
      "sev": "watch",
      "title": "Weights live in a gitignored repo tree, fetched by a script",
      "body": "scripts/download_models.py fetches ~2.4 GB of ONNX + tokenizers into models/{image,audio,3d}/ (image/ populated; audio/3d empty placeholders for Syrinx/Daedalus). .gitignore excludes /models/ and /target/. paths::models_dir() checks LYNCEUS_MODELS_DIR first, then app-data. The in-app first-launch download still exists as a fallback; release-build resource-dir loading is a documented productisation follow-up."
    },
    {
      "tag": "gap",
      "sev": "watch",
      "title": "Watcher not rebuilt on root add/remove",
      "body": "Newly added roots are not watched until the next launch — the WatcherHandle slot is filled once in setup and never refreshed on add_root/remove_root. Low priority because those commands trigger an immediate pipeline rescan; the gap is only about future on-disk changes to a freshly-added root."
    },
    {
      "tag": "pending",
      "sev": "",
      "title": "CLIP tokenizer provenance to re-source before a paid release",
      "body": "clip_tokenizer.json is still mirrored from Xenova/clip-vit-base-patch32 (an OpenAI export). In practice it is the open_clip MIT vocab/merges, but the provenance is flagged in both the Rust docs and download_models.py to be re-sourced from an explicitly-MIT repo before the App Store release."
    },
    {
      "tag": "design",
      "sev": "",
      "title": "Generation-token invalidation replaces bare mtime checks, in two subsystems at once",
      "body": "Both the embedding store (cosine/cache.rs) and the masonry worker (masonryWorker.ts) use a generation counter, not a timestamp, to detect staleness. The embedding-store token is an FNV fold of COUNT/SUM/MAX(rowid) over the same enabled/orphaned JOIN the store is built from, so a root toggle that changes the row-set without touching the embeddings table still invalidates correctly — a bare mtime check could never see that (fc6667a). The masonry worker's generation tag discards a completed pack result whose generation has been superseded by a newer filter/resize/reorder input that arrived mid-flight (012012c). One pattern, two subsystems: never trust 'has this file changed', ask 'is this the current generation'."
    },
    {
      "tag": "design",
      "sev": "",
      "title": "useSyncExternalStore + one module-level listener is now the house pattern for Tauri event fan-out",
      "body": "useIndexingStatus subscribes exactly once at module scope (indexing-progress and feed-delta share the one listener) and broadcasts primitive-slice snapshots (usePipelineStats/useIsIndexing/useIndexingPhase) via useSyncExternalStore. This replaced 2-3 concurrently-mounted per-hook listeners each firing their own invalidation on the same backend event — the verified render storm (ebe4006). Any future Tauri event consumed by more than one component should follow this shape rather than re-subscribing per mount."
    },
    {
      "tag": "gap",
      "sev": "watch",
      "title": "Post-index write-lock window blocks searches ~3s on a multi-encoder import",
      "body": "At Phase::Ready a CHANGED encoder's fusion-slot populate+persist runs under that slot's write lock (~0.5-1s/encoder at 100k); a full three-encoder import blocks searches ~3s in that window. Token-gating already makes an unchanged-encoder rescan free — this is the residual cost of an actually-changed encoder. Follow-up recorded in context/notes/performance-decisions.md: build the fresh index outside the lock, swap under a brief write lock. Trigger: the post-import pause is felt in real use."
    },
    {
      "tag": "design",
      "sev": "",
      "title": "Versioned mmap headers are the mandatory shape for any future on-disk cache",
      "body": "embstore_<encoder>.bin's 64-byte header (magic, format version, encoder hash, dim, row count, generation token) is the pattern any future on-disk cache in this codebase should copy: every header-mismatch class gets its own rejection test, and the file is written temp-file-then-atomic-rename so a crash mid-write is never observed as the live file. context/notes/performance-decisions.md records this as a standing constraint: 'embedding-cache invalidation must be header-versioned... a bare mtime check silently serves wrong vectors.'"
    },
    {
      "tag": "live",
      "sev": "watch",
      "title": "CLIP inference stays per-image; batching is blocked on weights provenance, not effort",
      "body": "SigLIP-2 and DINOv2 both override the encoder trait's one-by-one default with a single [N,3,H,W] session call per chunk (their ONNX exports are dynamic-batch). CLIP's OpenCLIP visual/model.onnx export declares a fixed batch dim of 1 — batching it requires a model re-export, which touches weights provenance, a live pre-sale concern (see the CLIP tokenizer provenance note above). Do not attempt to force-batch CLIP without first resolving the re-export/provenance question."
    },
    {
      "tag": "gap",
      "sev": "watch",
      "title": "THUMBNAIL_BUCKETS is a hand-duplicated cross-language constant",
      "body": "The bucket ladder [480, 960, 1440, 2048] is a Rust const in generator.rs mirrored by hand as a parallel TS const in useAdaptiveThumbnail.ts, with no shared-codegen guard. A change to one side only would silently desync which bucket file gets requested — see risks[] for the concrete failure shape."
    }
  ],
  "concept": {
    "root": "Local-first semantic asset browser on a reusable engine",
    "branches": [
      {
        "head": "Mnemosyne engine (media-agnostic)",
        "kind": "foundation",
        "leaves": [
          "SQLite/WAL catalogue",
          "cosine ranking + RRF",
          "flat mmap embedding stores",
          "path resolution",
          "opt-in profiling"
        ],
        "trunks": [
          "database",
          "cosine_similarity",
          "multi_encoder_fusion",
          "paths_and_state",
          "profiling"
        ]
      },
      {
        "head": "Indexing pipeline (Lynceus product)",
        "kind": "boundary",
        "leaves": [
          "3 ONNX encoders (batched where the export allows)",
          "JPEG thumbnailer + adaptive on-demand buckets",
          "async pipeline + fs watcher",
          "Tauri IPC surface"
        ],
        "trunks": [
          "indexing",
          "clip_image_encoder",
          "siglip2_encoder",
          "tauri_commands",
          "watcher",
          "thumbnail_pipeline"
        ]
      },
      {
        "head": "Multi-encoder fusion search",
        "kind": "learner",
        "leaves": [
          "CLIP text->image",
          "per-encoder cosine top-k (ID-native)",
          "RRF image-image + text-image fusion"
        ],
        "trunks": [
          "clip_text_encoder",
          "cosine_similarity",
          "multi_encoder_fusion"
        ]
      },
      {
        "head": "Shuffle-feed rendering",
        "kind": "observer",
        "leaves": [
          "compact manifest + feed-delta protocol",
          "stable-key shuffle",
          "off-thread masonry packing",
          "tag + semantic search"
        ],
        "trunks": [
          "feed_protocol",
          "frontend_state",
          "masonry_layout",
          "search_routing",
          "tag_system"
        ]
      },
      {
        "head": "Figure-drawing timer",
        "kind": "observer",
        "leaves": [
          "tiered-similarity-driven sequencing",
          "inline setup + hero quick-start pill",
          "predecoded fullscreen session"
        ],
        "trunks": [
          "gesture_timer"
        ]
      }
    ],
    "note": "Future verticals (Syrinx audio, Daedalus 3D) reuse the Mnemosyne branch and add their own product + encoder branches. The figure-drawing-timer branch is the first fully-frontend-only vertical feature — no backend persistence, entirely ephemeral React state, built on top of the fusion-search branch's own similarity results rather than a separate curated set."
  },
  "glossary": [
    {
      "term": "Mnemosyne",
      "def": "The media-agnostic engine crate (catalogue + retrieval) shared across asset-browser products; Titaness of memory."
    },
    {
      "term": "Lynceus",
      "def": "The image-browser product crate (Tauri app), vertical 1 of Mnemosyne; the Argonaut with the sharpest eyesight."
    },
    {
      "term": "Syrinx / Daedalus",
      "def": "Reserved names for the future audio and 3D verticals — recorded, not built."
    },
    {
      "term": "OpenCLIP LAION",
      "def": "MIT-licensed CLIP ViT-B/32 trained on LAION-2B (immich-app repo); a weights-only, commercially-licensed swap for OpenAI CLIP. Its visual export has a fixed batch dim of 1, which is why CLIP still infers per-image while the other two encoders batch."
    },
    {
      "term": "DINOv2",
      "def": "Meta's self-supervised image-only encoder (Apache-2.0), 768-d, CLS-token embedding; a dynamic-batch ONNX export lets it batch inference."
    },
    {
      "term": "SigLIP-2",
      "def": "Google's sigmoid-loss image+text encoder (Apache-2.0), 768-d shared space, MAP-head pooler_output; also dynamic-batch."
    },
    {
      "term": "RRF",
      "def": "Reciprocal Rank Fusion (Cormack 2009, k=60) — fuses several per-encoder ranked lists into one; replaced the earlier tiered random-sampling diversity strategy."
    },
    {
      "term": "tiered random sampling",
      "def": "The pre-RRF image-image diversity strategy: sample across similarity tiers instead of a principled rank fusion. Retired by RRF (334a45c) but the code remains in cosine/index.rs for reference, uncalled from the frontend."
    },
    {
      "term": "WAL",
      "def": "SQLite write-ahead logging; lets the read-only secondary connection serve foreground reads without blocking the writer."
    },
    {
      "term": "FlatStore",
      "def": "The per-encoder embedding cache introduced by the 100k performance round: ids + inverse norms + one contiguous row-major f32 block, heap-owned or mmap-backed, scored as dot x q_inv x c_inv. Replaced ~400k boxed Array1 allocations across four caches with three flat arrays per encoder."
    },
    {
      "term": "generation token",
      "def": "An FNV fold of COUNT/SUM/MAX(rowid) over the enabled/orphaned embeddings JOIN — the freshness signal gating both the in-memory fusion slot and the on-disk FlatStore header. Detects root-toggle changes a bare mtime check cannot see."
    },
    {
      "term": "feed manifest",
      "def": "The compact per-tile row (id, basename, dims, thumbnail path, span — no tags, no notes, no original path) returned by get_feed_manifest; the steady-state read path for the main grid after the 100k round killed catalogue amplification."
    },
    {
      "term": "feed-delta",
      "def": "A batched Tauri event (<=64 rows) carrying newly-thumbnailed images during indexing, merged identity-preservingly into the unfiltered manifest cache; filtered manifest queries invalidate-and-refetch instead, because a delta row's tag membership is unknown client-side."
    },
    {
      "term": "fusion slot",
      "def": "The per-encoder FlatStore instance every search command borrows from since the primary CosineIndex was removed (1514a90); refreshed in place via CosineIndex::refresh_if_stale rather than duplicated into a separate primary index."
    },
    {
      "term": "mmap / memmap2",
      "def": "Memory-mapped file I/O; embstore_<encoder>.bin files are mapped zero-copy at startup via the memmap2 0.9 crate (confined to cosine/cache.rs), so a warm launch avoids rebuilding ~1 GB across ~400k allocations."
    },
    {
      "term": "stable-key shuffle",
      "def": "The per-image sort key hash(id, seed): a tile's position depends only on its own id and the current seed, so a refetch that adds newly-thumbnailed rows leaves every existing tile in place and drops newcomers into their own gap. Seed re-rolls only on a genuine feed entry (launch, or returning from search/similar)."
    },
    {
      "term": "adaptive thumbnail bucket",
      "def": "One of THUMBNAIL_BUCKETS = [480, 960, 1440, 2048]; base 480 is generated eagerly at index time, larger buckets on demand via get_thumbnail(id, target_px), never upscaling beyond the source's own resolution."
    },
    {
      "term": "security-scoped bookmark",
      "def": "The macOS App Sandbox mechanism (NSURL bookmark) that lets a user-picked root folder remain accessible across app relaunches; created/resolved/released around root mutations in multi_folder_roots."
    },
    {
      "term": "useSyncExternalStore",
      "def": "The React 18+ hook useIndexingStatus is now built on: one module-level singleton listener broadcasts primitive-slice snapshots, replacing the per-mount duplicate-listener pattern that caused the verified render storm."
    },
    {
      "term": "seed-then-upgrade",
      "def": "The selection pattern in [...slug].tsx: a click synchronously seeds an interim ImageItem from the already-in-hand FeedItem (thumbnail as stand-in full-res URL), then upgrades in place once the hydrated per-id detail lands — avoids blocking selection on an async hydration round-trip."
    },
    {
      "term": "embedding_pipeline_version",
      "def": "A meta-table gate; bumping it wipes legacy embeddings so the next indexing pass re-encodes cleanly."
    }
  ],
  "decisions": [
    {
      "title": "Extract the engine now, but keep image-era struct names",
      "why": "cf963ac: the media-agnostic core (db, cosine, paths, perf, domain structs) becomes crate mnemosyne so future audio/3D browsers share the substrate. The tempting deeper version — generalise rows to Asset and abstract an EncoderTrait — was deliberately NOT done: the engine is a path dependency with no frozen API, and the right time to design the encoder seam is when a second genuinely-different consumer pushes on it. Designing it against one product is designing it blind.",
      "node": "database"
    },
    {
      "title": "OpenCLIP LAION over OpenAI CLIP — weights-only, for licensing",
      "why": "00ee2fa: OpenAI CLIP weights are non-commercial-research-licensed and cannot ship in a paid app. immich-app OpenCLIP LAION-2B ViT-B/32 is MIT with an identical BPE tokenizer, identical preprocessing and identical 512-d output, so only two download URLs changed — no encoder code, no pipeline-version bump. All three encoders end up commercial-licensed (MIT / Apache-2.0 / Apache-2.0).",
      "node": "clip_image_encoder"
    },
    {
      "title": "Models move into a gitignored repo tree",
      "why": "00ee2fa: first-launch downloads landed in ~/Library/Application Support (invisible, and the wrong place for App Store bundling). scripts/download_models.py now fetches into models/<modality>/ inside the repo so weights are inspectable and the Tauri bundler has a clear source. .gitignore gained /models/ (the *.onnx rule did not cover the .json tokenizers).",
      "node": "model_download"
    },
    {
      "title": "apps/<product>/ monorepo layout to keep Tauri paths valid",
      "why": "f7d1422: each product lives under apps/<product>/ with its React frontend beside its src-tauri crate — the Tauri-monorepo convention chosen specifically so tauri.conf.json frontendDist ../dist and the npm before-commands stay valid without change. Kept npm (not pnpm) at the time: a package-manager swap mid-restructure was unverifiable risk for no structural gain. Reversed 2026-07-15 once a second and third product (Syrinx, Daedalus) were concretely on the roadmap — pnpm's content-addressable store avoids per-app node_modules duplication (602MB for one app under npm; the planned three products share nearly all of that footprint), and the migration surface (4 root scripts, a handful of README lines) was cheap while only one product existed. See pnpm-workspace.yaml and the justfile.",
      "node": "app_shell"
    },
    {
      "title": "Pin ort at rc.10 at the workspace root, do not chase rc.12",
      "why": "cf963ac: the caret ort 2.0.0-rc.10 also matched rc.12, which the fresh workspace resolve silently pulled — rc.12 made Session::inputs/outputs private, breaking two encoder modules with E0616. The fix was to promote the pinned Cargo.lock to the workspace root (a workspace shares one lock), preserving the exact versions that compiled; the ort bump is a separate decision, not a refactor side effect.",
      "node": "clip_image_encoder"
    },
    {
      "title": "--profiling not --profile (flag-name collision)",
      "why": "main.rs //! + 0c45ab7: --profile collides with cargo's own profile-selection flag when passed through --, so the runtime flag is --profiling (also accepts PROFILING=1). PerfLayer only mounts when it is set; without it the whole profiling path is dormant at ~zero overhead.",
      "node": "profiling"
    },
    {
      "title": "Platform app-data dir, not a repo-local Library/",
      "why": "9a323ad (reverting 3c2900f): user state briefly moved into <repo>/Library/ for visibility, but dev and release builds diverged on every code change, forcing 2.5 GB model re-downloads on each switch. Reverted to the platform default (now com.ataca.lynceus) with a LYNCEUS_DATA_DIR override; the com.ataca.lynceus rename orphans any library indexed under the old id (acceptable — DB re-indexes cheaply).",
      "node": "paths_and_state"
    },
    {
      "title": "Reciprocal Rank Fusion replaced tiered random sampling",
      "why": "334a45c: image-image similarity fuses CLIP + SigLIP-2 + DINOv2 ranked lists via RRF (k=60) instead of the earlier tiered random-sampling diversity strategy, giving a principled multi-encoder ranking. The old tiered path remains in cosine/index.rs for reference but is no longer called from the frontend.",
      "node": "multi_encoder_fusion"
    },
    {
      "title": "Dual writer/read-only SQLite connections under WAL",
      "why": "0bdb5f4 + audit: a single connection made foreground get_images queue behind in-flight encoder write batches (a 22s freeze). A read-only secondary opened on the same WAL file serves foreground SELECTs via read_lock(); it falls back to the writer mutex if it cannot open, and :memory: test DBs deliberately have none.",
      "node": "database"
    },
    {
      "title": "Primary CosineIndex removed entirely — the pipeline's step-7 duplicate populate dies with it",
      "why": "1514a90: the mission's mandatory invalidation-trace-first requirement turned a planned cleanup into a bug fix — tracing how fusion slots refresh revealed fc6667a's reroute onto fusion slots had introduced a LATENT REGRESSION: fusion slots are cleared only by root add/remove/toggle with no pipeline handle, so after a mid-session index, search would serve rankings missing the newly-encoded images until relaunch. The fix replaces the pipeline's step-7 primary populate+save with a token-gated refresh of every enabled encoder's fusion slot (CosineIndex::refresh_if_stale); CosineIndexState (struct, ensure_loaded_for/invalidate, the .manage() registration, the two Arcs threaded through the pipeline) is REMOVED outright because every search command now borrows fusion slots.",
      "node": "cosine_similarity"
    },
    {
      "title": "Search goes ID-native end-to-end",
      "why": "fc6667a: the cosine index, RRF fusion, and all search commands carry image_id instead of PathBuf; exclusion is an inline id compare. Replaces the up-front db.get_all_images() join (a 200-300k-row LEFT JOIN unroll per request at 100k, fired 20-30x per settled viewport by the prefetch) plus the per-result thumbnail N+1 with one shared hydrate_search_results doing a single WHERE id IN fetch over the ~30 result rows. The path->id resolution helper died outright — ids were being round-tripped through paths that were ids to begin with.",
      "node": "cosine_similarity"
    },
    {
      "title": "Flat mmap embedding store (FlatStore) replaces ~400k boxed Array1 allocations",
      "why": "fc6667a: one contiguous row-major f32 block per encoder plus ids and inverse norms, scored as dot x q_inv x c_inv. Real (never-assumed-unit) norms are folded in at birth so legacy pre-normalise CLIP rows keep exact scores. Persisted as one versioned 64-byte-header file per encoder (magic, format version, encoder hash, dim, row count, generation token), mapped zero-copy at startup — genuinely zero-copy, asserted by tests. The generation token (FNV fold of count/sum/max-rowid over the same enabled/orphaned JOIN the store is built from) replaces a bare mtime check that could never see a root-toggle change that leaves the embeddings table untouched.",
      "node": "cosine_similarity"
    },
    {
      "title": "No id->row lookup structure built for the flat store",
      "why": "fc6667a: scoring is a full linear scan and exclusion is inline, so a 100k-entry HashMap (~10 MB per encoder) would have had zero consumers. Deliberately not built — a documented case of NOT adding a structure the access pattern doesn't need.",
      "node": "cosine_similarity"
    },
    {
      "title": "Feed manifest + batched delta events over a persisted get_changes_since(version) counter",
      "why": "012012c: get_changes_since(version) was considered and rejected — it needs a persisted monotonic version source (a schema migration) or an in-memory counter that is restart-fragile (a relaunch mid-index would have no way to resume from where the client last saw). The chosen design (batched best-effort feed-delta events + Phase::Ready reconciliation) gets losslessness for free: the event stream is cheap and allowed to be lossy because the terminal reconcile — not the events themselves — is the actual correctness guarantee.",
      "node": "feed_protocol"
    },
    {
      "title": "Masonry pack moves off the main thread onto typed arrays; Float64, not Float32",
      "why": "012012c: computeMasonryLayout was refactored to a thin decorator over one computeMasonryGeometry core (no algorithm fork — all 21 packing tests pass unchanged) run in a Vite module Worker. Float64 was chosen deliberately over Float32 so scores stay bit-for-bit identical to the object-pack implementation (proven by a 200-trial equivalence test); Float32 would transfer faster but would not preserve exact tie-break ordering.",
      "node": "masonry_layout"
    },
    {
      "title": "useIndexingStatus rebuilt on useSyncExternalStore with one module-level singleton listener",
      "why": "ebe4006: the verified render storm — per-event message state inside the route's fiber, 2-3 duplicate Tauri listeners each invalidating pipelineStats, unstable route handlers defeating every visible tile's memo — was dismantled the lighter way the verification recommended, not with an external state-management library. A single module-level listener broadcasts primitive-slice snapshots (usePipelineStats/useIsIndexing/useIndexingPhase); the old hook name survives as a thin wrapper so the pill's mocked tests didn't churn.",
      "node": "frontend_state"
    },
    {
      "title": "Adaptive on-demand thumbnail buckets, generated lazily rather than eagerly",
      "why": "b12ba46: {480, 960, 1440, 2048} — base 480 is produced eagerly at index time (keeps pop-in fast); 960/1440/2048 generate on first request and cache. Chosen over an eager full ladder to keep indexing fast and disk lean, at the cost of a one-time blur-to-sharp the first time a tile is stretched past its currently-cached bucket.",
      "node": "thumbnail_pipeline"
    },
    {
      "title": "CLIP stays per-image; only SigLIP-2/DINOv2 got batched inference",
      "why": "ebe4006: the OpenCLIP visual/model.onnx export declares a fixed batch dim of 1 (documented in encoder.rs); batching CLIP requires a model re-export, which touches weights provenance — a live pre-sale concern. SigLIP-2/DINOv2's exports are dynamic-batch, so both override the encoder trait's one-by-one default with a single [N,3,H,W] session call per chunk. Equivalence proven against real models: per-image cosine >= 0.9999996 across both encoders.",
      "node": "clip_image_encoder"
    },
    {
      "title": "Stable per-image shuffle key hash(id, seed) replaces four sort modes",
      "why": "b12ba46: the naive shuffle-as-default (tried and reverted 2026-04-26) combined with progressive thumbnail loading made the whole grid visibly reshuffle on every background refetch. The fix ties a tile's position to only its own id and the current seed, so a refetch that adds newly-thumbnailed rows leaves every existing tile exactly where it was and drops each newcomer into its own gap. The seed re-rolls only on a genuine feed entry (launch, or returning from a search/similar view).",
      "node": "frontend_state"
    }
  ],
  "risks": [
    {
      "sev": "med",
      "title": "assetProtocol scope is [**] with csp:null",
      "node": "tauri_commands",
      "trigger": "Fine for a single-user local tool loading only its own bundled HTML; flagged as an App-Store hardening target in enhancements/recommendations/08. Tightening the scope before a public release is a pre-1.0 gate."
    },
    {
      "sev": "med",
      "title": "CLIP tokenizer provenance not yet MIT-sourced",
      "node": "model_download",
      "trigger": "clip_tokenizer.json is mirrored from an OpenAI (Xenova) export; must be re-sourced from an explicitly-MIT repo before the paid release even though it is the open_clip vocab in practice."
    },
    {
      "sev": "low",
      "title": "Watcher unwatched-new-root gap",
      "node": "watcher",
      "trigger": "A file added to a freshly-added root before the next app launch is not picked up until relaunch; the WatcherHandle is not rebuilt on add_root/remove_root."
    },
    {
      "sev": "low",
      "title": "Release-build weight resolution unfinished",
      "node": "paths_and_state",
      "trigger": "models_dir() resolves LYNCEUS_MODELS_DIR then app-data; loading bundled weights from Tauri's resource dir in a signed release is a documented follow-up (the engine cannot reach Tauri's resolver, so the product crate must pass the path in)."
    },
    {
      "sev": "low",
      "title": "Cross-encoder dimension mismatch surfaces late",
      "node": "cosine_similarity",
      "trigger": "Picking an encoder with zero indexed embeddings returns empty results (cosine_cache_populated count=0) rather than an explicit UI message; only the diagnostic reveals the cause."
    },
    {
      "sev": "med",
      "title": "THUMBNAIL_BUCKETS is hand-duplicated across Rust and TS",
      "node": "thumbnail_pipeline",
      "trigger": "A future change to the ladder ([480, 960, 1440, 2048]) on one side only — the Rust const in generator.rs versus the parallel TS const in useAdaptiveThumbnail.ts — desyncs silently: get_thumbnail's bucket snap and the frontend's own bucketFor would disagree on which file gets requested. No shared-codegen guard exists yet."
    },
    {
      "sev": "low",
      "title": "Post-index write-lock window blocks searches ~3s on a multi-encoder import",
      "node": "multi_encoder_fusion",
      "trigger": "At Phase::Ready a CHANGED encoder's fusion-slot refresh (populate + persist) holds that slot's write lock ~0.5-1s/encoder at 100k; a full three-encoder import blocks searches ~3s in that window. Token-gating makes an unchanged-encoder no-op rescan free; the named follow-up is build-outside-lock-then-swap."
    },
    {
      "sev": "low",
      "title": "Embedding-store files are native-little-endian by construction",
      "node": "cosine_similarity",
      "trigger": "Zero-copy mmap casts are inherently native-endian; fine for this desktop-only, single-arch-per-install app today, but a big-endian host (or any future cross-arch sync/import of embstore_*.bin) would misread the block — the header carries no endianness flag to detect this."
    },
    {
      "sev": "low",
      "title": "GestureTimerConfigPanel's mode=\\"start\\" branch is unreachable in current wiring",
      "node": "gesture_timer",
      "trigger": "GestureTimer only ever opens the config panel via openRunningConfig, which requires a session already running — a leftover from the pre-fcad704 two-step flow. The 'Set up timer'/'Start session' copy variant is real, tested code with no live entry point; a maintainer changing the open-state wiring should know this branch predates the inline-setup redesign rather than assume it is speculative future work."
    },
    {
      "sev": "low",
      "title": "save_to_disk and paths::cosine_cache_path are dead code left in place",
      "node": "cosine_similarity",
      "trigger": "Orphaned by the primary-index removal (1514a90) — nothing calls either any more, but both are public/tested surface so they weren't deleted this round. Low-risk clutter flagged for the next hygiene pass on cache.rs/paths.rs specifically."
    }
  ],
  "alerts": [],
  "changeFrontier": [],
  "kpis": [
    {
      "label": "Subsystems",
      "value": "23",
      "unit": "live",
      "delta": "engine 5 + product 13 + frontend 5 · +2 (feed_protocol, gesture_timer) this pass",
      "tone": "sage"
    },
    {
      "label": "Rust tests",
      "value": "172",
      "unit": "lib",
      "delta": "lynceus 44 + integration 13 + mnemosyne 115 · +47 over the pre-round baseline",
      "tone": "sage"
    },
    {
      "label": "Frontend tests",
      "value": "116",
      "unit": "vitest",
      "delta": "13 files · +54 since the v2 baseline",
      "tone": ""
    },
    {
      "label": "Encoders",
      "value": "3",
      "unit": "ONNX",
      "delta": "SigLIP-2/DINOv2 batch inference; CLIP stays per-image (weights provenance)",
      "tone": "violet"
    },
    {
      "label": "Feed manifest",
      "value": "0",
      "unit": "tags/notes per tile",
      "delta": "was a 200-300k row LEFT JOIN unroll per request at 100k -> id/dims/thumbnail-only rows",
      "tone": "sage"
    },
    {
      "label": "Embedding store",
      "value": "~1",
      "unit": "GB, mapped",
      "delta": "~400k boxed Array1 allocs across four caches -> 3 flat arrays/encoder, zero-copy mmap",
      "tone": "violet"
    },
    {
      "label": "Masonry worker pack",
      "value": "3.6",
      "unit": "MB",
      "delta": "was ~15-25 MB of placement objects + Map at 100k",
      "tone": "sage"
    },
    {
      "label": "Tauri commands",
      "value": "35",
      "unit": "IPC",
      "delta": "typed ApiError surface · +7 (feed manifest/detail, thumbnail buckets, drawer tag counts)",
      "tone": ""
    },
    {
      "label": "Weights",
      "value": "~2.4",
      "unit": "GB",
      "delta": "gitignored models/image/",
      "tone": "amber"
    }
  ],
  "lineage": {
    "total": 191,
    "range": [
      "2025-11-19",
      "2026-07-17"
    ],
    "peak": 70,
    "buckets": [
      {
        "date": "2025-11-19",
        "total": 49,
        "counts": {
          "foundation": 36,
          "retrieval": 12,
          "perf": 1
        }
      },
      {
        "date": "2025-12-09",
        "total": 13,
        "counts": {
          "retrieval": 7,
          "feedui": 1,
          "pipeline": 2,
          "perf": 1,
          "foundation": 2
        }
      },
      {
        "date": "2025-12-29",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-01-18",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-02-07",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-02-27",
        "total": 2,
        "counts": {
          "retrieval": 1,
          "foundation": 1
        }
      },
      {
        "date": "2026-03-19",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-04-08",
        "total": 70,
        "counts": {
          "modular": 18,
          "pipeline": 9,
          "retrieval": 15,
          "perf": 27,
          "foundation": 1
        }
      },
      {
        "date": "2026-04-28",
        "total": 1,
        "counts": {
          "modular": 1
        }
      },
      {
        "date": "2026-05-18",
        "total": 1,
        "counts": {
          "foundation": 1
        }
      },
      {
        "date": "2026-06-07",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-06-27",
        "total": 55,
        "counts": {
          "commercial": 11,
          "modular": 3,
          "feedui": 19,
          "foundation": 2,
          "retrieval": 1,
          "perf": 11,
          "pipeline": 1
        }
      }
    ],
    "themes": [
      {
        "key": "foundation",
        "label": "Foundation & early UI",
        "color": "var(--chart-1)"
      },
      {
        "key": "retrieval",
        "label": "Encoders & retrieval",
        "color": "var(--chart-2)"
      },
      {
        "key": "pipeline",
        "label": "Indexing & DB",
        "color": "var(--chart-3)"
      },
      {
        "key": "feedui",
        "label": "Feed & masonry UI",
        "color": "var(--chart-4)"
      },
      {
        "key": "perf",
        "label": "Perf & scale",
        "color": "var(--chart-5)"
      },
      {
        "key": "modular",
        "label": "Context & tooling",
        "color": "var(--chart-6)"
      },
      {
        "key": "commercial",
        "label": "Commercialisation",
        "color": "var(--chart-1)"
      }
    ],
    "series": [
      "foundation",
      "retrieval",
      "pipeline",
      "feedui",
      "perf",
      "modular",
      "commercial"
    ],
    "phases": [
      {
        "n": 1,
        "title": "Foundation",
        "period": "2025-11",
        "commits": "~30",
        "theme": "foundation",
        "summary": "A recursive image finder, a simple SQLite DB, an image struct, and a Pinterest masonry grid with tag CRUD and a search bar. The skeleton of a local image browser.",
        "highlights": [
          {
            "h": "651aa4c",
            "t": "added simple sqlite db"
          },
          {
            "h": "2b68626",
            "t": "masonry"
          },
          {
            "h": "cbdb07b",
            "t": "proper tag fetching/deleting/updating"
          }
        ]
      },
      {
        "n": 2,
        "title": "Retrieval core",
        "period": "2025-11..12",
        "commits": "~35",
        "theme": "retrieval",
        "summary": "ONNX CLIP embeddings, a cosine similarity index, batch encoding, tiered similar-images, and the first natural-language semantic search. The browser became a search engine.",
        "highlights": [
          {
            "h": "121b8c1",
            "t": "Add ONNX model and semantic search encoder"
          },
          {
            "h": "16cf7d3",
            "t": "Add cosine similarity index and batch encoder"
          },
          {
            "h": "0e33b1e",
            "t": "Add Pinterest-style tiered similar images and modal"
          }
        ]
      },
      {
        "n": 3,
        "title": "Quiet stretch + semantic text search",
        "period": "2025-12..2026-03",
        "commits": "~5",
        "theme": "retrieval",
        "summary": "A long low-cadence stretch closed by merging the semantic-text-search branch and tidying the README. The lull before the surge.",
        "highlights": [
          {
            "h": "ae000a9",
            "t": "Improve semantic search and tokenizer case handling"
          },
          {
            "h": "50a7a6b",
            "t": "Merge semantic-text-search"
          }
        ]
      },
      {
        "n": 4,
        "title": "The April surge",
        "period": "2026-04-25..26",
        "commits": "~70",
        "theme": "perf",
        "summary": "A single autonomous burst: a context/ memory layer, platform-correct app-data, native folder picker, an async indexing pipeline with live progress, multi-folder + filesystem watcher + orphan detection, an opt-in profiling + diagnostics system, a 23-finding code-health audit (db/cosine/lib.rs splits, typed ApiError everywhere), the multi-encoder picker (CLIP + DINOv2 + SigLIP-2), RRF fusion, and the dual-connection WAL perf work.",
        "tried": "User state moved into <repo>/Library/ for visibility, then reverted to platform app-data because dev/release divergence forced 2.5 GB re-downloads; --profile renamed to --profiling after a cargo flag collision.",
        "highlights": [
          {
            "h": "48a202c",
            "t": "Pass 5: async indexing pipeline + live progress UI"
          },
          {
            "h": "334a45c",
            "t": "Phase 5 — multi-encoder rank fusion (RRF)"
          },
          {
            "h": "cda7caa",
            "t": "Typed errors: Result<T, ApiError> across every command"
          }
        ]
      },
      {
        "n": 5,
        "title": "Commercialisation pivot",
        "period": "2026-07-15",
        "commits": "5",
        "theme": "commercial",
        "summary": "After a quiet maintenance lull (README rewritten to the real feature surface; iCloud sync-conflict duplicates cleaned up and gitignored), the portfolio piece becomes a product: OpenAI CLIP swapped for MIT OpenCLIP so all weights are commercially licensed, the media-agnostic core extracted into the Mnemosyne engine crate, the repo reshaped into an apps/ monorepo and rebranded Lynceus (product) / Mnemosyne (engine), weights relocated into a gitignored repo tree. Aimed at a Mac App Store paid release.",
        "tried": "A fresh workspace resolve silently pulled ort rc.12 (breaking two encoder modules); fixed by promoting the pinned rc.10 Cargo.lock to the workspace root rather than chasing the new API.",
        "highlights": [
          {
            "h": "00ee2fa",
            "t": "Models move into the repo tree, and CLIP is swapped to a commercially-licensed OpenCLIP"
          },
          {
            "h": "cf963ac",
            "t": "Extract the Mnemosyne engine"
          },
          {
            "h": "f7d1422",
            "t": "Reshape into an apps/ monorepo and rebrand to Lynceus/Mnemosyne"
          }
        ]
      },
      {
        "n": 6,
        "title": "The v2 UI overhaul",
        "period": "2026-07-15",
        "commits": "~40",
        "theme": "feedui",
        "summary": "Same day as the pivot, a second enormous burst rebuilds the feed, masonry, indexing-progress, and settings systems from first principles: one always-shuffled feed keyed by a stable per-image hash, the 514-line Masonry component split into headless packing/drag/resize hooks, adaptive on-demand thumbnail buckets, a single source of truth for indexing progress, then a premium dark-gallery visual layer (built by a cross-family GPT executor against a locked logic contract) across 21 presentational components. The library drawer, a first gesture-drawing timer, and five 'coherence pass' commits (search bar and drawer become one filter; stale similarity/search/count results stop being served; a selection render-loop crash dies) round out the round.",
        "tried": "The 3D-tilt hover and amber corner-bracket resize handles were built then removed for reading as cheap and causing a 'yellow line' edge flare through the global focus outline; replaced by elegant corner brackets in the v2 visual pass.",
        "highlights": [
          {
            "h": "b12ba46",
            "t": "Rebuild the feed, masonry, and indexing-progress systems for v2"
          },
          {
            "h": "977e693",
            "t": "The v2 visual layer — a dark-gallery design system"
          },
          {
            "h": "e60fb70",
            "t": "Settings redesign + gesture-drawing timer mode, and the library-drawer components"
          },
          {
            "h": "889b765",
            "t": "Masonry: resize and drag no longer freeze the UI"
          }
        ]
      },
      {
        "n": 7,
        "title": "The 100k performance round",
        "period": "2026-07-16..17",
        "commits": "~13",
        "theme": "perf",
        "summary": "A verified roadmap (20 advisor ideas audited against the code, culled to 12 items in 3 tiers) lands as three architectural builds: the feed stops re-materialising the world (compact manifest + batched feed-delta events), search goes ID-native over a flat mmap-persisted embedding store per encoder, and masonry packing moves off the main thread onto typed arrays in a Web Worker. A follow-up commit then removes the now-redundant primary CosineIndex entirely, which also fixes a latent post-index staleness regression the ID-native reroute had quietly introduced. The round closes at v0.5.0, retiring the plan folder into context/notes/performance-decisions.md.",
        "tried": "get_changes_since(version) was designed against and rejected — it needs a persisted monotonic version source or a restart-fragile counter; batched feed-delta events plus Phase::Ready reconciliation shipped instead. A byte-capped decode LRU, route-level React.lazy code-splitting, and CLIP batched inference were also evaluated and rejected or deferred (context/notes/performance-decisions.md).",
        "highlights": [
          {
            "h": "780a4f8",
            "t": "Performance roadmap survives its own audit"
          },
          {
            "h": "ebe4006",
            "t": "Perf round wave 1: nine verified roadmap items land"
          },
          {
            "h": "fc6667a",
            "t": "T3-2: search goes ID-native and the embedding caches collapse into flat, mmap-persisted stores"
          },
          {
            "h": "1514a90",
            "t": "The primary cosine index dies, and its removal fixes a staleness regression"
          }
        ]
      }
    ],
    "arc": "Lynceus began in November 2025 as a local Pinterest-style image browser — SQLite, a masonry grid, tags. It quickly grew a retrieval brain (CLIP embeddings, cosine search, semantic queries), then went quiet over the winter. In late April 2026 a single enormous autonomous burst turned it into a serious tool: an async indexing pipeline, three ONNX encoders with rank fusion, multi-folder watching, an opt-in profiling system, and a full code-health audit. In mid-July 2026 the project entered its most compressed stretch yet: a commercialisation pivot split the reusable Mnemosyne engine out of the Lynceus product and swapped every model to a commercial licence, a same-day v2 UI overhaul rebuilt the feed, masonry, and indexing-progress systems with a premium visual layer, and — within 48 hours — a verified 100k-scale performance round replaced the primary embedding index with flat mmap stores, made the feed manifest-and-delta rather than full-refetch, and moved masonry packing onto a Web Worker, closing the round at v0.5.0."
  },
  "repoTree": {
    "name": "PinterestStyleImageBrowser/",
    "anno": "Repo root (folder still named for the portfolio era; product is Lynceus, engine Mnemosyne)",
    "children": [
      {
        "name": "Cargo.lock",
        "anno": "Single workspace lock; pins ort 2.0.0-rc.10 for both crates",
        "file": true
      },
      {
        "name": "Cargo.toml",
        "anno": "Cargo workspace root: members crates/engine + apps/lynceus/src-tauri",
        "file": true
      },
      {
        "name": "README.md",
        "anno": "Front door — rebranded to Lynceus/Mnemosyne; monorepo + OpenCLIP + repo-local weights",
        "file": true
      },
      {
        "name": "apps/",
        "anno": "npm + Cargo product workspace (workspaces apps/*)",
        "children": [
          {
            "name": "lynceus/",
            "anno": "The Lynceus image product: React frontend beside its Tauri app crate",
            "children": [
              {
                "name": "components.json",
                "anno": "shadcn-ui registry config",
                "file": true
              },
              {
                "name": "index.html",
                "anno": "Vite entry HTML",
                "file": true
              },
              {
                "name": "package-lock.json",
                "anno": "npm lockfile",
                "file": true
              },
              {
                "name": "package.json",
                "anno": "lynceus-ui frontend deps + scripts",
                "file": true
              },
              {
                "name": "public/",
                "anno": "Static assets served by Vite"
              },
              {
                "name": "src/",
                "anno": "React 19 frontend (lynceus-ui)"
              },
              {
                "name": "src-tauri/",
                "anno": "Lynceus Tauri app crate (package lynceus, lib lynceus_lib)"
              },
              {
                "name": "tsconfig.json",
                "anno": "@/ alias -> src",
                "file": true
              },
              {
                "name": "tsconfig.node.json",
                "anno": "Node-side tsconfig",
                "file": true
              },
              {
                "name": "vite.config.ts",
                "anno": "Tailwind v4 + plugin-react + vite-plugin-pages",
                "file": true
              },
              {
                "name": "vitest.config.ts",
                "anno": "JSDOM test env",
                "file": true
              }
            ]
          }
        ]
      },
      {
        "name": "context/",
        "anno": "Repository memory layer (this documentation)",
        "children": [
          {
            "name": "arch/",
            "anno": "Editable source for architecture.html (data.js + callgraph.js + vendored shell)",
            "children": [
              {
                "name": "app.js",
                "anno": "Vendored explorer runtime (do not hand-edit)",
                "file": true
              },
              {
                "name": "features.js",
                "anno": "Vendored persistence layer",
                "file": true
              },
              {
                "name": "graph.js",
                "anno": "Vendored dependency-graph renderer",
                "file": true
              },
              {
                "name": "index.html",
                "anno": "Vite entry HTML",
                "file": true
              },
              {
                "name": "styles.css",
                "anno": "Vendored explorer styles",
                "file": true
              }
            ]
          },
          {
            "name": "enhancements/",
            "anno": "project-enhancement output: audience, recommendations, research archive",
            "children": [
              {
                "name": "_research/",
                "anno": "External research papers + sources (project-enhancement)"
              },
              {
                "name": "audience.md",
                "anno": "Implicit audiences for the project",
                "file": true
              },
              {
                "name": "index.md",
                "anno": "Enhancements index",
                "file": true
              },
              {
                "name": "recommendations/",
                "anno": "Additive enhancement proposals (R01-R11)"
              },
              {
                "name": "research_plan.md",
                "anno": "Enhancement research plan",
                "file": true
              },
              {
                "name": "synthesis.md",
                "anno": "Enhancement synthesis + tech-supersession scan",
                "file": true
              }
            ]
          },
          {
            "name": "notes/",
            "anno": "Design rationale, conventions, durable lessons",
            "children": [
              {
                "name": "clip-preprocessing-decisions.md",
                "anno": "Why each encoder uses its exact preprocessing",
                "file": true
              },
              {
                "name": "conventions.md",
                "anno": "Recurring code conventions (locks, ApiError, re-export facade)",
                "file": true
              },
              {
                "name": "dead-code-inventory.md",
                "anno": "Tracked dead/vestigial code",
                "file": true
              },
              {
                "name": "encoder-additions-considered.md",
                "anno": "Encoders weighed and deferred",
                "file": true
              },
              {
                "name": "fusion-architecture.md",
                "anno": "RRF fusion design rationale",
                "file": true
              },
              {
                "name": "local-first-philosophy.md",
                "anno": "Offline-first + commercialisation framing",
                "file": true
              },
              {
                "name": "mutex-poisoning.md",
                "anno": "Lock-poison -> ApiError recovery pattern",
                "file": true
              },
              {
                "name": "path-and-state-coupling.md",
                "anno": "paths::*_dir single-source coupling",
                "file": true
              },
              {
                "name": "preprocessing-spatial-coverage.md",
                "anno": "Open concern: centre-crop drops edge content",
                "file": true
              },
              {
                "name": "random-shuffle-as-feature.md",
                "anno": "Shuffle sort mode as a deliberate feature",
                "file": true
              }
            ]
          },
          {
            "name": "notes.md",
            "anno": "Index of the notes/ folder",
            "file": true
          },
          {
            "name": "plans/",
            "anno": "Active + archived execution plans",
            "children": [
              {
                "name": "code-health-audit/",
                "anno": "Completed 2026-04-26 code-health audit archive"
              }
            ]
          },
          {
            "name": "references/",
            "anno": "Durable supporting research",
            "children": [
              {
                "name": "m2-perf-options-2026-04.md",
                "anno": "M2 perf options (several now shipped)",
                "file": true
              }
            ]
          },
          {
            "name": "systems/",
            "anno": "Per-subsystem canonical docs (one file per subsystem)",
            "children": [
              {
                "name": "clip-image-encoder.md",
                "anno": "OpenCLIP LAION image encoder",
                "file": true
              },
              {
                "name": "clip-text-encoder.md",
                "anno": "OpenCLIP LAION text encoder",
                "file": true
              },
              {
                "name": "cosine-similarity.md",
                "anno": "Engine cosine index + partial sort",
                "file": true
              },
              {
                "name": "database.md",
                "anno": "Engine SQLite/WAL catalogue",
                "file": true
              },
              {
                "name": "dinov2-encoder.md",
                "anno": "DINOv2-Base image encoder",
                "file": true
              },
              {
                "name": "filesystem-scanner.md",
                "anno": "Recursive image discovery",
                "file": true
              },
              {
                "name": "frontend-state.md",
                "anno": "TanStack Query + prefs + events",
                "file": true
              },
              {
                "name": "indexing.md",
                "anno": "Background indexing pipeline",
                "file": true
              },
              {
                "name": "masonry-layout.md",
                "anno": "Shortest-column masonry",
                "file": true
              },
              {
                "name": "model-download.md",
                "anno": "HF weight fetch + download_models.py",
                "file": true
              },
              {
                "name": "multi-encoder-fusion.md",
                "anno": "RRF across encoders",
                "file": true
              },
              {
                "name": "multi-folder-roots.md",
                "anno": "Multiple library roots",
                "file": true
              },
              {
                "name": "paths-and-state.md",
                "anno": "On-disk path resolution + state",
                "file": true
              },
              {
                "name": "profiling.md",
                "anno": "Opt-in span + diagnostic layer",
                "file": true
              },
              {
                "name": "search-routing.md",
                "anno": "Frontend priority router",
                "file": true
              },
              {
                "name": "siglip2-encoder.md",
                "anno": "SigLIP-2 image+text encoder",
                "file": true
              },
              {
                "name": "tag-system.md",
                "anno": "Tag CRUD + AND/OR filter",
                "file": true
              },
              {
                "name": "tauri-commands.md",
                "anno": "28-command IPC surface",
                "file": true
              },
              {
                "name": "thumbnail-pipeline.md",
                "anno": "NEON JPEG thumbnailer",
                "file": true
              },
              {
                "name": "watcher.md",
                "anno": "Filesystem watcher",
                "file": true
              }
            ]
          }
        ]
      },
      {
        "name": "crates/",
        "anno": "Cargo workspace crates",
        "children": [
          {
            "name": "engine/",
            "anno": "Mnemosyne engine crate (package mnemosyne)",
            "children": [
              {
                "name": "Cargo.toml",
                "anno": "Cargo workspace root: members crates/engine + apps/lynceus/src-tauri",
                "file": true
              },
              {
                "name": "src/",
                "anno": "React 19 frontend (lynceus-ui)"
              }
            ]
          }
        ]
      },
      {
        "name": "models/",
        "anno": "Gitignored encoder weights tree (fetched by download_models.py)",
        "children": [
          {
            "name": "3d/",
            "anno": "Placeholder for the future Daedalus 3D vertical"
          },
          {
            "name": "audio/",
            "anno": "Placeholder for the future Syrinx audio vertical"
          },
          {
            "name": "image/",
            "anno": "Lynceus image encoder weights (~2.4 GB, gitignored)",
            "children": [
              {
                "name": "clip_text.onnx",
                "anno": "OpenCLIP LAION text weights",
                "file": true
              },
              {
                "name": "clip_tokenizer.json",
                "anno": "CLIP BPE tokenizer (Xenova mirror)",
                "file": true
              },
              {
                "name": "clip_vision.onnx",
                "anno": "OpenCLIP LAION vision weights",
                "file": true
              },
              {
                "name": "dinov2_base_image.onnx",
                "anno": "DINOv2-Base weights",
                "file": true
              },
              {
                "name": "siglip2_text.onnx",
                "anno": "SigLIP-2 text weights",
                "file": true
              },
              {
                "name": "siglip2_tokenizer.json",
                "anno": "SigLIP-2 Gemma SentencePiece",
                "file": true
              },
              {
                "name": "siglip2_vision.onnx",
                "anno": "SigLIP-2 vision weights",
                "file": true
              }
            ]
          }
        ]
      },
      {
        "name": "package-lock.json",
        "anno": "npm lockfile",
        "file": true
      },
      {
        "name": "package.json",
        "anno": "lynceus-ui frontend deps + scripts",
        "file": true
      },
      {
        "name": "scripts/",
        "anno": "Dev tooling",
        "children": [
          {
            "name": "README.md",
            "anno": "Front door — rebranded to Lynceus/Mnemosyne; monorepo + OpenCLIP + repo-local weights",
            "file": true
          },
          {
            "name": "download_lol_splashes.py",
            "anno": "Test-corpus image downloader",
            "file": true
          },
          {
            "name": "download_models.py",
            "anno": "Fetches encoder weights into models/<modality>/",
            "file": true
          }
        ]
      }
    ]
  },
  "bespoke": [],
  "techStack": [
    {
      "name": "Rust",
      "meta": "2021 edition · Cargo workspace (engine + product)"
    },
    {
      "name": "Tauri",
      "meta": "v2 · protocol-asset · dialog + opener plugins"
    },
    {
      "name": "React",
      "meta": "19 · Vite 7 · TanStack Query 5 · Tailwind v4"
    },
    {
      "name": "ort (ONNX Runtime)",
      "meta": "2.0.0-rc.10 · CPU on macOS · CUDA fallback elsewhere"
    },
    {
      "name": "rusqlite",
      "meta": "0.37 bundled · WAL · dual writer/read-only conns"
    },
    {
      "name": "memmap2",
      "meta": "0.9 · zero-copy per-encoder flat embedding store, confined to cosine/cache.rs — NEW this round"
    },
    {
      "name": "OpenCLIP / DINOv2 / SigLIP-2",
      "meta": "3 ONNX encoders · MIT / Apache-2.0 / Apache-2.0 — all commercially licensed"
    },
    {
      "name": "HF tokenizers",
      "meta": "0.22 · CLIP BPE + Gemma SentencePiece"
    },
    {
      "name": "fast_image_resize + jpeg-decoder",
      "meta": "6.x NEON Lanczos3 · scaled IDCT"
    },
    {
      "name": "rayon",
      "meta": "parallel thumbnailing + per-chunk batch encoding"
    },
    {
      "name": "HuggingFace weights",
      "meta": "fetched by scripts/download_models.py into a gitignored repo-local models/ tree, or app-data on first launch (LYNCEUS_MODELS_DIR-first resolution)"
    }
  ]
}`);
