# Mnemosyne

> A monorepo of local-first asset browsers built on one shared engine. **Mnemosyne** (the engine) owns the asset catalogue, embedding storage, and retrieval; each product built on it turns that core into a browser for one kind of media. The first shipping product is **Lynceus**, a desktop image browser — Pinterest-style masonry, manual tagging, multi-encoder visual similarity, and natural-language semantic search, all running entirely on your machine with no cloud, no accounts, and no external services.

The names are a matched pair from Greek myth: Mnemosyne is the goddess of memory — the layer that remembers every asset — and Lynceus the Argonaut whose sight was sharp enough to see through the earth: the eye that searches it.

---

## Repository layout

A Cargo workspace (the engine + product crates) mirrored by a pnpm workspace (the product frontends). The engine is a path dependency with no frozen public API until a second product proves the seams.

```
Mnemosyne/                         monorepo root
├── crates/
│   └── engine/                    Mnemosyne — media-agnostic core (Cargo lib `mnemosyne`)
│                                    catalogue (SQLite/WAL) · flat mmap embedding stores ·
│                                    cosine + RRF fusion · domain types · paths · profiling
├── apps/
│   └── lynceus/                   Lynceus — the image-browser product
│       ├── src/                   React 19 frontend (pnpm pkg `lynceus-ui`)
│       ├── src-tauri/             Tauri app crate (Cargo bin `lynceus`)
│       │                            image encoders · thumbnailer · indexing pipeline ·
│       │                            filesystem watcher · Tauri command surface
│       └── design/                brand mark, App Store listing, release runbook
├── models/                        gitignored weights, fetched by the script below
│   ├── image/                     OpenCLIP · DINOv2 · SigLIP-2
│   ├── audio/                     (future — Syrinx)
│   └── 3d/                        (future — Daedalus)
├── scripts/                       model download / quantisation utilities
└── Cargo.toml                     workspace manifest
```

Only the encoders, thumbnailer, indexing pipeline, and Tauri surface are image-specific — everything below that line is media-agnostic. Future asset browsers — **Syrinx** (audio) and **Daedalus** (3D) — join as sibling `apps/<product>/` units that depend on the same engine.

---

# Lynceus

## Why Lynceus exists

File explorers are built for files, not images. When you have thousands of images across nested folders — reference collections, inspiration boards, photography libraries, art assets — navigating them with a file explorer means clicking through directories one by one with no way to search by meaning, find visually similar images, or organise by anything other than filename or date.

Lynceus treats your local image library as a first-class collection: thumbnailed, indexed, tagged, annotated, and searchable — both by text labels and by semantic meaning. Type "dark cinematic lighting" or "forest path at dusk" and find matching images without having manually tagged them. Click any image to instantly surface the visually similar ones from across your entire library. Add per-image notes to capture context the filename can't.

Everything runs locally. Embeddings are generated on your machine using ONNX Runtime. Store-shaped builds bundle the encoder models inside the app and are sandboxed with **no network entitlement** — macOS itself enforces that nothing ever leaves your machine. Dev builds without local weights make exactly one kind of network call: a first-launch model download; after that, you can disconnect entirely.

## Features

### Browsing

