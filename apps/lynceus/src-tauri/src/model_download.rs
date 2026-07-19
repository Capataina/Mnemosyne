//! First-launch ONNX model + tokenizer download with live progress.
//!
//! Files land in `paths::models_dir()` and are skipped if already present.
//! A caller-supplied `Progress` callback receives running totals after a
//! HEAD-request preflight establishes the aggregate target size; the
//! indexing thread wires this through to the `indexing-progress` Tauri
//! event channel so the frontend pill can render a smooth bar across all
//! files.
//!
//! ## Sources
//!
//! All FP32 (no quantization). Per-encoder details below. The image-family
//! weights all carry commercial-friendly licences (MIT / Apache-2.0) so the
//! shipped app can be sold — see the CLIP note.
//!
//! ### CLIP ViT-B/32 — OpenCLIP LAION-2B (immich-app/ViT-B-32__laion2b-s34b-b79k)
//!
//! Swapped from OpenAI's `Xenova/clip-vit-base-patch32` weights, which are
//! released under a NON-COMMERCIAL research licence and cannot ship in a paid
//! app. The LAION-2B-trained OpenCLIP weights are **MIT-licensed** and a
//! byte-for-byte drop-in: identical CLIP BPE tokenizer, identical image
//! preprocessing, identical 512-d output space — so only these two URLs
//! changed, no encoder code.
//!
//! - **visual/model.onnx** (~352 MB) — input `image` [1,3,224,224];
//!   output `embedding` [1,512]. Renamed from the OpenAI/Xenova
//!   export's `pixel_values` / `image_embeds` — this immich-app
//!   export uses different ONNX I/O node names, verified directly
//!   against the downloaded model (`onnx.load(...).graph.input`).
//! - **textual/model.onnx** (~254 MB) — input `text` [1,77] ONLY
//!   (no separate attention_mask — mask is baked into the graph from
//!   the pad-token positions); output `embedding` [1,512]. Renamed
//!   from `input_ids` / `text_embeds` on the old export.
//! - **tokenizer.json** (~2 MB) — CLIP BPE byte-level, max 77 tokens, pad
//!   with id 49407. Still mirrored from Xenova's OpenAI export; it is the
//!   open_clip MIT vocab/merges in practice (not trained weights), but its
//!   provenance should be re-sourced from an explicitly-MIT repo before a
//!   paid release. Pre-sale checklist item, not a code blocker.
//! - Image preprocessing: resize shortest-edge 224 (bicubic) +
//!   center-crop 224×224, mean=[0.48145466, 0.4578275, 0.40821073],
//!   std=[0.26862954, 0.26130258, 0.27577711]
//!
//! ### DINOv2-Base (Xenova/dinov2-base) — image-only
//!
//! - **model.onnx** (~347 MB) — input `pixel_values`
//!   [1,3,224,224]; output `last_hidden_state` [1,257,768], CLS
//!   token = first row
//! - Image preprocessing: resize shortest-edge 256 (bicubic) +
//!   center-crop 224×224, ImageNet mean=[0.485, 0.456, 0.406],
//!   std=[0.229, 0.224, 0.225]
//!
//! ### SigLIP-2 Base 256 (onnx-community/siglip2-base-patch16-256-ONNX)
//!
//! - **vision_model.onnx** (~372 MB) — input `pixel_values`
//!   [1,3,256,256]; output `pooler_output` [1,768] (MAP head)
//! - **text_model.onnx** (~1.13 GB) — input `input_ids` only
//!   [1,64] int64 (NO attention_mask — fixed-length path); output
//!   `pooler_output` [1,768]
//! - **tokenizer.json** (~34 MB) — Gemma SentencePiece, 256k vocab,
//!   max 64 tokens, pad with id 0, auto-appends EOS
//! - Image preprocessing: stretched-square resize to 256×256 (bilinear,
//!   no center-crop), mean=std=[0.5, 0.5, 0.5] → [-1, 1] range
//!
//! Total first-launch download: ~2.5 GB.

use std::error::Error;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::Path;

use tracing::{debug, info, warn};

use crate::paths;

use crate::similarity_and_semantic_search::{encoder_dinov2, encoder_siglip2};

