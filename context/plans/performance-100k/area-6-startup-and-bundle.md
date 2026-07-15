# Area 6 — Startup and bundle

Ideas 19–20. First-paint and launch cost. #19 is an easy quick win; #20 is the startup half of the
flat-shared-cache architecture (#8).

---

### 19. Lazy-load non-critical surfaces  ·  S–M  ·  🟢 quick win

- **What:** Dynamically import `SettingsDrawer`, `PinterestModal` + gesture timer, and `PerfOverlay`;
  prefetch settings on gear hover/focus and the inspector on tile hover. Adopt Framer Motion's lazy
  feature loading where layout support permits. These are statically imported into the route today
  (`[...slug].tsx:22-25`).
- **Why:** The build has a ~317 KB main JS chunk + ~291 KB route chunk (measured this session:
  `index-*.js` 324.86 KB / `_...slug_-*.js` ~301 KB). Settings, profiling UI, tag editing, and
  gesture-timer code aren't needed for first feed paint. Splitting them removes tens of KB of
  parse/compile from the critical route; idle prefetch keeps first use instant.
- **Functionality preserved:** Every surface + animation stays available; its chunk is prefetched
  before likely interaction and loaded on demand as a fallback.
- **Risk:** A cold keyboard shortcut could briefly await the chunk. Prefetch after first paint and
  on shortcut keydown before opening.

---

### 20. Replace eager cache reconstruction with shared mapped cache files  ·  L

- **What:** Persist one versioned flat cache file per encoder containing IDs, offsets, norms, and
  contiguous `f32` embeddings. Memory-map them at startup; let both legacy and fusion paths share
  them. `spawn_cache_warm` currently populates the primary index and all fusion indices separately
  (`src-tauri/src/lib.rs:330-347,398-409`), competing with feed loading and indexing.
- **Why:** Mapping avoids rebuilding hundreds of thousands of `PathBuf`/`Array1` allocations and the
  extra primary copy. The OS can page cold regions out while background read-ahead warms them —
  less launch CPU, allocator pressure, idle resident memory.
- **Functionality preserved:** Startup cache warming, instant similarity availability, every
  encoder, exact vectors all remain; the representation and ownership change.
- **Risk:** Cache invalidation must be stronger than a coarse DB mtime. Store schema version,
  encoder ID/dimension, row count, and an embedding-generation/version token in each header.
- **Note:** the natural pairing for #8 (flat unified embedding caches) — #8 is the in-memory layout,
  #20 is its persistence + startup story. Do them together.
</content>
