# filesystem-scanner

*Maturity: working*

> **Verified 2026-07 (100k perf round):** `filesystem.rs` itself is byte-for-byte unchanged since the previous upkeep baseline (`f29f202`) — confirmed via `git diff f29f202 HEAD -- apps/lynceus/src-tauri/src/filesystem.rs`, empty. What changed is entirely on the DB-insertion side of the boundary this scanner sits next to (T2-2, commit `ebe4006`): the "Multi-root semantics" and "Key Interfaces / Data Flow" sections below have been updated to reflect the new batched `add_images_batch` insert path; the scan/walk algorithm and extension whitelist described here are exactly as they were.

## Scope / Purpose

Recursively walks a directory and returns a flat `Vec<String>` of image paths. Used by the indexing pipeline once per enabled root per pipeline run. The pipeline aggregates the results across roots, inserts via chunked `add_images_batch` calls (256-path `INSERT OR IGNORE` batches, idempotent), and then `mark_orphaned`s any DB rows whose paths aren't in the alive set.

## Boundaries / Ownership

- **Owns:** the recursion, the extension whitelist, the path-string conversion.
- **Does not own:** writing to the database (the indexing pipeline does that), file-existence validation beyond `is_file()`/`is_dir()`, root selection (delegates to `commands::roots` + `db::list_roots`), the watcher (delegates to `watcher.rs`).
- **Public API:** `ImageScanner::new() -> Self`, `scan_directory(&Path) -> Result<Vec<String>, std::io::Error>`.

## Current Implemented Reality

### Algorithm

```text
fn scan_directory(root):
    for entry in std::fs::read_dir(root):
        if entry.is_dir():
            recurse → append nested paths
        elif entry.is_file() and is_supported_image(path):
            push path.to_string_lossy().to_string()
    return paths
```

### Extension whitelist

```rust
const SUPPORTED_IMAGE_EXTENSIONS: [&str; 7] =
    ["jpg", "png", "gif", "jpeg", "bmp", "tiff", "webp"];
```

Comparison is case-insensitive — extension is `.to_lowercase()`-d before `contains`.

### Where it runs

- `indexing.rs::run_pipeline_inner` Phase::Scan calls `ImageScanner::new()` once and `scan_directory(root_path)` once per enabled root, aggregating into a `Vec<(path, root_id)>` for the per-root insertion + orphan-detection loop.
- The folder picker (`commands::roots::set_scan_root` / `add_root`) does NOT call this directly — it inserts the root into the DB and re-spawns the pipeline, which then calls scan_directory.

### Multi-root semantics

The scanner itself is single-root (takes one `&Path`). The multi-root aggregation lives in the indexing pipeline (`indexing.rs::run_pipeline_inner`, Phase::Scan, ~line 380):

```rust
for root in &enabled_roots {
    match scanner.scan_directory(root_path) {
        Ok(paths) => {
            let entry = paths_per_root.entry(root.id).or_default();
            for p in paths {
                entry.push(p.clone());
                all_paths.push((p, root.id));
            }
        }
        Err(e) => warn!("scan of {} failed: {e}", root.path),
    }
}
```

A scan error on one root logs warn and the pipeline continues with the others. Per-root path lists are kept so `mark_orphaned` can run per root without cross-contamination.

### Insertion boundary — where the scanner's output goes (T2-2, `ebe4006`)

The scanner hands back a flat `Vec<String>` per root; nothing about batching or transactions lives in `filesystem.rs`. The pipeline aggregates every root's paths into one `Vec<(String, i64)>` (`all_paths`), then hands that to the DB layer in fixed-size chunks instead of one autocommit per path:

```rust
const SCAN_INSERT_BATCH: usize = 256;
for chunk in all_paths.chunks(SCAN_INSERT_BATCH) {
    let batch: Vec<(String, Option<i64>)> =
        chunk.iter().map(|(p, rid)| (p.clone(), Some(*rid))).collect();
    database.add_images_batch(&batch)?;
    // ... progress emit, replaying every 100-boundary this batch crossed
}
```

`add_images_batch` (`crates/engine/src/db/notes_orphans.rs:128`) runs one `BEGIN IMMEDIATE` transaction with a single prepared `INSERT OR IGNORE` statement per 256-path chunk, with a per-row fallback (re-running the old one-`add_image`-per-path loop) if the batched transaction itself fails — so a single bad row can't sink the whole chunk. This turns a ~100k-image scan from ~100k autocommits into ~400 transactions without changing the DB-visible result: `add_images_batch_matches_per_row_inserts` (`db/notes_orphans.rs`) proves the batched and per-row paths produce byte-identical row sets, including duplicate-path dedup via the same `INSERT OR IGNORE`. The progress-emit cadence is decoupled from the batch size — the pipeline still emits at every 100th processed path (replaying the 100-boundaries crossed within each 256-row batch) so the UI-visible cadence is unchanged even though the underlying transaction size grew 256×.

