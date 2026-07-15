/* ============================================================
   data.js - written by upkeep-context upkeep-context author (frameBudget cleanup)
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
    "deleted_edge_keys": [],
    "frontier_locked": false,
    "repotree_locked": true
  },
  "schema": "v2",
  "project": {
    "name": "Lynceus / Mnemosyne",
    "file": "context/architecture.html",
    "head": "a547c8e",
    "headRange": "9b416de..a547c8e",
    "regenerated": "2026-07-15",
    "stack": "Rust workspace (engine + Tauri 2 product) + React 19 · ONNX Runtime 2.0.0-rc.10 · SQLite/WAL",
    "milestone": "Commercialisation pivot: Mnemosyne engine extracted, OpenCLIP swap, App-Store-bound",
    "tests": "cargo test --workspace: 125 lib (lynceus 36 + mnemosyne 89) + integration green · vitest 62/62",
    "commits": 5,
    "lines": 2231175,
    "tagline": "Lynceus is a local-first Tauri 2 + React 19 desktop image browser — browse, tag, annotate, and semantically search large personal image libraries entirely offline. As of the commercialisation pivot it is the first product (vertical 1) built on Mnemosyne, a reusable media-agnostic catalogue + embedding-retrieval engine extracted into its own crate. Retrieval runs three ONNX encoder families (OpenCLIP LAION ViT-B/32, DINOv2-Base, SigLIP-2 Base 256) with Reciprocal Rank Fusion; the SQLite/WAL catalogue, cosine ranking, path resolution and profiling live in the engine, the image-specific encoders, thumbnailer, indexing pipeline and Tauri surface live in the product. It is heading for a Mac App Store one-time paid release; audio (Syrinx) and 3D (Daedalus) verticals are reserved for the same engine.",
    "purpose": "Orient a new engineer to the two-crate split (Mnemosyne engine vs Lynceus product), the runtime layers, ownership boundaries, dependency direction, and the main semantic-search execution flow. This is the map, not the territory — subsystem deep-dives live in systems/*.md, rationale in notes/, and the enhancement backlog in enhancements/.",
    "overview": "A Cargo workspace (root Cargo.toml, members crates/engine + apps/lynceus/src-tauri) mirrored by an npm workspace (root package.json, workspaces apps/*). The engine crate mnemosyne is a pure-move extraction of the media-agnostic core; the product crate lynceus (lib lynceus_lib) re-exports the engine modules so in-crate crate::db / crate::paths / crate::cosine call sites resolve unchanged. The React frontend (npm package lynceus-ui) sits at apps/lynceus/src beside the Tauri app crate. Rust runs CPU-only for ONNX on macOS (CoreML errors on these graphs), CUDA-with-CPU-fallback elsewhere. Tests: cargo test --workspace green (lynceus 36 + mnemosyne 89 + integration); npm run test green (62 vitest).",
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
    ]
  },
  "nodes": [
    {
      "id": "app_shell",
      "label": "app-shell",
      "kind": "entry",
      "layer": 0,
      "root": "apps/lynceus/src-tauri/src/",
      "tagline": "Tauri binary entry + builder: parses --profiling, opens SQLite, manages singletons, wires the invoke handler.",
      "owns": "Owns main.rs bootstrap and lib.rs::run — the tauri::Builder that manages every state singleton (CosineIndexState, TextEncoderState, FusionIndexState, IndexingState, WatcherHandle), the .setup() legacy-migrate + pipeline-spawn + watcher-start, the 28-command invoke_handler, and the on-Exit profiling report hook. Re-exports the engine modules (pub use mnemosyne::{db,paths,perf,...}) so product call sites resolve unchanged. Does NOT own any command body (commands/) or the engine.",
      "files": [
        "main.rs - binary entry: --profiling parse, tracing subscriber + opt-in PerfLayer, SQLite open + initialize, hands to lynceus_lib::run",
        "lib.rs - manage state + setup (legacy migrate, spawn pipeline, start watcher) + invoke_handler![28] + on-Exit report; re-exports mnemosyne modules"
      ],
      "state": [
        "Tauri Builder",
        "managed-state singletons",
        "invoke_handler[28]"
      ],
      "_stale": true
    },
    {
      "id": "tauri_commands",
      "label": "tauri-commands",
      "kind": "boundary",
      "layer": 1,
      "root": "apps/lynceus/src-tauri/src/commands/",
      "tagline": "The 28-command IPC surface between the React frontend and the Rust backend, with typed ApiError wire format.",
      "owns": "Owns every Tauri command handler grouped by concern, the ApiError discriminated union (serde tag=kind), the unified ImageSearchResult shape, lazy text-encoder init, and path-prefix normalisation. Does NOT own the business logic it calls into (db, cosine, encoders) — it is the thin typed boundary.",
      "files": [
        "mod.rs - re-exports + ImageSearchResult + resolve_image_id_for_cosine_path helper",
        "error.rs - ApiError enum (serde tag=kind, content=details); From-impls for rusqlite/io/poison",
        "images.rs - get_images, get_pipeline_stats",
        "tags.rs - get_tags, create_tag, delete_tag, add_tag_to_image, remove_tag_from_image",
        "notes.rs - get_image_notes, set_image_notes",
        "roots.rs - get_scan_root, set_scan_root, list_roots, add_root, remove_root, set_root_enabled",
        "similarity.rs - get_similar_images, get_tiered_similar_images, get_fused_similar_images",
        "semantic.rs - semantic_search (CLIP vs SigLIP-2 text_encoder_id dispatch)",
        "semantic_fused.rs - get_fused_semantic_search (text-image RRF across encoders)",
        "encoders.rs - list_available_encoders, get_enabled_encoders, set_enabled_encoders",
        "profiling.rs - is_profiling_enabled, get_perf_snapshot, reset_perf_stats, export_perf_snapshot, record_user_action"
      ],
      "state": [
        "ApiError enum",
        "ImageSearchResult",
        "28-command surface"
      ],
      "_stale": true
    },
    {
      "id": "indexing",
      "label": "indexing",
      "kind": "boundary",
      "layer": 2,
      "root": "apps/lynceus/src-tauri/src/indexing.rs",
      "tagline": "Background pipeline that turns folders of images into a searchable, embedded, thumbnailed catalogue.",
      "owns": "Owns run_pipeline_inner: scan -> model-download -> orphan-mark -> thumbnail (rayon) -> encode (CLIP + DINOv2 + SigLIP-2 batches) -> cosine populate + save_to_disk, single-flight via AtomicBool, IndexingProgress events per phase, batched embedding writes. Does NOT own the encoders or DB schema themselves — it orchestrates them.",
      "files": [
        "indexing.rs - background pipeline (single-flight AtomicBool); run_clip_encoder + run_trait_encoder; upsert_embeddings_batch + checkpoint_passive between batches; emits indexing-progress"
      ],
      "state": [
        "IndexingState (AtomicBool)",
        "IndexingProgress events",
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
      "tagline": "Filesystem watcher that re-triggers indexing when watched roots change on disk.",
      "owns": "Owns the notify-debouncer-mini watch (5s debounce, recursive on every enabled root) and the debounced re-spawn of the indexing pipeline through try_spawn_pipeline. Does NOT own the pipeline; it coalesces bursts via the shared single-flight AtomicBool. Known gap: not rebuilt on add_root/remove_root.",
      "files": [
        "watcher.rs - notify-debouncer-mini start; rescan trigger via try_spawn_pipeline (single-flight coalesces bursts)"
      ],
      "state": [
        "WatcherHandle slot",
        "debounce coalescing"
      ],
      "_stale": true
    },
    {
      "id": "filesystem_scanner",
      "label": "filesystem-scanner",
      "kind": "foundation",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/filesystem.rs",
      "tagline": "Recursive image discovery over a directory with an extension whitelist.",
      "owns": "Owns ImageScanner: recursive read_dir + a 7-extension whitelist, called per enabled root by the pipeline. Does NOT own persistence or dedup — it just yields candidate paths.",
      "files": [
        "filesystem.rs - ImageScanner: recursive read_dir + 7-extension whitelist"
      ],
      "state": [
        "extension whitelist",
        "ImageScanner"
      ],
      "_stale": true
    },
    {
      "id": "thumbnail_pipeline",
      "label": "thumbnail-pipeline",
      "kind": "foundation",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/thumbnail/",
      "tagline": "Aspect-preserving 400x400 cached thumbnails on disk, per-root, NEON-accelerated.",
      "owns": "Owns thumbnail generation: JPEG sources go through jpeg-decoder scaled IDCT then fast_image_resize NEON Lanczos3, falling back to image-rs for non-JPEG/decode errors; per-root subfolder layout; rayon-parallel. Does NOT own where thumbnails are indexed (db) or served (tauri assetProtocol).",
      "files": [
        "mod.rs - pub use generator::ThumbnailGenerator",
        "generator.rs - 400x400 aspect-preserving JPEG; decode_jpeg_scaled (jpeg-decoder) + resize_with_fir (fast_image_resize); per-root subfolder"
      ],
      "state": [
        "thumbnails/root_<id>/ layout",
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
      "tagline": "First-launch fetch of encoder weights from HuggingFace, per-file fail-soft — now a fallback to the repo-local weights tree.",
      "owns": "Owns the download URLs and HEAD-preflight + chunked-GET + progress-callback fetch for all encoder files. CLIP now points at OpenCLIP LAION (immich-app/ViT-B-32__laion2b-s34b-b79k, MIT). Weights are meant to live in the gitignored repo models/ tree (fetched by scripts/download_models.py) or bundled into the .app; this first-launch path is the fallback. Does NOT own where the weights resolve at runtime (paths::models_dir owns that).",
      "files": [
        "model_download.rs - first-launch HF download (HEAD preflight + chunked GET + progress); OpenCLIP LAION CLIP URLs; per-file fail-soft"
      ],
      "state": [
        "encoder weight URLs",
        "clip_vision/clip_text/clip_tokenizer filenames"
      ],
      "_stale": true
    },
    {
      "id": "clip_image_encoder",
      "label": "clip-image-encoder",
      "kind": "learner",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder.rs",
      "tagline": "OpenCLIP LAION ViT-B/32 image encoder producing 512-d L2-normalised embeddings.",
      "owns": "Owns ClipImageEncoder: 224x224 bicubic-shortest-edge + centre-crop, CLIP-native mean/std, separate clip_vision.onnx, batch=32, L2-normalise. Weights are OpenCLIP LAION-2B (MIT) — a weights-only swap from OpenAI CLIP, identical preprocessing/output. Does NOT own text encoding (clip_text_encoder) or the ranking (cosine).",
      "files": [
        "encoder.rs - ClipImageEncoder via ort; 224 bicubic-shortest-edge + centre-crop, CLIP mean/std, batch 32, L2-normalise"
      ],
      "state": [
        "512-d CLIP image embedding",
        "clip_vision.onnx"
      ],
      "_stale": true
    },
    {
      "id": "clip_text_encoder",
      "label": "clip-text-encoder",
      "kind": "learner",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_text/",
      "tagline": "OpenCLIP LAION ViT-B/32 text encoder: CLIP BPE tokeniser, 512-d shared space.",
      "owns": "Owns ClipTextEncoder: HF tokenizers BPE (49408 vocab, max 77, pad id 49407), separate clip_text.onnx, 512-d L2-normalised, lazy + real-input pre-warm. Same CLIP BPE tokenizer as before the OpenCLIP swap. Does NOT own image encoding or cosine ranking.",
      "files": [
        "mod.rs - pub use ClipTextEncoder",
        "encoder.rs - ClipTextEncoder via HF tokenizers BPE; ort session (CoreML off for transformer ops); tokenizer_for_diagnostic()",
        "pooling.rs - normalize, try_extract_single_embedding, mean_pool (ort-free for testability)"
      ],
      "state": [
        "512-d CLIP text embedding",
        "clip_text.onnx",
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
      "tagline": "DINOv2-Base (Meta, Apache-2.0) self-supervised image-only encoder, 768-d.",
      "owns": "Owns Dinov2ImageEncoder: 224 bicubic-shortest-edge-256 + centre-crop-224, ImageNet mean/std, CLS token from last_hidden_state, 768-d L2-normalised, image-only. Distinct preprocessing from CLIP. Does NOT do text.",
      "files": [
        "encoder_dinov2.rs - Dinov2ImageEncoder; resize-256 + centre-crop-224, ImageNet stats, CLS slice, 768-d"
      ],
      "state": [
        "768-d DINOv2 image embedding",
        "dinov2_base_image.onnx"
      ],
      "_stale": true
    },
    {
      "id": "siglip2_encoder",
      "label": "siglip2-encoder",
      "kind": "learner",
      "layer": 3,
      "root": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_siglip2.rs",
      "tagline": "SigLIP-2 Base 256 (Google, Apache-2.0) image+text in a shared 768-d space.",
      "owns": "Owns Siglip2ImageEncoder + Siglip2TextEncoder: image 256x256 exact-square bilinear + [-1,1]; text Gemma SentencePiece 64 tokens NO attention_mask; both use pooler_output (MAP head), 768-d shared space. Its text branch is dispatched from semantic_search via text_encoder_id. Does NOT share preprocessing with CLIP/DINOv2.",
      "files": [
        "encoder_siglip2.rs - Siglip2ImageEncoder + Siglip2TextEncoder; 256 exact-square + [-1,1]; Gemma SP 64 tokens no mask; pooler_output 768-d"
      ],
      "state": [
        "768-d SigLIP-2 shared embedding",
        "siglip2_vision.onnx",
        "siglip2_text.onnx",
        "siglip2_tokenizer.json"
      ],
      "_stale": true
    },
    {
      "id": "multi_encoder_fusion",
      "label": "multi-encoder-fusion",
      "kind": "boundary",
      "layer": 4,
      "root": "crates/engine/src/cosine/rrf.rs",
      "tagline": "Reciprocal Rank Fusion across CLIP + SigLIP-2 + DINOv2 for image-image (and text-image) retrieval.",
      "owns": "Owns the RRF algorithm (Cormack 2009, k=60) in the engine's cosine/rrf.rs, fusing N per-encoder ranked lists into one. FusionIndexState (one cosine cache per encoder) lives in the product lib.rs; get_fused_similar_images (commands/similarity.rs) and get_fused_semantic_search (commands/semantic_fused.rs) dispatch it. Replaced the earlier tiered random-sampling diversity path. Does NOT own the per-encoder cosine math (cosine_similarity) — it fuses its outputs.",
      "files": [
        "rrf.rs - Reciprocal Rank Fusion (Cormack 2009, k=60); fuses N per-encoder ranked lists; 6 unit tests"
      ],
      "state": [
        "RRF fusion (k=60)",
        "FusionIndexState.per_encoder"
      ],
      "_stale": true
    },
    {
      "id": "cosine_similarity",
      "label": "cosine-similarity",
      "kind": "foundation",
      "layer": 4,
      "root": "crates/engine/src/cosine/",
      "tagline": "In-memory cosine similarity index with partial-sort top-k, persistent disk cache, and domain diagnostics.",
      "owns": "Owns CosineIndex (engine): populate_from_db_for_encoder, select_nth_unstable_by partial sort (2.53x speedup), reusable scratch buffer, persistent cosine_cache.bin, and the 4 stateless diagnostic helpers. Media-agnostic — ranks any encoder's embeddings. Does NOT own fusion (multi_encoder_fusion) or the embeddings' production (encoders).",
      "files": [
        "mod.rs - module decls + pub use index::CosineIndex + pub mod rrf",
        "math.rs - cosine_similarity helper + score_cmp_desc (NaN-aware)",
        "index.rs - CosineIndex + populate_from_db_for_encoder + 3 retrieval modes + partial sort + diagnostics emits",
        "rrf.rs - Reciprocal Rank Fusion (see multi-encoder-fusion)",
        "diagnostics.rs - embedding_stats, pairwise_distance_distribution, self_similarity_check, score_distribution_stats",
        "cache.rs - persistent cosine_cache.bin (bincode); load_from_disk_if_fresh checks DB mtime"
      ],
      "state": [
        "CosineIndex.cached_images",
        "cosine_cache.bin",
        "score diagnostics"
      ],
      "_stale": true
    },
    {
      "id": "database",
      "label": "database",
      "kind": "foundation",
      "layer": 4,
      "root": "crates/engine/src/db/",
      "tagline": "SQLite/WAL catalogue: schema, embedding BLOBs, idempotent migrations, dual writer/read-only connections.",
      "owns": "Owns the engine's ImageDatabase: 5-table schema, WAL+NORMAL pragmas, foreign_keys=ON, bytemuck embedding BLOB encoding, per-encoder embeddings table, idempotent ALTER migrations + embedding-pipeline-version wipe, AND/OR tag SQL, orphan filter, pipeline stats, and the dual writer (Mutex<Connection>) + read-only secondary (OnceLock) topology. Media-agnostic. Does NOT own domain semantics of what is stored (the product decides).",
      "files": [
        "mod.rs - ImageDatabase + WAL/NORMAL pragma + foreign_keys=ON + read_lock() + checkpoint_passive() + CREATE TABLE flow",
        "schema_migrations.rs - idempotent ALTER migrations + migrate_embedding_pipeline_version (CURRENT_PIPELINE_VERSION)",
        "images_query.rs - aggregate_image_rows + get_images* + get_paths_to_root_ids + get_pipeline_stats + AND/OR tag SQL (routed through read-only secondary)",
        "embeddings.rs - bytemuck cast_slice; upsert_embeddings_batch; get_all_embeddings (single-SELECT via secondary)",
        "tags.rs - create/delete/get tags + join rows",
        "thumbnails.rs - update_image_thumbnail, get_image_thumbnail_info",
        "roots.rs - roots CRUD + migrate_legacy_scan_root + wipe_images_for_new_root",
        "notes_orphans.rs - add_image, get/set notes, mark_orphaned (chunked UPDATE)",
        "test_helpers.rs - fresh_db() for per-submodule tests"
      ],
      "state": [
        "images.db (WAL)",
        "5 tables",
        "embeddings(image_id,encoder_id,...)",
        "writer + read-only secondary"
      ],
      "_stale": true
    },
    {
      "id": "paths_and_state",
      "label": "paths-and-state",
      "kind": "foundation",
      "layer": 4,
      "root": "crates/engine/src/paths.rs",
      "tagline": "Single source of truth for every on-disk location: app-data dir, models dir, thumbnails, cache, exports.",
      "owns": "Owns the engine's paths::*_dir() helpers resolving under com.ataca.lynceus (LYNCEUS_DATA_DIR override), and models_dir() which now checks LYNCEUS_MODELS_DIR first then falls back to app-data models/. Also owns strip_windows_extended_prefix and the product's settings.rs (legacy single-folder scan_root). Does NOT own what is written to those paths.",
      "files": [
        "paths.rs (engine) - app-data + models-dir resolution; LYNCEUS_DATA_DIR + LYNCEUS_MODELS_DIR overrides; strip_windows_extended_prefix",
        "settings.rs (product, apps/lynceus/src-tauri/src/) - Settings{scan_root} legacy single-folder pre-multifolder"
      ],
      "state": [
        "<app_data>/ layout",
        "BUNDLE_ID com.ataca.lynceus",
        "LYNCEUS_DATA_DIR / LYNCEUS_MODELS_DIR overrides",
        "settings.json"
      ],
      "_stale": true
    },
    {
      "id": "profiling",
      "label": "profiling",
      "kind": "observer",
      "layer": 4,
      "root": "crates/engine/src/perf.rs",
      "tagline": "Opt-in span timing + domain diagnostics, dormant unless --profiling is set; on-exit markdown report.",
      "owns": "Owns the engine's PerfLayer (tracing Layer, per-span aggregate stats, RawEvent log, JSONL flush thread), the 1Hz RSS/CPU system sampler, record_diagnostic, and the on-exit report renderer (Stall Analysis + Resource Trends). The product mounts it in lynceus_lib::run only when --profiling is set, plus the frontend PerfOverlay + perfInvoke. Off by default = zero overhead. Read-only observer of every other subsystem.",
      "files": [
        "perf.rs (engine) - PerfLayer, per-span stats, RawEvent log, JSONL flush thread, spawn_system_sampler_thread",
        "perf_report.rs (engine) - on-exit markdown report; section_stall_analysis + section_resource_trends"
      ],
      "state": [
        "PerfLayer",
        "RawEvent log",
        "perf-<ts>/{timeline.jsonl,report.md,raw.json}",
        "record_diagnostic"
      ],
      "_stale": true
    },
    {
      "id": "multi_folder_roots",
      "label": "multi-folder-roots",
      "kind": "env",
      "layer": 2,
      "root": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "tagline": "Multiple watched library folders with per-root enable, migration, and thumbnail isolation.",
      "owns": "Owns the roots lifecycle: the engine db/roots.rs CRUD (roots table, ON DELETE CASCADE) and the product commands/roots.rs (set_scan_root vs add_root semantics, enabled toggle, migrate_legacy_scan_root, cache invalidation on mutation). Per-root thumbnail directories via paths. Does NOT own the watch itself (watcher) — but root changes should trigger a re-watch (known gap).",
      "files": [
        "roots.rs (product commands/) - get_scan_root, set_scan_root, list_roots, add_root, remove_root, set_root_enabled; invalidates cosine + fusion caches",
        "roots.rs (engine db/) - roots CRUD + migrate_legacy_scan_root + wipe_images_for_new_root"
      ],
      "state": [
        "roots table",
        "enabled flag",
        "per-root thumbnail dirs"
      ],
      "_stale": true
    },
    {
      "id": "search_routing",
      "label": "search-routing",
      "kind": "boundary",
      "layer": 5,
      "root": "apps/lynceus/src/pages/",
      "tagline": "Frontend priority router: similar > semantic > tag > all, driving what the grid shows.",
      "owns": "Owns the single catch-all route pages/[...slug].tsx: the URL-slug-as-selection model, the priority chain choosing between fused-similar, semantic, tag-filtered, and all images, the 300ms debounce on semantic queries, and selectedItem resolution against displayImages. Does NOT own the queries themselves (frontend_state) or rendering (masonry).",
      "files": [
        "pages/[...slug].tsx - catch-all route; search-routing priority chain; hotkeys; selectedItem vs displayImages"
      ],
      "state": [
        "selection URL slug",
        "priority chain",
        "displayImages"
      ],
      "_stale": true
    },
    {
      "id": "masonry_layout",
      "label": "masonry-layout",
      "kind": "observer",
      "layer": 5,
      "root": "apps/lynceus/src/components/",
      "tagline": "Pinterest-style shortest-column masonry with hero promotion and 3D tilt, sized from backend dimensions.",
      "owns": "Owns the masonry packing (shortest-column, hero promotion across up to 3 columns, sortMode-aware) and per-tile animation, using backend-supplied width/height (no DOM image-load round-trip). Does NOT fetch data — it renders displayImages handed down by routing.",
      "files": [
        "Masonry.tsx - shortest-column packing; hero promotion; sortMode-aware",
        "MasonryItem.tsx - 3D tilt via framer-motion; honours animationLevel pref",
        "MasonryAnchor.tsx - absolute-positioned wrapper",
        "masonryPacking.ts - pure packing algorithm (unit-tested)"
      ],
      "state": [
        "masonry packing",
        "hero promotion"
      ],
      "_stale": true
    },
    {
      "id": "tag_system",
      "label": "tag-system",
      "kind": "boundary",
      "layer": 5,
      "root": "apps/lynceus/src/components/",
      "tagline": "Tag CRUD, optimistic mutations, AND/OR filter mode, and #-autocomplete in the search bar.",
      "owns": "Owns the tag UI + query layer: SearchBar # autocomplete + create-on-no-match + delete affordance, TagDropdown combobox, optimistic add/remove/create/delete mutations, AND/OR filter mode toggle. Backed by the tags + images_tags tables via commands. Does NOT own image fetching (frontend_state) or routing.",
      "files": [
        "SearchBar.tsx - # autocomplete + tag pills + create/delete affordances",
        "TagDropdown.tsx - popover combobox (cmdk)"
      ],
      "state": [
        "tag pills",
        "AND/OR filter mode",
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
      "tagline": "TanStack Query cache, localStorage preferences, and the indexing-progress event subscription.",
      "owns": "Owns the frontend state layer: queryClient (staleTime Infinity), one query-hook file per resource family, useUserPreferences (localStorage: theme, columns, sort, animation, search counts, tagFilterMode, textEncoder), useIndexingProgress (Tauri event -> invalidate images), and the settings/ drawer subcomponents. Does NOT own backend truth — it caches and invalidates it.",
      "files": [
        "queries/ - TanStack Query hooks (useImages, useTags, useRoots, useSimilarImages, useSemanticSearch)",
        "hooks/ - useDebouncedValue, useUserPreferences, useIndexingProgress",
        "components/settings/ - slide-in drawer split into sections (Theme/Display/Search/Sort/Folders/Encoder/Reset)",
        "services/ - invoke() wrappers translating Tauri JSON to UI types via ApiError"
      ],
      "state": [
        "QueryClient cache",
        "useUserPreferences (localStorage)",
        "useIndexingProgress"
      ],
      "_stale": true
    }
  ],
  "edges": [
    {
      "from": "search_routing",
      "to": "tauri_commands",
      "rel": "strong",
      "label": "invoke(get_images/semantic_search/get_fused_*) over Tauri IPC"
    },
    {
      "from": "tag_system",
      "to": "tauri_commands",
      "rel": "dep",
      "label": "tag CRUD + AND/OR filter over invoke"
    },
    {
      "from": "frontend_state",
      "to": "tauri_commands",
      "rel": "dep",
      "label": "query hooks call service wrappers over invoke"
    },
    {
      "from": "masonry_layout",
      "to": "search_routing",
      "rel": "dep",
      "label": "receives displayImages + selectedItem to render"
    },
    {
      "from": "tag_system",
      "to": "frontend_state",
      "rel": "dep",
      "label": "optimistic mutations invalidate the images query cache"
    },
    {
      "from": "frontend_state",
      "to": "indexing",
      "rel": "peer",
      "label": "useIndexingProgress subscribes to indexing-progress events -> invalidate"
    },
    {
      "from": "tauri_commands",
      "to": "database",
      "rel": "strong",
      "label": "every handler reads/writes ImageDatabase (WAL, read-only secondary)"
    },
    {
      "from": "tauri_commands",
      "to": "cosine_similarity",
      "rel": "strong",
      "label": "similarity/semantic lock CosineIndexState, run top-k"
    },
    {
      "from": "tauri_commands",
      "to": "clip_text_encoder",
      "rel": "dep",
      "label": "semantic_search locks TextEncoderState, encodes query"
    },
    {
      "from": "tauri_commands",
      "to": "siglip2_encoder",
      "rel": "dep",
      "label": "semantic_search dispatches SigLIP-2 text branch on text_encoder_id"
    },
    {
      "from": "tauri_commands",
      "to": "multi_encoder_fusion",
      "rel": "dep",
      "label": "get_fused_* dispatch RRF across per-encoder caches"
    },
    {
      "from": "app_shell",
      "to": "tauri_commands",
      "rel": "strong",
      "label": "builder.invoke_handler![28] mounts every command"
    },
    {
      "from": "app_shell",
      "to": "indexing",
      "rel": "dep",
      "label": "setup spawns the background pipeline; manages IndexingState"
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
      "label": "opens SQLite + initialize before handing to run()"
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
      "label": "rayon-pars needs_thumbs; writes per-root thumbnails"
    },
    {
      "from": "indexing",
      "to": "clip_image_encoder",
      "rel": "write",
      "label": "run_clip_encoder batches -> embeddings BLOB write-back"
    },
    {
      "from": "indexing",
      "to": "dinov2_encoder",
      "rel": "write",
      "label": "run_trait_encoder(dinov2) -> per-encoder embeddings row"
    },
    {
      "from": "indexing",
      "to": "siglip2_encoder",
      "rel": "write",
      "label": "run_trait_encoder(siglip2_base) -> per-encoder embeddings row"
    },
    {
      "from": "indexing",
      "to": "clip_text_encoder",
      "rel": "dep",
      "label": "pre-warms the text encoder to avoid first-query model load"
    },
    {
      "from": "indexing",
      "to": "cosine_similarity",
      "rel": "write",
      "label": "populate_from_db + save_to_disk after every encode pass"
    },
    {
      "from": "indexing",
      "to": "model_download",
      "rel": "dep",
      "label": "phase 1 downloads missing weights (fallback to repo models/)"
    },
    {
      "from": "indexing",
      "to": "database",
      "rel": "strong",
      "label": "scan INSERT OR IGNORE, orphan-mark, batched embedding upserts"
    },
    {
      "from": "watcher",
      "to": "indexing",
      "rel": "peer",
      "label": "debounced try_spawn_pipeline; single-flight AtomicBool coalesces"
    },
    {
      "from": "multi_folder_roots",
      "to": "database",
      "rel": "dep",
      "label": "roots table CRUD + FK CASCADE on images.root_id"
    },
    {
      "from": "multi_folder_roots",
      "to": "thumbnail_pipeline",
      "rel": "dep",
      "label": "per-root thumbnail dirs; remove_root rm -rfs the subfolder"
    },
    {
      "from": "multi_folder_roots",
      "to": "cosine_similarity",
      "rel": "write",
      "label": "root mutations invalidate cosine + fusion caches"
    },
    {
      "from": "multi_encoder_fusion",
      "to": "cosine_similarity",
      "rel": "dep",
      "label": "fuses per-encoder ranked lists produced by CosineIndex"
    },
    {
      "from": "clip_image_encoder",
      "to": "database",
      "rel": "write",
      "label": "writes 512-d embedding into the per-encoder table"
    },
    {
      "from": "model_download",
      "to": "paths_and_state",
      "rel": "dep",
      "label": "resolves target dir via models_dir() (LYNCEUS_MODELS_DIR first)"
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
      "label": "cosine_cache.bin path from paths"
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
    "intro": "The traced operation is a semantic (natural-language) search — the longest cross-boundary path in Lynceus. It crosses the React UI, a 300ms debounce, the Tauri IPC boundary, the TextEncoder mutex, an ONNX forward pass, the CosineIndex mutex, the SQLite read-only secondary, and back over IPC to the masonry render. It exercises the full engine/product seam: the product owns the text encoder and command handler, the engine owns the cosine ranking and the catalogue.",
    "simsets": [
      "UI + debounce",
      "IPC in",
      "Text encode",
      "Cosine rank",
      "DB resolve",
      "IPC out + render"
    ],
    "steps": [
      {
        "n": 1,
        "sys": "search_routing",
        "fn": "useDebouncedValue",
        "set": "UI + debounce",
        "reads": "SearchBar text state",
        "writes": "debounced query (300ms)",
        "fail": false
      },
      {
        "n": 2,
        "sys": "search_routing",
        "fn": "shouldUseSemanticSearch",
        "set": "UI + debounce",
        "reads": "query (non-empty, no #, no selection)",
        "writes": "enable flag for the semantic query",
        "fail": false
      },
      {
        "n": 3,
        "sys": "frontend_state",
        "fn": "useSemanticSearch",
        "set": "UI + debounce",
        "reads": "query + prefs.textEncoder + semanticResultCount",
        "writes": "useQuery key [semantic-search, query, top_n, encoder]",
        "fail": false
      },
      {
        "n": 4,
        "sys": "frontend_state",
        "fn": "semanticSearch (service)",
        "set": "IPC in",
        "reads": "query, top_n, text_encoder_id",
        "writes": "invoke(semantic_search)",
        "fail": true
      },
      {
        "n": 5,
        "sys": "tauri_commands",
        "fn": "commands::semantic::semantic_search",
        "set": "IPC in",
        "reads": "invoke args",
        "writes": "locks TextEncoderState (? -> ApiError::Cosine on poison)",
        "fail": true
      },
      {
        "n": 6,
        "sys": "tauri_commands",
        "fn": "lazy-init guard",
        "set": "Text encode",
        "reads": "clip_text.onnx / clip_tokenizer.json existence",
        "writes": "ApiError::TextModelMissing/TokenizerMissing (typed, frontend can branch)",
        "fail": true
      },
      {
        "n": 7,
        "sys": "clip_text_encoder",
        "fn": "encoder.encode(query)",
        "set": "Text encode",
        "reads": "query string",
        "writes": "BPE tokenise -> pad/truncate 77 (pad 49407)",
        "fail": false
      },
      {
        "n": 8,
        "sys": "clip_text_encoder",
        "fn": "ort session.run",
        "set": "Text encode",
        "reads": "input_ids + attention_mask int64[1,77]",
        "writes": "raw text embedding",
        "fail": true
      },
      {
        "n": 9,
        "sys": "clip_text_encoder",
        "fn": "pooling::normalize",
        "set": "Text encode",
        "reads": "raw embedding",
        "writes": "512-d L2-normalised Vec<f32>",
        "fail": false
      },
      {
        "n": 10,
        "sys": "siglip2_encoder",
        "fn": "encode_with_siglip2 (branch)",
        "set": "Text encode",
        "reads": "text_encoder_id == siglip2_base",
        "writes": "768-d SigLIP-2 vector (alternate branch)",
        "fail": false
      },
      {
        "n": 11,
        "sys": "tauri_commands",
        "fn": "cosine_state.ensure_loaded_for",
        "set": "Cosine rank",
        "reads": "encoder_id, &db",
        "writes": "populate_from_db_for_encoder if cache holds a different encoder",
        "fail": true
      },
      {
        "n": 12,
        "sys": "cosine_similarity",
        "fn": "populate_from_db_for_encoder",
        "set": "Cosine rank",
        "reads": "embeddings via read-only secondary",
        "writes": "in-memory cache + cosine_cache_populated + quality diagnostics",
        "fail": true
      },
      {
        "n": 13,
        "sys": "cosine_similarity",
        "fn": "get_similar_images_sorted",
        "set": "Cosine rank",
        "reads": "query vector + cached embeddings",
        "writes": "scores into a reused scratch buffer",
        "fail": false
      },
      {
        "n": 14,
        "sys": "cosine_similarity",
        "fn": "select_nth_unstable_by",
        "set": "Cosine rank",
        "reads": "scratch scores",
        "writes": "top_n partial sort (2.53x vs full sort)",
        "fail": false
      },
      {
        "n": 15,
        "sys": "tauri_commands",
        "fn": "resolve_image_id_for_cosine_path",
        "set": "DB resolve",
        "reads": "result path + cached all_images",
        "writes": "3-strategy id resolution (strip prefix -> exact -> canonical walk)",
        "fail": false
      },
      {
        "n": 16,
        "sys": "database",
        "fn": "get_image_id_by_path / get_all_images",
        "set": "DB resolve",
        "reads": "read-only secondary SELECT",
        "writes": "image id + row",
        "fail": true
      },
      {
        "n": 17,
        "sys": "database",
        "fn": "get_image_thumbnail_info",
        "set": "DB resolve",
        "reads": "resolved id",
        "writes": "enriches ImageSearchResult",
        "fail": false
      },
      {
        "n": 18,
        "sys": "profiling",
        "fn": "record_diagnostic(search_query)",
        "set": "DB resolve",
        "reads": "scores, resolution outcomes",
        "writes": "RawEvent::Diagnostic (no-op if profiling off)",
        "fail": false
      },
      {
        "n": 19,
        "sys": "tauri_commands",
        "fn": "return Result<Vec<ImageSearchResult>, ApiError>",
        "set": "IPC out + render",
        "reads": "resolved results",
        "writes": "typed IPC return",
        "fail": true
      },
      {
        "n": 20,
        "sys": "frontend_state",
        "fn": "formatApiError / cache",
        "set": "IPC out + render",
        "reads": "IPC result or typed error",
        "writes": "query cache; typed kinds get specific UI affordances",
        "fail": false
      },
      {
        "n": 21,
        "sys": "search_routing",
        "fn": "displayImages branch",
        "set": "IPC out + render",
        "reads": "semantic results",
        "writes": "displayImages = semantic list",
        "fail": false
      },
      {
        "n": 22,
        "sys": "masonry_layout",
        "fn": "Masonry packing",
        "set": "IPC out + render",
        "reads": "displayImages with (w,h)",
        "writes": "shortest-column layout on screen",
        "fail": false
      }
    ]
  },
  "failures": [
    {
      "step": "5 -> 11 -> 12",
      "link": "mutex order",
      "title": "Two mutexes serialise every semantic search",
      "body": "The TextEncoder mutex (step 5) and the CosineIndex mutex (steps 11-13) are both held for the operation, so concurrent semantic searches serialise. The DB writer is separate (WAL + read-only secondary), so foreground reads at step 16 do not block the background indexing thread's writes. If either mutex is poisoned by a panicking holder, From<PoisonError> turns it into ApiError::Cosine and the next call relocks fresh — the invariant is that a poisoned lock is recoverable, never a hard crash."
    },
    {
      "step": "6",
      "link": "typed-missing",
      "title": "Missing model files surface as typed, branchable errors",
      "body": "At lazy-init (step 6) a missing clip_text.onnx or clip_tokenizer.json becomes ApiError::TextModelMissing / TokenizerMissing rather than a generic string, so the frontend can call isMissingModelError and trigger a re-download flow. Break this (revert to string errors) and the frontend loses its ability to distinguish a recoverable missing-weight state from a real failure."
    },
    {
      "step": "11 -> 12",
      "link": "encoder cache match",
      "title": "The cosine cache must match the query encoder's dimension",
      "body": "ensure_loaded_for repopulates the cache when it holds a different encoder, so a 512-d CLIP query never scores against 768-d SigLIP-2 embeddings. If a SigLIP-2 text query runs before any SigLIP-2 image embeddings exist, populate finds 0 rows and search returns empty (surfaced as cosine_cache_populated count=0) rather than a dimension-mismatch panic."
    },
    {
      "step": "15 -> 16",
      "link": "path resolution",
      "title": "Cosine paths resolve back to DB ids by three fallbacks",
      "body": "Cosine stores file paths; the DB keys on ids. resolve_image_id_for_cosine_path tries strip_windows_extended_prefix -> exact lookup -> canonical-form walk. A total miss silently drops the result (fewer results, no error) and is tracked into resolution_misses for the diagnostic. If all three strategies regress, results vanish quietly — the diagnostic is the only signal."
    },
    {
      "step": "18 -> 22",
      "link": "profiling cold path",
      "title": "Profiling is off the hot path",
      "body": "record_diagnostic (step 18) and every tracing span are no-ops when --profiling is absent: span construction still happens but no aggregator registers, and the body uses no ? and no panicking allocs. The invariant is that turning profiling off costs one tracing dispatch per call and nothing else — a diagnostic must never change search behaviour."
    }
  ],
  "relationships": [
    {
      "a": "filesystem_scanner",
      "b": "indexing",
      "mech": "ImageScanner::scan_directory called per enabled root inside the pipeline",
      "data": "candidate image paths",
      "breaks": "A scan permission error logs warn and the pipeline continues with what was collected; partial scans are safe because INSERT OR IGNORE is idempotent."
    },
    {
      "a": "indexing",
      "b": "database",
      "mech": "Pipeline drives add_image, get_images_without_*, update_*, mark_orphaned; get_paths_to_root_ids is single-SELECT",
      "data": "image rows, thumbnail + embedding writes",
      "breaks": "If the DB writer Mutex contends the pipeline blocks; WAL keeps foreground reads non-blocking, foreground writes serialise."
    },
    {
      "a": "indexing",
      "b": "thumbnail_pipeline",
      "mech": "Pipeline holds a ThumbnailGenerator and rayon-pars needs_thumbs, looking up each image root_id from a pre-fetched map",
      "data": "decoded image -> 400x400 JPEG on disk",
      "breaks": "A thumbnail decode failure logs and the row stays unmarked; the next pipeline run retries it."
    },
    {
      "a": "indexing",
      "b": "clip_image_encoder",
      "mech": "run_clip_encoder instantiates ClipImageEncoder(clip_vision.onnx) and batches encode (size 32), writing the per-encoder embeddings row",
      "data": "512-d CLIP image embedding BLOB",
      "breaks": "If clip_vision.onnx is missing the encode phase is skipped (warn); non-fatal, semantic/similar search just returns fewer results."
    },
    {
      "a": "indexing",
      "b": "clip_text_encoder",
      "mech": "Pipeline pre-warms ClipTextEncoder(clip_text.onnx, clip_tokenizer.json) into TextEncoderState so the first semantic search does not pay model-load latency",
      "data": "warm ONNX session + tokenizer",
      "breaks": "If pre-warm fails (warn), the lazy-init path in commands::semantic covers it on first use."
    },
    {
      "a": "indexing",
      "b": "cosine_similarity",
      "mech": "Pipeline calls cosine.populate_from_db then save_to_disk after every encode pass; Arc<Mutex<CosineIndex>> is shared with the Tauri-managed CosineIndexState",
      "data": "embeddings -> in-memory cache + cosine_cache.bin",
      "breaks": "If the cache file is corrupted, load_from_disk_if_fresh silently skips and the next populate fully rebuilds."
    },
    {
      "a": "indexing",
      "b": "dinov2_encoder",
      "mech": "run_trait_encoder(dinov2_base, Dinov2ImageEncoder::new) encodes images lacking a dinov2_base row; ImageNet preprocessing distinct from CLIP",
      "data": "768-d DINOv2 embedding",
      "breaks": "If the model file is missing that encoder pass skips (warn); other encoders unaffected — per-encoder fail-soft."
    },
    {
      "a": "indexing",
      "b": "siglip2_encoder",
      "mech": "run_trait_encoder(siglip2_base, Siglip2ImageEncoder::new) with 256 exact-square preprocessing",
      "data": "768-d SigLIP-2 image embedding",
      "breaks": "Same fail-soft: a missing SigLIP-2 file skips only its own pass."
    },
    {
      "a": "siglip2_encoder",
      "b": "tauri_commands",
      "mech": "commands::semantic dispatches the SigLIP-2 text branch when text_encoder_id is siglip2_base, loading the matching image cache",
      "data": "768-d text query vector -> SigLIP-2 cosine namespace",
      "breaks": "If SigLIP-2 is picked before any SigLIP-2 image embeddings exist, semantic search returns 0 results (cache populate finds 0 rows)."
    },
    {
      "a": "indexing",
      "b": "watcher",
      "mech": "Both share Arc<IndexingState> (single-flight AtomicBool); the watcher debounce-callback calls try_spawn_pipeline",
      "data": "AlreadyRunning signal",
      "breaks": "If single-flight breaks, two pipelines could run concurrently and double-write; WAL + INSERT OR IGNORE keep it safe but waste CPU."
    },
    {
      "a": "indexing",
      "b": "model_download",
      "mech": "Pipeline phase 1 calls download_models_if_missing; missing files fetched from HuggingFace (OpenCLIP LAION for CLIP) with HEAD preflight + chunked GET",
      "data": "ONNX weights + tokenizer JSON",
      "breaks": "Network failure logs warn and continues with whatever exists; encode/text phases gate on path.exists()."
    },
    {
      "a": "watcher",
      "b": "app_shell",
      "mech": "The watcher closure captures app.clone() to call try_spawn_pipeline and emit indexing-progress; handle stashed in Arc<Mutex<Option<WatcherHandle>>>",
      "data": "AppHandle + WatcherHandle",
      "breaks": "Dropping the handle cancels active watches; the watcher is NOT rebuilt on add_root/remove_root, so new roots are unwatched until next launch (documented gap)."
    },
    {
      "a": "multi_folder_roots",
      "b": "thumbnail_pipeline",
      "mech": "Each thumbnail lands in paths::thumbnails_dir_for_root(root_id); remove_root rm -rfs the per-root subfolder",
      "data": "per-root thumbnail files",
      "breaks": "Without per-root layout, root removal would orphan thumbnail files forever; legacy root_id=NULL rows still use the flat layout."
    },
    {
      "a": "multi_folder_roots",
      "b": "database",
      "mech": "roots table; images.root_id REFERENCES roots(id) ON DELETE CASCADE; PRAGMA foreign_keys=ON made CASCADE fire",
      "data": "root rows + cascade deletes",
      "breaks": "Disabling the FK pragma silently turns CASCADE into a no-op — orphan image rows accumulate."
    },
    {
      "a": "tauri_commands",
      "b": "frontend_state",
      "mech": "ApiError wire format pinned by serde tag=kind, content=details; the frontend ApiError union mirrors the kinds via formatApiError",
      "data": "typed error kinds",
      "breaks": "Adding a backend variant without updating the TS union triggers no runtime error — the default case handles unknown kinds gracefully."
    },
    {
      "a": "tauri_commands",
      "b": "cosine_similarity",
      "mech": "commands::similarity + semantic lock CosineIndexState.index (Mutex) via ? using the From<PoisonError> impl",
      "data": "query vector + top-k results",
      "breaks": "Mutex poison surfaces as ApiError::Cosine; the user retries and the next call relocks fresh."
    },
    {
      "a": "profiling",
      "b": "indexing",
      "mech": "tracing spans + record_diagnostic across commands, indexing phases, model_download, watcher, cosine; collected by PerfLayer only under --profiling",
      "data": "span timings + diagnostic payloads",
      "breaks": "Without --profiling, span construction still happens but no aggregator registers — overhead is one tracing dispatch per call, no allocation."
    },
    {
      "a": "profiling",
      "b": "frontend_state",
      "mech": "is_profiling_enabled resolved at mount gates <PerfOverlay>; recordAction -> record_user_action appends to the timeline only when profiling is on; perfInvoke wraps invoke",
      "data": "profiling flag + action breadcrumbs",
      "breaks": "Without profiling all React profiling state is dead — useState(profiling) is false and every gated branch short-circuits."
    },
    {
      "a": "search_routing",
      "b": "tauri_commands",
      "mech": "pages/[...slug].tsx invokes get_images, get_tiered/get_fused_similar_images, semantic_search and chooses by priority (similar > semantic > tag > all)",
      "data": "selection + query params -> result lists",
      "breaks": "If a command JSON shape changes without a TS update, the priority union silently falls back to whichever branch succeeded."
    },
    {
      "a": "masonry_layout",
      "b": "search_routing",
      "mech": "Masonry receives displayImages + selectedItem for hero promotion; tile dimensions come from the DB row not a DOM-Image round-trip",
      "data": "ImageItem[] with (w,h)",
      "breaks": "If width/height are NULL (legacy un-thumbnailed rows) Masonry falls back to a default aspect ratio."
    },
    {
      "a": "tag_system",
      "b": "database",
      "mech": "Tags use tags + images_tags; add_tag_to_image is INSERT OR IGNORE; delete_tag is wired; AND/OR via match_all_tags on get_images_with_thumbnails",
      "data": "tag rows + join rows",
      "breaks": "A typo tag now has a UI delete affordance; before it accumulated forever."
    },
    {
      "a": "frontend_state",
      "b": "search_routing",
      "mech": "queryClient staleTime Infinity; useIndexingProgress fires invalidateQueries([images]) on Phase::Ready; tag mutations invalidate after success",
      "data": "cache-key invalidation",
      "breaks": "A stale cache after a tag mutation would show wrong tags; onSuccess invalidation handles it. Cross-key staleness still possible without explicit invalidation."
    },
    {
      "a": "paths_and_state",
      "b": "database",
      "mech": "paths::app_data_dir()/images.db is the DB location; models_dir() checks LYNCEUS_MODELS_DIR then app-data; all disk paths flow from paths::*_dir()",
      "data": "every on-disk path",
      "breaks": "If app_data_dir() returns the wrong dir (a future macOS sandbox change) every state file goes to the wrong place; the com.ataca.lynceus rename already orphaned old-id libraries."
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
      "mech": "cosine/diagnostics.rs helpers (embedding_stats, pairwise_distance_distribution, self_similarity_check, score_distribution_stats) return serde_json payloads consumed by the search_query diagnostic",
      "data": "domain quality stats",
      "breaks": "If a helper panicked on a malformed cache the encoder populate would still succeed but the diagnostic payload would be missing; helpers early-return on empty cases."
    },
    {
      "a": "database",
      "b": "cosine_similarity",
      "mech": "schema_migrations::migrate_embedding_pipeline_version wipes legacy embeddings when CURRENT_PIPELINE_VERSION advances so the next pass re-encodes cleanly",
      "data": "embedding-pipeline version gate",
      "breaks": "Bumping the version without a real preprocessing change wipes + re-encodes with no quality gain — wasteful but not broken; the bump must pair with a real pipeline change."
    },
    {
      "a": "tauri_commands",
      "b": "clip_image_encoder",
      "mech": "list_available_encoders serves the static ENCODERS list (clip_vit_b_32, siglip2_base, dinov2_base) to the frontend picker",
      "data": "encoder metadata (id, dim, supports_text/image)",
      "breaks": "EncoderInfo is mirrored as a TS interface; adding a backend entry without updating the picker surfaces an option with empty rationale text."
    },
    {
      "a": "database",
      "b": "app_shell",
      "mech": "ImageDatabase writer (Mutex<Connection>) + read-only secondary (OnceLock<Mutex<Connection>>) opened on the same WAL file; foreground SELECTs use read_lock(), encoder writes use the writer",
      "data": "serialised writes, non-blocking reads",
      "breaks": "If the secondary fails to open, read_lock falls back to the writer mutex — restores the old contended-but-correct behaviour; :memory: test DBs have no secondary."
    },
    {
      "a": "indexing",
      "b": "cosine_similarity",
      "mech": "Both encoder loops call upsert_embeddings_batch once per ~32-image chunk (one BEGIN IMMEDIATE -> one COMMIT -> one fsync) with checkpoint_passive between batches under wal_autocheckpoint=0",
      "data": "batched embedding writes",
      "breaks": "If a batch fails partway the transaction rolls back — no embeddings from that batch land; the loop records write failures rather than pretending success."
    },
    {
      "a": "multi_encoder_fusion",
      "b": "search_routing",
      "mech": "useSimilarImages routes through fetchFusedSimilarImages -> get_fused_similar_images -> FusionIndexState.ranked_for_encoder x3 -> reciprocal_rank_fusion(k=60); get_fused_semantic_search does the text-image variant",
      "data": "3 per-encoder ranked lists -> one fused list",
      "breaks": "If a user views similar before any encoder indexed the clicked image, the per-encoder loop emits no_embedding_for_query_image and fusion returns empty rather than crashing."
    }
  ],
  "stateOwnership": [
    {
      "owner": "database",
      "items": "<app_data>/com.ataca.lynceus/images.db (WAL). TWO connections: writer Mutex<Connection> (encoder threads + foreground writes) + read-only secondary OnceLock (foreground SELECTs via read_lock()). WAL lets both coexist without per-row locking. Read by every command; written by indexing + tag/root mutations."
    },
    {
      "owner": "cosine_similarity",
      "items": "CosineIndex.cached_images (Arc<Mutex<CosineIndex>>, cloned across the indexing thread + Tauri-managed CosineIndexState) + cosine_cache.bin on disk. Invalidated on set_scan_root/add_root/remove_root/set_root_enabled. Read by similarity + semantic commands."
    },
    {
      "owner": "multi_encoder_fusion",
      "items": "FusionIndexState.per_encoder (Arc<Mutex<HashMap<encoder, CosineIndex>>>), one cache per encoder family, ~6 MB/encoder for 2000 images. invalidate_all() paired with cosine invalidation on every root mutation. Read by get_fused_* commands."
    },
    {
      "owner": "clip_text_encoder",
      "items": "TextEncoderState (Mutex<Option<...>>), CLIP + SigLIP-2 slots. Pre-warmed by the indexing thread; lazy fallback in commands::semantic. Heavy ONNX session, lives until process exit."
    },
    {
      "owner": "indexing",
      "items": "IndexingState.is_running (Arc<AtomicBool>) single-flight guard with RAII clear-on-panic. Shared with the watcher closure and every command that triggers an index."
    },
    {
      "owner": "watcher",
      "items": "WatcherHandle slot (Arc<Mutex<Option<WatcherHandle>>>). Filled by the setup callback; currently never refreshed on root change (documented gap — new roots unwatched until next launch)."
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
      "items": "TanStack QueryClient cache (staleTime Infinity; invalidated on Phase::Ready, modal close, tag mutations) + localStorage[lynceus prefs] (theme, columns, sortMode, animation, search counts, tagFilterMode, textEncoder). Theme mirrored to localStorage[theme] for pre-mount FOUC avoidance."
    },
    {
      "owner": "search_routing",
      "items": "selectedItem, searchText, searchTags, settingsOpen, perfOpen React state in pages/[...slug].tsx. URL slug is the source of truth for selection; selection resolves against displayImages."
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
    "rows": [],
    "note": "This pass fully inspected the refactor surface: the engine crate (crates/engine/src — db, cosine, paths, perf) and the product crate top-level (apps/lynceus/src-tauri/src — commands, lib.rs, indexing, model_download, encoders) were read against the new tree and the 6 refactor commit bodies. Encoder internals and the four frontend subsystems were re-verified against their existing (behaviourally-unchanged) system docs rather than re-read line by line, since the refactor was a pure move (125 lib tests before = 36 lynceus + 89 mnemosyne after). Not runtime-verified: the live \`tauri dev\` GUI launch (headless environment) — a desktop smoke-test remains the one open check."
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
      "name": "Semantic search (natural-language query)",
      "len": "22 steps · 8 subsystems",
      "steps": [
        "search_routing",
        "frontend_state",
        "tauri_commands",
        "clip_text_encoder",
        "siglip2_encoder",
        "cosine_similarity",
        "database",
        "profiling",
        "masonry_layout"
      ],
      "blast": "The longest path. Changing the text-embedding dimension, the ApiError wire shape, or the cosine cache-key contract ripples across the whole chain. Both the TextEncoder and CosineIndex mutexes gate throughput; the DB read-only secondary keeps it off the writer's back. A regression anywhere between steps 5 and 19 degrades every text search."
    },
    {
      "name": "Fused image-image similarity (View Similar)",
      "len": "UI -> IPC -> FusionIndexState x3 -> RRF(k=60) -> DB resolve -> IPC",
      "steps": [
        "masonry_layout",
        "search_routing",
        "tauri_commands",
        "multi_encoder_fusion",
        "cosine_similarity",
        "database"
      ],
      "blast": "get_fused_similar_images ranks the clicked image against CLIP + SigLIP-2 + DINOv2 caches and fuses via RRF. Blast radius is the FusionIndexState invalidation contract: forget invalidate_all on a future root-mutation IPC and fusion serves stale entries from a now-disabled root."
    },
    {
      "name": "Background indexing pipeline",
      "len": "scan -> download -> orphan -> thumbnail (rayon) -> encode x3 (batched) -> cosine populate + save",
      "steps": [
        "indexing",
        "filesystem_scanner",
        "model_download",
        "thumbnail_pipeline",
        "clip_image_encoder",
        "dinov2_encoder",
        "siglip2_encoder",
        "cosine_similarity",
        "database"
      ],
      "blast": "Single-flight via AtomicBool; each phase emits indexing-progress. Idempotent (INSERT OR IGNORE, needs-artefact queries), so re-launches are cheap. A batch failure rolls back its transaction; a missing encoder file skips only its own pass (per-encoder fail-soft)."
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
        "head": "Lynceus product (image vertical)",
        "kind": "boundary",
        "leaves": [
          "3 ONNX encoders",
          "JPEG thumbnailer",
          "indexing pipeline",
          "fs watcher",
          "Tauri IPC surface"
        ],
        "trunks": [
          "indexing",
          "clip_image_encoder",
          "siglip2_encoder",
          "tauri_commands",
          "watcher"
        ]
      },
      {
        "head": "Retrieval strategies",
        "kind": "learner",
        "leaves": [
          "CLIP text->image",
          "per-encoder cosine top-k",
          "RRF image-image + text-image fusion"
        ],
        "trunks": [
          "clip_text_encoder",
          "cosine_similarity",
          "multi_encoder_fusion"
        ]
      },
      {
        "head": "React frontend",
        "kind": "observer",
        "leaves": [
          "masonry grid",
          "priority routing",
          "tag + semantic search",
          "TanStack Query cache"
        ],
        "trunks": [
          "masonry_layout",
          "search_routing",
          "tag_system",
          "frontend_state"
        ]
      }
    ],
    "note": "Future verticals (Syrinx audio, Daedalus 3D) reuse the Mnemosyne branch and add their own product + encoder branches."
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
      "def": "MIT-licensed CLIP ViT-B/32 trained on LAION-2B (immich-app repo); a weights-only, commercially-licensed swap for OpenAI CLIP."
    },
    {
      "term": "DINOv2",
      "def": "Meta's self-supervised image-only encoder (Apache-2.0), 768-d, CLS-token embedding."
    },
    {
      "term": "SigLIP-2",
      "def": "Google's sigmoid-loss image+text encoder (Apache-2.0), 768-d shared space, MAP-head pooler_output."
    },
    {
      "term": "RRF",
      "def": "Reciprocal Rank Fusion (Cormack 2009, k=60) — fuses several per-encoder ranked lists into one."
    },
    {
      "term": "WAL",
      "def": "SQLite write-ahead logging; lets the read-only secondary connection serve foreground reads without blocking the writer."
    },
    {
      "term": "read-only secondary",
      "def": "A second SQLite connection opened SQLITE_OPEN_READ_ONLY on the same file; foreground SELECTs use it so they never queue behind encoder write batches."
    },
    {
      "term": "ort",
      "def": "The Rust ONNX Runtime binding (2.0.0-rc.10, pinned at the workspace root Cargo.lock)."
    },
    {
      "term": "CosineIndex",
      "def": "The engine's in-memory embedding cache with partial-sort top-k and a persistent cosine_cache.bin."
    },
    {
      "term": "FusionIndexState",
      "def": "Product-side per-encoder cosine caches used for image-image and text-image RRF."
    },
    {
      "term": "ApiError",
      "def": "The typed discriminated-union wire error (serde tag=kind) mirrored on the frontend for branchable error handling."
    },
    {
      "term": "embedding_pipeline_version",
      "def": "A meta-table gate; bumping it wipes legacy embeddings so the next indexing pass re-encodes cleanly."
    },
    {
      "term": "single-flight AtomicBool",
      "def": "IndexingState guard ensuring only one indexing pipeline runs at a time; watcher bursts coalesce."
    },
    {
      "term": "LYNCEUS_DATA_DIR / LYNCEUS_MODELS_DIR",
      "def": "Env overrides for the app-data directory and the encoder-weights directory (models_dir checks the latter first)."
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
      "why": "f7d1422: each product lives under apps/<product>/ with its React frontend beside its src-tauri crate — the Tauri-monorepo convention chosen specifically so tauri.conf.json frontendDist ../dist and the npm before-commands stay valid without change. Kept npm (not pnpm): a package-manager swap mid-restructure is unverifiable risk for no structural gain.",
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
    }
  ],
  "alerts": [],
  "changeFrontier": [],
  "kpis": [
    {
      "label": "Subsystems",
      "value": "21",
      "unit": "live",
      "delta": "engine 5 + product 12 + frontend 4",
      "tone": "sage"
    },
    {
      "label": "Rust tests",
      "value": "125",
      "unit": "lib",
      "delta": "lynceus 36 + mnemosyne 89 · pure-move split",
      "tone": "sage"
    },
    {
      "label": "Frontend tests",
      "value": "62",
      "unit": "vitest",
      "delta": "4 files · green",
      "tone": ""
    },
    {
      "label": "Encoders",
      "value": "3",
      "unit": "ONNX",
      "delta": "all commercial-licensed (MIT / Apache-2.0)",
      "tone": "violet"
    },
    {
      "label": "Tauri commands",
      "value": "28",
      "unit": "IPC",
      "delta": "typed ApiError surface",
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
    "total": 141,
    "range": [
      "2025-11-19",
      "2026-07-15"
    ],
    "peak": 70,
    "buckets": [
      {
        "date": "2025-11-19",
        "total": 49,
        "counts": {
          "foundation": 26,
          "retrieval": 12,
          "perf": 1
        }
      },
      {
        "date": "2025-12-09",
        "total": 13,
        "counts": {
          "retrieval": 7,
          "pipeline": 2,
          "foundation": 1
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
        "date": "2026-02-06",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-02-26",
        "total": 2,
        "counts": {
          "retrieval": 1
        }
      },
      {
        "date": "2026-03-18",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-04-07",
        "total": 70,
        "counts": {
          "modular": 11,
          "pipeline": 9,
          "retrieval": 15,
          "perf": 27,
          "foundation": 1
        }
      },
      {
        "date": "2026-04-27",
        "total": 1,
        "counts": {
          "modular": 1
        }
      },
      {
        "date": "2026-05-16",
        "total": 1,
        "counts": {
          "foundation": 1
        }
      },
      {
        "date": "2026-06-05",
        "total": 0,
        "counts": {}
      },
      {
        "date": "2026-06-25",
        "total": 5,
        "counts": {
          "commercial": 5
        }
      }
    ],
    "themes": [
      {
        "key": "foundation",
        "label": "Foundation & UI",
        "color": "var(--chart-1)"
      },
      {
        "key": "retrieval",
        "label": "Retrieval & encoders",
        "color": "var(--chart-2)"
      },
      {
        "key": "pipeline",
        "label": "Indexing pipeline & I/O",
        "color": "var(--chart-3)"
      },
      {
        "key": "perf",
        "label": "Perf & diagnostics",
        "color": "var(--chart-4)"
      },
      {
        "key": "modular",
        "label": "Modularisation & typed errors",
        "color": "var(--chart-5)"
      },
      {
        "key": "commercial",
        "label": "Commercialisation pivot",
        "color": "var(--chart-6)"
      }
    ],
    "series": [
      "foundation",
      "retrieval",
      "pipeline",
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
        "title": "Maintenance lull",
        "period": "2026-04..06",
        "commits": "~3",
        "theme": "modular",
        "summary": "README rewritten to the real feature surface; iCloud sync-conflict duplicate files removed and gitignored. Housekeeping between the surge and the pivot.",
        "highlights": [
          {
            "h": "7e5cf85",
            "t": "docs(readme): rewrite to reflect current feature surface"
          },
          {
            "h": "49efc38",
            "t": "Remove iCloud sync-conflict duplicates and gitignore them"
          }
        ]
      },
      {
        "n": 6,
        "title": "Commercialisation pivot",
        "period": "2026-07-15",
        "commits": "5",
        "theme": "commercial",
        "summary": "The portfolio piece becomes a product. OpenAI CLIP swapped for MIT OpenCLIP so all weights are commercially licensed; the media-agnostic core extracted into the Mnemosyne engine crate; the repo reshaped into an apps/ monorepo and rebranded Lynceus (product) / Mnemosyne (engine); weights relocated into a gitignored repo tree. Aimed at a Mac App Store paid release.",
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
      }
    ],
    "arc": "Lynceus began in November 2025 as a local Pinterest-style image browser — SQLite, a masonry grid, tags. It quickly grew a retrieval brain (CLIP embeddings, cosine search, semantic queries), then went quiet over the winter. In late April 2026 a single enormous autonomous burst turned it into a serious tool: an async indexing pipeline, three ONNX encoders with rank fusion, multi-folder watching, an opt-in profiling system, and a full code-health audit. After a maintenance lull it reached its inflection point in July 2026 — the commercialisation pivot that split the reusable Mnemosyne engine out of the Lynceus product, swapped every model to a commercial licence, and pointed the whole thing at the Mac App Store."
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
  "bespoke": []
}`);
