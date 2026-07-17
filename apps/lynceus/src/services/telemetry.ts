/**
 * Telemetry v2 — the automatic capture layer over the profiling sink.
 *
 * Everything here is troubleshooting instrumentation, active ONLY in
 * profiling mode (`just lynceus-dev-telemetry`), writing to the local
 * JSONL timeline via `recordAction` (engine sink: crates/engine perf.rs).
 * Nothing leaves the machine. Four capture surfaces:
 *
 *  1. Interactions — capture-phase click/contextmenu + shortcut-grade
 *     keydowns on `document`, each carrying a synthesised descriptor of
 *     the target INCLUDING its ancestor DOM path — "how this button fits
 *     into the DOM at that moment" — so coverage never depends on
 *     hand-placed recordAction calls again. Typed text is never
 *     captured: plain-character keydowns into editable targets are
 *     ignored wholesale, and descriptors never read input values.
 *  2. Errors — window `error` (both JS exceptions and, via the capture
 *     phase, resource failures), `unhandledrejection`, and a tee on
 *     console.error/warn.
 *  3. Image observability — the resource half of (2) records <img>
 *     failures with their src; a PerformanceObserver flags slow
 *     resource loads (>500ms) so a struggling decode/read shows up.
 *  4. State bundles — on JS error / rejection (debounced) and on ⌘⇧M
 *     ("mark this moment"), a freeze-frame: pruned DOM outline,
 *     react-query cache summary (keys + status, never data), and route.
 *
 * The event vocabulary is deliberately flat snake_case (`ui_click`,
 * `js_error`, `state_bundle`, …) per the telemetry-architecture note in
 * context/notes/performance-decisions.md — app-specific names stay at
 * call sites; this module stays generic and extraction-ready for the
 * future shared package.
 */
import type { QueryClient } from "@tanstack/react-query";
import { recordAction } from "./perf";

/* ------------------------------------------------------------------ */
/* Element descriptors + DOM paths                                     */
/* ------------------------------------------------------------------ */

const TEXT_SNIPPET_MAX = 48;
const DOM_PATH_MAX_SEGMENTS = 8;

/** One compact, privacy-safe segment for a single element. */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;

  // data-* attributes are this codebase's semantic hooks
  // (data-masonry-id, data-selected-hero, data-gesture-zoom-stage…) —
  // the most stable identity an element has.
  for (const attr of el.getAttributeNames()) {
    if (attr.startsWith("data-") && attr !== "data-state") {
      const v = el.getAttribute(attr);
      return v && v !== "true" && v.length <= 32
        ? `${tag}[${attr}=${v}]`
        : `${tag}[${attr}]`;
    }
  }

  const aria = el.getAttribute("aria-label");
  if (aria) return `${tag}[aria=${aria.slice(0, 40)}]`;

  const cls = (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("hover:") && !c.includes("["))
    .slice(0, 2)
    .join(".");
  return cls ? `${tag}.${cls}` : tag;
}

/** Ancestor chain, innermost first: `button[aria=Run continuously] < div.flex < selected-image-timer-pill < …` */
export function domPathFor(el: Element): string {
  const segments: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && segments.length < DOM_PATH_MAX_SEGMENTS) {
    segments.push(describeElement(node));
    node = node.parentElement;
  }
  return segments.join(" < ");
}

function visibleText(el: Element): string | undefined {
  // Never read values out of form controls — only rendered text.
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return undefined;
  }
  const t = el.textContent?.trim();
  return t ? t.slice(0, TEXT_SNIPPET_MAX) : undefined;
}

/* ------------------------------------------------------------------ */
/* Keydown filter                                                      */
/* ------------------------------------------------------------------ */

const SPECIAL_KEYS = new Set([
  "Escape",
  "Enter",
  "Tab",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Backspace",
  "Delete",
  " ",
]);

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t.isContentEditable
  );
}

/**
 * Record shortcut-grade keys only. Plain typing into an editable target
 * is never recorded (content privacy + noise); navigation/special keys
 * and any modifier chord are recorded everywhere else.
 */
export function shouldRecordKey(e: KeyboardEvent): boolean {
  const chord = e.metaKey || e.ctrlKey || e.altKey;
  if (isEditableTarget(e.target)) return chord; // ⌘, still matters mid-typing
  return chord || SPECIAL_KEYS.has(e.key) || e.key.startsWith("F");
}

/* ------------------------------------------------------------------ */
/* Pruned DOM outline                                                  */
/* ------------------------------------------------------------------ */

const OUTLINE_CHAR_BUDGET = 150_000;
const OUTLINE_TEXT_MAX = 40;
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "PATH", "DEFS"]);

