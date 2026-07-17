# Tier 2 — contained mid-effort items

Three items plus one deliberately-deferred tail. Bigger than an afternoon, smaller than an
architecture; none blocks or is blocked by Tier 3.

---

## T2-1 · Make the tile memo hold during indexing  — #15 + #16-B merged into one job

The single work item verification most strongly reshaped. The original plan proposed a full
external store (#15) and an animation-engine unification (#16-A); both are rejected. What
survives is one coherent job: **stop indexing-time state churn from re-rendering every visible
tile**, via callback stability + item-identity stability. The two halves only pay off together —
a stable callback with churning item identity (or vice versa) still breaks the memo.

**The verified render-storm mechanism** (worse than the plan stated):

```
indexing-progress event (≈9,000/run at 100k)
  ├─▶ setPhase/setMessage/setActive INSIDE Home's fiber (useIndexingStatus.ts:109-111,137-140)
  │     └─ message varies per event during encode → Home re-renders PER EVENT
  │        (Home only reads {isIndexing, stats} — it never reads message)
  ├─▶ invalidateQueries(["pipelineStats"]) per event (:144) + 1500ms poll (:125)
  │     └─ fresh stats object → another Home render
  └─▶ 2-3 DUPLICATE Tauri listeners (pill + route + open drawer each call listen(), :134)
        └─ redundant invalidations, three components re-render per event

Home re-renders
  └─▶ Masonry not memo'd (Masonry.tsx:48) → re-renders
        └─▶ handleItemClick = useCallback(..., [props.onItemClick]) (Masonry.tsx:131-140)
             but props.onItemClick = handleImageClick is a FRESH ref each Home render
             ([...slug].tsx:469 — plain const, not useCallback'd; same for
             handleReorder :407, handleResizeCommit :412)
              └─▶ every visible MasonryItem's memo breaks → all ~20-30 tiles re-render
                   (MasonryItem memo'd with default shallow compare, MasonryItem.tsx:84)
```

Net: dozens-to-hundreds of full-grid re-renders per minute across a multi-hour 100k index.

**The fix — the lighter three-part decomposition, NOT an external store:**

1. `useCallback` the three route handlers (`handleImageClick`, `handleReorder`,
   `handleResizeCommit`). Trivial, zero-risk, highest leverage — a stable `onItemClick` lets the
   tile memo hold even while Home itself keeps re-rendering.
2. Split `useIndexingStatus` into `usePipelineStats()` (react-query only) and
   `useIndexingPhase()` (event-listener state). Home consumes stats + a coarse `isIndexing`
   boolean that flips on phase transitions, not per-message — Home's render rate drops from
   per-event to per-phase. The pill keeps the fine-grained surface.
3. Dedupe the Tauri listener behind a module singleton/provider so 2–3 mounted consumers stop
   independently invalidating.

Plus the identity half (was #16-B):

4. Key tiles by stable `id` alone, not `` `${id}-${url}` `` (`Masonry.tsx:168`) — a URL-string
   change currently unmounts/remounts the whole anchor+item subtree, losing
   `useAdaptiveThumbnail` state (base→sharp reflash) and re-firing the pop-in animation.
5. Give `MasonryItem` a scalar comparator over the pixel-affecting fields
   (`id, url, thumbnailUrl, hasThumbnail, width, height, isSelected, renderedWidth, isDragging,
   activeResizeCorner`) so full-catalogue refetch object churn can't re-render unchanged tiles.

- **Behaviour preserved:** every progress surface stays reactive; same animations (the
  animation-engine unification that risked the spring feel is rejected, see `rejected.md`).
- **Risk:** selector/comparator must cover exactly the fields consumers read — a missed field
  hides a real update. Keep the comparator list next to the prop type with a comment tying them.
- **Interaction:** T3-1's deltas later remove the every-5s churn *trigger*; this item removes the
  per-event *blast radius*. Both are needed — neither subsumes the other.

---

## T2-2 · Batch the scan-phase inserts  — #11's worthwhile half

- **What:** Stream discovered paths through a prepared statement inside one `BEGIN IMMEDIATE`
  transaction per ~256 paths (with per-row retry on batch failure to preserve today's per-file
  partial-success behaviour). Scope: the scan loop only (`indexing.rs:377-378` →
  `notes_orphans.rs:85-102`).
- **Why:** A 100k first scan runs ~100k autocommit `INSERT OR IGNORE` statements, each taking the
  connection mutex. Batching by 256 → ~400 transactions (~250× fewer), visible because nothing
  else competes for CPU during scan. Honest cost-model correction from verification: the DB is
  WAL + `synchronous=NORMAL` + autocheckpoint off (`db/mod.rs:149-158`), so autocommits are
  WAL appends **without** per-commit fsync — the win is mutex/statement overhead, not fsync
  storms, and is therefore solid-but-not-spectacular.
- **Deliberately excluded:** thumbnail-write batching — the code itself documents the DB write as
  "microseconds vs ~100ms decode/encode" (`indexing.rs:429-433`); batching it saves overhead the
  run cannot feel (see `rejected.md`).
- **Risk:** batch-failure semantics. The retry-individually fallback is mandatory, not optional.

---

## T2-3 · SigLIP-2 / DINOv2 `encode_batch` override  — what's honestly left of #12

- **What:** Override `encode_batch` for SigLIP-2 and DINOv2 to feed one `[N,3,H,W]` tensor per
  chunk instead of inheriting the trait's one-image-at-a-time default (`encoders.rs:49-54` — grep
  confirms no override exists in either encoder today).
- **Why, with corrected expectations:** the plan's premise ("CLIP has a real batched path, extend
  it") is FALSE — no encoder batches today, and CLIP **cannot** without a model re-export (its
  OpenCLIP export declares a fixed batch dim of 1, documented at `encoder.rs:258-276`, per-image
  loop at `:294-305`), and a re-export touches weights provenance — blocked by the pre-sale
  constraint. SigLIP-2/DINOv2's exports are dynamic-batch (symbolic dims, confirmed during the
  quantisation work), so their override needs no re-export. Expectation setting: this is CPU-only
  ORT (CoreML disabled) — batching amortises per-call overhead and improves thread utilisation,
  **~1.2–2× on the inference portion of two of three encoders**, not a GPU-style "32 calls → 1"
  collapse.
- **Verify:** embedding equivalence per encoder (batched vs one-by-one on the same inputs) before
  switching, same as the quantisation harness did.
- **Risk:** low-moderate; the shape contract is per-encoder and testable in isolation.

---

## T2-tail · Semantic-search cancellation  — #10, deliberately deferred

Kept on the books but explicitly **not scheduled**: real (no abort signal in
`useSemanticSearch.ts:28-35`; `get_fused_semantic_search` runs synchronously to completion,
`semantic_fused.rs:73`), but the 300ms input debounce (`[...slug].tsx:93`) already absorbs the
common case — the plan's "fast typing stacks scans" is wrong as stated; stacking needs the
type-pause-type pattern with a >300ms pause while a scan is in flight. Per-query cost is
~100–400ms, text-encode-dominated. **Trigger to schedule it:** search feels laggy during
deliberate multi-word typing at real scale, after T3-2 lands (which removes the per-query
catalogue join that is most of today's cost). If built: a request-generation `AtomicU64`
checked between encoders and corpus chunks, never mid-lock (the encoder mutex must release
cleanly). The only surviving piece of #9 — a cancel guard for scrolled-away prefetch — reuses
this same token.
