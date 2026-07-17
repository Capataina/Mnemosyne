# thumbnail-pipeline

*Maturity: comprehensive · Stability: unstable*

## Scope / Purpose

Generates and caches JPEG thumbnails for every image in the database, at multiple
resolutions, and writes the *base* thumbnail path plus original dimensions back to the
`images` table for masonry layout. The grid never loads full-resolution images for a tile —
only a thumbnail bucket matched to how wide the tile is actually rendered. The full image
loads only when the modal/inspector opens.

The v2 perf round replaced the single fixed-size thumbnail with an **adaptive-resolution
bucket ladder**: a small base thumbnail is produced eagerly at index time (cheap, keeps
pop-in fast), and larger buckets are generated on demand — then, moments later, pre-warmed
eagerly in a second background pass — so a masonry tile stretched across two or three
columns is crisp instead of upscaling a blurry 480px source.

## Boundaries / Ownership

- **Owns:** thumbnail file naming and bucket-file layout, sizing math (width-based, not a
  bounding box — see below), format choice (JPEG), upscale prevention, per-root subdirectory
  layout, the on-demand bucket-generation command's sizing/fallback contract.
- **Does not own:** the SQL update itself (delegates to `db.update_image_thumbnail` /
  `db.get_image_source_for_thumbnail`), full-resolution image rendering (frontend swaps to
  the original URL only when a tile `isSelected`), the rayon parallelisation of the *index-
  time* passes (lives in `indexing.rs`), the frontend's bucket-selection policy (owned by
  `useAdaptiveThumbnail` — see `masonry-layout` for the tile that consumes it), per-root
  path resolution (delegates to `paths::thumbnails_dir_for_root(root_id)`).
- **Public API:** `ThumbnailGenerator::new(thumbnail_dir, max_width)`,
  `generate_thumbnail(image_path, image_id, root_id)` (the base 480px bucket),
  `ensure_variant(image_path, image_id, root_id, target_width)` (on-demand single larger
  bucket, no decode on cache hit), `generate_buckets(image_path, image_id, root_id,
  bucket_widths)` (eager multi-bucket generation from a single decode), the Tauri command
  `get_thumbnail(id, target_px) -> String` (path resolution across the whole ladder,
  including "give me the original").

## Current Implemented Reality

### Width-based sizing, not a bounding box (perf round)

```rust
fn size_for_width(max_width: u32, width: u32, height: u32) -> (u32, u32) {
    let new_width = max_width.min(width);                                   // never upscale
    let new_height = ((height as u64 * new_width as u64) as f64
                       / width as f64).round() as u32;                      // aspect-preserved
    (new_width.max(1), new_height.max(1))
}
```

Source: `apps/lynceus/src-tauri/src/thumbnail/generator.rs:511-519`. This replaced an older
`max_width × max_height` box model. The masonry grid derives a tile's *height* purely from
the original image's aspect ratio and its own packed *width* — it never needs a height cap
on the thumbnail file, only enough pixels for whatever width the tile ends up rendered at.
A width-only cap is what keeps a portrait tile (or a multi-column-spanned tile) crisp
instead of being over-shrunk to satisfy an arbitrary height bound the old box model imposed.

### The bucket ladder

```rust
// commands/images.rs:24 — single source of truth for the ladder
pub const THUMBNAIL_BUCKETS: [u32; 4] = [480, 960, 1440, 2048];
```

- **480** is the *base* bucket: produced eagerly for every image during indexing
  (`ThumbnailGenerator::new(&thumbnails_dir, THUMBNAIL_BUCKETS[0])`, called with `max_width =
  480`). This is the file the `images.thumbnail_path` DB column points at, and the one every
  masonry tile shows at rest.
- **960 / 1440 / 2048** are on-demand buckets, produced the first time anything asks for
  them (via `ensure_variant`) and cached beside the base file as `thumb_<id>_<width>.jpg` in
  the same per-root directory. The perf round's eager second indexing pass (below)
  pre-populates these too, so "on demand" is really "on demand, but usually already there."
- Any request wider than the top bucket (2048), or a bucket that would meet or exceed the
  *source* image's own width, returns the **original** image path directly — the ladder never
  synthesises an upscaled file.

### `get_thumbnail(id, target_px)` — the resolution IPC command

