use image::ImageReader;
use std::error::Error;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use tracing::{debug, error, info, warn};

use crate::db::ImageDatabase;

use fast_image_resize::{
    images::Image as FirImage, FilterType as FirFilter, PixelType, ResizeAlg, ResizeOptions,
    Resizer,
};

/// Thumbnail generator that creates smaller versions of images for faster loading.
/// Follows the same pattern as the Encoder struct for consistency.
///
/// Sizing is **width-based**, not a bounding box. The masonry grid
/// derives each tile's *height* from the original image dimensions
/// (stored in the DB), so a thumbnail only ever needs enough pixels for
/// its rendered *width*. A single `max_width` cap — rather than the old
/// `max_width × max_height` box — is what keeps a portrait or a
/// multi-column tile crisp instead of over-shrinking it to satisfy an
/// arbitrary height bound. `max_width` is the *base* bucket width
/// (480); larger buckets are produced on demand via `ensure_variant`.
pub struct ThumbnailGenerator {
    thumbnail_dir: PathBuf,
    max_width: u32,
}

impl ThumbnailGenerator {
    /// Create a new ThumbnailGenerator.
    ///
    /// # Arguments
    /// * `thumbnail_dir` - Directory where thumbnails will be stored
    /// * `max_width` - Maximum thumbnail width (aspect ratio preserved,
    ///   never upscaled). Height follows from the source aspect ratio.
    pub fn new(thumbnail_dir: &Path, max_width: u32) -> Result<Self, Box<dyn Error>> {
        // Create thumbnail directory if it doesn't exist
        fs::create_dir_all(thumbnail_dir)?;

        info!("=== Initializing ThumbnailGenerator ===");
        info!("Thumbnail directory: {}", thumbnail_dir.to_string_lossy());
        info!("Max width: {}", max_width);

        Ok(ThumbnailGenerator {
            thumbnail_dir: thumbnail_dir.to_path_buf(),
            max_width,
        })
    }

    /// Generate a base thumbnail for a single image.
    ///
    /// Returns the thumbnail path and the original image dimensions
    /// (width, height). The thumbnail lands in
    /// `<thumbnail_dir>/root_<root_id>/thumb_<image_id>.jpg` when a
    /// root_id is supplied (Phase 9 per-root organisation), or in
    /// `<thumbnail_dir>/thumb_<image_id>.jpg` when None (legacy
    /// fallback for un-rooted rows). This is the *base* (`self.max_width`,
    /// 480) bucket; on-demand larger buckets go through `ensure_variant`.
    #[tracing::instrument(name = "thumbnail.generate", skip(self, image_path), fields(image_id, root_id))]
    pub fn generate_thumbnail(
        &self,
        image_path: &Path,
        image_id: i64,
        root_id: Option<i64>,
    ) -> Result<ThumbnailResult, Box<dyn Error>> {
        // Determine thumbnail filename based on image ID and per-root subfolder
        let thumbnail_filename = format!("thumb_{}.jpg", image_id);
        let thumbnail_path = self.resolve_root_dir(root_id)?.join(&thumbnail_filename);

        // Decode the source at (a scaled version of) the base width. We
        // decode before the existence check because the caller needs the
        // *original* dimensions back for the DB row regardless of whether
        // the file already existed. The indexing pipeline only calls this
        // for rows that lack a thumbnail, so the cache-hit branch below is
        // effectively the idempotent-rerun safety net rather than a hot path.
        let (rgb, original_width, original_height) = self.decode_source(image_path, self.max_width)?;

        // Check if thumbnail already exists
        if thumbnail_path.exists() {
            return Ok(ThumbnailResult {
                thumbnail_path,
                original_width,
                original_height,
            });
        }

        // Calculate thumbnail dimensions while maintaining aspect ratio.
        // Note: this is computed against the *original* dimensions, not
        // the scaled-decode buffer — we want the same target as the old
        // path produced.
        let (thumb_width, thumb_height) =
            self.calculate_thumbnail_size(original_width, original_height);

        // R6 — fast_image_resize Lanczos3. Published Neoverse-N1
        // benchmarks show 7-13× speedup over image::imageops at the
        // same RGB8 + Lanczos3 quality. M2's NEON is wider than
        // Neoverse so the actual speedup should be at least as good.
        let resized = self.resize_with_fir(&rgb, thumb_width, thumb_height)?;

        // Save as JPEG with good quality. Quality 80 matches what
        // image-rs's default JpegEncoder used (~75-85 range).
        let dyn_img = image::DynamicImage::ImageRgb8(resized);
        dyn_img.save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)?;

