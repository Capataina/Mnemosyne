# Mnemosyne: a local engine for searching your own media, and Lynceus, the image browser built on it

> Lynceus is a desktop image browser that turns the folders already on your disk into a dense, searchable library: type a sentence or pick an image, and it finds the matching pictures by what they look like, with every model running on your own machine. Mnemosyne is the media-agnostic engine underneath it, which owns the catalogue, the stored embeddings and the ranking.

The names are a matched pair from Greek myth: Mnemosyne is the goddess of memory, the layer that remembers every asset, and Lynceus the Argonaut whose sight was sharp enough to see through the earth, the eye that searches it.

## Showcase: the grid, the search and the similarity trail as they actually render

These are the store screenshots, captured from real runs of the application on an openly licensed museum library rather than composed mock-ups.

| | |
|---|---|
| ![The library as a masonry grid](Store%20Screenshots/Lynceus/01-library.png) | ![Searching in plain language](Store%20Screenshots/Lynceus/02-semantic-search.png) |
| ![From a search into a similarity trail](Store%20Screenshots/Lynceus/03-search-to-trail.png) | ![Visual similarity from one image](Store%20Screenshots/Lynceus/04-visual-similarity.png) |
| ![The inspector](Store%20Screenshots/Lynceus/05-inspector.png) | ![Tags and folders](Store%20Screenshots/Lynceus/06-tags-and-folders.png) |
| ![The gesture-drawing timer](Store%20Screenshots/Lynceus/07-gesture-timer.png) | ![Private by architecture](Store%20Screenshots/Lynceus/08-private-by-architecture.png) |

## Overview: a search box for the images already on your disk, and nothing ever leaves the machine

### What it is and is not: a lens onto your folders, never a new home for them

Lynceus draws the image folders you point it at as a Pinterest-style masonry grid, lets you hang tags on them by hand, and answers two different questions about them: *show me more that look like this one*, and *show me the ones that match this sentence*. Folders are scanned where they sit and never copied, moved or renamed, so the library on disk stays the library and you can stop using Lynceus without extracting anything.

It deliberately is not several neighbouring products:

- **Not a cloud photo library.** Those services search pictures in words very well, and they need the pictures on their computers to do it. Here that never happens, which costs you every device but your own and buys a library that works with the network unplugged.
- **Not a photo editor or a professional catalogue.** There is no develop step, no raw processing and no export pipeline. It is built for finding images, not producing them.
- **Not Pinterest, despite borrowing the grid.** There is no network, no feed, no recommendations and nothing you do not already own.
- **Not a file manager or a search bar for the whole machine.** It knows one kind of media at a time, in the folders you chose.

### Who it is for: anyone whose gathered image collection has outgrown its folder tree

Illustrators and concept artists with reference boards, designers with years of saved inspiration, photographers with an archive they can no longer navigate by filename, and anyone whose downloads folder became an accidental library. What they share is a collection that was gathered rather than shot, so it has no chronology to sort by, and a memory of what an image *looked like* that is far better than their memory of where they filed it. They will not move the library, and they will not upload it.

### Why it exists: a filesystem indexes images by the wrong key

A filesystem addresses images by name and location; a person remembers them by appearance and subject. A folder puts each image in exactly one place, while a picture can be a cityscape, a lighting reference and that particular blue all at once, so any tree you build loses two of those three searches. Cloud services solve the search and require the upload; catalogue tools keep files local but only search what someone typed in; hand-tagging decays because nobody keeps it up. What changed is that image encoders which put pictures and sentences in one space became small enough to bundle in a desktop application and run on an ordinary laptop, so the search can finally run where the pictures already are.

## Features: every way to find an image by something you can actually remember

### Browsing: a dense grid that keeps every image's own shape

