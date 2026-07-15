# Area 3 — Indexing and database

Ideas 11–14. Backend (`src-tauri/src/indexing.rs`, `db/*`, `crates/engine`). #12's decode-once
fan-out is the one backend-smith flagged directly earlier and is available to own. #13's tail is
the pill-reads-event smoothness fix (frontend), already spec'd and parked.

**Verification note:** plausible standard optimisations cited with `file:line`, not line-verified
this session — confirm before implementing.

---

### 11. Batch scan insertion and thumbnail database writes  ·  M

- **What:** Stream discovered paths into a prepared transaction or temp scan table rather than
  cloning into two vectors and calling `add_image` once per path (`indexing.rs:345-390`,
  `notes_orphans.rs:85-101`). Route parallel thumbnail results through a single writer committing
  path/dimension updates in batches of 32–256 (`indexing.rs:484-518`).
- **Why:** A 100k first scan = ~100k autocommit inserts + up to 100k thumbnail update transactions.
  Batching by 256/32 → hundreds plus a few thousand commits (1–2 orders of magnitude fewer
  transactions and mutex acquisitions).
- **Functionality preserved:** Every file scanned, rooted, thumbnailed, orphan-restored, made
  visible exactly as before; the UI already refreshes thumbnails in multi-second groups.
- **Risk:** A failed transaction affects a whole batch. Record per-row failures and retry
  individually to preserve current partial-success behaviour.

---

### 12. Add true batch inference and a decode-once fan-out  ·  L  ·  backend-smith flagged this

- **What:** Override `ImageEncoder::encode_batch` for SigLIP-2 and DINOv2 — they inherit the
  trait's one-by-one fallback (`encoders.rs:46-54`, `indexing.rs:1143-1147`) while CLIP has a real
  batched ONNX path. Separately, a bounded decode broker: decode each source once to RGB and fan
  out encoder-specific resize/crop/normalise tensors to all three. Their preprocessors currently
  each open and decode the same file (`encoder.rs:127-130`, `encoder_siglip2.rs:119-132`,
  `encoder_dinov2.rs:104-128`).
- **Why:** True batch support turns up to 32 ORT session calls into one (where exports support
  dynamic batch). Shared decode turns three file decodes into one — can cut the I/O/decode portion
  ~two-thirds. Overall gain depends on how inference-bound each encoder is.
- **Functionality preserved:** Each encoder keeps its exact trained resize, crop, normalisation,
  output extraction, embedding result.
- **Risk:** Some ONNX exports may have a fixed batch dimension. Verify input shapes first; if needed
  re-export with dynamic batch and prove embedding equivalence before switching.
- **Note:** backend-smith explicitly called out the decode-once fan-out as an opportunity when it
  did the progress-cadence work; it deliberately kept the batch-of-32 out of scope there. This is
  the natural next backend perf slice to route to it.

---

### 13. Make progress snapshots O(1) and emit only committed progress  ·  M  ·  includes the parked pill fix

- **What:** Maintain a small `pipeline_progress` table updated in the same transaction as
  thumbnail/embedding batches. `get_pipeline_stats` reads counters rather than scanning `images` +
  three embedding counts (`images_query.rs:554-619`). Emit progress after a committed batch,
  invalidate once per batch, let the existing spring animate between committed percentages.
- **Why:** `useIndexingStatus` invalidates `["pipelineStats"]` on every progress event
  (`useIndexingStatus.ts:142-145`); encoding emits up to ~4,000 events (`indexing.rs:840-847`). At
  100k each snapshot's base `COUNT/SUM` scans the image table. Materialised counters → a handful of
  PK reads.
- **Functionality preserved:** Pill and drawer stay DB-authoritative and monotonic; the bar becomes
  smoother without inventing uncommitted progress.
- **Risk:** Counter drift after a crash. Reconcile from canonical tables at startup / abnormal run
  termination.
- **Related — the parked pill smoothness fix (frontend, spec'd with backend-smith):** during an
  ACTIVE run the pill's fraction reads the latest `indexing-progress` event's `processed/total`
  (the smooth intra-run climb); at idle/terminal it falls back to the snapshot so `Phase::Ready`
  stays the authority for "reaches 100% and clears". Files: `useIndexingStatus.ts` (expose an
  event-derived fraction), `IndexingStatusPill.tsx` (read it). No backend change needed — the event
  already carries per-image `processed/total` (from `55655a7`). Safe now because that commit made
  the event monotonic + guaranteed-terminal (the mutex high-water), which the old racy 0/21 event
  was not.

---

### 14. Tighten the grid/tag SQL shape and indexes  ·  S (index) / M (query split)

- **What:** Add the reverse composite index `images_tags(tag_id, image_id)` alongside the PK
  `(image_id, tag_id)`. For the grid, stop extracting the image path once per joined tag row and
  aggregating through a HashMap (`images_query.rs:103-137`). Fetch compact image rows in stable
  `ORDER BY images.id`, then tags separately only for hydrated/selected IDs — or aggregate tags in
  SQL when a full detail query is genuinely needed.
- **Why:** Include/AND filters and tag counts begin from `tag_id`, but the PK is ordered the
  opposite way. The full join also allocates + drops repeated path strings for multi-tag images.
  The reverse index turns tag lookup from a link-table scan into an indexed range; the compact query
  removes avoidable allocations and sorting.
- **Functionality preserved:** Include/exclude/AND/OR semantics and every image's complete tag list
  unchanged.
- **Risk:** Two-query hydration needs a deterministic merge and must represent zero-tag images
  correctly.
</content>
