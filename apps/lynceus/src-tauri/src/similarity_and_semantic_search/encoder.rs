use image::ImageReader;
use ndarray;
use ort::{
    session::Session,
    value::{Tensor, Value},
};
use std::{error::Error, path::Path};
use tracing::{info, warn};

use super::encoders::ImageEncoder;

// CoreML is intentionally NOT used for the image encoder on macOS.
//
// We tested it: CoreML's GetCapability accepts ~54% of CLIP ViT-B/32's
// nodes (980 of 1827) and session-create succeeds, but actual inference
// fails at runtime with `Error executing model: Unable to compute the
// prediction using a neural network model (error code: -1)`. The
// compile-time partitioning is producing a graph that can't actually
// run on the ANE/GPU at inference time — likely a known fragility in
// ort's CoreML EP for some op combinations in dynamic-shape contexts.
//
// Plain CPU on M-series chips is still fast enough: ~200-500ms per
// image, so ~6-15 min to encode a typical 1500-2000 image library.
// Not as snappy as CoreML would have been, but it WORKS.
//
// Future work: experiment with CoreMLExecutionProvider's options
// (subgraph_cache, mlprogram_v2 flag), or quantise to int8, or use
// a different ONNX export. Not a Phase-X-quick-fix item.

#[cfg(not(target_os = "macos"))]
use ort::execution_providers::CUDAExecutionProvider;

pub struct ClipImageEncoder {
    session: Session,
}

impl ClipImageEncoder {
    pub fn new(model_path: &Path) -> Result<Self, Box<dyn Error>> {
        Self::new_with_intra(model_path, super::ort_session::DEFAULT_INTRA_THREADS)
    }