- **Pinterest-style masonry grid** with dense occupancy packing and aspect-ratio-preserving thumbnails — handles tens of thousands of images without performance degradation
- **Infinite scroll** with virtualised loading via TanStack Query
- **Adjustable column count, tile scale, and animation level**
- **Shuffle-on-entry feed** — the grid shuffles fresh each time you open it or return from a search, and newly-indexed images pop into place as their thumbnails finish, without existing tiles ever jumping
- **Drag-to-reorder and smooth drag-to-resize** — drag any tile (including 2×2/3×3 spans) to reposition it, or grab any of its four corners to resize it smoothly (it snaps to a whole column span on release); a live placeholder telegraphs the landing slot and the tile settles exactly where the preview showed, with neighbours packing densely around user-placed tiles; aspect ratio is always preserved, and a stretched tile automatically loads a higher-resolution preview so it stays crisp
- **Hover micro-interactions** (toggleable for low-power preference)
- **Fullscreen modal inspector** with prev/next navigation, keyboard shortcuts, and inline tag/note editing
- **Gesture-drawing timer** — a fullscreen, auto-advancing reference session over any view (main feed, tag-filtered results, search results, or an image's similar-set): configurable interval, pause/resume, pinch-to-zoom, two-finger pan, and Fit

### Multi-folder library

- **Add multiple root folders** to a single library — each scanned recursively, with per-folder enable/disable toggles
- **Live filesystem watcher** with 5-second debounce picks up new, moved, or deleted files — and rebuilds its watch set the moment folders are added, removed, or toggled
- **Moved files keep their identity** — BLAKE3 content-hash relinking recognises a relocated file and preserves its tags, manual placement, and embeddings through any folder restructure
- **Orphan detection and cleanup** — images whose source files disappear are hidden, not lost, and a scoped "Clean up" purge removes the permanently dead entries when you say so
- **Per-root thumbnail isolation** so adding or removing a folder never invalidates other folders' caches

### Tagging

- **Manual tags** with optional colours, added and removed per image from the inspector or search bar
- **Tag autocomplete** with `#tag` syntax in the search bar; tags can be created on the fly by typing a new name
- **AND / OR tag filtering** — show images that match all selected tags or any of them
- **Library drawer (folders-as-tags)** — a slide-in left drawer where every tag _is_ a folder (no separate folder concept); open a folder to browse it, or compose the feed with include ("must have") and exclude ("must not have") filters, each showing a live per-folder image count. Applying a filter always acts on the visible feed, leaving any open similar-set or search
- **Tag deletion** from the search bar dropdown, with optimistic UI updates throughout

### Notes

- **Per-image notes** — free-form text captured in the inspector and persisted to the local database

### Visual similarity search (image → image)

- **Click any image** in the inspector to retrieve the most visually similar images from the entire library
- **Similarity breadcrumb trail** — dive from one image into its similar-set and onward through a cascade, with a breadcrumb strip to rewind to any earlier image in the trail or step back one hop at a time
- **Multi-encoder fusion** combining three independently-trained vision models via **Reciprocal Rank Fusion** (Cormack 2009, k=60):
  - **CLIP ViT-B/32** (OpenCLIP, LAION-2B, MIT-licensed, 512-d) — strong on captionable visual concepts
  - **DINOv2-Base** (Meta, 768-d) — strong on self-supervised visual structure and texture
  - **SigLIP-2 Base 256** (Google, 768-d) — strong on full-image semantics with no centre-crop
- **Per-encoder toggles** in settings — enable any subset; the fusion ranker adapts automatically
- **ID-native fused retrieval** over per-encoder flat mmap embedding stores that survive restarts

### Semantic search (text → image)

- **Natural-language queries** — type "skull", "neon cityscape", "dynamic pose", or any free-form phrase
- **Text-image fusion** runs the query through every enabled text-capable encoder (CLIP and SigLIP-2) and fuses the rankings via RRF, just like image-image search
- **Tag search and semantic search coexist** — exact tag matches take priority; otherwise the query is treated as semantic
- **Filename search joins the fusion** alongside the semantic rankers
- **Debounced live search** with 300 ms input debouncing and 5-minute result caching

### Onboarding

- **A six-scene guided tour** — looping skeleton demonstrations with an animated cursor teach folders, arranging, filtering, semantic search, similarity, and the gesture timer on first launch; replayable any time from Settings → **Restart onboarding**
- **Reduced-motion aware** — with animations off (or `prefers-reduced-motion`), scenes render as captioned static filmstrips instead

### Settings drawer

- **Theme** — light, dark, or system
- **Display** — column count, animation level, image scale
- **Search** — result counts, tag-filter mode (AND/OR)
- **Folders** — add, remove, enable/disable scan roots; trigger manual rescans; clean up orphaned entries
- **Encoders** — per-encoder enable/disable toggles for image and text directions
- **Library stats** — indexing progress, per-size preview breakdown, and pipeline health at a glance
- **Reset** — clear preferences without touching the library

### Performance and observability

- **Parallel encoder execution** during indexing — all enabled encoders run concurrently with intra-thread tuning shared across the M2 P-cluster
- **JPEG fast path** using native scaled IDCT (`jpeg-decoder` 1/8, 1/4, 1/2 factor) followed by NEON-optimised Lanczos3 (`fast_image_resize`)
- **WAL-mode SQLite** with separate writer and read-only secondary connections, batched embedding upserts, and manual checkpointing between encoder batches
- **Feed manifest + delta protocol** and **off-main-thread masonry packing** on typed arrays — the grid stays responsive at 100k-library scale
- **Live indexing-status pill** showing scan, thumbnail, encoder, and preview progress in real time
- **Optional profiling mode** (`--profiling` flag) — span timing, 1 Hz RSS/CPU sampler, interaction telemetry, on-exit markdown report; zero overhead when off
- **INT8 quantized encoder weights** are the shipping default (~4× smaller than fp32); `scripts/quantize_models.py` produces the statically-calibrated variants, and `model_precision` in settings can switch a dev install between them

### Privacy and offline operation

- **Local-only storage** — SQLite database, thumbnail cache, and ONNX model files all live in your platform's app-data directory
- **No accounts, no telemetry, no API keys**
- **Store builds are sandboxed with no network entitlement** — models ship inside the app, and macOS itself enforces that nothing ever leaves the machine
- **Original images are never modified or moved** — only metadata, thumbnails, and embeddings are derived

## How to use

### First launch

1. Launch the app. A short onboarding tour (six looping demonstrations) plays on first launch and can be replayed any time from Settings → **Restart onboarding**. Store-shaped builds bundle the int8 encoder models inside the app; dev builds without local models download them from HuggingFace on first launch instead.
2. Open the **Settings drawer** (gear icon, top-right) and add at least one folder under the **Folders** section. The folder is scanned recursively for images (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tiff`).
3. The **indexing-status pill** in the top-right tracks progress through the pipeline phases:
   - **Scan** — discovering image files on disk (and content-hashing new ones so moved files keep their identity)
   - **Thumbnails** — generating the 480px base previews
   - **Encoders** — generating embeddings via the enabled encoders
   - **Previews** — pre-generating the larger 960/1440/2048 preview sizes (after search is already usable)
4. As thumbnails finish, images appear in the grid. As embeddings finish, similarity and semantic search become available for those images. Both run in the background; the grid is browsable immediately.

### Browsing the grid

- **Scroll** to load more images. The grid is infinite-scrolling with virtualised paging.
- **Click** any image to open the inspector modal.
- **Arrow keys** in the inspector navigate to the previous / next image.
- **Esc** closes the inspector.
- Use the **timer pill** on a selected image to start a fullscreen, auto-advancing reference session (the gesture timer): configurable interval, pause/resume, pinch-to-zoom, two-finger pan, and Fit — works over the main feed, tag-filtered results, and search results.

### Searching

- The search bar at the top of the page accepts both **tag queries** and **natural-language queries**.
- Type `#` to autocomplete from existing tags. Multiple tag pills can be combined; the AND/OR mode is configurable in the Search section of settings.
- Type plain text (no `#`) to run a **semantic search** across the library — for example, `forest path at dusk`, `geometric pattern`, or `portrait of a woman in red`.
- If your query matches an existing tag exactly, the tag filter takes priority; otherwise it is treated as semantic.

### Visual similarity

- Open any image in the inspector and click **View Similar** to retrieve images visually similar to it from across the library.
- Results are ranked by fused similarity across all enabled image encoders.
- The similarity view feeds the gesture timer too — start a timed session over the similarity ranking to practise from visually-related references at speed.

### Tagging and notes

- Open an image in the inspector. Use the **tag combobox** to add or remove tags; type a new name to create a tag on the fly.
- Use the **notes textarea** to capture any free-form context for the image. Notes are saved automatically.
- Tags are deletable from the search bar's autocomplete dropdown — useful for cleaning up stray tags.

### Encoder toggles

- Open settings and find the **Encoders** section. Each encoder (CLIP image, CLIP text, DINOv2 image, SigLIP-2 image, SigLIP-2 text) can be independently enabled or disabled.
- Disabling an encoder skips its computation during indexing and removes it from the fusion ranker. Re-enabling it triggers a background re-index for any images that don't yet have embeddings from that encoder.
- The fusion ranker operates over whichever encoders are enabled at query time.

### Profiling mode

If you're investigating performance, launch with the profiling flag:

```bash
pnpm run tauri dev -- -- --profiling
```

(The double `--` is required: the first separates `tauri` from its CLI, the second passes the flag through to the Rust binary.) An on-exit markdown report is written to the app-data directory. The flag is `--profiling`, not `--profile` — the latter collides with Tauri's own cargo-profile flag.

---

## Architecture

Lynceus runs as a Tauri 2 desktop application — React 19 frontend, Rust backend, the Mnemosyne engine crate beneath it, SQLite persistence, ONNX Runtime inference.

```
┌─────────────────────────────────────────────────────────────┐
│                      React 19 Frontend                      │
│                                                             │
│  • pages/[...slug].tsx   — single catch-all route           │
│  • Masonry / SearchBar / inspector / library drawer /       │
│    settings/ / onboarding/ / gesture-timer/                 │
│  • TanStack Query hooks for image, tag, root, search state  │
│  • Off-main-thread masonry packing (worker, typed arrays)   │
│  • Tauri event subscription for indexing-progress           │
│  • Optional PerfOverlay + telemetry (--profiling only)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri IPC (typed ApiError)
┌──────────────────────────────▼──────────────────────────────┐
│               Rust Backend (apps/lynceus/src-tauri)         │
│                                                             │
│  • commands/   — ~38 Tauri commands, grouped by concern     │
│  • indexing.rs — single-flight pipeline (scan → thumbs →    │
│                  encoders → previews)                       │
│  • thumbnail/  — JPEG scaled IDCT + Lanczos3, 480px base    │
│                  + 960/1440/2048 preview buckets            │
│  • watcher.rs  — notify-debouncer-mini, 5 s debounce,       │
│                  rebuilt on every root mutation             │
│  • similarity_and_semantic_search/                          │
│    ├── encoders/   CLIP / DINOv2 / SigLIP-2 (image + text)  │
│    └── ort_session — shared M2-tuned Session builder        │
│  • model_download.rs — HuggingFace dev-build fallback       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│             Mnemosyne engine (crates/engine)                │
│                                                             │
│  • db/      — SQLite catalogue (WAL, writer + read-only     │
│               secondary), tags, notes, roots, orphans,      │
│               BLAKE3 content-hash relinking                 │
│  • cosine/  — per-encoder retrieval + RRF fusion,           │
│               versioned flat mmap embedding stores          │
│  • paths.rs — platform app-data dir resolution              │
│  • profiling — span timing, samplers, on-exit report        │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                       Local Storage                         │
│                                                             │
│  <app-data-dir>/                                            │
│    images.db                  — metadata, tags, notes,      │
│                                  roots, content hashes      │
│    thumbnails/<root>/...      — 480px JPEG base previews    │
│                                  + 960/1440/2048 buckets    │
│    models/                    — CLIP, DINOv2, SigLIP-2      │
│    embstore_<encoder>.bin     — versioned flat mmap stores  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                       ONNX Runtime                          │
│                                                             │
│  • CLIP ViT-B/32 vision + text (OpenCLIP, 512-d)            │
│  • DINOv2-Base vision (Meta, 768-d)                         │
│  • SigLIP-2 Base 256 vision + text (Google, 768-d shared)   │
│                                                             │
│  CPU on macOS (CoreML produces runtime errors for these     │
│  graphs); CUDA on non-macOS with CPU fallback.              │
└─────────────────────────────────────────────────────────────┘
```

All durable architecture and engineering knowledge lives in per-folder `CLAUDE.md` files beside the code each one describes — each carries its folder's purpose, invariants, decisions, and traps.

---

## Design principles

- **Local-first** — all computation, storage, and inference runs on your machine. No cloud dependencies, no API keys, and in store builds no network _capability_ at all.
- **Privacy by construction** — original images are never modified or uploaded; thumbnails, notes, and embeddings are derived locally and stored in a local SQLite database.
- **Performance at scale** — adaptive preview buckets, batched encoder inference, per-encoder versioned mmap embedding stores, ID-native fused retrieval, a feed manifest/delta protocol, and off-main-thread masonry packing keep the UI responsive at large-library scale.
- **Offline ML inference** — every encoder runs entirely via ONNX Runtime. No Python, no external ML service, no GPU required (CUDA used on non-macOS when available).
- **Modularity and toggleability** — encoders are swappable; per-encoder toggles let you enable any subset without rebuilding. The fusion ranker adapts to whichever encoders are active.
- **Separation of concerns** — React frontend, Tauri IPC layer, product Rust crate, media-agnostic engine crate, and SQLite persistence are cleanly separated and independently testable; the full Rust and Vitest suites gate every change.
- **Observability when you need it, zero overhead when you don't** — the profiling layer is opt-in via a CLI flag and produces a structured markdown report on exit.

---

## Tech stack

| Layer | Tools |
| --- | --- |
| Desktop shell | Tauri 2 |
| Frontend | React 19, Vite 7, TanStack Query 5, Tailwind CSS 4, Radix UI, framer-motion, cmdk, lucide-react |
| Frontend testing | Vitest 4, Testing Library, JSDOM |
| Backend | Rust 2021 edition (product crate `lynceus` + engine crate `mnemosyne`) |
| Persistence | SQLite (WAL mode) via `rusqlite` |
| Content identity | `blake3` streaming content hashes |
| Image I/O | `image-rs`, `jpeg-decoder`, `fast_image_resize` |
| ML runtime | `ort = 2.0.0-rc.10` (ONNX Runtime bindings) |
| Tokenisation | HuggingFace `tokenizers` (BPE for CLIP, SentencePiece for SigLIP-2) |
| Filesystem watcher | `notify` + `notify-debouncer-mini` |
| Profiling | `tracing` + custom `PerfLayer`, `sysinfo` for RSS/CPU sampler |
| Concurrency | `rayon` for parallel encoder execution and content hashing |

---

## Running locally

```bash
# Clone the repository
git clone https://github.com/Capataina/Mnemosyne
cd Mnemosyne

# Install workspace dependencies (pnpm workspace — installs all apps)
pnpm install

# Fetch the encoder weights into the gitignored models/ tree (~2.4 GB, commercial-licensed)
python3 scripts/download_models.py --modality image
```

The fastest way to run Lynceus — a `just`/`pnpm` wrapper that points `LYNCEUS_MODELS_DIR` at the repo-local weights automatically, so you never type that env var:

```bash
just lynceus-dev       # dev mode, hot-reloading frontend
just lynceus-release   # optimized release build, opens the .app — for real perf testing
# or, without `just` installed:
pnpm run lynceus:dev
pnpm run lynceus:release
```

For everything else — profiling mode, a manual release bundle, a sealed sandbox test, or targeting a non-default models directory — the underlying commands:

```bash
# Dev mode, explicit models path
LYNCEUS_MODELS_DIR="$(pwd)/models/image" pnpm --filter ./apps/lynceus run tauri dev

# Profiling mode (writes a markdown report on exit)
LYNCEUS_MODELS_DIR="$(pwd)/models/image" pnpm --filter ./apps/lynceus run tauri dev -- -- --profiling

# Release bundle (full, including DMG — see `just lynceus-release` for a faster .app-only build)
pnpm --filter ./apps/lynceus run tauri build

# Store-shaped build sealed with a free ad-hoc signature, sandbox enforced — the local App Store rehearsal
just lynceus-sandbox-test
```

To run the test suites:

```bash
pnpm --filter ./apps/lynceus run test   # Vitest (frontend)
cargo test --workspace                  # cargo (engine + product)
```

No API keys required, and no internet connection required once the weights are fetched. Model weights are **not** committed — `scripts/download_models.py` downloads them into the gitignored `models/<modality>/` tree at the repo root so they are inspectable on disk and ready for the Tauri bundler to package into a shipped app. All three encoders carry commercial-friendly licences (OpenCLIP LAION MIT, DINOv2 and SigLIP-2 Apache-2.0).

### App data location

Derived state (SQLite DB, thumbnails, embedding stores, settings) lives under:

| Platform | Path                                                   |
| -------- | ------------------------------------------------------ |
| macOS    | `~/Library/Application Support/com.capataina.lynceus/` |
| Linux    | `~/.local/share/com.capataina.lynceus/`                |
| Windows  | `%APPDATA%\com.capataina.lynceus\`                     |

Override the state directory with `LYNCEUS_DATA_DIR`, and the model-weights directory with `LYNCEUS_MODELS_DIR` (used above to point the app at the repo-local `models/image`). There is no separate dev-vs-release state path.

---

## Project documentation

| Artefact | Purpose |
| --- | --- |
| [`README.md`](./README.md) | This file — monorepo intent, Lynceus features, usage, high-level architecture |
| per-folder `CLAUDE.md` | Each folder's complete knowledge — purpose, architecture, invariants, decisions, traps, and current state, kept beside the code it describes |
| git history | The full narrative record — every decision's story lives in its commit body |

---

## Summary

Mnemosyne is a monorepo built around one bet: the hard parts of a great local asset browser — the catalogue, the embedding stores, the fused retrieval — are the same for every kind of media, so they live in one media-agnostic engine and each product only adds the layer that sees its medium. Lynceus, the first product, brings intelligent image search to personal libraries without any cloud dependency: a Rust backend, Tauri 2 desktop shell, React 19 frontend, SQLite persistence layer, and ONNX Runtime inference pipeline, with three independently-trained vision encoders (OpenCLIP, DINOv2, SigLIP-2) fused via Reciprocal Rank Fusion to power both image-to-image and natural-language search, entirely offline on consumer hardware. Syrinx (audio) and Daedalus (3D) are the next eyes to open on the same memory.
