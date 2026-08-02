# apps/lynceus/src-tauri/src/commands/

Tauri command boundary exposed to the React frontend.

## Invariants

- Command names, serialised payloads, and error shapes are frontend-facing APIs; update matching TypeScript services and tests together.
- Feed commands expose compact manifests and ID-detail batches; similarity and semantic commands return ID-native fused results from encoder slots.
- Keep orphan cleanup explicit: purge database rows, remove associated adaptive thumbnail files best-effort, and clear fusion caches so deleted IDs cannot resurface.