    /// Phase 12c — explicit intra-thread count. Indexing pipeline
    /// computes `4 / num_enabled_encoders` and passes it through so
    /// concurrent encoders share the M2 P-cluster instead of all
    /// asking for 4 threads each.
    pub fn new_with_intra(model_path: &Path, intra_threads: usize) -> Result<Self, Box<dyn Error>> {
        info!("=== Initializing image encoder (intra={intra_threads}) ===");
        match Self::build_session_with_accel(model_path, intra_threads) {
            Ok(session) => Ok(ClipImageEncoder { session }),
            Err(e) => {
                warn!("accelerator initialization failed ({e}); falling back to CPU");
                let session = super::ort_session::build_tuned_session_with_intra(
                    "clip_image_fallback",
                    model_path,
                    intra_threads,
                )?;
                Ok(ClipImageEncoder { session })
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn build_session_with_accel(
        model_path: &Path,
        intra_threads: usize,
    ) -> Result<Session, Box<dyn Error>> {
        info!("image encoder using CPU (CoreML disabled — see encoder.rs header)");
        let session = super::ort_session::build_tuned_session_with_intra(
            "clip_image",
            model_path,
            intra_threads,
        )?;
        Ok(session)
    }

    #[cfg(not(target_os = "macos"))]
    fn build_session_with_accel(
        model_path: &Path,
        _intra_threads: usize,
    ) -> Result<Session, Box<dyn Error>> {
        info!("trying CUDA execution provider");
        // CUDA path: keep the existing builder + EP setup. The M2
        // intra_threads tuning is irrelevant when CUDA is doing the
        // work, and Level3 is on by default for GPU EPs. Underscore
        // the parameter to silence unused-arg warnings.
        let session = Session::builder()?
            .with_execution_providers([CUDAExecutionProvider::default().build()])?
            .commit_from_file(model_path)?;
        info!("session ready (CUDA if available, CPU otherwise — ort routes per-op)");
        Ok(session)
    }

    #[tracing::instrument(name = "clip.preprocess_image", skip(self, image_path))]
    pub fn preprocess_image(
        &self,
        image_path: &Path,
    ) -> Result<ndarray::Array4<f32>, Box<dyn std::error::Error>> {
        // Canonical OpenAI CLIP preprocessing (from `preprocessor_config.json`
        // on Xenova/clip-vit-base-patch32, verified 2026-04-26):
        //
        //   1. Convert to RGB
        //   2. Resize on shortest edge to 224 (BICUBIC)
        //   3. Center-crop to 224×224
        //   4. Rescale by 1/255 → [0, 1]
        //   5. Normalize with CLIP-specific mean/std
        //
        // Previous code used `resize_exact(224, 224)` with Lanczos3 — this
        // squashed non-square images (CLIP was trained on aspect-preserving
        // resize + center-crop). CatmullRom is image-rs's bicubic-family
        // filter, the closest match to PIL's BICUBIC.
        const TARGET_SHORT: u32 = 224;
        const CROP: u32 = 224;
        let img = ImageReader::open(image_path)?
            .with_guessed_format()?
            .decode()?
            .to_rgb8();

        let (orig_w, orig_h) = img.dimensions();
        let (new_w, new_h) = if orig_w < orig_h {
            let new_w = TARGET_SHORT;
            let new_h = (orig_h as f32 * (new_w as f32 / orig_w as f32)).round() as u32;
            (new_w, new_h)
        } else {
            let new_h = TARGET_SHORT;
            let new_w = (orig_w as f32 * (new_h as f32 / orig_h as f32)).round() as u32;
            (new_w, new_h)
        };
        // Phase 12e — fast_image_resize Lanczos3 instead of image-rs's
        // CatmullRom. ~7-13× speedup for the same quality on M2 NEON.
        let resized = super::preprocess::fast_resize_rgb8(&img, new_w, new_h, "clip_image");
        let crop_x = (new_w.saturating_sub(CROP)) / 2;
        let crop_y = (new_h.saturating_sub(CROP)) / 2;
        let img = image::imageops::crop_imm(&resized, crop_x, crop_y, CROP, CROP).to_image();

        let mut input_tensor: Vec<f32> = Vec::with_capacity((CROP * CROP * 3) as usize);

        // ONNX expects channels-first (CHW) layout: all R values first,
        // then all G, then all B. The image crate gives us interleaved
        // RGBRGB pixels, so we split-and-concat here.
        let mut r = Vec::with_capacity((CROP * CROP) as usize);
        let mut g = Vec::with_capacity((CROP * CROP) as usize);
        let mut b = Vec::with_capacity((CROP * CROP) as usize);

        for pixel in img.pixels() {
            r.push(pixel[0] as f32 / 255.0);
            g.push(pixel[1] as f32 / 255.0);
            b.push(pixel[2] as f32 / 255.0);
        }

        input_tensor.extend(r);
        input_tensor.extend(g);
        input_tensor.extend(b);

        // CLIP-native normalization stats (from openai/CLIP repository
        // and Xenova's preprocessor_config.json). The previous code
        // used ImageNet stats which subtly shift the embedding
        // distribution away from what the OpenAI reference produces.
        let mean = [0.48145466_f32, 0.4578275, 0.40821073];
        let std = [0.26862954_f32, 0.261_302_6, 0.275_777_1];

        let plane = (CROP * CROP) as usize;
        for c in 0..3 {
            for i in 0..plane {
                let idx = c * plane + i;
                input_tensor[idx] = (input_tensor[idx] - mean[c]) / std[c];
            }
        }

        // we create a 4d array using ndarray bc otherwise ort tensor creation is a pain
        let input_array = ndarray::Array4::from_shape_vec(
            (1, 3, CROP as usize, CROP as usize),
            input_tensor,
        )?;
        Ok(input_array)
    }

    // write a function to preprocess in batches of x, this will be useful for the batch encode function
    pub fn batch_preprocess_image(
        &mut self,
        image_paths: &[&Path],
        batch_size: usize,
    ) -> Result<Vec<ndarray::Array4<f32>>, Box<dyn std::error::Error>> {
        if batch_size == 0 {
            return Err("batch_size must be greater than 0".into());
        }

        let mut batches: Vec<ndarray::Array4<f32>> = Vec::new();

        // Process the incoming paths in chunks of `batch_size`
        for chunk in image_paths.chunks(batch_size) {
            let mut preprocessed_chunk: Vec<ndarray::Array4<f32>> = Vec::new();

            // Preprocess each image in the current chunk as a single-image tensor (1, 3, 224, 224)
            for path in chunk {
                let input_array = self.preprocess_image(path)?;
                preprocessed_chunk.push(input_array);
            }

            // Concatenate along the batch axis (axis 0) to get shape (chunk_len, 3, 224, 224)
            let batch_array = ndarray::concatenate(
                ndarray::Axis(0),
                &preprocessed_chunk
                    .iter()
                    .map(|a| a.view())
                    .collect::<Vec<_>>(),
            )?;

            batches.push(batch_array);
        }

        Ok(batches)
    }

    #[tracing::instrument(name = "clip.encode_image", skip(self), fields(path = %image_path.display()))]
    pub fn encode(&mut self, image_path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        let input_array = self.preprocess_image(image_path)?;

        // Tensor::from_array requires owned data, so we extract the raw
        // Vec<f32> from the ndarray. A future optimisation could avoid
        // this copy once ort exposes a borrowing constructor.
        let shape = [1usize, 3, 224, 224];
        let (data, _offset) = input_array.into_raw_vec_and_offset();
        let onnx_input: Tensor<f32> = Tensor::from_array((shape, data))?;

        // OpenCLIP `visual/model.onnx` (immich-app export) takes ONLY
        // `image` (renamed from the old Xenova export's `pixel_values`)
        // and returns `embedding` (renamed from `image_embeds`). The
        // previous combined-graph model required dummy text inputs;
        // those are gone now that we use the split export.
        let outputs = self.session.run(ort::inputs![
            "image" => onnx_input
        ])?;

        let dyn_tensor: &Value<_> = &outputs["embedding"];
        let (_out_shape, data_view) = dyn_tensor.try_extract_tensor::<f32>()?;
        let embedding = data_view.to_vec();

        // L2-normalize so cosine similarity is well-conditioned.
        // OpenCLIP's visual/model.onnx outputs the post-projection
        // embedding without normalization.
        Ok(super::encoder_text::pooling::normalize(&embedding))
    }

    /// Encode multiple images. Named `encode_batch` for API parity with
    /// the other encoders, but the OpenCLIP `visual/model.onnx` export
    /// (immich-app) declares a **fixed** batch dimension of 1 on its
    /// `image` input (`onnx.load(...).graph.input[0].type.tensor_type
    /// .shape.dim[0].dim_value == 1`, not a dynamic `dim_param`) — the
    /// old Xenova export this replaced had a dynamic batch dim, so the
    /// true-batched `[N, 3, 224, 224]` tensor call this function used
    /// to make worked there and fails here with ORT's "Got invalid
    /// dimensions for input: image". That failure was silent from the
    /// indexing pipeline's point of view: `encode_batch` returned
    /// `Err`, the whole chunk was recorded in `failed_paths`, and
    /// nothing surfaced past a batch-summary diagnostic that only
    /// writes when `--profiling` is on — so CLIP silently produced
    /// zero embeddings while DINOv2 and SigLIP-2 (dynamic-batch
    /// exports) encoded normally. Fix: run one `[1, 3, 224, 224]`
    /// inference per image, same shape `encode()` already uses
    /// successfully. Preprocessing still happens in chunks of 32 to
    /// bound peak memory on large libraries; only the ONNX call
    /// stopped trying to batch.
    #[tracing::instrument(name = "clip.encode_image_batch", skip(self, image_paths), fields(batch = image_paths.len()))]
    pub fn encode_batch(
        &mut self,
        image_paths: &[&Path],
    ) -> Result<Vec<Vec<f32>>, Box<dyn std::error::Error>> {
        if image_paths.is_empty() {
            return Ok(Vec::new());
        }

        let preprocessing_batch_size = 32;
        let batched_arrays = self.batch_preprocess_image(image_paths, preprocessing_batch_size)?;

        let mut all_embeddings = Vec::new();

        for batch_array in batched_arrays {
            let batch_size = batch_array.shape()[0];

            for i in 0..batch_size {
                let single = batch_array
                    .index_axis(ndarray::Axis(0), i)
                    .to_owned()
                    .insert_axis(ndarray::Axis(0));
                let shape = [1usize, 3, 224, 224];
                let (data, _offset) = single.into_raw_vec_and_offset();
                let onnx_input: Tensor<f32> = Tensor::from_array((shape, data))?;

                let outputs = self.session.run(ort::inputs![
                    "image" => onnx_input
                ])?;

                let dyn_tensor: &Value<_> = &outputs["embedding"];
                let (_out_shape, data_view) = dyn_tensor.try_extract_tensor::<f32>()?;
                all_embeddings.push(super::encoder_text::pooling::normalize(data_view));
            }
        }

        Ok(all_embeddings)
    }
}

/// Implement the new trait via delegation to the inherent methods.
/// This is the seam that lets the runtime hold a `Box<dyn ImageEncoder>`
/// containing either ClipImageEncoder, the upcoming SigLIP2-Image
/// encoder, or the upcoming DINOv2 encoder.
impl ImageEncoder for ClipImageEncoder {
    fn encode(&mut self, image_path: &Path) -> Result<Vec<f32>, Box<dyn Error>> {
        ClipImageEncoder::encode(self, image_path)
    }
    fn encode_batch(
        &mut self,
        image_paths: &[&Path],
    ) -> Result<Vec<Vec<f32>>, Box<dyn Error>> {
        ClipImageEncoder::encode_batch(self, image_paths)
    }
    fn embedding_dim(&self) -> usize {
        // OpenAI CLIP-ViT-B/32 always outputs 512-d.
        512
    }
    fn id(&self) -> &'static str {
        // Used as the database column suffix and the user-facing
        // label. Stable forever — changing this would orphan
        // existing embedding rows.
        "clip_vit_b_32"
    }
}
