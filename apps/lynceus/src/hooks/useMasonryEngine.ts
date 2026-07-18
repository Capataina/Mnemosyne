import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import debounce from "lodash/debounce";
import type { FeedItem } from "../types";
import {
  buildPackInput,
  computeMasonryGeometry,
  heroPlacement,
  placementAt,
  type MasonryGeometry,
  type MasonryItemPlacement,
  type MasonryPackParams,
} from "../components/masonryPacking";
import {
  createMasonryPacker,
  type MasonryPacker,
} from "../components/masonryPacker";

interface MasonryEngineInput {
  items: FeedItem[] | undefined;
  selectedItem: FeedItem | null;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  columnCountOverride?: number;
  tileScale?: number;
  /** id → rounded span, for the resize footprint. */
  spanOverrides?: Record<number, number>;
  /** The one tile under an active gesture, pinned to a start column: a
   *  resizing tile grows in place instead of wrapping to a new row; a dragged
   *  tile's reserved slot tracks the pointer's column instead of drifting. */
  columnAnchor?: { id: number; startCol: number; edge?: number };
  /** The tile currently being drag-reordered — never culled. */
  dragItemId: number | null;
  /** True while any tile gesture (drag or resize) is live. Freezes the
   *  visible set so a mid-gesture reflow can't cull tiles out from under the
   *  pointer and flicker them back on the next pack. */
  gestureActive: boolean;
  // Shell-owned refs the engine populates so the interaction hooks can
  // read live layout data without re-subscribing on every pointer move.
  containerRef: RefObject<HTMLDivElement | null>;
  placementsRef: RefObject<MasonryItemPlacement[]>;
  placementByIdRef: RefObject<Map<number, MasonryItemPlacement>>;
  columnWidthRef: RefObject<number>;
  columnCountRef: RefObject<number>;
}

export interface MasonryEngine {
  /** Placements intersecting the viewport (+ overscan), ready to render. */
  visiblePlacements: MasonryItemPlacement[];
  /** Total grid height in px. */
  height: number;
}

const VIEWPORT_OVERSCAN_PX = 800;
/**
 * Inner guard band, half the overscan. Scroll only re-commits the viewport
 * (and re-runs the visible-set filter) once the on-screen window drifts to
 * within this margin of the committed render range. Because the band is
 * strictly smaller than the overscan, the leading edge always keeps at least
 * `VIEWPORT_OVERSCAN_PX - VIEWPORT_GUARD_BAND_PX` (400px) of buffer between
 * refreshes, so an on-screen tile is never culled — only the off-screen
 * overscan buffer thins.
 */
const VIEWPORT_GUARD_BAND_PX = VIEWPORT_OVERSCAN_PX / 2;

/**
 * Items packed synchronously for the first-paint prefix (T3-3). Enough to
 * fill several screens of tiles from the top so launch/filter never shows an
 * empty grid while the worker packs the full N. Because the pack is
 * suffix-independent, these tiles get exactly the geometry the full pack
 * will give them — the worker result swaps in with no visible reflow.
 */
const PREFIX_PACK_COUNT = 240;

/**
 * Adopt a fresh prefix (rather than keep the committed layout visible) when
 * the incoming set dwarfs the committed one by this factor — the
 * filter-clear / return-to-full-feed case, where keeping a tiny old set
 * under a big new feed is the jarring flash. An incremental delta
 * (100k → 100k+tens) never trips it, so the feed keeps its geometry and only
 * swaps once the worker's full result lands.
 */
const RESET_EXPANSION_RATIO = 4;

/**
 * True while the current on-screen window (`localTop`..`localBottom`) still
 * sits inside the committed viewport's guard band, so the existing visible
 * set stays valid and no refresh is needed. `committed` already carries the
 * ±overscan margin. Pure so the band correctness is unit-testable without
 * mounting the hook.
 */
export function isWithinGuardBand(
  committed: { top: number; bottom: number },
  localTop: number,
  localBottom: number,
  guardBand: number,
): boolean {
  return (
    localTop >= committed.top + guardBand &&
    localBottom <= committed.bottom - guardBand
  );
}

/**
 * Whether a worker (or fallback) result should be applied: it must carry the
 * current generation. Stale results from a superseded filter/resize/reorder
 * request are dropped, so a rapid input sequence converges to the latest.
 * Pure so the discard logic is unit-testable without a live worker.
 */
export function isCurrentGeneration(
  resultGen: number,
  currentGen: number,
): boolean {
  return resultGen === currentGen;
}

