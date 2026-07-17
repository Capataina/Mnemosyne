# tag-system

*Maturity: working → comprehensive on the backend surface (the library-drawer additions are fully landed and tested); frontend drawer UI ownership sits mostly in `systems/search-routing.md`*

## Scope / Purpose

End-to-end tag CRUD: create / list / delete / assign-to-image / remove-from-image, plus **three** UI surfaces — the search-bar `#`-prefixed autocomplete, the per-image `TagDropdown` inside the modal inspector, and the folders-as-tags **library drawer** (new in the v2 UI round) which turns every tag into a filterable "folder" with a live visible-image count and an include/exclude toggle. All tag mutations use TanStack Query optimistic updates with rollback on error. The grid filter supports **OR** (any-tag, default), **AND** (all-tags, opt-in via `tagFilterMode` preference), and now **exclude** (drawer-only, "none of these tags") semantics, all three composable in one query.

## Boundaries / Ownership

- **Owns:** the 6 tag Tauri commands (delegated via `commands::tags`), the `useTags` / `useCreateTag` / `useDeleteTag` query hooks, the `useAssignTagToImage` / `useRemoveTagFromImage` mutations, the SearchBar `#`-autocomplete, the TagDropdown popover combobox, the backend contract the library drawer's per-folder counts and include/exclude filtering are built on (`get_tag_counts`, the `exclude_tag_ids` parameter, the reverse tag index).
- **Does not own:** the actual tag SQL (delegates to `db::tags`), the AND/OR/exclude filter SQL (delegates to `db::images_query::get_images_with_thumbnails` and `get_feed_manifest` — see `systems/database.md`), the library drawer's own component tree and the frontend priority-chain wiring that makes the drawer and the search bar act as one filter (delegates to `apps/lynceus/src/components/library-drawer/` and `systems/search-routing.md`).
- **Public API (frontend):** `useTags()`, `useCreateTag()`, `useDeleteTag()`, `useAssignTagToImage()`, `useRemoveTagFromImage()`, plus `services/tags.ts::getTagCounts()` (consumed via an inline `useQuery({ queryKey: ["tagCounts"], queryFn: getTagCounts })` in the route — no dedicated hook file exists for it). Plus the `<SearchBar>`, `<TagDropdown>`, and library-drawer components.

## Current Implemented Reality

### Schema (recap)

`tags(id, name UNIQUE, color)` and `images_tags(image_id, tag_id, PRIMARY KEY(...))` with `ON DELETE CASCADE` from both directions. See `systems/database.md`.

### 6 Tauri commands

```
get_tags             () -> Vec<Tag>
get_tag_counts        () -> Vec<TagCount>                ← library drawer (new)
create_tag           (name: String, color: String) -> Tag
delete_tag            (tag_id: i64) -> ()
add_tag_to_image     (image_id, tag_id) -> ()            ← INSERT OR IGNORE (Phase 6 hardening)
remove_tag_from_image(image_id, tag_id) -> ()
```

`commands/tags.rs`. Returns `Result<T, ApiError>` for all 6.

### `get_tag_counts` — per-folder visible-image counts (library drawer)

```rust
pub struct TagCount { pub tag_id: i64, pub count: i64 }
pub fn get_tag_counts(&self) -> rusqlite::Result<Vec<TagCount>>
```

`db/tags.rs:75-100`, exposed via `commands::tags::get_tag_counts`. A dedicated catalogue-level query rather than a `count` field bolted onto `Tag` — a field would force a meaningless *global* count onto every `Tag` embedded in an image row and would change `get_tags`'s wire shape, whereas a separate view is the clean cut and leaves the existing `Tag`/`get_tags` surface untouched.

```sql
SELECT t.id AS tag_id, COUNT(vis.id) AS cnt
FROM tags t
LEFT JOIN images_tags it ON it.tag_id = t.id
LEFT JOIN images vis ON vis.id = it.image_id
    AND vis.orphaned = 0
    AND (vis.root_id IS NULL OR vis.root_id IN (SELECT id FROM roots WHERE enabled = 1))
GROUP BY t.id
ORDER BY t.id
```

