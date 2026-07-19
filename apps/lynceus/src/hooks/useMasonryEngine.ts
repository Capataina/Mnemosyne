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
  type MasonryGestureFootprint,
  type MasonryGeometry,
  type MasonryItemPlacement,
  type MasonryPackInput,
  type MasonryPackParams,
  type MasonryPlacementAnchor,
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
  /** Stable-id 2D obstacle for the one active drag or resize transaction. */
  gestureFootprint?: MasonryGestureFootprint;
  /** Session rectangle pins for gesture-placed tiles; threaded into every
   * pack so settle and later steady-state packs preserve the committed slot. */
  placementAnchors?: Record<number, MasonryPlacementAnchor>;
  /** Confirms that the current generation committed the exact active
   * footprint. Drag release uses this barrier before clearing into settle. */
  onGestureGeometryCommitted?: (
    footprint: MasonryGestureFootprint,
    geometry: MasonryGeometry,
    items: FeedItem[],
  ) => void;
  /** Fires after the first accepted no-footprint geometry closes settling.
   * Active hooks use it to animate their cosmetic ghost to that anchor. */
  onGestureSettled?: () => void;
  /** Fires when the pack's coordinate basis changes (container width, column
   * count/scale, gaps). Placement-anchor tops are absolute pixels in that
   * basis, so the host clears its pins here — a pin from the old space would
   * otherwise reserve a stale rectangle and strand a tile in a void. */
  onGeometryBasisChanged?: () => void;
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
  /** A release pack is outstanding. Any accepted newer generation clears it. */
  settling: boolean;
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

/** The scalar configuration that defines the pack's pixel coordinate space.
 * Items, selection, and anchors are deliberately NOT part of it. */
export interface MasonryGeometryBasis {
  width: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  columnCountOverride: number;
  tileScale: number;
}

/** Pure so the basis-invalidation trigger is unit-testable without mounting
 * the hook (the file's standing pattern for wiring-adjacent decisions). */
export function sameGeometryBasis(
  a: MasonryGeometryBasis,
  b: MasonryGeometryBasis,
): boolean {
  return (
    a.width === b.width &&
    a.minItemWidth === b.minItemWidth &&
    a.columnGap === b.columnGap &&
    a.verticalGap === b.verticalGap &&
    a.columnCountOverride === b.columnCountOverride &&
    a.tileScale === b.tileScale
  );
}

export type MasonryGesturePhase = "idle" | "active" | "settling";
export type MasonryGestureEvent = "activate" | "release" | "commit";

/** Explicit non-stranding release machine. A fresh gesture supersedes an old
 * settle; an authoritative commit only closes settling, never an active one. */
export function transitionMasonryGesturePhase(
  phase: MasonryGesturePhase,
  event: MasonryGestureEvent,
): MasonryGesturePhase {
  if (event === "activate") return "active";
  if (event === "release") return phase === "active" ? "settling" : phase;
  return phase === "settling" ? "idle" : phase;
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
  revision: number;
  items: FeedItem[];
  selectedItem: FeedItem | null;
  input: MasonryPackInput;
}

interface PackInputCache {
  items: FeedItem[];
  selectedItem: FeedItem | null;
  width: number;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  columnCountOverride: number;
  tileScale: number;
  placementAnchors: Record<number, MasonryPlacementAnchor> | undefined;
  revision: number;
  input: MasonryPackInput;
}

const EMPTY_PLACEMENTS: MasonryItemPlacement[] = [];