// =====================================================================
// CLIP ViT-B/32 (Xenova) — separate vision + text + tokenizer
// =====================================================================

/// CLIP image encoder ONNX. OpenCLIP LAION-2B ViT-B/32 vision tower
/// (MIT-licensed) — input `image`, output `embedding` [1,512].
/// Replaces OpenAI's non-commercial weights for the commercial pivot.
const CLIP_VISION_URL: &str =
    "https://huggingface.co/immich-app/ViT-B-32__laion2b-s34b-b79k/resolve/main/visual/model.onnx";

/// CLIP text encoder ONNX. OpenCLIP LAION-2B ViT-B/32 text tower
/// (MIT-licensed). Same CLIP BPE tokenizer and 512-d output space as the
/// OpenAI weights it replaces, so text-to-image search is unaffected.
const CLIP_TEXT_URL: &str =
    "https://huggingface.co/immich-app/ViT-B-32__laion2b-s34b-b79k/resolve/main/textual/model.onnx";

/// CLIP tokenizer (byte-level BPE). Still mirrored from Xenova's OpenAI
/// export — functionally the open_clip MIT vocab/merges. Re-source from an
/// explicitly-MIT repo before a paid release (pre-sale checklist item).
const CLIP_TOKENIZER_URL: &str =
    "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json";

pub const CLIP_VISION_FILENAME: &str = "clip_vision.onnx";
pub const CLIP_TEXT_FILENAME: &str = "clip_text.onnx";
pub const CLIP_TOKENIZER_FILENAME: &str = "clip_tokenizer.json";

/// Callback signature for download progress.
///
/// `processed` and `total` are aggregate byte counts across all
/// downloads in the current call; `current_file` is the filename
/// being fetched right now (or `None` if no file-specific work is
/// happening, e.g. during the HEAD-request preflight).
pub type ProgressFn = dyn Fn(u64, u64, Option<&str>) + Send + Sync;

