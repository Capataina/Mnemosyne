/* ============================================================
   features.js — cross-cutting systems
   global search/command palette · entity linking · markdown
   source · state persistence · keyboard nav
   ============================================================ */
(function () {
  const A = window.ARCH;
  window.App = window.App || {};
  const App = window.App;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => window.App.esc(s);

  /* ================= GLOBAL SEARCH / COMMAND PALETTE ================= */
  function buildIndex() {
    const idx = [];
    A.nodes.forEach(n => idx.push({ kind: "subsystem", label: n.label, sub: n.tagline, icon: "◉", color: `var(--k-${n.kind})`, run: () => App.selectNode(n.id) }));
    const secs = [
      ["Scope / Purpose", "source", "scope"], ["Repository Overview", "source", "overview"], ["Milestones", "source", "milestones"], ["Repository Tree", "source", "tree"],
      ["Data Flow", "flow", "flow"], ["Failure Semantics", "flow", "failures"], ["Critical Paths", "paths", "paths"],
      ...((A.bespoke || []).map(b => [b.title, "paths", "bespoke-" + b.id])),
      ["Dependency Layers", "deps", "layers"], ["Inter-System Relations", "deps", "relations"], ["Adjacency Matrix", "deps", "matrix"],
      ["State Ownership", "deps", "state"], ["Coverage", "cov", "cov"], ["Concept Map", "concept", "concept"], ["Structural Notes", "concept", "notes"],
    ];
    secs.forEach(([l, t, a]) => idx.push({ kind: "section", label: l, sub: "section · " + t, icon: "▸", color: "var(--tx-3)", run: () => App.openAnchor(t, a) }));
    A.glossary.forEach(g => idx.push({ kind: "term", label: g.term, sub: g.def, icon: "✦", color: "var(--cyan)", run: () => App.openAnchor("concept", "concept") }));
    A.risks.forEach(r => idx.push({ kind: "risk", label: r.title, sub: "risk · " + r.node, icon: "▲", color: "var(--red)", run: () => App.selectNode(r.node) }));
    A.decisions.forEach(d => idx.push({ kind: "decision", label: d.title, sub: "decision", icon: "◆", color: "var(--cyan)", run: () => App.selectNode(d.node) }));
    A.dataFlow.steps.forEach(s => idx.push({ kind: "step", label: `${String(s.n).padStart(2, "0")} ${s.fn}`, sub: "data-flow step · " + s.sys, icon: "↯", color: "var(--tx-3)", run: () => { App.openAnchor("flow", "flow"); setTimeout(() => App.flashStep(s.n), 350); } }));
    // commands
    idx.push({ kind: "cmd", label: "Play data flow on graph", sub: "command", icon: "▶", color: "var(--cyan)", run: () => { App.switchTab("graph"); App.graph().flowNodes(A.dataFlow.steps.map(s => s.sys.split("::")[0]).filter((x, i, a) => x !== a[i - 1]), { interval: 560 }); } });
    idx.push({ kind: "cmd", label: "Toggle blast-radius mode", sub: "command", icon: "⊛", color: "var(--cyan)", run: () => { App.switchTab("graph"); App.graph().setImpact(!App.graph().isImpact()); } });
    idx.push({ kind: "cmd", label: "View raw markdown source", sub: "command", icon: "⟨⟩", color: "var(--cyan)", run: () => { if (App.setMd) App.setMd(true); } });
    if (window.CALLGRAPH) {
      idx.push({ kind: "view", label: "Call Graph", sub: "static call graph · ego + hierarchy", icon: "⌁", color: "var(--cyan)", run: () => App.switchTab("calls") });
      (CALLGRAPH.nodes || []).forEach(nd => {
        if (nd.ext) return;
        idx.push({ kind: "fn", label: nd.name, sub: "call graph · " + (nd.meta || ""), icon: "ƒ", color: "var(--violet)", run: () => { App.switchTab("calls"); if (App.cgFocus) App.cgFocus(nd.id); } });
      });
    }
    return idx;
  }
  let INDEX = null;

  function initSearch() {
    const inp = $("#search"), box = $("#searchResults");
    let active = -1, results = [];
    function render(q) {
      if (!INDEX) INDEX = buildIndex();
      q = q.trim().toLowerCase();
      if (!q) { results = INDEX.slice(0, 8); }
      else results = INDEX.map(it => ({ it, s: score(it, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.it);
      const KORDER = ["view", "subsystem", "fn", "section", "step", "term", "risk", "decision", "cmd"];
      results.sort((a, b) => KORDER.indexOf(a.kind) - KORDER.indexOf(b.kind));
      active = results.length ? 0 : -1;
      let html = "", lastKind = null;
      results.forEach((r, i) => {
        if (r.kind !== lastKind) { html += `<div class="sr-group">${esc(r.kind)}</div>`; lastKind = r.kind; }
        html += `
        <div class="sr-item ${i === active ? "active" : ""}" data-i="${i}">
          <span class="sr-icon" style="color:${r.color}">${r.icon}</span>
          <span class="sr-main"><span class="sr-label">${esc(r.label)}</span><span class="sr-sub">${esc(r.sub.slice(0, 70))}</span></span>
          <span class="sr-kind">${esc(r.kind)}</span>
        </div>`;
      });
      box.innerHTML = results.length ? html : `<div class="sr-empty">No matches for “${esc(q)}”</div>`;
      box.classList.add("open");
      box.querySelectorAll(".sr-item").forEach(el => {
        el.addEventListener("mousedown", e => { e.preventDefault(); choose(+el.dataset.i); });
        el.addEventListener("mouseenter", () => { active = +el.dataset.i; hl(); });
      });
    }
    function score(it, q) {
      const l = it.label.toLowerCase(), s = (it.sub || "").toLowerCase();
      if (l === q) return 100;
      if (l.startsWith(q)) return 60;
      if (l.includes(q)) return 40;
      if (s.includes(q)) return 15;
      return 0;
    }
    function hl() { box.querySelectorAll(".sr-item").forEach((el, i) => el.classList.toggle("active", i === active)); }
    function choose(i) { const r = results[i]; if (r) { r.run(); close(); inp.blur(); } }
    function close() { box.classList.remove("open"); box.innerHTML = ""; }
    inp.addEventListener("input", () => render(inp.value));
    inp.addEventListener("focus", () => render(inp.value));
    inp.addEventListener("blur", () => setTimeout(close, 120));
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(results.length - 1, active + 1); hl(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); hl(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { close(); inp.blur(); }
    });
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inp.focus(); inp.select(); render(inp.value); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") { e.preventDefault(); const wb = document.querySelector("#workbench"); if (App.setNavCollapsed) App.setNavCollapsed(!wb.classList.contains("nav-collapsed")); }
    });
  }

  /* ================= UNIVERSAL ENTITY LINKING ================= */
  function initEntity() {
    const labelFor = id => { const n = (A.nodes || []).find(x => x.id === id); return n ? n.label : id; };
    function cssEsc(s) { return String(s).replace(/"/g, '\\"'); }
    function lit(name, on, x, y) {
      $$(`.ent[data-entity="${cssEsc(name)}"]`).forEach(el => el.classList.toggle("entity-lit", on));
      const owner = App.ENTITY[name];
      const g = App.graph && App.graph();
      if (on) {
        // on-tab feedback: name the owning subsystem (works on any tab, not just the graph)
        if (owner && window.__tip) window.__tip.show(x, y, `<b>${esc(name)}</b><span style="color:var(--tx-3)">state owned by </span><span style="color:var(--cyan)">${esc(labelFor(owner))}</span>`);
        if (owner && g && g.hasNode(owner)) g.highlight([owner]);
      } else {
        if (window.__tip) window.__tip.hide();
        if (g) g.clearHighlight();
      }
    }
    document.addEventListener("mouseover", e => { const t = e.target.closest(".ent[data-entity]"); if (t) lit(t.dataset.entity, true, e.clientX, e.clientY); });
    document.addEventListener("mousemove", e => { const t = e.target.closest(".ent[data-entity]"); if (t && window.__tip) window.__tip.move(e.clientX, e.clientY); });
    document.addEventListener("mouseout", e => { const t = e.target.closest(".ent[data-entity]"); if (t) lit(t.dataset.entity, false); });
    document.addEventListener("click", e => { const t = e.target.closest(".ent[data-entity]"); if (t) { const owner = App.ENTITY[t.dataset.entity]; const g = App.graph && App.graph(); if (owner && g && g.hasNode(owner)) g.select(owner); } });
  }

  /* ================= MARKDOWN SOURCE ================= */
  function mdTable(headers, rows) {
    return `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n` +
      rows.map(r => `| ${r.map(c => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`).join("\n");
  }
  const MD = {
    graph() {
      let s = `## Subsystem Map\n\n`;
      A.nodes.forEach(n => { s += `### ${n.label}  \`${n.root}\`\n${n.tagline}\n\n- **Owns:** ${n.owns}\n`; const o = A.edges.filter(e => e.from === n.id).map(e => `${e.to} (${e.rel})`); const i = A.edges.filter(e => e.to === n.id).map(e => `${e.from} (${e.rel})`); if (o.length) s += `- **Depends on / writes:** ${o.join(", ")}\n`; if (i.length) s += `- **Consumed by:** ${i.join(", ")}\n`; s += `\n`; });
      return s;
    },
    flow() {
      let s = `## Core Execution / Data Flow\n\n${A.dataFlow.intro}\n\nSimSet order: ${A.dataFlow.simsets.join(" → ")}\n\n`;
      A.dataFlow.steps.forEach(st => { s += `${String(st.n).padStart(2, "0")}. **${st.sys}::${st.fn}** \`${st.set}\`${st.fail ? " ⚠" : ""}\n    - reads: ${st.reads}\n    - writes: ${st.writes}\n`; });
      s += `\n### Failure Semantics\n\n`; A.failures.forEach(f => s += `- **${f.link} · ${f.title}** — ${f.body}\n`);
      return s;
    },
    deps() {
      let s = `## Dependency Direction\n\n`;
      A.layers.forEach((l, i) => s += `${i + 1}. **${l.name}** — ${l.role}\n`);
      s += `\n> ${A.layersNote}\n\n## Inter-System Relationships\n\n` + mdTable(["A", "B", "Mechanism", "Data", "Breaks if violated"], A.relationships.map(r => [r.a, r.b, r.mech, r.data, r.breaks]));
      s += `\n\n## State Ownership\n\n`; A.stateOwnership.forEach(o => s += `- **${o.owner}** — ${o.items}\n`);
      return s;
    },
    cov() {
      let s = `## Coverage\n\n${A.coverage.note}\n\n`;
      s += mdTable(["Module", ...A.coverage.cols], A.coverage.rows.map(r => [r.label, ...A.coverage.cols.map(c => r.cells[c] || "·")]));
      return s;
    },
    paths() {
      let s = `## Critical Paths & Blast Radius\n\n`;
      A.criticalPaths.forEach(p => s += `### ${p.name} (${p.len})\n${p.steps.join(" → ")}\n\n${p.blast}\n\n`);
      (A.bespoke || []).forEach(b => { s += `### ${b.title}\n${b.subtitle || ""}\n\n`; (b.steps || []).forEach(st => s += `- **${st.id}${st.sys ? " " + st.sys : ""}** - ${st.body}\n`); s += `\n`; });
      return s;
    },
    concept() {
      let s = `## Concept Map — ${A.concept.root}\n\n`;
      A.concept.branches.forEach(b => { s += `### ${b.head}\n` + b.leaves.map(l => `- ${l}`).join("\n") + "\n" + b.trunks.map(t => `- ${t}`).join("\n") + "\n\n"; });
      s += `> ${A.concept.note}\n\n## Structural Notes\n\n`; A.notes.forEach(n => s += `- **[${n.tag}] ${n.title}** — ${n.body}\n`);
      return s;
    },
    calls() {
      const C = window.CALLGRAPH;
      if (!C || !C.nodes || !C.nodes.length) return `## Call Graph\n\n_No call-graph data generated for this repository yet._\n`;
      let s = `## Call Graph\n\n${C.scope}\n\n`;
      s += mdTable(["metric", "value", "share"], (C.stats || []).map(t => [t[0], t[1], t[3] || ""]));
      s += `\n\n### Functions (full inventory)\n\n` + mdTable(["function", "site", "in", "out"], (C.fns || []).map(f => [f.name, `${f.file}:${f.line}`, f.in, f.out]));
      s += `\n\n### Call edges (view spine)\n\n`; (C.edges || []).forEach(e => s += `- ${e[0]} → ${e[1]} (${e[2]})\n`);
      return s;
    },
    source() {
      const p = A.project;
      let s = `# ${p.name}\n\n${p.tagline}\n\n> ${p.purpose}\n\n## Tech stack\n` + p.techStack.map(t => `- ${t.name} (${t.meta})`).join("\n");
      s += `\n\n## Roadmap\n` + A.milestones.map(m => `- **${m.id} ${m.title}** [${m.status}] — ${m.note}`).join("\n");
      s += `\n\n## Repository\n` + treeMd(A.repoTree, 0);
      return s;
    },
  };
  function treeMd(n, d) { let s = `${"  ".repeat(d)}- ${n.name}${n.anno ? ` — ${n.anno}` : ""}\n`; (n.children || []).forEach(c => s += treeMd(c, d + 1)); return s; }
  App.markdownFor = tab => `<!-- generated from arch/data.js (view: ${tab}) -->\n\n` + ((MD[tab] && MD[tab]()) || "");

  /* ================= PERSISTENCE ================= */
  const KEY = "arch.state.v5";
  let restoring = false;
  function persist() {
    if (restoring) return;
    const wb = $("#workbench");
    const st = {
      tab: App.curTab(), node: App.graph() ? App.graph().getSelected() : null,
      nav: wb.classList.contains("nav-collapsed"),
    };
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    const h = "#" + st.tab + (st.node ? "/" + st.node : "");
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  App.persist = persist;
  function restore() {
    restoring = true;
    let st = {};
    try { st = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (hash) { const [t, n] = hash.split("/"); if (t) st.tab = t; if (n) st.node = n; else if (hash.indexOf("/") < 0) st.node = null; }
    if (st.nav) App.setNavCollapsed(true);
    if (st.node && App.graph().hasNode(st.node)) App.graph().select(st.node);
    if (st.tab && App.tabs.some(t => t.id === st.tab)) App.switchTab(st.tab);
    restoring = false;
    persist();
  }

  /* ================= KEYBOARD NAV ================= */
  function initKeys() {
    document.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { App.graph().stopFlow(); App.graph().deselect(); $("#searchResults").classList.remove("open"); }
      else if (/^[0-9]$/.test(e.key)) { const t = App.tabs[e.key === "0" ? 9 : +e.key - 1]; if (t) App.switchTab(t.id); }
    });
  }

  App.initFeatures = function () {
    initSearch(); initEntity(); initKeys();
    requestAnimationFrame(() => requestAnimationFrame(restore));
  };
})();