- **Masonry grid with aspect-ratio-preserving thumbnails**, packed densely by column, because a reference library is looked at for composition as much as subject and a cropped thumbnail shows something that is not the picture.
- **Infinite, virtualised scrolling** that stays fluid at libraries of tens of thousands of images, because the packing runs off the main thread.
- **Drag to reorder and drag a corner to resize**, snapping to whole column spans; the placeholder shown during the drag is exactly where the tile lands, and neighbours pack around it.
- **Shuffle on entry**, so the grid surfaces a fresh slice of the collection each time instead of the same first screen.
- **A full-screen inspector** with previous and next navigation, keyboard shortcuts, and inline tag and note editing.
- **Adjustable column count, tile scale and animation level**, with a reduced-motion mode.

### Finding by appearance: three encoders, one fused ranking

- **Visual similarity from any image.** Open an image and ask for more like it; follow the trail from one result to the next, with a breadcrumb strip to step back.
- **Plain-language search.** Type "forest path at dusk" or "dynamic pose" and get matching images you never tagged.
- **Three independently trained encoders, fused.** OpenCLIP ViT-B/32 is strong on captionable concepts, DINOv2-Base on visual structure and texture, and SigLIP-2 Base on whole-image semantics. Their rankings are combined with Reciprocal Rank Fusion, because no single model is good at every kind of resemblance.
- **Per-encoder toggles**, so any subset can run and the fusion adapts to whichever are enabled.
- **Filename and tag matches join the search**, and an exact tag match takes priority over a semantic reading.

### Organising: tags that cost nothing to keep

- **Manual tags with optional colours**, added from the inspector or with `#tag` autocomplete in the search bar.
- **AND and OR tag filtering**, and a library panel where every tag behaves like a folder you can open, include or exclude.
- **Per-image notes** for context a filename cannot carry.

### A library that follows your disk

- **Several root folders in one library**, each scanned recursively and individually switchable.
- **A live filesystem watcher** that picks up new, moved and deleted files.
- **Moved files keep their identity.** A file is recognised by a content hash, so renaming or reorganising folders keeps its tags, placement and embeddings.
- **Missing files are hidden, not destroyed**, and are cleared only when you ask, because an unmounted drive should not cost you your tagging work.

### Practice: a gesture-drawing timer over any view

A full-screen, auto-advancing reference session over the main feed, a tag filter, a search or a similarity set, with a configurable interval, pause, pinch-to-zoom, pan, and a strip of recent references you can revisit without losing your remaining time.

### Learning it: a guided tour that shows the real interface

A six-scene tour plays on first launch and can be replayed from Settings. Every scene depicts the actual interface, with the cursor arriving before anything responds, so it teaches rather than decorates.

## Behaviour: what Lynceus is held to

### Goals: private by architecture, read-only towards your files, honest about what it knows

- Nothing about your images leaves the machine, by design rather than by setting.
- The folders on disk are the library; Lynceus derives from them and never writes to them.
- Finding an image should rest on what you remember about it, not on upkeep you have to do by hand.

### Behaviours: what you see when you use it

| id | when | you see |
|---|---|---|
| B1 | You add a folder | It is scanned in place; images appear in the grid as their thumbnails finish, and become searchable as their embeddings finish. The grid is browsable immediately |
| B2 | You quit halfway through indexing | Indexing resumes on the next launch from where it stopped; searches meanwhile return results from what has been processed |
| B3 | You rename or move a folder of tagged images | The images keep their tags, notes and placement, and no duplicates appear |
| B4 | An image file cannot be decoded | It is left out of the library rather than given an empty vector that would surface as a confident wrong answer |
| B5 | A drive holding a root is unplugged | Its images are hidden and kept; nothing is purged until you choose Clean up |
| B6 | You drag a tile | The placeholder during the drag is exactly the arrangement you get on release |
| B7 | You search with the network off | Everything works exactly as it does online |

### Guarantees and limits: where it deliberately stops

