import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MasonryItemPlacement } from "../components/masonryPacking";
import {
  anchorStartColFor,
  resizePreviewForSpan,
  resizeVisualForPointer,
  useTileResize,
  type ResizeBaseGeometry,
  type ResizeCorner,
} from "./useTileResize";

describe("resize corner geometry", () => {
  const base: ResizeBaseGeometry = {
    id: 1,
    startCol: 2,
    baseSpan: 1,
    x: 200,
    y: 300,
    width: 100,
    height: 50,
  };
  const preview = (corner: ResizeCorner) =>
    resizePreviewForSpan(corner, base, 3, 100, 0, 6);

  it("right grips keep the left edge fixed", () => {
    expect(anchorStartColFor("br", 2, 1, 3)).toBe(2);
    expect(anchorStartColFor("tr", 2, 1, 3)).toBe(2);
    expect(preview("br").x).toBe(base.x);
    expect(preview("tr").x).toBe(base.x);
  });

  it("left grips keep the right edge fixed", () => {
    for (const corner of ["bl", "tl"] as const) {
      const next = preview(corner);
      expect(next.x + next.width).toBe(base.x + base.width);
    }
  });

  it("bottom grips keep the top edge fixed", () => {
    expect(preview("bl").y).toBe(base.y);
    expect(preview("br").y).toBe(base.y);
  });

  it("top grips grow upward and keep the bottom edge fixed", () => {
    for (const corner of ["tl", "tr"] as const) {
      const next = preview(corner);
      expect(next.y).toBeLessThan(base.y);
      expect(next.y + next.height).toBe(base.y + base.height);
    }
  });

  it("all four corners preserve their complete opposite corner", () => {
    const opposite = {
      br: [base.x, base.y],
      bl: [base.x + base.width, base.y],
      tr: [base.x, base.y + base.height],
      tl: [base.x + base.width, base.y + base.height],
    } satisfies Record<ResizeCorner, [number, number]>;
    for (const corner of ["tl", "tr", "bl", "br"] as const) {
      const next = preview(corner);
      const actual: [number, number] = [
        corner === "tl" || corner === "bl" ? next.x + next.width : next.x,
        corner === "tl" || corner === "tr" ? next.y + next.height : next.y,
      ];
      expect(actual).toEqual(opposite[corner]);
    }
  });

  it("keeps a pixel-exact preview between whole-column boundaries", () => {
    const next = resizeVisualForPointer("br", base, 50, 0, 100, 0, 6);
    expect(next.width).toBe(150);
    expect(next.height).toBe(75);
    expect(next.x).toBe(base.x);
    expect(next.y).toBe(base.y);
  });
});

describe("resize commit sequencing", () => {
  it("writes an exact in-between width to the active wrapper", async () => {
    const placement: MasonryItemPlacement = {
      itemData: {
        id: 6,
        name: "tile-6",
        width: 100,
        height: 100,
        hasThumbnail: true,
      },
      x: 100,
      y: 200,
      width: 100,
      height: 100,
      colSpan: 1,
      isSelected: false,
    };
    const node = document.createElement("div");
    const { result } = renderHook(() =>
      useTileResize({
        enabled: true,
        columnWidthRef: { current: 100 },
        columnCountRef: { current: 4 },
        columnGap: 0,
        placementsRef: { current: [placement] },
        placementByIdRef: { current: new Map([[6, placement]]) },
        tileElementsRef: { current: new Map([[6, node]]) },
        suppressClick: vi.fn(),
      }),
    );

    act(() => {
      result.current.onResizeHandlePointerDown(6, "br", {
        clientX: 200,
        clientY: 300,
      } as React.PointerEvent<HTMLDivElement>);
    });
    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 237, clientY: 300 }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(node.style.width).toBe("137px");
    expect(node.style.height).toBe("137px");
    expect(result.current.gestureFootprint?.span).toBe(1);
  });

  it("retains the final span footprint until persistence resolves", async () => {
    let resolveCommit: (() => void) | undefined;
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const placement: MasonryItemPlacement = {
      itemData: {
        id: 7,
        name: "tile-7",
        width: 100,
        height: 100,
        hasThumbnail: true,
        manualColSpan: null,
      },
      x: 100,
      y: 200,
      width: 100,
      height: 100,
      colSpan: 1,
      isSelected: false,
    };
    const columnWidthRef = { current: 100 };
    const columnCountRef = { current: 4 };
    const placementsRef = { current: [placement] };
    const placementByIdRef = { current: new Map([[7, placement]]) };

    const { result } = renderHook(() =>
      useTileResize({
        enabled: true,
        columnWidthRef,
        columnCountRef,
        columnGap: 0,
        placementsRef,
        placementByIdRef,
        tileElementsRef: { current: new Map() },
        onResizeCommit: commit,
        suppressClick: vi.fn(),
      }),
    );

    act(() => {
      result.current.onResizeHandlePointerDown(7, "br", {
        clientX: 200,
        clientY: 300,
      } as React.PointerEvent<HTMLDivElement>);
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 300, clientY: 400 }),
      );
    });

    expect(commit).toHaveBeenCalledWith(7, 2);
    expect(result.current.resizeState?.phase).toBe("committing");
    expect(result.current.gestureFootprint?.span).toBe(2);

    await act(async () => {
      resolveCommit?.();
      await Promise.resolve();
    });
    expect(result.current.resizeState?.phase).toBe("settling");
    expect(result.current.gestureFootprint).toBeUndefined();

    act(() => {
      result.current.onGestureSettled();
      result.current.finishSettlingVisual();
    });
    expect(result.current.resizeState).toBeNull();
  });

  it("refuses to start when the surrounding view disables gestures", () => {
    const placement: MasonryItemPlacement = {
      itemData: {
        id: 8,
        name: "tile-8",
        width: 100,
        height: 100,
        hasThumbnail: true,
      },
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      colSpan: 1,
      isSelected: false,
    };
    const { result } = renderHook(() =>
      useTileResize({
        enabled: false,
        columnWidthRef: { current: 100 },
        columnCountRef: { current: 4 },
        columnGap: 0,
        placementsRef: { current: [placement] },
        placementByIdRef: { current: new Map([[8, placement]]) },
        tileElementsRef: { current: new Map() },
        suppressClick: vi.fn(),
      }),
    );

    act(() => {
      result.current.onResizeHandlePointerDown(8, "br", {
        clientX: 100,
        clientY: 100,
      } as React.PointerEvent<HTMLDivElement>);
    });
    expect(result.current.resizeState).toBeNull();
  });

  it("cancels an active footprint when opening a view disables resize", () => {
    const placement: MasonryItemPlacement = {
      itemData: {
        id: 9,
        name: "tile-9",
        width: 100,
        height: 100,
        hasThumbnail: true,
      },
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      colSpan: 1,
      isSelected: false,
    };
    const node = document.createElement("div");
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useTileResize({
          enabled,
          columnWidthRef: { current: 100 },
          columnCountRef: { current: 4 },
          columnGap: 0,
          placementsRef: { current: [placement] },
          placementByIdRef: { current: new Map([[9, placement]]) },
          tileElementsRef: { current: new Map([[9, node]]) },
          suppressClick: vi.fn(),
        }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      result.current.onResizeHandlePointerDown(9, "br", {
        clientX: 100,
        clientY: 100,
      } as React.PointerEvent<HTMLDivElement>);
    });
    expect(result.current.gestureFootprint?.id).toBe(9);

    rerender({ enabled: false });
    expect(result.current.resizeState).toBeNull();
    expect(result.current.gestureFootprint).toBeUndefined();
    expect(node.style.willChange).toBe("");
  });
});
