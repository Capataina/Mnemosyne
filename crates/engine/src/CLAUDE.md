# crates/engine/src/

Engine public composition plus asset identity, paths, performance, tags, and similarity contracts.

## Invariants

- The engine stays media-agnostic: image-specific encoding, thumbnailing, and Tauri concerns live in Lynceus, not here.
- Asset identity is content-hash-backed so moves relink existing IDs without losing tags, layout, or embeddings; path normalisation happens at persistence boundaries.
- Retrieval state is per-encoder and ID-native. The removed primary `CosineIndexState` and `cosine_cache.bin` are not valid architectural patterns to reintroduce.