/// Download every model file that is missing from `paths::models_dir()`.
/// Already-present files are left alone.
///
/// `progress` is invoked with running aggregate byte totals as bytes
/// land. The callback is also invoked once at the start with
/// `(0, total_bytes_to_download, None)` after the HEAD preflight, so
/// the UI can show the eventual size before any actual download begins.
#[tracing::instrument(name = "model_download.all", skip(progress))]
pub fn download_models_if_missing<F>(progress: F) -> Result<(), Box<dyn Error>>
where
    F: Fn(u64, u64, Option<&str>) + Send + Sync + 'static,
{
    let models_dir = paths::models_dir();

    // CLIP (legacy default + reliable text encoder) + SigLIP-2 (new
    // default text+image, sigmoid loss, better English alignment) +
    // DINOv2 (image-only "View Similar" specialist).
    //
    // All eight files are downloaded eagerly at first launch so every
    // encoder choice in the Settings picker "just works" without
    // mid-session downloads. Total size on disk: ~2.5GB.
    //
    // Per-file fail-soft: a single 401/404 doesn't abort the batch —
    // each file's failure is logged with its URL so the user can
    // identify which one needs a corrected URL. Each encoder family's
    // URLs live in its own module (encoder_siglip2.rs, encoder_dinov2.rs)
    // for localised fixes.
    let targets = [
        // CLIP family — separate vision + text branches (NOT the
        // combined-graph model, which embeds the multilingual text
        // tower that misaligns with the image space).
        (CLIP_VISION_URL, CLIP_VISION_FILENAME),
        (CLIP_TEXT_URL, CLIP_TEXT_FILENAME),
        (CLIP_TOKENIZER_URL, CLIP_TOKENIZER_FILENAME),
        // DINOv2-Base (image only — no text encoder, no tokenizer).
        // Upgraded from -Small (384-dim → 768-dim, ~4× capacity).
        (
            encoder_dinov2::DINOV2_IMAGE_MODEL_URL,
            encoder_dinov2::DINOV2_IMAGE_MODEL_FILENAME,
        ),
        // SigLIP-2 — vision + text + tokenizer. Verified working
        // URL: `onnx-community/siglip2-base-patch16-256-ONNX`. Note
        // the 256 (not 224) input size and the very large 1.13 GB
        // text model (Gemma 256k vocab).
        (
            encoder_siglip2::SIGLIP2_IMAGE_MODEL_URL,
            encoder_siglip2::SIGLIP2_IMAGE_MODEL_FILENAME,
        ),
        (
            encoder_siglip2::SIGLIP2_TEXT_MODEL_URL,
            encoder_siglip2::SIGLIP2_TEXT_MODEL_FILENAME,
        ),
        (
            encoder_siglip2::SIGLIP2_TOKENIZER_URL,
            encoder_siglip2::SIGLIP2_TOKENIZER_FILENAME,
        ),
    ];

    // Phase 1: figure out which files are missing and how big they are
    // in total. This lets the caller's progress bar be determinate
    // across the whole 2+GB download rather than per-file.
    //
    // "Missing" honours the effective precision: the store build ships
    // ONLY the int8 variants, so a file whose precision variant resolves
    // (model_path_for returns an existing quantised file) needs no
    // download even though the fp32 base name is absent. Without this,
    // a sandboxed store install tried to fetch the whole fp32 set on
    // every first launch — blocked by the sandbox (no network
    // entitlement), harmless, but noisy and dishonest in the pill.
    let precision = crate::settings::Settings::load().effective_model_precision();
    let mut to_download: Vec<(&str, &str, u64)> = Vec::new();
    for (url, filename) in targets {
        if crate::paths::model_path_for_in(&models_dir, filename, &precision).exists() {
            continue;
        }
        let size = head_content_length(url).unwrap_or(0);
        to_download.push((url, filename, size));
    }

    if to_download.is_empty() {
        return Ok(());
    }

    info!(
        "First-launch model setup begun — {} files to fetch into {}",
        to_download.len(),
        models_dir.display()
    );

    let total_bytes: u64 = to_download.iter().map(|(_, _, s)| s).sum();
    progress(0, total_bytes, None);

    // Phase 2: actually download. Per-file fail-soft — a single 401
    // (e.g. SigLIP-2 hosted under a gated repo) shouldn't abort the
    // whole batch and prevent DINOv2 from downloading. Each file's
    // failure is logged with its URL so the user can identify which
    // one needs a corrected URL.
    //
    // The aggregate counter accumulates across files so the UI sees
    // one smooth 0..total progression even when some files are
    // skipped (their headers' content-length still counted in total).
    let mut bytes_so_far: u64 = 0;
    let mut succeeded = 0;
    let mut failed: Vec<(String, String)> = Vec::new();
    for (url, filename, declared_size) in &to_download {
        let dest = models_dir.join(filename);
        match download_to_file(url, &dest, &mut bytes_so_far, total_bytes, &progress) {
            Ok(()) => {
                succeeded += 1;
            }
            Err(e) => {
                let msg = e.to_string();
                warn!(
                    "model file download failed: {} ({}): {}",
                    filename, url, msg
                );
                // Advance the aggregate so the bar doesn't stall.
                // Treat the file's declared size as "skipped" — we
                // still consumed that many bar-tick units.
                bytes_so_far = bytes_so_far.saturating_add(*declared_size);
                progress(bytes_so_far, total_bytes, None);
                failed.push((filename.to_string(), msg));
            }
        }
    }

    info!(
        "model download phase done: {} succeeded, {} failed",
        succeeded,
        failed.len()
    );
    if !failed.is_empty() {
        warn!(
            "the following model files failed to download (their encoder \
             will be skipped at indexing): {:?}",
            failed
        );
    }
    progress(total_bytes, total_bytes, None);
    Ok(())
}

