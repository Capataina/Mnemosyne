# feed-protocol

*Maturity: comprehensive · Stability: unstable*

## Scope / Purpose

The cross-boundary contract between the Rust backend and the React frontend for "what does the main feed show, and how does it learn about new images without re-fetching the world." Introduced in the 100k performance round (T3-1, commit `012012c`) to kill catalogue amplification: the pre-round feed query joined tags onto every row and the frontend refetched the whole library on an ~5s cadence during indexing, so a 100k-image library re-materialised 100k rows (with a 200-300k-row tag `LEFT JOIN` unroll) every few seconds while thumbnails were still generating.

The protocol has two halves that this document treats as one system because they only make sense together:

1. **Compact manifest + per-id hydration** — the steady-state read path. A tile only ever needs geometry; the manifest gives it geometry and nothing else, and detail hydrates lazily per id.
2. **Batched feed-delta events** — the live-update path during indexing. New rows arrive as small patches instead of forcing a manifest refetch.

Owned jointly by `crates/engine/src/db/images_query.rs` (manifest + hydration queries), `apps/lynceus/src-tauri/src/indexing.rs` (delta producer), and the frontend consumer trio `apps/lynceus/src/services/images.ts` + `services/feedDelta.ts` + `hooks/useIndexingStatus.ts` + `queries/useImages.ts`.

## Boundaries / Ownership

- **Owns:** the `get_feed_manifest` / `get_image_details` (backed by `get_image_details_by_ids`) command pair, the `feed-delta` Tauri event shape and its batching/flush discipline, the `["feed-manifest", tagIds, matchAllTags, excludeTagIds]` / `["image-detail", id]` react-query entity model, and the merge semantics that keep the two caches coherent through an indexing run.
- **Does not own:** the shuffle ordering applied on top of the manifest (`frontend-state.md` § shuffle / `useShuffledFeed`, documented in `notes/random-shuffle-as-feature.md`), the masonry packing that consumes the ordered feed (`masonry-layout.md`), the priority chain that decides whether the manifest or a search/similar result set drives the grid (`search-routing.md`), or the indexing pipeline's phase machine itself (`indexing.md`) — this file only owns the wire contract indexing emits over.
- **Public API (backend → frontend):** `get_feed_manifest(filter_tag_ids, match_all_tags, exclude_tag_ids) -> FeedManifestRow[]`, `get_image_details(ids) -> ImageData[]` (thin Tauri command over `ImageDatabase::get_image_details_by_ids`), the `feed-delta` event (`FeedDeltaBatch { rows: FeedDeltaRow[] }`).
- **Public API (frontend):** `fetchFeedManifest()` / `useFeedManifest()`, `fetchImageDetails()` / `useImageDetail()` / `prefetchImageDetails()`, `mergeFeedDeltaRows()`.

## Current Implemented Reality

### The compact manifest

`crates/engine/src/db/images_query.rs:798` (`ImageDatabase::get_feed_manifest`). One row per visible image, id-ascending, **no tags join, no notes, no original path**:

```rust
pub struct FeedManifestRow {
    pub id: ID,
    pub name: String,              // basename, derived Rust-side — full path never travels
    pub width: Option<i64>,        // None until thumbnailed
    pub height: Option<i64>,
    pub thumbnail_path: Option<String>,  // None/empty until thumbnailed — drives hasThumbnail
    pub manual_col_span: Option<i64>,    // persisted drag-resize; None = default width
}
```

The `WHERE` clause is a byte-faithful copy of the legacy `get_images_with_thumbnails` predicate — same root/orphan visibility, same include OR/AND semantics via `EXISTS`/`GROUP BY … HAVING COUNT = n`, same exclude `NOT EXISTS` — so manifest membership is identical to the old catalogue's for every filter combination. This is test-locked: `manifest_membership_matches_legacy_query` in `images_query.rs:1371` runs both queries against the same fixture DB and diffs the id sets. What changed is only the `SELECT` list and the missing `LEFT JOIN`s — at 100k images the legacy query unrolled to 200-300k joined rows that got `HashMap`-aggregated in Rust; this one reads exactly N rows straight into the result `Vec`.