- **It never modifies, moves or uploads an original image.** Only thumbnails, tags, notes and embeddings are derived, and they live in the application's own data directory.
- **The store build makes no network requests.** The encoder weights ship inside the application. This is a behavioural guarantee rather than one the operating system enforces: the sandboxed web view needs the network-client entitlement merely to start its helper processes, so the claim rests on the application never opening a connection.
- **Search quality depends on how much you have.** Fused rankers return the closest images that exist, so a sparse library gives looser neighbours than a dense one; it improves as the collection grows rather than with tuning.
- **First indexing is real work on your own hardware**, and on a large library it takes noticeable time. Progress is shown as a proportion of the whole, never as a time estimate the application cannot honestly make.
- **No accounts, no sharing, no sync, no plugins and no editing tools.** Each is a good idea for a different product.

## Getting started: build Lynceus from source and point it at a folder

### Requirements: an Apple Silicon Mac, Rust, Node with pnpm, and Python for the model script

- macOS on Apple Silicon is the shipping target. The code also builds on Linux and Windows, with ONNX Runtime using CUDA where available, but those builds are not maintained releases.
- Rust (stable, 2021 edition), Node with `pnpm`, and Python 3 for fetching the encoder weights.
- [`just`](https://github.com/casey/just) is optional and recommended.
- About 2.5 GB of free space for the full-precision weights.

### Install: clone, install, fetch the weights

```bash
git clone https://github.com/Capataina/Mnemosyne
cd Mnemosyne
pnpm install
python3 scripts/download_models.py --modality image
```

Success is a populated `models/image/` folder holding the OpenCLIP, DINOv2 and SigLIP-2 ONNX files. The weights are not committed; all three carry commercial-friendly licences (OpenCLIP LAION weights MIT, DINOv2 and SigLIP-2 Apache-2.0).

### Quick start: run it and add your first folder

```bash
just lynceus-dev        # or, without just: pnpm run lynceus:dev
```

The window opens and the tour plays. Open Settings (the gear, top right), add a folder under **Folders**, and watch the status pill move through Scan, Thumbnails, Encoders and Previews. Once Encoders has progressed, type a sentence into the search bar or open an image and choose **View Similar**.

### Usage: commands, settings and where your data lives

| command | what it does |
|---|---|
| `just lynceus-dev` | Development build with hot-reloading frontend, using the repository's own weights |
| `just lynceus-dev-telemetry` | The same, with the profiling layer on; writes a markdown report on exit |
| `just lynceus-release` | Optimised release `.app`, built and opened, for real performance testing |
| `just lynceus-sandbox-test` | A store-shaped build, ad-hoc signed with the sandbox enforced, to rehearse the sealed app locally |
| `just lynceus-mas-package` | The signed Mac App Store package (needs the Apple distribution identities) |

The profiling flag is `--profiling` (not `--profile`, which collides with Tauri's own cargo-profile flag), or `PROFILING=1` in the environment.

Derived state (the SQLite catalogue, thumbnails, embedding stores and settings) lives in the application's data directory, for example `~/Library/Application Support/com.capataina.lynceus/` on macOS. Override it with `LYNCEUS_DATA_DIR`, and the weights directory with `LYNCEUS_MODELS_DIR`.

## How it works: two journeys that meet at one catalogue

### Architecture: an engine that knows assets, and an application that knows images

```
  a folder you pick
          │
          ▼
  [ indexing pipeline ]  walks it, decides what is new or changed      (Lynceus)
          │
          ├──▶ [ thumbnailer ] ──▶ small renditions the grid can draw  (Lynceus)
          │
          └──▶ [ encoders ×3 ] ──▶ three vectors per image             (Lynceus)
                     │
                     ▼
               [ engine ] stores assets, vectors, tags: one catalogue  (Mnemosyne)
                     │
   a query ──────────┤  a sentence, or "more like this one"
                     ▼
               [ encoders ] turn the query into a vector               (Lynceus)
                     │
                     ▼
               [ engine ] ranks the library once per encoder,           (Mnemosyne)
                     │    then fuses the orderings by position
                     ▼
              [ desktop shell ] draws it as a masonry grid             (Lynceus)
```

Indexing and querying are not one pipeline but two journeys that share a store. Indexing is slow, rare and in the background; querying is fast, constant and has to feel instant. They share the encoders, which is the whole mechanism by which words find pictures: the model that described an image at index time interprets your sentence at query time. Fusion combines the encoders' orderings by *where* each image placed rather than by their scores, because scores from different models are not on a common scale.

| part | owns | lives in |
|---|---|---|
| Mnemosyne engine | The catalogue (assets, roots, tags, notes, content hashes), the embedding stores, cosine retrieval and rank fusion, app-data paths, profiling spans. Knows nothing about images | `crates/engine` |
| Encoders | Turning an image or a sentence into a vector, and nothing else | `apps/lynceus/src-tauri` |
| Indexing pipeline | Scheduling the expensive work (scan, thumbnails, encoders, previews) so it is interruptible and resumable | `apps/lynceus/src-tauri` |
| Thumbnailer | The base and preview renditions the grid draws | `apps/lynceus/src-tauri` |
| Filesystem watcher | Noticing disk changes and re-entering at the indexing pipeline, the only route into the catalogue | `apps/lynceus/src-tauri` |
| Desktop shell | Everything you see: grid, search, inspector, tagging, tour, timer. It asks the engine for answers and computes none of its own | `apps/lynceus/src` |
| Packaging pipeline | Turning source into a signed, sandboxed, uploadable package | `justfile`, `apps/lynceus/src-tauri` |

**The stack, and what each choice beat:**

- **Rust** for everything that owns anything, because running three models over tens of thousands of images on a consumer laptop is expensive, and shipping a Python interpreter inside a desktop application is a distribution problem. Python remains only in offline scripts that never ship.
- **Tauri 2 over Electron**, because the application already carries hundreds of megabytes of model weights and Electron would add a whole browser engine on top. A fully native interface lost on the grid, which is exactly what web layout and animation do well.
- **ONNX Runtime over a hosted embeddings service.** The service would have been simpler in every engineering respect and would send your images to someone else's computer. ONNX also runs models from three different training ecosystems through one runtime.
- **SQLite, embedded, with vectors in memory-mapped flat files beside it**, over a server database or a dedicated vector index. There is one writer on one machine, and at the target library sizes an exhaustive comparison is fast enough without a second store to keep consistent.
- **React 19** for the grid, because thousands of items whose positions keep changing want stable per-item identity and cheap re-rendering.
- **INT8 quantised weights as the shipping default**, which cut the bundle from several gigabytes to well under one, because download size decides whether people finish installing.

### Key concepts: the words this project uses

- **Lynceus**: the application you launch. **Mnemosyne**: the engine beneath it, and the repository's name.
- **Engine**: the media-agnostic half. If a sentence about it needs the word "picture", the behaviour is in the wrong place.
- **Encoder**: a trained model that turns an image or a sentence into a vector, so that resemblance becomes arithmetic.
- **Fusion**: combining several encoders' rankings by position, using Reciprocal Rank Fusion.
- **Root**: a folder you have pointed Lynceus at. A library is a set of roots.
- **Local-first**: there is no remote half at all. The offline case is not a degraded mode; it is the only mode.

### Invariants: what is always true of the system

- Only the engine opens the library or the catalogue.
- An asset's identity comes from its content, not its path.
- An identifier is never reused, so a new image can never inherit a deleted one's thumbnail.
- The engine contains no image-specific concept, and nothing outside the shell depends on the shell.
- Ranking happens in one place, the engine; the shell never re-sorts a result itself.
- Every persisted cache carries a header naming its format and inputs, is written to a temporary file and renamed into place, and refuses to load when either does not match.
- The shipping build makes no network request.

## Design: the images are the interface

Everything Lynceus draws that is not an image competes with the images for attention, so chrome is thin, quiet and mostly absent until summoned. The grid is dense on purpose: it would rather show three more rows than breathe, because the calm comes from how many images you can scan in one look. Images keep their own proportions, never cropped to tidy squares. Panels slide in from an edge and float over the grid instead of re-packing it, so opening the inspector never loses your place. Colour comes from your images: the interface's own palette is narrow and low in saturation, one family of type carries the text, and motion is short and decelerates into place like an object being handled.

What was tried and rejected, as kinds of thing:

- **A packer that recomputed the layout on release** was replaced, because a direct-manipulation surface must show during the gesture exactly what the gesture will produce.
- **An onboarding of pleasant abstract animations** was rebuilt, because motion that does not depict the real product teaches nothing.
- **Panels styled as distinct floating objects** were pulled back to edge-anchored slide-outs, because a free-floating panel invites the question of whether it can be moved and resized.
- **Anything dashboard-shaped** (statistic tiles, charts, a headline count of your images) is refused outright. A product about looking at images has no business displaying counts of them.

## Project layout: one engine crate, one application, and the scripts around them

```
Mnemosyne/
├── crates/engine/        Mnemosyne, the media-agnostic engine (Rust library `mnemosyne`)
├── apps/lynceus/         Lynceus, the image browser
│   ├── src/              the React frontend
│   ├── src-tauri/        the Tauri application crate: encoders, thumbnailer, indexing, watcher
│   └── design/           the brand mark, store listing and release runbook
├── scripts/              model download and quantisation, demo and test corpus fetchers
├── Store Screenshots/    the store marketing pages and the HTML each one is regenerated from
├── models/               the encoder weights, fetched by the script and never committed
└── justfile              the command runner
```

Every folder carries a `CLAUDE.md` with its purpose, invariants, decisions and traps in depth.

## Development: building, testing and the conventions every change follows

```bash
cargo test --workspace                    # engine and application Rust tests
pnpm --filter ./apps/lynceus run test     # the frontend suite (Vitest)
```

Both suites should finish green with exit code 0. The integration tests that load real model weights are marked `#[ignore]` and run with `cargo test --workspace -- --ignored` once the weights are fetched.

- Every command, pipeline phase and long-running operation carries a tracing span named `subsystem.action` (`pipeline.`, `cosine.`, `watcher.` and so on); nothing reports by printing.
- Tests live beside the code they cover.
- Lynceus's version lives in three manifests that move together (`apps/lynceus/package.json`, `apps/lynceus/src-tauri/Cargo.toml`, `apps/lynceus/src-tauri/tauri.conf.json`); the engine versions independently and moves only when its own code changes.
- Small changes land on `main`; larger ones go through a branch named `<kind>/<issue>-<slug>` and a pull request merged as a merge commit.

## Direction: more eyes on the same memory

Mnemosyne exists because the hard parts of a local asset browser (the catalogue, the embedding stores, the fused retrieval) are the same for every kind of media. Lynceus is the first browser on it; sibling browsers for audio and for 3D models are meant to join as new applications on the same engine, and the engine's interface stays deliberately unfrozen until a second one proves where its seams belong. Open work is tracked privately.

## Related work and acknowledgements: the models and ideas Lynceus stands on

- [OpenCLIP](https://github.com/mlfoundations/open_clip) and its LAION-2B ViT-B/32 weights, for the text-aligned encoder.
- [DINOv2](https://github.com/facebookresearch/dinov2) from Meta, for self-supervised visual similarity.
- [SigLIP-2](https://huggingface.co/google/siglip2-base-patch16-256) from Google, for whole-image semantics.
- Reciprocal Rank Fusion, after Cormack, Clarke and Büttcher (SIGIR 2009), for combining rankings that are not on a common scale.
- [ONNX Runtime](https://onnxruntime.ai) and the [`ort`](https://github.com/pykeio/ort) bindings, [Tauri](https://tauri.app), [SQLite](https://sqlite.org) and [BLAKE3](https://github.com/BLAKE3-team/BLAKE3).
- The demo library and store imagery come from museum open-access collections released with all rights waived.

## License: none granted yet

No licence file is published, so all rights are reserved by default. Open an issue if you want to use the code.