/// HEAD a URL to read its Content-Length. Falls through to None on any
/// error; the caller treats unknown sizes as zero in the aggregate
/// total (so the bar is slightly less accurate but still progresses).
#[tracing::instrument(name = "model_download.head")]
fn head_content_length(url: &str) -> Option<u64> {
    let resp = ureq::head(url).call().ok()?;
    resp.headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

/// Synchronous chunked download with progress callback.
///
/// `bytes_so_far` is the running aggregate counter — we mutate it in
/// place so the caller's tally stays accurate across files. Writes to
/// `dest.with_extension("part")` first then renames atomically on
/// success; an interrupted download leaves a stale `.part` that the
/// next run cleans up before retrying.
#[tracing::instrument(name = "model_download.file", skip(bytes_so_far, progress))]
fn download_to_file(
    url: &str,
    dest: &Path,
    bytes_so_far: &mut u64,
    total_bytes: u64,
    progress: &ProgressFn,
) -> Result<(), Box<dyn Error>> {
    let filename = dest
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("model");
    info!("GET {url}");

    let resp = ureq::get(url).call()?;
    let part_path = dest.with_extension("part");

    // If a previous run left a stale .part behind, remove it — its
    // bytes can't be reused without HTTP Range semantics.
    if part_path.exists() {
        let _ = fs::remove_file(&part_path);
    }

    let mut reader = resp.into_body().into_reader();
    let file = File::create(&part_path)?;
    let mut writer = BufWriter::new(file);

    // 256 KB read chunks. Progress callback invoked at most every
    // ~512 KB written (one byte-counter update per loop) — that's
    // ~2000 callbacks for a 1 GB download, comfortably below
    // overhead concerns even with the Tauri event hop.
    let mut buf = vec![0u8; 256 * 1024];
    let mut last_emitted_bucket: i32 = -1;

    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
        *bytes_so_far += n as u64;

        // Coalesce the progress callback to once per ~1% of the total
        // (so the UI gets ~100 events for a full download, smooth
        // enough for a determinate bar without thrashing).
        if total_bytes > 0 {
            let bucket = ((*bytes_so_far as f64 / total_bytes as f64) * 100.0) as i32;
            if bucket > last_emitted_bucket {
                last_emitted_bucket = bucket;
                progress(*bytes_so_far, total_bytes, Some(filename));
            }
        } else {
            // No total known — emit on every chunk write so the UI
            // sees the byte counter advance, even if it can't draw a
            // determinate bar.
            progress(*bytes_so_far, 0, Some(filename));
        }

        // Per-10% trace logging is independent of the UI callback.
        // Keeps the terminal log human-friendly without firehose-y
        // per-chunk lines.
        if let Some(total) = Some(total_bytes).filter(|t| *t > 0) {
            let pct = ((*bytes_so_far as f64 / total as f64) * 100.0) as i32;
            if pct % 10 == 0 && (pct / 10) * 10 != last_emitted_bucket / 10 * 10 {
                debug!(
                    "  {pct}% — {} / {} MB ({})",
                    *bytes_so_far / 1_048_576,
                    total / 1_048_576,
                    filename
                );
            }
        }
    }

    writer.flush()?;
    drop(writer);

    fs::rename(&part_path, dest)?;
    info!("saved {} ({} bytes)", dest.display(), file_size(dest));
    Ok(())
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or_else(|_| {
        warn!("could not stat {}", path.display());
        0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_constants_are_well_formed() {
        for url in [CLIP_VISION_URL, CLIP_TEXT_URL, CLIP_TOKENIZER_URL] {
            assert!(
                url.starts_with("https://huggingface.co/"),
                "URL must point at HuggingFace, got {url}"
            );
            assert!(
                url.contains("/resolve/main/"),
                "URL must use the `resolve/main/` direct-download form, got {url}"
            );
        }
    }

    #[test]
    fn test_filenames_are_distinct() {
        // Each file must have a unique filename — they all land in
        // the same models_dir. Reusing a filename would silently
        // overwrite the wrong model.
        let names = [
            CLIP_VISION_FILENAME,
            CLIP_TEXT_FILENAME,
            CLIP_TOKENIZER_FILENAME,
        ];
        let unique: std::collections::HashSet<_> = names.iter().collect();
        assert_eq!(unique.len(), names.len(), "duplicate filename in CLIP set");
    }

    #[test]
    fn test_progress_signature_compiles() {
        let _f = |_processed: u64, _total: u64, _file: Option<&str>| {};
        fn assert_fn<F: Fn(u64, u64, Option<&str>) + Send + Sync>(_: F) {}
        assert_fn(|_a, _b, _c| {});
    }
}
