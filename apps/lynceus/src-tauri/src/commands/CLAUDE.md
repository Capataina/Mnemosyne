# apps/lynceus/src-tauri/src/commands/

Tauri command boundary exposed to the React frontend. Each submodule owns the
`#[tauri::command]` functions for one concern; every command must also be registered
in lib.rs's `invoke_handler` or it silently doesn't exist to the frontend.

## Map

```
commands/
├── mod.rs             module doc + shared re-exports (ApiError)
├── error.rs           ApiError — the serialised error shape the frontend matches on
├── images.rs          feed manifest, ID-detail batches, pipeline stats, thumbnails,
│                      preview breakdown, manual order/span, orphan purge
├── roots.rs           scan-root legacy shim + multi-root CRUD; restart_watcher helper
│                      called at the end of all four root mutations
├── encoders.rs        list/get/set enabled encoders (decide_enabled_write validates)
├── tags.rs            tag CRUD + image-tag links
├── notes.rs           per-image notes get/set
├── semantic.rs        single-encoder text→image search (CLIP or SigLIP-2 slot)
├── semantic_fused.rs  RRF-fused text→image across text-capable enabled encoders
├── similarity.rs      image→image: single, tiered, and RRF-fused variants
└── profiling.rs       is_profiling_enabled, perf snapshot/reset/export, user actions
```

## Invariants

- Command names, serialised payloads, and error shapes are frontend-facing APIs;
  update matching TypeScript services and tests together.
- Feed commands expose compact manifests and ID-detail batches; similarity and
  semantic commands return ID-native fused results from encoder slots.
- Keep orphan cleanup explicit: purge database rows, remove associated adaptive
  thumbnail files best-effort, and clear fusion caches so deleted IDs cannot
  resurface. `purge_orphaned_images` reads orphan locations **before** the DELETE
  (a delete returning only a count can't name the thumbnail files), removes
  `thumb_<id>.jpg` and `thumb_<id>_<width>.jpg` per-file (one purge can span roots),
  and ends with `fusion_state.invalidate_all()` — same hygiene as `remove_root`.
- Every root mutation (`set_scan_root`, `add_root`, `remove_root`,
  `set_root_enabled`) ends with `restart_watcher` so the watch set follows the root
  list instead of freezing at startup (2c07add).

## Traps

- **Attribute-less commands run on the main thread** (Tauri v2; 244b87a). The slow
  commands are already `#[tauri::command(async)]`: the four root mutations,
  `purge_orphaned_images`, `get_preview_breakdown`. A new command that deletes,
  walks directories, or rebuilds a watcher gets the attribute; `get_thumbnail` and
  the similarity commands are deliberately sync (fast-path).
- Adding Tauri-injected parameters (`AppHandle`, managed state) does not change the
  frontend invoke surface — inject freely; but the `WatcherSlot` state type must
  match lib.rs's declaration exactly (managed state resolves by exact type; a
  flavour mismatch panics at first invoke).
- `get_fused_semantic_search` returns `Ok(Vec::new())` when no enabled encoder is
  text-capable (DINOv2-only config) — indistinguishable from "no matches"; a known
  audit finding (K-FUS-1), documented in
  `tests/audit_fusion_no_text_capable_encoders_diagnostic.rs`, unresolved by choice.
- `get_preview_breakdown` counts bucket files on disk (buckets are deliberately not
  DB-tracked); its denominators are eligibility counts (source strictly wider than
  the bucket), not the library total. Don't "correct" either.

## Place in the whole

Thin orchestration over engine DB methods, `FusionIndexState` /
`TextEncoderState` slots, `thumbnail/`, and `watcher::restart`. The frontend halves
of these contracts live in `apps/lynceus/src/` service modules (other agents'
surface) — coordinate, don't edit.
