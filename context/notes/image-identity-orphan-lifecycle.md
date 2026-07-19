# Image identity and the orphan lifecycle — diagnosis ledger

> Recorded 2026-07-19 after a live "21 missing files" report following a
> restructure of an indexed wallpapers folder. Code-verified by an independent
> diagnosis pass (file:line cites below current as of v0.7.1). This note is the
> map; the remedy decisions live with the commits that implement them.
>
> **Same-day update:** remedy 1 (content-hash relink) has since been
> implemented — the root fact below and remedy 1's entry are updated
> accordingly; file:line cites in those two spots are current as of v0.7.6.

## The identity model (the root fact)

Image identity is **the raw filesystem path**: `images.path TEXT NOT NULL UNIQUE`
(`crates/engine/src/db/mod.rs:201`). Path is still the row's primary identity —
there's no other UNIQUE key a move could hang off — but it is no longer the
ONLY signal: as of remedy 1 (below, **implemented**), every image also carries
a full-content BLAKE3 hash (`images.content_hash` / `images.size`), and the
scan pass uses it to match a moved/renamed file back to the orphaned row it
came from instead of minting a new id. The consequences below still hold in
full for one case — an orphaned row whose `content_hash` is NULL, i.e.
indexed before this feature existed and never backfilled — since there's no
on-disk file left to hash for it.

## Lifecycle of a row

```
discovered on scan ──► INSERT OR IGNORE, orphaned=0        (db/notes_orphans.rs:87-99)
        │
        │  every pipeline pass (startup, add/remove root, watcher-debounced FS event)
        │  diffs DB rows against a fresh disk scan per enabled root (indexing.rs:439-452)
        ▼
mark_orphaned: resets orphaned=0 for the WHOLE root, then re-marks
whatever this scan's alive-set is missing                  (db/notes_orphans.rs:29-33)
        │
        ├── file returns at the SAME path ──► auto-un-orphaned ✓
        │   (proven: test mark_orphaned_unmarks_returned_files)
        │
        ├── file MOVED to a new path, content_hash populated ──►
        │   relinked to the SAME row: id, tags, placement, embeddings all
        │   survive           (db/content_hash.rs::relink_or_insert, remedy 1)
        │
        └── file MOVED to a new path, content_hash NULL (indexed before
            remedy 1 shipped, never backfilled) ──► old row orphaned FOREVER,
            new path inserted as a brand-new id
```

Orphaned rows are hidden from the grid (`images.orphaned = 0` predicate at
`images_query.rs:340,809,902,934`) and excluded from encode queues
(`indexing.rs:1150`), but **nothing ever purges them** — the only deletes in the
DB layer are `remove_root` (whole-root cascade, `db/roots.rs:95-101`) and
`wipe_images_for_new_root` (`db/roots.rs:157-158`).

## What a move actually costs the user

| Attached data | Where it lives | After a move |
|---|---|---|
| Tags | `images_tags(image_id)` CASCADE on delete only | Stranded on the hidden old id; new row starts untagged |
| Masonry placement | `manual_order` / `manual_col_span` columns on `images` (mod.rs:208-209) | Lost — new row gets packer defaults |
| Embeddings + previews | `embeddings(image_id)`, thumbnail cache | Old ones stranded; new row fully re-thumbnailed and re-encoded (real recompute for unchanged bytes) |

**As of remedy 1 (implemented):** this table describes what still happens
only when the moved row's `content_hash` is NULL — pre-existing rows indexed
before the feature shipped, never backfilled. For every row hashed after the
feature existed (freshly indexed, or backfilled on first launch post-upgrade),
a move whose bytes are unchanged is relinked instead: all three rows above —
tags, masonry placement, embeddings — survive on the same id.

## The adjacent watcher gap

`watcher.rs` (module doc, lines 9-18) does not reconfigure itself when roots
change: any FS event triggers a full rescan of whatever roots were enabled at
app startup (`watcher.rs:76-88`), with no branching on event kind. A newly
added root is not live-watched until app restart; a removed root's on-disk
changes keep firing wasted rescans until restart. This is architecturally
separate from the identity model but feeds the same "app is sensitive to
folder changes" feel.

## Remedy options (ranked at diagnosis time)

1. **Content-hash relink at scan time** — match an unmatched new path against
   orphaned rows by stored content hash and UPDATE the path in place. The
   structural fix: preserves tags/placement/embeddings across restructures.
   Requires a hash column populated at index time (existing orphans, having no
   on-disk files left to hash, can never be retro-relinked). **Implemented**:
   `images.content_hash BLOB` + `images.size INTEGER` (`db/mod.rs:211-212`),
   added via the idempotent `migrate_add_content_hash_columns`
   (`schema_migrations.rs:233-251`) plus `idx_images_content_hash`
   (`db/mod.rs:319-323`). `content_hash::hash_file` (BLAKE3, streamed through
   a 64 KiB buffer) computes the digest + byte size; `db/content_hash.rs`'s
   `relink_or_insert` matches the lowest-id row with
   `orphaned = 1 AND size = ? AND content_hash = ?` and UPDATEs its
   path/root_id/orphaned in place (else INSERTs fresh). The scan pass in
   `indexing.rs::run_pipeline_inner` was reordered so `mark_orphaned` runs
   BEFORE hashing + relink — a moved file's source row is only flagged
   orphaned there, so relinking first would never find it — then hashes new
   paths in parallel via rayon and relinks them SERIALLY (determinism: each
   call commits before the next, so two identical moved files drain two
   distinct orphaned rows, lowest id first), with a NULL-hash `add_image`
   fallback if a file can't be read. A separate backfill pass
   (`get_images_without_content_hash` → `hash_file` → `set_content_hash`)
   hashes pre-existing NULL-hash rows after the scan and before the thumbnail
   phase, reusing `Phase::Scan` rather than adding a new phase variant; it is
   empty on a fresh index and in steady state, doing real work only on the
   first launch after upgrading. Still true after this: an orphan whose file
   is already gone AND whose `content_hash` is NULL (indexed before this
   feature shipped) can never be retro-relinked — there's no on-disk file
   left to hash. The engine DB/hash methods (`content_hash.rs`,
   `db/content_hash.rs`) are fully unit-tested; the pipeline's scan-phase
   reorder itself is not end-to-end runtime-tested (no GUI in the build
   environment to drive a real filesystem move through `run_pipeline_inner`).
