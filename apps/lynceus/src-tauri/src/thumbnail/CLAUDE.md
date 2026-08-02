# apps/lynceus/src-tauri/src/thumbnail/

Image-thumbnail generation boundary used by Lynceus indexing and preview delivery.
`mod.rs` re-exports `ThumbnailGenerator` from `generator.rs` (the whole
implementation).

## Invariants

- Generate and cache adaptive JPEG buckets `{480, 960, 1440, 2048}` keyed by image
  ID and requested target pixels; frontend query keys must include the selected
  bucket.
- Root/image removal must clean every bucket variant best-effort without turning
  cleanup residue into a database failure.
- Sizing is **width-based, never a bounding box**: the masonry grid derives tile
  height from the original dimensions in the DB, so a thumbnail only needs pixels
  for its rendered width. 480 is the base bucket (`max_width`); larger buckets come
  from `ensure_variant` on demand or the eager Previews pass.
- Bucket eligibility is *strictly* greater: `generate_buckets` skips any bucket
  `>= original_width` (never upscale). The Settings preview breakdown's per-tier
  denominators are built on exactly this rule (engine `get_preview_eligibility`,
  `width > bucket`) — a 700px image is not "missing" its 2048 preview.

## File naming and layout — a cross-module contract

Base thumbnail: `<thumbnail_dir>/root_<root_id>/thumb_<image_id>.jpg`
(`thumb_<image_id>.jpg` directly in the dir for legacy/no-root). Bucket variants:
`thumb_<image_id>_<target_width>.jpg`. This scheme is depended on outside this
folder: `commands/images.rs::purge_orphaned_images` deletes both patterns per-file,
and `commands/images.rs::get_preview_breakdown` counts bucket files on disk —
buckets are deliberately **not DB-tracked** (a ~5k-dirent walk costs single-digit
milliseconds; a tracking table would be a second source of truth to drift). Rename
the scheme only with those consumers in the same change.

## Performance shape (don't regress casually)

Resize goes through `fast_image_resize` Lanczos3 (NEON; 7-13× the image crate at
equal quality — was ~256 ms/image dominant cost), and JPEG sources decode through
`jpeg-decoder`'s `Decoder::scale()` for native scaled IDCT (~95% of IDCT work saved
on 6000px → 400px). Falling back to plain `image` codepaths is the documented
worst case, not an acceptable steady state.

## Place in the whole

Called from the indexing pipeline's thumbnail phase (base bucket) and the eager
`Phase::Previews` pass (960/1440/2048 — pipeline-emitted as "Preparing larger
previews", distinct from the thumbnail count Settings tracks), and from
`commands/images.rs::get_thumbnail` for delivery. Shares the
`fast_image_resize` foundation with `similarity_and_semantic_search/preprocess.rs`.
