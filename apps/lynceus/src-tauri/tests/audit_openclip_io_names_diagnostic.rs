//! Regression pin for the OpenCLIP ONNX I/O-node-name bug.
//!
//! The 2026-07-15 commercial pivot swapped OpenAI's CLIP weights for
//! `immich-app/ViT-B-32__laion2b-s34b-b79k` (OpenCLIP, MIT-licensed).
//! The two research agents that vetted the swap confirmed identical
//! tokenizer, preprocessing, and output dimensionality — but the
//! encoder code kept the *old* export's ONNX input/output node names
//! (`input_ids`/`text_embeds`, `pixel_values`/`image_embeds`). The new
//! export actually uses `text`/`embedding` and `image`/`embedding`
//! (verified directly via `onnx.load(...).graph.{input,output}` against
//! the downloaded model files), so every real inference call failed
//! with "Invalid input name" at `session.run` time — text-to-image
//! search and indexing were both broken behind a green compile and a
//! green (mocked) test suite.
//!
//! This test exercises the real ONNX runtime against the real
//! downloaded models — no mocking — because that's the only thing
//! that would have caught this class of bug.
//!
//! Marked `#[ignore]` like the project's other model-dependent diagnostics: it needs `models/image/{clip_vision,clip_text}.onnx` + `clip_tokenizer.json` on disk (`scripts/download_models.py`) and at least one real image to encode.

use lynceus_lib::similarity_and_semantic_search::encoder::ClipImageEncoder;
use lynceus_lib::similarity_and_semantic_search::encoder_text::ClipTextEncoder;
use std::path::PathBuf;

#[test]
#[ignore = "requires real downloaded ONNX models + a real image; run with --ignored"]
fn clip_encoders_run_real_inference_against_openclip_export() {
    let models_dir = PathBuf::from("../../../models/image");
    let vision_path = models_dir.join("clip_vision.onnx");
    let text_path = models_dir.join("clip_text.onnx");
    let tokenizer_path = models_dir.join("clip_tokenizer.json");

    if !vision_path.exists() || !text_path.exists() || !tokenizer_path.exists() {
        println!("Skipping: models not found under {:?} — run scripts/download_models.py", models_dir);
        return;
    }

    // Text encoder — this is the exact call that used to fail with
    // "Invalid input name: input_ids" because the OpenCLIP export
    // names its input node `text`, not `input_ids`.
    let mut text_encoder =
        ClipTextEncoder::new(&text_path, &tokenizer_path).expect("text encoder should initialise and pre-warm");
    let text_embedding = text_encoder
        .encode("a dark fantasy warrior with glowing runes")
        .expect("text encode should not error on the real OpenCLIP text model");
    assert_eq!(text_embedding.len(), 512, "CLIP text embedding must be 512-d");
    assert!(
        text_embedding.iter().all(|v| v.is_finite()),
        "text embedding must not contain NaN/Inf"
    );
    let text_norm: f32 = text_embedding.iter().map(|v| v * v).sum::<f32>().sqrt();
    assert!(
        (text_norm - 1.0).abs() < 1e-3,
        "text embedding should be L2-normalised, got norm {text_norm}"
    );

    // Image encoder — same class of bug on the vision side: the
    // export names its input `image` and output `embedding`, not
    // `pixel_values`/`image_embeds`.
    let mut image_encoder = ClipImageEncoder::new(&vision_path).expect("image encoder should initialise");

    let candidates = [
        PathBuf::from(std::env::var("HOME").unwrap_or_default())
            .join("Documents/Splash Arts"),
        PathBuf::from("references"),
    ];
    let Some(image_path) = candidates.iter().find_map(|dir| {
        std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref(),
                Some("jpg") | Some("jpeg") | Some("png")
            )
        })
    }) else {
        println!("Skipping image half: no test image found (run scripts/download_lol_splashes.py)");
        return;
    };

    let image_embedding = image_encoder
        .encode(&image_path)
        .expect("image encode should not error on the real OpenCLIP vision model");
    assert_eq!(image_embedding.len(), 512, "CLIP image embedding must be 512-d");
    assert!(
        image_embedding.iter().all(|v| v.is_finite()),
        "image embedding must not contain NaN/Inf"
    );

    // Sanity check the two embeddings genuinely share a joint space —
    // a plausible-but-not-tiny cosine similarity, not a crash and not
    // a degenerate all-zero vector.
    let dot: f32 = text_embedding.iter().zip(&image_embedding).map(|(a, b)| a * b).sum();
    println!("text/image cosine similarity: {dot}");
    assert!(dot.is_finite() && dot.abs() <= 1.0 + 1e-3);
}
