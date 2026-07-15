# Area 1 — Feed, virtualisation, and layout

Ideas 1–5. The feed/masonry hot path. Note the DOM virtualisation itself is sound (only visible
placements mount), and `content-visibility` was correctly removed after it caused disappearing
tiles — do not reintroduce it. The gesture freeze is already fixed (`889b765`); what remains is
the O(N) scroll filter, the full-catalogue refetch, and moving packing off the main thread.

---

### 1. Replace the O(N) scroll filter with a placement range index  ·  M  ·  ✅ verified

- **What:** During packing, build a monotonically ordered placement index per column. On viewport
  changes, binary-search each column for the first placement whose bottom intersects the overscan
  range, then merge/dedupe the small visible set. Coalesce scroll events with one rAF, and refresh
  only when the viewport leaves an inner guard band rather than on every pixel. Touches
  `hooks/useMasonryEngine.ts:163-228` and `components/masonryPacking.ts:127-160`.
- **Why:** `placements.filter(...)` at `useMasonryEngine.ts:245-255` inspects all 100k placements on
  every scroll state update. A column index → ~`O(columns × log N + visible)`, tens instead of
  100,000 checks (3–4 orders of magnitude).
- **Functionality preserved:** Same tiles, overscan, selected hero, active drag tile render; only
  the lookup changes.
- **Risk:** Multi-column and very tall tiles must be indexed in every occupied column and deduped.
  Equivalence-test indexed vs full-filter across random layouts and viewport ranges.
- **Verification:** ✅ Confirmed — `visiblePlacements = useMemo(() => placements.filter(...), [placements, viewport.top, viewport.bottom, dragItemId])` runs over the whole array on every viewport change. This is the top quick-win for scroll jank at scale.

---

### 2. Introduce a compact catalogue manifest and delta protocol  ·  L  ·  ✅ verified  ·  THE architectural unlock

- **What:** Split feed data into (1) a streamed layout manifest — `id`, aspect/dimensions,
  thumbnail availability/path, manual span, stable ordering key; (2) normalised per-image detail
  records hydrated only for visible/selected IDs; (3) versioned deltas for newly-thumbnailed or
  mutated images. Replace broad invalidations at `useIndexingStatus.ts:149-160` and
  `useImages.ts` with `get_image_changes_since(version)` or batched Tauri events. Store entities
  once by ID; filtered query keys hold ID lists, not duplicate full `ImageItem[]` catalogues.
- **Why:** `get_images` returns every visible row with paths+tags, serialises the full vector
  through Tauri, converts two paths per row to URLs, then an O(N log N) shuffle + full pack
  (`services/images.ts:28-57`, `useShuffledFeed.ts:49-74`). During thumbnailing this repeats every
  5s. A compact initial chunk gives first paint while the manifest streams; later changes are tens
  of records, not 100k.
- **Functionality preserved:** Full library, exact filters, shuffle, arbitrary scrolling, tags,
  notes, full-res inspection all remain; details fetched ahead of selection via visible/hover
  hydration.
- **Risk:** Naïve pagination would alter global masonry order and scrollbar behaviour. Preserve by
  streaming the layout manifest, NOT by treating each page as an independent grid.
- **Verification:** ✅ Confirmed. This is the "catalogue amplification" fix — the single highest-
  value architectural change, but L-effort and it touches feed + filtering + shuffle + IPC
  together, so it wants its own plan file and careful build, not a squeeze into a polish round.

---

### 3. Move full packing off the UI thread and store geometry in typed arrays  ·  L

- **What:** Run `computeMasonryLayout` in a Web Worker using transferable typed arrays for indices,
  `x/y/width/height`, spans, flags. Materialise React placement objects only for the visible range.
  Compute a small deterministic prefix immediately for first paint, then let the worker finish the
  exact full layout. Use `ResizeObserver` rather than only a debounced window listener
  (`useMasonryEngine.ts:174-183`).
- **Why:** A structural change creates 100k placement objects, a 100k-entry `Map`, and React state
  holding the whole array. Typed geometry is a few MB vs tens of MB of JS objects, and it removes
  layout allocation + packing pauses from the main thread.
- **Functionality preserved:** Packing rules, manual spans, hero placement, scroll height, drag
  lookup, resize all bit-for-bit from the same algorithm.
- **Risk:** Worker results can arrive out of order under rapid filter/resize. Tag each request with
  a generation, discard stale ones, preserve scroll anchoring when the final height arrives.

---

### 4. Make shuffle incremental and allocation-light  ·  M

- **What:** Return the 32-bit hash directly rather than converting to float, radix-sort indices in
  the layout worker, and merge newly-indexed IDs into the existing ordered index instead of
  rebuilding `filter → map → sort → map`. Touches `useShuffledFeed.ts:20-27,49-74`.
- **Why:** A 100k shuffle is ~1.7M comparison-sort decisions plus three large intermediate arrays.
  Incremental indexing adds a small `K`; merging is `O(N + K)` and can run off-thread.
- **Functionality preserved:** Same seed-based stable shuffle, in-session ordering, and
  "new tiles pop in without moving existing tiles" contract.
- **Risk:** Integer-key collisions need the existing ID tie-breaker; the worker must reproduce the
  signed/unsigned hash semantics exactly.

---

### 5. Keep discrete drag/reorder previews local  ·  L  ·  partially done

- **What:** Extend the in-flight gesture fix so a hover swap does not immediately clone and repack
  the entire 100k order. `useTileDrag` currently does a full `slice/splice` then the engine repacks
  everything. Reflow only the visible interaction window synchronously; compute the exact complete
  suffix in the worker and commit on drop/when ready.
- **Why:** The pointer-frame problem is fixed (`889b765`), but crossing each tile can still trigger
  an O(100k) clone, map rebuild, and cascading repack. Immediate work should fall to ~visible 20–40.
- **Functionality preserved:** Same drag target, visible reflow, final ordering, drop result; only
  invisible-suffix calculation becomes async.
- **Risk:** Masonry placement is prefix-dependent. The local preview is temporary, so the active
  tile must be rebased carefully when exact worker geometry replaces it.
- **Note:** The *per-frame* half of this is already solved by the imperative rAF gesture rewrite.
  This is the remaining *discrete-swap* half.
</content>