/**
 * The headless masonry engine: shortest-column packing (off the main thread
 * via a Web Worker, T3-3) plus viewport virtualization. It owns no
 * interaction state — drag-reorder and drag-resize publish one stable-id 2D
 * footprint, and the engine owns the active → settling → idle hand-off.
 *
 * The pack is asynchronous: the engine holds the committed geometry as flat
 * typed arrays (not 100k placement objects) and materialises placement
 * objects only for the visible window. Requests are generation-tagged so
 * stale results are discarded; the first paint (or a large expansion) shows
 * a synchronous prefix so the grid is never empty; a worker failure falls
 * back to synchronous packing. Gesture frames enter as one stable-id numeric
 * footprint; catalogue-sized arrays stay cached by base revision. The anchor
 * renders committed geometry while one active inner wrapper may carry a
 * pointer-exact cosmetic delta that never enters packing or telemetry.
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
    gestureFootprint,
    placementAnchors,
    containerRef,
    placementsRef,
    placementByIdRef,
    columnWidthRef,
    columnCountRef,
  } = input;

  const scrollerRef = useRef<HTMLElement | null>(null);
  const onGestureCommitRef = useRef(input.onGestureGeometryCommitted);
  onGestureCommitRef.current = input.onGestureGeometryCommitted;
  const onGestureSettledRef = useRef(input.onGestureSettled);
  onGestureSettledRef.current = input.onGestureSettled;
  const onGeometryBasisChangedRef = useRef(input.onGeometryBasisChanged);
  onGeometryBasisChangedRef.current = input.onGeometryBasisChanged;
  // The basis the previous pack ran in; null until the first pack, which
  // must not fire the invalidation (there is nothing stale to clear yet).
  const geometryBasisRef = useRef<MasonryGeometryBasis | null>(null);
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
  const inputRevisionRef = useRef(0);
  const inputCacheRef = useRef<PackInputCache | null>(null);
  // The release transaction is generation-based: active → settling when the
  // footprint clears, then settling → idle when that final dense pack OR any
  // newer authoritative generation commits. It cannot strand on supersession.
  const gesturePhaseRef = useRef<MasonryGesturePhase>("idle");
  const [gesturePhase, setGesturePhase] =
    useState<MasonryGesturePhase>("idle");
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

  const finishSettling = useCallback(() => {
    const next = transitionMasonryGesturePhase(
      gesturePhaseRef.current,
      "commit",
    );
    if (next === gesturePhaseRef.current) return;
    gesturePhaseRef.current = next;
    setGesturePhase(next);
    onGestureSettledRef.current?.();
  }, []);

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

  // Request the latest geometry. Catalogue-sized arrays are rebuilt only when
  // the base revision changes; gesture-only renders reuse them and enqueue an
  // O(1) footprint update in the worker client.
  const requestPack = useCallback(() => {
    const gestureIsActive = gestureFootprint !== undefined;
    const priorPhase = gesturePhaseRef.current;
    const event: MasonryGestureEvent = gestureIsActive
      ? "activate"
      : "release";
    const nextPhase = transitionMasonryGesturePhase(priorPhase, event);
    const enteredSettling =
      priorPhase === "active" && nextPhase === "settling";
    if (nextPhase !== priorPhase) {
      gesturePhaseRef.current = nextPhase;
      setGesturePhase(nextPhase);
    }

    const container = containerRef.current;
    if (!container || !items) {
      if (enteredSettling) finishSettling();
      return;
    }
    const sel = selectedItem ?? null;
    const width = container.clientWidth;
    const normalisedOverride = columnCountOverride ?? 0;
    const normalisedScale = tileScale ?? 1;

    // Placement-anchor tops are pixels in THIS basis. When it changes, tell
    // the host before packing so stale pins never reserve old-space rects.
    const basis: MasonryGeometryBasis = {
      width,
      minItemWidth,
      columnGap,
      verticalGap,
      columnCountOverride: normalisedOverride,
      tileScale: normalisedScale,
    };
    const previousBasis = geometryBasisRef.current;
    geometryBasisRef.current = basis;
    if (previousBasis && !sameGeometryBasis(previousBasis, basis)) {
      onGeometryBasisChangedRef.current?.();
    }

    const cached = inputCacheRef.current;
    let base: PackInputCache;
    if (
      cached &&
      cached.items === items &&
      cached.selectedItem === sel &&
      cached.width === width &&
      cached.minItemWidth === minItemWidth &&
      cached.columnGap === columnGap &&
      cached.verticalGap === verticalGap &&
      cached.columnCountOverride === normalisedOverride &&
      cached.tileScale === normalisedScale &&
      cached.placementAnchors === placementAnchors
    ) {
      base = cached;
    } else {
      const params: MasonryPackParams = {
        containerWidth: width,
        minItemWidth,
        columnGap,
        verticalGap,
        columnCountOverride: normalisedOverride,
        tileScale: normalisedScale,
        placementAnchors,
      };
      base = {
        items,
        selectedItem: sel,
        width,
        minItemWidth,
        columnGap,
        verticalGap,
        columnCountOverride: normalisedOverride,
        tileScale: normalisedScale,
        placementAnchors,
        revision: ++inputRevisionRef.current,
        input: buildPackInput(items, sel, params),
      };
      inputCacheRef.current = base;
    }

    const fullInput: MasonryPackInput = {
      ...base.input,
      gestureFootprint: gestureFootprint
        ? { ...gestureFootprint }
        : null,
    };
    const gen = ++genRef.current;

    const prefixParams: MasonryPackParams = {
      containerWidth: width,
      minItemWidth,
      columnGap,
      verticalGap,
      columnCountOverride: normalisedOverride,
      tileScale: normalisedScale,
      gestureFootprint,
      placementAnchors,
    };

    // First paint (nothing to keep) or a large expansion (old set dwarfed):
    // pack a synchronous prefix now so the grid is never empty / never left
    // showing a tiny stale set under a big new feed.
    const committedCount = layoutRef.current?.items.length ?? 0;
    const needPrefix =
      committedCount === 0 || items.length > committedCount * RESET_EXPANSION_RATIO;
    if (needPrefix && !gestureIsActive && items.length > 0 && width > 0) {
      const prefixCount = Math.min(items.length, PREFIX_PACK_COUNT);
      const prefixItems =
        prefixCount === items.length ? items : items.slice(0, prefixCount);
      const prefixGeo = computeMasonryGeometry(
        buildPackInput(prefixItems, sel, prefixParams),
      );
      commit(prefixGeo, prefixItems, sel, true);
    }

    packContextRef.current = {
      gen,
      revision: base.revision,
      items,
      selectedItem: sel,
      input: fullInput,
    };
    const packer = packerRef.current;
    if (packer) {
      packer.pack(gen, base.revision, fullInput);
    } else {
      const geometry = computeMasonryGeometry(fullInput);
      commit(geometry, items, sel, false);
      if (fullInput.gestureFootprint) {
        onGestureCommitRef.current?.(
          fullInput.gestureFootprint,
          geometry,
          items,
        );
      }
      finishSettling();
    }
  }, [
    items,
    selectedItem,
    minItemWidth,
    columnGap,
    verticalGap,
    columnCountOverride,
    tileScale,
    gestureFootprint,
    placementAnchors,
    containerRef,
    commit,
    finishSettling,
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
      if (ctx.input.gestureFootprint) {
        onGestureCommitRef.current?.(
          ctx.input.gestureFootprint,
          geometry,
          ctx.items,
        );
      }
      // This result is the current generation. If it superseded a release
      // generation, that is equally authoritative and must clear settling.
      finishSettling();
    });
    packer.onFailure(() => {
      // A live worker died mid-flight: re-run the latest pack synchronously
      // from the source items the engine still holds. The grid must never
      // depend on worker availability. Skip a request the engine has already
      // moved past — mirrors the generation check onResult applies.
      const ctx = packContextRef.current;
      if (!ctx || ctx.gen !== genRef.current) return;
      const geometry = computeMasonryGeometry(ctx.input);
      commit(geometry, ctx.items, ctx.selectedItem, false);
      if (ctx.input.gestureFootprint) {
        onGestureCommitRef.current?.(
          ctx.input.gestureFootprint,
          geometry,
          ctx.items,
        );
      }
      finishSettling();
    });
    return () => {
      packer.dispose();
      packerRef.current = null;
    };
  }, [commit, finishSettling]);

  const requestPackRef = useRef(requestPack);
  requestPackRef.current = requestPack;
  const requestPackDebounced = useMemo(
    () => debounce(() => requestPackRef.current(), 100),
    [],
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

  // Only the stable active id affects culling. Keeping the complete footprint
  // out of the dependency list is a 100k-scale invariant: pixel-level pointer
  // updates must not rescan every committed geometry row on the main thread.
  const activeGestureId = gestureFootprint?.id ?? null;
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
    const settling = gesturePhase === "settling";
    const interactionActive = activeGestureId !== null || settling;
    const gestureId = activeGestureId ?? -1;
    const keepMounted =
      interactionActive || !viewportScrolled
        ? prevVisibleIdsRef.current
        : null;
    const n = Math.min(geometry.count, layoutItems.length);
    for (let i = 0; i < n; i++) {
      if (i === selectedIndex) continue;
      const id = layoutItems[i].id;
      // The actively-dragged tile always renders so it never flickers out
      // from under the pointer, even when scrolled past the overscan; the
      // gesture keep-set does the same for its neighbours.
      const forced = id === gestureId || (keepMounted?.has(id) ?? false);
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
    if (!interactionActive && viewportScrolled) {
      prevVisibleIdsRef.current = byId;
    }
    prevViewportRef.current = { top, bottom };
    return out;
  }, [
    layout,
    viewport.top,
    viewport.bottom,
    activeGestureId,
    gesturePhase,
    placementsRef,
    placementByIdRef,
    columnWidthRef,
    columnCountRef,
  ]);

  return {
    visiblePlacements,
    height,
    settling: gesturePhase === "settling",
  };
}