/**
 * Serialise the DOM as an indented one-line-per-node outline: structure,
 * identity attributes, and truncated text — no styles, no SVG innards,
 * no input values. Stops at the char budget with an explicit marker so a
 * truncated snapshot never masquerades as complete.
 */
export function serialiseDomOutline(
  root: Element,
  budget: number = OUTLINE_CHAR_BUDGET,
): string {
  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  const walk = (el: Element, depth: number): void => {
    if (truncated || SKIPPED_TAGS.has(el.tagName)) return;
    let line = "  ".repeat(depth) + describeElement(el);
    const text = visibleText(el);
    // Only leaf-ish text (avoid repeating a whole subtree's concatenated
    // text at every ancestor level).
    if (text && el.children.length === 0) {
      line += ` "${text.slice(0, OUTLINE_TEXT_MAX)}"`;
    }
    used += line.length + 1;
    if (used > budget) {
      truncated = true;
      lines.push("  ".repeat(depth) + "…[outline truncated at budget]");
      return;
    }
    lines.push(line);
    for (const child of Array.from(el.children)) walk(child, depth + 1);
  };

  walk(root, 0);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Query-cache summary                                                 */
/* ------------------------------------------------------------------ */

/** Keys + lifecycle only — never the cached data itself. */
export function summariseQueries(
  queryClient: QueryClient,
): Array<Record<string, unknown>> {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((q) => ({
      key: JSON.stringify(q.queryKey).slice(0, 120),
      status: q.state.status,
      fetchStatus: q.state.fetchStatus,
      updatedAt: q.state.dataUpdatedAt,
      errorUpdatedAt: q.state.errorUpdatedAt,
      observers: q.getObserversCount(),
    }));
}

/* ------------------------------------------------------------------ */
/* Masonry geometry (interaction/layout debugging)                     */
/*                                                                     */
/* App-specific for now — it reads `[data-masonry-id]` tiles. When the */
/* capture layer is extracted to the shared package this becomes a     */
/* configurable selector the app registers. It exists so a layout bug  */
/* (a tile rendering wider than the packer reserved → overlap; a gap;  */
/* a drag over empty space) is visible in the timeline as NUMBERS, not */
/* something the next session has to reproduce and eyeball.            */
/* ------------------------------------------------------------------ */

export interface TileGeometry {
  id: number;
  /** Width the packer set on the anchor (the reserved footprint). */
  packW: number;
  /** The anchor's committed transform (its reserved x/y). */
  packTransform: string;
  /** What the tile actually renders as (its on-screen box). */
  renderW: number;
  renderH: number;
  x: number;
  y: number;
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
    const anchor = el.parentElement;
    const style = anchor?.style;
    const r = el.getBoundingClientRect();
    return {
      id: Number(el.dataset.masonryId),
      packW: style ? Math.round(parseFloat(style.width) || 0) : 0,
      packTransform: style?.transform ?? "",
      renderW: Math.round(r.width),
      renderH: Math.round(r.height),
      x: Math.round(r.left),
      y: Math.round(r.top),
    };
  });

  // Divergence: the packer reserved packW but the tile renders renderW.
  // A non-trivial gap here IS the "2x2 acts like a wrong size" bug.
  const mismatched = tiles
    .filter((t) => Math.abs(t.renderW - t.packW) > 2)
    .map((t) => ({ id: t.id, packW: t.packW, renderW: t.renderW }));

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
  // Some gap is inherent to spanned tiles (a wide tile sits below the taller
  // of its columns, leaving the shorter one short); flagged here so the size
  // and frequency are visible rather than guessed at.
  const byColumn = new Map<number, TileGeometry[]>();
  for (const t of tiles) {
    const arr = byColumn.get(t.x) ?? [];
    arr.push(t);
    byColumn.set(t.x, arr);
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
export function classifyMove(total: number, maxFrameJump: number): "TELEPORT" | "slide" {
  return maxFrameJump > total * 0.6 ? "TELEPORT" : "slide";
}

/**
 * Context the layout monitor stamps onto each reflow event: what the user was
 * doing when the reflow began. Mutated by the pointer handlers, read by the
 * monitor — so a reflow reads back as "caused by dragging tile 42" or "other"
 * (an indexing delta, a resize, a filter change).
 */
interface MonitorContext {
  dragging: boolean;
  grabbedId: number | null;
  cursor: { x: number; y: number } | null;
}
const monitorContext: MonitorContext = {
  dragging: false,
  grabbedId: null,
  cursor: null,
};

/**
 * The unified layout monitor — ONE always-on observer that classifies EVERY
 * masonry reflow, whatever triggered it (drag reorder, indexing delta, resize,
 * filter change). No hard-coded per-trigger sampler.
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
function startLayoutMonitor(): void {
  const SETTLE_FRAMES = 5; // still frames that end a reflow
  const MOVE_EPS = 1; // px; below this a tile is "still" this frame
  const JUMP_PX = 24; // single-frame move worth reading transition state for
  const MEANINGFUL = 6; // total px a tile must move to be reported

  type Snap = { x: number; y: number };
  interface Acc {
    first: Snap;
    last: Snap;
    maxJump: number;
    jumpTrans: { prop: string; dur: string } | null;
  }

  const readTiles = (): Map<number, { snap: Snap; el: HTMLElement }> => {
    const m = new Map<number, { snap: Snap; el: HTMLElement }>();
    for (const el of document.querySelectorAll<HTMLElement>("[data-masonry-id]")) {
      const id = Number(el.dataset.masonryId);
      const r = el.getBoundingClientRect();
      m.set(id, { snap: { x: r.left, y: r.top }, el });
    }
    return m;
  };

  let prev = new Map<number, Snap>();
  let active = false;
  let idle = 0;
  let acc = new Map<number, Acc>();
  const mounted = new Set<number>();
  const unmounted = new Set<number>();
  let ctxAtStart: MonitorContext = { ...monitorContext };

  const reset = () => {
    acc = new Map();
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
        verdict: classifyMove(total, a.maxJump),
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

  const step = () => {
    const cur = readTiles();
    let motion = false;

    for (const [id, { snap: c, el }] of cur) {
      const p = prev.get(id);
      if (!p) {
        if (active) mounted.add(id);
        continue;
      }
      const jump = Math.hypot(c.x - p.x, c.y - p.y);
      if (jump > MOVE_EPS) {
        motion = true;
        if (!active) {
          active = true;
          ctxAtStart = { ...monitorContext };
        }
        const a = acc.get(id) ?? { first: p, last: c, maxJump: 0, jumpTrans: null };
        a.last = c;
        if (jump > a.maxJump) {
          a.maxJump = jump;
          if (jump > JUMP_PX) {
            const cs = getComputedStyle(el.parentElement ?? el);
            a.jumpTrans = { prop: cs.transitionProperty, dur: cs.transitionDuration };
          }
        }
        acc.set(id, a);
      }
    }
    for (const [id] of prev) {
      if (!cur.has(id)) {
        if (active) unmounted.add(id);
        motion = true;
      }
    }

    prev = new Map(Array.from(cur, ([id, v]) => [id, v.snap]));

    if (motion) {
      idle = 0;
    } else if (active) {
      idle += 1;
      if (idle >= SETTLE_FRAMES) {
        flush();
        active = false;
        idle = 0;
      }
    }
    requestAnimationFrame(step);
  };

  prev = new Map(Array.from(readTiles(), ([id, v]) => [id, v.snap]));
  requestAnimationFrame(step);
}

/** First `[data-masonry-id]` tile under a screen point, or EMPTY. */
export function tileUnderPoint(x: number, y: number): {
  id: number | null;
  label: string;
} {
  for (const hit of document.elementsFromPoint(x, y)) {
    const tile = hit.closest<HTMLElement>("[data-masonry-id]");
    if (tile) {
      return { id: Number(tile.dataset.masonryId), label: `tile#${tile.dataset.masonryId}` };
    }
  }
  return { id: null, label: "EMPTY" };
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

const BUNDLE_DEBOUNCE_MS = 10_000;
const DRAG_SAMPLE_MS = 100; // ~10 drag samples/sec, enough to trace motion
let lastBundleAt = 0;
let telemetryStarted = false;

function captureStateBundle(queryClient: QueryClient, reason: string): void {
  recordAction("state_bundle", {
    reason,
    route: `${window.location.pathname}${window.location.hash}`,
    dom: serialiseDomOutline(document.body),
    queries: summariseQueries(queryClient),
    grid: captureGridGeometry(),
  });
}

function bundleOnErrorDebounced(queryClient: QueryClient, reason: string): void {
  const now = Date.now();
  if (now - lastBundleAt < BUNDLE_DEBOUNCE_MS) return;
  lastBundleAt = now;
  captureStateBundle(queryClient, reason);
}

/**
 * Install every capture surface. Called once from App when profiling
 * mode resolves true; a second call is a no-op. Deliberately never
 * uninstalled — the surfaces live for the whole profiled session.
 */
export function initTelemetry(queryClient: QueryClient): void {
  if (telemetryStarted) return;
  telemetryStarted = true;

  /* 1 — interactions ------------------------------------------------ */
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      recordAction("ui_click", {
        path: domPathFor(t),
        text: t instanceof Element ? visibleText(t) : undefined,
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
      });
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "contextmenu",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      recordAction("ui_contextmenu", { path: domPathFor(t) });
    },
    { capture: true, passive: true },
  );

  /* 1b — pointer / cursor tracing + monitor context ------------------ */
  // Records where the cursor is, what it's over (a tile id or EMPTY), and
  // whether a button is held — so an interaction reads back as a motion
  // trace. It also maintains `monitorContext`, which the layout monitor
  // stamps onto every reflow, so each reflow event knows whether a drag
  // caused it and where the cursor was. The reflow classification itself
  // (teleport/slide, mount/unmount, geometry) is the monitor's job, not
  // this handler's — one observer for all reflows, not a per-event sampler.
  let pointerDown = false;
  let lastDragSample = 0;

  document.addEventListener(
    "pointerdown",
    (e) => {
      pointerDown = true;
      const under = tileUnderPoint(e.clientX, e.clientY);
      monitorContext.dragging = true;
      monitorContext.grabbedId = under.id;
      monitorContext.cursor = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
      recordAction("pointer_down", {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        over: under.label,
        button: e.button,
        grid: captureGridGeometry(),
      });
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!pointerDown) return; // only trace motion WHILE holding
      monitorContext.cursor = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
      const now = Date.now();
      if (now - lastDragSample < DRAG_SAMPLE_MS) return;
      lastDragSample = now;
      const under = tileUnderPoint(e.clientX, e.clientY);
      recordAction("pointer_drag", {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        over: under.label,
        grabbed: monitorContext.grabbedId,
      });
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "pointerup",
    (e) => {
      if (!pointerDown) return;
      pointerDown = false;
      const under = tileUnderPoint(e.clientX, e.clientY);
      recordAction("pointer_up", {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        over: under.label,
        grabbed: monitorContext.grabbedId,
        grid: captureGridGeometry(),
      });
      // The drop-triggered reflow is captured by the layout monitor. Keep
      // the drag context live for a short window so the monitor attributes
      // the settle reflow to this drag before clearing it.
      window.setTimeout(() => {
        monitorContext.dragging = false;
        monitorContext.grabbedId = null;
      }, 600);
    },
    { capture: true, passive: true },
  );

  // The one observer that classifies every reflow.
  startLayoutMonitor();

  document.addEventListener(
    "keydown",
    (e) => {
      if (!shouldRecordKey(e)) return;
      const t = e.target instanceof Element ? e.target : document.body;
      recordAction("ui_key", {
        key: e.key === " " ? "Space" : e.key,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        path: domPathFor(t),
      });
      // ⌘⇧M — mark this moment: full state bundle on demand.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "M" || e.key === "m")) {
        recordAction("mark_moment", {});
        captureStateBundle(queryClient, "mark_moment");
      }
    },
    { capture: true },
  );

  /* 2 + 3 — errors, rejections, resource failures ------------------- */
  window.addEventListener(
    "error",
    (e: ErrorEvent | Event) => {
      const target = (e as Event).target;
      // Capture-phase window listener also receives non-bubbling
      // resource error events — that is exactly how <img> failures
      // (today's blank-image bug class) become observable.
      if (target instanceof HTMLImageElement) {
        recordAction("img_error", {
          src: target.src.slice(0, 300),
          path: domPathFor(target),
          naturalWidth: target.naturalWidth,
        });
        return;
      }
      if (e instanceof ErrorEvent) {
        recordAction("js_error", {
          message: e.message,
          source: `${e.filename}:${e.lineno}:${e.colno}`,
          stack: (e.error as Error | undefined)?.stack?.slice(0, 2000),
        });
        bundleOnErrorDebounced(queryClient, "js_error");
      }
    },
    { capture: true },
  );

  window.addEventListener("unhandledrejection", (e) => {
    recordAction("unhandled_rejection", {
      reason: String(e.reason).slice(0, 2000),
    });
    bundleOnErrorDebounced(queryClient, "unhandled_rejection");
  });

  // Tee console.error/warn into the timeline. The reentrancy guard
  // matters: anything our own capture path logs must not recurse.
  let inConsoleTee = false;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      if (inConsoleTee) return;
      inConsoleTee = true;
      try {
        recordAction(`console_${level}`, {
          message: args
            .map((a) => (typeof a === "string" ? a : safeStringify(a)))
            .join(" ")
            .slice(0, 2000),
        });
      } finally {
        inConsoleTee = false;
      }
    };
  }

  /* 3 — slow resources ---------------------------------------------- */
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 500) {
          recordAction("slow_resource", {
            name: entry.name.slice(0, 300),
            duration_ms: Math.round(entry.duration),
            type: (entry as PerformanceResourceTiming).initiatorType,
          });
        }
      }
    });
    obs.observe({ entryTypes: ["resource"] });
  } catch {
    // PerformanceObserver support varies by webview build — losing the
    // slow-resource surface must never break the app.
  }

  recordAction("telemetry_started", {});
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