2. **Explicit "clean up missing files" affordance** next to the orphan count in
   settings — scoped `DELETE ... WHERE orphaned = 1`. Closes the permanent-
   debris half only. **Implemented**: `db/notes_orphans.rs::purge_orphaned`
   (+ `list_orphaned_locations` for pre-delete thumbnail-path capture),
   wired through the `purge_orphaned_images` Tauri command and a "Clean up"
   button on `StatsSection.tsx`'s warning row. `images_tags` and
   `embeddings` cascade via existing `ON DELETE CASCADE` FKs; cached
   thumbnail files are best-effort removed alongside the rows. Still true
   after this: existing orphans have no on-disk file left to hash, so this
   remedy is strictly destructive for them — option 1 (relink, now
   **implemented**) is the only path that preserves their tags/placement/
   embeddings, and only for images indexed after content-hash relink shipped
   (freshly indexed, or backfilled on first launch post-upgrade).
3. **Watcher restart on add/remove root** — closes the watcher gap above.
   (Since this ledger was written, `watcher.rs` gained a `restart` that
   rebuilds against the current enabled-root list, called by the root
   mutation commands — so this remedy is effectively **implemented**; the
   "adjacent watcher gap" section above predates it and is stale.)
4. **Subtree-scoped rescans** instead of full-root diffs — bigger rewrite,
   perf-motivated.

## Relink limitations and edge cases (as-built, remedy 1)

An adversarial review of the relink implementation surfaced one corruption
vector (fixed) and three bounded limitations (documented, by design). Recorded
so a future reader does not re-discover them the hard way.

**Fixed — a transient scan failure must not orphan a whole root.** The scanner
(`filesystem.rs::scan_directory`) is fail-fast: one unreadable file, subdir, or
broken symlink anywhere in a root aborts that root's entire scan with an `Err`.
The scan loop caught the `Err` and moved on, leaving that root with no entry in
`paths_per_root`; the orphan pass then read an empty alive-set for it and marked
the **whole root** orphaned. Before relink that was merely "temporarily hidden,
recovers next scan". With relink it became dangerous: those freshly-orphaned rows
are relink candidates, so a genuinely-new file in *another* enabled root with
identical bytes (the common "same image in two albums" case) would match one and
migrate its tags/placement/embeddings onto the wrong file, stranding the
original. Fixed at `indexing.rs::run_pipeline_inner`: the orphan pass now skips
any root absent from `paths_per_root` (failed scan or missing folder), orphaning
only roots that actually scanned — an `Ok`-but-empty scan (folder genuinely
emptied) still has an entry, so real deletions are still detected. The deeper
root cause — the fail-fast scanner — is untouched; a skip-and-continue scanner
(the `// CAN USE WALKDIR` TODO at `filesystem.rs:27`) would reduce how often a
single bad file aborts a root, and is the recommended follow-up.

**By design — byte-identical files share one identity.** Content hashing makes
duplicates indistinguishable: N byte-identical files (including, degenerately,
every 0-byte file, which all share `blake3("")` + `size 0`) are one identity to
relink. When several identical files are orphaned together and reappear, relink
drains the orphans lowest-id-first in scan order (`ORDER BY id ASC LIMIT 1`), so
which orphan's metadata lands on which reappeared path is arbitrary. Harm is
low — the files are byte-identical, so a "wrong" tag sits on a visually identical
image — and the `size` prefilter does **not** help here (duplicates share size
*and* hash; size only guards against true hash collisions, which are
astronomically unlikely with BLAKE3-256). This is inherent to hash-based
identity, not a bug.

**By design — an in-place edit staleness the relink can't see.** A file edited
in place keeps its path, so the new-path diff never flags it and it is never
re-hashed (backfill only touches `content_hash IS NULL` rows). Its stored hash
now reflects the pre-edit bytes forever. If that file is later *moved*, its
orphaned old-path row carries the stale hash while the moved file is hashed with
its real post-edit bytes — the `(size, content_hash)` probe misses, so the move
is **not** relinked (it degrades to a fresh, untagged row, not a wrong relink).
Re-hashing on an mtime/size change at scan time would close this; deferred as
scope.

**By design — a move out of a *disabled* root does not relink.** Only enabled
roots are scanned and orphaned (`indexing.rs`, `enabled_roots`), so a disabled
root's rows are never flagged orphaned; a file moved from a disabled root into an
enabled one finds no orphan to match and inserts fresh. Defensible (the user
disabled the source deliberately) but silent.
