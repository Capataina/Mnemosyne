# crates/engine/src/cosine/

Cosine retrieval, cache/store, diagnostics, name matching, top-k indexing, and reciprocal-rank fusion.

## Invariants

- Per-encoder `FlatStore` mmap files are the only similarity-index state; preserve the 64-byte versioned header, generation token, temp-file-plus-atomic-rename writes, and explicit mismatch-rejection tests.
- Retrieval returns image IDs and fuses rankings with RRF — never fuse raw scores from unlike encoders, and never reintroduce path resolution on hot search paths.
- Build refreshed stores outside write locks and swap under the shortest practical lock window.
