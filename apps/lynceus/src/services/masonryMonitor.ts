/**
 * Masonry geometry + the unified layout monitor — the app-specific half of
 * telemetry v2, split out of `telemetry.ts` at its own header-drawn seam
 * (services/CLAUDE.md's "Split telemetry.ts" entry). Coupling to the
 * generic capture layer is one-directional: this module references no
 * `telemetry.ts` symbol and defines its own `monitorContext`; `telemetry.ts`
 * imports `captureGridGeometry`, `monitorContext`, and `startLayoutMonitor`
 * from here to drive its pointer handlers and state bundles.
 *
 * It reads `[data-masonry-id]` tiles directly. When the capture layer is
 * extracted to the shared package this becomes a configurable selector the
 * app registers. It exists so a layout bug (a tile rendering wider than the
 * packer reserved → overlap; a gap; a drag over empty space) is visible in
 * the timeline as NUMBERS, not something the next session has to reproduce
 * and eyeball.
 */
import { recordAction } from "./perf";

export interface TileGeometry {
  id: number;
  /** Width the packer set on the anchor (the reserved footprint). */
  packW: number;
  /** Height the packer set on the anchor. */
  packH: number;
  /** The anchor's committed transform (its reserved x/y). */
  packTransform: string;
  /** What the tile actually renders as (its on-screen box). */
  renderW: number;
  renderH: number;
  x: number;
  y: number;
}

function committedNumber(
  element: HTMLElement,
  key: "masonryX" | "masonryY" | "masonryWidth" | "masonryHeight",
  fallback: number,
): number {
  const value = Number(element.dataset[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** Do two tile boxes overlap by more than `slop` px on both axes? */
export function tilesOverlap(a: TileGeometry, b: TileGeometry, slop = 4): number {
  const ox = Math.max(0, Math.min(a.x + a.renderW, b.x + b.renderW) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.renderH, b.y + b.renderH) - Math.max(a.y, b.y));
  return ox > slop && oy > slop ? Math.round(ox * oy) : 0;
}

/**
 * Snapshot every visible masonry tile: what the packer reserved vs what
 * it renders, plus the two things that make a broken grid broken —
 * tiles whose render width diverges from the reserved width, and pairs
 * of tiles whose boxes overlap. Returns null when no grid is mounted.
 */
export function captureGridGeometry(): Record<string, unknown> | null {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-masonry-id]"),
  );
  if (nodes.length === 0) return null;

  const tiles: TileGeometry[] = nodes.map((el) => {
    const style = el.style;
    const r = el.getBoundingClientRect();
    return {
      id: Number(el.dataset.masonryId),
      packW: Math.round(
        committedNumber(el, "masonryWidth", parseFloat(style.width) || 0),
      ),
      packH: Math.round(
        committedNumber(el, "masonryHeight", parseFloat(style.height) || 0),
      ),
      packTransform: style.transform,
      renderW: Math.round(r.width),
      renderH: Math.round(r.height),
      // Position comes from the anchor's committed pack data, never from a
      // descendant's live gesture transform. This keeps telemetry diagnostic
      // even if a future visual effect moves pixels inside the reserved rect.
      x: Math.round(committedNumber(el, "masonryX", r.left)),
      y: Math.round(committedNumber(el, "masonryY", r.top)),
    };
  });

  // Divergence: the packer reserved packW but the tile renders renderW.
  // A non-trivial gap here IS the "2x2 acts like a wrong size" bug.
  const mismatched = tiles
    .filter(
      (t) =>
        Math.abs(t.renderW - t.packW) > 2 ||
        Math.abs(t.renderH - t.packH) > 2,
    )
    .map((t) => ({
      id: t.id,
      packW: t.packW,
      packH: t.packH,
      renderW: t.renderW,
      renderH: t.renderH,
    }));

  // Overlaps: pairs of tiles whose rendered boxes intersect. On a healthy
  // masonry this is empty (barring the active drag tile) — but a snapshot
  // taken MID-reflow catches tiles still sliding through each other, so the
  // layout monitor's settled snapshot is the one that judges bugs.
  const overlaps: Array<{ a: number; b: number; area: number }> = [];
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const area = tilesOverlap(tiles[i], tiles[j]);
      if (area > 0) overlaps.push({ a: tiles[i].id, b: tiles[j].id, area });
    }
  }

  // Vertical gaps within a column (the "empty black square"): a tile whose
  // top sits well below the bottom of the tile above it in the same column.
  // SPAN-AWARE: a multi-column tile is registered in EVERY column its
  // rendered width covers, not just its left edge — binning by left `x`
  // alone made a span-2 tile invisible in its second column, and that
  // column then reported a phantom gap exactly the tile's height (the
  // 2026-07-19 diagnosis: all of T2's "persistent 306px gaps" were this
  // measurement artefact, this saga's third).
  const columnStarts = [...new Set(tiles.map((t) => t.x))].sort(
    (a, b) => a - b,
  );
  const byColumn = new Map<number, TileGeometry[]>();
  for (const t of tiles) {
    for (const cx of columnStarts) {
      if (cx >= t.x && cx < t.x + t.renderW - 1) {
        const arr = byColumn.get(cx) ?? [];
        arr.push(t);
        byColumn.set(cx, arr);
      }
    }
  }
  const gaps: Array<{ x: number; gap: number; above: number; below: number }> = [];
  for (const [x, col] of byColumn) {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) {
      const gap = Math.round(col[i].y - (col[i - 1].y + col[i - 1].renderH));
      if (gap > 40) {
        gaps.push({ x, gap, above: col[i - 1].id, below: col[i].id });
      }
    }
  }
  gaps.sort((a, b) => b.gap - a.gap);

  return { count: tiles.length, mismatched, overlaps, gaps, tiles };
}