Frontend side, `apps/lynceus/src/services/images.ts:60` (`fetchFeedManifest`) calls the Tauri command `get_feed_manifest` and maps each row through `mapFeedManifestRow` (`images.ts:38`) into the grid's `FeedItem` shape (`types.d.ts:67`):

```ts
export type FeedItem = {
  id: number; name: string;
  url?: string;              // absent on manifest entries — present once hydrated
  thumbnailUrl?: string;
  hasThumbnail: boolean;     // derived: !!thumbnail_path
  width: number; height: number;   // placeholder 400×400 until real dims land
  manualColSpan?: number | null;
};
```

Query key: `["feed-manifest", tagIds, matchAllTags, excludeTagIds]` (`queries/useImages.ts:48`, `useFeedManifest`). Per-filter duplication is now geometry-only — the expensive part (id + dims + thumbnail path) is the whole payload, not a shadow of a full `ImageItem[]`.

### Per-id hydration

Full detail (tags, full-res URL, notes-adjacent fields) hydrates **only** for the selected image and its arrow-nav neighbours, via `get_image_details` (Tauri command, `src-tauri/src/commands/images.rs:72`) → `ImageDatabase::get_image_details_by_ids` (`images_query.rs:895`). This is the same `LEFT JOIN … tags` aggregation the legacy full-catalogue query always did, just scoped to an explicit id batch instead of the whole visible set:

```rust
pub fn get_image_details_by_ids(&self, ids: &[ID]) -> rusqlite::Result<Vec<ImageData>>
```

Applies the identical root/orphan visibility predicate as the manifest, chunks at 500 ids to stay clear of SQLite's bind-variable limit, results id-sorted across chunks. An orphaned or disabled-root id hydrates to nothing — the frontend's fallback (below) treats a miss exactly like the old catalogue `.find()` used to.

Frontend entity model (`queries/useImages.ts:16-27`), one hydrated record per id, stored once regardless of how many surfaces reference it:

```
["image-detail", id]  →  ImageItem | null
```

- `useImageDetail(id)` — single-id read, used for the URL-selected image.
- `prefetchImageDetails(queryClient, ids)` — batch-hydrates a list of ids in **one** IPC round-trip, skipping ids already cached fresh, and seeds each `["image-detail", id]` key individually. Called on hover (`prefetchSimilar` in `[...slug].tsx:348`), on click (`handleImageClick`), and on modal-neighbour resolution (the `modalNeighbourUrls` effect, `[...slug].tsx:599`) — so by the time an arrow-key lands on a neighbour its full detail is typically already in cache.

Field audit: a visible tile reads nothing beyond the manifest fields above — tags, notes, and the full-res path are read only inside the inspector/selection surfaces, which is what makes the manifest/detail split lossless for the grid.

### Selection: seed-then-upgrade

Because hydration is async, a click can't wait on it without breaking the "select and see the similar-set instantly" feel. `[...slug].tsx` resolves selection in two steps (`seedSelectionItem`, line 46, and the URL-effect at line 427):

1. **Seed** — synchronously build an interim `ImageItem` from the already-in-hand `FeedItem` (thumbnail as the stand-in full-res URL, `tags: []`).
2. **Upgrade** — swap in the hydrated `ImageItem` the instant `useImageDetail`'s data lands (usually the same tick, given the hover/click prefetch above).

The early-return guard at `[...slug].tsx:437-442` (`if (selectedItem?.id.toString() === pathId) { … return; }`) is load-bearing, not an optimisation: once `selectedItem` already matches the URL, the effect stops re-deriving it from `displayImages`. Without the guard, a tag/exclude-filtered id that falls outside the current filter (present only via a similar/semantic result, absent from the filtered manifest) would oscillate `selectedItem` null↔id forever — `displayImages` flips the moment `selectedItem` is set (to the similar-set, which never contains the seed image itself), so the naive lookup would re-null it, which un-sets it, which re-derives it, "Maximum update depth exceeded". This preserves the 656abc5 anti-oscillation guard through the manifest/detail split.

### Batched feed-delta events

