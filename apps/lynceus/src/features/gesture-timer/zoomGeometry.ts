const MIN_SCALE = 1;
const MAX_SCALE = 64;
const ZOOM_EPSILON = 0.001;
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 28;
const DRAG_THRESHOLD_PX = 5;

export type Point = { x: number; y: number };

export type ZoomTransform = {
  scale: number;
  x: number;
  y: number;
};

export type ZoomGeometry = {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
};

export type AnchoredZoom = {
  anchorX: number;
  anchorY: number;
};

export type WebKitGestureEvent = Event & {
  clientX?: number;
  clientY?: number;
  scale: number;
};

export const FIT_TRANSFORM: ZoomTransform = { scale: 1, x: 0, y: 0 };

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function constrainZoomTransform(
  transform: ZoomTransform,
  geometry: ZoomGeometry,
): ZoomTransform {
  const scale = clamp(transform.scale, MIN_SCALE, MAX_SCALE);
  const maxX = Math.max(
    0,
    (geometry.imageWidth * scale - geometry.viewportWidth) / 2,
  );
  const maxY = Math.max(
    0,
    (geometry.imageHeight * scale - geometry.viewportHeight) / 2,
  );

  return {
    scale,
    x: clamp(transform.x, -maxX, maxX),
    y: clamp(transform.y, -maxY, maxY),
  };
}

export function zoomTransformAroundPoint(
  transform: ZoomTransform,
  nextScale: number,
  point: Point,
  geometry: ZoomGeometry,
): ZoomTransform {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const centreX = geometry.viewportWidth / 2;
  const centreY = geometry.viewportHeight / 2;
  const ratio = scale / transform.scale;

  return constrainZoomTransform(
    {
      scale,
      x:
        transform.x +
        (1 - ratio) * (point.x - centreX - transform.x),
      y:
        transform.y +
        (1 - ratio) * (point.y - centreY - transform.y),
    },
    geometry,
  );
}

export function naturalPixelScale(
  naturalWidth: number,
  renderedWidth: number,
): number {
  if (naturalWidth <= 0 || renderedWidth <= 0) return MIN_SCALE;
  return clamp(naturalWidth / renderedWidth, MIN_SCALE, MAX_SCALE);
}

export type WheelGesture = "zoom" | "pan" | "none";

export function resolveWheelGesture(
  ctrlKey: boolean,
  scale: number,
): WheelGesture {
  if (ctrlKey) return "zoom";
  return scale > MIN_SCALE + ZOOM_EPSILON ? "pan" : "none";
}

export function localPoint(stage: HTMLDivElement, clientX: number, clientY: number) {
  const rect = stage.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function stageCentre(stage: HTMLDivElement): Point {
  return { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
}

export function getImage(stage: HTMLDivElement | null): HTMLImageElement | null {
  return (
    stage?.querySelector<HTMLImageElement>("[data-gesture-timer-image]") ??
    null
  );
}

export function getGeometry(stage: HTMLDivElement): ZoomGeometry {
  const image = getImage(stage);
  return {
    viewportWidth: stage.clientWidth,
    viewportHeight: stage.clientHeight,
    imageWidth: image?.offsetWidth ?? 0,
    imageHeight: image?.offsetHeight ?? 0,
  };
}

export function anchoredZoom(
  transform: ZoomTransform,
  point: Point,
  geometry: ZoomGeometry,
): AnchoredZoom {
  return {
    anchorX:
      (point.x - geometry.viewportWidth / 2 - transform.x) / transform.scale,
    anchorY:
      (point.y - geometry.viewportHeight / 2 - transform.y) / transform.scale,
  };
}

export function transformFromAnchor(
  scale: number,
  point: Point,
  anchor: AnchoredZoom,
  geometry: ZoomGeometry,
): ZoomTransform {
  return constrainZoomTransform(
    {
      scale,
      x: point.x - geometry.viewportWidth / 2 - anchor.anchorX * scale,
      y: point.y - geometry.viewportHeight / 2 - anchor.anchorY * scale,
    },
    geometry,
  );
}

/** Pure double-tap predicate: is `point`, released `now`, close enough in
 *  time and space to `previousTap` to count as the second tap of a pair? */
export function isDoubleTap(
  previousTap: { at: number; point: Point } | null,
  now: number,
  point: Point,
): boolean {
  return (
    previousTap !== null &&
    now - previousTap.at <= DOUBLE_TAP_WINDOW_MS &&
    distance(previousTap.point, point) <= DOUBLE_TAP_DISTANCE_PX
  );
}

export {
  MIN_SCALE,
  MAX_SCALE,
  ZOOM_EPSILON,
  DOUBLE_TAP_WINDOW_MS,
  DOUBLE_TAP_DISTANCE_PX,
  DRAG_THRESHOLD_PX,
};