/**
 * Classify a single tile's move given its total displacement and biggest
 * single-frame jump: TELEPORT when >60% of the distance happened in one frame
 * (nothing animated it) vs slide when it moved gradually. Pure, so the
 * threshold is unit-testable.
 */
export function classifyMove(
  total: number,
  maxFrameJump: number,
  sampleSpanFrames = 1,
): "TELEPORT" | "slide" {
  // The original threshold meant ">60% in one browser frame". A sample
  // spanning multiple frames legitimately accumulates more smooth motion,
  // so the threshold scales with the span — but it must stay strictly
  // BELOW 1: an adversarial review showed a cap of 1 collapsed detection
  // to "the entire displacement in one sample", which any co-occurring
  // legitimate motion dilutes past, blinding the monitor to exactly the
  // jank it exists to catch. The steepest smooth curve in the motion
  // tokens (SETTLE_EASING at the two-frame cadence) peaks at ~59% of its
  // total per sample — measured, not assumed — so 0.75 discriminates:
  // no false positives from clean eases, and a genuine unanimated jump
  // (~100% in one sample) is still caught.
  const thresholdFraction = Math.min(0.6 * sampleSpanFrames, 0.75);
  return maxFrameJump > total * thresholdFraction ? "TELEPORT" : "slide";
}

/**
 * Context the layout monitor stamps onto each reflow event: what the user was
 * doing when the reflow began. Mutated by telemetry.ts's pointer handlers,
 * read by the monitor — so a reflow reads back as "caused by dragging tile
 * 42" or "other" (an indexing delta, a resize, a filter change).
 */
interface MonitorContext {
  dragging: boolean;
  grabbedId: number | null;
  cursor: { x: number; y: number } | null;
}
export const monitorContext: MonitorContext = {
  dragging: false,
  grabbedId: null,
  cursor: null,
};