`apps/lynceus/src-tauri/src/commands/images.rs:108-185`. Contract:

1. Look up `(source_path, root_id, source_width)` for `id` — `NotFound` if the row doesn't
   exist.
2. Snap `target_px` **up** to the smallest bucket in `THUMBNAIL_BUCKETS` that covers it. No
   bucket covers it (request bigger than 2048) → return the original path, no generation.
3. If the chosen bucket's width would meet or exceed the source's own known width → return
   the original (never upscale). An unknown source width (row not yet through the thumbnail
   phase) falls through rather than short-circuiting — correctness over the shortcut.
4. Guard the source file's existence up front, so a deleted original yields a typed
   `NotFound` rather than an opaque decode error surfacing from deep inside the generator.
5. `bucket == 480` → the base thumbnail. Return it if the file already exists; otherwise
   generate-and-cache it now (via `generate_thumbnail`) AND persist the result back through
   `db.update_image_thumbnail` — this keeps `get_pipeline_stats` and the grid's own query
   consistent with what just landed on disk, for the case where this command runs ahead of
   the thumbnail phase reaching that row.
6. `bucket ∈ {960, 1440, 2048}` → `ensure_variant`, which returns the cached path instantly
   if the file already exists (no decode paid on a cache hit — this is the hot path called
   per visible/stretched tile) or generates it from the source otherwise.

### `ensure_variant` vs `generate_buckets` — on-demand single bucket vs eager multi-bucket

`ensure_variant` (generator.rs:139-168) is the reactive path: one bucket, decode-on-miss
only, used by `get_thumbnail` when a tile is stretched into a resolution nothing has
produced yet. `generate_buckets` (generator.rs:190-244) is the **eager** path used by the
indexing pipeline's second thumbnail pass: given a set of bucket widths, it does a cheap
`exists()` stat pass first (skips entirely if every bucket is already cached), then decodes
the source **once**, at the *largest* requested bucket width, and downscales that single
decoded buffer to every missing smaller bucket — a bucket at or beyond the source's own
width is skipped (nothing to write; the original already serves that request per the ladder
contract).

### Indexing-time thumbnail generation is now TWO passes (perf round)

```
indexing.rs::run_pipeline_inner Phase::Thumbnail:

  Pass 1 (base, unchanged cadence from before the perf round):
    thumbnail_generator = ThumbnailGenerator::new(thumbnails_dir(), THUMBNAIL_BUCKETS[0])  // 480
    needs_thumbs        = db.get_images_without_thumbnails()
    path_to_root        = db.get_paths_to_root_ids()               // one SELECT, shared by both passes
    needs_thumbs.par_iter().for_each(|image| {
        generate_thumbnail(image.path, image.id, root_id)          // decode ~480px, cheap
        db.update_image_thumbnail(id, path, w, h)
        buffer a FeedDeltaRow, flush in batches of FEED_DELTA_BATCH  // see feed-protocol
        emit Phase::Thumbnail progress (per-image up to 4000 images, capped rate above that)
    })
    emit Phase::Thumbnail terminal tick

  Pass 2 (NEW — eager bucket pre-warm, runs only after every base has landed):
    eager_buckets = THUMBNAIL_BUCKETS[1..]                          // 960, 1440, 2048
    needs_thumbs.par_iter().for_each(|image| {
        generate_buckets(image.path, image.id, root_id, eager_buckets)   // one decode, N buckets
    })
```

