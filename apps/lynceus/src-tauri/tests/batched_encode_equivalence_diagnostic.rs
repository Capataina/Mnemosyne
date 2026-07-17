//! Equivalence pin for the SigLIP-2 / DINOv2 `encode_batch` overrides.
//!
//! T2-3 gave both encoders a batched path: one `[N, 3, H, W]` inference
//! per chunk instead of the trait default's N single-image calls. Their
//! ONNX exports declare dynamic batch dims, so batching is a pure
//! throughput win with no intended change to the embeddings — but a
//! wrong per-image slice offset, a transposed output, or a normalisation
//! applied to the wrong span would silently corrupt search results while
//! still returning plausible unit vectors. The only thing that catches
//! that class of bug is running the real ONNX runtime against the real
//! models and comparing the batched embedding to the serial one per
//! image.
//!
//! Marked `#[ignore]` like the project's other model-dependent
//! diagnostics: it needs `models/image/{siglip2_vision,dinov2_base_image}
//! .onnx` on disk (`scripts/download_models.py`) plus a couple of real
//! images. Run with `--ignored`.

use lynceus_lib::similarity_and_semantic_search::encoder_dinov2::Dinov2ImageEncoder;
use lynceus_lib::similarity_and_semantic_search::encoder_siglip2::Siglip2ImageEncoder;
use lynceus_lib::similarity_and_semantic_search::encoders::ImageEncoder;
use std::path::PathBuf;

/// Collect up to `n` real image paths from the same corpus locations the
/// OpenCLIP diagnostic uses. Returns an empty vec if none are found so
/// callers can skip cleanly.
fn find_test_images(n: usize) -> Vec<PathBuf> {
    let dirs = [
        PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Documents/Splash Arts"),
        PathBuf::from("references"),
    ];
    let mut out = Vec::new();
    for dir in &dirs {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.filter_map(|e| e.ok()) {
                let p = entry.path();
                let is_image = matches!(
                    p.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref(),
                    Some("jpg") | Some("jpeg") | Some("png")
                );
                if is_image {
                    out.push(p);
                    if out.len() == n {
                        return out;
                    }
                }
            }
        }
    }
    out
}

/// Cosine similarity of two vectors. Both encoders return L2-normalised
/// embeddings, so this is just the dot product; we compute it in full
/// rather than assume unit norm, so a normalisation regression also
/// shows up here.
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na * nb)
}

/// Encode `paths` one-by-one via `encode`, then all-at-once via
/// `encode_batch`, and assert the two agree per image at cosine > 0.999.
fn assert_batched_matches_serial<E: ImageEncoder>(encoder: &mut E, paths: &[PathBuf]) {
    let serial: Vec<Vec<f32>> = paths
        .iter()
        .map(|p| encoder.encode(p).expect("serial encode should not error on a real image"))
        .collect();

    let path_refs: Vec<&std::path::Path> = paths.iter().map(|p| p.as_path()).collect();
    let batched = encoder
        .encode_batch(&path_refs)
        .expect("batched encode should not error on real images");

    assert_eq!(
        batched.len(),
        serial.len(),
        "batched must return one embedding per input image"
    );

    for (i, (b, s)) in batched.iter().zip(&serial).enumerate() {
        assert_eq!(b.len(), s.len(), "image {i}: embedding dims must match");
        assert!(
            b.iter().all(|v| v.is_finite()),
            "image {i}: batched embedding must not contain NaN/Inf"
        );
        let cos = cosine(b, s);
        println!("image {i}: batched-vs-serial cosine = {cos}");
        assert!(
            cos > 0.999,
            "image {i}: batched embedding must match serial (cosine {cos} <= 0.999)"
        );
    }
}

#[test]
#[ignore = "requires real downloaded ONNX models + real images; run with --ignored"]
fn siglip2_encode_batch_matches_serial() {
    let model_path = PathBuf::from("../../../models/image/siglip2_vision.onnx");
    if !model_path.exists() {
        println!("Skipping: {model_path:?} not found — run scripts/download_models.py");
        return;
    }
    let images = find_test_images(4);
    if images.len() < 2 {
        println!("Skipping: fewer than 2 test images found (run scripts/download_lol_splashes.py)");
        return;
    }
    let mut encoder =
        Siglip2ImageEncoder::new(&model_path).expect("SigLIP-2 image encoder should initialise");
    assert_batched_matches_serial(&mut encoder, &images);
}

#[test]
#[ignore = "requires real downloaded ONNX models + real images; run with --ignored"]
fn dinov2_encode_batch_matches_serial() {
    let model_path = PathBuf::from("../../../models/image/dinov2_base_image.onnx");
    if !model_path.exists() {
        println!("Skipping: {model_path:?} not found — run scripts/download_models.py");
        return;
    }
    let images = find_test_images(4);
    if images.len() < 2 {
        println!("Skipping: fewer than 2 test images found (run scripts/download_lol_splashes.py)");
        return;
    }
    let mut encoder =
        Dinov2ImageEncoder::new(&model_path).expect("DINOv2 image encoder should initialise");
    assert_batched_matches_serial(&mut encoder, &images);
}
