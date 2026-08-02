# filesystem-scanner

*Maturity: working*

> **Verified 2026-07 (100k perf round):** `filesystem.rs` itself is byte-for-byte unchanged since the previous upkeep baseline (`f29f202`) — confirmed via `git diff f29f202 HEAD -- apps/lynceus/src-tauri/src/filesystem.rs`, empty. What changed is entirely on the DB-insertion side of the boundary this scanner sits next to (T2-2, commit `ebe4006`): the "Multi-root semantics" and "Key Interfaces / Data Flow" sections below have been updated to reflect the new batched `add_images_batch` insert path; the scan/walk algorithm and extension whitelist described here are exactly as they were.
>
> **Second update, same round-family:** the insertion boundary changed again with content-hash relink — `add_images_batch` is no longer the pipeline's live insert path (see "Insertion boundary" below). `filesystem.rs` is still untouched — re-confirmed via `git status --short apps/lynceus/src-tauri/src/filesystem.rs`, empty.

## Scope / Purpose

Recursively walks a directory and returns a flat `Vec<String>` of image paths. Used by the indexing pipeline once per enabled root per pipeline run. The pipeline aggregates the results across roots, diffs them against what the DB already has by path, `mark_orphaned`s any DB rows whose paths aren't in the alive set (now run BEFORE insertion — see "Insertion boundary" below), then hashes and routes each genuinely-new path through content-hash relink (`relink_or_insert`) so a moved file lands back on its orphaned row instead of a fresh id.

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

### Insertion boundary — where the scanner's output goes (T2-2 → content-hash relink)

The scanner hands back a flat `Vec<String>` per root; nothing about hashing, relinking, or transactions lives in `filesystem.rs`. The pipeline aggregates every root's paths into one `Vec<(String, i64)>` (`all_paths`), then:

1. Diffs `all_paths` against `database.get_paths_to_root_ids()` (a single SELECT) to find the genuinely-new paths — everything the DB already knows by path is either alive or an orphan `mark_orphaned` (next) will un-orphan at the same path, and neither is a relink candidate.
2. Runs `database.mark_orphaned(root.id, alive)` per root — **before** any insert or relink, which is load-bearing: `relink_or_insert` (below) only matches rows with `orphaned = 1`, and a moved file's source row is only flagged orphaned by this step, so it must run first or a move is never detected.
3. Hashes the new paths in parallel (`content_hash::hash_file`, BLAKE3, rayon) and then, SERIALLY, calls `database.relink_or_insert(path, root_id, hash, size)` for each — matching a moved file back to its orphaned row (preserving its id, tags, layout, embeddings) or inserting it fresh. A file whose hash fails to compute (unreadable, deleted mid-scan) falls back to a plain `database.add_image(path, root_id)` with no hash, so it still enters the catalogue and is picked up by the content-hash backfill pass or a later scan.

```rust
// apps/lynceus/src-tauri/src/indexing.rs, Phase::Scan (run_pipeline_inner)
let new_paths: Vec<(String, i64)> = all_paths
    .iter()
    .filter(|(p, _)| !existing_paths.contains(p.as_str()))
    .cloned()
    .collect();
// mark_orphaned per root runs here, BEFORE the loop below.
for (path, root_id, hash, size) in &hashed /* parallel-hashed new_paths */ {
    database.relink_or_insert(path, Some(*root_id), hash, *size as i64)?;
}
```

`content_hash::hash_file` (`crates/engine/src/content_hash.rs`) and `relink_or_insert` (`crates/engine/src/db/content_hash.rs`) are engine-crate methods, not part of this scanner. This supersedes T2-2's `add_images_batch` (chunked `INSERT OR IGNORE`, described in the previous baseline of this note) as the scan phase's live insert path: a bare `INSERT OR IGNORE` can't tell "genuinely new" from "moved", which is exactly the distinction the hash makes. `add_images_batch` itself is untouched, still tested, and still callable — it just has no caller left in the indexing pipeline (see `systems/database.md` Known Issues).

**The scan/walk boundary itself is unchanged**: the scanner still only returns paths; it does not know about hashing, relinking, or transactions. This is exactly the boundary "Durable Notes" already documents ("Idempotency lives in the DB layer, not in the scanner") — see below for how that idempotency mechanism itself changed.

## Key Interfaces / Data Flow

```
indexing.rs::run_pipeline_inner Phase::Scan:
  for each enabled root:
    ImageScanner::scan_directory(root_path)  → Result<Vec<String>>
      └─► std::fs::read_dir (synchronous, blocking)
      └─► std::fs::DirEntry::file_type     (one syscall per entry)
    aggregate into all_paths + paths_per_root

  new_paths = all_paths not already in db.get_paths_to_root_ids()   (A)

  for each enabled root:                                            (B, MUST run before C)
    db.mark_orphaned(root.id, paths_per_root[root.id])

  if new_paths is empty: emit Phase::Scan(total, total)              ← steady-state no-op
  else:                                                              (C)
    par_iter new_paths → content_hash::hash_file(path)                ← parallel
    for each hashed (path, root_id, hash, size) SERIALLY:              ← serial, load-bearing
      db.relink_or_insert(path, root_id, hash, size)
    for each hash-failed (path, root_id):
      db.add_image(path, root_id)                                     ← NULL-hash fallback
    emit Phase::Scan progress at a total/4000-scaled interval

  db.get_images_without_content_hash() → hash each → db.set_content_hash(...)  (D)
    ← backfill pass, after scan/relink and before the thumbnail phase;
      no-op unless a pre-existing row's hash is still NULL
```

## Implemented Outputs / Artifacts

- `Vec<String>` of absolute paths. The pipeline diffs these against the DB by path before hashing, and routes each genuinely-new one through `relink_or_insert` (UPDATE on a moved-file match, INSERT on a miss) rather than a bare `INSERT OR IGNORE`.

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
- **Idempotency lives in the DB layer, not in the scanner.** The scanner returns every path it sees on every run; the pipeline's `existing_paths` diff (against `db.get_paths_to_root_ids()`) is what makes a repeat scan of an unchanged folder a no-op — a path already in the DB never reaches hashing or `relink_or_insert` at all. This is a different mechanism than T2-2's chunked `INSERT OR IGNORE` (which relied on the `path UNIQUE` constraint to silently no-op a re-seen path), but the scanner-facing contract is unchanged either way: partial scans can still be retried safely, because a re-scanned path either matches nothing new (steady state) or is evaluated fresh against the current orphan set.
- **Per-root path lists kept for `mark_orphaned`.** The whole-pipeline alive-set isn't enough — orphan detection needs per-root scope so a file present in root A doesn't prevent a file with the same name in root B from being orphaned.

## Obsolete / No Longer Relevant

The pre-Phase-6 single-root model where `main.rs` hardcoded `Path::new("test_images")` is gone. The folder picker landed in Phase 4a; multi-folder in Phase 6. The stale `test_scan_directory_finds_all_images` test that asserted `len() == 4` against a 749-image folder is gone (commit `12d9b07`).
