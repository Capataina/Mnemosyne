/* ============================================================
   App shell — explorer, tabs, content panes, right rail
   v3 — interactive everywhere
   ============================================================ */
(function () {
  const A = window.ARCH;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const escAttr = s => esc(s).replace(/"/g, "&quot;");
  let graph = null;

  /* ---- derived indexes ---- */
  const nodeById = {}; A.nodes.forEach(n => nodeById[n.id] = n);
  const riskByNode = {}; A.risks.forEach(r => (riskByNode[r.node] = riskByNode[r.node] || []).push(r));
  const hotspotByNode = {}; A.changeFrontier.forEach(c => { hotspotByNode[c.node] = Math.max(hotspotByNode[c.node] || 0, Math.max(...c.bars)); });
  // entity -> owner node (for universal hover linking).
  // The tracked-entity set is derived at runtime from A.nodes[].state and
  // A.stateOwnership[]. No hardcoded project-specific identifiers.
  const ENTITY = {};
  const TRACKED = [];
  function normNode(name) {
    if (!name) return null;
    const lc = String(name).toLowerCase();
    for (const n of A.nodes) {
      if (lc === n.id || lc === (n.label || "").toLowerCase()) return n.id;
    }
    for (const n of A.nodes) {
      if (lc.includes(n.id) || (n.label && lc.includes(n.label.toLowerCase()))) return n.id;
    }
    return null;
  }
  // Entity dictionary keyed by lowercase phrase → owner node. Captures BOTH
  // CamelCase identifiers AND prose phrases ("tonal standards"), so projects
  // that describe state in prose still get live state-links — not just CamelCase.
  function addEntity(raw, owner) {
    const key = String(raw).trim().split(" (")[0].split(".")[0].trim();
    if (key.length < 3 || /\d{4}/.test(key)) return;
    const lk = key.toLowerCase();
    if (!ENTITY[lk]) { ENTITY[lk] = owner; TRACKED.push(lk); }
  }
  (A.stateOwnership || []).forEach(s => {
    const owner = normNode(s.owner);
    if (owner && s.items) String(s.items).split(/[,;]\s*/).forEach(raw => addEntity(raw, owner));
  });
  (A.nodes || []).forEach(n => (n.state || []).forEach(st => addEntity(st, n.id)));
  TRACKED.sort((a, b) => b.length - a.length); // longest first so phrases beat substrings
  const ENT_RE = TRACKED.length
    ? new RegExp("\\b(" + TRACKED.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "gi")
    : null;
  window.App = window.App || {};
  window.App.ENTITY = ENTITY;
  function linkifyStates(str) {
    const out = esc(str);
    if (!ENT_RE) return out;
    // single-pass replace avoids nesting a shorter match inside an already-wrapped span
    return out.replace(ENT_RE, m => `<span class="ent" data-entity="${m.toLowerCase().replace(/"/g, "")}">${m}</span>`);
  }
  function downstreamNodes(id) {
    const seen = new Set([id]); let fr = [id];
    while (fr.length) { const nx = []; fr.forEach(u => A.edges.forEach(e => { if (e.from === u && e.rel !== "peer" && !seen.has(e.to)) { seen.add(e.to); nx.push(e.to); } })); fr = nx; }
    seen.delete(id); return [...seen];
  }
  function daysSince(d) { return Math.round((Date.now() - new Date(d).getTime()) / 86400000); }
  const fmtNum = v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const tipRow = (k, v) => `<span class="tip-row"><i>${k}</i><em>${v}</em></span>`;

  /* path step label -> node id (for tracing on graph).
     Derived at runtime from A.dataFlow.steps[].sys mapping plus the optional
     A.dataFlow.pathMap override for projects that want custom routing. */
  const PATHMAP = (function () {
    const m = {};
    (A.dataFlow && A.dataFlow.steps || []).forEach(s => {
      const sys = String(s.sys || "").split("::")[0];
      if (sys && nodeById[sys]) m[sys] = sys;
    });
    Object.assign(m, (A.dataFlow && A.dataFlow.pathMap) || {});
    return m;
  })();
  function pathNodeSeq(steps) {
    const ids = (steps || []).map(s => PATHMAP[s] || (nodeById[s] ? s : null)).filter(Boolean);
    return ids.filter((id, i) => id !== ids[i - 1]); // collapse repeats
  }
  // Resolve a path's tokens to graph nodes, then trace them — or, when the steps
  // aren't subsystems (e.g. script names), give visible feedback instead of the
  // old silent no-op. Stepping is snappy (~420ms).
  function traceable(steps) { return pathNodeSeq(steps).length >= 2; }
  function traceOnGraph(steps) {
    switchTab("graph");
    const seq = pathNodeSeq(steps);
    if (seq.length < 2) {
      const h = $("#graphHint");
      if (h) {
        h.innerHTML = `<span style="color:var(--amber)">These steps aren't subsystems on the topology graph — nothing to trace.</span>`;
        setTimeout(() => { if (h && !graph.isFlowing()) h.textContent = "drag to pan · scroll to zoom · click node to inspect"; }, 2400);
      }
      return false;
    }
    graph.flowNodes(seq, { interval: 420 });
    return true;
  }

  /* ---------------- tab registry ---------------- */
  const TABS = [
    { id: "overview", label: "Overview", ti: "⌂" },
    { id: "graph", label: "Graph", ti: "◉", badge: A.nodes.length + " nodes" },
    { id: "calls", label: "Call Graph", ti: "⌁", badge: (() => { const cg = window.CALLGRAPH || A.callgraph; return cg && cg.nodes && cg.nodes.length ? cg.nodes.filter(n => !n.ext).length + " fn" : null; })() },
    { id: "flow", label: "Data Flow", ti: "↯", badge: ((A.dataFlow && A.dataFlow.steps) || []).length },
    { id: "deps", label: "Dependencies", ti: "⇄", badge: A.relationships.length },
    { id: "cov", label: "Coverage", ti: "▦" },
    { id: "paths", label: "Paths", ti: "⌥", badge: A.criticalPaths.length },
    { id: "concept", label: "Concept", ti: "✦" },
    { id: "source", label: "Source", ti: "#" },
    { id: "lineage", label: "Lineage Arc", ti: "❡", badge: (A.lineage && A.lineage.total) || 0 },
  ];

  /* ---------------- top bar (slim — one nav toggle, search, view mode) ---------------- */
  function renderTopbar() {
    const stale = daysSince(A.project.regenerated);
    const freshClass = stale > 30 ? "stale" : "fresh";
    $("#topbar").innerHTML = `
      <button class="tb-icon on" id="navToggle" data-tip="${escAttr("Collapse navigation (⌘B)")}">☰</button>
      <div class="tb-brand"><div class="tb-logo"></div>
        <div class="tb-crumb"><span class="proj">${esc(A.project.name)}</span><span class="sep">/</span><span class="file">${esc(A.project.file ? A.project.file.split("/").pop() : "architecture.html")}</span></div>
      </div>
      <div class="tb-spacer"></div>
      <div class="tb-search-wrap">
        <div class="tb-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="search" placeholder="Search subsystems, sections, risks…" autocomplete="off" />
          <kbd>⌘K</kbd>
        </div>
        <div class="search-results" id="searchResults"></div>
      </div>
      <div class="tb-spacer"></div>
      <div class="tb-fresh ${freshClass}" data-tip="${escAttr("architecture.md regenerated " + stale + " days ago (" + A.project.regenerated + ").")}">
        <span class="fresh-dot"></span>${stale}d
      </div>
      <div class="tb-meta">HEAD <b>${esc(A.project.head)}</b></div>
      <div class="tb-viewmode" id="viewMode" data-tip="${escAttr("Switch between the rendered explorer and the raw architecture.md markdown that backs the current view")}">
        <button class="vm-btn active" data-vm="rendered">Rendered</button>
        <button class="vm-btn" data-vm="source">Source</button>
      </div>`;
  }

  /* ---------------- primary navigation (single rail: views + subsystems) ----------------
     Consolidates what used to be TWO navigations — the left "Explorer" drawer and the
     workspace tab strip — into one rail. Top group = the views; below = the subsystem
     index. This is the only place to switch context, so there is no redundant tab bar. */
  function renderNav() {
    const NAV_GROUPS = [
      ["Explore", ["overview", "graph", "calls"]],
      ["Analyse", ["flow", "deps", "cov", "paths", "concept"]],
      ["History", ["lineage", "source"]],
    ];
    const navItem = t => {
      const ki = TABS.indexOf(t);
      const key = ki < 0 ? "" : (ki === 9 ? "0" : String(ki + 1));
      return `
      <button class="nav-item" data-tab="${t.id}" data-tip="${escAttr(t.label)}">
        <span class="nav-ico">${t.ti}</span><span class="nav-lbl">${esc(t.label)}</span>
        ${t.badge != null ? `<span class="nav-badge">${esc(t.badge)}</span>` : ""}
        <span class="nav-key">${key}</span>
      </button>`;
    };
    const views = NAV_GROUPS.map(([label, ids]) =>
      `<div class="nav-grouplbl">${label}</div>` +
      ids.map(id => navItem(TABS.find(t => t.id === id))).join("")
    ).join("");
    const subs = A.nodes.map(n => `
      <button class="nav-sub" data-node="${n.id}" data-kind="${n.kind}" style="--kc: var(--k-${n.kind})" data-search="${esc(n.label)} ${esc(n.kind)}" data-tip="${escAttr(nodeById[n.id].tagline)}">
        <span class="nav-sw" style="background:var(--k-${n.kind})"></span><span class="nav-lbl">${esc(n.label)}</span>
        <span class="nav-flags">${(hotspotByNode[n.id] || 0) >= 60 ? '<span class="flag-hot" title="recent change hotspot">●</span>' : ""}${(riskByNode[n.id] || []).length ? '<span class="flag-risk" title="has risk">▲</span>' : ""}</span>
      </button>`).join("");
    $("#nav").innerHTML = `
      <div class="nav-group">${views}</div>
      <div class="nav-sep"></div>
      <div class="nav-subhead"><span>Subsystems</span><span class="nav-subcount">${A.nodes.length}</span></div>
      <div class="nav-subs" id="navSubs">${subs}</div>`;
    $$("#nav .nav-item").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    $$("#nav .nav-sub").forEach(b => b.addEventListener("click", () => { switchTab("graph"); graph.select(b.dataset.node); }));
  }

  function scrollToAnchor(id) {
    const el = document.getElementById("a-" + id);
    if (!el) return;
    const view = el.closest(".ws-view");
    requestAnimationFrame(() => {
      view.scrollTo({ top: el.offsetTop - 20, behavior: "smooth" });
      el.classList.remove("pulse-anchor"); void el.offsetWidth; el.classList.add("pulse-anchor");
      setTimeout(() => el.classList.remove("pulse-anchor"), 1200);
    });
  }
  function openAnchor(tab, anchor) { switchTab(tab); if (anchor) scrollToAnchor(anchor); }

  /* ---------------- view host (containers only — the nav is the tab strip) ---------------- */
  function renderTabs() {
    $("#wsBody").innerHTML = TABS.map(t => `<div class="ws-view ${t.id === "graph" ? "graph-view" : ""}" data-view="${t.id}"></div>`).join("") +
      `<div class="ws-view md-view" data-view="__md"><div class="doc"><pre class="md-pre" id="mdPre"></pre></div></div>`;
    renderOverview(); renderGraphTab(); renderCallsTab(); renderFlowTab(); renderDepsTab(); renderCovTab();
    renderPathsTab(); renderConceptTab(); renderSourceTab(); renderLineageTab();
  }

  let curTab = "overview", mdMode = false;
  function switchTab(id, opt) {
    if (id !== "__md") curTab = id;
    if (!(opt && opt.keepMd)) mdMode = false;
    $$("#nav .nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === curTab));
    $$("#nav .nav-sub").forEach(b => b.classList.remove("active"));
    const show = mdMode ? "__md" : curTab;
    $$(".ws-view").forEach(v => v.classList.toggle("active", v.dataset.view === show));
    $$("#viewMode .vm-btn").forEach(b => b.classList.toggle("active", (b.dataset.vm === "source") === mdMode));
    if (curTab === "graph" && !mdMode && graph) requestAnimationFrame(() => graph.fit());
    const sv = $("#sbView");
    if (sv) { const tt = TABS.find(t => t.id === curTab); sv.innerHTML = `view · <b>${tt ? esc(tt.label) : esc(curTab)}</b>`; }
    if (window.App.persist) window.App.persist();
  }
  function setMd(on) {
    if (mdMode === on) return;
    mdMode = on;
    if (mdMode) $("#mdPre").textContent = (window.App.markdownFor ? window.App.markdownFor(curTab) : "");
    switchTab(curTab, { keepMd: true });
  }

  /* ---------- GRAPH tab ---------- */
  function renderGraphTab() {
    $('[data-view="graph"]').innerHTML = `
      <div class="ws-toolbar">
        <div class="tool-group">
          <button class="tool-btn active" data-graph-mode="layered"><span class="ti">≡</span>Layered</button>
          <button class="tool-btn" data-graph-mode="force"><span class="ti">✦</span>Force</button>
          <button class="tool-btn" data-graph-mode="radial"><span class="ti">◎</span>Radial</button>
        </div>
        <div class="tool-group">
          <button class="tool-btn" data-impact-toggle id="gImpact" data-tip="${escAttr("Blast-radius mode: select a node to highlight everything that transitively depends on it.")}"><span class="ti">⊛</span>Impact</button>
          <button class="tool-btn" id="gPlay"><span class="ti">▶</span><span id="playLabel">Play tick</span></button>
        </div>
        <div class="tool-group">
          <button class="tool-btn" id="gFit"><span class="ti">⤢</span>Fit</button>
          <button class="tool-btn" id="gArrange" data-tip="${escAttr("Reset layout + cleared dragged positions")}"><span class="ti">↻</span>Reset</button>
        </div>
        <div class="tool-group">
          <button class="tool-btn" id="gZoomOut">−</button>
          <span class="zoom-val" id="zoomVal">100%</span>
          <button class="tool-btn" id="gZoomIn">+</button>
        </div>
        <div class="ws-hint" id="graphHint">drag to pan · scroll to zoom · click node to inspect</div>
      </div>
      <div class="graph-stage" id="graphStage"></div>
      ${graphLegend()}
      <div class="graph-minimap"><svg id="minimapSvg"></svg></div>`;
  }
  function graphLegend() {
    const kinds = Object.entries(A.kindMeta);
    return `<div class="graph-legend collapsed" id="graphLegend">
      <div class="gl-head"><span class="gl-title">Legend</span><span class="gl-toggle">show ▴</span></div>
      <div class="gl-body">
        <div><div class="gl-col-title">Subsystem role</div>
          ${kinds.map(([k, m]) => `<div class="gl-row"><span class="sw" style="background:var(--k-${k})"></span>${esc(m.label)}</div>`).join("")}</div>
        <div><div class="gl-col-title">Edge type</div>
          <div class="gl-row"><span class="ln" style="border-top:2px solid rgba(255,255,255,0.3)"></span>dependency</div>
          <div class="gl-row"><span class="ln" style="border-top:2px solid var(--cyan)"></span>load-bearing</div>
          <div class="gl-row"><span class="ln" style="border-top:2px dashed var(--violet)"></span>write-back</div>
          <div class="gl-row"><span class="ln" style="border-top:2px dashed var(--amber)"></span>hidden coupling</div></div>
      </div></div>`;
  }

  /* ---------- CALL GRAPH tab ----------
     Ego-explorer over the static call graph: callers | focus | callees with
     certainty-labelled edges, the types the focus touches, and a hierarchy
     tree from the entry point. Data arrives from the call-graph analyser as
     window.CALLGRAPH (a bundled callgraph.js loaded before this file) or as
     ARCH.callgraph; when neither exists the view renders an explanatory
     empty state instead. */
  const CALLGRAPH = window.CALLGRAPH || (A && A.callgraph) || null;
  let cgFocusId = null;
  function drawCgEdges() {
    if (!CALLGRAPH) return;
    const stage = $("#cgStage"), svg = $("#cgSvg");
    if (!stage || !svg) return;
    const sr = stage.getBoundingClientRect();
    if (sr.width < 4) return;
    svg.setAttribute("viewBox", `0 0 ${Math.round(sr.width)} ${Math.round(sr.height)}`);
    const pos = {};
    stage.querySelectorAll(".cg-node").forEach(el => {
      const r = el.getBoundingClientRect();
      pos[el.dataset.cg] = { x: r.left - sr.left + r.width / 2, top: r.top - sr.top, bot: r.top - sr.top + r.height, right: r.left - sr.left + r.width, midY: r.top - sr.top + r.height / 2 };
    });
    const defs = `<defs>
      <marker id="cgArr" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0 1.2 L7.5 5 L0 8.8" fill="none" stroke="oklch(0.9 0.02 260 / 55%)" stroke-width="1.7" stroke-linecap="round"/></marker>
      <marker id="cgArrLit" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0 1.2 L7.5 5 L0 8.8" fill="none" stroke="var(--cyan)" stroke-width="1.9" stroke-linecap="round"/></marker>
    </defs>`;
    const paths = CALLGRAPH.edges.map(([a, b, cls]) => {
      const A2 = pos[a], B2 = pos[b];
      if (!A2 || !B2) return "";
      if (a === b) {
        const x = A2.right, y = A2.midY;
        return `<path class="cg-edge loop" data-from="${a}" data-to="${b}" d="M ${x} ${y - 9} C ${x + 34} ${y - 24}, ${x + 34} ${y + 24}, ${x} ${y + 9}" marker-end="url(#cgArr)"/>`;
      }
      const y1 = A2.bot + 1, y2 = B2.top - 2, dy = Math.max(26, (y2 - y1) * 0.52);
      return `<path class="cg-edge ${cls}" data-from="${a}" data-to="${b}" d="M ${A2.x} ${y1} C ${A2.x} ${y1 + dy}, ${B2.x} ${y2 - dy}, ${B2.x} ${y2}" marker-end="url(#cgArr)"/>`;
    }).join("");
    svg.innerHTML = defs + paths;
    cgPaint();
  }
  function cgPaint() {
    $$("#cgSvg .cg-edge").forEach(p => {
      const inc = p.dataset.from === cgFocusId || p.dataset.to === cgFocusId;
      p.classList.toggle("inc", inc);
      p.setAttribute("marker-end", inc ? "url(#cgArrLit)" : "url(#cgArr)");
    });
  }
  function cgFocus(id) {
    if (!CALLGRAPH) return;
    const C = CALLGRAPH, n = C.nodes.find(x => x.id === id);
    if (!n) return;
    cgFocusId = id;
    $$("#cgStage .cg-node").forEach(el => el.classList.toggle("focus", el.dataset.cg === id));
    cgPaint();
    const callers = C.edges.filter(e => e[1] === id && e[0] !== id).map(e => C.nodes.find(x => x.id === e[0])).filter(Boolean);
    const callees = C.edges.filter(e => e[0] === id && e[1] !== id).map(e => C.nodes.find(x => x.id === e[1])).filter(Boolean);
    const blast = (() => { const seen = new Set([id]); let fr = [id]; while (fr.length) { const nx = []; fr.forEach(u => C.edges.forEach(e => { if (e[0] === u && e[1] !== u && !seen.has(e[1])) { seen.add(e[1]); nx.push(e[1]); } })); fr = nx; } return seen.size - 1; })();
    const chip = m => `<button class="dep-chip cg-jump" data-cg="${m.id}">${esc(m.name)}</button>`;
    const d = $("#cgDossier");
    if (d) d.innerHTML = `
      <div class="cg-d-main">
        <div class="cg-d-eyebrow">focused function</div>
        <div class="cg-d-name">${esc(n.name.replace(/\(\)$/, ""))}<span>()</span></div>
        ${n.sig ? `<div class="cg-d-sig">${esc(n.sig)}</div>` : ""}
        <div class="cg-d-meta"><span class="cg-fn-file">${esc(n.meta)}</span><span class="cg-cert ${n.cert}">${esc(n.cert)}</span>${n.badge ? `<span class="cg-badge">${esc(n.badge)}</span>` : ""}${n.rec ? `<span class="cg-badge rec">↺ recursive</span>` : ""}</div>
        ${n.doc ? `<p class="cg-d-doc">${esc(n.doc)}</p>` : ""}
        <div class="rr-stats cg-d-stats"><span><b>${callers.length}</b> in</span><span><b>${callees.length}</b> out</span><span><b>${blast}</b> reach</span></div>
      </div>
      <div class="cg-d-cols">
        <div><div class="chip-cap">called by · ${callers.length}</div><div class="chip-row">${callers.map(chip).join("") || '<span class="cg-none">entry point</span>'}</div></div>
        <div><div class="chip-cap">calls · ${callees.length}</div><div class="chip-row">${callees.map(chip).join("") || '<span class="cg-none">leaf</span>'}</div></div>
        ${C.types && C.types.length ? `<div><div class="chip-cap">${esc(C.typesLabel || "types in scope")}</div><div class="chip-row">${C.types.map(t => `<span class="dep-chip cg-type">${esc(t)}</span>`).join("")}</div></div>` : ""}
      </div>`;
    const entryN = C.nodes.find(x => x.entry);
    const entryName = entryN ? entryN.name.replace(/\(\)$/, "") : "entry";
    const cr = $("#cgCrumbs");
    if (cr) cr.innerHTML = (entryN && id === entryN.id ? [entryName] : [entryName, n.name.replace(/\(\)$/, "")]).map((c2, i, arr) => `${i ? '<span class="cg-crumb-sep">▸</span>' : ""}<span class="cg-crumb ${i === arr.length - 1 ? "cur" : ""}">${esc(c2)}</span>`).join("") + `<span class="cg-crumb-hint">click any function to refocus</span>`;
    $$("#cgDossier .cg-jump").forEach(b => b.addEventListener("click", () => cgFocus(b.dataset.cg)));
  }
  window.App.cgFocus = cgFocus;
  if (CALLGRAPH && !window.CALLGRAPH) window.CALLGRAPH = CALLGRAPH;
  function renderCallsTab() {
    const C = CALLGRAPH;
    if (!C || !C.nodes || !C.nodes.length) {
      $('[data-view="calls"]').innerHTML = `<div class="doc cg-doc">
        <div class="doc-head"><div class="doc-title">Call Graph</div>
          <div class="doc-sub">static call graph · no data generated yet</div></div>
        <div class="card cg-empty">
          <div class="cg-empty-mark">⌁</div>
          <p>No call-graph data has been generated for this repository yet. The
          analyser emits <code>context/arch/callgraph.js</code> during the arch
          pipeline; once it is bundled, this view renders the function-level map:
          entry points, call edges with certainty labels, recursion and fan-in
          badges, the focused-function dossier, and the hierarchy tree from the
          entry point.</p>
        </div></div>`;
      return;
    }
    cgFocusId = cgFocusId || ((C.nodes.find(n2 => n2.entry && /(^|\.)main\b/i.test(n2.name)) || C.nodes.find(n2 => n2.entry) || C.nodes[0]).id);
    const stat = ([l, v, tone, sub]) => `<div class="cg-stat ${tone}"><span class="cg-stat-v">${v}</span><span class="cg-stat-l">${esc(l)}</span><span class="cg-stat-sub">${esc(sub || "")}</span></div>`;
    const rows = {};
    C.nodes.forEach(n2 => (rows[n2.row] = rows[n2.row] || []).push(n2));
    const rankHtml = Object.keys(rows).sort((a, b) => a - b).map(r => `
      <div class="cg-rank">${rows[r].map(n2 => `
        <button class="cg-node cert-${n2.cert} ${n2.entry ? "entry" : ""} ${n2.ext ? "ext" : ""}" data-cg="${n2.id}">
          <span class="cg-node-name">${esc(n2.name)}</span>
          <span class="cg-node-meta">${esc(n2.meta)}${n2.badge ? ` · <b>${esc(n2.badge)}</b>` : ""}${n2.rec ? ' · <b class="rec">↺</b>' : ""}</span>
        </button>`).join("")}</div>`).join("");
    const treeRow = r => `
      <div class="cg-row ${r.hot ? "hot" : ""} ${r.rec ? "rec" : ""} ${r.multi ? "multi" : ""}">
        <span class="cg-pre">${esc(r.pre)}</span><span class="cg-tog">${r.tog}</span>
        <span class="cg-rname">${esc(r.name)}</span><span class="cg-rmeta">${esc(r.meta)}</span>
        ${r.note ? `<span class="cg-rnote">${esc(r.note)}</span>` : ""}
      </div>`;
    $('[data-view="calls"]').innerHTML = `<div class="doc cg-doc">
      <div class="doc-head"><div class="doc-title">Call Graph</div>
        <div class="doc-sub">${esc(C.scope)}</div></div>
      <div class="cg-stats">${C.stats.map(stat).join("")}</div>
      <div class="cg-crumbs" id="cgCrumbs"></div>
      <div class="cg-stage" id="cgStage"><svg class="cg-svg" id="cgSvg" preserveAspectRatio="none"></svg>${rankHtml}</div>
      <div class="cg-legend">${C.legend.map(([k, d2]) => `<span class="cg-key"><span class="cg-cert ${k}">${esc(k)}</span><span class="cg-key-d">${esc(d2)}</span></span>`).join("")}</div>
      <div class="cg-dossier" id="cgDossier"></div>
      ${C.tree && C.tree.length ? `<div id="a-cgtree" style="margin-top:34px"><div class="section-eyebrow">Hierarchy · from ${esc(((C.nodes.find(n2 => n2.entry) || {}).name || "entry").replace(/\(\)$/, ""))}() · depth-first</div>
        <div class="card cg-treecard"><div class="cg-tree">${C.tree.map(treeRow).join("")}</div></div></div>` : ""}
    </div>`;
    const stage = $("#cgStage"), svg = $("#cgSvg");
    stage.querySelectorAll(".cg-node").forEach(el => {
      el.addEventListener("click", () => cgFocus(el.dataset.cg));
      el.addEventListener("mouseenter", ev => {
        $$("#cgSvg .cg-edge").forEach(p => p.classList.toggle("lit", p.dataset.from === el.dataset.cg || p.dataset.to === el.dataset.cg));
        const n2 = C.nodes.find(x => x.id === el.dataset.cg);
        const ins2 = C.edges.filter(e => e[1] === n2.id && e[0] !== n2.id).length, outs2 = C.edges.filter(e => e[0] === n2.id && e[1] !== n2.id).length;
        if (window.__tip) window.__tip.show(ev.clientX, ev.clientY, `<b>${esc(n2.name)}</b><span class="tip-rel cg-cert ${n2.cert}">${n2.cert}</span>` + tipRow("site", esc(n2.meta)) + tipRow("called by", ins2) + tipRow("calls", outs2));
      });
      el.addEventListener("mousemove", ev => window.__tip && window.__tip.move(ev.clientX, ev.clientY));
      el.addEventListener("mouseleave", () => { $$("#cgSvg .cg-edge.lit").forEach(p => p.classList.remove("lit")); if (window.__tip) window.__tip.hide(); });
    });
    svg.addEventListener("mouseover", ev => {
      const p = ev.target.closest(".cg-edge");
      if (!p || !window.__tip) return;
      p.classList.add("lit");
      window.__tip.show(ev.clientX, ev.clientY, `<b>${esc(p.dataset.from)} → ${esc(p.dataset.to)}</b>` + tipRow("certainty", p.classList.contains("external") ? "external" : p.classList.contains("loop") ? "recursive" : "resolved"));
    });
    svg.addEventListener("mousemove", ev => window.__tip && window.__tip.move(ev.clientX, ev.clientY));
    svg.addEventListener("mouseout", ev => {
      const p = ev.target.closest(".cg-edge");
      if (p) p.classList.remove("lit");
      if (window.__tip) window.__tip.hide();
    });
    new ResizeObserver(() => drawCgEdges()).observe(stage);
    requestAnimationFrame(drawCgEdges);
    cgFocus(cgFocusId);
  }

  /* ---------- FLOW tab ---------- */
  function tagStyle(sys) {
    const n = nodeById[sys.split("::")[0]];
    const k = n ? n.kind : "observer";
    return `color:var(--k-${k});background:color-mix(in srgb, var(--k-${k}) 14%, transparent)`;
  }
  let flowView = "timeline";
  function curFlowSteps() { return (A.dataFlow && A.dataFlow.steps) || []; }
  function renderFlowTab() {
    const stepCount = curFlowSteps().length;
    $('[data-view="flow"]').innerHTML = `<div class="doc">
      <div class="doc-head" id="a-flow"><div class="doc-title">Core Execution / Data Flow</div>
      <div class="doc-sub">One traced operation · ${stepCount} step${stepCount === 1 ? "" : "s"} across the subsystem boundaries · click a step to flash it, hover a state to trace it</div></div>
      <div class="flow-controls">
        <div class="seg" id="flowView">
          <button class="seg-btn active" data-fv="timeline">Timeline</button>
          <button class="seg-btn" data-fv="swimlane">Swimlanes</button>
        </div>
        <button class="tool-btn solo" id="flowPlay" data-tip="${escAttr("Animate the traced operation across the topology graph")}"><span class="ti">▶</span>Play on graph</button>
      </div>
      <p class="doc-intro" id="flowIntro"></p>
      <div id="flowBody"></div>
      ${failuresHtml()}
    </div>`;
    paintFlowBody();
    $$("#flowView .seg-btn").forEach(b => b.addEventListener("click", () => { flowView = b.dataset.fv; $$("#flowView .seg-btn").forEach(x => x.classList.toggle("active", x === b)); paintFlowBody(); }));
    $("#flowPlay").addEventListener("click", () => playTick());
    wireFailures();
  }
  function paintFlowBody() {
    const f = A.dataFlow, steps = curFlowSteps();
    $("#flowIntro").innerHTML = esc((f && f.intro) || "");
    $("#flowBody").innerHTML = flowView === "swimlane" ? swimlaneHtml(steps) : timelineHtml(steps);
    $$('#flowBody .flow-step').forEach(st => st.addEventListener("click", () => {
      flashStep(+st.dataset.step);
      $$('#flowBody .flow-step').forEach(x => x.classList.remove("step-sel"));
      st.classList.add("step-sel");
      const node = st.dataset.node;          // open the owning subsystem in the side inspector — stays on this tab
      if (node && graph && graph.hasNode(node)) graph.select(node);
    }));
  }
  function timelineHtml(steps) {
    return A.dataFlow.simsets.map(set => {
      const ss = steps.filter(s => s.set === set);
      if (!ss.length) return "";
      return `<div class="flow-set"><div class="flow-set-head"><span class="flow-set-name">${esc(set)}</span><span class="flow-set-count">steps ${ss[0].n}–${ss[ss.length - 1].n} · ${ss.length}</span><span class="flow-set-line"></span></div>
        <div class="flow-steps">${ss.map(stepCard).join("")}</div></div>`;
    }).join("");
  }
  function stepCard(s) {
    const tip = `<b>${esc(String(s.n).padStart(2, "0"))} · ${esc(s.fn)}</b>` + tipRow("system", esc(s.sys)) + tipRow("reads", esc(s.reads)) + tipRow("writes", esc(s.writes));
    return `<div class="flow-step ${s.fail ? "fail" : ""}" data-step="${s.n}" data-node="${s.sys.split("::")[0]}" data-tip="${escAttr(tip)}">
      <div class="fs-num">${String(s.n).padStart(2, "0")}</div>
      <div class="fs-main">
        <div class="fs-sys"><span class="fs-tag" style="${tagStyle(s.sys)}">${esc(s.sys)}</span><span class="fs-fn">${esc(s.fn)}</span></div>
        <div class="fs-io"><span class="io-k">reads</span><span class="io-v">${linkifyStates(s.reads)}</span>
          <span class="io-k">writes</span><span class="io-v write">${linkifyStates(s.writes)}</span></div>
      </div></div>`;
  }
  function swimlaneHtml(steps) {
    const cols = [];
    steps.forEach(s => { const c = s.sys.split("::")[0]; if (!cols.includes(c)) cols.push(c); });
    // Order by node-order in A.nodes (which respects the data-declared layer
    // sequence); anything not in A.nodes goes after, preserving first-seen
    // order from the steps. Project-agnostic.
    const nodeOrder = {};
    (A.nodes || []).forEach((n, i) => { nodeOrder[n.id] = i; });
    cols.sort((a, b) => (nodeOrder[a] != null ? nodeOrder[a] : 1e6) - (nodeOrder[b] != null ? nodeOrder[b] : 1e6));
    let h = `<div class="swim" style="grid-template-columns:34px repeat(${cols.length},minmax(120px,1fr))">`;
    h += `<div class="swim-corner"></div>` + cols.map(c => `<div class="swim-head" style="${tagStyle(c)}">${esc(c)}</div>`).join("");
    steps.forEach(s => {
      const owner = s.sys.split("::")[0];
      h += `<div class="swim-num ${s.fail ? "fail" : ""}">${String(s.n).padStart(2, "0")}</div>`;
      cols.forEach(c => {
        if (c === owner) h += `<div class="swim-cell flow-step ${s.fail ? "fail" : ""}" data-step="${s.n}" data-node="${owner}">
          <div class="swim-fn">${esc(s.fn)}</div><div class="swim-io">${linkifyStates(s.writes)}</div></div>`;
        else h += `<div class="swim-empty"></div>`;
      });
    });
    h += `</div>`;
    return h;
  }
  function failuresHtml() {
    return `<div class="card" id="a-failures" style="margin-top:14px">
      <div class="section-eyebrow">Failure semantics along the chain · ${A.failures.length} invariants · hover to highlight the bound steps</div>
      <div style="display:grid;gap:9px">
        ${A.failures.map((fl, i) => {
          const linked = String(fl.link).match(/\d+/g) || [fl.step];
          return `<div class="fail-inv" data-steps="${linked.join(",")}">
            <div class="fs-num" style="min-width:58px;color:var(--amber)">${esc(fl.link)}</div>
            <div class="fs-main"><div class="fs-fn" style="color:var(--tx);margin-bottom:3px">${esc(fl.title)}</div>
            <div style="font-size:11.5px;line-height:1.6;color:var(--tx-3)">${linkifyStates(fl.body)}</div></div></div>`;
        }).join("")}
      </div></div>`;
  }
  function wireFailures() {
    $$('#a-failures .fail-inv').forEach(fi => {
      const steps = fi.dataset.steps.split(",");
      fi.addEventListener("mouseenter", () => steps.forEach(n => $$(`#flowBody .flow-step[data-step="${n}"]`).forEach(s => s.classList.add("step-lit"))));
      fi.addEventListener("mouseleave", () => $$('#flowBody .flow-step.step-lit').forEach(s => s.classList.remove("step-lit")));
      fi.addEventListener("click", () => {
        $$('#a-failures .fail-inv').forEach(x => x.classList.toggle("inv-sel", x === fi));
        $$('#flowBody .flow-step.step-pin').forEach(s => s.classList.remove("step-pin"));
        steps.forEach(n => $$(`#flowBody .flow-step[data-step="${n}"]`).forEach(s => s.classList.add("step-pin")));
        const first = $(`#flowBody .flow-step[data-step="${steps[0]}"]`);
        if (first) { const v = first.closest(".ws-view"); if (v) v.scrollTo({ top: first.offsetTop - 30, behavior: "smooth" }); }
        flashStep(+steps[0]);
      });
    });
  }
  function flashStep(n) {
    $$(`#flowBody .flow-step[data-step="${n}"], #flowBody .swim-cell[data-step="${n}"]`).forEach(s => { s.classList.remove("flash"); void s.offsetWidth; s.classList.add("flash"); });
  }
  function playTick() {
    switchTab("graph");
    const steps = (A.dataFlow && A.dataFlow.steps) || [];
    const seq = steps.map(s => s.sys.split("::")[0]).filter((id, i, a) => id !== a[i - 1]);
    graph.flowNodes(seq, { interval: 420 });
  }

  /* ---------- DEPENDENCIES tab ---------- */
  function renderDepsTab() {
    const layers = `<div id="a-layers"><div class="section-eyebrow">Dependency direction · layered · downward-only</div>
      <div class="layer-stack">${A.layers.map((l, i) => `${i ? '<div class="layer-arrow">▼</div>' : ''}
        <div class="layer-box" data-layer="${esc(l.name)}"><div class="layer-name">${esc(l.name)}</div><div class="layer-role">${esc(l.role)}</div></div>`).join("")}</div>
      <p style="margin-top:14px;font-size:11.5px;line-height:1.6;color:var(--tx-3);max-width:680px">${linkifyStates(A.layersNote)}</p></div>`;

    const rel = `<div id="a-relations" style="margin-top:34px">
      <div class="section-eyebrow">Inter-system relationships · ${A.relationships.length} edges · click a row to trace it on the graph</div>
      <div class="rel-tools"><div class="tb-search mini"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input id="relSearch" placeholder="filter relationships…"/></div></div>
      <div class="card" style="padding:6px 14px;overflow-x:auto">
        <table class="rel-table" id="relTable"><thead><tr><th>A</th><th>B</th><th>Mechanism</th><th>Data</th><th>Breaks if violated</th></tr></thead>
        <tbody>${A.relationships.map(r => `<tr data-a="${esc(normNode(r.a) || "")}" data-b="${esc(normNode(r.b) || "")}" data-hay="${escAttr((r.a + " " + r.b + " " + r.mech + " " + r.data + " " + r.breaks).toLowerCase())}">
          <td class="side">${esc(r.a)}</td><td class="side">${esc(r.b)}</td>
          <td>${linkifyStates(r.mech)}</td><td>${esc(r.data)}</td><td class="breaks">${esc(r.breaks)}</td></tr>`).join("")}</tbody></table>
      </div></div>`;

    const state = `<div id="a-state" style="margin-top:34px"><div class="section-eyebrow">State ownership · who owns what; who else reads it</div>
      <div class="grid-2">${A.stateOwnership.map(s => `<div class="kv-card"><div class="owner" data-node="${esc(normNode(s.owner) || "")}">${esc(s.owner)}</div><div class="items">${linkifyStates(s.items)}</div></div>`).join("")}</div></div>`;

    $('[data-view="deps"]').innerHTML = `<div class="doc">
      <div class="doc-head"><div class="doc-title">Dependencies & Structure</div>
      <div class="doc-sub">Layered direction, the full edge ledger, the adjacency matrix and state-ownership boundaries</div></div>
      ${layers}<div id="a-matrix" style="margin-top:34px">${matrixHtml()}</div>${rel}${state}</div>`;

    wireMatrix(); wireRelTable();
    $$('#a-state .owner[data-node]').forEach(o => { if (o.dataset.node) o.addEventListener("click", () => { switchTab("graph"); graph.select(o.dataset.node); }); });
    $$('#a-layers .layer-box').forEach(b => b.addEventListener("click", () => {
      const ids = b.dataset.layer.split("·").map(s => s.trim());
      switchTab("graph"); if (graph.hasNode(ids[0])) graph.select(ids[0]);
    }));
  }
  function matrixHtml() {
    const ids = A.nodes.map(n => n.id);
    const adj = {}; ids.forEach(a => adj[a] = {});
    A.edges.forEach(e => { adj[e.from][e.to] = e.rel; });
    return `<div class="section-eyebrow">Adjacency matrix · row → column means “row feeds / is depended-on-by column”</div>
      <div class="card matrix-scroll" style="padding:14px"><table class="matrix" id="adjMatrix"><thead><tr><th></th>
      ${ids.map((c, i) => `<th data-col="${i}"><span class="mx-colh">${esc(c)}</span></th>`).join("")}</tr></thead><tbody>
      ${ids.map((r, ri) => `<tr data-row="${ri}"><th class="rowh">${esc(r)}</th>${ids.map((c, ci) => {
        if (r === c) return `<td class="diag" data-row="${ri}" data-col="${ci}">·</td>`;
        const rel = adj[r][c];
        if (!rel) return `<td data-row="${ri}" data-col="${ci}"></td>`;
        const cls = rel === "strong" ? "strong" : (rel === "write" ? "wr" : rel === "peer" ? "pe" : "on");
        const ch = rel === "peer" ? "↔" : "→";
        const relLbl = { dep: "dependency", strong: "load-bearing", write: "write-back", peer: "hidden coupling" }[rel] || rel;
        const mTip = `<b>${esc(r)} → ${esc(c)}</b><span class="tip-rel rel-${rel}">${relLbl}</span>` + esc((A.edges.find(e => e.from === r && e.to === c) || {}).label || "");
        return `<td class="${cls}" data-row="${ri}" data-col="${ci}" data-from="${r}" data-to="${c}" data-tip="${escAttr(mTip)}">${ch}</td>`;
      }).join("")}</tr>`).join("")}
      </tbody></table></div>`;
  }
  function wireMatrix() {
    const tbl = $("#adjMatrix"); if (!tbl) return;
    tbl.querySelectorAll("td[data-from]").forEach(td => {
      td.addEventListener("mouseenter", () => {
        tbl.querySelectorAll(`[data-row="${td.dataset.row}"]`).forEach(x => x.classList.add("mx-hl"));
        tbl.querySelectorAll(`[data-col="${td.dataset.col}"]`).forEach(x => x.classList.add("mx-hl"));
      });
      td.addEventListener("mouseleave", () => tbl.querySelectorAll(".mx-hl").forEach(x => x.classList.remove("mx-hl")));
      td.addEventListener("click", () => { switchTab("graph"); graph.selectEdge(td.dataset.from, td.dataset.to); });
    });
  }
  function wireRelTable() {
    const inp = $("#relSearch");
    if (inp) inp.addEventListener("input", () => {
      const q = inp.value.trim().toLowerCase();
      $$('#relTable tbody tr').forEach(tr => tr.style.display = (!q || tr.dataset.hay.includes(q)) ? "" : "none");
    });
    $$('#relTable tbody tr').forEach(tr => tr.addEventListener("click", () => {
      const a = tr.dataset.a, b = tr.dataset.b;
      if (a && b && graph.hasNode(a) && graph.hasNode(b)) { switchTab("graph"); graph.selectEdge(a, b); }
      else if (a) { switchTab("graph"); graph.select(a); }
    }));
  }

  /* ---------- COVERAGE tab ----------
     LENS provides a one-line description per coverage column. Projects override
     this via A.coverage.lenses = { <col-id>: "description", ... } when they
     want richer column hover text. Without that, the column id itself is used
     as the lens label - project-agnostic by default. */
  const LENS = (A.coverage && A.coverage.lenses) || {};
  const LVL = { 3: "Full inspection this pass", 2: "Partial inspection", 1: "Trusted from a prior pass" };
  const LVLSHORT = { 3: "full", 2: "partial", 1: "trusted" };
  function renderCovTab() {
    const c = A.coverage;
    let depthSum = 0, depthN = 0;
    const lensCount = {}; c.cols.forEach(l => lensCount[l] = 0);
    const rows = c.rows.map(row => {
      const lenses = c.cols.filter(co => row.cells[co]).sort((a, b) => row.cells[b] - row.cells[a]);
      const max = lenses.length ? Math.max(...lenses.map(l => row.cells[l])) : 0;
      if (max) { depthSum += max; depthN++; }
      lenses.forEach(l => lensCount[l]++);
      const chips = lenses.length ? lenses.map(l => {
        const v = row.cells[l], pv = (row.prev && row.prev[l]) || 0;
        const delta = v - pv;
        const arr = pv === 0 && v > 0 ? '<span class="cov-delta new">NEW</span>' : (delta > 0 ? `<span class="cov-delta up">▲${delta}</span>` : "");
        return `<span class="cov-chip lv${v}" data-tip="${escAttr(LENS[l] + " — " + LVL[v] + " (" + v + ")" + (pv ? " · prior pass: " + pv : " · not inspected last pass"))}">${esc(l)}<span class="lvl">${LVLSHORT[v]}</span>${arr}</span>`;
      }).join("") : `<span class="cov-empty">no inspection logged — trusted from structure</span>`;
      const rowTip = `<b>${esc(row.label)}</b>` + (lenses.length
        ? lenses.map(l => tipRow(esc(l), LVLSHORT[row.cells[l]] + (row.prev && row.prev[l] ? " · was " + LVLSHORT[row.prev[l]] : " · new"))).join("")
        : tipRow("status", "trusted from structure"));
      return `<div class="cov-row2 ${max ? "" : "uncovered"}" data-node="${esc(row.node || "")}" data-tip="${escAttr(rowTip)}">
        <div class="cov-mod">${esc(row.label)}</div>
        <div class="cov-depth"><div class="cov-depth-track"><div class="cov-depth-fill" style="width:${(max / 3) * 100}%"></div></div><span class="cov-depth-label">${max ? LVLSHORT[max] : "—"}</span></div>
        <div class="cov-chips">${chips}</div>
      </div>`;
    }).join("");
    const score = depthN ? (depthSum / depthN) : 0;
    const ringLen = 2 * Math.PI * 19;
    const summary = `<div class="cov-summary">
      <div class="cov-score">
        <div class="cov-ringwrap"><svg class="cov-ring" viewBox="0 0 46 46"><circle class="bgc" cx="23" cy="23" r="19"/><circle class="fgc" cx="23" cy="23" r="19" style="stroke-dasharray:${(score / 3 * ringLen).toFixed(1)} ${ringLen.toFixed(1)}"/></svg>
          <div class="cov-score-val">${score.toFixed(1)}<span>/3</span></div></div>
        <div class="cov-score-lbl">mean depth across ${depthN} inspected modules</div></div>
      <div class="cov-lenscol">${c.cols.map(l => `<div class="cov-lenscell" data-tip="${escAttr(`<b>${esc(l)}</b>` + (LENS[l] || ""))}"><span class="cov-lenscount">${lensCount[l]}</span><span class="cov-lensname">${esc(l)}</span><span class="cov-lensshare">${c.rows.length ? Math.round(lensCount[l] / c.rows.length * 100) : 0}%</span></div>`).join("")}</div>
    </div>`;

    $('[data-view="cov"]').innerHTML = `<div class="doc">
      <div class="doc-head"><div class="doc-title">Coverage</div>
      <div class="doc-sub">Which inspection lenses examined each source module, how deeply, and what changed since the prior pass · ${esc(A.project.regenerated)}</div></div>
      <p class="cov-intro">Each pass walks the code through a set of <strong>lenses</strong>. A module's <strong>depth</strong> is the deepest lens applied to it this pass; <span style="color:var(--cyan)">▲ / NEW</span> marks modules freshly re-read since last time. Click a module to open its node.</p>
      ${summary}
      <div class="cov-scale"><span class="cov-scale-label">Depth</span><div class="cov-scale-group">
        <span class="cov-scale-item"><span class="cov-swatch lv3"></span>Full (3)</span>
        <span class="cov-scale-item"><span class="cov-swatch lv2"></span>Partial (2)</span>
        <span class="cov-scale-item"><span class="cov-swatch lv1"></span>Trusted (1)</span></div></div>
      <div class="cov-lens-key">${c.cols.map(co => `<span class="cov-lens-pill" data-tip="${escAttr(LENS[co])}"><b>${esc(co)}</b></span>`).join("")}</div>
      <div class="cov-rows" id="a-cov">${rows}</div>
      <p style="margin-top:18px;font-size:11.5px;line-height:1.6;color:var(--tx-3);max-width:740px">${esc(c.note)}</p></div>`;
    $$('#a-cov .cov-row2[data-node]').forEach(r => { if (r.dataset.node) r.addEventListener("click", () => { switchTab("graph"); graph.select(r.dataset.node); }); });
  }

  /* ---------- PATHS tab ---------- */
  function renderPathsTab() {
    const paths = `<div id="a-paths"><div class="section-eyebrow">Critical paths and blast radius · ${A.criticalPaths.length} chains · ▶ traces the chain across the graph</div>
      ${A.criticalPaths.map((p, i) => `<div class="path-card">
        <div class="path-head"><span class="path-name">${esc(p.name)}</span>
          <span style="display:flex;align-items:center;gap:10px"><span class="path-len">${esc(p.len)}</span>
          <button class="tool-btn solo path-play ${traceable(p.steps) ? "" : "is-off"}" data-path="${i}" data-tip="${escAttr(traceable(p.steps) ? `<b>Trace</b>animates ${pathNodeSeq(p.steps).length} subsystems across the graph` : "Not traceable - these steps aren't subsystems on the graph")}"><span class="ti">▶</span>Trace</button></span></div>
        <div class="path-flow">${p.steps.map((s, j) => { const nd = PATHMAP[s] || (nodeById[s] ? s : ""); return `${j ? '<span class="path-arrow">→</span>' : ''}<span class="path-step${nd ? " is-node" : ""}"${nd ? ` data-node="${esc(nd)}"` : ""}>${esc(s)}</span>`; }).join("")}</div>
        <p class="path-blast">${linkifyStates(p.blast)}</p></div>`).join("")}</div>`;

    // Generic bespoke[] renderer. Each item in A.bespoke is a project-specific
    // deep-dive widget with shape: {id, title, subtitle, steps[], panels[], ctx?}.
    // Project-agnostic: the rendering reads from data only; no hardcoded
    // pipeline names, no hardcoded category-to-panel maps. Projects that need
    // a category-to-panel spotlight declare it via bespoke[].catPanel.
    const bespokeBlocks = (A.bespoke || []).map(b => `
      <div id="a-bespoke-${esc(b.id)}" style="margin-top:36px">${bespokeExplorer(b)}</div>
    `).join("");
    $('[data-view="paths"]').innerHTML = `<div class="doc">
      <div class="doc-head"><div class="doc-title">Critical Paths</div>
      <div class="doc-sub">End-to-end chains worth tracing${(A.bespoke && A.bespoke.length) ? " plus bespoke explorers" : ""}</div></div>
      ${paths}${bespokeBlocks}</div>`;
    (A.bespoke || []).forEach(b => wireBespokeExplorer(b));
    $$('[data-view="paths"] .path-play').forEach(b => b.addEventListener("click", () => traceOnGraph(A.criticalPaths[+b.dataset.path].steps)));
    $$('[data-view="paths"] .path-step.is-node').forEach(el => el.addEventListener("click", () => graph.select(el.dataset.node)));
  }
  function bespokeExplorer(b) {
    const stepsHtml = (b.steps || []).map(s => `<div class="tick-step" data-cat="${esc(s.cat || "")}" data-sys="${esc(s.sys || "")}" data-id="${esc(s.id)}">
      <div class="tick-num">${esc(s.id)}</div><div class="tick-body"><span class="sys">${esc(s.sys || "")}</span> ${s.sys ? "·" : ""} ${linkifyStates(s.body || "")}</div></div>`).join("");
    const panelsHtml = (b.panels || []).map(p => `<div class="tick-panel" data-panel="${esc(p.title)}">
      <div class="tick-ptitle">${esc(p.title)}</div>
      ${p.chart ? `<div class="mini-chart">${p.chart.map(h => `<div class="mini-bar" style="height:${h}%;background:${esc(p.chartColor || "var(--cyan)")}"></div>`).join("")}</div>` : ""}
      ${(p.rows || []).map(r => `<div class="tick-prow"><span class="label">${esc(r[0])}</span><span class="val">${esc(r[1])}</span></div>`).join("")}</div>`).join("");
    return `<div class="section-eyebrow" style="color:var(--violet)">${esc(b.title)} · bespoke widget</div>
      <div class="bespoke-banner">${esc(b.subtitle || "")}</div>
      <div class="tick-wrap" data-tick="${esc(b.id)}">
        <div class="tick-flow">${stepsHtml}</div>
        <div class="tick-side">${panelsHtml}</div>
      </div>`;
  }
  function wireBespokeExplorer(b) {
    const wrap = document.querySelector(`.tick-wrap[data-tick="${b.id}"]`);
    if (!wrap) return;
    const side = wrap.querySelector(".tick-side");
    const catPanel = b.catPanel || {};
    function clearDetail() {
      wrap.querySelectorAll(".tick-step").forEach(s => s.classList.remove("active"));
      wrap.querySelectorAll(".tick-panel").forEach(p => p.classList.remove("panel-lit"));
      const d = side.querySelector(".tick-detail"); if (d) d.remove();
    }
    wrap.querySelectorAll(".tick-step").forEach(st => st.addEventListener("click", () => {
      const wasActive = st.classList.contains("active");
      clearDetail();
      if (wasActive) return;
      st.classList.add("active");
      const step = (b.steps || []).find(s => s.id === st.dataset.id) || {};
      const pt = catPanel[st.dataset.cat];
      if (pt) { const panel = [...wrap.querySelectorAll(".tick-panel")].find(p => p.dataset.panel === pt); if (panel) panel.classList.add("panel-lit"); }
      const d = document.createElement("div"); d.className = "tick-detail"; side.insertBefore(d, side.firstChild);
      d.innerHTML = `<div class="tdh">Step ${esc(st.dataset.id)}${st.dataset.sys ? ` · <span class="sys">${esc(st.dataset.sys)}</span>` : ""}</div>
        <div class="td-body">${esc(step.body || "")}</div>
        ${(b.ctx && b.ctx[st.dataset.cat]) ? `<div class="td-ctx">${esc(b.ctx[st.dataset.cat])}${pt ? ` <span class="td-see">-> see ${esc(pt)}</span>` : ""}</div>` : ""}`;
    }));
  }

  /* ---------- CONCEPT tab (interactive mini-graph) ---------- */
  function renderConceptTab() {
    const c = A.concept;
    $('[data-view="concept"]').innerHTML = `<div class="doc">
      <div class="doc-head"><div class="doc-title">Concept & Reality</div>
      <div class="doc-sub">The domain knowledge map (distinct from the dependency graph) and what is actually true at HEAD ${esc(A.project.head)}</div></div>
      <div id="a-concept"><div class="section-eyebrow">Concept map · click a branch to open its subsystem · hover a leaf for its glossary definition</div>
        <div class="cmap" id="conceptMap"></div></div>
      <div id="a-notes" style="margin-top:30px"><div class="section-eyebrow">Structural notes / current reality · ${A.notes.length} notes</div>
        <div class="grid-2">${A.notes.map(n => `<div class="note-card ${n.sev}">
          <div class="note-head"><span class="note-tag ${n.sev}">${esc(n.tag)}</span><span class="note-title">${esc(n.title)}</span></div>
          <div class="note-body">${linkifyStates(n.body)}</div></div>`).join("")}</div></div></div>`;
    renderConceptGraph();
  }
  const GLOSS = {}; A.glossary.forEach(g => GLOSS[g.term.toLowerCase()] = g.def);
  function leafDef(text) {
    for (const k in GLOSS) if (text.toLowerCase().includes(k)) return GLOSS[k];
    return text;
  }
  // Concept map rendered as a responsive grid of branch cards (was an
  // absolutely-positioned SVG whose fixed geometry overlapped its own labels
  // whenever a branch had more than a couple of leaves). Cards reflow, so
  // overlap is structurally impossible regardless of branch / leaf counts.
  function renderConceptGraph() {
    const host = $("#conceptMap"); if (!host) return;
    const c = A.concept;
    const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
    const card = (b, i) => {
      const col = b.kind ? `var(--k-${b.kind})` : palette[i % palette.length];
      const leaves = (b.leaves || []).map(lf => `<span class="cmap-leaf" data-tip="${escAttr(leafDef(lf))}">${esc(lf)}</span>`).join("");
      const trunks = (b.trunks || []).map(t => `<div class="cmap-trunk">${linkifyStates(t)}</div>`).join("");
      return `<div class="cmap-branch${b.node ? " has-node" : ""}" data-node="${esc(b.node || "")}" style="--cc:${col}">
        <div class="cmap-bhead"><span class="cmap-dot"></span><span class="cmap-btitle">${esc(b.head)}</span><span class="cmap-count">${(b.leaves || []).length}·${(b.trunks || []).length}</span>${b.node ? '<span class="cmap-open">open →</span>' : ""}</div>
        ${leaves ? `<div class="cmap-leaves">${leaves}</div>` : ""}
        ${trunks ? `<div class="cmap-trunks">${trunks}</div>` : ""}
      </div>`;
    };
    host.innerHTML = `
      <div class="cmap-root"><span class="cmap-root-label">${esc(c.root)}</span><span class="cmap-root-sub">central domain concept · ${c.branches.length} branches</span></div>
      <div class="cmap-grid">${c.branches.map(card).join("")}</div>
      ${c.note ? `<p class="cmap-note">${linkifyStates(c.note)}</p>` : ""}`;
    host.querySelectorAll(".cmap-branch.has-node").forEach(el =>
      el.addEventListener("click", () => { switchTab("graph"); graph.select(el.dataset.node); }));
  }

  /* ---------- LINEAGE ARC tab ----------
     "How the project came to be." Reads window.ARCH.lineage (built from the
     last 750 commit titles, binned into time windows and themed) and renders
     a phase caption band + a topic streamgraph + a commit-cadence row.
     Degrades to an empty state when no lineage data is bundled, so projects
     whose data.js predates the lineage pipeline still render cleanly. */
  const LIN_RAMP = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
  function linColor(series, s) {
    if (s === "other") return "var(--faint)";
    const i = series.indexOf(s);
    return LIN_RAMP[(i < 0 ? 0 : i) % LIN_RAMP.length];
  }
  function renderLineageTab() {
    const host = $('[data-view="lineage"]'); if (!host) return;
    const L = A.lineage;
    if (!L || !L.buckets || !L.buckets.length) {
      host.innerHTML = `<div class="doc"><div class="doc-head"><div class="doc-title">Lineage Arc</div>
        <div class="doc-sub">No commit-history data is bundled for this project yet.</div></div></div>`;
      return;
    }
    // Themes carry human labels + colours (authored from the real history).
    const themes = L.themes || (L.series || []).map(key => ({ key, label: key, color: "var(--faint)" }));
    const colorOf = {}, labelOf = {};
    themes.forEach(t => { colorOf[t.key] = t.color; labelOf[t.key] = t.label; });
    const series = themes.map(t => t.key);
    const buckets = L.buckets, n = buckets.length;
    const totals = buckets.map(b => series.reduce((s, k) => s + (b.counts[k] || 0), 0));
    const maxTot = Math.max(1, ...totals);

    // ---- bird's-eye: themed streamgraph (centred baseline) + cadence ----
    const W = 1000, H = 200, pad = 6, sh = H - pad * 2, k = sh / maxTot, yc = H / 2;
    // sample points cell-centred so the stream peaks line up with the cadence bars below
    const xs = i => pad + (W - 2 * pad) * (n === 1 ? 0.5 : (i + 0.5) / n);
    // Catmull-Rom → cubic-bezier segments for a smooth (not zig-zag) river
    const seg = pts => {
      let s = "";
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
        s += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      }
      return s;
    };
    let lo = totals.map(t => -t / 2);
    const defs = "<defs>" + series.map((s, i) =>
      `<linearGradient id="linGrad${i}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${colorOf[s]}" stop-opacity=".95"/>` +
      `<stop offset="1" stop-color="${colorOf[s]}" stop-opacity=".34"/></linearGradient>`).join("") + "</defs>";
    const grid = `<g class="lin-grid">` + [0.22, 0.5, 0.78].map(f =>
      `<line x1="${pad}" x2="${W - pad}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}"/>`).join("") + `</g>`;
    const bands = series.map((s, i) => {
      const hi = lo.map((v, j) => v + (buckets[j].counts[s] || 0));
      const top = hi.map((v, j) => ({ x: xs(j), y: yc - v * k }));
      const bot = lo.map((v, j) => ({ x: xs(j), y: yc - v * k })).reverse();
      const d = `M ${top[0].x.toFixed(1)} ${top[0].y.toFixed(1)}` + seg(top) +
        ` L ${bot[0].x.toFixed(1)} ${bot[0].y.toFixed(1)}` + seg(bot) + " Z";
      lo = hi;
      return `<path class="lin-band" d="${d}" fill="url(#linGrad${i})" stroke="${colorOf[s]}" stroke-opacity=".5" stroke-width="1"><title>${esc(labelOf[s])}</title></path>`;
    }).join("");
    const cadence = buckets.map((b, i) => `<div class="lin-cell" data-bi="${i}">
      <span class="lin-cell-bar" style="height:${Math.max(8, (totals[i] / maxTot) * 100)}%"></span></div>`).join("");
    const themeTotals = {};
    series.forEach(s => themeTotals[s] = buckets.reduce((sum2, b) => sum2 + (b.counts[s] || 0), 0));
    const grand = Math.max(1, L.total);
    const tabs = `<button class="lin-tab all active" data-theme=""><span class="lin-tab-lbl">All themes</span><span class="lin-tab-val">${fmtNum(L.total)}</span><span class="lin-tab-share">100% · ${n} windows</span></button>` +
      themes.map(t => `<button class="lin-tab" data-theme="${esc(t.key)}" style="--tc:${t.color}"><span class="lin-tab-lbl"><span class="lin-sw" style="background:${t.color}"></span>${esc(t.label)}</span><span class="lin-tab-val">${fmtNum(themeTotals[t.key] || 0)}</span><span class="lin-tab-share">${Math.round((themeTotals[t.key] || 0) / grand * 100)}% of commits</span></button>`).join("");
    const ticks = buckets.map((b, i) => `<span class="lin-tick">${i % 3 === 0 ? esc(String(b.date).slice(5)) : ""}</span>`).join("");

    // ---- the story: narrative phase timeline ----
    const cards = (L.phases || []).map(p => {
      const col = colorOf[p.theme] || "var(--primary)";
      const hls = (p.highlights || []).map(h => `<span class="lin-hl" data-tip="${escAttr(h.t)}"><span class="lin-hl-h">${esc(h.h)}</span><span class="lin-hl-t">${esc(h.t)}</span></span>`).join("");
      return `<div class="lin-phase-row" style="--cc:${col}">
        <div class="lin-rail"><span class="lin-node">${p.n}</span></div>
        <div class="lin-card">
          <div class="lin-card-head">
            <span class="lin-chip" style="color:${col};background:color-mix(in oklab, ${col}, transparent 86%);border-color:color-mix(in oklab, ${col}, transparent 60%)">${esc(labelOf[p.theme] || p.theme)}</span>
            <span class="lin-period">${esc(p.period)}</span><span class="lin-mini">${buckets.map(b2 => { const mv = Math.max(1, ...buckets.map(x => x.counts[p.theme] || 0)); const v = b2.counts[p.theme] || 0; return `<i style="height:${Math.max(10, v / mv * 100)}%"></i>`; }).join("")}</span><span class="lin-ccount">${p.commits} commits</span></div>
          <div class="lin-card-title">${esc(p.title)}</div>
          <p class="lin-card-sum">${esc(p.summary)}</p>
          ${p.tried ? `<div class="lin-tried"><span class="lin-tried-tag">tried &amp; dropped</span>${esc(p.tried)}</div>` : ""}
          ${hls ? `<div class="lin-hls">${hls}</div>` : ""}
        </div>
      </div>`;
    }).join("");

    host.innerHTML = `<div class="doc lin-doc">
      <div class="doc-head"><div class="doc-title">Lineage Arc</div>
        <div class="doc-sub">How <b style="color:var(--tx)">${esc(A.project.name)}</b> came to be — <b style="color:var(--cyan)">${L.total}</b> commits, ${esc(L.range[0])} → ${esc(L.range[1])}.</div></div>
      ${L.arc ? `<p class="lin-arc">${esc(L.arc)}</p>` : ""}
      <div class="section-eyebrow">Bird's-eye · what each window of work was about · hover for the window ledger</div>
      <div class="lin-chartcard">
        <div class="lin-tabs" id="linTabs">${tabs}</div>
        <div class="lin-plot" id="linPlot">
          <div class="lin-streamwrap"><svg class="lin-stream" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${defs}${grid}${bands}</svg></div>
          <div class="lin-cadence">${cadence}</div>
          <div class="lin-xhair" id="linXhair"></div>
          <div class="lin-tipbox" id="linTip"></div>
        </div>
        <div class="lin-ticks">${ticks}</div>
      </div>
      <div class="lin-axis"><span>${esc(L.range[0])}</span><span>${fmtNum(L.total)} commits over time →</span><span>${esc(L.range[1])}</span></div>
      <div class="section-eyebrow" style="margin-top:26px">The story · ${(L.phases || []).length} phases of how it came to be</div>
      <div class="lin-timeline">${cards}</div>
    </div>`;
    const bandEls = Array.from(host.querySelectorAll(".lin-band"));
    let selTheme = null, hoverTheme = null;
    const selectTheme = key => {
      selTheme = key || null;
      host.querySelectorAll(".lin-tab").forEach(t => t.classList.toggle("active", (t.dataset.theme || "") === (selTheme || "")));
      bandEls.forEach((b2, i) => {
        if (selTheme == null) { b2.classList.remove("band-lit", "band-grey", "band-dim"); return; }
        b2.classList.toggle("band-lit", series[i] === selTheme);
        b2.classList.toggle("band-grey", series[i] !== selTheme);
        b2.classList.remove("band-dim");
      });
      host.querySelectorAll(".lin-phase-row").forEach((row, idx) => row.classList.toggle("ph-sel", selTheme != null && (L.phases[idx] || {}).theme === selTheme));
    };
    host.querySelectorAll(".lin-tab").forEach(t => t.addEventListener("click", () => selectTheme((t.dataset.theme || "") === (selTheme || "") ? null : t.dataset.theme)));
    bandEls.forEach((b2, i) => {
      b2.addEventListener("mouseenter", () => hoverTheme = series[i]);
      b2.addEventListener("mouseleave", () => hoverTheme = null);
    });
    const plot = $("#linPlot"), xh = $("#linXhair"), tipEl = $("#linTip");
    if (plot) {
      plot.addEventListener("mousemove", ev => {
        const r = plot.getBoundingClientRect();
        const i = Math.min(n - 1, Math.max(0, Math.floor((ev.clientX - r.left) / r.width * n)));
        const xNum = (i + 0.5) / n * 100;
        xh.style.left = xNum.toFixed(2) + "%"; xh.classList.add("on");
        plot.querySelectorAll(".lin-cell").forEach((c2, ci) => c2.classList.toggle("hover", ci === i));
        const b2 = buckets[i];
        const rowsHtml = series.filter(s => (b2.counts[s] || 0) > 0).map(s =>
          `<span class="tip-row ${hoverTheme === s ? "em" : ""}"><i><span class="lin-sw" style="background:${colorOf[s]}"></span>${esc(labelOf[s])}</i><em>${b2.counts[s]}</em></span>`).join("") ||
          `<span class="tip-row"><i>unclassified</i><em>${b2.total}</em></span>`;
        tipEl.innerHTML = `<b>window of ${esc(String(b2.date))}</b>` + rowsHtml + `<span class="tip-row total"><i>commits</i><em>${b2.total}</em></span>`;
        tipEl.classList.add("on");
        const flip = (ev.clientX - r.left) > r.width * 0.62;
        tipEl.style.left = flip ? "auto" : `calc(${xNum.toFixed(2)}% + 14px)`;
        tipEl.style.right = flip ? `calc(${(100 - xNum).toFixed(2)}% + 14px)` : "auto";
        tipEl.style.top = Math.max(8, ev.clientY - r.top - 46) + "px";
      });
      plot.addEventListener("mouseleave", () => {
        xh.classList.remove("on"); tipEl.classList.remove("on");
        plot.querySelectorAll(".lin-cell.hover").forEach(c2 => c2.classList.remove("hover"));
      });
    }
    // click a phase → spotlight its theme everywhere (tabs, river, phases)
    host.querySelectorAll(".lin-phase-row").forEach((row, idx) => {
      row.addEventListener("click", () => {
        const th = (L.phases[idx] || {}).theme;
        selectTheme(selTheme === th ? null : th);
      });
    });
  }

  /* ---------- SOURCE tab ---------- */
  function renderSourceTab() {
    const p = A.project;
    const scope = `<div id="a-scope"><div class="section-eyebrow">Scope / purpose</div>
      <p class="doc-intro" style="margin-bottom:14px">${linkifyStates(p.tagline)}</p>
      <div class="card" style="border-left:2px solid var(--cyan)"><div style="font-size:12px;line-height:1.65;color:var(--tx-2)">${esc(p.purpose)}</div></div></div>`;
    // Repository overview prose is data-driven: use project.overview when the
    // data provides it, else synthesise a structural summary from the graph
    // (was a hardcoded paragraph describing one specific project).
    const overviewProse = p.overview
      ? linkifyStates(p.overview)
      : `<b style="color:var(--tx)">${esc(p.name)}</b> is organised into <b style="color:var(--cyan)">${A.nodes.length}</b> subsystems wired by <b style="color:var(--cyan)">${A.edges.length}</b> dependency edges across <b style="color:var(--cyan)">${A.layers.length}</b> layers. ${p.stack ? esc(p.stack) + ". " : ""}${p.tests ? esc(p.tests) + "." : ""}`;
    const overview = `<div id="a-overview" style="margin-top:34px"><div class="section-eyebrow">Repository overview · runtime composition</div>
      <p style="font-size:12.5px;line-height:1.7;color:var(--tx-2);max-width:780px">${overviewProse}</p>
      <div class="chip-row" style="margin-top:14px">${p.techStack.map(t => `<div class="dep-chip" style="cursor:default"><b style="color:var(--tx);font-family:var(--mono)">${esc(t.name)}</b><span style="color:var(--tx-4)">${esc(t.meta)}</span></div>`).join("")}</div></div>`;
    const doneN = A.milestones.filter(m => m.status === "done").length;
    const msRange = A.milestones.length ? esc(A.milestones[0].id + " → " + A.milestones[A.milestones.length - 1].id) : "milestones";
    const msPct = A.milestones.length ? Math.round(doneN / A.milestones.length * 100) : 0;
    const milestones = `<div id="a-milestones" style="margin-top:36px"><div class="section-eyebrow">Roadmap · ${msRange} · ${doneN}/${A.milestones.length} shipped<span class="rm-pct">${msPct}%</span></div>
      <div class="roadmap">
        <div class="rm-rail"><div class="rm-fill" style="width:${msPct}%"></div></div>
        <div class="rm-stops">${A.milestones.map((m, i) => `<button class="rm-stop ${m.status}" data-ms="${i}" data-tip="${escAttr(`<b>${esc(m.id)} · ${esc(m.title)}</b>` + tipRow("status", m.status) + esc(m.note || ""))}">
          <span class="rm-dot"></span><span class="rm-id">${esc(m.id)}</span><span class="rm-mtitle">${esc(m.title)}</span></button>`).join("")}</div>
      </div>
      <div class="rm-detail" id="rmDetail"></div></div>`;
    const tree = `<div id="a-tree" style="margin-top:36px"><div class="section-eyebrow">Repository structure · click a folder to expand, a module to open its node</div>
      <div class="card"><div class="tree" id="repoTree"></div></div></div>`;
    $('[data-view="source"]').innerHTML = `<div class="doc">
      <div class="doc-head"><div class="doc-title">${esc(p.name)}</div>
      <div class="doc-sub">${esc(p.stack)} · ${esc(p.tests)} · regenerated ${esc(p.regenerated)}</div></div>
      ${scope}${overview}${milestones}${tree}</div>`;
    $$('#a-milestones .rm-stop').forEach(b => b.addEventListener("click", () => {
      const m = A.milestones[+b.dataset.ms], det = $("#rmDetail"), was = b.classList.contains("active");
      $$('#a-milestones .rm-stop').forEach(x => x.classList.remove("active"));
      if (was) { det.classList.remove("open"); det.innerHTML = ""; return; }
      b.classList.add("active");
      det.innerHTML = `<div class="rm-card ${m.status}"><div class="rm-card-head"><span class="rm-card-id">${esc(m.id)}</span><span class="rm-card-status ${m.status}">${esc(m.status)}</span></div>
        <div class="rm-card-title">${esc(m.title)}</div><div class="rm-card-note">${esc(m.note)}</div></div>`;
      det.classList.add("open");
    }));
    renderTree();
  }
  // TREENODE maps repoTree folder names to subsystem node ids when the folder
  // name does not match a node id directly. Projects may declare these via
  // node.{node: "<id>"} entries on each repoTree.children entry, which is the
  // preferred (data-driven) approach. This map is the fallback for projects
  // that did not annotate.
  const TREENODE = (A.repoTree && A.repoTree.folderToNode) || {};
  function renderTree() {
    const host = $("#repoTree");
    function nodeHtml(n) {
      const isDir = !n.file, kids = n.children || [], open = n.open;
      const sysId = n.node || TREENODE[n.name];
      const swatch = sysId ? `<span class="tree-ico dir" style="color:var(--k-${(nodeById[sysId] || {}).kind || "observer"})">▣</span>` :
        `<span class="tree-ico ${isDir ? "dir" : "file"}">${isDir ? "▣" : "·"}</span>`;
      const tog = (isDir && kids.length) ? `<span class="tree-tog">${open ? "▾" : "▸"}</span>` : `<span class="tree-tog">·</span>`;
      let h = `<div class="tree-node" ${sysId ? `data-sys="${sysId}"` : ""}>${tog}${swatch}<span class="tree-name ${n.file ? "file" : ""}">${esc(n.name)}</span>${n.anno ? `<span class="tree-anno" ${String(n.anno).length > 42 ? `data-tip="${escAttr(`<b>${esc(n.name)}</b>` + esc(n.anno))}"` : ""}>${esc(n.anno)}</span>` : ""}</div>`;
      if (kids.length) h += `<div class="tree-kids" ${open ? "" : 'style="display:none"'}>${kids.map(nodeHtml).join("")}</div>`;
      return h;
    }
    host.innerHTML = nodeHtml(A.repoTree);
    host.querySelectorAll(".tree-node").forEach(tn => tn.addEventListener("click", e => {
      e.stopPropagation();
      const kids = tn.nextElementSibling;
      if (kids && kids.classList.contains("tree-kids")) {
        const hidden = kids.style.display === "none"; kids.style.display = hidden ? "" : "none";
        const tog = tn.querySelector(".tree-tog"); if (tog && tog.textContent !== "·") tog.textContent = hidden ? "▾" : "▸";
      } else if (tn.dataset.sys) { switchTab("graph"); graph.select(tn.dataset.sys); }
    }));
  }

  /* ---------------- OVERVIEW (home dashboard) ----------------
     Absorbs everything the always-on right drawer used to hold — project identity,
     KPIs, vitals, risk register, change frontier, decisions, glossary, alerts —
     into a real first view. No datum was dropped; it just stopped living in a
     cramped permanent drawer and now has room to read as a dashboard. */
  function renderOverview() {
    const p = A.project;
    const kpis = (A.kpis || []).map(k => `<div class="ov-kpi ${k.tone || ""}" ${(k.jumpTo || KPIJUMP[k.label]) ? `data-kpi="${escAttr(k.label)}"` : ""} ${k.spark ? `data-tip="${escAttr("architecture.md line-count growth over recent regenerations")}"` : ""}>
        <div class="ov-kpi-label">${esc(k.label)}</div>
        <div class="ov-kpi-vrow"><span class="ov-kpi-val ${/^[0-9a-f]{6,}$/i.test(String(k.value)) && /[a-f]/i.test(String(k.value)) ? "code" : ""}">${esc(fmtNum(k.value))}</span>${k.unit ? `<span class="ov-kpi-unit">${esc(k.unit)}</span>` : ""}</div>
        <div class="ov-kpi-foot">${k.spark ? `<div class="kpi-spark">${k.spark.map(h => `<div class="kpi-spark-bar" style="height:${h}%"></div>`).join("")}</div>` : `<div class="kpi-delta">${esc(k.delta || "")}</div>`}</div>
      </div>`).join("");
    const vitals = [["Milestone", p.milestone, "source", "milestones"], ["Tests", p.tests, "cov", "cov"], ...(p.frameBudget ? [["Frame budget", p.frameBudget + " used", "", ""]] : []), ["Commits", p.commits + " to master", "lineage", ""], ["Architecture", p.lines + " md lines", "source", "scope"], ["Last commit", p.head + " · " + p.regenerated, "lineage", ""]]
      .map(([kk, v, tab, anc]) => `<div class="vital-row ${tab ? "is-link" : ""}" ${tab ? `data-tab="${tab}" data-anchor="${anc}"` : ""}><span class="vital-k">${esc(kk)}</span><span class="vital-v">${esc(v)}</span></div>`).join("");
    $('[data-view="overview"]').innerHTML = `<div class="doc ov-doc">
      <div class="doc-head"><div class="doc-title">${esc(p.name)}</div>
        <div class="doc-sub">${esc(p.stack || "")}${p.tests ? " · " + esc(p.tests) : ""} · regenerated ${esc(p.regenerated)}</div></div>
      <p class="ov-tagline">${linkifyStates(p.tagline)}</p>
      <div class="ov-kpis">${kpis}</div>
      <div class="card ov-purpose"><div class="ov-purpose-lbl">purpose</div>${esc(p.purpose)}</div>
      <div class="ov-grid">
        <div class="ov-col">
          <div class="ov-panel"><div class="ov-ptitle">Vitals</div>${vitals}</div>
          <div class="ov-panel"><div class="ov-ptitle">Change frontier <span class="ov-pcount">30d</span></div>
            ${A.changeFrontier.map(c => {
              const t = (c.bars[c.bars.length - 1] || 0) - (c.bars[0] || 0);
              const dir = t > 8 ? "up" : t < -8 ? "down" : "flat";
              const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
              const tip = `<b>${esc(c.name)}</b>` + c.bars.map((b, i) => tipRow("week " + (i + 1), b)).join("") + tipRow("trend", arrow + " " + dir);
              return `<div class="cf-item" data-node="${c.node}" data-tip="${escAttr(tip)}"><span class="cf-name">${esc(c.name)}</span><span class="cf-bars">${c.bars.map(b => `<span class="cf-bar" style="height:${Math.max(4, b)}%"></span>`).join("")}</span><span class="cf-trend ${dir}">${arrow}</span></div>`;
            }).join("")}</div>
        </div>
        <div class="ov-col">
          <div class="ov-panel"><div class="ov-ptitle">Risk register <span class="ov-pcount">${A.risks.length}</span></div>${A.risks.map(riskHtml).join("")}</div>
        </div>
        <div class="ov-col">
          <div class="ov-panel"><div class="ov-ptitle">Decisions <span class="ov-pcount">${A.decisions.length}</span></div>
            ${A.decisions.map(d => `<div class="decision" data-node="${d.node}"><span class="dm">◆</span><div><div class="decision-title">${esc(d.title)}</div><div class="decision-why">${esc(d.why)}</div></div></div>`).join("")}</div>
          ${A.alerts.length ? `<div class="ov-panel"><div class="ov-ptitle">Active alerts <span class="ov-pcount">${A.alerts.length}</span></div>${A.alerts.map(a => `<div class="alert"><span class="alert-dot ${a.sev}"></span><div class="alert-text">${esc(a.text)}<div class="alert-meta">${esc(a.meta)}</div></div></div>`).join("")}</div>` : ""}
        </div>
      </div>
      <div class="ov-panel ov-gloss"><div class="ov-ptitle">Glossary <span class="ov-pcount">${A.glossary.length}</span></div>
        <div class="gloss-wrap">${A.glossary.map(g => `<span class="gloss-term" data-tip="${escAttr(g.def)}">${esc(g.term)}</span>`).join("")}</div></div>
    </div>`;
    const view = $('[data-view="overview"]');
    view.querySelectorAll("[data-node]").forEach(el => el.addEventListener("click", () => { if (el.dataset.node) { switchTab("graph"); graph.select(el.dataset.node); } }));
    view.querySelectorAll("[data-kpi]").forEach(el => { const k = (A.kpis || []).find(x => x.label === el.dataset.kpi); if (k) { el.classList.add("kpi-link"); el.addEventListener("click", () => kpiClick(k)); } });
    view.querySelectorAll(".vital-row.is-link").forEach(el => el.addEventListener("click", () => openAnchor(el.dataset.tab, el.dataset.anchor)));
  }
  function riskHtml(r) {
    return `<div class="risk-item is-link sev-${r.sev}" data-node="${r.node}"><div class="risk-head"><span class="risk-sev ${r.sev}">${r.sev.toUpperCase()}</span>
      <span class="risk-title">${esc(r.title)}</span><span class="risk-node">${esc(r.node)}</span></div>
      <div class="risk-trigger">${linkifyStates(r.trigger)}</div></div>`;
  }
  function wireRailLinks() {
    $$("#rrScroll [data-node]").forEach(el => el.addEventListener("click", e => {
      if (e.target.closest(".vital-link") && el.dataset.tab) return;
      switchTab("graph"); graph.select(el.dataset.node);
    }));
    $$("#rrScroll .vital-link").forEach(el => el.addEventListener("click", () => {
      if (el.dataset.tab) openAnchor(el.dataset.tab, el.dataset.anchor);
      else if (el.dataset.node) { switchTab("graph"); graph.select(el.dataset.node); }
    }));
  }

  function renderNodeRail(id) {
    const n = nodeById[id];
    if (!n) { window.App.setInspector(false); return; }
    const outs = A.edges.filter(e => e.from === id).map(e => ({ id: e.to, rel: e.rel, label: e.label }));
    const ins = A.edges.filter(e => e.to === id).map(e => ({ id: e.from, rel: e.rel, label: e.label }));
    const km = A.kindMeta[n.kind];
    const nodeRisks = riskByNode[id] || [];
    const down = downstreamNodes(id);
    const inPaths = A.criticalPaths.filter(p => pathNodeSeq(p.steps).includes(id));
    const cov = n.coverage || {};
    const chip = (d, dir) => {
      const k = (nodeById[d.id] || {}).kind || "observer";
      return `<span class="dep-chip" data-node="${d.id}" data-tip="${escAttr(d.label)}">${dir === "out" ? "" : '<span class="ar">←</span>'}<span class="sw" style="background:var(--k-${k})"></span>${esc(d.id)}${dir === "out" ? '<span class="ar">→</span>' : ""}</span>`;
    };
    $("#rrScroll").innerHTML = `
      <div class="rr-section">
        <button class="rr-back" id="rrBack"><span class="ar">✕</span> close</button>
        <div class="dossier-id">
          <div class="dossier-glyph" style="border-color:var(--k-${n.kind});color:var(--k-${n.kind})">${esc(n.label[0].toUpperCase())}</div>
          <div><div class="dossier-name">${esc(n.label)}</div><div class="dossier-root">${esc(n.root)}</div></div>
        </div>
        <span class="dossier-kind" style="color:var(--k-${n.kind});background:color-mix(in srgb,var(--k-${n.kind}) 14%,transparent)"><span class="sw" style="background:var(--k-${n.kind})"></span>${esc(km.label)}</span>
        <div class="rr-stats"><span><b>${outs.length}</b> out</span><span><b>${ins.length}</b> in</span><span><b>${down.length}</b> blast</span></div>
        <p class="dossier-blurb">${linkifyStates(n.tagline)}</p>
        <svg class="ego-svg" id="egoSvg"></svg>
      </div>
      <div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Owns</span></div><div class="dossier-owns">${linkifyStates(n.owns)}</div></div>
      ${n.state.length ? `<div class="rr-section"><div class="rr-shead"><span class="rr-stitle">State owned</span><span class="rr-scount">${n.state.length}</span></div>
        <div class="chip-row">${n.state.map(s => `<span class="ent dep-chip" style="color:var(--cyan)" data-entity="${escAttr(s.split(" (")[0])}">${esc(s)}</span>`).join("")}</div></div>` : ""}
      <div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Dependencies</span><span class="rr-scount">${outs.length}↑ ${ins.length}↓</span></div>
        ${outs.length ? `<div class="chip-cap">depends on / writes</div><div class="chip-row" style="margin-bottom:12px">${outs.map(d => chip(d, "out")).join("")}</div>` : ""}
        ${ins.length ? `<div class="chip-cap">consumed by</div><div class="chip-row">${ins.map(d => chip(d, "in")).join("")}</div>` : ""}
      </div>
      ${down.length ? `<div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Blast radius</span><span class="rr-scount">${down.length} reached</span></div>
        <div class="chip-cap">changing ${esc(n.label)} can ripple to</div>
        <div class="chip-row">${down.map(d => `<span class="dep-chip" data-node="${d}"><span class="sw" style="background:var(--k-${(nodeById[d] || {}).kind})"></span>${esc(d)}</span>`).join("")}</div>
        <button class="rr-mini-btn" id="rrImpact">⊛ show on graph</button></div>` : ""}
      ${inPaths.length ? `<div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Critical paths</span><span class="rr-scount">${inPaths.length}</span></div>
        ${inPaths.map(p => `<div class="rr-path ${traceable(p.steps) ? "" : "is-off"}" data-path="${A.criticalPaths.indexOf(p)}" ${traceable(p.steps) ? "" : `data-tip="${escAttr("Not traceable on the graph")}"`}><span class="ti">▶</span>${esc(p.name)}</div>`).join("")}</div>` : ""}
      ${Object.keys(cov).length ? `<div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Coverage</span></div>
        <div class="chip-row">${Object.entries(cov).map(([l, v]) => `<span class="cov-chip lv${v}" data-tip="${escAttr(LENS[l] + " — " + LVL[v])}">${esc(l)}<span class="lvl">${LVLSHORT[v]}</span></span>`).join("")}</div></div>` : ""}
      <div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Files</span><span class="rr-scount">${n.files.length}</span></div>
        ${n.files.map(f => { const pa = f.split(" — "); return `<div class="file-line"><span class="fn">${esc(pa[0])}</span><span class="fa">${esc(pa[1] || "")}</span></div>`; }).join("")}</div>
      ${nodeRisks.length ? `<div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Risks involving ${esc(n.label)}</span><span class="rr-scount">${nodeRisks.length}</span></div>${nodeRisks.map(riskHtml).join("")}</div>` : ""}`;
    if (graph) graph.renderEgo($("#egoSvg"), id);
    $("#rrBack").addEventListener("click", () => graph.deselect());
    $$("#rrScroll .dep-chip[data-node]").forEach(c => c.addEventListener("click", () => graph.select(c.dataset.node)));
    const imp = $("#rrImpact"); if (imp) imp.addEventListener("click", () => { switchTab("graph"); graph.setImpact(true); graph.select(id); });
    $$("#rrScroll .rr-path").forEach(rp => rp.addEventListener("click", () => traceOnGraph(A.criticalPaths[+rp.dataset.path].steps)));
  }

  function renderEdgeRail(e) {
    if (!e) return;
    const rel = A.relationships.filter(r => (normNode(r.a) === e.from && normNode(r.b) === e.to) || (normNode(r.a) === e.to && normNode(r.b) === e.from));
    const relName = { dep: "Dependency", strong: "Load-bearing dependency", write: "Write-back", peer: "Hidden coupling" }[e.rel];
    $("#rrScroll").innerHTML = `
      <div class="rr-section">
        <button class="rr-back" id="rrBack"><span class="ar">✕</span> close</button>
        <div class="rr-shead"><span class="rr-stitle">Edge</span><span class="rr-scount tip-rel rel-${e.rel}" style="position:static">${esc(relName)}</span></div>
        <div class="edge-id"><span class="dep-chip" data-node="${e.from}"><span class="sw" style="background:var(--k-${(nodeById[e.from] || {}).kind})"></span>${esc(e.from)}</span>
          <span class="edge-arrow ${e.rel}">${e.rel === "peer" ? "↔" : "→"}</span>
          <span class="dep-chip" data-node="${e.to}"><span class="sw" style="background:var(--k-${(nodeById[e.to] || {}).kind})"></span>${esc(e.to)}</span></div>
        <p class="dossier-blurb">${linkifyStates(e.label)}</p>
      </div>
      ${rel.length ? `<div class="rr-section"><div class="rr-shead"><span class="rr-stitle">Contract</span></div>
        ${rel.map(r => `<div class="edge-contract"><div class="ec-row"><span class="ec-k">mechanism</span><span class="ec-v">${linkifyStates(r.mech)}</span></div>
          <div class="ec-row"><span class="ec-k">data</span><span class="ec-v">${esc(r.data)}</span></div>
          <div class="ec-row breaks"><span class="ec-k">breaks if</span><span class="ec-v">${esc(r.breaks)}</span></div></div>`).join("")}</div>` :
        `<div class="rr-section"><p class="risk-trigger">No formal contract row for this edge — see the two subsystems' dossiers for detail.</p></div>`}`;
    $("#rrBack").addEventListener("click", () => graph.deselect());
    $$("#rrScroll .dep-chip[data-node]").forEach(c => c.addEventListener("click", () => graph.select(c.dataset.node)));
  }

  /* ---------------- bottom KPIs ----------------
     KPIJUMP routes KPI label clicks to a section / node. Project-agnostic
     defaults below match the common KPI labels emitted by arch_seed.py;
     projects override via A.kpis[].jumpTo (a string like "paths:paths" or
     "graph:<node-id>") for any KPI whose label is not in the default set. */
  const KPIJUMP = {
    "Subsystems": () => switchTab("graph"),
    "Architecture": () => { switchTab("source"); },
    "Tests": () => openAnchor("cov", "cov"),
    "Last commit": () => openAnchor("source", "scope"),
    "Open gaps": () => openAnchor("concept", "notes"),
  };
  function kpiClick(k) {
    if (k.jumpTo) {
      const [tab, anchor] = String(k.jumpTo).split(":");
      if (tab && anchor) { openAnchor(tab, anchor); return; }
      if (tab) { switchTab(tab); return; }
    }
    const fn = KPIJUMP[k.label];
    if (fn) fn();
  }
  // Slim ambient status bar (replaces the collapsible bottom KPI drawer; the
  // KPIs themselves now live in the Overview dashboard).
  function renderStatus() {
    const p = A.project;
    $("#statusbar").innerHTML = `
      <div class="sb-item" data-tip="${escAttr(`<b>Milestone</b>` + esc(p.milestone))}"><span class="dot"></span>${esc(p.milestone)}</div>
      <div class="sb-sep"></div>
      <div class="sb-item sb-view" id="sbView">view · <b>Overview</b></div>
      <div class="sb-sep"></div>
      <div class="sb-item">${A.nodes.length} subsystems · ${A.edges.length} edges</div>
      <div class="sb-sep"></div>
      <div class="sb-item" data-tip="${escAttr(`<b>Test posture</b>` + esc(p.tests))}">${esc(p.tests)}</div>
      <div class="sb-spacer"></div>
      <div class="sb-item sb-jump" data-tip="${escAttr("Open the Overview dashboard")}">${(A.kpis || []).length} metrics →</div>
      <div class="sb-sep"></div>
      <div class="sb-item">HEAD <b>${esc(p.head)}</b></div>`;
    const j = $("#statusbar .sb-jump"); if (j) j.addEventListener("click", () => switchTab("overview"));
  }

  /* ---------------- navigation + inspector controls ---------------- */
  function initNav() {
    const wb = $("#workbench");
    function setNavCollapsed(c) { wb.classList.toggle("nav-collapsed", c); $("#navToggle").classList.toggle("on", !c); if (graph) requestAnimationFrame(() => graph.fit()); if (window.App.persist) window.App.persist(); }
    function setInspector(open) { wb.classList.toggle("inspector-open", open); if (graph) requestAnimationFrame(() => graph.fit()); if (window.App.persist) window.App.persist(); }
    $("#navToggle").addEventListener("click", () => setNavCollapsed(!wb.classList.contains("nav-collapsed")));
    window.App.setNavCollapsed = setNavCollapsed;
    window.App.setInspector = setInspector;
  }

  /* ---------------- shared floating tooltip ---------------- */
  function initTooltip() {
    const tip = document.createElement("div");
    tip.className = "float-tip"; tip.style.display = "none";
    document.body.appendChild(tip);
    let visible = false;
    function place(x, y) {
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let nx = x + 15, ny = y + 18;
      if (nx + w > innerWidth - 8) nx = x - w - 15;
      if (ny + h > innerHeight - 8) ny = y - h - 18;
      if (ny < 8) ny = 8; if (nx < 8) nx = 8;
      tip.style.left = nx + "px"; tip.style.top = ny + "px";
    }
    window.__tip = {
      show(x, y, html) { tip.innerHTML = html; tip.style.display = "block"; visible = true; place(x, y); },
      move(x, y) { if (visible) place(x, y); }, hide() { tip.style.display = "none"; visible = false; },
    };
    document.addEventListener("mouseover", e => { const t = e.target.closest("[data-tip]"); if (t) window.__tip.show(e.clientX, e.clientY, t.getAttribute("data-tip")); });
    document.addEventListener("mousemove", e => { const t = e.target.closest("[data-tip]"); if (t) window.__tip.move(e.clientX, e.clientY); });
    document.addEventListener("mouseout", e => { const t = e.target.closest("[data-tip]"); if (t) window.__tip.hide(); });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    initTooltip();
    renderTopbar(); renderNav(); renderTabs(); renderStatus(); initNav();
    const setPlay = on => { const l = $("#playLabel"); if (l) l.textContent = on ? "Stop" : "Play tick"; };

    graph = Graph.init($("#graphStage"), {
      onSelect: id => { if (id) { renderNodeRail(id); window.App.setInspector(true); } else window.App.setInspector(false); if (window.App.persist) window.App.persist(); },
      onEdgeSelect: e => { if (e) { renderEdgeRail(e); window.App.setInspector(true); } else window.App.setInspector(false); },
      onImpact: info => { const h = $("#graphHint"); if (!h) return; h.innerHTML = info ? `<b style="color:var(--cyan)">${info.reached}</b> subsystems in the blast radius of <b>${graph.getSelected()}</b>` : "drag to pan · scroll to zoom · click node to inspect"; },
      onFlowStep: (i, id) => { setPlay(true); const h = $("#graphHint"); if (h) h.innerHTML = `tick → <b style="color:var(--cyan)">${id}</b> <span style="color:var(--tx-4)">(${i + 1})</span>`; },
      onFlowEnd: () => { setPlay(false); const h = $("#graphHint"); if (h) h.textContent = "drag to pan · scroll to zoom · click node to inspect"; },
    });
    window.App.graph = () => graph;

    $("#gFit").addEventListener("click", () => graph.fit());
    $("#gArrange").addEventListener("click", () => graph.arrange());
    $("#gZoomIn").addEventListener("click", () => graph.zoomIn());
    $("#gZoomOut").addEventListener("click", () => graph.zoomOut());
    const zv = $("#zoomVal");
    if (zv) { zv.style.cursor = "pointer"; zv.setAttribute("data-tip", "click to re-fit"); zv.addEventListener("click", () => graph.fit()); }
    $$("[data-graph-mode]").forEach(b => b.addEventListener("click", () => { graph.setMode(b.dataset.graphMode); if (window.App.persist) window.App.persist(); }));
    $("#gImpact").addEventListener("click", () => {
      const on = !graph.isImpact();
      graph.setImpact(on);
      const h = $("#graphHint");
      if (h && on && !graph.getSelected()) h.innerHTML = `<b style="color:var(--cyan)">Blast-radius mode</b> · select a node to see everything it can ripple to`;
      else if (h && !on) h.textContent = "drag to pan · scroll to zoom · click node to inspect";
    });
    $("#gPlay").addEventListener("click", () => { if (graph.isFlowing()) { graph.stopFlow(); setPlay(false); } else { playTick(); setPlay(true); } });
    const lg = $("#graphLegend");
    lg.querySelector(".gl-head").addEventListener("click", () => { lg.classList.toggle("collapsed"); lg.querySelector(".gl-toggle").textContent = lg.classList.contains("collapsed") ? "show ▴" : "hide ▾"; });
    $$("#viewMode .vm-btn").forEach(b => b.addEventListener("click", () => setMd(b.dataset.vm === "source")));

    // expose API for features.js
    Object.assign(window.App, {
      switchTab, openAnchor, scrollToAnchor, esc, escAttr, flashStep, setMd,
      tabs: TABS, selectNode: id => { switchTab("graph"); graph.select(id); },
      curTab: () => curTab, setMdSource: () => { mdMode = false; },
    });
    if (window.App.initFeatures) window.App.initFeatures();

    switchTab("overview");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
