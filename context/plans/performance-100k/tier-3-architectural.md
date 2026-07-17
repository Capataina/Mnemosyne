# Tier 3 — the architectural builds

Two independent unlocks (one frontend, one backend) plus one follow-on. These are the items that
turn "works at 2k" into "works at 100k"; everything in Tiers 1–2 is polish around them. **Each
gets its own dedicated plan file when picked up** — what follows is the verified scope and shape,
not an implementation plan.

---

## T3-1 · Compact catalogue manifest + delta protocol  — #2, the frontend unlock

**The failure it fixes (all claims verified):** `get_images` routes to
`get_images_with_thumbnails` (`commands/images.rs:39`) — a whole-library
`LEFT JOIN images_tags LEFT JOIN tags` unrolling to 200–300k rows at 100k, HashMap-aggregated,
materialised, sorted, serialised over IPC (`images_query.rs:278-473`). The frontend then converts
two paths per row to URLs (`services/images.ts:42,49`), allocates 100k `ImageItem`s, runs the
shuffle's filter→map→sort→map (~1.7M comparisons, `useShuffledFeed.ts:70-73`), and packs all N.
During the thumbnail phase, `useIndexingStatus.ts:149-154` invalidates `["images"]` every ~5s —
**the whole cycle repeats every 5 seconds**. Order-of-magnitude at 100k: **~1–4s of combined
work per cycle → the app is effectively unusable while indexing a large library.** This is the
dominant scaling failure in the entire roadmap.

**Shape of the fix:**
1. A **compact layout manifest** — `id, w, h, span, hasThumbnail, orderingKey` for all N (masonry
   packing is prefix-dependent, so the manifest must still cover all N — but at ~5–10× lighter
   per record than today's row: no tags array, no path strings, no tags JOIN).
2. **Normalised detail records** hydrated only for visible/selected ids (store entities once by
   id; filtered query keys hold id lists — today `useImages.ts:35` caches a duplicate full
   `ImageItem[]` per filter combination).
3. A **versioned delta protocol** — `get_image_changes_since(version)` or batched events — so the
   every-5s churn becomes tens of records instead of the full catalogue. **The delta half alone
   removes the worst 100k pain.**

**The load-bearing risk (verified, not hypothetical):** naive pagination breaks the product.
Packing is prefix-dependent (`masonryPacking.ts:145-156`) and shuffle order is global — pages
treated as independent grids change tile positions and scrollbar behaviour. Stream the manifest;
never paginate the grid.

**What it subsumes (do not build separately):** #4's recurring-shuffle half (deltas make
newcomers pure insertions into the existing order — the stable `hash(id, seed)` key already
guarantees insertion-stability); #14's query-split half (the manifest reshapes the grid query);
and it removes the churn trigger that makes T2-1's comparator work hardest.

**Effort:** genuinely L — touches DB query, a new versioned-changes command, IPC, the react-query
entity model, shuffle, and pack. Wants its own plan file, a dedicated session, and the feed left
stable for a while after (it only just became correct and smooth).

---

## T3-2 · ID-native search → flat unified mmap-able embedding store  — #6 then #8+#20, one chain

**The failures it fixes (all claims verified):**

- **Per-request:** every fused similarity/semantic request starts with `db.get_all_images()` —
  the whole-library join — before scoring a single vector (`similarity.rs:164`,
  `semantic_fused.rs:114` → `images_query.rs:197`), then does per-result
  `get_image_thumbnail_info` + path→id resolution (N+1: `similarity.rs:244-251`,
  `semantic_fused.rs:181-189`). The index stores `(PathBuf, Array1<f32>)` (`cosine/index.rs:11`),
  RRF aggregates by `PathBuf` (`rrf.rs:117`), and ids are re-derived from paths that were ids to
  begin with. **This join is the single largest fixed per-request cost — heavier than the warm
  cosine scan itself — and the visible-tile prefetch fires it 20–30× per settled viewport.**
