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
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

const BUNDLE_DEBOUNCE_MS = 10_000;
let lastBundleAt = 0;
let telemetryStarted = false;

function captureStateBundle(queryClient: QueryClient, reason: string): void {
  recordAction("state_bundle", {
    reason,
    route: `${window.location.pathname}${window.location.hash}`,
    dom: serialiseDomOutline(document.body),
    queries: summariseQueries(queryClient),
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
