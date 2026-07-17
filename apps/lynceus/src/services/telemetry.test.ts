import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  describeElement,
  domPathFor,
  serialiseDomOutline,
  shouldRecordKey,
  summariseQueries,
} from "./telemetry";

function build(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("describeElement", () => {
  it("prefers id, then data-* hooks, then aria-label, then classes", () => {
    const host = build(
      `<div id="root-x"></div>
       <div data-masonry-id="42"></div>
       <button aria-label="Run continuously"></button>
       <span class="flex items-center hover:bg-x"></span>`,
    );
    const [byId, byData, byAria, byClass] = Array.from(host.children);
    expect(describeElement(byId)).toBe("div#root-x");
    expect(describeElement(byData)).toBe("div[data-masonry-id=42]");
    expect(describeElement(byAria)).toBe("button[aria=Run continuously]");
    // hover: classes are skipped as unstable; first two stable classes kept.
    expect(describeElement(byClass)).toBe("span.flex.items-center");
    host.remove();
  });

  it("collapses boolean data attributes to the attribute name alone", () => {
    const host = build(`<div data-selected-hero="true"></div>`);
    expect(describeElement(host.children[0])).toBe("div[data-selected-hero]");
    host.remove();
  });
});

describe("domPathFor", () => {
  it("walks innermost-first up to body and joins with ' < '", () => {
    const host = build(
      `<div data-masonry-id="7"><div class="tile-inner x"><img id="pic" /></div></div>`,
    );
    const img = host.querySelector("#pic")!;
    const path = domPathFor(img);
    expect(path.startsWith("img#pic < div.tile-inner.x < div[data-masonry-id=7]")).toBe(
      true,
    );
    host.remove();
  });
});

describe("shouldRecordKey", () => {
  const key = (init: KeyboardEventInit, target?: HTMLElement) => {
    const e = new KeyboardEvent("keydown", init);
    if (target) Object.defineProperty(e, "target", { value: target });
    return e;
  };

  it("records special keys and chords outside editable targets", () => {
    expect(shouldRecordKey(key({ key: "Escape" }))).toBe(true);
    expect(shouldRecordKey(key({ key: "ArrowRight" }))).toBe(true);
    expect(shouldRecordKey(key({ key: "s", metaKey: true }))).toBe(true);
    expect(shouldRecordKey(key({ key: "a" }))).toBe(false);
  });

  it("never records plain typing into an editable target, but keeps chords", () => {
    const input = document.createElement("input");
    expect(shouldRecordKey(key({ key: "a" }, input))).toBe(false);
    expect(shouldRecordKey(key({ key: "Escape" }, input))).toBe(false);
    expect(shouldRecordKey(key({ key: ",", metaKey: true }, input))).toBe(true);
  });
});

describe("serialiseDomOutline", () => {
  it("captures structure with indentation and leaf text, skipping scripts", () => {
    const host = build(
      `<section id="panel"><script>evil()</script><button aria-label="Start">Go</button></section>`,
    );
    const outline = serialiseDomOutline(host.querySelector("#panel")!);
    expect(outline).toContain("section#panel");
    expect(outline).toContain(`button[aria=Start] "Go"`);
    expect(outline).not.toContain("script");
    host.remove();
  });

  it("never reads input values", () => {
    const host = build(`<form id="f"><input value="secret-text" /></form>`);
    const outline = serialiseDomOutline(host.querySelector("#f")!);
    expect(outline).not.toContain("secret-text");
    host.remove();
  });

  it("stops at the char budget with an explicit truncation marker", () => {
    const host = build(
      `<div id="big">${"<p>row</p>".repeat(400)}</div>`,
    );
    const outline = serialiseDomOutline(host.querySelector("#big")!, 500);
    expect(outline).toContain("…[outline truncated at budget]");
    expect(outline.length).toBeLessThan(1000);
    host.remove();
  });
});

describe("summariseQueries", () => {
  it("reports keys and lifecycle without cached data", async () => {
    const qc = new QueryClient();
    await qc.prefetchQuery({
      queryKey: ["feed-manifest", [], false, []],
      queryFn: async () => [{ id: 1, secretField: "do-not-leak" }],
    });
    const summary = summariseQueries(qc);
    expect(summary).toHaveLength(1);
    expect(summary[0].key).toContain("feed-manifest");
    expect(summary[0].status).toBe("success");
    expect(JSON.stringify(summary)).not.toContain("do-not-leak");
    qc.clear();
  });
});