- **Resident memory:** raw f32 at 100k = 204.8 MB (CLIP) + 307.2 MB × 2 (DINOv2, SigLIP-2)
  ≈ **819 MB**, PLUS a ~205 MB duplicate: `spawn_cache_warm` populates both the primary
  `CosineIndexState` (active encoder) AND that same encoder's fusion slot
  (`lib.rs:328` + `:339-344`). **Verification's sharpest finding: the live UI only calls the
  FUSED commands** (`useTieredSimilarImages`/`useSemanticSearch` → fused fetchers), so the primary
  copy is warmed and then sits idle. ≈ **1.02 GB total, of which ~235 MB is pure waste**, held as
  ~400k separate `PathBuf`/`Array1` allocations with the same 100k paths stored 4×.
- **Per-launch:** fusion slots have NO disk persistence — all three encoders rebuild from the DB
  on every launch (`lib.rs:343`); the primary's bincode snapshot
  (`Vec<(String,Vec<f32>)>`, `cache.rs:25-30`) deserialises into fresh per-row allocations anyway,
  and its freshness check is a bare mtime comparison (`cache.rs:77`).

**Shape of the fix, in fixed order:**
1. **#6 — ID-native entries** through cosine + RRF; batch-hydrate paths/thumbnails once via
   `WHERE id IN (...)`. Ranking-neutral (ids are the join key). Kills the per-request join AND
   makes the prefetch burst cheap (its cost was 20–30 joins, not the warm scans — which is why
   the old #9 died). Also the natural provider for T3-1's hydration model.
2. **#8+#20 together — one flat store per encoder** (contiguous row-major `Vec<f32>` + parallel
   id/offset/norm arrays), mmap-persisted with a versioned header (schema version, encoder
   id/dim, row count, embedding-generation token — the bare-mtime check is not survivable at this
   size). Primary commands borrow the fusion slot; the duplicate dies. Launch warm becomes "map
   3 files, page on demand". T1-4's cached norms migrate into the header.

**Risk:** chunked-SIMD/BLAS reductions reorder FP adds → near-tie score shifts; keep the
deterministic id tie-break and extend the existing ranking-equivalence diagnostics
(`cosine/index.rs:617` pattern). The invalidation header must land in the same change as the
mmap — a weak header silently serves wrong-dimension vectors after an encoder change.

**Effort:** #6 is M; the flat store is L. The chain is strictly ordered — the flat file format
becomes path-free (ids only) if #6 lands first, which is materially simpler.

---

## T3-3 · Web Worker pack + typed-array geometry  — #3, sequenced after T3-1

**What (verified shape):** `computeMasonryLayout` is pure and ports cleanly (plain inputs → plain
outputs, no DOM; the one obstacle is that each placement carries an `itemData: ImageItem` ref —
the worker returns index-keyed typed-array geometry and the main thread reattaches `itemData`
for the visible range only). Generation-tag requests, discard stale results, preserve scroll
anchor when final height arrives.

**Why after T3-1:** today the full pack (~50–100ms at 100k, dominated by ~100k placement-object
allocations + a 100k-entry Map — `masonryPacking.ts:105-106`, `useMasonryEngine.ts:119`) hurts
because it re-runs every 5s during indexing. T3-1's deltas remove that recurrence, so the worker's
remaining value is: launch/filter/resize packs off the main thread, **memory ~15–25 MB → ~3 MB**,
and — the part that matters for feel — **drag hover-swaps stop packing on the main thread**.

**What it absorbs (do not build separately):**
- **#5's drag-swap cost:** each new hover target currently does 2× O(N) `findIndex` + O(N)
  slice/splice (`useTileDrag.ts:114-120`) + a full engine repack (`Masonry.tsx:94`) — ~10 swaps
  in a drag ≈ ~100–200ms of jank each at 100k. The worker moves the repack off-thread; an
  id→index `Map` makes the lookups O(1); the remaining main-thread cost per swap is a few ms.
  The original #5's bespoke async-suffix/local-preview machinery is rejected (see `rejected.md`).
- **#4's one-time sort:** radix-sort the 32-bit shuffle keys in the same worker if profiling
  shows the launch sort matters (~30–100ms today, once).

**Completion criterion for the old #1:** if scroll still shows filter cost after T1-3's
rAF+guard band, the per-column binary-search range index lives naturally on this worker's typed
arrays (per-column `bottom` is monotonic — verified, the packer appends downward). Measure first.
