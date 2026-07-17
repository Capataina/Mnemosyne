# Tier 1 — free wins (S-effort, low risk, ship in any order)

Six items. Each is verified against the code, self-contained, behaviour-preserving, and small
enough for a single focused session. None depends on any other.

---

## T1-1 · Indexing-pill smoothness fix (the parked spec)  — was #13's frontend half

- **What:** During an ACTIVE run, the pill's fraction reads the latest `indexing-progress` event's
  `processed/total` (the smooth per-image climb); at idle/terminal it falls back to the
  `pipelineStats` snapshot so `Phase::Ready` stays the authority for "reaches 100% and clears".
  Files: `useIndexingStatus.ts` (expose an event-derived fraction), `IndexingStatusPill.tsx` (read it).
- **Why:** The pill currently reads only the DB snapshot, so encode progress steps per-batch while
  the event stream already carries a monotonic per-image climb (`55655a7` added the mutex
  high-water emit + guaranteed terminal — which is exactly what makes this safe now).
- **Evidence:** event payload already carries per-image `processed/total`; pill reads snapshot only.
- **Risk:** none identified — frontend-only, no DB change, no crash-drift surface.

## T1-2 · Reverse tag index  — was #14's index half

- **What:** `CREATE INDEX IF NOT EXISTS idx_images_tags_tag ON images_tags(tag_id, image_id)` in
  `Database::initialize()` (`crates/engine/src/db/mod.rs`, beside the existing two indexes at
  `:270/:288`). One line, idempotent, covering.
- **Why:** `images_tags` has only `PRIMARY KEY (image_id, tag_id)` (`db/mod.rs:233-241`) — no
  index leads with `tag_id`. But the include-filter subquery keys on `tag_id`
  (`images_query.rs:166-168`) and every tag count joins on `it.tag_id = t.id` (`tags.rs:81-84`).
  At 100k images × ~3 tags, each tag count is a ~300k-row scan today; the library drawer shows
  live counts for every folder, so dozens of those scans fire together.
- **Risk:** none — pure read-path acceleration, no semantic change.

## T1-3 · rAF-coalesce the scroll viewport + inner guard band  — was ~80% of #1

- **What:** In `useMasonryEngine.ts`: (a) wrap the scroll-driven `updateViewport` in a
  one-per-frame rAF gate; (b) add an inner guard band so the viewport state (and therefore the
  visible-set filter) only refreshes when scroll leaves a band (~half the overscan), not per pixel.
- **Why:** The scroll listener calls `updateViewport` directly with no coalescing
  (`useMasonryEngine.ts:209-211`), and every viewport change re-runs
  `placements.filter(...)` over ALL placements (`:214-224`). At 100k that's ~0.5–1 ms × up to
  60–120 events/sec ≈ **60–100 ms/s of main-thread time during a fling** — real scroll jank.
  The guard band cuts filters from per-pixel to roughly one per ~800 px scrolled; after that the
  full per-column binary-search index from the original #1 is marginal polish (recorded in
  `rejected.md` as deferred-until-measured).
- **Contract to preserve (equivalence-testable):** the two force-kept escape hatches — the
  selected hero and the actively-dragged tile always render (`:219`).
- **Risk:** low; the overscan already hides small refresh latencies.

## T1-4 · Cache cosine norms (query + corpus)  — was #7

- **What:** Store per-vector inverse norms alongside `cached_images` (populated in
  `populate_from_db*` / snapshot load); hoist the query's inverse norm once per request; score
  with `dot × q_inv × c_inv`. Zero API change.
- **Why:** `cosine_similarity` recomputes `a.dot(b)`, `a.dot(a).sqrt()`, `b.dot(b).sqrt()` per
  candidate (`cosine/math.rs:38-40`), and `score_all` calls it for every cached image
  (`cosine/index.rs:206-217`) — the query self-dot alone is recomputed 100k times per scan.
  At 100k × 768d × 3 encoders ≈ **~460M redundant multiplies + 200k redundant sqrt per fused
  request**. Wall-clock gain is modest (the rayon scan is memory-bandwidth-bound, not FLOP-bound)
  but the effort:reward ratio is the best in the backend.
- **Why cached norms and NOT assume-unit-norm:** embeddings are L2-normalised at encode time
  (`encoder.rs:252-255,309`, `pooling.rs:36-39`), BUT legacy CLIP rows from the pre-normalise
  pipeline (`images.embedding` fallback, `cosine/index.rs:64-78`; `schema_migrations.rs:73-74`
  documents the old no-normalise path) are not guaranteed unit-norm. Cached norms give the same
  win and stay exact for those rows. Do not "simplify" to bare dot products.
- **Risk:** FP order change can shift last-bit scores → tie reordering. Guard with the existing
  `parallel_scoring_matches_serial_reference` pattern (`cosine/index.rs:617`) at 1e-6 tolerance.
- **Lifecycle note:** when T3-2's flat store lands, these norms move into its header — this item
  is deliberately built to be absorbed.

## T1-5 · Adaptive-thumbnail resolution cache  — was #17

- **What:** Replace `useAdaptiveThumbnail`'s local `useState`/effect fetch with
  `useQuery({ queryKey: ["thumbnail", id, bucket], staleTime: Infinity })` (module-level cache,
  in-flight dedup for free). Invalidate the `["thumbnail"]` prefix on re-index/root change.
- **Why:** The hook re-initialises to the base 480 on every mount (`useAdaptiveThumbnail.ts:46`)
  and re-fires `get_thumbnail` IPC on every remount (`:48-74`) with a visible base→sharp swap.
  **This is wider than "resized tiles":** the bucket is chosen from `renderedWidth × dpr`
  (`:44`), so on a dpr-2 retina display any tile rendering >240 CSS px (most tiles, at
  `minItemWidth 236` + spans) hits the >480 bucket path on **every scroll-in**. The eager bucket
  pre-compute (`aa7e093`) means the file already exists — what the cache saves is the IPC
  round-trip + DB lookup + the visible reflash, multiplied by scroll churn all session.
- **Risk:** low; the only real one (regeneration invalidation) is handled by the prefix invalidate.

## T1-6 · Predecode the modal/timer neighbours  — was #18, trimmed to its useful core

- **What:** On inspector `selectedItem` change or gesture-timer index change, predecode the next
  (and previous, for the modal) full-res image via `new Image(); img.src = url; img.decode()`.
  Keep a strict 2-deep window — decode next+prev, drop older references. No formal LRU, no
  byte-capped cache, no grid `fetchpriority` (all rejected — see `rejected.md`).
- **Why:** Neither surface predecodes: `PinterestModal.tsx:115-121` and
  `GestureTimerView.tsx:175-189` mount a fresh eager `<img>` per navigation, so a 4000px+
  original decodes on-screen — tens of ms on M2, a visible skeleton pulse in the timer
  (`:170-172`) and a pop in the modal, on every next/prev. File I/O is local-disk instant; the
  decode is the whole gap. This is a constant per-navigation win, independent of library size.
- **Risk:** memory spike from predecoding huge originals — bounded by the 2-deep window, which is
  the proportionate control for a 1–2 image lookahead.