The count uses the **exact same visibility predicate** as the grid query (`get_images_with_thumbnails`) and the manifest query (`get_feed_manifest`) — not-orphaned, in an enabled root (or a legacy NULL root) — so a folder's number in the drawer equals what opening it actually shows; an orphaned or disabled-root image is counted by neither. Returns a row for EVERY tag, including tags with zero visible images (the `LEFT JOIN` + `COUNT(vis.id)` rather than `COUNT(*)` is what makes a tag with no matching visible row count as 0 rather than being absent), so the drawer never has to guess a missing tag's count. Served over the read-only secondary connection (R2) since the drawer polls it (`useQuery({ queryKey: ["tagCounts"] })` in the route). Test-locked: `get_tag_counts_matches_grid_visibility_predicate` (a tag spanning a visible/orphaned/disabled-root image counts 1; a zero-image tag returns a 0 row).

Powered by the same reverse index the include-filter subquery uses — `idx_images_tags_tag ON images_tags(tag_id, image_id)` — without which this join, run once per folder shown in the drawer (i.e. potentially dozens at once), would each full-scan `images_tags`. See `systems/database.md`'s "Composite indexes" section.

### Exclude-tag filtering — the library drawer's third boolean dimension

```rust
// get_images / get_feed_manifest — 4th parameter
exclude_tag_ids: Vec<ID>
```

Appended as a `NOT EXISTS` clause on top of the include filter (OR or AND) and the root/orphan visibility predicate, in both `get_images_with_thumbnails` and `get_feed_manifest`:

```sql
AND NOT EXISTS (
    SELECT 1 FROM images_tags ex
    WHERE ex.image_id = images.id
    AND ex.tag_id IN (?, ?, ...)
)
```