/**
 * The unified layout monitor — one armed observer that classifies every
 * masonry reflow, whatever triggered it (drag reorder, indexing delta, resize,
 * filter change). Pointer gestures and masonry DOM mutations arm a bounded rAF
 * sampling window; idle browsing has no per-frame monitor work.
 *
 * An rAF loop tracks every visible tile frame-to-frame. When motion starts it
 * captures the current interaction context; while motion continues it
 * accumulates, per tile, first/last position, largest single-frame jump (and
 * the anchor's live CSS transition state AT that jump), and mount/unmount; when
 * motion settles (a few still frames) it emits ONE `reflow` event: per-tile
 * {total, dx, dy, maxFrameJump, verdict, dir, transProp, transDur}, the mounted
 * and unmounted ids, the trigger, and the settled geometry (overlaps + gaps).
 *
 * That single event answers every reflow question the piecemeal samplers each
 * needed their own turn for: did a tile teleport or slide, in which direction,
 * was its transition even live when it jumped, did it appear/vanish, and is the
 * final layout clean.
 */
export function startLayoutMonitor(): () => void {
  const SAMPLE_SPAN_FRAMES = 2;
  const ACTIVE_WINDOW_MS = 1_500;
  // Preserve roughly the old five-browser-frame settle window while sampling
  // every second frame.
  const SETTLE_SAMPLES = Math.ceil(5 / SAMPLE_SPAN_FRAMES);
  const MOVE_EPS = 1; // px; below this a tile is "still" this frame
  const JUMP_PX = 24 * SAMPLE_SPAN_FRAMES;
  const MEANINGFUL = 6; // total px a tile must move to be reported

  type Snap = { x: number; y: number };
  interface Acc {
    first: Snap;
    last: Snap;
    maxJump: number;
    jumpTrans: { prop: string; dur: string } | null;
  }

  interface TileSnap {
    /** Packer target used to detect a real layout change. */
    committed: Snap;
    /** Animated screen position used only to grade slide vs teleport. */
    rendered: Snap;
    el: HTMLElement;
  }

  const readTiles = (target: Map<number, TileSnap>): void => {
    target.clear();
    for (const el of document.querySelectorAll<HTMLElement>("[data-masonry-id]")) {
      const id = Number(el.dataset.masonryId);
      const r = el.getBoundingClientRect();
      target.set(id, {
        committed: {
          x: committedNumber(el, "masonryX", r.left),
          y: committedNumber(el, "masonryY", r.top),
        },
        rendered: { x: r.left, y: r.top },
        el,
      });
    }
  };

  // These maps swap roles after each sample and are cleared/refilled rather
  // than allocated at rAF cadence.
  let previousTiles = new Map<number, TileSnap>();
  let currentTiles = new Map<number, TileSnap>();
  let active = false;
  let idle = 0;
  const acc = new Map<number, Acc>();
  const mounted = new Set<number>();
  const unmounted = new Set<number>();
  let ctxAtStart: MonitorContext = { ...monitorContext };

  const reset = () => {
    acc.clear();
    mounted.clear();
    unmounted.clear();
  };

  const flush = () => {
    const moved: Array<Record<string, unknown>> = [];
    for (const [id, a] of acc) {
      const dx = a.last.x - a.first.x;
      const dy = a.last.y - a.first.y;
      const total = Math.round(Math.hypot(dx, dy));
      if (total < MEANINGFUL) continue;
      moved.push({
        id,
        total,
        dx: Math.round(dx),
        dy: Math.round(dy),
        maxFrameJump: Math.round(a.maxJump),
        verdict: classifyMove(total, a.maxJump, SAMPLE_SPAN_FRAMES),
        dir:
          Math.abs(dx) > Math.abs(dy)
            ? dx < 0
              ? "left"
              : "right"
            : dy < 0
              ? "up"
              : "down",
        transProp: a.jumpTrans?.prop,
        transDur: a.jumpTrans?.dur,
      });
    }
    if (moved.length === 0 && mounted.size === 0 && unmounted.size === 0) {
      reset();
      return;
    }
    moved.sort((x, y) => (y.total as number) - (x.total as number));
    const teleports = moved.filter((m) => m.verdict === "TELEPORT");
    recordAction("reflow", {
      trigger: ctxAtStart.dragging
        ? { kind: "drag", grabbed: ctxAtStart.grabbedId, cursor: ctxAtStart.cursor }
        : { kind: "other" },
      movedCount: moved.length,
      teleportCount: teleports.length,
      teleports: teleports.slice(0, 30),
      moved: moved.slice(0, 40),
      mounted: [...mounted].slice(0, 40),
      unmounted: [...unmounted].slice(0, 40),
      settled: captureGridGeometry(),
    });
    reset();
  };

  const sample = (): boolean => {
    // Geometry is read as one phase. Computed styles for noteworthy jumps are
    // deferred until every getBoundingClientRect read in this sample is done.
    readTiles(currentTiles);
    let motion = false;
    const styleReads: Array<{ acc: Acc; el: HTMLElement }> = [];

    for (const [id, { committed, rendered, el }] of currentTiles) {
      const prior = previousTiles.get(id);
      if (!prior) {
        if (active) mounted.add(id);
        continue;
      }
      // A reflow starts from committed pack geometry, not a cosmetic/live
      // transform. The rendered box is retained solely to grade whether the
      // browser interpolated that target change or teleported it.
      const targetJump = Math.hypot(
        committed.x - prior.committed.x,
        committed.y - prior.committed.y,
      );
      const visualJump = Math.hypot(
        rendered.x - prior.rendered.x,
        rendered.y - prior.rendered.y,
      );
      if (targetJump > MOVE_EPS || visualJump > MOVE_EPS) {
        motion = true;
        if (!active) {
          active = true;
          ctxAtStart = { ...monitorContext };
        }
      }
      if (visualJump > MOVE_EPS) {
        const a = acc.get(id) ?? {
          first: prior.rendered,
          last: rendered,
          maxJump: 0,
          jumpTrans: null,
        };
        a.last = rendered;
        if (visualJump > a.maxJump) {
          a.maxJump = visualJump;
          if (visualJump > JUMP_PX) {
            styleReads.push({ acc: a, el });
          }
        }
        acc.set(id, a);
      }
    }
    for (const [id] of previousTiles) {
      if (!currentTiles.has(id)) {
        if (active) unmounted.add(id);
        motion = true;
      }
    }

    for (const { acc: move, el } of styleReads) {
      const cs = getComputedStyle(el);
      move.jumpTrans = {
        prop: cs.transitionProperty,
        dur: cs.transitionDuration,
      };
    }

    const reusable = previousTiles;
    previousTiles = currentTiles;
    currentTiles = reusable;

    if (motion) {
      idle = 0;
    } else if (active) {
      idle += 1;
      if (idle >= SETTLE_SAMPLES) {
        flush();
        active = false;
        idle = 0;
      }
    }
    return motion;
  };

  let frame: number | null = null;
  let framesUntilSample = SAMPLE_SPAN_FRAMES;
  let lastActivityAt = performance.now();

  const step = (now: number) => {
    frame = null;
    framesUntilSample -= 1;
    if (framesUntilSample === 0) {
      framesUntilSample = SAMPLE_SPAN_FRAMES;
      if (sample()) lastActivityAt = now;
    }

    if (
      monitorContext.dragging ||
      active ||
      now - lastActivityAt <= ACTIVE_WINDOW_MS
    ) {
      frame = requestAnimationFrame(step);
    }
  };

  const arm = () => {
    lastActivityAt = performance.now();
    if (frame !== null) return;
    framesUntilSample = SAMPLE_SPAN_FRAMES;
    frame = requestAnimationFrame(step);
  };

  readTiles(previousTiles);

  // React pack commits update anchor data/style attributes or mount/unmount
  // anchors, so a mutation re-arms non-pointer reflows such as feed deltas.
  const mutationTouchesMasonry = (mutation: MutationRecord): boolean => {
    if (
      mutation.target instanceof Element &&
      mutation.target.closest("[data-masonry-id]")
    ) {
      return true;
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) =>
        node instanceof Element &&
        (node.matches("[data-masonry-id]") ||
          node.querySelector("[data-masonry-id]")),
    );
  };
  const mutationObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesMasonry)) arm();
  });
  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "style",
      "data-masonry-x",
      "data-masonry-y",
      "data-masonry-width",
      "data-masonry-height",
    ],
  });

  arm();
  return arm;
}
