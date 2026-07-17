# random-shuffle-as-feature

## Current Understanding

The grid order model changed again in the v2 UI overhaul (`b12ba46`) and stayed in this shape through the 100k performance round. **The four sort modes (`shuffle`/`name`/`added`/`custom`) are gone.** There is now exactly one feed ordering: always-shuffled, keyed by a **stable per-image sort key `hash(id, seed)`**, computed in `apps/lynceus/src/hooks/useShuffledFeed.ts`. This supersedes the Phase-9-era "default sort mode is `added`, shuffle is opt-in" model this note previously described — that model is documented below under Obsolete for the historical record, but nothing in the current app reads a `sortMode` preference; the field doesn't exist on `UserPreferences` anymore (`systems/frontend-state.md`).

Two pieces of randomness in the backend similarity code remain separate from this and still look like bugs but are intentional UX — largely superseded in practice by multi-encoder RRF fusion, but the mechanisms are still live in the codebase:

1. **Diversity-pool sampler in `get_similar_images`** picks random `top_n` from the top 20% pool, rather than returning the strict top-N (`cosine/index.rs::get_similar_images`).
2. **The 7-tier sampler in `get_tiered_similar_images`** picks 5 random images per tier from 7 deterministic tiers (0-5%, 5-10%, ..., 40-50%).

The `get_similar_images_sorted` companion exists for cases where ranking accuracy matters more than diversity. The split was made deliberately in commit `930f1fc` (2025-12-17). In the current app, `useTieredSimilarImages` and `useSemanticSearch` route through the fused (`get_fused_*`) commands rather than these tiered/diversity samplers directly — see `systems/multi-encoder-fusion.md` for how RRF across encoders now supplies the diversity these samplers were originally built to provide. The samplers themselves are unchanged and still load-bearing wherever a caller does use the single-encoder path.

## The stable-key shuffle (the v2 mechanism)

`useShuffledFeed(images, seed, sessionOrder)` (`apps/lynceus/src/hooks/useShuffledFeed.ts:76-191`) is now **the** ordering model for the main feed. Every image gets a deterministic key in `[0, 1)`:

```ts
function shuffleKey(id: number, seed: number): number {
  let h = Math.imul(id ^ seed, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae3d) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
```

A Murmur3-style integer finalizer over `id ^ seed`, mapped to `[0, 1)`. The load-bearing property: **an image's position depends only on its own id and the current seed — never on how many other images exist in the list.** This is the entire reason the mechanism was built this way. A plain Fisher-Yates shuffle over the whole array re-places *every* tile the moment the array's length changes; this key-based scheme leaves every existing tile's relative order untouched when a newcomer is inserted, because the newcomer's key is independent of everyone else's. The feed is additionally gated on `hasThumbnail` (a `Shuffleable` item needs `{ id, hasThumbnail }`) so nothing pops in blank before its thumbnail exists.

Ready images sort by `(shuffleKey(id, seed), id)` — the id tiebreak makes the ordering a strict total order (needed for the incremental-merge proof below, and for determinism when two keys collide, which at 32-bit hash width is rare but not impossible).

### Why this replaced the naive default-shuffle-plus-progressive-loading version

