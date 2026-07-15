# Performance roadmap — buttery-smooth at 100k images

A whole-stack performance survey of Lynceus produced by `gpt-5.6-sol` (advisory, read-only)
on 2026-07-15, reorganised and verified against the code by the session. The hard constraint
throughout: **no functionality is removed** — every idea keeps the feature and makes it fast.
Approximate-nearest-neighbour similarity (HNSW etc.) was explicitly rejected because missed
neighbours change which results the user sees.

The scale target is **100,000 images**. At a few thousand most of this is invisible — so the
frontend scroll/render wins (#1, #15, #17) and the indexing wins matter first, and the heavy
architectural items (#2, #3, #8, #20) can wait until real libraries approach the target.

## The framing insight — catalogue amplification

The dominant 100k cost is that the app loads, serialises, URL-converts, shuffles, and re-packs
the **entire** library on every feed refresh — and during indexing that repeats every ~5s
(`useIndexingStatus.ts` invalidates `["images"]`; `fetchImages` materialises all rows;
`useShuffledFeed` sorts all of them; the engine packs all of them). Almost every other idea is
a quick win *around* this; **idea #2 (compact manifest + delta protocol)** is the architectural
fix *for* it. Strategy: rack up the safe quick wins now, treat #2 as its own planned effort so
it doesn't destabilise the feed right after we got it correct and smooth.

## Highest-leverage wins (advisor's top 5)

| # | Change | Payoff | Effort | Verify |
|---|---|---|---|---|
| 1 | Range-index the scroll virtualiser (binary-search columns, not filter-all-N) | ~100k checks/scroll → visible-count | M | ✅ confirmed |
| 2 | Streamed compact manifest + delta updates instead of full `["images"]` refetch | kills the re-materialise/shuffle/pack cycle | L | ✅ confirmed |
| 3 | ID-native similarity results + batch-hydrate metadata | removes a full catalogue load + 30–50 SQL lookups/search | M | ⚠️ backend, plausible |
| 4 | Hoist cosine norms + contiguous shared per-encoder storage | ~3× less cosine arithmetic, ~200–300 MB less RAM | S–L | ⚠️ backend, plausible |
| 5 | Batch DB writes + real SigLIP/DINO batch inference + decode-once fan-out | orders-of-magnitude fewer transactions; faster indexing | M–L | ⚠️ backend, plausible |

## The menu by lane (full 20 ideas)

**🟢 Quick wins — safe, small, do-now (S, low risk):** #1 (range-indexed scroll, actually M but
top-bang), #7 (cosine norms once), #14 (reverse tag index + compact grid query), #17 (adaptive-
thumbnail resolution cache), #19 (lazy-load Settings/modal/timer chunks).

**🟡 Mid-effort — clear wins, some plumbing (M):** #15 (stable route callbacks + selector-based
indexing state → stop route/grid re-render storms during indexing), #10 (cancel stale semantic
searches end-to-end), #11 (batch scan/thumbnail DB writes), #13 (O(1) progress counters + the
pill-reads-event smoothness fix backend-smith already spec'd), #18 (prioritise/predecode images).

**🔴 Architectural — the real 100k unlock, plan carefully (L):** #2 (compact manifest + delta
protocol — the big one), #3 (packing in a Web Worker with typed-array geometry), #8/#20 (flat,
memory-mapped, shared embedding caches), #12 (decode-once fan-out across the three encoders),
#5/#9 (local drag-reorder previews + governed batch prefetch).

## Recommended sequence

```
Immediate, low-risk          →  #1 range-indexed viewport · #7 cached norms
                                #14 reverse tag index · #17 adaptive-thumbnail cache
Remove catalogue amplification → #2 compact manifest + deltas · #3 worker/typed geometry
                                #15 selector-based React subscriptions
Make exact similarity scale   →  #6 ID-native results · #8 shared contiguous caches
                                #9 governed batch prefetch · #10 cancellation
Accelerate background work    →  #11 batched DB writes · #12 true encoder batches + shared decode
                                #13 materialised progress counters · #19–#20 startup + mapped caches
```

Advisor's strongest first slice: **#1 + #7 + #6** (scroll, raw similarity arithmetic, search
metadata amplification) without the larger catalogue redesign. The architectural target after
that is **#2**, because repeated full-catalogue materialisation otherwise keeps resurfacing in
feed refresh, filtering, cache mutation, IPC, shuffle, and layout.

## What is already done (do not re-propose)

- **Masonry resize/drag freeze** — fixed 2026-07-15 (`889b765`): per-frame full re-pack removed;
  continuous motion is imperative rAF on the one active tile; re-pack only on discrete span/hover
  change. This closes the *per-frame* half of idea #5; the *invisible-suffix repack* half (#5's
  O(100k) clone per hover-swap) remains open.
- **Similarity at scale (partial)** — rayon-parallel cosine + startup cache-warm + hover/visible
  prefetch already landed (`f48241e`, `46fb75c`). Ideas #6/#7/#8/#9 extend this.
- **Indexing progress cadence** — per-image emit landed (`55655a7`); the pill still reads the DB
  snapshot so encode steps per-batch — idea #13's tail is the frontend fix, spec'd and parked
  with backend-smith.
- `content-visibility` was already tried and **correctly removed** (`App.css`) after it caused
  disappearing tiles — do not reintroduce it.

## Verification notes

Confirmed against code this session: #1 (`useMasonryEngine` filters all placements per viewport
change), #2 (full `get_images`→shuffle→pack cycle, re-invalidated every 5s), #15 (`handleImageClick`
/`handleReorder`/`handleResizeCommit` are NOT `useCallback`'d → recreated every render → defeat
`MasonryItem` memo, and the route re-renders on every 1500ms progress poll). Backend claims (#6,
#7, #8, #11–14, #20) are plausible standard optimisations cited with `file:line` but were not
line-verified — confirm before implementing. Full ideas live in the `area-*.md` siblings.
</content>
