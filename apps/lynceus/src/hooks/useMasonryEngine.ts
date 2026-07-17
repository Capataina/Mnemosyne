import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import debounce from "lodash/debounce";
import type { ImageItem } from "../types";
import {
  computeMasonryLayout,
  type MasonryItemPlacement,
} from "../components/masonryPacking";

interface MasonryEngineInput {
  items: ImageItem[] | undefined;
  selectedItem: ImageItem | null;
  minItemWidth: number;
  columnGap: number;
  verticalGap: number;
  columnCountOverride?: number;
  tileScale?: number;
  /** id → rounded span, for the resize footprint. */
  spanOverrides?: Record<number, number>;
  /** The tile currently being drag-reordered — never culled. */
  dragItemId: number | null;
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

/**
 * The headless masonry engine: pure layout (shortest-column packing via
 * computeMasonryLayout) plus viewport virtualization. It owns no
 * interaction state — drag-reorder and drag-resize live in their own
 * hooks and feed only structural state through `spanOverrides` and
 * `dragItemId`. Extracted from the old 514-line Masonry component so the
 * packing/virtualization is testable and the component shell stays thin.
 * Continuous gesture pixels never enter this hook: resize width and drag
 * position are imperative writes to one tile, while this engine runs only
 * for structural inputs and rounded footprints.
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
    dragItemId,
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

  const [placements, setPlacements] = useState<MasonryItemPlacement[]>([]);
  const [height, setHeight] = useState(0);
  const [viewport, setViewport] = useState<{ top: number; bottom: number }>({
    top: 0,
    bottom: 99999,
  });

  const refreshLayout = useCallback(() => {
    if (!containerRef.current || !items) return;
    const width = containerRef.current.clientWidth;
    const out = computeMasonryLayout({
      items,
      selectedItem: selectedItem ?? null,
      containerWidth: width,
      minItemWidth,
      columnGap,
      verticalGap,
      columnCountOverride,
      tileScale,
      spanOverrides,
    });
    setHeight(out.height);
    setPlacements(out.placements);
    placementsRef.current = out.placements;
    placementByIdRef.current = out.placementById;
    columnWidthRef.current = out.columnWidth;
    columnCountRef.current = out.columnCount;
  }, [
    items,
    selectedItem,
    minItemWidth,
    columnGap,
    verticalGap,
    columnCountOverride,
    tileScale,
    spanOverrides,
    containerRef,
    placementsRef,
    placementByIdRef,
    columnWidthRef,
    columnCountRef,
  ]);

  const refreshLayoutDebounced = useMemo(
    () => debounce(() => refreshLayout(), 100),
    [refreshLayout],
  );

  useEffect(() => {
    const onResize = () => refreshLayoutDebounced();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      refreshLayoutDebounced.cancel();
    };
  }, [refreshLayoutDebounced]);

  useEffect(() => {
    refreshLayout();
  }, [refreshLayout]);

  // --- Viewport tracking for virtualization -------------------------
  // `force` commits immediately (mount / re-subscribe / layout change);
  // scroll passes `false` so the guard band can suppress sub-band moves.
  const updateViewport = useCallback((force = false) => {
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
  }, [containerRef]);

  useEffect(() => {
    const scroller = findScrollContainer(containerRef.current);
    scrollerRef.current = scroller;
    if (!scroller) return;
    // Immediate commit on (re)subscribe — a layout change (placements /
    // height) re-runs this effect and must refresh the viewport at once.
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
  }, [updateViewport, containerRef, placements.length, height]);

  const visiblePlacements = useMemo(() => {
    if (placements.length === 0) return placements;
    return placements.filter((p) => {
      // The selected hero and the actively-dragged tile always render so
      // they never flicker out from under the pointer / modal.
      if (p.isSelected || p.itemData.id === dragItemId) return true;
      const top = p.y;
      const bottom = p.y + p.height;
      return bottom >= viewport.top && top <= viewport.bottom;
    });
  }, [placements, viewport.top, viewport.bottom, dragItemId]);

  return { visiblePlacements, height };
}
