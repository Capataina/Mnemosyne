import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  anchoredZoom,
  constrainZoomTransform,
  distance,
  DOUBLE_TAP_WINDOW_MS,
  DRAG_THRESHOLD_PX,
  FIT_TRANSFORM,
  getGeometry,
  getImage,
  isDoubleTap,
  localPoint,
  MIN_SCALE,
  midpoint,
  naturalPixelScale,
  resolveWheelGesture,
  stageCentre,
  transformFromAnchor,
  ZOOM_EPSILON,
  zoomTransformAroundPoint,
  type AnchoredZoom,
  type Point,
  type WebKitGestureEvent,
  type ZoomTransform,
} from "./zoomGeometry";

type UseGestureZoomOptions = {
  imageId: number;
  onInteraction: () => void;
};

type UseGestureZoomResult = {
  stageRef: RefObject<HTMLDivElement | null>;
  zoomLabelRef: RefObject<HTMLSpanElement | null>;
  isZoomed: boolean;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  pointerHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  };
};

export function useGestureZoom({
  imageId,
  onInteraction,
}: UseGestureZoomOptions): UseGestureZoomResult {
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const transformRef = useRef<ZoomTransform>(FIT_TRANSFORM);
  const pointersRef = useRef(new Map<number, Point>());
  const pointerStartRef = useRef<Point | null>(null);
  const dragStartRef = useRef<
    { point: Point; transform: ZoomTransform } | null
  >(null);
  const pinchRef = useRef<
    {
      distance: number;
      startScale: number;
      anchor: AnchoredZoom;
    } | null
  >(null);
  const gestureRef = useRef<
    { startScale: number; anchor: AnchoredZoom } | null
  >(null);
  const gestureMovedRef = useRef(false);
  const gesturePinchedRef = useRef(false);
  const lastTapRef = useRef<{ at: number; point: Point } | null>(null);
  const suppressDoubleClickUntilRef = useRef(0);
  const zoomedRef = useRef(false);
  const [isZoomed, setIsZoomed] = useState(false);

  const updateZoomReadout = useCallback((stage: HTMLDivElement, scale: number) => {
    const image = getImage(stage);
    const oneToOneScale = naturalPixelScale(
      image?.naturalWidth ?? 0,
      image?.offsetWidth ?? 0,
    );
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(
        (scale / oneToOneScale) * 100,
      )}%`;
    }

    const zoomed = scale > MIN_SCALE + ZOOM_EPSILON;
    if (zoomedRef.current !== zoomed) {
      zoomedRef.current = zoomed;
      setIsZoomed(zoomed);
    }
  }, []);

  const applyTransform = useCallback(
    (next: ZoomTransform) => {
      const stage = stageRef.current;
      if (!stage) return;
      const constrained = constrainZoomTransform(next, getGeometry(stage));
      transformRef.current = constrained;
      const image = getImage(stage);
      if (image) {
        image.style.transform =
          constrained.scale === MIN_SCALE
            ? ""
            : `translate3d(${constrained.x}px, ${constrained.y}px, 0) scale(${constrained.scale})`;
      }
      updateZoomReadout(stage, constrained.scale);
    },
    [updateZoomReadout],
  );

  const resetPointers = useCallback(() => {
    pointersRef.current.clear();
    pointerStartRef.current = null;
    dragStartRef.current = null;
    pinchRef.current = null;
    gestureMovedRef.current = false;
    gesturePinchedRef.current = false;
    if (stageRef.current) stageRef.current.dataset.panning = "false";
  }, []);

  const resetZoom = useCallback(() => {
    transformRef.current = FIT_TRANSFORM;
    const image = getImage(stageRef.current);
    if (image) image.style.transform = "";
    resetPointers();
    if (stageRef.current) updateZoomReadout(stageRef.current, MIN_SCALE);
  }, [resetPointers, updateZoomReadout]);

  useLayoutEffect(() => {
    resetZoom();
  }, [imageId, resetZoom]);

  const applyZoomAt = useCallback(
    (scale: number, point: Point) => {
      const stage = stageRef.current;
      if (!stage || !getImage(stage)) return;
      applyTransform(
        zoomTransformAroundPoint(
          transformRef.current,
          scale,
          point,
          getGeometry(stage),
        ),
      );
    },
    [applyTransform],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      onInteraction();
      applyZoomAt(transformRef.current.scale * factor, stageCentre(stage));
    },
    [applyZoomAt, onInteraction],
  );

  const zoomIn = useCallback(() => zoomBy(1.25), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(0.8), [zoomBy]);

  const toggleFitAndNatural = useCallback(
    (point: Point) => {
      const stage = stageRef.current;
      if (!stage) return;
      onInteraction();
      if (transformRef.current.scale > MIN_SCALE + ZOOM_EPSILON) {
        resetZoom();
        return;
      }
      const image = getImage(stage);
      applyZoomAt(
        naturalPixelScale(
          image?.naturalWidth ?? 0,
          image?.offsetWidth ?? 0,
        ),
        point,
      );
    },
    [applyZoomAt, onInteraction, resetZoom],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      onInteraction();
      const lineHeight = 16;
      const normalise = (delta: number, pageSize: number) =>
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? delta * lineHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? delta * pageSize
            : delta;
      const gesture = resolveWheelGesture(
        event.ctrlKey,
        transformRef.current.scale,
      );
      if (gesture === "zoom") {
        // A macOS trackpad pinch reaches WebKit as a ctrlKey wheel; a mouse user holds ⌃ for the same zoom.
        const factor = Math.exp(
          -normalise(event.deltaY, stage.clientHeight) * 0.012,
        );
        applyZoomAt(
          transformRef.current.scale * factor,
          localPoint(stage, event.clientX, event.clientY),
        );
        return;
      }
      if (gesture === "none") return;
      // Plain two-finger scroll pans the zoomed image, content tracking the fingers; edges clamp in applyTransform.
      applyTransform({
        ...transformRef.current,
        x: transformRef.current.x - normalise(event.deltaX, stage.clientWidth),
        y: transformRef.current.y - normalise(event.deltaY, stage.clientHeight),
      });
    };

    const handleGestureStart = (event: Event) => {
      const gesture = event as WebKitGestureEvent;
      if (!getImage(stage)) return;
      event.preventDefault();
      onInteraction();
      const point = localPoint(
        stage,
        gesture.clientX ??
          stage.getBoundingClientRect().left + stage.clientWidth / 2,
        gesture.clientY ??
          stage.getBoundingClientRect().top + stage.clientHeight / 2,
      );
      gestureRef.current = {
        startScale: transformRef.current.scale,
        anchor: anchoredZoom(transformRef.current, point, getGeometry(stage)),
      };
    };

    const handleGestureChange = (event: Event) => {
      const gesture = event as WebKitGestureEvent;
      if (!gestureRef.current) return;
      event.preventDefault();
      onInteraction();
      const point = localPoint(
        stage,
        gesture.clientX ??
          stage.getBoundingClientRect().left + stage.clientWidth / 2,
        gesture.clientY ??
          stage.getBoundingClientRect().top + stage.clientHeight / 2,
      );
      applyTransform(
        transformFromAnchor(
          gestureRef.current.startScale * gesture.scale,
          point,
          gestureRef.current.anchor,
          getGeometry(stage),
        ),
      );
    };

    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureRef.current = null;
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    stage.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
    });
    stage.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
    });
    stage.addEventListener("gestureend", handleGestureEnd, { passive: false });

    return () => {
      stage.removeEventListener("wheel", handleWheel);
      stage.removeEventListener("gesturestart", handleGestureStart);
      stage.removeEventListener("gesturechange", handleGestureChange);
      stage.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [applyTransform, applyZoomAt, onInteraction]);

  const beginPinch = useCallback(() => {
    const stage = stageRef.current;
    const points = [...pointersRef.current.values()];
    if (!stage || points.length < 2) return;
    const centre = midpoint(points[0], points[1]);
    pinchRef.current = {
      distance: Math.max(1, distance(points[0], points[1])),
      startScale: transformRef.current.scale,
      anchor: anchoredZoom(transformRef.current, centre, getGeometry(stage)),
    };
    gesturePinchedRef.current = true;
    stage.dataset.panning = "true";
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (
        event.button !== 0 ||
        target.closest("button") ||
        !getImage(event.currentTarget)
      ) {
        return;
      }
      if (event.pointerType === "mouse" && !zoomedRef.current) return;
      onInteraction();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = localPoint(
        event.currentTarget,
        event.clientX,
        event.clientY,
      );
      pointersRef.current.set(event.pointerId, point);

      if (pointersRef.current.size === 1) {
        pointerStartRef.current = point;
        gestureMovedRef.current = false;
        gesturePinchedRef.current = false;
        dragStartRef.current = {
          point,
          transform: transformRef.current,
        };
        if (zoomedRef.current) event.currentTarget.dataset.panning = "true";
      } else if (pointersRef.current.size === 2) {
        beginPinch();
      }
    },
    [beginPinch, onInteraction],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      event.preventDefault();
      const stage = event.currentTarget;
      const point = localPoint(stage, event.clientX, event.clientY);
      pointersRef.current.set(event.pointerId, point);
      if (
        pointerStartRef.current &&
        distance(pointerStartRef.current, point) > DRAG_THRESHOLD_PX
      ) {
        gestureMovedRef.current = true;
      }

      const points = [...pointersRef.current.values()];
      if (points.length >= 2 && pinchRef.current) {
        const centre = midpoint(points[0], points[1]);
        const nextScale =
          pinchRef.current.startScale *
          (distance(points[0], points[1]) / pinchRef.current.distance);
        applyTransform(
          transformFromAnchor(
            nextScale,
            centre,
            pinchRef.current.anchor,
            getGeometry(stage),
          ),
        );
        return;
      }

      if (zoomedRef.current && dragStartRef.current) {
        applyTransform({
          ...dragStartRef.current.transform,
          x:
            dragStartRef.current.transform.x +
            point.x -
            dragStartRef.current.point.x,
          y:
            dragStartRef.current.transform.y +
            point.y -
            dragStartRef.current.point.y,
        });
      }
    },
    [applyTransform],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      const stage = event.currentTarget;
      const releasedPoint = pointersRef.current.get(event.pointerId) as Point;
      const wasOnlyPointer = pointersRef.current.size === 1;
      pointersRef.current.delete(event.pointerId);
      if (stage.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
      }

      if (
        !cancelled &&
        event.pointerType === "touch" &&
        wasOnlyPointer &&
        !gestureMovedRef.current &&
        !gesturePinchedRef.current
      ) {
        const now = performance.now();
        const previousTap = lastTapRef.current;
        if (isDoubleTap(previousTap, now, releasedPoint)) {
          suppressDoubleClickUntilRef.current = now + DOUBLE_TAP_WINDOW_MS;
          lastTapRef.current = null;
          toggleFitAndNatural(releasedPoint);
        } else {
          lastTapRef.current = { at: now, point: releasedPoint };
        }
      }

      if (pointersRef.current.size === 1) {
        const remainingPoint = [...pointersRef.current.values()][0];
        pinchRef.current = null;
        dragStartRef.current = {
          point: remainingPoint,
          transform: transformRef.current,
        };
      } else if (pointersRef.current.size === 0) {
        resetPointers();
      }
    },
    [resetPointers, toggleFitAndNatural],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (performance.now() < suppressDoubleClickUntilRef.current) return;
      toggleFitAndNatural(
        localPoint(event.currentTarget, event.clientX, event.clientY),
      );
    },
    [toggleFitAndNatural],
  );

  return {
    stageRef,
    zoomLabelRef,
    isZoomed,
    resetZoom,
    zoomIn,
    zoomOut,
    pointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: (event) => finishPointer(event, false),
      onPointerCancel: (event) => finishPointer(event, true),
      onDoubleClick: handleDoubleClick,
    },
  };
}
