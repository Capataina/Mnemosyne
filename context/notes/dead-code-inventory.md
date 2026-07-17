# dead-code-inventory

## Current Understanding

The previous inventory was largely closed by the audit Pass + Phase 2 dead-code sweep. Most flagged items have been removed or wired up. This note now serves as the residual list and the trigger for the next sweep.

## Resolved (since previous inventory)

| Item | Status | When |
|------|--------|------|
| `apps/lynceus/src/components/FullscreenImage.tsx` | Removed | Phase 2 (commit `86df34e`) |
| `apps/lynceus/src/components/MasonryItemSelected.tsx` | Removed | Phase 2 |
| `apps/lynceus/src/components/MasonrySelectedFrame.tsx` | Removed | Phase 2 |
| `apps/lynceus/src/hooks/useMeasure.tsx` | Removed | Phase 2 |
| `db::delete_tag` (orphaned method) | Wired through `commands::tags::delete_tag` + `useDeleteTag` mutation | Phase 6 |
| `useSimilarImages` (frontend hook) | Removed (only `useTieredSimilarImages` is used) | Audit dead-code sweep |
| `ImageData::with_thumbnail` (alternate constructor) | Removed | Audit Dead-Code finding |
| `add_tag_to_image` plain INSERT (would error on duplicate) | Hardened to `INSERT OR IGNORE` | Phase 6 |
| Hardcoded `Path::new("test_images")` in `main.rs` | Removed (multi-folder pipeline) | Phase 6 |
| `unsafe { slice::from_raw_parts(...) }` for embedding BLOB casts (3 sites) | Replaced with `bytemuck::cast_slice` | Audit `0bdb5f4` |
| Triplicated `normalize_path` closure in `lib.rs` (3 sites) | Extracted into `paths::strip_windows_extended_prefix` | Audit `02b12b9` |
| Triplicated 3-strategy DB-id lookup blocks (3 sites) | Extracted into `commands::resolve_image_id_for_cosine_path` | Same audit commit |
| Duplicated `aggregate_image_rows` pattern (4 sites) | Extracted into `db/images_query.rs::aggregate_image_rows` helper | Audit `a30c153` |
| `[Backend] ...` `println!` logging convention | Replaced wholesale by `tracing::info!` / `debug!` / `warn!` | Phase 6 |
| `set_scan_root` Tauri command (single-folder model) | Preserved as legacy; multi-folder commands added (`add_root` / `remove_root` / `set_root_enabled`) | Phase 6 |
| `models/` "user-supplied" assumption | Now auto-downloaded on first launch via `model_download` (still true post-refactor: `model_download.rs`'s first-launch logic is unchanged). Additionally, the repo now ships `scripts/download_models.py` fetching every encoder weight into a gitignored `models/<modality>/` tree at the repo root for dev use, with `LYNCEUS_MODELS_DIR` env var checked first in `paths::models_dir()` ahead of the app-data fallback. | Phase 4b; models relocation (commercialisation refactor) |
| `CosineIndexState` (the primary cosine index: struct, `ensure_loaded_for`/`invalidate`, its `.manage()` registration, the two Arcs threaded through the pipeline) | Removed entirely — every search command now borrows the fusion slots instead | Perf round, `1514a90` |
| `zustand` dependency | Removed from `package.json` (verified absent from the current `apps/lynceus/package.json` and every `src/` import) | v2 visual layer / commercialisation-era cleanup; exact commit not attributed, confirmed via current tree |
| `atropos` dependency + its CSS import | Removed — the v2 visual layer (`977e693`) replaced the 3D-tilt hover with elegant accent corner brackets, killing the last atropos consumer | v2 UI overhaul |
| `setIsInspecting` state in `[...slug].tsx` | Resolved: confirmed live (8 read/write sites across the route, driving the inspector-open state for the v2 modal/timer flows) — the previous "verification needed" flag is closed | Verified this pass by reading `apps/lynceus/src/pages/[...slug].tsx` |
| `cosine_topk_partial_sort_diagnostic.rs`'s sibling `cosine_cache_invalidation_diagnostic.rs` | Deleted — it tested the primary cosine index's cache, which no longer exists | Perf round, alongside `1514a90` |

## Residual (current dead-code inventory)

### Backend

| Item | Status | Reason to keep |
|------|--------|----------------|
| `Encoder::inspect_model` (image + text variants, `similarity_and_semantic_search/encoder.rs` + `encoder_text/encoder.rs`) | Defined; not called from runtime code (verified this pass — no `.inspect_model(` call sites anywhere) | Useful for debugging. Could be moved behind `#[cfg(test)]` if not needed in production. |
| `paths::cosine_cache_path()` | Caller-less as of the perf round: only its own test references it | The flat-store rewrite (`fc6667a`) replaced the primary cache's single-file path with one versioned file per encoder; this helper served the now-removed primary index. Left in place deliberately (public engine fn, unowned but tested surface) rather than deleted mid-round — clean up when `paths.rs` is next touched. |
| `cache.rs::save_to_disk()` | Caller-less as of the perf round: only referenced by its own doc comment and an explanatory comment in `indexing.rs` | Same story as `cosine_cache_path` — served the primary index's persistence path, superseded by `cache.rs`'s per-encoder `FlatStore` save/load. Left in place for the same reason. |
| `Settings::scan_root` field | Read by lib.rs setup callback for legacy migration; cleared after | Required for the one-shot legacy migration path. Cannot be removed until enough time passes that no user has the field populated. Effectively immortal. |

### Frontend

Nothing residual this pass — `setIsInspecting` (the previous entry) is confirmed live; see Resolved above.

### Dependencies

| Package | Status | Reason / action |
|---------|--------|-----------------|
| `@types/lodash.debounce` | Imported via `lodash/debounce`, now in `apps/lynceus/src/hooks/useMasonryEngine.ts` (moved out of the monolithic `Masonry.tsx` when it split into headless hooks) | Type-only. Could swap for `@types/lodash` for consistency, or remove if `lodash`'s own types are good enough. Low priority. |

`zustand` and `atropos` — the two dependency entries this table used to carry — are gone from `package.json` entirely; see Resolved above.

## Rationale

The bulk of the previous inventory was closed across several waves: Phase 2's dead-code sweep, Phase 6's wiring of orphaned methods, the audit's modularisation/extraction findings, and this perf round's removal of the entire primary cosine index (which took its `db_path` field, its cache path helper, its `save_to_disk`, and its dedicated invalidation test with it). The residual list stays small and not urgent.

## Guiding Principles

- **Don't import any of the removed items into new code.** If a use case for one arises, add it back deliberately rather than reviving from corpse.
- **The list above is the canonical inventory** — if a small sweep PR is opened, this section is the source of truth for what to remove.
- **Verify each removal with `Grep` before deletion** — past sessions have introduced "dead" markers that were actually live (e.g., `useSimilarImages` was flagged but a future change might re-import it; `setIsInspecting` was flagged as unverified and turned out to be fully wired).

## Trigger to revisit

When the residual list grows past ~5 items again, schedule a small sweep PR. Today's residual (4 backend, 0 frontend, 1 dependency) is below that threshold.