An image survives only if it carries NONE of the excluded tags. Empty `exclude_tag_ids` (the default for every pre-drawer caller) adds no clause at all — behaviour is byte-identical to the pre-drawer query. Params bind include-set-then-exclude-set. Test-locked: `exclude_tag_filter_removes_images_carrying_an_excluded_tag` (empty exclude = back-compat; exclude drops the tagged image; include+exclude combined proves the bind order is correct). Wired frontend-side as `excludeTags` state in the route (drawer-only — the search bar's `#`-autocomplete only ever adds to the include set), threaded through `useFeedManifest`'s `excludeTagIds` param. See `systems/search-routing.md` for the frontend state and priority-chain wiring, and `systems/database.md`'s T3-1 section for `get_feed_manifest` itself.

### Folders-as-tags — the library drawer's model

The library drawer (new in the v2 UI round, backend landed in `0f235d8`, frontend wiring + `excludeTagIds` threading in `6bdb827`) presents every tag as a filterable "folder" with a live visible count, click-to-include, and a secondary exclude toggle, plus a similarity breadcrumb trail for backing out of a "View Similar" dive. The search bar's `#`-autocomplete and the drawer are explicitly **one filter, not two** — both write into the same `searchTags`/`excludeTags` state in the route, so picking a tag from either surface produces the identical query. See `systems/search-routing.md` for the full frontend contract (state shape, priority chain, the "a filter always acts on what you can see" coherence guarantee) and `apps/lynceus/src/components/library-drawer/` for the component tree.

### `delete_tag` now wired (Phase 6 fix)

Pre-Phase-6, `db::delete_tag` existed in the database layer but was never registered in `invoke_handler!` — orphaned dead code. Phase 6 added the Tauri command + `useDeleteTag` mutation + delete affordance in the search bar / TagDropdown. Typo'd tags can now be removed via UI.

### `add_tag_to_image` is `INSERT OR IGNORE` (Phase 6 hardening)

Pre-Phase-6 it was plain INSERT, which errored with `UNIQUE constraint failed` on duplicate assignment. The frontend pre-checked selection state, but a frontend bug or race condition would surface as a backend error string. The change to `INSERT OR IGNORE` makes duplicates silently no-op.

### Optimistic mutation pattern

Every tag mutation follows the canonical pattern (also documented in `notes/conventions.md`):

```ts
useMutation({
    mutationFn: (params) => /* IPC call via service */,
    onMutate: async (params) => {
        await queryClient.cancelQueries({ queryKey: [...] });
        const prevData = queryClient.getQueryData([...]);
        queryClient.setQueriesData([...], optimistic update);
        return { prevData };
    },
    onError: (_err, _vars, context) => {
        if (context?.prevData) {
            queryClient.setQueryData([...], context.prevData);
        }
    },
    onSuccess: (data) => { /* swap optimistic placeholder for real data */ },
});
```

Specifically:

- `useCreateTag`: optimistic insert with `id = -1` placeholder; `onSuccess` replaces with the real tag from the IPC response.
- `useDeleteTag`: optimistic remove from the `["tags"]` cache; `onError` rolls back.
- `useAssignTagToImage` / `useRemoveTagFromImage`: optimistic mutation of the affected `["images", ...]` query data; `onError` rolls back.

### `#`-prefixed autocomplete

`SearchBar.tsx` reads the input string. When the user types `#`, the SearchBar shows a popover combobox (cmdk) listing matching tags. Selecting one creates a tag pill in the search-bar tag list (`searchTags` state in the page); the input clears. Typing `#newname` then pressing Enter triggers `useCreateTag` to create-on-no-match.

The page's `shouldUseSemanticSearch` excludes `#`-prefixed text so the user doesn't accidentally fire a vector search while picking a tag.

### TagDropdown (per-image)

The PinterestModal renders a `<TagDropdown>` for the selected image, showing currently-assigned tags as pills + an "add tag" combobox. Clicking a pill removes the tag (`useRemoveTagFromImage`); selecting from the combobox assigns (`useAssignTagToImage`). The combobox supports create-on-no-match, same as the SearchBar.

### AND vs OR filter mode

Backend SQL switches based on the `match_all_tags` boolean (defaults to `false` / OR for backwards compatibility):

```sql
-- OR (default): EXISTS-IN
WHERE EXISTS (SELECT 1 FROM images_tags WHERE image_id = images.id AND tag_id IN (...))

-- AND (match_all_tags = true): GROUP BY HAVING COUNT
WHERE images.id IN (
    SELECT it2.image_id FROM images_tags it2
    WHERE it2.tag_id IN (...)
    GROUP BY it2.image_id
    HAVING COUNT(DISTINCT it2.tag_id) = N
)
```

The frontend's `useImages` hook threads `prefs.tagFilterMode === "all"` into the `match_all_tags` IPC argument. The query key includes `matchAllTags` so toggling re-fetches with fresh SQL semantics rather than serving cached OR results.

User-facing toggle: Settings → Search → Tag filter (Any / All). This toggle governs the INCLUDE set only; the drawer's exclude set is always "none of these", with no AND/OR ambiguity to toggle.

## Key Interfaces / Data Flow

### Inputs

- User typing in SearchBar with `#` prefix → autocomplete or create flow (include set)
- User clicking a folder in the library drawer → include or exclude toggle (same `searchTags`/`excludeTags` state the search bar writes into)
- User clicking pill in TagDropdown → assign / remove
- User toggling Settings → Search → Tag filter → AND/OR switch (include set)

### Outputs

- `useTags` query → `["tags"]` cache, drives every `<TagDropdown>` and `<SearchBar>` autocomplete
- `["tagCounts"]` inline query (`getTagCounts`) → drives the library drawer's per-folder counts
- Mutations write to DB via `commands::tags::*`
- Cache invalidation via `invalidateQueries(["tags"])` and the feed-manifest query key (which now includes `matchAllTags`/`excludeTagIds`, not `["images"]` — see `systems/database.md`'s note on `get_images` being wire-compat only) after mutations

### Dependencies

- TanStack Query for cache + mutation lifecycle (`systems/frontend-state.md`)
- shadcn `cmdk` primitive (`apps/lynceus/src/components/ui/command.tsx`) for the combobox
- `framer-motion` for pill animations

## Implemented Outputs / Artifacts

- 5 tag Tauri commands fully exercised by the frontend
- 5 React Query hooks (one per command) following the canonical optimistic pattern
- Two UI surfaces: SearchBar autocomplete + per-image TagDropdown
- AND/OR semantic toggle with frontend pref + backend SQL branch + cache key inclusion

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| `create_tag` UNIQUE constraint surfaces as `ApiError::Db("UNIQUE constraint failed: tags.name")` | User creates a tag with an existing name | Frontend gets a typed-but-generic message. Could be sharpened to `ApiError::BadInput("tag already exists")`. |
| Tag color picker doesn't exist | Created tags get a hardcoded default color (`#3489eb`) | Aesthetic limitation — the user can't pick a color when creating. The color column accepts any hex string, so a future picker UI just wires through. |
| AND-filter semantic on a single tag is identical to OR | User selects one tag with AND mode on | The `HAVING COUNT(DISTINCT) = 1` collapses to the same result as `EXISTS-IN`. Cosmetically inefficient SQL but correct. |
| Cache key includes `matchAllTags` | Toggling AND/OR triggers re-fetch | Intentional — caching OR results would show wrong results when toggling. Slightly more network traffic on toggle. |
| Mutation rollback only restores the snapshot, doesn't refetch | Backend rejects the mutation but the cache entry is still consistent | The user sees the optimistic state revert; if the rejection was due to staleness (e.g., another window deleted the tag), the cache might still have the deleted tag. `invalidateQueries` on `onSuccess` covers the success path; `onError` doesn't. |
| `get_tag_counts` and the grid's visibility predicate are duplicated SQL, not shared | Either query's WHERE/JOIN visibility fragment is edited without the other | `db/tags.rs::get_tag_counts` and `db/images_query.rs::get_images_with_thumbnails`/`get_feed_manifest` each inline their own copy of "not orphaned, in an enabled root or legacy NULL root" — they stay correct only as long as both are edited together. Kept inline deliberately (see Durable Notes) rather than abstracted, so this is a live drift risk flagged for the next pass through either file, not a bug today. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Tag color picker** in the create-tag flow.
- **Sharper `create_tag` errors** for UNIQUE violations (`ApiError::BadInput("tag already exists")`).
- **Bulk tag operations** for multi-select (Phase 10 deferred).
- **Tag rename** — currently a tag is recreated under a new name and re-assigned (manual). A rename command would update in place.
- **Hoist the shared visibility predicate** (`orphaned = 0 AND (root_id IS NULL OR root_id IN (enabled roots))`) into one place — `db/tags.rs::get_tag_counts`, `db/images_query.rs::get_images_with_thumbnails`, and `db/images_query.rs::get_feed_manifest` each currently inline their own copy. Explicitly deferred rather than done inline with the library-drawer backend work (see Durable Notes below), to match how `images_query.rs` already inlines its `root_filter` string per-query rather than force a shared constant unasked.

## Durable Notes / Discarded Approaches

- **`get_tag_counts` as a separate view, not a `count` field on `Tag`.** A field would force a meaningless global count onto every `Tag` embedded in an image row and would change the `get_tags` wire shape for every existing consumer; a dedicated command leaves `Tag`/`get_tags` completely untouched and the drawer joins the two result sets by `tag_id` client-side.
- **The visibility-predicate duplication between `get_tag_counts` and the grid/manifest queries is a deliberate, flagged trade-off, not an oversight.** `images_query.rs` already inlines its `root_filter` string separately per query rather than sharing a constant, so keeping `get_tag_counts`'s copy inline matches the existing pattern rather than introducing a new abstraction unasked. The cost — two places must be edited together — is named explicitly above (Known Issues) rather than silently accepted.
- **Exclude as a `NOT EXISTS` clause appended after the include branches, not a rewritten unified predicate.** Keeping include (OR/AND) and exclude as separate, independently-toggleable clauses means an empty exclude set is provably a no-op (nothing appended) rather than a differently-shaped query that happens to produce the same rows — simpler to reason about and to keep every pre-drawer caller's behaviour byte-identical.
- **`INSERT OR IGNORE` over plain INSERT** because duplicate assignment is a no-op user-intent, not an error to propagate. Phase 6 hardening.
- **Optimistic updates with rollback** because TanStack Query's `staleTime: Infinity` means without optimistic updates the UI would feel stale until the next manual refetch. The rollback handles transient IPC failures cleanly.
- **AND/OR is opt-in default-OR** to preserve backwards compatibility for users who had grown used to OR. The toggle lives in Settings rather than a per-search modifier so it's a stable preference, not a per-keystroke decision.
- **Cache key includes `matchAllTags`** so toggling produces a fresh fetch. The alternative — caching one set and filtering client-side — would require fetching every potentially-matching image and is the wrong trade-off for the typical ~10k-image library.
- **Default tag color hardcoded.** A picker is on the roadmap but the default is fine for "I just want to create a tag and move on."

## Obsolete / No Longer Relevant

The pre-Phase-6 orphaned `db::delete_tag` (existed but unreachable from frontend) is gone — now wired through `commands::tags::delete_tag` + `useDeleteTag`. The pre-Phase-6 plain INSERT for `add_tag_to_image` is gone (replaced by INSERT OR IGNORE).
