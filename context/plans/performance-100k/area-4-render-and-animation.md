# Area 4 — React render path and animation

Ideas 15–16. The grid's existing `memo(MasonryItem)`, active-tile imperative wrapper, and DOM
hit-testing (all from `889b765`) are good foundations. The remaining issues are upstream identity
churn and duplicated animation ownership — not a missing blanket `memo`.

---

### 15. Centralise indexing state and subscribe by selector  ·  M  ·  ✅ verified  ·  the sequel to the masonry fix

- **What:** Replace each independent `useIndexingStatus()` invocation with one external
  store/provider backed by a single Tauri listener + React Query observer (consumers today: the
  page, the pill, the settings stats). Let `Home` subscribe only to `{isIndexing, total_images,
  orphaned}` while the pill subscribes to progress. Extract/memoise the masonry subtree and
  stabilise `handleImageClick`, `handleReorder`, `handleResizeCommit` (`[...slug].tsx` ~407-415,
  468-485, and the SearchBar/Masonry mounts).
- **Why:** Progress invalidations produce new stats objects that re-render the entire ~870-line
  route; its inline callbacks then defeat shallow memoisation for visible tiles. With selector
  subscriptions, encoder progress updates the pill without touching the grid — removing hundreds to
  thousands of unrelated route/grid renders during a large index.
- **Functionality preserved:** Every progress surface, shortcut, drawer, modal, and masonry
  interaction stays reactive.
- **Risk:** Selector equality must cover the exact fields each consumer needs; stale selectors would
  hide valid state changes.
- **Verification:** ✅ Confirmed — `handleImageClick`/`handleReorder`/`handleResizeCommit` are plain
  `const … = () => {}` (NOT `useCallback`'d), recreated every render; only `prefetchSimilar` is
  memoised. The route re-renders on every 1500ms `pipelineStats` poll (and every progress event)
  during indexing. Masonry isn't memo'd, and its internal `handleItemClick` useCallback depends on
  the unstable `props.onItemClick`, so `MasonryItem`'s `onClick` prop changes every render → the
  memo the masonry fix relies on breaks for all visible tiles during indexing. This is the direct
  follow-on to `889b765`: that fix stabilised the drag/resize *handle* callbacks (from the hooks)
  but NOT these route-level ones.

---

### 16. Give placement animation one owner and strengthen tile identity  ·  M

- **What:** The anchor already animates position via CSS transforms (`MasonryAnchor.tsx:17-31`)
  while the child also runs Framer Motion `layout` measurement (`MasonryItem.tsx` motion.div).
  Choose one engine — preferably a transform-only motion anchor with `layout="position"` or
  equivalent — and remove duplicate layout measurement. Key anchors by stable ID rather than
  `${id}-${url}` (`Masonry.tsx` map key). Add a `MasonryItem` comparator covering the scalar fields
  that affect pixels, rather than relying entirely on object identity.
- **Why:** Each structural commit risks both CSS transition work and Framer layout reads/writes for
  every visible tile. Stable keys avoid remounts when the URL representation changes; a semantic
  comparator prevents full-catalogue refetch object churn from re-rendering unchanged visible tiles.
- **Functionality preserved:** Same spring/reflow, pop-in, drag opacity, resize affordances, final
  positions.
- **Risk:** Framer Motion and CSS have different spring curves. Capture current animation and
  compare before/after timing, not merely final geometry.
- **Note:** interacts with the `889b765` design — the imperative wrapper deliberately sits OUTSIDE
  motion.div so the two don't fight over the transform. Any change here must preserve that
  separation (the active tile's continuous transform vs the inner tile's `layout` reflow).
</content>