During the thumbnail phase, each successfully-thumbnailed image becomes one `FeedDeltaRow` (backend: `src-tauri/src/indexing.rs:106`, mirrors the manifest row shape minus `manual_col_span` — a delta never carries a span so a re-thumbnail can't clobber a persisted resize):

```rust
pub struct FeedDeltaRow {
    pub id: i64, pub name: String,
    pub width: u32, pub height: u32,
    pub thumbnail_path: String,
}
pub struct FeedDeltaBatch { pub rows: Vec<FeedDeltaRow> }
```

Batching and flush discipline (`indexing.rs:129-138`, `520-608`):

- `FEED_DELTA_BATCH = 64` rows per event — at 100k images this is ~1.5k events across the whole thumbnail phase; the frontend additionally throttles cache application to a ~5s cadence, so event count is an IPC-payload-size concern, not a render-frequency one.
- Only rows whose DB write actually landed become deltas (`indexing.rs:554-583`) — the manifest cache must never claim a thumbnail the DB doesn't know about, which would make the eventual `Phase::Ready` reconcile visibly un-pop a tile.
- Buffered under the same `Mutex`-guarded "mutate-and-emit-while-held" discipline as the thumbnail progress high-water mark, so concurrent rayon workers can't interleave a partial batch.
- **Terminal flush ordered before the terminal `Phase::Thumbnail` progress emit** (`indexing.rs:604-610`) — so any frontend logic that reacts to a phase transition always runs after every delta row for that phase has been delivered. This ordering is why the frontend can safely flush its own buffer on `phase !== "thumbnail"` without a race.

Frontend consumer, `apps/lynceus/src/hooks/useIndexingStatus.ts:145-184` (`handleFeedDelta` / `applyBufferedDeltas`), inside the single module-level `indexing-progress`/`feed-delta` listener (see `frontend-state.md` for why this listener is a singleton):

```
handleFeedDelta(payload)
    → push rows into module-level deltaBuffer
    → if >5s since the last apply, applyBufferedDeltas() now
handleEvent(progress)   // fires on every indexing-progress event too
    → any phase transition AWAY FROM "thumbnail" flushes the buffer
      (covers the case where the last <5s tail would otherwise strand)
```

`applyBufferedDeltas` (`useIndexingStatus.ts:147-174`) does two different things depending on whether a manifest query is filtered:

- The **unfiltered** manifest cache (`UNFILTERED_MANIFEST_KEY = ["feed-manifest", [], false, []]`, `services/feedDelta.ts:28`) is patched **in place** via `mergeFeedDeltaRows` — no IPC, no re-materialise.
- Every **filtered** manifest query (`["feed-manifest", tagIds, …]` where the predicate in `applyBufferedDeltas` determines it isn't the unfiltered key) is instead `invalidateQueries`'d, forcing a refetch of the compact no-join query.

This split is deliberate, not an oversight: a delta row's tag membership is unknown client-side (the row only carries id/name/dims/thumbnail path), so patching a filtered view would risk showing an image that doesn't actually match the filter, or hiding one that does. Refetching keeps **"a filter always acts on what you can see"** honest — the same invariant `447e557` established for the search bar / library drawer coherence pass. See `search-routing.md` for the consumer side of that contract.

### `mergeFeedDeltaRows` — the merge itself

`apps/lynceus/src/services/feedDelta.ts:50-91`. Pure function, three load-bearing properties:

- **Identity-preserving.** Entries untouched by the batch keep their exact object identity, so `MasonryItem`'s scalar comparator and `useShuffledFeed`'s incremental fast path (below) both see them as unchanged and skip re-render/re-sort work.
- **Patch in place.** An id already present is replaced at its existing array index (position in the id-sorted manifest doesn't change), with `manualColSpan` explicitly carried over from the existing entry (`feedDelta.ts:69`) — deltas never carry a span, so without this line a re-thumbnail would silently wipe a persisted resize.
- **Insert sorted.** New ids are inserted at their id-sorted position via a single linear merge (sort the small insert batch, then one O(N + k log k) splice) rather than k individual O(N) splices — matching the backend's id-ASC manifest order so a delta-patched cache and a fresh refetch produce the identical array.

### `useShuffledFeed`'s incremental fast path (the surviving half of a rejected idea)

`apps/lynceus/src/hooks/useShuffledFeed.ts:76-191`. The shuffle itself (stable per-image key `hash(id, seed)`) is documented in `notes/random-shuffle-as-feature.md`; the piece that belongs to this protocol is what happens when the manifest array changes underneath an unchanged seed — exactly the shape of a delta-patched update.

When `cache.seed === seed && cache.images !== images` (T3-1's incremental branch, `useShuffledFeed.ts:114-176`):

1. Patch/remove over the previously-computed order — an id's key is fixed for a given seed, so no existing item can have moved; a removed id is dropped, a changed reference is swapped in place.
2. Newcomers merge-insert at their `(shuffleKey, id)` slot via one linear walk against the patched array (each already sorted by key) — no full re-sort.
3. If nothing actually changed (no removals, no newcomers, no reference swaps), the function returns the **previous array by reference**, so the masonry pack memo downstream holds without recomputation.

This is provably identical to a full rebuild — the comparator is a strict total order the cached array already satisfies by construction, and equivalence is test-locked. It is explicitly called out in the `012012c` commit body as "the surviving half of the rejected #4 incremental-shuffle idea" (see Durable Notes below).

### End-to-end trace: an image finishes thumbnailing mid-index

```
indexing.rs thumbnail worker
    → DB write succeeds
    → FeedDeltaRow pushed to delta_buffer
    → buffer hits 64 rows (or thumbnail phase ends)
    → emit_feed_delta() → "feed-delta" Tauri event
                                │
                                ▼
useIndexingStatus.ts module listener
    → handleFeedDelta(): buffer client-side; apply if >5s since last apply
    → applyBufferedDeltas():
        - mergeFeedDeltaRows() patches UNFILTERED_MANIFEST_KEY in place
        - any FILTERED "feed-manifest" query is invalidateQueries'd
                                │
                                ▼
useFeedManifest() (unfiltered case) sees a new array reference
    → useShuffledFeed's incremental path patches/merge-inserts
      (existing tiles' positions untouched; newcomer inserted at its key slot)
                                │
                                ▼
Masonry re-packs only the delta (worker-side geometry, masonry-layout.md)
    → newcomer tile "pops in" at its own gap; nothing else reflows
```

### Phase::Ready reconciliation (the fallback that makes the whole thing lossless)

`useIndexingStatus.ts:234-256`. On `phase === "ready"` (de-duped per run via `readyInvalidatedFor`):

- Force-flushes any remaining delta buffer (`lastDeltaAppliedAt = 0`).
- `invalidateQueries(["feed-manifest"])` — drops **every** manifest query (filtered and unfiltered), forcing a full refetch. This is the delta protocol's correctness backstop: any drift the delta stream couldn't express (orphan flips from a root toggle mid-run, scan-only rows whose thumbnail arrived but whose tag state changed, a genuinely lost event) self-heals here.
- Also invalidates `["fused-similar-images"]` and `["fused-semantic-search"]` (search results computed against a mid-index embedding set would otherwise serve stale under their 5-minute staleTime) and `["thumbnail"]` (a same-root re-index regenerates bucket files at identical paths; the adaptive-thumbnail cache's `staleTime: Infinity` would otherwise keep serving stale pixels at the old URL).

## Key Interfaces / Data Flow

### Wire shapes

| Shape | Side | Fields |
|---|---|---|
| `FeedManifestRow` (Rust) / `FeedManifestRowDTO` (TS) | backend → frontend, `get_feed_manifest` | `id, name, width?, height?, thumbnail_path?, manual_col_span?` |
| `FeedDeltaRow` (Rust) / `FeedDeltaRowDTO` (TS) | backend → frontend, `feed-delta` event | same minus `manual_col_span` |
| `FeedItem` (TS) | frontend-internal, what the grid renders | manifest/delta row + hydrated detail both map onto this; `url` only present once hydrated |
| `ImageData` (Rust) / `ImageItem` (TS) | backend → frontend, `get_image_details` | full row incl. `tags`, `manual_order`, `manual_col_span`, plus the two path fields |

### Cache key inventory

| Query key | Populated by | Patched by delta? | Invalidated on `ready`? |
|---|---|---|---|
| `["feed-manifest", [], false, []]` (unfiltered) | `fetchFeedManifest` | Yes — `mergeFeedDeltaRows` in place | Yes (backstop) |
| `["feed-manifest", tagIds, matchAll, excludeIds]` (any filter set) | `fetchFeedManifest` | No — invalidated instead | Yes |
| `["image-detail", id]` | `fetchImageDetails` (single or batched) | Not touched by deltas | No — hydration is orthogonal to catalogue membership |
| `["fused-similar-images", id, encoderId, topN]` | `fetchFusedSimilarImages` | N/A | Yes |
| `["fused-semantic-search", query, topN]` | `fetchFusedSemanticSearch` | N/A | Yes |
| `["thumbnail", id, bucket]` | `useAdaptiveThumbnail` | N/A | Yes (prefix) |

### Inputs

- `get_feed_manifest` IPC call (filter args from the active library-drawer/search-bar state — see `search-routing.md`)
- `get_image_details` IPC call (explicit id batch)
- `feed-delta` / `indexing-progress` Tauri events

### Outputs

- `FeedItem[]` manifest → `useShuffledFeed` → `Masonry` (`masonry-layout.md`)
- `ImageItem | null` per id → the inspector / selected-hero surfaces
- Cache invalidation side effects reaching `search-routing.md`'s `displayImages` priority chain indirectly (a `["feed-manifest"]` invalidation re-renders whichever tier is currently reading it)

## Implemented Outputs / Artifacts

- Backend: `get_feed_manifest` (`images_query.rs:798`), `get_image_details_by_ids` (`images_query.rs:895`), `FeedDeltaRow`/`FeedDeltaBatch`/`emit_feed_delta` (`indexing.rs:106-138`), the T3-1 impl block (+811 lines to `images_query.rs`).
- Frontend: `services/images.ts` (`mapFeedManifestRow`, `fetchFeedManifest`, `mapImageDetail`, `fetchImageDetails`), `services/feedDelta.ts` (`mergeFeedDeltaRows`, `UNFILTERED_MANIFEST_KEY`, ~91 lines), `queries/useImages.ts` (`useFeedManifest`, `useImageDetail`, `prefetchImageDetails`), the delta-consuming half of `hooks/useIndexingStatus.ts`.
- Tests: `manifest_membership_matches_legacy_query` and the id-batch hydration tests in `images_query.rs` (empty-ids, missing/orphaned-id skip, cross-chunk id-sort — `images_query.rs:1436-1480`); the `useShuffledFeed` pop-in-invariant tests (a new id never displaces an existing one) and the delta-merge tests referenced in the `012012c` commit body (111 vitest total post-merge, +15 for T3-1).

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|---|---|---|
| Filtered-manifest deltas are invalidate-only, never patched | Indexing runs while any tag/exclude filter is active | Every ~5s-cadence delta batch triggers a real refetch (compact no-join query, so cheap) for filtered views instead of an in-place patch. Correct, but means a filtered view pays more IPC round-trips during a long index than the unfiltered feed. |
| `applyBufferedDeltas`'s filtered-query predicate hardcodes the unfiltered key shape | A future filter dimension added to `useFeedManifest`'s key tuple without updating `services/feedDelta.ts`'s `isUnfiltered` check | The new filter dimension would be misclassified as "unfiltered" and start receiving direct patches with unknown tag membership, silently breaking the "a filter acts on what you can see" contract. No test currently pins this predicate against a hypothetical fourth key segment. |
| `readyInvalidatedFor` de-dupe keys on the `ready` event's `message` string | Two consecutive indexing runs that happen to share the same terminal message | The second run's `ready` reconciliation would be skipped, and a genuine backstop invalidation would be silently dropped. Currently benign because messages carry per-run counts and don't repeat verbatim, but there's no structural (run-id) guarantee against it. |
| `get_image_details_by_ids` chunks at 500 but the frontend never issues an id batch that large in practice (`prefetchImageDetails` only ever passes 1-2 ids) | A future consumer (e.g. bulk multi-select tagging) batching hundreds of ids | The chunking exists and is exercised by tests, but has never been driven live at its actual design size; worth a real timing check before a future feature relies on it. |

## Partial / In Progress

None — both halves of the protocol (manifest+hydration, delta+merge) are fully landed and wired into every frontend consumer; the `012012c` commit body confirms "the only remaining `["images"]`/`fetchImages` strings in the app are two explanatory comments."

## Planned / Missing / Likely Changes

- **Build-outside-lock-then-swap for the embedding-store refresh** (a `multi-encoder-fusion.md`-side follow-up, not this protocol's, but worth cross-linking: a changed encoder's populate+persist currently runs under its write lock at `Phase::Ready`, ~0.5-1s/encoder, which can make a 3-encoder import block searches for ~3s. Doesn't touch the feed manifest/delta path itself.)
- **A persisted monotonic version counter**, if `get_changes_since(version)` is ever revisited — see the rejected-alternative note below for why it was rejected the first time, and what would have to change to make it viable.
- No plan currently exists to patch filtered manifests directly; the tag-membership-unknown-client-side constraint would need the delta row to carry tag ids (defeating the "compact" design goal) or a client-side tag-membership cache to check against.

## Durable Notes / Discarded Approaches

- **`get_changes_since(version)` was considered and rejected.** It needs a persisted monotonic version source — either a schema migration to add a version column/table, or an in-memory counter that's restart-fragile (a relaunch mid-index would have no way to resume from "where the client last saw"). The chosen design (batched events + `Phase::Ready` reconciliation) gets losslessness for free: the event stream is best-effort and cheap, and the terminal reconcile is the actual correctness guarantee, not the events themselves. This is why the reconciliation section above is not an afterthought — it's the half of the protocol that makes the other half safe to be lossy.
- **The rejected "incremental shuffle" idea (#4 in the perf roadmap) partially survived.** The full idea (patch the shuffle order incrementally for every kind of mutation, not just delta-driven manifest growth) was rejected as over-general; what shipped is the narrower case that delta patches actually produce — a changed array reference under an unchanged seed — which `useShuffledFeed`'s incremental branch handles provably-identically to a full rebuild. The commit body for `012012c` calls this out explicitly as "the surviving half of the rejected #4."
- **Why the manifest carries no tags at all, rather than a lighter tag representation (e.g. tag ids only).** Even tag ids would require the `LEFT JOIN images_tags` that was the actual cost driver — the join, not the tag *names*, is what unrolled to 200-300k rows. A tags-as-ids version would still pay that cost. The manifest's answer is "no tag information travels with the grid at all"; tag membership is instead expressed by which *filtered* manifest query is active (the backend re-runs the `EXISTS`/`HAVING` predicate server-side), never by a client-side tag field on each row.
- **Deltas deliberately omit `manual_col_span`.** A delta only ever asserts "this image now has a thumbnail with these dimensions" — it has no opinion on layout. Carrying the field would tempt a future author into writing `manualColSpan: row.manual_col_span` on the merge path, which for a delta row is always absent/null and would clobber a user's persisted resize the next time that image happens to re-thumbnail (e.g. a same-path re-index). Making the type (`Omit<FeedManifestRowDTO, "manual_col_span">`) exclude the field turns that mistake into a compile error instead of a runtime data-loss bug.

## Obsolete / No Longer Relevant

- The pre-T3-1 full-catalogue `get_images_with_thumbnails` fetch (tags `LEFT JOIN`ed onto every row) is no longer the feed's read path. The command still exists wire-compatible for any caller that hasn't migrated (there are none left in the frontend — the `012012c` commit body notes the only surviving `["images"]`/`fetchImages` strings are two explanatory comments), but nothing in the feed/search/similar path calls it.
- The every-~5s full `["images"]` invalidate-and-refetch cycle during the thumbnail phase is dead, replaced entirely by the delta stream described above.
- The path→id resolution helper that search commands used before search went ID-native (see `multi-encoder-fusion.md` / `cosine-similarity.md`) is unrelated to this protocol but was removed in the same performance round; noted here only to avoid a future reader conflating the two ID-native migrations.

## Cross-references

- `systems/frontend-state.md` § the single `useIndexingStatus` module listener (why feed-delta and indexing-progress share one subscription)
- `systems/search-routing.md` § priority chain over `displayImages`, seed-then-upgrade selection, "a filter acts on what you can see"
- `systems/masonry-layout.md` § worker-side packing that consumes the ordered feed this protocol produces
- `systems/indexing.md` § the phase machine `feed-delta` and `indexing-progress` events are emitted from
- `systems/database.md` § `get_feed_manifest` / `get_image_details_by_ids` as DB-layer surfaces
- `notes/random-shuffle-as-feature.md` § the stable-key shuffle that orders the manifest this protocol delivers
