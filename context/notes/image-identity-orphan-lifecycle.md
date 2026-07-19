# Image identity and the orphan lifecycle — diagnosis ledger

> Recorded 2026-07-19 after a live "21 missing files" report following a
> restructure of an indexed wallpapers folder. Code-verified by an independent
> diagnosis pass (file:line cites below current as of v0.7.1). This note is the
> map; the remedy decisions live with the commits that implement them.

## The identity model (the root fact)

Image identity is **the raw filesystem path**: `images.path TEXT NOT NULL UNIQUE`
(`crates/engine/src/db/mod.rs:200`). There is no content hash and no rename/move
detection anywhere in the codebase. Every consequence below follows from this.

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
        └── file MOVED to a new path ──► old row orphaned FOREVER,
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
   on-disk files left to hash, can never be retro-relinked).
2. **Explicit "clean up missing files" affordance** next to the orphan count in
   settings — scoped `DELETE ... WHERE orphaned = 1`. Closes the permanent-
   debris half only. **Implemented**: `db/notes_orphans.rs::purge_orphaned`
   (+ `list_orphaned_locations` for pre-delete thumbnail-path capture),
   wired through the `purge_orphaned_images` Tauri command and a "Clean up"
   button on `StatsSection.tsx`'s warning row. `images_tags` and
   `embeddings` cascade via existing `ON DELETE CASCADE` FKs; cached
   thumbnail files are best-effort removed alongside the rows. Still true
   after this: existing orphans have no on-disk file left to hash, so this
   remedy is strictly destructive for them — option 1 (relink) is the only
   path that would have preserved their tags/placement/embeddings, and only
   for images indexed after a hash column exists.
3. **Watcher restart on add/remove root** — closes the watcher gap above.
4. **Subtree-scoped rescans** instead of full-root diffs — bigger rewrite,
   perf-motivated.