        debug!(
            "Generated thumbnail: {} ({}x{} -> {}x{})",
            image_path.file_name().unwrap_or_default().to_string_lossy(),
            original_width,
            original_height,
            thumb_width,
            thumb_height
        );

        Ok(ThumbnailResult {
            thumbnail_path,
            original_width,
            original_height,
        })
    }

    /// Ensure an on-demand higher-resolution bucket exists, returning its
    /// path. Buckets are cached as `thumb_<image_id>_<target_width>.jpg`
    /// alongside the base thumbnail in the same per-root directory.
    ///
    /// Unlike `generate_thumbnail`, a cache hit returns immediately
    /// **without decoding the source** — this is the hot path called per
    /// visible tile from the `get_thumbnail` IPC command, so we must not
    /// pay a JPEG decode just to hand back a path that already exists.
    ///
    /// Never upscales: `size_for_width` caps the output width at the
    /// source width, so requesting a 960-wide bucket for a 500-wide
    /// source yields a 500-wide file rather than a blurry upscale. (The
    /// `get_thumbnail` command additionally short-circuits to the
    /// original image when a bucket would meet or exceed the source
    /// width, so this path is normally only reached for genuine
    /// downscales.)
    pub fn ensure_variant(
        &self,
        image_path: &Path,
        image_id: i64,
        root_id: Option<i64>,
        target_width: u32,
    ) -> Result<PathBuf, Box<dyn Error>> {
        let filename = format!("thumb_{}_{}.jpg", image_id, target_width);
        let out_path = self.resolve_root_dir(root_id)?.join(&filename);
        if out_path.exists() {
            return Ok(out_path);
        }

        let (rgb, original_width, original_height) = self.decode_source(image_path, target_width)?;
        let (thumb_width, thumb_height) = size_for_width(target_width, original_width, original_height);
        let resized = self.resize_with_fir(&rgb, thumb_width, thumb_height)?;
        let dyn_img = image::DynamicImage::ImageRgb8(resized);
        dyn_img.save_with_format(&out_path, image::ImageFormat::Jpeg)?;

        debug!(
            "Generated {}px bucket: {} ({}x{} -> {}x{})",
            target_width,
            image_path.file_name().unwrap_or_default().to_string_lossy(),
            original_width,
            original_height,
            thumb_width,
            thumb_height
        );
        Ok(out_path)
    }

    /// Eagerly generate the larger buckets for an image from a SINGLE
    /// decode of the source, so a tile's first stretch is instant rather
    /// than paying an on-demand decode+resize mid-gesture.
    ///
    /// Decodes once at the largest requested bucket width and downscales
    /// that one buffer to every applicable bucket — it never re-decodes
    /// per bucket. A bucket whose width meets or exceeds the source width
    /// is skipped entirely (the original is served there, so no file is
    /// needed), matching the `get_thumbnail` sizing contract exactly.
    /// Existing bucket files are left untouched, and if every requested
    /// bucket already exists the decode is skipped altogether. Returns the
    /// number of bucket files written this call.
    ///
    /// This is the eager counterpart to `ensure_variant`: identical
    /// `thumb_<id>_<w>.jpg` filenames in the same per-root dir, so
    /// `get_thumbnail` finds these cached and returns instantly, and still
    /// falls back to on-demand `ensure_variant` for anything not
    /// pre-generated (legacy rows, a re-enabled encoder, a bucket that
    /// failed here). The base `thumb_<id>.jpg` is NOT produced here — the
    /// index-time base pass owns it, so pop-in is never gated on this work.
    pub fn generate_buckets(
        &self,
        image_path: &Path,
        image_id: i64,
        root_id: Option<i64>,
        bucket_widths: &[u32],
    ) -> Result<usize, Box<dyn Error>> {
        let Some(&max_bucket) = bucket_widths.iter().max() else {
            return Ok(0); // No buckets requested.
        };
        let dir = self.resolve_root_dir(root_id)?;

        // Cheap stat pass first: only buckets whose file is missing are
        // worth a decode. A fully-cached image (re-index, second launch)
        // costs a few `exists()` calls and no decode at all.
        let missing: Vec<u32> = bucket_widths
            .iter()
            .copied()
            .filter(|w| !dir.join(format!("thumb_{image_id}_{w}.jpg")).exists())
            .collect();
        if missing.is_empty() {
            return Ok(0);
        }

        // One decode at the largest requested resolution; every smaller
        // bucket is a downscale of this same buffer.
        let (rgb, original_width, original_height) =
            self.decode_source(image_path, max_bucket)?;

        let mut written = 0usize;
        for w in missing {
            // Skip buckets at or above the source width — the original is
            // served there (no upscale, no file), per get_thumbnail. A
            // sub-bucket source (e.g. 700px) therefore writes nothing and
            // just pays one cheap decode.
            if w >= original_width {
                continue;
            }
            let out_path = dir.join(format!("thumb_{image_id}_{w}.jpg"));
            let (thumb_width, thumb_height) = size_for_width(w, original_width, original_height);
            let resized = self.resize_with_fir(&rgb, thumb_width, thumb_height)?;
            image::DynamicImage::ImageRgb8(resized)
                .save_with_format(&out_path, image::ImageFormat::Jpeg)?;
            written += 1;
        }

        debug!(
            "Eager buckets for {}: {} written ({}x{} source)",
            image_path.file_name().unwrap_or_default().to_string_lossy(),
            written,
            original_width,
            original_height
        );
        Ok(written)
    }

    /// Resolve (and create) the thumbnail directory for a root. `Some`
    /// routes into the per-root subfolder (`root_<id>/`); `None` uses the
    /// flat top-level dir (legacy un-rooted rows). Shared by both the
    /// base and the on-demand bucket paths so their files always land
    /// side by side.
    fn resolve_root_dir(&self, root_id: Option<i64>) -> Result<PathBuf, Box<dyn Error>> {
        let dir = match root_id {
            Some(rid) => self.thumbnail_dir.join(format!("root_{rid}")),
            None => self.thumbnail_dir.clone(),
        };
        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    /// Decode a source image to RGB8, targeting `max_width` for the
    /// JPEG scaled-decode fast path. Returns `(rgb, original_w, original_h)`.
    ///
    /// Tries the jpeg-decoder scaled path first (see `decode_jpeg_scaled`);
    /// on any miss or failure falls back to image-rs's general decoder,
    /// which has wider format support and better tolerance for malformed
    /// files. Shared by `generate_thumbnail` and `ensure_variant` so the
    /// two size classes decode identically.
    fn decode_source(
        &self,
        image_path: &Path,
        max_width: u32,
    ) -> Result<(image::RgbImage, u32, u32), Box<dyn Error>> {
        match self.decode_jpeg_scaled(image_path, max_width) {
            Some(out) => Ok(out),
            None => {
                // Generic fallback: image-rs decodes the full image,
                // we get RGB8 + dimensions.
                let img = ImageReader::open(image_path)?
                    .with_guessed_format()?
                    .decode()?
                    .to_rgb8();
                let (w, h) = img.dimensions();
                Ok((img, w, h))
            }
        }
    }

    /// R7 — JPEG scaled-decode fast path.
    ///
    /// Returns `Some((rgb, original_w, original_h))` if the source is a
    /// JPEG that decoded successfully under jpeg-decoder; `None`
    /// otherwise (caller falls through to the generic image-rs path).
    ///
    /// Algorithm:
    ///   1. Read JPEG header to get true dimensions.
    ///   2. Compute the smallest scale factor (1, 2, 4, 8) such that
    ///      the scaled output is still >= the target thumbnail size on
    ///      every axis. This way the fast_image_resize step that
    ///      follows only has a small downsample left to do.
    ///   3. Set Decoder.scale(scaled_w, scaled_h) and decode.
    ///
    /// `max_width` is the desired thumbnail width; the target is derived
    /// from it via `size_for_width` so the scaled buffer stays at least
    /// as large as the eventual thumbnail on both axes.
    ///
    /// On any error this returns None — the generic decoder above
    /// will then attempt the file with image-rs, which has wider
    /// format support and better tolerance for malformed JPEGs.
    fn decode_jpeg_scaled(
        &self,
        image_path: &Path,
        max_width: u32,
    ) -> Option<(image::RgbImage, u32, u32)> {
        let ext = image_path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("jpg") | Some("jpeg")) {
            return None;
        }
        let file = std::fs::File::open(image_path).ok()?;
        let mut decoder = jpeg_decoder::Decoder::new(BufReader::new(file));
        // Have to read metadata before scale().
        decoder.read_info().ok()?;
        let info = decoder.info()?;
        let (orig_w, orig_h) = (info.width as u32, info.height as u32);

        // Pick a scale factor — the largest in {1, 2, 4, 8} such that
        // the scaled buffer is >= the target thumbnail dims. Going
        // smaller would force fast_image_resize to upscale, which
        // defeats the purpose.
        let (target_w, target_h) = size_for_width(max_width, orig_w, orig_h);
        let mut factor: u16 = 8;
        while factor > 1
            && ((orig_w / factor as u32) < target_w
                || (orig_h / factor as u32) < target_h)
        {
            factor /= 2;
        }
        let scaled_w = (orig_w / factor as u32).max(1) as u16;
        let scaled_h = (orig_h / factor as u32).max(1) as u16;

        // jpeg-decoder's scale() asks for the *requested* width+height;
        // it returns the actual scaled dims (may be slightly different
        // due to MCU boundaries). We feed those back to image-rs.
        let (actual_w, actual_h) = decoder.scale(scaled_w, scaled_h).ok()?;
        let pixels = decoder.decode().ok()?;
        let pixel_format = decoder.info()?.pixel_format;

        // jpeg-decoder returns interleaved bytes in either RGB24 or
        // L8 (greyscale) layout depending on the source. We need RGB8
        // for the rest of the pipeline.
        let rgb = match pixel_format {
            jpeg_decoder::PixelFormat::RGB24 => {
                image::RgbImage::from_raw(actual_w as u32, actual_h as u32, pixels)?
            }
            jpeg_decoder::PixelFormat::L8 => {
                // Promote greyscale → RGB by replicating the channel.
                let mut buf =
                    Vec::with_capacity(pixels.len() * 3);
                for p in pixels {
                    buf.push(p);
                    buf.push(p);
                    buf.push(p);
                }
                image::RgbImage::from_raw(actual_w as u32, actual_h as u32, buf)?
            }
            // CMYK and L16 are rare for thumbnail sources; fall back
            // so image-rs can handle them via its more general decoder.
            _ => return None,
        };

        Some((rgb, orig_w, orig_h))
    }

    /// R6 — Lanczos3 resize via fast_image_resize on RGB8.
    fn resize_with_fir(
        &self,
        src: &image::RgbImage,
        target_w: u32,
        target_h: u32,
    ) -> Result<image::RgbImage, Box<dyn Error>> {
        let (sw, sh) = src.dimensions();
        // Trivial case — already at target size, or smaller (no
        // upscaling). Skip the resize entirely.
        if sw == target_w && sh == target_h {
            return Ok(src.clone());
        }
        // fast_image_resize 6 owns its own image types. We hand it the
        // raw RGB8 bytes directly via FirImage::from_vec_u8 — this is
        // the documented zero-copy path (avoids the DynamicImage
        // dance) and works because RgbImage's underlying buffer is
        // already in the U8x3 layout fast_image_resize expects.
        let src_fir = FirImage::from_vec_u8(
            sw,
            sh,
            src.as_raw().clone(),
            PixelType::U8x3,
        )
        .map_err(|e| format!("fast_image_resize source failed: {e}"))?;
        let mut dst = FirImage::new(target_w, target_h, PixelType::U8x3);
        let mut resizer = Resizer::new();
        let opts = ResizeOptions::new()
            .resize_alg(ResizeAlg::Convolution(FirFilter::Lanczos3));
        if let Err(e) = resizer.resize(&src_fir, &mut dst, &opts) {
            warn!("fast_image_resize failed ({e}); falling back to image-rs");
            return Ok(image::imageops::resize(
                src,
                target_w,
                target_h,
                image::imageops::FilterType::Lanczos3,
            ));
        }
        let buffer = dst.into_vec();
        image::RgbImage::from_raw(target_w, target_h, buffer).ok_or_else(|| {
            "fast_image_resize output buffer wasn't the expected RGB8 length"
                .into()
        })
    }

    /// Calculate thumbnail dimensions maintaining aspect ratio, capped at
    /// `self.max_width`. Will not upscale images narrower than the cap.
    /// Thin wrapper over the free `size_for_width` so callers that need a
    /// different bucket width (the on-demand path) share the same maths.
    fn calculate_thumbnail_size(&self, width: u32, height: u32) -> (u32, u32) {
        size_for_width(self.max_width, width, height)
    }

    /// Generate thumbnails for all images that don't have them yet.
    /// Similar to `encode_all_images_in_database` in Encoder.
    pub fn generate_all_missing_thumbnails(
        &self,
        db: &ImageDatabase,
    ) -> Result<(), Box<dyn Error>> {
        let images = db.get_images_without_thumbnails()?;

        if images.is_empty() {
            info!("All images already have thumbnails, skipping generation.");
            return Ok(());
        }

        info!(
            "Found {} images without thumbnails, generating...",
            images.len()
        );

        let total_images = images.len();
        let mut success_count = 0;
        let mut error_count = 0;

        for (idx, image) in images.iter().enumerate() {
            if (idx + 1) % 10 == 0 || idx == 0 {
                debug!("Generating thumbnails... {}/{}", idx + 1, total_images);
            }

            // Legacy bulk path: no per-root segregation (root_id None).
            // The indexing pipeline calls generate_thumbnail directly
            // with the actual root_id; this method is kept for the
            // simple "regenerate all missing" use case.
            match self.generate_thumbnail(Path::new(&image.path), image.id, None) {
                Ok(result) => {
                    // Update database with thumbnail info and original dimensions
                    match db.update_image_thumbnail(
                        image.id,
                        &result.thumbnail_path,
                        result.original_width,
                        result.original_height,
                    ) {
                        Ok(_) => {
                            success_count += 1;
                        }
                        Err(e) => {
                            error!("Failed to update database for image {}: {}", image.id, e);
                            error_count += 1;
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to generate thumbnail for {}: {}", image.path, e);
                    error_count += 1;
                }
            }
        }

        info!(
            "Thumbnail generation complete: {} succeeded, {} failed",
            success_count, error_count
        );

        Ok(())
    }

    /// Get the thumbnail path for an image ID (without generating).
    pub fn get_thumbnail_path(&self, image_id: i64) -> PathBuf {
        let thumbnail_filename = format!("thumb_{}.jpg", image_id);
        self.thumbnail_dir.join(thumbnail_filename)
    }
}

/// Width-based thumbnail sizing.
///
/// Scales so the output width is `min(max_width, source_width)`,
/// preserving aspect ratio and never upscaling; height follows from the
/// source aspect ratio. This replaces the old bounding-box maths: the
/// masonry grid derives a tile's height from the original dimensions and
/// only ever renders at a given *width*, so capping width (not a
/// width×height box) is what keeps portrait and multi-column tiles crisp
/// instead of over-shrinking them to satisfy an arbitrary height bound.
///
/// The multiply-before-divide is done in `u64`/`f64` so a large source
/// (e.g. 8000px) times a bucket width can't overflow a `u32` mid-calc.
fn size_for_width(max_width: u32, width: u32, height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (1, 1); // Degenerate source; never divide by zero.
    }
    let new_width = max_width.min(width);
    let new_height =
        ((height as u64 * new_width as u64) as f64 / width as f64).round() as u32;
    (new_width.max(1), new_height.max(1)) // Ensure at least 1px
}

