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
  // taken MID-reflow catches tiles still sliding through each other, so a
  // settled snapshot (see sampleReflowMotion) is the one that judges bugs.
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
 * Watch every visible tile's position across the frames after a reflow and
 * classify each move as a TELEPORT (jumped almost all of its distance in a
 * single frame — no transition animated it) or a slide (moved gradually).
 * This is the frame-level capture the grab/drop snapshots can't give: the
 * "moving up teleports, down slides" bug becomes a labelled list.
 */
export function sampleReflowMotion(reason: string, frames = 24): void {
  const first = new Map<number, { x: number; y: number }>();
  const last = new Map<number, { x: number; y: number }>();
  const prev = new Map<number, { x: number; y: number }>();
  const maxJump = new Map<number, number>();
  let f = 0;

  const step = () => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-masonry-id]")) {
      const id = Number(el.dataset.masonryId);
      const r = el.getBoundingClientRect();
      const pos = { x: Math.round(r.left), y: Math.round(r.top) };
      if (!first.has(id)) first.set(id, pos);
      const p = prev.get(id);
      if (p) {
        const jump = Math.hypot(pos.x - p.x, pos.y - p.y);
        maxJump.set(id, Math.max(maxJump.get(id) ?? 0, jump));
      }
      prev.set(id, pos);
      last.set(id, pos);
    }
    f += 1;
    if (f < frames) {
      requestAnimationFrame(step);
      return;
    }
    const moved: Array<Record<string, unknown>> = [];
    for (const [id, fp] of first) {
      const lp = last.get(id);
      if (!lp) continue;
      const total = Math.round(Math.hypot(lp.x - fp.x, lp.y - fp.y));
      if (total <= 8) continue; // didn't meaningfully move
      const mj = Math.round(maxJump.get(id) ?? 0);
      moved.push({
        id,
        total,
        maxFrameJump: mj,
        // Moved ~all its distance in one frame → nothing animated it.
        verdict: mj > total * 0.8 ? "TELEPORT" : "slide",
        dir: lp.y < fp.y ? "up" : lp.y > fp.y ? "down" : "sideways",
      });
    }
    moved.sort((a, b) => (b.total as number) - (a.total as number));
    // The SETTLED geometry — captured after the animation frames complete, so
    // its overlaps/gaps reflect the final layout, not tiles mid-slide.
    recordAction("reflow_motion", {
      reason,
      frames,
      moved: moved.slice(0, 30),
      settledGrid: captureGridGeometry(),
    });
  };

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

  /* 1b — pointer / drag tracing (the "see what I see" surface) ------- */
  // Records where the cursor is, what it's over (a tile id or EMPTY),
  // and whether a button is held — so a drag/reorder session reads back
  // as a motion trace: grab point, path, what each sample is over, drop.
  // Grid geometry is snapshotted at grab and at drop so a broken layout
  // shows its overlaps/gaps before AND after the interaction.
  let pointerDown = false;
  let grabbedId: number | null = null;
  let lastDragSample = 0;

  // Continuous per-frame motion capture for the LIFE of a drag. The
  // reorder that teleports happens MID-drag (the grid re-packs live as the
  // held tile crosses another), not on drop — so a drop-only sampler sees
  // nothing move. This rAF loop watches every non-dragged tile each frame
  // and flags a TELEPORT: a tile that jumped a big distance in a single
  // frame (a CSS slide moves a few px/frame over ~400ms; a jump of >28px in
  // one frame means nothing animated it). Each tile is reported once per
  // drag, with direction — so an up-move-teleports / down-move-slides split
  // reads straight out of the timeline.
  const JUMP_PX = 28;
  let dragRaf: number | null = null;
  const dragPrev = new Map<number, { x: number; y: number }>();
  const dragTeleported = new Set<number>();
  let dragTeleports: Array<Record<string, unknown>> = [];

  const dragMotionStep = () => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-masonry-id]")) {
      const id = Number(el.dataset.masonryId);
      if (id === grabbedId) continue; // the held tile follows the cursor
      const r = el.getBoundingClientRect();
      const pos = { x: r.left, y: r.top };
      const p = dragPrev.get(id);
      if (p) {
        const dx = pos.x - p.x;
        const dy = pos.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > JUMP_PX && !dragTeleported.has(id)) {
          dragTeleported.add(id);
          dragTeleports.push({
            id,
            dx: Math.round(dx),
            dy: Math.round(dy),
            dist: Math.round(dist),
            dir: dy < -2 ? "up" : dy > 2 ? "down" : "sideways",
          });
        }
      }
      dragPrev.set(id, pos);
    }
    dragRaf = requestAnimationFrame(dragMotionStep);
  };

  document.addEventListener(
    "pointerdown",
    (e) => {
      pointerDown = true;
      const under = tileUnderPoint(e.clientX, e.clientY);
      grabbedId = under.id;
      recordAction("pointer_down", {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        over: under.label,
        button: e.button,
        grid: captureGridGeometry(),
      });
      // Arm the per-frame drag-motion capture.
      dragPrev.clear();
      dragTeleported.clear();
      dragTeleports = [];
      if (dragRaf === null) dragRaf = requestAnimationFrame(dragMotionStep);
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!pointerDown) return; // only trace motion WHILE holding
      const now = Date.now();
      if (now - lastDragSample < DRAG_SAMPLE_MS) return;
      lastDragSample = now;
      const under = tileUnderPoint(e.clientX, e.clientY);
      recordAction("pointer_drag", {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        over: under.label,
        grabbed: grabbedId,
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
      // Stop the per-frame drag capture and emit what jumped DURING the drag.
      if (dragRaf !== null) {
        cancelAnimationFrame(dragRaf);
        dragRaf = null;
      }
      const upJumps = dragTeleports.filter((t) => t.dir === "up").length;
      const downJumps = dragTeleports.filter((t) => t.dir === "down").length;
      recordAction("pointer_up", {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        over: under.label,
        grabbed: grabbedId,
        grid: captureGridGeometry(),
        // The mid-drag teleport summary: tiles that jumped in a single frame
        // while the drag was live, split by direction.
        dragTeleports,
        teleportUp: upJumps,
        teleportDown: downJumps,
      });
      // A drop also triggers a settle reflow — sample it too (this one slides).
      sampleReflowMotion("after_drop");
      grabbedId = null;
    },
    { capture: true, passive: true },
  );

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
