import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildPackInput,
  computeMasonryGeometry,
  type MasonryItemPlacement,
} from "../components/masonryPacking";
import type { FeedItem } from "../types";
import { useTileDrag } from "./useTileDrag";

describe("drag release barrier", () => {
  it("retains the final footprint until its authoritative geometry commits", () => {
    const items: FeedItem[] = [
      { id: 1, name: "one", width: 100, height: 100, hasThumbnail: true },
      { id: 2, name: "two", width: 100, height: 100, hasThumbnail: true },
    ];
    const placements: MasonryItemPlacement[] = items.map((item, index) => ({
      itemData: item,
      x: index * 100,
      y: 0,
      width: 100,
      height: 100,
      colSpan: 1,
      isSelected: false,
    }));
    const onReorder = vi.fn();
    const suppressClick = vi.fn();
    const { result } = renderHook(() =>
      useTileDrag({
        enabled: true,
        items,
        placementsRef: { current: placements },
        placementByIdRef: {
          current: new Map(placements.map((placement) => [placement.itemData.id, placement])),
        },
        tileElementsRef: { current: new Map() },
        columnWidthRef: { current: 100 },
        columnCountRef: { current: 2 },
        columnGap: 0,
        onReorder,
        suppressClick,
      }),
    );

    act(() => {
      result.current.onDragHandlePointerDown(1, {
        clientX: 50,
        clientY: 50,
      } as React.PointerEvent<HTMLDivElement>);
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 150, clientY: 50 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 150, clientY: 50 }),
      );
    });

    const finalFootprint = result.current.gestureFootprint;
    expect(finalFootprint).toMatchObject({
      id: 1,
      span: 1,
      startCol: 1,
      top: 0,
    });
    expect(result.current.dragItemId).toBe(1);
    expect(onReorder).not.toHaveBeenCalled();
    expect(suppressClick).toHaveBeenCalledOnce();

    const geometry = computeMasonryGeometry(
      buildPackInput(items, null, {
        containerWidth: 200,
        minItemWidth: 100,
        columnGap: 0,
        verticalGap: 0,
        columnCountOverride: 2,
        gestureFootprint: finalFootprint,
      }),
    );
    act(() => {
      result.current.onGestureGeometryCommitted(
        finalFootprint!,
        geometry,
        items,
      );
    });

    expect(result.current.gestureFootprint).toBeUndefined();
    // The active ghost stays mounted at the literal drop rectangle until the
    // following dense geometry is authoritative.
    expect(result.current.dragItemId).toBe(1);
    expect(onReorder).toHaveBeenCalledWith([2, 1], { id: 1, startCol: 1 });

    act(() => {
      result.current.onGestureSettled();
      result.current.finishSettlingVisual();
    });
    expect(result.current.dragItemId).toBeNull();
  });

  it("writes pointer-exact motion to only the active wrapper", async () => {
    const item: FeedItem = {
      id: 1,
      name: "one",
      width: 100,
      height: 100,
      hasThumbnail: true,
    };
    const placement: MasonryItemPlacement = {
      itemData: item,
      x: 100,
      y: 200,
      width: 100,
      height: 100,
      colSpan: 1,
      isSelected: false,
    };
    const node = document.createElement("div");
    const { result } = renderHook(() =>
      useTileDrag({
        enabled: true,
        items: [item],
        placementsRef: { current: [placement] },
        placementByIdRef: { current: new Map([[1, placement]]) },
        tileElementsRef: { current: new Map([[1, node]]) },
        columnWidthRef: { current: 100 },
        columnCountRef: { current: 4 },
        columnGap: 0,
        suppressClick: vi.fn(),
      }),
    );

    act(() => {
      result.current.onDragHandlePointerDown(1, {
        clientX: 150,
        clientY: 250,
      } as React.PointerEvent<HTMLDivElement>);
    });
    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 187, clientY: 269 }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(node.style.transform).toBe("translate3d(37px, 19px, 0)");
    // The ghost is pixel-exact; the published footprint's top steps in 48px
    // quanta RELATIVE to the gesture origin (base.y 200, +19px of travel →
    // still 200), so the first footprint never phase-shifts off the tile.
    expect(result.current.gestureFootprint?.top).toBe(200);
  });

  it("treats a drop back onto the source slot as a genuine no-op", () => {
    const items: FeedItem[] = [
      { id: 1, name: "one", width: 100, height: 100, hasThumbnail: true },
      { id: 2, name: "two", width: 100, height: 100, hasThumbnail: true },
    ];
    const placements: MasonryItemPlacement[] = items.map((item, index) => ({
      itemData: item,
      x: index * 100,
      y: 0,
      width: 100,
      height: 100,
      colSpan: 1,
      isSelected: false,
    }));
    const onReorder = vi.fn();
    const { result } = renderHook(() =>
      useTileDrag({
        enabled: true,
        items,
        placementsRef: { current: placements },
        placementByIdRef: {
          current: new Map(
            placements.map((placement) => [placement.itemData.id, placement]),
          ),
        },
        tileElementsRef: { current: new Map() },
        columnWidthRef: { current: 100 },
        columnCountRef: { current: 2 },
        columnGap: 0,
        onReorder,
        suppressClick: vi.fn(),
      }),
    );

    act(() => {
      result.current.onDragHandlePointerDown(1, {
        clientX: 50,
        clientY: 50,
      } as React.PointerEvent<HTMLDivElement>);
    });
    // Wiggle within the source slot: under the drag threshold's reach but a
    // real move, ending where it began.
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 62, clientY: 55 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 62, clientY: 55 }),
      );
    });

    const footprint = result.current.gestureFootprint!;
    expect(footprint.startCol).toBe(0);
    const geometry = computeMasonryGeometry(
      buildPackInput(items, null, {
        containerWidth: 200,
        minItemWidth: 100,
        columnGap: 0,
        verticalGap: 0,
        columnCountOverride: 2,
        gestureFootprint: footprint,
      }),
    );
    act(() => {
      result.current.onGestureGeometryCommitted(footprint, geometry, items);
    });

    // Same slot → no reorder, no anchor; the grid settles exactly as it was.
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.gestureFootprint).toBeUndefined();
  });

  it("keeps the source-slot no-op for tiles shorter than the top quantum", () => {
    // Adversarial finding from the fix-round review: the guard once compared
    // the 48px-QUANTISED footprint top against the raw pre-gesture y, so a
    // tile shorter than 48px (half-height under the ±24px quantisation
    // noise) could misread a zero-motion release as a real move — purely as
    // a function of its y position modulo 48. Two defences now hold: the
    // quantisation is relative to the gesture origin (no phantom at source)
    // and the guard reads the raw ghost rectangle. Tile: height 30 at y=22.
    const items: FeedItem[] = [
      { id: 1, name: "one", width: 300, height: 30, hasThumbnail: true },
      { id: 2, name: "two", width: 300, height: 30, hasThumbnail: true },
    ];
    const placements: MasonryItemPlacement[] = items.map((item, index) => ({
      itemData: item,
      x: index * 100,
      y: 22,
      width: 100,
      height: 30,
      colSpan: 1,
      isSelected: false,
    }));
    const onReorder = vi.fn();
    const { result } = renderHook(() =>
      useTileDrag({
        enabled: true,
        items,
        placementsRef: { current: placements },
        placementByIdRef: {
          current: new Map(
            placements.map((placement) => [placement.itemData.id, placement]),
          ),
        },
        tileElementsRef: { current: new Map() },
        columnWidthRef: { current: 100 },
        columnCountRef: { current: 2 },
        columnGap: 0,
        onReorder,
        suppressClick: vi.fn(),
      }),
    );

    act(() => {
      result.current.onDragHandlePointerDown(1, {
        clientX: 50,
        clientY: 40,
      } as React.PointerEvent<HTMLDivElement>);
    });
    // Horizontal-only wiggle past the drag threshold; the tile never leaves
    // its slot vertically, so the release must be a no-op.
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 60, clientY: 40 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 60, clientY: 40 }),
      );
    });

    const footprint = result.current.gestureFootprint!;
    expect(footprint.top).toBe(22); // origin-relative: no quantised phantom
    const geometry = computeMasonryGeometry(
      buildPackInput(items, null, {
        containerWidth: 200,
        minItemWidth: 100,
        columnGap: 0,
        verticalGap: 0,
        columnCountOverride: 2,
        gestureFootprint: footprint,
      }),
    );
    act(() => {
      result.current.onGestureGeometryCommitted(footprint, geometry, items);
    });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("commits a tall tile's same-column move past the tolerance cap", () => {
    // The counterpart adversarial finding: an uncapped half-height tolerance
    // let a TALL tile swallow genuine same-column moves inside its own half
    // height. The cap (1.5 × the 48px quantum = 72px) keeps a ~100px
    // deliberate vertical move committing even on a 300px-tall tile.
    const items: FeedItem[] = [
      { id: 1, name: "one", width: 100, height: 300, hasThumbnail: true },
      { id: 2, name: "two", width: 100, height: 300, hasThumbnail: true },
    ];
    const placements: MasonryItemPlacement[] = items.map((item, index) => ({
      itemData: item,
      x: 0,
      y: index * 316,
      width: 100,
      height: 300,
      colSpan: 1,
      isSelected: false,
    }));
    const onReorder = vi.fn();
    const { result } = renderHook(() =>
      useTileDrag({
        enabled: true,
        items,
        placementsRef: { current: placements },
        placementByIdRef: {
          current: new Map(
            placements.map((placement) => [placement.itemData.id, placement]),
          ),
        },
        tileElementsRef: { current: new Map() },
        columnWidthRef: { current: 100 },
        columnCountRef: { current: 2 },
        columnGap: 0,
        onReorder,
        suppressClick: vi.fn(),
      }),
    );

    act(() => {
      result.current.onDragHandlePointerDown(1, {
        clientX: 50,
        clientY: 50,
      } as React.PointerEvent<HTMLDivElement>);
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 50, clientY: 150 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 50, clientY: 150 }),
      );
    });

    const footprint = result.current.gestureFootprint!;
    expect(footprint.startCol).toBe(0); // same column throughout
    const geometry = computeMasonryGeometry(
      buildPackInput(items, null, {
        containerWidth: 200,
        minItemWidth: 100,
        columnGap: 0,
        verticalGap: 0,
        columnCountOverride: 2,
        gestureFootprint: footprint,
      }),
    );
    act(() => {
      result.current.onGestureGeometryCommitted(footprint, geometry, items);
    });

    expect(onReorder).toHaveBeenCalledWith([2, 1], { id: 1, startCol: 0 });
  });

  it("animates the retained drop ghost to the authoritative dense slot", () => {
    vi.useFakeTimers();
    try {
      const items: FeedItem[] = [
        { id: 1, name: "one", width: 100, height: 100, hasThumbnail: true },
        { id: 2, name: "two", width: 100, height: 100, hasThumbnail: true },
      ];
      const placements: MasonryItemPlacement[] = items.map((item, index) => ({
        itemData: item,
        x: index * 100,
        y: 0,
        width: 100,
        height: 100,
        colSpan: 1,
        isSelected: false,
      }));
      const placementByIdRef = {
        current: new Map(
          placements.map((placement) => [placement.itemData.id, placement]),
        ),
      };
      const node = document.createElement("div");
      const { result } = renderHook(() =>
        useTileDrag({
          enabled: true,
          items,
          placementsRef: { current: placements },
          placementByIdRef,
          tileElementsRef: { current: new Map([[1, node]]) },
          columnWidthRef: { current: 100 },
          columnCountRef: { current: 2 },
          columnGap: 0,
          suppressClick: vi.fn(),
        }),
      );

      act(() => {
        result.current.onDragHandlePointerDown(1, {
          clientX: 50,
          clientY: 50,
        } as React.PointerEvent<HTMLDivElement>);
      });
      act(() => {
        window.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 150, clientY: 50 }),
        );
      });
      act(() => {
        window.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 150, clientY: 50 }),
        );
      });

      const footprint = result.current.gestureFootprint!;
      const geometry = computeMasonryGeometry(
        buildPackInput(items, null, {
          containerWidth: 200,
          minItemWidth: 100,
          columnGap: 0,
          verticalGap: 0,
          columnCountOverride: 2,
          gestureFootprint: footprint,
        }),
      );
      act(() => {
        result.current.onGestureGeometryCommitted(footprint, geometry, items);
      });

      // Model the following dense commit moving the active anchor behind its
      // still-visible drop ghost. The wrapper must interpolate that remaining
      // delta instead of exposing the anchor jump.
      placementByIdRef.current = new Map([
        [1, { ...placements[0], x: 100 }],
        [2, { ...placements[1], x: 0 }],
      ]);
      act(() => {
        result.current.onGestureSettled();
        result.current.finishSettlingVisual();
      });

      expect(node.style.transition).toBe("transform 400ms ease-in-out");
      expect(node.style.transform).toBe("translate3d(0px, 0px, 0)");
      expect(result.current.dragItemId).toBe(1);

      act(() => vi.advanceTimersByTime(450));
      expect(result.current.dragItemId).toBeNull();
      expect(node.style.transition).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});
