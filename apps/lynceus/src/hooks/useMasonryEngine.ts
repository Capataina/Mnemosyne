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

/**
 * Live drag-resize preview for the single active tile: its footprint in
 * the packer is the rounded `span` (so the rest of the grid reflows in
 * whole-column steps), but the tile itself is rendered at a *continuous*
 * pixel width so the resize follows the pointer smoothly instead of
 * jumping a whole column at a time. On release the caller commits the
 * rounded span and the two converge.
 */
export interface ResizePreview {
  id: number;
  /** Continuous rendered width in px for the active tile. */
  px: number;
  /** True for left-side corners: anchor the tile's right edge so it
   *  grows leftward, matching which corner the pointer grabbed. */
  leftAnchored: boolean;
}

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
  /** Continuous-width override for the active resize tile. */
  resizePreview?: ResizePreview | null;
  /** The tile currently being drag-reordered — never culled. */
  dragItemId: number | null;
  // Shell-owned refs the engine populates so the interaction hooks can
  // read live layout data without re-subscribing on every pointer move.
  containerRef: RefObject<HTMLDivElement | null>;
  placementsRef: RefObject<MasonryItemPlacement[]>;
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

/** Apply the continuous-width resize preview to the active placement. */
function applyResizePreview(
  placements: MasonryItemPlacement[],
  preview: ResizePreview | null | undefined,
): MasonryItemPlacement[] {
  if (!preview) return placements;
  return placements.map((p) => {
    if (p.itemData.id !== preview.id) return p;
    const aspect = p.itemData.height / p.itemData.width;
    const width = preview.px;
    const height = width * aspect;
    // Left corners anchor the tile's right edge (grow leftward); right
    // corners keep x fixed (grow rightward).
    const x = preview.leftAnchored ? p.x + p.width - width : p.x;
    return { ...p, x, width, height };
  });
}

/**
 * The headless masonry engine: pure layout (shortest-column packing via
 * computeMasonryLayout) plus viewport virtualization. It owns no
 * interaction state — drag-reorder and drag-resize live in their own
 * hooks and feed their preview state in through `spanOverrides`,
 * `resizePreview`, and `dragItemId`. Extracted from the old 514-line
 * Masonry component so the packing/virtualization is testable and the
 * component shell stays thin.
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
    resizePreview,
    dragItemId,
    containerRef,
    placementsRef,
    columnWidthRef,
    columnCountRef,
  } = input;

  const scrollerRef = useRef<HTMLElement | null>(null);

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
    const patched = applyResizePreview(out.placements, resizePreview);
    setHeight(out.height);
    setPlacements(patched);
    placementsRef.current = patched;
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
    resizePreview,
    containerRef,
    placementsRef,
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
    return () => window.removeEventListener("resize", onResize);
  }, [refreshLayoutDebounced]);

  useEffect(() => {
    refreshLayout();
  }, [refreshLayout]);

  // --- Viewport tracking for virtualization -------------------------
  const updateViewport = useCallback(() => {
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
    updateViewport();
    const target = scroller === document.documentElement ? window : scroller;
    target.addEventListener("scroll", updateViewport, { passive: true });
    return () => target.removeEventListener("scroll", updateViewport);
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