**The scan/walk boundary itself is unchanged**: the scanner still only returns paths; it does not know about batching, transactions, or the 256 constant. This is exactly the boundary "Durable Notes" already documents ("Idempotency lives in `db.add_image`, not in the scanner") — the idempotency now lives in `db.add_images_batch`'s per-chunk `INSERT OR IGNORE` instead, but the scanner's ignorance of it is the same design.

## Key Interfaces / Data Flow

```
indexing.rs::run_pipeline_inner Phase::Scan:
  for each enabled root:
    ImageScanner::scan_directory(root_path)  → Result<Vec<String>>
      └─► std::fs::read_dir (synchronous, blocking)
      └─► std::fs::DirEntry::file_type     (one syscall per entry)
    aggregate into all_paths + paths_per_root

  for each chunk of 256 (path, root_id) in all_paths:
    db.add_images_batch(chunk)   ← one BEGIN IMMEDIATE + prepared INSERT OR IGNORE per chunk
                                    (per-row fallback loop if the chunk transaction fails)
    emit Phase::Scan progress at every 100-boundary crossed by this chunk

  for each enabled root:
    db.mark_orphaned(root.id, paths_per_root[root.id])
```

## Implemented Outputs / Artifacts

- `Vec<String>` of absolute paths suitable for `INSERT OR IGNORE INTO images(path, root_id)`.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| Symlinks, junctions can cause infinite descent | A symlink that loops back into the root being scanned | `read_dir` does not loop-protect; would hang. Untested. `walkdir` would handle this. |
| Permission errors propagate via `?` | Subdirectory the user cannot read | The whole `scan_directory` returns `Err`; the indexing pipeline logs warn and skips that root. Other roots still scan. |
| `.thumbnails/` self-recursion | A future scan-root that contains the thumbnails directory (today: thumbnails live under Library/, never inside a scan root) | `.thumbnails/thumb_42.jpg` would be picked up as a `.jpg` and re-encoded. Not currently possible because thumbnails live in `<app_data_dir>/thumbnails/` which is outside scannable folders. |
| Path conversion via `path.to_string_lossy()` | Non-UTF-8 path bytes on Linux/Windows | Lossy conversion replaces with `U+FFFD`. In practice every image path the app sees is UTF-8-clean. |
| Single-threaded recursion | Very deep / wide directory trees | Slow per-root scan. The indexing pipeline runs scans serially across roots. Not a hot bottleneck (typical scan is sub-second; the encode phase dominates wallclock). |
| The whole scan errors on the first read_dir failure mid-tree | A subdirectory that errors after some siblings succeeded | Returns `Err`; the partial work is discarded. Not graceful. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **`walkdir` for cross-platform symlink handling and consistent relative paths.** The author left a `// CAN USE WALKDIR` comment documenting that this was considered. For 749-image case the std-only recursion is fine; for symlink-heavy or tens-of-thousands cases `walkdir` would be more robust.
- **Explicit `.thumbnails/` exclusion** as a defensive guard against future scan-root shifts.
- **Continue-on-error within a root** — partial successes shouldn't be discarded by a single read_dir failure.
- **Parallel scan via rayon** — would help for libraries with thousands of subdirectories.

## Durable Notes / Discarded Approaches

- **`std::fs::read_dir` over `walkdir`** to avoid the dependency. For typical scan sizes this is fine; the author noted in source that walkdir is the right answer when symlinks become a concern.
- **`.to_string_lossy().to_string()` over `.to_str().unwrap()`** because Windows paths can contain non-UTF-8 codepoints. Safer to lossily-convert than to panic.
- **Idempotency lives in the DB layer, not in the scanner.** The scanner returns every path it sees; `db.add_images_batch`'s per-chunk `INSERT OR IGNORE` (falling back to the older per-row `db.add_image` on a chunk failure) deduplicates. This means partial scans can be retried safely — true before T2-2's batching and still true after, since the `INSERT OR IGNORE` semantics didn't change, only the transaction grouping around them.
- **Per-root path lists kept for `mark_orphaned`.** The whole-pipeline alive-set isn't enough — orphan detection needs per-root scope so a file present in root A doesn't prevent a file with the same name in root B from being orphaned.

## Obsolete / No Longer Relevant

The pre-Phase-6 single-root model where `main.rs` hardcoded `Path::new("test_images")` is gone. The folder picker landed in Phase 4a; multi-folder in Phase 6. The stale `test_scan_directory_finds_all_images` test that asserted `len() == 4` against a 749-image folder is gone (commit `12d9b07`).
