# Area 5 — Image loading and memory

Ideas 17–18. Grid DOM count is already low; the wins here are avoiding repeated thumbnail IPC and
controlling decode order/retention so big originals don't pile up in memory.

---

### 17. Cache adaptive thumbnail resolution by `(imageId, bucket)`  ·  S–M  ·  🟢 quick win

- **What:** Move larger-bucket resolution into a shared React Query / module cache with infinite
  stale time, in-flight dedup, and bounded entries. `useAdaptiveThumbnail` currently repeats
  `get_thumbnail` after a tile unmounts and remounts, resets to the base image, then swaps back
  (`useAdaptiveThumbnail.ts:46-74`). Seed known eager-bucket paths during catalogue hydration where
  possible.
- **Why:** A multi-column tile crossing the viewport can repeatedly incur IPC, DB lookup, state
  changes, and image-source swaps even though the generated file is immutable. After the first
  resolution this becomes a cache hit and avoids repeated base→sharp decodes.
- **Functionality preserved:** Same bucket ladder, no-upscale rule, fallback generation, crisp
  resized tiles.
- **Risk:** Root changes or thumbnail regeneration must invalidate affected cached paths.

---

### 18. Prioritise and predecode images deliberately  ·  S–M

- **What:** Mark selected/first-viewport images high priority, overscan low priority, the rest lazy.
  Set explicit intrinsic `width`/`height` or aspect ratio on grid images. For inspector and
  gesture-timer navigation, predecode the next 1–2 full-res images with `Image.decode()`, keeping a
  strict small LRU and releasing older references (`PinterestModal.tsx:112-121`,
  `GestureTimerView.tsx:169-188`).
- **Why:** Grid DOM count is low, but decode completion can land during scroll. Priority classes
  keep overscan decodes from competing with visible tiles. A two-image full-res cache makes
  modal/timer transitions instant without retaining dozens of huge originals.
- **Functionality preserved:** Every image stays full quality in inspection/timer mode, grid lazy
  loading remains; only decode order and retention are controlled.
- **Risk:** Predecoding very large images can spike memory. Cap by decoded byte estimate
  (`width × height × 4`), not just item count.
</content>