/** Whether two feed slices carry the same ids in the same order — the guard
 *  for commit-adopt: the just-committed gesture geometry is index-aligned to
 *  its order, so it can only be re-paired with the current feed (skipping a
 *  greedy re-pack) when the orders still match. A concurrent delta-merge that
 *  changed the order fails this and falls through to a normal pack. Pure so
 *  the guard is unit-testable. */
export function ordersAligned(a: FeedItem[], b: FeedItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

/** Nearest scrolling ancestor, falling back to the document scroller. */
function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const style = window.getComputedStyle(cur);
    const oy = style.overflowY;
    if (
      (oy === "auto" || oy === "scroll") &&
      cur.scrollHeight > cur.clientHeight
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return (
    (document.scrollingElement as HTMLElement | null) ??
    document.documentElement
  );
}

/** The geometry committed to the grid, paired with the exact feed slice and
 *  selection it was packed from — so the visible-window pass reattaches the
 *  right `itemData` even when a newer pack is already in flight. */
interface CommittedLayout {
  geometry: MasonryGeometry;
  items: FeedItem[];
  selectedItem: FeedItem | null;
}

/** Everything needed to re-run the latest pack synchronously if the worker
 *  dies mid-flight (its transferred inputs are gone). */
interface PackContext {
  gen: number;
  items: FeedItem[];
  selectedItem: FeedItem | null;
  params: MasonryPackParams;
}

const EMPTY_PLACEMENTS: MasonryItemPlacement[] = [];

/**
 * The headless masonry engine: shortest-column packing (off the main thread
 * via a Web Worker, T3-3) plus viewport virtualization. It owns no
 * interaction state — drag-reorder and drag-resize live in their own hooks
 * and feed only structural state through `spanOverrides` and `dragItemId`.
 *
 * The pack is asynchronous: the engine holds the committed geometry as flat
 * typed arrays (not 100k placement objects) and materialises placement
 * objects only for the visible window. Requests are generation-tagged so
 * stale results are discarded; the first paint (or a large expansion) shows
 * a synchronous prefix so the grid is never empty; a worker failure falls
 * back to synchronous packing. Continuous gesture pixels never enter this
 * hook: resize width and drag position are imperative writes to one tile,
 * while this engine runs only for structural inputs and rounded footprints.
 */
export function useMasonryEngine(input: MasonryEngineInput): MasonryEngine {
  const {
    items,
    selectedItem,
    minItemWidth,
    columnGap,
    verticalGap,
    columnCountOverride,
    tileScale,
    spanOverrides,
    columnAnchor,
    dragItemId,
    gestureActive,
    containerRef,
    placementsRef,
    placementByIdRef,
    columnWidthRef,
    columnCountRef,
  } = input;

  const scrollerRef = useRef<HTMLElement | null>(null);
  // Holds the pending scroll rAF so at most one viewport update runs per
  // frame and any in-flight frame can be cancelled on cleanup.
  const scrollRafRef = useRef<number | null>(null);
  // The visible set as of the last SCROLL-driven viewport commit, keyed by id
  // (the committed `byId` map is reused as-is — only its keys are read here).
  // These ids stay mounted across any reflow that ISN'T a scroll — a gesture,
  // a delta-merge repack during indexing, a reorder shift — so a repack that
  // moves a tile past the overscan band can't unmount it. That prevents both
  // the "tiles disappear during indexing" cull (the tile stays mounted) and
  // the "moving up teleports" jump (a mounted tile animates its translate
  // instead of re-mounting fresh with no transition). Refreshed only when the
  // viewport genuinely scrolls, so the set stays bounded to ~one viewport.
  const prevVisibleIdsRef = useRef<Map<number, MasonryItemPlacement>>(new Map());
  // The viewport the visible set was last culled against, to tell a scroll
  // (viewport moved → cull scrolled-away tiles, refresh the keep-set) apart
  // from a repack-only change (layout moved, viewport same → keep mounted).
  const prevViewportRef = useRef<{ top: number; bottom: number }>({
    top: 0,
    bottom: 99999,
  });

  // Async pack plumbing. The packer lives in the mount effect (StrictMode
  // safe); `packerRef` lets the pack path reach it between renders.
  const packerRef = useRef<MasonryPacker | null>(null);
  const genRef = useRef(0);
  // Tracks gestureActive across packs so a true→false transition triggers the
  // one-shot commit-adopt (re-commit the last gesture layout, skip the greedy
  // release re-pack). See requestPack.
  const prevGestureActiveRef = useRef(false);
  const packContextRef = useRef<PackContext | null>(null);
  const layoutRef = useRef<CommittedLayout | null>(null);
  // The full committed height, so a pending prefix can never shrink the
  // container under a scrolled-down position (scroll-anchor preservation).
  const committedHeightRef = useRef(0);

  const [layout, setLayout] = useState<CommittedLayout | null>(null);
  const [height, setHeight] = useState(0);
  const [viewport, setViewport] = useState<{ top: number; bottom: number }>({
    top: 0,
    bottom: 99999,
  });

  // Commit a fresh geometry as the visible layout. `partial` (the prefix)
  // never lowers the committed height, so a small prefix cannot clamp scroll;
  // a full result becomes the new committed height and anchor.
  const commit = useCallback(
    (
      geometry: MasonryGeometry,
      committedItems: FeedItem[],
      committedSelected: FeedItem | null,
      partial: boolean,
    ) => {
      const next: CommittedLayout = {
        geometry,
        items: committedItems,
        selectedItem: committedSelected,
      };
      layoutRef.current = next;
      setLayout(next);
      if (partial) {
        setHeight(Math.max(geometry.height, committedHeightRef.current));
      } else {
        committedHeightRef.current = geometry.height;
        setHeight(geometry.height);
      }
    },
    [],
  );

  // Request a pack for the current inputs. Reads the committed layout from a
  // ref (not state), so it does not re-run on every commit — only on genuine
  // input changes.
  const requestPack = useCallback(() => {
    const container = containerRef.current;
    if (!container || !items) return;
    const sel = selectedItem ?? null;

    // Commit-adopt. The instant a gesture ends, the last anchored pack already
    // IS the layout the user saw — so re-commit that geometry rather than
    // re-packing greedily, which would relocate the just-dropped / just-grown
    // tile (the release "jump"). It's safe only while the committed geometry is
    // still index-aligned to the current feed order, so `ordersAligned` guards
    // it; a concurrent delta-merge that reordered the feed fails the guard and
    // falls through to a normal pack. Densification is deferred to the next
    // genuine steady-state pack (filter / shuffle / delta), where a reflow is
    // expected anyway — so between a release and that event the grid holds
    // exactly where the gesture left it. Done synchronously here (not by
    // holding the anchor for an async generation), so a superseded pack can
    // never strand the gesture.
    const justEnded = prevGestureActiveRef.current && !gestureActive;
    prevGestureActiveRef.current = gestureActive;
    if (justEnded) {
      const prev = layoutRef.current;
      // Adopt only when the committed geometry still describes the current
      // render: same order (ordersAligned) AND same selection. The hero is
      // baked into the geometry (its selectedIndex is skipped in the flow and
      // it is placed separately), so re-pairing a geometry built for one
      // selection with a different `sel` would drop or duplicate the selected
      // tile. A selection change landing on the same tick as gesture-end falls
      // through to a normal pack, which places the new hero correctly.
      const selId = sel?.id ?? -1;
      const prevSelId = prev?.selectedItem?.id ?? -1;
      if (
        prev &&
        prev.geometry.columnCount > 0 &&
        selId === prevSelId &&
        ordersAligned(prev.items, items)
      ) {
        // Invalidate any gesture pack still in flight so its late result or
        // failure cannot recommit a gesture-shaped (anchored / prevCols-seeded)
        // layout over this adopted one — onResult's generation check and
        // onFailure's (below) both drop a request older than genRef.
        genRef.current++;
        commit(prev.geometry, items, sel, false);
        return;
      }
    }

    const width = container.clientWidth;
    // Coherence seed for the packer's tie-break. Built ONLY during a gesture,
    // per pack, by tile id: each entry is the column that tile held in the
    // previous committed layout (round(x / stride)); the anchored (dragged or
    // resized) tile and any newcomer get -1. Rebuilding it per pack — and
    // keying by id, not array index — is what keeps it correct across a
    // mid-gesture reorder splice or a delta-merge that shifts indices; the
    // strict gesture gate keeps it null on every steady-state pack, so the
    // layout never depends on hidden cross-pack state (a resting tile can't
    // shimmer between equal columns, but no non-gesture pack is perturbed).
    let prevCols: Int32Array | undefined;
    if (gestureActive) {
      const prev = layoutRef.current;
      const stride = (prev?.geometry.columnWidth ?? 0) + columnGap;
      if (prev && prev.geometry.columnCount > 0 && stride > 0) {
        const prevColById = new Map<number, number>();
        const pxs = prev.geometry.xs;
        const pn = Math.min(prev.geometry.count, prev.items.length);
        for (let i = 0; i < pn; i++) {
          if (i === prev.geometry.selectedIndex) continue;
          prevColById.set(prev.items[i].id, Math.round(pxs[i] / stride));
        }
        const anchorId = columnAnchor?.id ?? -1;
        prevCols = new Int32Array(items.length);
        for (let i = 0; i < items.length; i++) {
          const id = items[i].id;
          prevCols[i] = id === anchorId ? -1 : prevColById.get(id) ?? -1;
        }
      }
    }
    const params: MasonryPackParams = {
      containerWidth: width,
      minItemWidth,
      columnGap,
      verticalGap,
      columnCountOverride,
      tileScale,
      spanOverrides,
      columnAnchor,
      prevCols,
    };
    const gen = ++genRef.current;

    // First paint (nothing to keep) or a large expansion (old set dwarfed):
    // pack a synchronous prefix now so the grid is never empty / never left
    // showing a tiny stale set under a big new feed.
    const committedCount = layoutRef.current?.items.length ?? 0;
    const needPrefix =
      committedCount === 0 || items.length > committedCount * RESET_EXPANSION_RATIO;
    if (needPrefix && items.length > 0 && width > 0) {
      const prefixCount = Math.min(items.length, PREFIX_PACK_COUNT);
      const prefixItems =
        prefixCount === items.length ? items : items.slice(0, prefixCount);
      const prefixGeo = computeMasonryGeometry(
        buildPackInput(prefixItems, sel, params),
      );
      commit(prefixGeo, prefixItems, sel, true);
    }

    // Full pack off-thread (or synchronous fallback inside the packer).
    const fullInput = buildPackInput(items, sel, params);
    packContextRef.current = { gen, items, selectedItem: sel, params };
    const packer = packerRef.current;
    if (packer) {
      packer.pack(gen, fullInput);
    } else {
      // Packer not yet created (or torn down): pack synchronously this tick.
      commit(computeMasonryGeometry(fullInput), items, sel, false);
    }
  }, [
    items,
    selectedItem,
    minItemWidth,
    columnGap,
    verticalGap,
    columnCountOverride,
    tileScale,
    spanOverrides,
    columnAnchor,
    gestureActive,
    containerRef,
    commit,
  ]);

  // Create the packer and wire its result / failure handlers once per mount.
  useEffect(() => {
    const packer = createMasonryPacker();
    packerRef.current = packer;
    packer.onResult((gen, geometry) => {
      if (!isCurrentGeneration(gen, genRef.current)) return;
      const ctx = packContextRef.current;
      if (!ctx || ctx.gen !== gen) return;
      commit(geometry, ctx.items, ctx.selectedItem, false);
    });
    packer.onFailure(() => {
      // A live worker died mid-flight: re-run the latest pack synchronously
      // from the source items the engine still holds. The grid must never
      // depend on worker availability. Skip a request the engine has already
      // moved past (a commit-adopt bumps genRef precisely so a stale gesture
      // pack's failure can't overwrite the adopted layout) — mirrors the
      // generation check onResult already applies.
      const ctx = packContextRef.current;
      if (!ctx || ctx.gen !== genRef.current) return;
      commit(
        computeMasonryGeometry(
          buildPackInput(ctx.items, ctx.selectedItem, ctx.params),
        ),
        ctx.items,
        ctx.selectedItem,
        false,
      );
    });
    return () => {
      packer.dispose();
      packerRef.current = null;
    };
  }, [commit]);

  const requestPackDebounced = useMemo(
    () => debounce(() => requestPack(), 100),
    [requestPack],
  );

  useEffect(() => {
    const onResize = () => requestPackDebounced();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      requestPackDebounced.cancel();
    };
  }, [requestPackDebounced]);

  useEffect(() => {
    requestPack();
  }, [requestPack]);

  // --- Viewport tracking for virtualization -------------------------
  // `force` commits immediately (mount / re-subscribe / layout change);
  // scroll passes `false` so the guard band can suppress sub-band moves.
  const updateViewport = useCallback(
    (force = false) => {
      const container = containerRef.current;
      const scroller = scrollerRef.current;
      if (!container) return;

      let scrollTop: number;
      let viewportH: number;
      if (scroller && scroller !== document.documentElement) {
        scrollTop = scroller.scrollTop;
        viewportH = scroller.clientHeight;
      } else {
        scrollTop = window.scrollY;
        viewportH = window.innerHeight;
      }

      let containerOffsetTop = 0;
      if (scroller && scroller !== document.documentElement) {
        let node: HTMLElement | null = container;
        while (node && node !== scroller) {
          containerOffsetTop += node.offsetTop;
          node = node.offsetParent as HTMLElement | null;
        }
      } else {
        const rect = container.getBoundingClientRect();
        containerOffsetTop = rect.top + window.scrollY;
      }

      const localTop = scrollTop - containerOffsetTop;
      const localBottom = localTop + viewportH;

      setViewport((prev) => {
        const next = {
          top: localTop - VIEWPORT_OVERSCAN_PX,
          bottom: localBottom + VIEWPORT_OVERSCAN_PX,
        };
        // Scroll moves that stay inside the guard band keep the current
        // visible set; layout/mount (`force`) always re-commits.
        if (
          !force &&
          isWithinGuardBand(prev, localTop, localBottom, VIEWPORT_GUARD_BAND_PX)
        ) {
          return prev;
        }
        if (
          Math.abs(prev.top - next.top) < 1 &&
          Math.abs(prev.bottom - next.bottom) < 1
        ) {
          return prev;
        }
        return next;
      });
    },
    [containerRef],
  );

  useEffect(() => {
    const scroller = findScrollContainer(containerRef.current);
    scrollerRef.current = scroller;
    if (!scroller) return;
    // Immediate commit on (re)subscribe — a layout change (new committed
    // geometry / height) re-runs this effect and must refresh the viewport
    // at once.
    updateViewport(true);
    const target = scroller === document.documentElement ? window : scroller;
    // Coalesce scroll through one rAF: at most one filter pass per frame,
    // and the guard band drops most of those to roughly one per band-exit.
    const onScroll = () => {
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        updateViewport(false);
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [updateViewport, containerRef, layout, height]);

  const visiblePlacements = useMemo(() => {
    // Render-phase ref writes are safe here (as in useShuffledFeed): the
    // outputs are a pure function of the memo inputs, so a discarded render
    // or StrictMode double-invoke just rewrites the same values. The refs
    // hold the visible-only placements — the only tiles the gesture hooks
    // ever look up (they address the on-screen active tile).
    const current = layout;
    if (!current || current.geometry.columnCount === 0) {
      placementsRef.current = EMPTY_PLACEMENTS;
      placementByIdRef.current = new Map();
      return EMPTY_PLACEMENTS;
    }

    const { geometry, items: layoutItems, selectedItem: sel } = current;
    const out: MasonryItemPlacement[] = [];
    const byId = new Map<number, MasonryItemPlacement>();

    // The selected hero always renders (never flickers out from under the
    // modal); it leads the list, matching the object-pack's ordering.
    const hero = heroPlacement(geometry, sel);
    if (hero) {
      out.push(hero);
      byId.set(hero.itemData.id, hero);
    }

    const { ys, heights, selectedIndex } = geometry;
    const top = viewport.top;
    const bottom = viewport.bottom;
    // A scroll moves the viewport; a repack (delta merge, reorder) moves the
    // layout under a still viewport. Only a scroll should release tiles the
    // user scrolled away from — a repack must keep the on-screen set mounted
    // so tiles neither vanish (cull) nor teleport (fresh mount) as the grid
    // reflows during indexing.
    const viewportScrolled =
      viewport.top !== prevViewportRef.current.top ||
      viewport.bottom !== prevViewportRef.current.bottom;
    const keepMounted =
      gestureActive || !viewportScrolled ? prevVisibleIdsRef.current : null;
    const n = Math.min(geometry.count, layoutItems.length);
    for (let i = 0; i < n; i++) {
      if (i === selectedIndex) continue;
      const id = layoutItems[i].id;
      // The actively-dragged tile always renders so it never flickers out
      // from under the pointer, even when scrolled past the overscan; the
      // gesture keep-set does the same for its neighbours.
      const forced = id === dragItemId || (keepMounted?.has(id) ?? false);
      if (!forced) {
        const tileTop = ys[i];
        const tileBottom = tileTop + heights[i];
        if (tileBottom < top || tileTop > bottom) continue;
      }
      const placement = placementAt(geometry, layoutItems, i);
      out.push(placement);
      byId.set(id, placement);
    }

    placementsRef.current = out;
    placementByIdRef.current = byId;
    columnWidthRef.current = geometry.columnWidth;
    columnCountRef.current = geometry.columnCount;
    // Refresh the keep-set only on a genuine scroll (and never mid-gesture),
    // so it always reflects the tiles on screen at the current scroll
    // position — never a set that grows as repacks reflow the grid or as a
    // drag crosses it. Between scrolls the frozen set is what keeps a repack
    // from culling or teleporting a visible tile.
    if (!gestureActive && viewportScrolled) {
      prevVisibleIdsRef.current = byId;
    }
    prevViewportRef.current = { top, bottom };
    return out;
  }, [
    layout,
    viewport.top,
    viewport.bottom,
    dragItemId,
    gestureActive,
    placementsRef,
    placementByIdRef,
    columnWidthRef,
    columnCountRef,
  ]);

  return { visiblePlacements, height };
}
