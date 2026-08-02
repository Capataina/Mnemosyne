# apps/lynceus/src-tauri/src/thumbnail/

Image-thumbnail generation boundary used by Lynceus indexing and preview delivery.

## Invariants

- Generate and cache adaptive JPEG buckets `{480, 960, 1440, 2048}` keyed by image ID and requested target pixels; frontend query keys must include the selected bucket.
- Root/image removal must clean every bucket variant best-effort without turning cleanup residue into a database failure.