/// Result of thumbnail generation containing paths and dimensions.
pub struct ThumbnailResult {
    pub thumbnail_path: PathBuf,
    pub original_width: u32,
    pub original_height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base bucket width the index-time thumbnails (and the generator's
    /// default in these tests) are produced at. Bumped from the old
    /// 400×300 box to a 480-wide cap so a 1-column tile is crisp on
    /// retina.
    const BASE_WIDTH: u32 = 480;

    #[test]
    fn test_calculate_thumbnail_size_landscape() {
        let temp_dir = std::env::temp_dir().join("thumb_test");
        let gen = ThumbnailGenerator::new(&temp_dir, BASE_WIDTH).unwrap();

        // Landscape 2000x1500 → width-capped to 480, height follows aspect.
        let (w, h) = gen.calculate_thumbnail_size(2000, 1500);
        assert_eq!(w, 480);
        assert_eq!(h, 360);
    }

    #[test]
    fn test_calculate_thumbnail_size_portrait() {
        let temp_dir = std::env::temp_dir().join("thumb_test");
        let gen = ThumbnailGenerator::new(&temp_dir, BASE_WIDTH).unwrap();

        // Portrait 1500x2000 → width-capped to 480; height is now free to
        // exceed the width (the old box model wrongly clamped it to 300).
        // A tall tile needs those height pixels to render sharply.
        let (w, h) = gen.calculate_thumbnail_size(1500, 2000);
        assert_eq!(w, 480);
        assert_eq!(h, 640);
    }

    #[test]
    fn test_calculate_thumbnail_size_no_upscale() {
        let temp_dir = std::env::temp_dir().join("thumb_test");
        let gen = ThumbnailGenerator::new(&temp_dir, BASE_WIDTH).unwrap();

        // Small image 100x100 should not be upscaled to the 480 cap.
        let (w, h) = gen.calculate_thumbnail_size(100, 100);
        assert_eq!(w, 100);
        assert_eq!(h, 100);
    }

    #[test]
    fn test_calculate_thumbnail_size_wide() {
        let temp_dir = std::env::temp_dir().join("thumb_test");
        let gen = ThumbnailGenerator::new(&temp_dir, BASE_WIDTH).unwrap();

        // Very wide image 4000x1000 is width-constrained to 480 → 120 tall.
        let (w, h) = gen.calculate_thumbnail_size(4000, 1000);
        assert_eq!(w, 480);
        assert_eq!(h, 120);
    }

    #[test]
    fn test_get_thumbnail_path() {
        let temp_dir = std::env::temp_dir().join("thumb_test");
        let gen = ThumbnailGenerator::new(&temp_dir, BASE_WIDTH).unwrap();

        let path = gen.get_thumbnail_path(42);
        assert!(path.to_string_lossy().contains("thumb_42.jpg"));
    }

    // ================================================================
    //  Bucket sizing — the on-demand multi-resolution ladder. These
    //  exercise `size_for_width` directly at the bucket widths the
    //  `get_thumbnail` command selects, independent of any generator
    //  instance.
    // ================================================================

    #[test]
    fn size_for_width_hits_exact_bucket_width_when_source_is_larger() {
        // A 6000x4000 source at the 960 bucket → exactly 960 wide,
        // 640 tall (aspect preserved).
        assert_eq!(size_for_width(960, 6000, 4000), (960, 640));
        // Same source at the 1440 and 2048 buckets.
        assert_eq!(size_for_width(1440, 6000, 4000), (1440, 960));
        assert_eq!(size_for_width(2048, 6000, 4000), (2048, 1365));
    }

    #[test]
    fn size_for_width_never_upscales_past_source_width() {
        // A 500-wide source can never exceed 500, whatever bucket is asked.
        assert_eq!(size_for_width(960, 500, 400), (500, 400));
        assert_eq!(size_for_width(2048, 500, 400), (500, 400));
    }

    #[test]
    fn size_for_width_survives_degenerate_dimensions() {
        // Zero-dim sources must not divide by zero; clamp to 1x1.
        assert_eq!(size_for_width(480, 0, 100), (1, 1));
        assert_eq!(size_for_width(480, 100, 0), (1, 1));
        // A 1px source stays 1px.
        assert_eq!(size_for_width(480, 1, 1), (1, 1));
    }

    #[test]
    fn size_for_width_handles_large_sources_without_overflow() {
        // 8000-wide source × a 2048 bucket would overflow u32 if the
        // height maths multiplied in u32; the u64/f64 widening prevents it.
        let (w, h) = size_for_width(2048, 8000, 6000);
        assert_eq!(w, 2048);
        assert_eq!(h, 1536);
    }
}
