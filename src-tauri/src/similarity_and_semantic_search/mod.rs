// Cosine ranking + RRF fusion moved to the Mnemosyne engine. Re-exported
// here so `crate::similarity_and_semantic_search::cosine[_similarity]::…`
// call sites across the encoders and commands keep resolving unchanged.
pub use mnemosyne::{cosine, cosine_similarity};

pub mod encoder;
pub mod encoder_dinov2;
pub mod encoder_siglip2;
pub mod encoder_text;
pub mod encoders;
pub mod ort_session;
pub mod preprocess;
