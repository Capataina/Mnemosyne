# apps/lynceus/src-tauri/src/thumbnail/

Image-thumbnail generation boundary used by Lynceus indexing and preview delivery. `mod.rs` re-exports `ThumbnailGenerator` from `generator.rs` (the whole implementation).

## Invariants

- Generate and cache adaptive JPEG buckets `{480, 960, 1440, 2048}` keyed by image ID and requested target pixels; frontend query keys must include the selected bucket. `THUMBNAIL_BUCKETS` (`commands/images.rs`) is the Rust source of truth, mirrored **by hand** in `useAdaptiveThumbnail.ts` — no codegen guard; a one-sided ladder edit makes the two sides snap requests to different buckets silently.
- Root/image removal must clean every bucket variant best-effort without turning cleanup residue into a database failure.
- Sizing is **width-based, never a bounding box**: `size_for_width` caps width at `max_width.min(width)` and derives height from the original aspect ratio. The masonry grid derives tile height from the DB-stored original dimensions, so a thumbnail only needs pixels for its rendered width — the old width×height box model actively over-shrank portrait/multi-column tiles to satisfy an unrelated height bound. 480 is the base bucket; larger buckets come from `ensure_variant` on demand or the eager Previews pass.
- Bucket eligibility is _strictly_ greater: `generate_buckets` skips any bucket `>= original_width` (never upscale). The Settings preview breakdown's per-tier denominators are built on exactly this rule (engine `get_preview_eligibility`, `width > bucket`) — a 700px image is not "missing" its 2048 preview.

## The API split — who decodes when

- `generate_thumbnail(path, id, root_id)` — the base 480 bucket; writes the file the DB's `thumbnail_path` points at.
- `ensure_variant(path, id, root_id, target_width)` — reactive single bucket. **Never pays a decode on a cache hit** (`exists()` short-circuit) — it is the hot path behind `get_thumbnail` for every stretched tile.
- `generate_buckets(path, id, root_id, widths)` — the eager path: `exists()` stat prepass (skips entirely if all cached), then decodes the source **once** at the largest requested width and downscales that one buffer to every missing smaller bucket.

Indexing runs **two passes**, deliberately not one: pass 1 generates every base 480 (cheap ~480px decode, DB write, feed-delta row); pass 2 runs `generate_buckets` for 960/1440/2048 only after every base landed. Folding buckets into pass 1 would make the base wait on the heaviest decode, regressing exactly the pop-in latency the split protects; pass 2 is invisible to the progress pill by design. Both passes run before the encoder phase (CPU-exclusive, no ORT contention) and share one `get_paths_to_root_ids()` result. `get_thumbnail`'s on-demand generation remains the fallback for anything pass 2 missed.

## `get_thumbnail(id, target_px)` resolution contract (`commands/images.rs`)

Snap `target_px` **up** to the smallest covering bucket; no covering bucket (> 2048), or bucket >= known source width → return the **original** path (unknown source width falls through rather than short-circuiting). Source-file existence is guarded up front so a deleted original yields typed `NotFound`, not a decode error. The 480 branch self-heals: on a missing base it regenerates AND persists via `db.update_image_thumbnail` — keeping pipeline stats and the grid query consistent when the command outruns the thumbnail phase. (The DB-driven initial grid paint does _not_ self-heal a manually deleted base file; only this command's path does.)

## File naming and layout — a cross-module contract

Base thumbnail: `<thumbnail_dir>/root_<root_id>/thumb_<image_id>.jpg` (`thumb_<image_id>.jpg` directly in the dir for legacy/no-root rows — both layouts coexist because the DB stores absolute paths). Bucket variants: `thumb_<image_id>_<target_width>.jpg`, always beside the base in the same per-root dir (`resolve_root_dir` is the single shared resolver, so the layouts can't drift), which is what lets `remove_root` clean a whole root with one `remove_dir_all`. This scheme is depended on outside this folder: `commands/images.rs::purge_orphaned_images` deletes both patterns per-file, and `commands/images.rs::get_preview_breakdown` counts bucket files on disk — buckets are deliberately **not DB-tracked** (a ~5k-dirent walk costs single-digit milliseconds; a tracking table would be a second source of truth to drift). Rename the scheme only with those consumers in the same change.

## Performance shape (don't regress casually)

Resize goes through `fast_image_resize` Lanczos3 (NEON; 7-13× the image crate at equal quality — was ~256 ms/image dominant cost), and JPEG sources decode through `jpeg-decoder`'s `Decoder::scale()`: `decode_jpeg_scaled` reads the header, picks the largest scale factor in {1, 2, 4, 8} still covering the target on both axes, and gets native scaled IDCT (~95% of IDCT work saved on 6000px → 480). Non-JPEG, header-read errors, and CMYK/L16 JPEGs fall back to the generic `image-rs` decode; `resize_with_fir` falls back to `image::imageops::resize` on any fir failure. Falling back is the documented worst case, not an acceptable steady state.

**Pipeline-version interaction:** the decode/resize output is the buffer every encoder preprocesses, so changing it shifts embeddings even under identical weights — mixing old and new corrupts cosine ranking. Any change here that alters the RGB buffer requires a `CURRENT_PIPELINE_VERSION` bump (`db/schema_migrations.rs`) so existing libraries wipe and re-encode.

**Known risk:** both rayon passes propagate per-image panics — one bad image fails the whole phase (`Phase::Error`); per-item `catch_unwind` isolation is a named follow-up, not implemented. Ordinary decode _errors_ are contained (warn + skip; base retried next run, buckets retried on next request).

## Place in the whole

Called from the indexing pipeline's thumbnail phase (base bucket) and the eager `Phase::Previews` pass (960/1440/2048 — pipeline-emitted as "Preparing larger previews", distinct from the thumbnail count Settings tracks), and from `commands/images.rs::get_thumbnail` for delivery. Frontend bucket selection (`useAdaptiveThumbnail`, other agents' surface) keys on the discrete bucket × device-pixel-ratio, keeps the base on screen until the sharper file resolves. Shares the `fast_image_resize` foundation with `similarity_and_semantic_search/preprocess.rs`.