Source: `apps/lynceus/src-tauri/src/indexing.rs:485-651`. **Why a second pass rather than
folding buckets into pass 1:** pop-in correctness requires the base 480 to land — and the
row to be marked thumbnailed — *first*, staying a cheap ~480px decode; decoding once at 2048
to produce base + all buckets together would make the base itself wait on the heaviest
decode, directly regressing the pop-in latency the perf round was fixing elsewhere. Running
pass 2 only after every base has landed also means every tile is already visible in the grid
before any high-resolution work starts. Both passes run before the encoder phase (CPU-
exclusive, so they don't contend with ORT inference threads) — `get_thumbnail`'s on-demand
generation remains the fallback for anything not pre-warmed here (legacy un-migrated rows, a
newly re-enabled encoder's re-index, or a bucket pass 2 itself failed to write for one file).

### Two-stage JPEG decode + resize (R6/R7, pre-existing, unchanged by the perf round)

```rust
let (rgb, original_width, original_height) =
    self.decode_jpeg_scaled(image_path, max_width)   // scaled IDCT at decode time (JPEG only)
        .unwrap_or_else(|| /* image-rs full decode, any format / any decode failure */);

if thumbnail_path.exists() { return Ok(...); }        // cache hit — no resize work

let resized = self.resize_with_fir(&rgb, w, h)?;      // fast_image_resize, NEON Lanczos3
image::DynamicImage::ImageRgb8(resized).save_with_format(&thumbnail_path, ImageFormat::Jpeg)?;
```

`decode_jpeg_scaled` reads the JPEG header for true dimensions, picks the largest scale
factor in `{1, 2, 4, 8}` such that the scaled buffer still covers the target size on both
axes, and calls `jpeg_decoder::Decoder::scale(...)` for native scaled IDCT at decode time —
for a 6000×3376 source shrunk to a 480-wide thumbnail this skips roughly 95% of the IDCT
work, leaving `fast_image_resize`'s Lanczos3 pass only a small downsample to do. Falls back
to the generic `image-rs` decoder for non-JPEG sources, any header-read error, or CMYK/L16
JPEGs (rare; `image-rs` handles them more robustly). `resize_with_fir` builds a zero-copy
`FirImage` over the RGB8 buffer and runs NEON-optimised Lanczos3, falling back to
`image::imageops::resize` if `fast_image_resize` fails for any reason.

**Pipeline-version interaction** (unchanged from before this round): both R6 and R7 change
the RGB buffer fed downstream into every encoder's preprocessing. Even with identical
encoder weights, embeddings from the new buffer differ slightly from the pre-R6/R7 buffer —
mixing them would corrupt cosine similarity. `CURRENT_PIPELINE_VERSION` bumps
(`db/schema_migrations.rs`) wipe all prior embeddings on first launch under new decode/resize
code so re-encoding produces a clean library. This mechanism is orthogonal to and unaffected
by the adaptive-bucket work — the base 480 thumbnail is still the buffer the encoders see.

### Per-root subfolder layout (unchanged, Phase 9)

```
<app_data_dir>/thumbnails/
  root_1/thumb_42.jpg  root_1/thumb_42_960.jpg  root_1/thumb_42_1440.jpg  root_1/thumb_42_2048.jpg
  root_2/thumb_99.jpg
  thumb_<id>.jpg                  ← legacy NULL-root_id rows, flat layout
```

Every bucket file for a given image lands beside its base file in the same per-root (or
flat, for legacy rows) directory — `resolve_root_dir` is the single shared path-resolution
helper both the base and on-demand/eager bucket paths call, so this can never drift.
`remove_root`'s cleanup remains a single `rm -rf` of the whole per-root subfolder, which now
also sweeps every bucket file for that root's images for free.

### Frontend: `useAdaptiveThumbnail` — bucket selection per tile

```ts
const THUMBNAIL_BUCKETS = [480, 960, 1440, 2048] as const;   // mirrors THUMBNAIL_BUCKETS in Rust
function bucketFor(targetPx: number) { return THUMBNAIL_BUCKETS.find(b => b >= targetPx) ?? null; }

const dpr = window.devicePixelRatio || 1;
const bucket = renderedWidth > 0 ? bucketFor(Math.ceil(renderedWidth * dpr)) : 480;
const needsLargerBucket = bucket !== null && bucket > 480 && item.hasThumbnail;

useQuery({
  queryKey: ["thumbnail", item.id, bucket],
  queryFn: () => getThumbnail(item.id, bucket).then(convertFileSrc),
  enabled: needsLargerBucket,
  staleTime: Infinity,      // a given (id, bucket) file is immutable until re-index
  gcTime: 5 * 60 * 1000,    // idle working set bound; mounted tiles are never evicted
});
```

Source: `apps/lynceus/src/hooks/useAdaptiveThumbnail.ts`. Keys on the *discrete bucket*, not
the raw rendered width — a smooth resize drag only triggers a new `useQuery` (and therefore
a new IPC round-trip) when the continuous width crosses a bucket boundary, not on every
pointer-move pixel. The base 480 stays on screen (upscaled by the browser) until the sharper
bucket resolves — the "keep current, sharpen on release" behaviour — and device-pixel-ratio
is folded into the target *before* bucket lookup, so a 2x-DPR display asks for double the
CSS-pixel width it's actually rendering at. Beyond the top bucket, or when the image has no
thumbnail yet, this returns the original URL / base thumbnail directly with zero IPC.

## Key Interfaces / Data Flow

```
Index time:
  indexing.rs Phase::Thumbnail
    Pass 1: generate_thumbnail(path, id, root_id) → base 480px, DB write, feed-delta row
    Pass 2: generate_buckets(path, id, root_id, [960,1440,2048]) → eager pre-warm, no DB write

Request time (a masonry tile stretched past its cached bucket):
  MasonryItem → useAdaptiveThumbnail(item, renderedWidth)
    → getThumbnail(id, bucket) IPC → get_thumbnail(id, target_px) command
       → cache hit: instant path return (ensure_variant's exists() short-circuit)
       → cache miss: decode + resize + cache, then return the new path
    → convertFileSrc(path) → <img src>
```

`ImageData::thumbnail_path` (the base bucket) still flows through `get_images_with_
thumbnails` / the feed manifest for the initial paint; `get_thumbnail` is purely the
adaptive upgrade path layered on top of that base.

## Implemented Outputs / Artifacts

- Up to 4 JPEGs per image at `<app_data_dir>/thumbnails/root_<id>/thumb_<image_id>[_<bucket>].jpg`
  (or flat for legacy NULL-root_id rows) — base 480 always produced at index time; 960/1440/2048
  produced eagerly (pass 2) or on demand (`get_thumbnail` fallback).
- DB row updated with `thumbnail_path` (the base file) + original `width`/`height` — used by
  `masonry-layout` for aspect-preserving packing.
- `THUMBNAIL_BUCKETS` as the single cross-language source of truth for the ladder, mirrored
  by hand in `useAdaptiveThumbnail.ts` (see Known Issues for the drift risk this implies).
- Tracing spans `pipeline.thumbnail_phase` and `pipeline.eager_bucket_pass` for perf
  attribution.
- `["thumbnail", id, bucket]` react-query cache entries, `staleTime: Infinity`, 5-minute
  `gcTime`.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| `THUMBNAIL_BUCKETS` is duplicated by hand (Rust `const` + a parallel TS `const`) | A future change to the ladder on one side only | The frontend would request a bucket boundary the backend doesn't recognise (or vice versa) — `get_thumbnail`'s `find(|b| *b >= target_px)` would snap to a different bucket than the frontend's own `bucketFor` expected, silently changing which file gets requested. No shared-codegen guard exists yet. |
| Thumbnail decode failure for a corrupt image | A bad `.jpg` byte in either pass | Logs a warning; DB row stays unmarked (base) or that bucket is simply missing (eager pass); a subsequent pipeline run retries the base, `get_thumbnail` retries a bucket on next request. |
| Disk-cache short-circuits (`exists()`) assume the DB/on-disk state is truthful | A user manually deletes a base or bucket JPEG file | A deleted base: the DB row still points at a non-existent path — the WebView gets a 404/empty asset, and nothing regenerates it until a full re-index (unverified in this pass — inherited from the pre-perf-round doc; `get_thumbnail`'s 480 branch would actually regenerate it correctly since it checks `base_path.exists()` directly rather than trusting the DB row, but the initial grid-paint `get_images`/`get_feed_manifest` DB-driven flow would not). A deleted bucket: `ensure_variant`/`get_thumbnail` regenerates it transparently on next request — no lasting effect. |
| Rayon `par_iter().for_each(...)` panics propagate | A panic inside `generate_thumbnail` or `generate_buckets` | Rayon re-throws on join; the pipeline body errors out, `Phase::Error` emitted — one bad image can fail the whole phase. Per-item `catch_unwind` isolation remains unimplemented (unchanged from before this round). |
| `get_paths_to_root_ids` returns the whole path→root map | Very large libraries (100k+ images) | ~10MB of paths held in memory during both thumbnail passes; shared between them (queried once) so the perf round did not add a second copy of this cost — acceptable at the scale this app targets. |
| Eager bucket pass (pass 2) adds a second full-library rayon sweep to every fresh index | A library where most images never get stretched past 1 column | Every image pays one extra high-resolution decode even if its 960/1440/2048 buckets are never actually viewed — a deliberate latency-for-disk/CPU trade (see Durable Notes) rather than a bug, but worth knowing as a real added cost on top of the base pass. |

## Partial / In Progress

None currently tracked for this subsystem.

## Planned / Missing / Likely Changes

- **Verify thumbnail file existence in the read paths that still trust the DB row**
  (inherited from the pre-perf-round doc, not reverified in this pass; the `get_thumbnail`
  480-branch already self-heals via its own `exists()` check, but the DB-driven grid-paint
  path does not).
- **Per-image error recovery (`catch_unwind`) in both rayon loops** so one panicking image
  can't fail the whole thumbnail phase.
- **Shared bucket-ladder source of truth** across Rust/TS (codegen or a build-time check)
  to close the manual-duplication drift risk above.
- **WebP/AVIF output** for smaller files at the cost of decode speed in the WebView
  (unchanged consideration from before the perf round).

## Durable Notes / Discarded Approaches

- **Width-based sizing over a width×height bounding box.** The masonry grid only ever needs
  a thumbnail wide enough for its packed *width*; height always follows from the original's
  aspect ratio. A box model was actively wrong for portrait/multi-column tiles (clamping
  height to satisfy an unrelated bound); the width-only cap fixes this by construction.
- **A discrete bucket ladder over a continuous/arbitrary-resolution cache.** Four fixed
  widths (480/960/1440/2048) mean the frontend only ever needs to key its cache on one of
  four values, so a smooth resize drag doesn't fire a request per pixel — it fires at most
  three times (crossing 480→960→1440→2048) across the entire size range. An arbitrary-
  resolution cache would need width-fuzzy matching or would thrash on every pixel of drag.
- **Eager second pass over folding buckets into the base pass.** Decoding once at the
  largest bucket width to produce base + all buckets together would make the *base*
  thumbnail wait on the heaviest decode — directly regressing pop-in latency. Splitting into
  two passes keeps the base pass exactly as cheap as before the adaptive-resolution work,
  at the cost of a second full-library decode sweep for the eager buckets (see Known Issues).
- **`ensure_variant` never pays a decode on a cache hit.** This is deliberate: it is the hot
  path called from `get_thumbnail` for every stretched/visible tile, so a decode-then-
  discard-because-cached would defeat the entire point of caching.
- **JPEG over WebP** for output format — every WebView decodes JPEG quickly with no
  surprises, and the encoder ships in the `image` crate already. WebP would save roughly
  20-30% of disk at the cost of some WebView decode-time variance (unchanged consideration).
- **Per-root subfolders (Phase 9), extended for free to cover bucket files.** Because every
  bucket file for an image lands in the exact same per-root directory as its base file
  (shared `resolve_root_dir`), `remove_root`'s `rm -rf` cleans up all four possible files per
  image with no extra bookkeeping.
- **Rayon over manual thread pools**, for both the base and eager-bucket passes — the
  parallelism is per-image and embarrassingly parallel in both cases, and rayon's work-
  stealing matches the workload shape.

## Obsolete / No Longer Relevant

- The single fixed `400×400` (box-model) thumbnail — replaced by the width-based 480 base +
  on-demand/eager 960/1440/2048 ladder.
- The pre-Phase-9 flat thumbnail layout — still exists only as the legacy fallback for
  un-migrated NULL-`root_id` rows.
- The N+1 `get_root_id_by_path` pattern — replaced by the single-SELECT
  `get_paths_to_root_ids`, now shared across *both* thumbnail passes rather than queried once
  per pass.

Cross-link: the tile that requests adaptive buckets via `renderedWidth`, and the pop-in
animation the base-thumbnail landing drives, live in `systems/masonry-layout.md`. The
`feed-delta` events emitted alongside base thumbnail generation (pass 1), and how the
frontend patches its manifest cache from them, live in `systems/feed-protocol.md`. The
pipeline phase ordering (`Phase::Thumbnail` runs before the encoder phase) and the
progress-emission discipline shared with the encode phase's high-water-mark pattern live in
`systems/indexing.md`. `update_image_thumbnail`, `get_paths_to_root_ids`,
`get_image_source_for_thumbnail`, and the per-root path helpers this subsystem calls live in
`systems/database.md`.
