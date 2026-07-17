# Performance roadmap — buttery-smooth at 100k images (verified edition)

The original 20-idea survey (gpt-5.6-sol advisory, 2026-07-15) has been **adversarially verified
against the code** on 2026-07-17: four parallel read-only agents (feed/layout, similarity/caches,
indexing/DB, render/memory/startup) traced every claim to `file:line`, and the kill-driving
citations were independently re-checked in the main session. This folder now contains only what
survived. Everything cut is recorded in [`rejected.md`](./rejected.md) with its refuting evidence —
**read that before proposing anything new**, because most "obvious" additions were already
evaluated and killed for cause.

The hard constraints are unchanged: **no functionality removed, no visible behaviour degraded,
search stays exact full-corpus** (no ANN — missed neighbours change results). Scale target:
100,000 images.

## What verification actually changed

| | Original plan | After verification |
|---|---|---|
| Work items | 20 ideas across 6 areas | **12 items in 3 tiers** (7 ideas killed or absorbed) |
| Wrongest claim | "CLIP has a real batched ONNX path" (#12) | FALSE — no encoder batches today; CLIP *can't* without a provenance-touching re-export |
| Understated cost | ~4,000 progress events/run (#13) | ~9,000 events/run, each forcing a full images-table scan |
| Missed finding | — | The primary cosine cache is warmed at startup then sits **idle** (live UI only calls fused commands) — ~205 MB pure waste at 100k |
| Missed finding | — | The scroll listener isn't even rAF-coalesced — ~80% of #1's win is trivial |
| Missed finding | — | `useIndexingStatus` holds per-event `message` state inside the route's fiber + registers 2–3 duplicate Tauri listeners → the render storm is worse than the plan says |
| Web instincts killed | — | #19 lazy-loading (disk-loaded JS, lazy JSC compile — net negative), #18's byte-capped LRU |

## The two failures that actually matter at 100k

Everything else is polish around these:

1. **Catalogue amplification (frontend)** — every feed refresh re-materialises, re-shuffles, and
   re-packs the whole library; during indexing this repeats every ~5s. At 100k that's a **~1–4s
   stall every 5 seconds** — the app is effectively unusable while indexing. Fixed by **T3-1
   (compact manifest + deltas)**.
2. **Embedding-cache waste (backend)** — ~819 MB of raw f32 across three encoders **plus** a
   ~205 MB duplicate primary cache the UI never queries, held as 400k separate allocations, all
   rebuilt from the DB on every launch. Fixed by the **T3-2 chain (ID-native search → flat
   mmap-able store)**.

## The plan

**Tier 1 — free wins.** Six S-sized, low-risk items: the pill smoothness fix, the reverse tag
index (one line), rAF-coalesced scroll + guard band, cached cosine norms, the adaptive-thumbnail
cache, and modal/timer predecode-next. → [`tier-1-quick-wins.md`](./tier-1-quick-wins.md)

**Tier 2 — contained mid-effort.** Three items: make the tile memo hold during indexing
(#15+#16-B merged, the *lighter* fix — not an external store), batch the scan-phase inserts, and
the SigLIP-2/DINOv2 `encode_batch` override (honest expectation: ~1.2–2× on CPU, not "32→1").
Plus one deferred tail: semantic-search cancellation. → [`tier-2-mid-effort.md`](./tier-2-mid-effort.md)

**Tier 3 — the two architectural builds (+ one follow-on).** The compact manifest + delta
protocol; the ID-native → flat-unified-mmap embedding store chain; then the Web Worker pack.
Each wants its own plan file when picked up. → [`tier-3-architectural.md`](./tier-3-architectural.md)

## Superset map — why 20 became 12

```
T3-1 manifest+delta  ──subsumes──▶  #4 (recurring shuffle rebuild)
                     ──subsumes──▶  #14's query-split half
                     ──removes trigger for──▶  most of #16-B's churn, #3's recurring packs

T3-3 worker pack     ──absorbs──▶  #5 (drag-swap repack: off-thread + id→index map)
                     ──absorbs──▶  #4's one-time sort (radix in worker)

T3-2 ID-native (#6)  ──kills the expensive half of──▶  #9 (prefetch burst = 20-30 catalogue joins)
     flat store (#8+#20, one unit)  ──absorbs──▶  #7's norms (stored in the flat header)

T2-1 tile-memo fix   =  #15 (callback stability) + #16-B (identity stability), one work item
#10 cancellation     ◀──hosts──  #9's only surviving sliver (a cancel guard)
```

## Recommended sequence

```
Now (any order, afternoon-sized each) →  T1-1 pill fix · T1-2 tag index · T1-3 rAF scroll
                                         T1-4 cosine norms · T1-5 thumb cache · T1-6 predecode
Next (contained)                      →  T2-1 tile-memo fix · T2-2 scan batching · T2-3 encoder batch
Then (each gets its own plan)         →  T3-1 manifest + deltas   (the frontend unlock)
                                      →  T3-2 ID-native → flat mmap store   (the backend unlock)
                                      →  T3-3 worker pack   (after T3-1; absorbs drag-swap cost)
Only if it still hurts after all that →  #10 cancellation (tier-2 tail)
```

Dependency notes: T3-2's internal order is fixed (#6 first — it makes the flat file path-free —
then #8+#20 together; T1-4's norms fold into the flat header when it lands). T3-3 sequences after
T3-1 because deltas remove the every-5s repack that makes packing hurt today; what remains for the
worker is launch/resize packs, memory (~15–25 MB → ~3 MB), and drag-swap smoothness.

## Verification provenance

- Four read-only verification reports, 2026-07-17, all claims at `file:line` against commit
  `243bbda`'s tree; main session independently re-checked every kill-driving citation
  (encoder batch loop, missing tag_id index, per-candidate norms, dual cache warm, prefetch loop,
  static imports, un-coalesced scroll, non-memoised route handlers).
- Stale references in the original survey corrected along the way (e.g. it cited
  `useMasonryEngine.ts:245-255` in a 227-line file; the filter lives at `:214-224`).
- Already-landed work this folder must not re-propose: masonry gesture rewrite (`889b765`),
  rayon cosine + RwLock + startup warm (`f48241e`), visible-tile prefetch (`46fb75c`), per-image
  progress cadence (`55655a7`), eager thumbnail buckets (`aa7e093`), `content-visibility`
  tried-and-removed (do not reintroduce).