The commit body for `b12ba46` records that a naive "shuffle-as-default" was tried and removed earlier (2026-04-26, referenced in `useUserPreferences`' own prior comment) — shuffle-as-default plus progressive thumbnail loading made the whole grid visibly reshuffle on every background refetch, the "entire app refreshes" flicker. The stable-key fix is what made shuffle safe to be the *unconditional* default rather than an opt-in a user had to choose specifically to avoid that flicker.

### Seed re-roll discipline

`shuffleSeed` re-rolls only on a genuine feed **entry** — app launch (a lazy `newShuffleSeed()` initializer) or returning to the plain feed from a search/similar results view (`[...slug].tsx`'s `isResultsView` transition effect, documented in `systems/search-routing.md`). Indexing-progress refetches and feed-delta patches during an active index reuse the *same* seed, so the existing tiles' positions are provably unaffected by background catalogue growth — only a newcomer's own key determines where it drops in.

### The incremental fast path (T3-1, `012012c`)

Added when the compact manifest + feed-delta protocol landed (`systems/feed-protocol.md`). When only the underlying `images` array reference changes (a delta-patched manifest) while `seed` and `sessionOrder` stay the same, `useShuffledFeed` skips the full `O(N log N)` sort: it patches/removes over the previously-cached order (no existing id can have moved — its key is fixed for that seed) and merge-inserts newcomers at their `(key, id)` slot via one linear walk. This is provably identical to a full rebuild — the comparator is the same strict order the cached array already satisfies — and is why the mechanism is documented jointly here and in `systems/feed-protocol.md`: this note owns *why* the shuffle is stable-keyed at all; the protocol doc owns *how* that stability is exploited for incremental updates during indexing.

### In-session drag reorder rides on top, not instead of

`sessionOrder` (an explicit id ordering from drag-to-reorder) is a **nudge over** the shuffle, not a replacement sort mode — there is no `"custom"` mode anymore. When present, `useShuffledFeed` ranks listed ids by their manual rank and appends any unlisted newcomer by its shuffle key so it still pops in somewhere stable. `sessionOrder` is never persisted (`set_manual_order` and its backend column-write path were removed in the v2 overhaul — `manual_col_span`, the *size* half of manual layout, is the one thing that still persists per-image) and is cleared the moment the seed re-rolls or reorder becomes unavailable (any filter, similar, or search view active — see `systems/search-routing.md`'s `reorderEnabled` gate).

## Why the in-cosine randomness is still a feature

### Diversity-pool sampler

`get_similar_images` does **not** return the strict top-N. It sorts by cosine, takes a pool of `max(top_n, 20% of total)`, then randomly samples `top_n` from that pool.

The reasoning is UX. The strict top-N for visual similarity often produces a result list dominated by near-duplicates (a sequence of slightly cropped versions of the same image, or a series from the same shoot). Sampling within the top 20% guarantees the user sees images that are *actually* similar without seeing them in monotonously decreasing similarity order.

### Tiered sampler within-tier randomness

The 7-tier sampler is the most product-thoughtful piece of the single-encoder codebase. Per `systems/cosine-similarity.md`:

- Tiers are deterministic: 0-5%, 5-10%, 10-15%, 15-20%, 20-30%, 30-40%, 40-50%.
- Within each tier, 5 images are selected at random.
- A `HashSet<usize>` of used indices ensures no duplicates between tiers.

The within-tier randomness keeps the result feed fresh on repeated views; the tier definition keeps the visual coherence. Multi-encoder RRF fusion (the path `useTieredSimilarImages` actually calls today) achieves a related goal — natural diversity from encoder disagreement — through a different mechanism; see `systems/multi-encoder-fusion.md` for how the two relate and whether the tiered sampler is still reachable from the frontend.

## Guiding Principles

- **Do not reintroduce a user-facing sort-mode toggle** without re-deriving the stable-key discipline for it. Any future "sort by name" or "sort by date added" option would need its own stability story (what happens to an in-flight tile's position when a newcomer arrives) or it will reintroduce the pre-`b12ba46` reshuffle flicker in a new form.
- **Do not "fix" the diversity-pool sampler** in `get_similar_images`. A future refactor that returns the strict top-N because "the most similar should come first" would regress the near-duplicate problem.
- **Do not collapse the tiered sampler into a top-K.** The tier structure is load-bearing UX for any caller still using the single-encoder path.
- **Do not weaken the `(shuffleKey, id)` tiebreak to `shuffleKey` alone.** The id tiebreak is what makes the order a strict total order — needed both for determinism on a rare key collision and for the incremental-merge proof in `useShuffledFeed` to hold (the merge assumes a consistent, comparable ordering between the cached array and any newcomer).
- **Tag mutations and individual image inspections preserve order** via the optimistic update pattern (`systems/frontend-state.md`) — a tag change does not re-shuffle the grid mid-edit, and neither does a feed-delta patch during indexing.
- **`get_similar_images_sorted` is the escape hatch** — when ranking-accuracy matters more than diversity, use the sorted method. Don't try to make the diversity sampler do both jobs.

## What was tried

- Pre-Phase-9: backend shuffled on every read. Caused the "entire app refreshes" UX during indexing. Fixed by moving sort to the frontend with explicit user choice (four sort modes, default `"added"`).
- 2026-04-26: naive shuffle-as-default (no stable key) was tried and removed — combined with progressive thumbnail loading it reshuffled the whole grid on every background refetch.
- `b12ba46` (v2 UI overhaul): the stable per-image key `hash(id, seed)` replaced both the multi-sort-mode model and the failed naive-shuffle-as-default attempt in one move — a single mechanism that is simultaneously the only ordering and immune to the reshuffle-on-refetch flicker, because a tile's position is a pure function of its own id.
- `012012c` (100k perf round): the incremental merge-insert fast path was added on top of the same key scheme once the feed-delta protocol needed to patch the manifest without paying a full re-sort on every ~5s batch.
- The `get_similar_images_sorted` companion was added because semantic search needs deterministic ranking; the diversity sampler is wrong for that use case. Unaffected by the v2 changes above.

## Trigger to revisit

- A user-facing sort-mode toggle is requested again (e.g. "sort by date added" as an explicit option) — would need its own stability discipline layered on top of, not instead of, the shuffle-key model, or the reshuffle flicker returns.
- The grid grows large enough that shuffle is expensive. At 100k images the full-rebuild path is still a single `O(N log N)` sort in a Web Worker-adjacent context (masonry packing is off-thread; the shuffle sort itself currently is not — worth watching at larger scale), and the incremental path already avoids the full sort for the common indexing-time case.
- Saved-collection or board features ship — at that point order would need to be persistent within a board, and the global shuffle would need to coexist with per-board ordering, similar to how `sessionOrder` already coexists with it as a nudge today.

## Cross-references

- `systems/feed-protocol.md` § the incremental fast path and the delta-driven manifest changes this shuffle key is designed to absorb without a full re-sort
- `systems/cosine-similarity.md` § Three retrieval modes (the single-encoder diversity/tiered samplers)
- `systems/multi-encoder-fusion.md` § how RRF fusion relates to and largely supersedes the tiered sampler's diversity goal for the frontend's actual call path
- `systems/database.md` § Stable grid order
- `systems/frontend-state.md` § `UserPreferences` (no `sortMode` field), the retired `SortSection`
- `systems/search-routing.md` § shuffle seed re-roll discipline, `sessionOrder` drag-reorder nudge
