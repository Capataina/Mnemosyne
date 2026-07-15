/* ============================================================
   Topology graph engine — subsystem dependency graph
   Layered / Force / Radial · collapse-groups · blast-radius
   · tick-flow animation · drag persistence · ego mini-graphs
   ============================================================ */
window.Graph = (function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const LAYER_GAP = 252, ROW_GAP = 118;
  const POS_KEY = "arch.graph.pos.v2";

  let stage, svg, root, gEdges, gFlow, gNodes;
  let allNodes = [], allEdges = [], allById = {};
  let nodes = [], edges = [], byId = {};
  let collapsed = new Set();
  let posOverride = {};
  let view = { x: 0, y: 0, k: 1 };
  let selected = null, hovered = null, selEdge = null;
  let opts = {};
  let mode = "layered";
  let impactMode = false;
  let raf = null, flowTimer = null;

  function el(tag, a) { const e = document.createElementNS(SVGNS, tag); if (a) for (const k in a) e.setAttribute(k, a[k]); return e; }
  function relName(rel) { return { dep: "dependency", strong: "load-bearing", write: "write-back", peer: "hidden coupling" }[rel] || rel; }

  /* ---------- visible set (collapse groups) ---------- */
  function computeVisible() {
    const hidden = new Set();
    allNodes.forEach(n => { if (n.group && collapsed.has(n.group)) hidden.add(n.id); });
    nodes = allNodes.filter(n => !hidden.has(n.id));
    byId = {}; nodes.forEach(n => byId[n.id] = n);
    const map = id => (hidden.has(id) ? allById[id].group : id);
    const seen = new Set(); edges = [];
    allEdges.forEach(e => {
      const a = map(e.from), b = map(e.to);
      if (a === b) return;
      const key = a + ">" + b;
      if (seen.has(key)) { // keep strongest rel on merge
        const ex = edges.find(x => x.from === a && x.to === b);
        if (ex && rank(e.rel) > rank(ex.rel)) { ex.rel = e.rel; ex.label = e.label; }
        return;
      }
      seen.add(key);
      edges.push({ from: a, to: b, rel: e.rel, label: e.label });
    });
  }
  function rank(rel) { return { peer: 0, write: 1, dep: 2, strong: 3 }[rel] || 0; }
  function groupChildren(pid) { return allNodes.filter(n => n.group === pid).map(n => n.id); }

  /* ---------- layout ---------- */
  function computeLayers() {
    const fwd = edges.filter(e => e.rel === "dep" || e.rel === "strong");
    const layer = {};
    nodes.forEach(n => layer[n.id] = (n.lock != null ? n.lock : 0));
    for (let i = 0; i < nodes.length; i++)
      fwd.forEach(e => { if (layer[e.from] + 1 > layer[e.to]) layer[e.to] = layer[e.from] + 1; });
    nodes.forEach(n => { if (n.lock != null && layer[n.id] < n.lock) layer[n.id] = n.lock; });
    return layer;
  }
  function groupByLayer(layer) {
    const g = {}; nodes.forEach(n => { (g[layer[n.id]] = g[layer[n.id]] || []).push(n); });
    return g;
  }
  function barycenter(layer, groups) {
    const keys = Object.keys(groups).map(Number).sort((a, b) => a - b);
    keys.forEach(L => groups[L].forEach((n, i) => n._ord = i));
    const ord = id => byId[id] ? byId[id]._ord : 0;
    for (let p = 0; p < 5; p++) keys.forEach(L => {
      groups[L].forEach(n => {
        const nb = edges.filter(e => e.from === n.id || e.to === n.id)
          .map(e => e.from === n.id ? e.to : e.from).filter(id => byId[id] && Math.abs(layer[id] - L) === 1);
        n._bc = nb.length ? nb.reduce((s, id) => s + ord(id), 0) / nb.length : n._ord;
      });
      groups[L].sort((a, b) => a._bc - b._bc).forEach((n, i) => n._ord = i);
    });
  }
  function layeredLayout() {
    const layer = computeLayers(), groups = groupByLayer(layer);
    barycenter(layer, groups);
    Object.keys(groups).map(Number).forEach(L => {
      const g = groups[L], total = (g.length - 1) * ROW_GAP;
      g.forEach((n, i) => { n.x = L * LAYER_GAP; n.y = i * ROW_GAP - total / 2; });
    });
    applyOverrides();
  }
  function radialLayout() {
    const layer = computeLayers(), groups = groupByLayer(layer);
    barycenter(layer, groups);
    Object.keys(groups).map(Number).forEach(L => {
      const g = groups[L];
      if (L === 0 && g.length === 1) { g[0].x = 0; g[0].y = 0; return; }
      const radius = 130 + L * 132;
      g.forEach((n, i) => {
        const ang = (i / g.length) * Math.PI * 2 - Math.PI / 2 + L * 0.55;
        n.x = Math.cos(ang) * radius; n.y = Math.sin(ang) * radius;
      });
    });
    applyOverrides();
  }
  function applyOverrides() {
    nodes.forEach(n => { const o = posOverride[n.id]; if (o) { n.x = o.x; n.y = o.y; } });
  }
  function forceLayout() {
    nodes.forEach(n => { n.vx = 0; n.vy = 0; });
    const links = edges.map(e => ({ s: byId[e.from], t: byId[e.to] })).filter(l => l.s && l.t);
    let it = 0; const total = 300;
    cancelAnimationFrame(raf);
    (function tick() {
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2), f = 26000 / d2;
        a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
      links.forEach(l => {
        let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 185) * 0.04;
        l.s.vx += dx / d * f; l.s.vy += dy / d * f; l.t.vx -= dx / d * f; l.t.vy -= dy / d * f;
      });
      nodes.forEach(n => { n.vx += -n.x * 0.008; n.vy += -n.y * 0.008; });
      nodes.forEach(n => { if (n._dragging) return; n.vx *= 0.82; n.vy *= 0.82; n.x += Math.max(-30, Math.min(30, n.vx)); n.y += Math.max(-30, Math.min(30, n.vy)); });
      renderPositions();
      if (++it < total) raf = requestAnimationFrame(tick); else fit(true);
    })();
  }

  /* ---------- build DOM ---------- */
  function buildEdges() {
    edges.forEach(e => {
      const p = el("path", { class: "edge rel-" + e.rel, "marker-end": "url(#ar-" + e.rel + ")" });
      e._p = p; gEdges.append(p);
      const f = el("path", { class: "edge-flow rel-" + e.rel }); e._f = f; gFlow.append(f);
      const hit = el("path", { class: "edge-hit", fill: "none", stroke: "transparent", "stroke-width": 16 });
      e._hit = hit; gFlow.append(hit);
      hit.addEventListener("mouseenter", ev => {
        if (!selEdge) e._p.classList.add("hot");
        if (window.__tip) window.__tip.show(ev.clientX, ev.clientY,
          `<b>${e.from} → ${e.to}</b><span class="tip-rel rel-${e.rel}">${relName(e.rel)}</span>${e.label}`);
      });
      hit.addEventListener("mousemove", ev => window.__tip && window.__tip.move(ev.clientX, ev.clientY));
      hit.addEventListener("mouseleave", () => { window.__tip && window.__tip.hide(); if (!selEdge) paint(); });
      hit.addEventListener("mousedown", ev => ev.stopPropagation());
      hit.addEventListener("click", ev => { ev.stopPropagation(); selectEdge(e); });
    });
  }
  function buildNodes() {
    nodes.forEach((n, i) => {
      const w = n.w, h = n.h;
      const g = el("g", { class: "node", style: `--kc: var(--k-${n.kind})` });
      g.dataset.id = n.id;
      g.style.animationDelay = (i * 34) + "ms";
      g.classList.add("node-enter");
      g.addEventListener("animationend", function onEnd(ev) {
        if (ev.animationName === "nodeEnter") { g.classList.remove("node-enter"); g.removeEventListener("animationend", onEnd); }
      });
      const pulse = el("rect", { class: "node-pulse", x: -w / 2, y: -h / 2, width: w, height: h, rx: 11, fill: "none", stroke: `var(--k-${n.kind})`, "stroke-width": 1.5, style: "transform-box: fill-box; transform-origin: center;" });
      const glow = el("rect", { class: "node-glow", x: -w / 2, y: -h / 2, width: w, height: h, rx: 11, fill: "none", stroke: `var(--k-${n.kind})`, "stroke-width": 2 });
      const box = el("rect", { class: "node-box", x: -w / 2, y: -h / 2, width: w, height: h, rx: 11, fill: "var(--bg-elevated)", stroke: `var(--k-${n.kind})`, "stroke-width": 1.4 });
      const dot = el("circle", { class: "node-dot", cx: -w / 2 + 16, cy: 0, r: 3.5 + Math.min(n._deg, 8) * 0.42, fill: `var(--k-${n.kind})` });
      const label = el("text", { class: "node-label", x: -w / 2 + 28, y: -1, "text-anchor": "start", "font-size": 13, fill: "var(--tx)", "dominant-baseline": "middle" });
      label.textContent = n.label;
      const sub = el("text", { class: "node-sub", x: -w / 2 + 28, y: 12, "text-anchor": "start", "font-size": 8.5, fill: "var(--tx-3)", "dominant-baseline": "middle", "letter-spacing": ".04em" });
      sub.textContent = n.root.replace("src/", "").replace(/\/$/, "").replace(".rs", "") || "entry";
      g.append(pulse, glow, box, dot, label, sub);

      // collapse/expand control for group parents
      if (n.collapsible) {
        const kids = groupChildren(n.id).length;
        const isC = collapsed.has(n.id);
        const ctrl = el("g", { class: "node-ctrl" });
        const cx = w / 2 - 13;
        ctrl.append(el("circle", { cx, cy: -h / 2 + 13, r: 8, fill: "#0b0d12", stroke: `var(--k-${n.kind})`, "stroke-width": 1.2 }));
        const ct = el("text", { x: cx, y: -h / 2 + 13, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 9, fill: `var(--k-${n.kind})`, "font-family": "var(--mono)" });
        ct.textContent = isC ? "+" + kids : "–";
        ctrl.append(ct);
        ctrl.addEventListener("mousedown", ev => ev.stopPropagation());
        ctrl.addEventListener("click", ev => { ev.stopPropagation(); toggleGroup(n.id); });
        g.append(ctrl);
      }

      n._g = g; gNodes.append(g);
      g.addEventListener("mouseenter", ev => {
        setHover(n.id);
        if (window.__tip) {
          const outs = edges.filter(e => e.from === n.id).length, ins = edges.filter(e => e.to === n.id).length;
          window.__tip.show(ev.clientX, ev.clientY,
            `<b>${n.label}</b><span class="tip-rel" style="color:var(--k-${n.kind});background:color-mix(in oklab, var(--k-${n.kind}), transparent 86%)">${n.kind}</span>` +
            `<span class="tip-row"><i>root</i><em>${n.root || "-"}</em></span>` +
            `<span class="tip-row"><i>depends on</i><em>${outs}</em></span>` +
            `<span class="tip-row"><i>consumed by</i><em>${ins}</em></span>`);
        }
      });
      g.addEventListener("mousemove", ev => window.__tip && window.__tip.move(ev.clientX, ev.clientY));
      g.addEventListener("mouseleave", () => { setHover(null); if (window.__tip) window.__tip.hide(); });
      g.addEventListener("mousedown", ev => { if (window.__tip) window.__tip.hide(); startNodeDrag(ev, n); });
    });
  }

  function edgePath(e) {
    const s = byId[e.from], t = byId[e.to]; if (!s || !t) return "";
    if (t.x >= s.x) {
      const sx = s.x + s.w / 2, tx = t.x - t.w / 2, mx = (sx + tx) / 2;
      return `M ${sx} ${s.y} C ${mx} ${s.y}, ${mx} ${t.y}, ${tx} ${t.y}`;
    }
    const sx = s.x - s.w / 2, tx = t.x + t.w / 2, bow = 60 + Math.abs(s.y - t.y) * 0.2;
    return `M ${sx} ${s.y} C ${sx - 70} ${s.y + bow}, ${tx + 70} ${t.y + bow}, ${tx} ${t.y}`;
  }
  function renderPositions() {
    nodes.forEach(n => n._g.setAttribute("transform", `translate(${n.x},${n.y})`));
    edges.forEach(e => { const d = edgePath(e); e._p.setAttribute("d", d); e._f.setAttribute("d", d); e._hit.setAttribute("d", d); });
    updateMinimapGeom();
  }
  function applyView() {
    root.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
    if (stage) {
      const px = (view.x * 0.12).toFixed(1), py = (view.y * 0.12).toFixed(1);
      stage.style.backgroundPosition = `${px}px ${py}px, ${px}px ${py}px`;
    }
    const zl = document.getElementById("zoomVal"); if (zl) zl.textContent = Math.round(view.k * 100) + "%";
    drawMinimap();
  }

  /* ---------- highlight / paint ---------- */
  function neighborSet(id) { const s = new Set([id]); edges.forEach(e => { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); }); return s; }
  function downstream(id) {
    // transitive consumers via forward edges (dep/strong/write)
    const dist = { [id]: 0 }; let frontier = [id];
    while (frontier.length) {
      const nxt = [];
      frontier.forEach(u => edges.forEach(e => {
        if (e.from === u && e.rel !== "peer" && dist[e.to] == null) { dist[e.to] = dist[u] + 1; nxt.push(e.to); }
      }));
      frontier = nxt;
    }
    return dist;
  }

  function clearPaint() {
    nodes.forEach(n => { n._g.classList.remove("dim", "selected"); n._g.style.removeProperty("--impact"); });
    edges.forEach(e => { e._p.classList.remove("dim", "hot", "sel"); e._f.classList.remove("run"); });
  }
  function paint() {
    if (selEdge) return paintEdge();
    const focus = hovered || selected;
    if (!focus) { clearPaint(); return; }
    if (impactMode && selected && focus === selected) return paintImpact(selected);
    const nb = neighborSet(focus);
    nodes.forEach(n => { n._g.classList.toggle("dim", !nb.has(n.id)); n._g.classList.toggle("selected", n.id === selected); n._g.style.removeProperty("--impact"); });
    edges.forEach(e => {
      const hot = e.from === focus || e.to === focus;
      e._p.classList.toggle("hot", hot); e._p.classList.toggle("dim", !hot); e._p.classList.remove("sel");
      e._f.classList.toggle("run", hot);
    });
  }
  function paintImpact(id) {
    const dist = downstream(id);
    const maxD = Math.max(1, ...Object.values(dist));
    nodes.forEach(n => {
      const d = dist[n.id];
      n._g.classList.toggle("dim", d == null);
      n._g.classList.toggle("selected", n.id === id);
      if (d != null && d > 0) n._g.style.setProperty("--impact", (1 - (d - 1) / (maxD)) * 0.7 + 0.3);
      else n._g.style.removeProperty("--impact");
    });
    edges.forEach(e => {
      const inPath = dist[e.from] != null && dist[e.to] != null && dist[e.to] === dist[e.from] + 1 && e.rel !== "peer";
      e._p.classList.toggle("hot", inPath); e._p.classList.toggle("dim", !inPath); e._p.classList.remove("sel");
      e._f.classList.toggle("run", inPath);
    });
    if (opts.onImpact) opts.onImpact({ id, reached: Object.keys(dist).length - 1, nodes: Object.keys(dist).filter(k => k !== id) });
  }
  function paintEdge() {
    const e0 = selEdge;
    nodes.forEach(n => { const on = n.id === e0.from || n.id === e0.to; n._g.classList.toggle("dim", !on); n._g.classList.remove("selected"); });
    edges.forEach(e => {
      const sel = e === e0;
      e._p.classList.toggle("sel", sel); e._p.classList.toggle("hot", sel); e._p.classList.toggle("dim", !sel);
      e._f.classList.toggle("run", sel);
    });
  }

  function setHover(id) { if (selEdge) return; hovered = id; paint(); }

  /* ---------- selection ---------- */
  function syncExplorer() {
    document.querySelectorAll(".lr-item.node-item").forEach(it => it.classList.toggle("active", it.dataset.node === selected));
  }
  function clearEdge() { if (selEdge) { selEdge = null; if (opts.onEdgeSelect) opts.onEdgeSelect(null); } }
  function select(id) {
    clearEdge();
    selected = (selected === id) ? null : id;
    paint();
    if (opts.onSelect) opts.onSelect(selected);
    if (selected) centerOn(byId[selected]);
    syncExplorer();
  }
  function selectExternal(id) {
    clearEdge();
    // expand a collapsed group if the target is hidden inside it
    const tgt = allById[id];
    if (tgt && tgt.group && collapsed.has(tgt.group)) { collapsed.delete(tgt.group); rebuild(); }
    selected = id; hovered = null; paint();
    if (opts.onSelect) opts.onSelect(selected);
    if (id && byId[id]) centerOn(byId[id]);
    syncExplorer();
  }
  function selectEdge(e) {
    if (selEdge === e) { deselect(); return; } // toggle off on re-click
    selected = null; hovered = null; selEdge = e;
    if (opts.onSelect) opts.onSelect(null);
    syncExplorer();
    paintEdge();
    if (opts.onEdgeSelect) opts.onEdgeSelect(e);
  }
  function deselect() {
    if (!selected && !selEdge) return;
    selected = null; selEdge = null; clearPaint();
    if (opts.onSelect) opts.onSelect(null);
    if (opts.onEdgeSelect) opts.onEdgeSelect(null);
    syncExplorer();
  }

  /* ---------- collapse / expand ---------- */
  function toggleGroup(pid) {
    let selChanged = false;
    if (collapsed.has(pid)) collapsed.delete(pid); else {
      collapsed.add(pid);
      if (selected && allById[selected] && allById[selected].group === pid) { selected = pid; selChanged = true; }
    }
    rebuild();
    if (selChanged && opts.onSelect) opts.onSelect(selected);
  }

  /* ---------- drag / pan / zoom ---------- */
  function clientToWorld(cx, cy) { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }; }
  function startNodeDrag(ev, n) {
    ev.stopPropagation();
    const start = clientToWorld(ev.clientX, ev.clientY);
    const ox = n.x - start.x, oy = n.y - start.y; n._dragging = true; let moved = false;
    function move(e) { const w = clientToWorld(e.clientX, e.clientY); n.x = w.x + ox; n.y = w.y + oy; moved = true; renderPositions(); }
    function up() {
      n._dragging = false;
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      if (!moved) select(n.id);
      else { posOverride[n.id] = { x: n.x, y: n.y }; savePositions(); }
    }
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  }
  function savePositions() { try { localStorage.setItem(POS_KEY, JSON.stringify(posOverride)); } catch (e) {} }
  function loadPositions() { try { posOverride = JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch (e) { posOverride = {}; } }
  function resetPositions() { posOverride = {}; savePositions(); setMode(mode); }

  function initPanZoom() {
    let panning = false, sx, sy, vx, vy;
    stage.addEventListener("mousedown", e => {
      if (e.target.closest(".node") || e.target.closest(".edge-hit")) return;
      panning = true; stage.classList.add("panning"); sx = e.clientX; sy = e.clientY; vx = view.x; vy = view.y;
      deselect();
    });
    window.addEventListener("mousemove", e => { if (!panning) return; view.x = vx + (e.clientX - sx); view.y = vy + (e.clientY - sy); applyView(); });
    window.addEventListener("mouseup", () => { panning = false; stage.classList.remove("panning"); });
    stage.addEventListener("wheel", e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const nk = Math.max(0.3, Math.min(2.6, view.k * (1 - e.deltaY * 0.0015)));
      const wx = (mx - view.x) / view.k, wy = (my - view.y) / view.k;
      view.k = nk; view.x = mx - wx * nk; view.y = my - wy * nk; applyView();
    }, { passive: false });
  }

  function bbox() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    nodes.forEach(n => { x0 = Math.min(x0, n.x - n.w / 2); y0 = Math.min(y0, n.y - n.h / 2); x1 = Math.max(x1, n.x + n.w / 2); y1 = Math.max(y1, n.y + n.h / 2); });
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  function fit(animate) {
    const r = stage.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const b = bbox(), pad = Math.max(28, Math.min(72, r.width * 0.07));
    const k = Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h, 1.35);
    const tx = (r.width - b.w * k) / 2 - b.x0 * k, ty = (r.height - b.h * k) / 2 - b.y0 * k;
    if (animate) animateView(tx, ty, k); else { view = { x: tx, y: ty, k }; applyView(); }
  }
  function centerOn(n) { const r = stage.getBoundingClientRect(); animateView(r.width * 0.42 - n.x * view.k, r.height / 2 - n.y * view.k, view.k); }
  function animateView(tx, ty, tk) {
    const s = { ...view }, t0 = performance.now(), dur = 460; cancelAnimationFrame(raf);
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      view.x = s.x + (tx - s.x) * e; view.y = s.y + (ty - s.y) * e; view.k = s.k + (tk - s.k) * e; applyView();
      if (p < 1) raf = requestAnimationFrame(step);
    })(performance.now());
  }
  function zoomBy(f) {
    const r = stage.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2;
    const nk = Math.max(0.3, Math.min(2.6, view.k * f)), wx = (mx - view.x) / view.k, wy = (my - view.y) / view.k;
    view.k = nk; view.x = mx - wx * nk; view.y = my - wy * nk; applyView();
  }

  /* ---------- minimap ---------- */
  let mm, mmView, mmReady = false;
  function buildMinimap() {
    mm = document.getElementById("minimapSvg"); if (!mm) return;
    mm.replaceChildren();
    edges.forEach(e => { const l = el("line", { stroke: "rgba(255,255,255,0.14)", "stroke-width": 2.5 }); e._mml = l; mm.append(l); });
    nodes.forEach(n => { const c = el("rect", { rx: 8, fill: `var(--k-${n.kind})`, opacity: .85 }); n._mm = c; mm.append(c); });
    mmView = el("rect", { class: "mm-view" }); mm.append(mmView);
    mmReady = true; updateMinimapGeom();
    mm.style.cursor = "crosshair";
    mm.onclick = e => {
      const r = mm.getBoundingClientRect(), vb = mm.viewBox.baseVal;
      if (!r.width || !vb.width) return;
      const wx = vb.x + (e.clientX - r.left) / r.width * vb.width;
      const wy = vb.y + (e.clientY - r.top) / r.height * vb.height;
      const sr = stage.getBoundingClientRect();
      animateView(sr.width / 2 - wx * view.k, sr.height / 2 - wy * view.k, view.k);
    };
  }
  function updateMinimapGeom() {
    if (!mmReady) return;
    const b = bbox(), pad = 34;
    mm.setAttribute("viewBox", `${b.x0 - pad} ${b.y0 - pad} ${b.w + pad * 2} ${b.h + pad * 2}`);
    edges.forEach(e => { const s = byId[e.from], t = byId[e.to]; if (!s || !t || !e._mml) return; e._mml.setAttribute("x1", s.x); e._mml.setAttribute("y1", s.y); e._mml.setAttribute("x2", t.x); e._mml.setAttribute("y2", t.y); });
    nodes.forEach(n => { if (!n._mm) return; n._mm.setAttribute("x", n.x - n.w / 2); n._mm.setAttribute("y", n.y - n.h / 2); n._mm.setAttribute("width", n.w); n._mm.setAttribute("height", n.h); });
  }
  function drawMinimap() {
    if (!mmReady) return;
    const r = stage.getBoundingClientRect();
    mmView.setAttribute("x", -view.x / view.k); mmView.setAttribute("y", -view.y / view.k);
    mmView.setAttribute("width", r.width / view.k); mmView.setAttribute("height", r.height / view.k);
  }

  /* ---------- tick-flow animation ---------- */
  function flowNodes(ids, o) {
    o = o || {}; stopFlow();
    const seq = ids.filter(id => byId[id]);
    if (!seq.length) return;
    let i = 0;
    function step() {
      nodes.forEach(n => n._g.classList.remove("flow-on"));
      edges.forEach(e => e._f.classList.remove("run", "flow-edge"));
      const id = seq[i], n = byId[id];
      if (n) n._g.classList.add("flow-on");
      if (i > 0) { const e = edges.find(e => e.from === seq[i - 1] && e.to === id) || edges.find(e => e.from === id && e.to === seq[i - 1]); if (e) { e._f.classList.add("run", "flow-edge"); } }
      if (opts.onFlowStep) opts.onFlowStep(i, id);
      i++;
      if (i < seq.length) flowTimer = setTimeout(step, o.interval || 420);
      else if (o.loop) { i = 0; flowTimer = setTimeout(step, 650); }
      else flowTimer = setTimeout(() => { stopFlow(); if (opts.onFlowEnd) opts.onFlowEnd(); }, 560);
    }
    fit(true); step();
  }
  function stopFlow() {
    clearTimeout(flowTimer); flowTimer = null;
    nodes.forEach(n => n._g && n._g.classList.remove("flow-on"));
    edges.forEach(e => e._f && e._f.classList.remove("run", "flow-edge"));
    if (!hovered && !selected && !selEdge) clearPaint();
  }
  function isFlowing() { return !!flowTimer; }

  /* ---------- external highlight (entity linking) ---------- */
  function highlight(ids) {
    const set = new Set(ids);
    nodes.forEach(n => n._g.classList.toggle("ext-hot", set.has(n.id)));
    nodes.forEach(n => n._g.classList.toggle("dim", set.size > 0 && !set.has(n.id)));
  }
  function clearHighlight() {
    nodes.forEach(n => n._g.classList.remove("ext-hot"));
    paint();
  }

  /* ---------- ego mini-graph (dossier) ---------- */
  function renderEgo(svgEl, id) {
    const center = allById[id]; if (!center) return;
    const outs = allEdges.filter(e => e.from === id).map(e => ({ id: e.to, dir: "out", rel: e.rel }));
    const ins = allEdges.filter(e => e.to === id).map(e => ({ id: e.from, dir: "in", rel: e.rel }));
    const all = [...ins, ...outs];
    const W = 300, H = 150, cx = W / 2, cy = H / 2;
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let s = "";
    const place = [];
    const n = all.length || 1;
    all.forEach((nb, i) => {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = 56;
      place.push({ ...nb, x: cx + Math.cos(ang) * r * 1.7, y: cy + Math.sin(ang) * r });
    });
    place.forEach(p => {
      const col = { dep: "rgba(255,255,255,0.25)", strong: "var(--cyan)", write: "var(--violet)", peer: "var(--amber)" }[p.rel];
      const x1 = p.dir === "out" ? cx : p.x, y1 = p.dir === "out" ? cy : p.y;
      const x2 = p.dir === "out" ? p.x : cx, y2 = p.dir === "out" ? p.y : cy;
      const bend = (y1 + y2) / 2 + (x2 > x1 ? 9 : -9);
      s += `<path d="M ${x1} ${y1} Q ${(x1 + x2) / 2} ${bend}, ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="1.4" ${p.rel === "write" || p.rel === "peer" ? 'stroke-dasharray="3 3"' : ""}/>`;
    });
    place.forEach(p => {
      const k = allById[p.id].kind;
      s += `<g class="ego-node" data-ego="${p.id}" style="cursor:pointer"><circle cx="${p.x}" cy="${p.y}" r="6" fill="var(--k-${k})"/>` +
        `<text x="${p.x}" y="${p.y + 17}" text-anchor="middle" font-size="9.5" fill="var(--tx-2)" font-family="var(--mono)">${p.id.length > 12 ? p.id.slice(0, 11) + "…" : p.id}</text></g>`;
    });
    s += `<g><rect x="${cx - 36}" y="${cy - 15}" width="72" height="30" rx="9" fill="var(--bg-elevated)" stroke="var(--k-${center.kind})" stroke-width="1.5"/>` +
      `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="10.5" fill="var(--tx)" font-family="var(--mono)">${center.label}</text></g>`;
    svgEl.innerHTML = s;
    svgEl.querySelectorAll(".ego-node").forEach(g => g.addEventListener("click", () => selectExternal(g.dataset.ego)));
  }

  /* ---------- rebuild ---------- */
  function rebuild(relayout) {
    computeVisible();
    gEdges.replaceChildren(); gFlow.replaceChildren(); gNodes.replaceChildren();
    buildEdges(); buildNodes(); buildMinimap();
    doLayout();
    renderPositions();
    if (relayout !== false) fit(true);
    paint(); syncExplorer();
  }
  function doLayout() { if (mode === "force") forceLayout(); else if (mode === "radial") radialLayout(); else layeredLayout(); }

  function setMode(m) {
    mode = m;
    document.querySelectorAll("[data-graph-mode]").forEach(b => b.classList.toggle("active", b.dataset.graphMode === m));
    if (m === "force") forceLayout();
    else { doLayout(); renderPositions(); fit(true); }
  }
  function setImpact(on) {
    impactMode = on;
    document.querySelectorAll("[data-impact-toggle]").forEach(b => b.classList.toggle("active", on));
    paint();
    if (!on && opts.onImpact) opts.onImpact(null);
    else if (on && selected && opts.onImpact) paintImpact(selected);
  }

  function init(stageEl, o) {
    stage = stageEl; opts = o || {};
    /* Default x/y to the origin before the spread: the minimap and edge
       geometry build once before the first layout pass, and undefined
       coordinates there emit an SVG attribute warning per element. */
    allNodes = ARCH.nodes.map(n => ({ x: 0, y: 0, ...n }));
    allEdges = ARCH.edges.map(e => ({ ...e }));
    allById = {}; allNodes.forEach(n => allById[n.id] = n);
    const deg = {}; allNodes.forEach(n => deg[n.id] = 0);
    allEdges.forEach(e => { deg[e.from]++; deg[e.to]++; });
    allNodes.forEach(n => { n._deg = deg[n.id]; const d = Math.min(deg[n.id], 8); n.w = Math.max(120 + d * 5, 46 + n.label.length * 8.6); n.h = 50 + d * 1.7; });
    loadPositions();

    svg = el("svg");
    const defs = el("defs");
    [["dep", "rgba(255,255,255,0.3)"], ["strong", "var(--cyan)"], ["write", "var(--violet)"], ["peer", "var(--amber)"]].forEach(([k, c]) => {
      const m = el("marker", { id: "ar-" + k, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
      m.append(el("path", { d: "M0 0 L10 5 L0 10 z", fill: c })); defs.append(m);
    });
    svg.append(defs);
    root = el("g", { id: "graphRoot" });
    gEdges = el("g"); gFlow = el("g"); gNodes = el("g"); root.append(gEdges, gFlow, gNodes);
    svg.append(root); stage.append(svg);

    computeVisible(); buildEdges(); buildNodes(); buildMinimap();
    layeredLayout(); renderPositions(); initPanZoom();
    requestAnimationFrame(() => fit(false));

    let rt = null, lastW = 0, lastH = 0;
    new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2) return;
      lastW = r.width; lastH = r.height; clearTimeout(rt); rt = setTimeout(() => fit(true), 90);
    }).observe(stage);

    return {
      setMode, fit: () => fit(true), zoomIn: () => zoomBy(1.2), zoomOut: () => zoomBy(1 / 1.2),
      select: selectExternal, deselect, arrange: () => { resetPositions(); }, getSelected: () => selected,
      toggleGroup, setImpact, isImpact: () => impactMode,
      flowNodes, stopFlow, isFlowing,
      highlight, clearHighlight, renderEgo, resetPositions,
      selectEdge: (f, t) => { const e = edges.find(x => x.from === f && x.to === t) || edges.find(x => x.from === t && x.to === f); if (e) selectEdge(e); },
      hasNode: (id) => !!byId[id],
    };
  }

  return { init };
})();
