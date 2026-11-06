// Network Circles viewer. Plain script, no build. Globals from vendor/: graphology, graphologyLibrary, Sigma.
"use strict";
const $ = (id) => document.getElementById(id);
// dataviz reference categorical palette, fixed order; light and dark steps. Past 8 and "unplaced" -> grey.
// Light green, yellow and pink are darkened to reach 3:1 against the surface (tests/palette_check.py).
const PAL = { light: ["#2a78d6", "#eb6834", "#19a573", "#c48400", "#d77198", "#008300", "#6250d6", "#e34948"],
              dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"] };
const SMALL = PAL.light.length;  // clusters past the palette fold into one "Smaller groups" entry (grey)
const grp = (c) => (c < 0 ? -1 : Math.min(c, SMALL));
const MIN_W = 0.1;          // links lighter than this are laid out but not drawn
// Edge colours are opaque tokens: sigma writes straight alpha into a premultiplied canvas, so rgba() edges glow on dark.
const PLAY_MS = 20000;      // first month -> last month
const SHARED = { co: "current company", ego: "past employer of yours", era: "job of yours at connection time",
                 burst: "burst of connection days", role: "role family" };
const W_NAMES = { co: "same current company", ego: "works where you worked", era: "connected during the same job of yours",
                  burst: "connected in the same burst of days", role: "same role family" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const EXPORT_NAMES = ["Connections.csv", "Positions.csv", "Invitations.csv", "Recommendations_Received.csv", "Recommendations_Given.csv",
  "merge_overrides.csv", "Skills.csv", "Endorsement_Received_Info.csv", "Endorsement_Given_Info.csv", "Endorsements.csv", "Education.csv",
  "Company Follows.csv", "Member_Follows.csv", "Groups.csv", "Events.csv", "Shares.csv", "Comments.csv", "Reactions.csv"];
// Layer node kinds (netmap.layers). Glyphs tell kinds apart without spending the circle palette. `col` = column in the Layers view.
const KINDS = {
  group:  { g: "◎", name: "Groups", one: "Group", col: 0 },   topic: { g: "#", name: "Topics", one: "Hashtag", col: 1 },
  post:   { g: "✎", name: "Posts and comments", one: "Post", col: 2 }, skill: { g: "◆", name: "Skills", one: "Skill", col: 3 },
  person: { g: "", name: "People", one: "Person", col: 4 },  org: { g: "▣", name: "Organisations", one: "Organisation", col: 5 },
  event:  { g: "★", name: "Events", one: "Event", col: 6 },  follow: { g: "→", name: "People you follow", one: "Followed person", col: 7 },
  you:    { g: "●", name: "You", one: "You", col: 4 },
};
const LABELLED = new Set(["skill", "org", "group", "event", "topic", "you"]);  // always labelled: few, and they name the layer

let S = null;               // current view state
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkMQ = matchMedia("(prefers-color-scheme: dark)");

const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : darkMQ.matches; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const T = {};               // theme tokens the canvas needs, re-read on theme change
const readTokens = () => ["--ink", "--edge", "--small", "--unplaced", "--layer", "--layer-edge", "--surface", "--accent", "--dim", "--edge-focus", "--muted"]
  .forEach((v) => { T[v] = css(v); });
const colorOf = (g) => (g < 0 ? T["--unplaced"] : g >= SMALL ? T["--small"] : PAL[isDark() ? "dark" : "light"][g]);
const monthOf = (d) => (d ? +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1) : -Infinity);
const monthName = (m) => `${MON[m % 12]} ${Math.floor(m / 12)}`;
const fmtDate = (d) => (d ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : "unknown date");
function prng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const labelOf = (c) => (c.id < 0 ? "Unplaced" : c.label || `Circle ${c.id}`);  // one display label everywhere
function status(msg, err) { $("status").textContent = msg; $("status").className = err ? "err" : ""; }

// ---------- build graph + layout ----------
// Builds the new state and renderer first; the old view is only torn down once that succeeded (callers show errors).
function render(data, sourceText) {
  readTokens();
  const G = new graphology.Graph({ type: "undirected" });
  const all = data.clusters.slice().sort((a, b) => (a.id < 0) - (b.id < 0) || a.id - b.id);
  const small = all.filter((c) => c.id >= SMALL);
  const clusters = all.filter((c) => c.id >= 0 && c.id < SMALL);  // legend groups: palette clusters, smaller groups, unplaced
  if (small.length) clusters.push({ id: SMALL, size: small.reduce((t, c) => t + c.size, 0), cohesion: null,
    label: `${small.length} smaller groups`, members: small });
  clusters.push(...all.filter((c) => c.id < 0));
  const rnd = prng(42), placed = all.filter((c) => c.id >= 0);
  const centre = {};
  placed.forEach((c, k) => { const a = (2 * Math.PI * k) / Math.max(placed.length, 1);
    centre[c.id] = [100 * Math.cos(a), 100 * Math.sin(a), 6 * Math.sqrt(c.size)]; });
  centre[-1] = [0, 0, 160];
  for (const n of data.nodes) {
    const [cx, cy, r] = centre[n.cluster] || centre[-1], a = rnd() * 2 * Math.PI, d = r * Math.sqrt(rnd());
    const ex = n.cluster < 0 ? 150 : 0;  // unplaced start on an outer ring
    G.addNode(String(n.id), { x: cx + (d + ex) * Math.cos(a), y: cy + (d + ex) * Math.sin(a), label: n.name,
      cluster: grp(n.cluster), m: monthOf(n.connected_on), p: n, kind: "person" });
  }
  for (const e of data.edges) G.addEdge(String(e.s), String(e.t), { weight: e.w, size: e.w >= 1 ? 1 : 0.5 });
  const fa2 = graphologyLibrary.layoutForceAtlas2;
  fa2.assign(G, { iterations: 300, settings: fa2.inferSettings(G), getEdgeWeight: "weight" });

  // node size by weighted degree, gentle range
  const wdeg = {}; let maxW = 0;
  G.forEachNode((k) => { let s = 0; G.forEachEdge(k, (e, a) => { s += a.weight; }); wdeg[k] = s; maxW = Math.max(maxW, s); });
  G.forEachNode((k) => G.setNodeAttribute(k, "size", 2.5 + 5 * Math.sqrt(wdeg[k] / (maxW || 1))));
  const kindCount = addLayers(G, data.layers, rnd);

  // one hidden super-node per cluster at its members' centroid
  for (const c of clusters) {
    if (G.someNode((k, a) => a.cluster === c.id)) G.addNode("c" + c.id, { x: 0, y: 0, sup: true, cluster: c.id, label: labelOf(c), size: 6, months: [] });
  }
  placeSupers(G);
  G.forEachNode((k, a) => { if (a.kind === "person") G.getNodeAttribute("c" + a.cluster, "months").push(a.m); });
  const mapPos = {};
  G.forEachNode((k, a) => { if (!a.sup) mapPos[k] = [a.x, a.y]; });

  const months = data.nodes.map((n) => monthOf(n.connected_on)).filter(isFinite);
  const m0 = months.length ? Math.min(...months) : 0, m1 = months.length ? Math.max(...months) : 0;
  const perMonth = new Array(m1 - m0 + 1).fill(0);
  months.forEach((m) => perMonth[m - m0]++);
  const next = { data, G, clusters, collapsed: new Set(), m0, m1, cur: m1, perMonth, counts: {}, playing: null, edgeColor: T["--edge"],
    hasDates: months.length > 0, box: null, labels: Object.fromEntries(all.map((c) => [c.id, labelOf(c)])),
    kindCount, hiddenKinds: new Set(), view: "map", mapPos, layerPos: null, boxes: new Map(), queue: [], hl: null, sel: null, selCircles: null, knowRows: [], focus: null, near: null, pinned: false, mapCollapsed: null };
  const box = (next.box = $("canvas").appendChild(document.createElement("div"))), old = S;
  try {
    S = next;  // reducers read S while sigma does its first render
    next.renderer = new Sigma.Sigma(G, box, {
      nodeReducer, edgeReducer, zIndex: true, labelRenderedSizeThreshold: 10, labelDensity: 0.6, labelFont: css("--sans"), labelSize: 12,
      labelColor: { color: T["--ink"] }, defaultEdgeColor: T["--edge"], defaultDrawNodeLabel: drawLabel, defaultDrawNodeHover: drawHover,  // no white hover box (dark mode)
    });
    next.renderer.on("beforeRender", () => { next.boxes.clear(); next.queue = []; });  // label boxes of this frame (tests read them)
    next.renderer.on("afterRender", flushLabels);
  } catch (e) { S = old; box.remove(); throw e; }
  if (old) { stopPlay(old); old.renderer.kill(); old.box.remove(); }
  $("tip").hidden = true;
  wireHover();
  $("source").textContent = sourceText; $("empty").hidden = true;
  buildLegend(); buildKinds(); buildMeta(); setupTimeline(); buildFind(); buildKnow();
  ["vMap", "vLayers"].forEach((id) => $(id).setAttribute("aria-pressed", String(id === "vMap")));
  window.__netmap = S;  // for tests / recording
}

// ---------- layers: skills, orgs, events, groups, posts, topics, follows ----------
// Layer nodes stay out of the force layout (they would become hubs that pull circles together). Each one is placed at
// the centroid of its already-placed neighbours, a few passes outward from the people; leftovers go on an outer ring.
function addLayers(G, L, rnd) {
  const count = { person: G.order };
  if (!L || !L.nodes.length) return count;
  (L.followed || []).forEach((id) => G.hasNode(String(id)) && G.setNodeAttribute(String(id), "follows", true));
  // The "you" hub is implied by the whole map; drawing it only adds a fan of spokes. Unlinked nodes become orphans:
  // left out of the Map (nowhere meaningful to put them), shown in their column in Layers.
  for (const n of L.nodes) {
    if (n.kind === "you") continue;
    G.addNode(n.id, { kind: n.kind, label: `${KINDS[n.kind].g} ${n.kind === "topic" ? n.label.replace(/^#/, "") : n.label}`, p: n, m: n.date ? monthOf(n.date) : -Infinity, x: 0, y: 0 });
    count[n.kind] = (count[n.kind] || 0) + 1;
  }
  for (const e of L.edges) {
    const s = String(e.s), t = String(e.t);
    if (e.kind !== "yours" && G.hasNode(s) && G.hasNode(t) && !G.hasEdge(s, t)) G.addEdge(s, t, { layer: true, kind: e.kind, weight: e.w, size: 0.6 });
  }
  const placed = new Set(G.filterNodes((k, a) => a.kind === "person"));
  let todo = L.nodes.filter((n) => G.hasNode(n.id)).map((n) => n.id);
  for (let pass = 0; pass < 6 && todo.length; pass++) {
    const now = [];
    todo = todo.filter((k) => {
      let x = 0, y = 0, c = 0;
      G.forEachNeighbor(k, (nb, a) => { if (placed.has(nb)) { x += a.x; y += a.y; c++; } });
      if (!c) return true;
      const j = 12 * Math.sqrt(rnd()), a = rnd() * 2 * Math.PI;  // jitter: nodes with the same neighbours must not stack
      G.mergeNodeAttributes(k, { x: x / c + j * Math.cos(a), y: y / c + j * Math.sin(a) }); now.push(k); return false;
    });
    now.forEach((k) => placed.add(k));
  }
  todo.forEach((k) => G.mergeNodeAttributes(k, { orphan: true }));
  count.linked = {};
  for (const n of L.nodes) if (G.hasNode(n.id)) {
    G.setNodeAttribute(n.id, "size", Math.min(9, 2 + 1.1 * Math.sqrt(G.degree(n.id))));
    if (!G.getNodeAttribute(n.id, "orphan")) count.linked[n.kind] = (count.linked[n.kind] || 0) + 1;
  }
  for (const pad of ["pad:l", "pad:r"]) G.addNode(pad, { kind: "head", of: "pad", label: "", x: 0, y: 0, size: 0.1 });
  for (const [kind, k] of Object.entries(KINDS)) if (count[kind] && kind !== "you")  // column titles, Layers view only
    G.addNode("h:" + kind, { kind: "head", of: kind, label: kind === "follow" ? "Follows" : k.name.split(" ")[0], x: 0, y: 0, size: 1 });
  return count;
}
function placeSupers(G) {
  G.forEachNode((k, s) => {
    if (!s.sup) return;
    let x = 0, y = 0, n = 0;
    G.forEachNode((j, a) => { if (a.kind === "person" && a.cluster === s.cluster) { x += a.x; y += a.y; n++; } });
    G.mergeNodeAttributes(k, { x: x / (n || 1), y: y / (n || 1) });
  });
}
// Layers view: one column per kind, like a layer diagram of a neural net. Units are screen pixels: the height fits the
// canvas and each gap is as wide as the longest label it must hold (labels left of a column for columns up to People,
// right of it after), so labels never run into the next column. Empty kinds get no column. People are sorted by
// circle; every other column by the mean height of its already-placed neighbours (barycentre), which keeps crossings down.
function layeredPositions() {
  const G = S.G, P = KINDS.person.col, cols = Object.values(KINDS).map(() => []), sups = [], pos = {};
  G.forEachNode((k, a) => { if (a.sup) sups.push(k); else if (KINDS[a.kind] && a.kind !== "you") cols[KINDS[a.kind].col].push(k); });
  // Sigma fits the graph's bounding box inside the canvas minus stagePadding; keep the layout within that box so the
  // fit scale is 1 and pixel gaps stay pixel gaps (labels don't shrink with the graph).
  const pad = S.renderer.getSetting("stagePadding") || 0, availW = S.box.clientWidth - 2 * pad;
  const at = (k) => G.getNodeAttributes(k);
  // circle nodes are drawn up to r = 4 + 2.2√n (nodeReducer); keep room so the top one clears the column titles
  const R = Math.max(0, ...G.filterNodes((k, a) => a.sup).map((k) => 4 + 2.2 * Math.sqrt(at(k).months.length)));
  const H = Math.max(200, S.box.clientHeight - 2 * pad - 40 - 2 * R);
  const put = (c, keys) => keys.forEach((k, i) => { pos[k] = [X[c], keys.length > 1 ? H / 2 - (H * i) / (keys.length - 1) : 0]; });
  const present = cols.map((ks, c) => c).filter((c) => cols[c].length);
  S.denseCols = new Set(present.filter((c) => c !== P && cols[c].length > 30));
  const ctx = document.createElement("canvas").getContext("2d");
  const kindAt = (c) => Object.keys(KINDS).find((k) => KINDS[k].col === c && k !== "you");
  ctx.font = `600 12px ${css("--sans")}`;
  const tw = (c) => G.hasNode("h:" + kindAt(c)) ? ctx.measureText(at("h:" + kindAt(c)).label).width : 0;
  const titleW = present.map(tw);
  ctx.font = `12px ${css("--sans")}`;
  const lab = (k, max) => { const a = at(k), t = a.sup ? `${a.label} (${a.months.length})` : a.label; return t.length > max ? t.slice(0, max - 1) + "…" : t; };
  const lw = (c, max) => {
    const ks = c === P ? sups : LABELLED.has(kindAt(c)) && !S.denseCols.has(c) ? cols[c] : [];
    return Math.max(0, ...ks.map((k) => ctx.measureText(lab(k, max)).width));
  };
  // Shorten labels until the columns fit the canvas; below 12 characters they stop being readable, so a narrow
  // canvas (phones) keeps 12 and setView zooms to 1:1 on People instead, to be panned sideways.
  let X, lo, hi;
  for (S.labelMax = 20; S.labelMax >= 12; S.labelMax--) {
    const m = S.labelMax; X = {}; let x = 0;
    present.forEach((c, i) => {
      if (i) {
        const p = present[i - 1];
        const gap = 36 + (c <= P ? lw(c, m) : 0) + (p > P ? lw(p, m) : 0) + (c === P || p === P ? 18 : 0);
        x += Math.max(gap, (titleW[i] + titleW[i - 1]) / 2 + 16);  // centred titles must not touch
      }
      X[c] = x;
    });
    const first = present[0], last = present[present.length - 1];  // invisible pads keep the outermost labels on screen
    lo = X[first] - Math.max(first <= P ? lw(first, m) + 14 : 0, titleW[0] / 2);
    hi = X[last] + Math.max(last > P ? lw(last, m) + 14 : 0, titleW[titleW.length - 1] / 2);
    if (hi - lo <= availW) break;
  }
  S.labelMax = Math.max(12, S.labelMax);
  S.layersFit = Math.min(1, availW / (hi - lo));
  // Row order = crossing reduction on the graph as drawn here: people folded into their circle node, one edge per pair.
  // Iteration 0 is the earlier single pass (below); alternating sweeps (outward from People and back) then re-sort each
  // column by the mean height of all its neighbours. The order with the fewest crossings is kept, so the sweeps can
  // never make it worse than iteration 0. "Smaller groups" and Unplaced stay at the bottom of People.
  const rep = (k) => (at(k).kind === "person" ? "c" + at(k).cluster : k);
  const colOf = new Map(), ord = {};
  present.forEach((c) => { ord[c] = c === P ? sups.slice() : cols[c].slice(); ord[c].forEach((k) => colOf.set(k, c)); });
  const nb = new Map(), pairs = [], seen = new Set();
  G.forEachEdge((e, ea, s, t) => {
    if (!ea.layer || ea.agg) return;
    const u = rep(s), v = rep(t), key = u < v ? u + "|" + v : v + "|" + u;
    if (u === v || !colOf.has(u) || !colOf.has(v) || seen.has(key)) return;
    seen.add(key); pairs.push([u, v]);
    for (const [a, b] of [[u, v], [v, u]]) { if (!nb.has(a)) nb.set(a, []); nb.get(a).push(b); }
  });
  const y = new Map();
  const place = (c) => ord[c].forEach((k, i) => y.set(k, ord[c].length > 1 ? H / 2 - (H * i) / (ord[c].length - 1) : 0));
  const count = () => crossings(pairs.map(([u, v]) => [X[colOf.get(u)], y.get(u), X[colOf.get(v)], y.get(v), u, v]));
  const bottom = (k) => at(k).cluster < 0 || at(k).cluster >= SMALL;
  const byCircle = (p, q) => (at(p).cluster < 0) - (at(q).cluster < 0) || at(p).cluster - at(q).cluster;
  const sortCol = (c) => {
    const b = (k) => { let s = 0, n = 0; for (const o of nb.get(k) || []) { s += y.get(o); n++; } return n ? -s / n : -y.get(k); };  // none: stay put
    const keys = c === P ? ord[c].filter((k) => !bottom(k)) : ord[c];
    ord[c] = keys.map((k) => [b(k), k]).sort((p, q) => p[0] - q[0]).map((v) => v[1]);
    if (c === P) ord[c].push(...sups.filter(bottom).sort(byCircle));
    place(c);
  };
  // Iteration 0: people spread down their column by circle; then each other column, right side first, sorted by the
  // mean height of its neighbours placed so far.
  ord[P].sort(byCircle);
  const py = new Map(), ppl = cols[P].slice().sort((a, b) => byCircle(a, b) || at(b).size - at(a).size);
  const spread = (ks) => ks.forEach((k, i) => py.set(k, ks.length > 1 ? H / 2 - (H * i) / (ks.length - 1) : 0));
  spread(ppl);
  for (const c of [5, 6, 7, 3, 2, 1, 0]) if (ord[c]) {
    const b0 = (k) => { let s = 0, n = 0; G.forEachNeighbor(k, (o) => { if (py.has(o) && !at(o).sup) { s += py.get(o); n++; } }); return n ? -s / n : Infinity; };
    ord[c] = ord[c].map((k) => [b0(k), k]).sort((p, q) => p[0] - q[0]).map((v) => v[1]);
    spread(ord[c]);
  }
  present.forEach(place);
  const before = count(), out = present.filter((c) => c > P), inn = present.filter((c) => c < P).reverse();
  let best = before, bestOrd = JSON.stringify(ord), stale = 0;
  for (let it = 0; it < 16 && best > 0 && stale < 3; it++) {
    const seq = it % 2 ? [P, ...out.slice().reverse(), ...inn.slice().reverse()] : [...out, ...inn, P];
    seq.forEach((c) => sortCol(c));
    const n = count();
    if (n < best) { best = n; bestOrd = JSON.stringify(ord); stale = 0; } else stale++;
  }
  Object.assign(ord, JSON.parse(bestOrd));
  S.layoutStats = { crossingsBefore: before, crossingsAfter: best, pairs: pairs.length };
  present.forEach((c) => put(c, ord[c]));
  const supIdx = new Map(ord[P].map((k, i) => [at(k).cluster, i]));  // people (shown when a circle is unfolded) follow
  put(P, cols[P].sort((a, b) => supIdx.get(at(a).cluster) - supIdx.get(at(b).cluster) || at(b).size - at(a).size));
  put(P, ord[P]);
  S.rowGap = sups.length > 1 ? H / (sups.length - 1) : Infinity;
  for (const c of present) if (G.hasNode("h:" + kindAt(c))) pos["h:" + kindAt(c)] = [X[c], H / 2 + R + 30];
  pos["pad:l"] = [lo, -H / 2 - R];  // also reserves the bottom circle's radius
  pos["pad:r"] = [hi, 0];
  return pos;
}
function setView(v) {
  if (!S || S.view === v) return;
  const pos = v === "layers" ? layeredPositions() : S.mapPos;  // first: sets S.denseCols, which the reducer reads
  S.view = v; clearFocus();
  // Layers view shows circles, not 300 people in a thin bar: fold them all, and give the map its own folds back after.
  if (v === "layers") { S.mapCollapsed = new Set(S.collapsed); S.clusters.forEach((c) => S.collapsed.add(c.id)); }
  else S.collapsed = S.mapCollapsed || new Set();
  rebuildAgg();
  if (v === "map") placeSupers(S.G);  // layered positions already include the circle nodes
  S.G.forEachNode((k) => { if (pos[k]) S.G.mergeNodeAttributes(k, { x: pos[k][0], y: pos[k][1] }); });
  ["vMap", "vLayers"].forEach((id) => $(id).setAttribute("aria-pressed", String((id === "vLayers") === (v === "layers"))));
  // Layers is laid out in pixels: keep node sizes fixed when zooming (the map grows them with √zoom, sigma's default)
  S.renderer.setSetting("zoomToSizeRatioFunction", v === "layers" ? () => 1 : Math.sqrt);
  S.renderer.refresh();
  const cam = S.renderer.getCamera(), duration = reduceMotion.matches ? 0 : 400;
  if (v === "layers" && S.layersFit < 1)  // too wide to read when fitted: 1:1 zoom centred on the circles
    cam.animate({ x: S.renderer.getNodeDisplayData("h:person").x, y: 0.5, ratio: S.layersFit }, { duration });
  else cam.animatedReset({ duration });
}
function buildKinds() {
  const ul = $("kinds"), present = Object.keys(KINDS).filter((k) => S.kindCount[k] && k !== "you");
  $("layersCard").hidden = present.length < 2; $("viewSwitch").hidden = present.length < 2;
  ul.innerHTML = "";
  for (const k of present) {
    const li = document.createElement("li"), lab = document.createElement("label"), cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !S.hiddenKinds.has(k);
    cb.onchange = () => { cb.checked ? S.hiddenKinds.delete(k) : S.hiddenKinds.add(k); S.renderer.refresh(); };
    lab.append(cb, ` ${KINDS[k].g} ${KINDS[k].name} `);
    const n = document.createElement("span"), ln = (S.kindCount.linked || {})[k];
    n.className = "num"; n.textContent = k === "person" || ln === S.kindCount[k] ? S.kindCount[k] : `${ln || 0} of ${S.kindCount[k]} linked`;
    if (k !== "person") n.title = "Linked = tied to at least one of your connections. Unlinked ones appear only in the Layers view.";
    lab.append(n);
    li.appendChild(lab); ul.appendChild(li);
  }
}

// ---------- visibility (timeline + collapse + layer toggles) ----------
// Month the view shows up to. At the end of the timeline, or with no connection dates (no timeline), everything shows,
// including layer items dated after the last connection.
const upTo = () => (!S.hasDates || S.cur >= S.m1 ? Infinity : S.cur);
function visible(k) {
  const a = S.G.getNodeAttributes(k);
  if (a.kind === "head") return S.view === "layers" && !S.hiddenKinds.has(a.of);
  if (a.sup) return S.collapsed.has(a.cluster) && S.counts[a.cluster] > 0 && !S.hiddenKinds.has("person");
  if (S.hiddenKinds.has(a.kind)) return false;
  if (a.kind !== "person") return a.m <= upTo() && !(a.orphan && S.view === "map");
  return !S.collapsed.has(a.cluster) && a.m <= upTo();
}
// Focus: hovering (or clicking, to pin) a node keeps it and its neighbours in colour with labels; everything else greys
// out and only the focused node's links are drawn. Without focus the map shows faint person links only.
function nodeReducer(k, a) {
  const r = { ...a, color: a.kind === "person" || a.sup ? colorOf(a.cluster) : T["--layer"] };
  if (!visible(k)) { r.hidden = true; return r; }
  if (a.sup) { const n = S.counts[a.cluster]; r.size = 4 + 2.2 * Math.sqrt(n); r.label = `${a.label} (${n})`; r.forceLabel = true; r.zIndex = 1;
    if (S.view === "layers") r.size = Math.min(r.size, S.rowGap / 2 - 1); }  // neighbours in the column must not touch
  else if (a.kind === "head") { r.color = T["--surface"]; r.forceLabel = true; r.zIndex = 3; r.size = 0.1; return r; }
  if (r.label && r.label.length > 26) r.label = r.label.slice(0, 25) + "…";
  // Layers: label the named layers unless a column is too dense to read (then hover reveals them)
  if (S.view === "layers") {
    const col = a.sup ? KINDS.person.col : (KINDS[a.kind] || {}).col;
    r.labelLeft = col <= KINDS.person.col;
    if (LABELLED.has(a.kind) && !S.denseCols.has(col)) r.forceLabel = true;
    if (r.label && r.label.length > S.labelMax) r.label = r.label.slice(0, S.labelMax - 1) + "…";
  }
  if (S.hl != null && !S.focus && a.kind !== "head" &&
      ((a.kind === "person" || a.sup) ? a.cluster !== grp(S.hl) : !S.hlNear.has(k))) { r.color = T["--dim"]; r.label = null; r.zIndex = 0; }
  if (S.sel && !S.focus && a.kind !== "head" && !(a.sup ? S.selCircles.has(a.cluster) : S.sel.has(k))) { r.color = T["--dim"]; r.label = null; r.zIndex = 0; }
  else if (S.sel && !S.focus && a.kind === "person") { r.forceLabel = S.sel.size <= 30; r.zIndex = 2; }
  if (S.focus) {
    if (k === S.focus || S.near.has(k)) {
      // big circles: let sigma's label grid thin out the person names instead of piling 40 on top of each other
      r.forceLabel = k === S.focus || a.sup || a.kind !== "person" || S.near.size <= 15; r.zIndex = k === S.focus ? 3 : 2; if (k === S.focus) r.highlighted = true; }
    else { r.color = T["--dim"]; r.label = null; r.forceLabel = false; r.zIndex = 0; }
  }
  return r;
}
function edgeReducer(k, a) {
  const [s, t] = S.G.extremities(k);
  if (a.dead || !visible(s) || !visible(t) || (a.agg && a.m > upTo())) return { ...a, hidden: true };
  if (S.focus) {  // only the focused node's own links
    if (s !== S.focus && t !== S.focus) return { ...a, hidden: true };
    return { ...a, color: T["--edge-focus"], size: Math.max(a.size, 1), zIndex: 1 };
  }
  if (S.hl != null && S.G.getNodeAttribute(s, "cluster") !== grp(S.hl) && S.G.getNodeAttribute(t, "cluster") !== grp(S.hl)) return { ...a, hidden: true };
  if (S.sel) {  // a selection: only links that touch a selected person (or, in Layers, a circle holding one)
    const inSel = (x) => S.sel.has(x) || (S.G.getNodeAttribute(x, "sup") && S.selCircles.has(S.G.getNodeAttribute(x, "cluster")));
    if (!inSel(s) && !inSel(t)) return { ...a, hidden: true };
  }
  // Map: faint person links (layer links only on focus). Layers: links into the layers, never person-person.
  if (S.view === "map" ? a.layer || a.weight < MIN_W : !a.layer) return { ...a, hidden: true };
  return { ...a, color: a.layer ? T["--layer-edge"] : S.edgeColor };
}
// Labels with a surface-coloured halo (readable over edges). In Layers, columns left of and including People put their
// labels on the left, so each label sits in the empty gap beside its own column instead of running into the next one.
// Placement is greedy: sigma hands labels over during the frame (drawLabel queues them), and after the frame they are
// drawn by priority (pinned node, column titles, circles, layer nodes, people); a label that would overlap one already
// drawn is skipped. The hover/pin label (drawHover) is drawn first, on sigma's hover canvas, and always wins.
const LABEL_RANK = (d) => (d.key === S.focus ? 0 : d.kind === "head" ? 1 : d.sup ? 2 : d.kind !== "person" ? 3 : 4);
function drawLabel(ctx, d, st) { if (d.label) S.queue.push([ctx, d, st]); }
function drawHover(ctx, d, st) { if (d.label) paintLabel(ctx, d, st, true); }
function flushLabels() {
  const q = S.queue.map((v, i) => [LABEL_RANK(v[1]), i, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  S.queue = [];
  for (const [, , [ctx, d, st]] of q) if (!S.boxes.has(d.key)) paintLabel(ctx, d, st, false);
}
function paintLabel(ctx, d, st, force) {
  ctx.font = `${d.kind === "head" ? 600 : st.labelWeight} ${st.labelSize}px ${st.labelFont}`;
  const w = ctx.measureText(d.label).width, y = d.y + st.labelSize / 3;
  const x = d.kind === "head" ? d.x - w / 2 : d.labelLeft ? d.x - d.size - 4 - w : d.x + d.size + 4;
  const box = { x, y: y - st.labelSize * 0.8, w, h: st.labelSize, label: d.label };
  if (!force) for (const b of S.boxes.values())  // 1px gap; ponytail: linear scan, a grid if labels pass ~1000
    if (box.x < b.x + b.w + 1 && b.x < box.x + box.w + 1 && box.y < b.y + b.h + 1 && b.y < box.y + box.h + 1) return;
  S.boxes.set(d.key, box);
  ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = T["--surface"]; ctx.strokeText(d.label, x, y);
  ctx.fillStyle = d.kind === "head" ? T["--muted"] || T["--ink"] : T["--ink"]; ctx.fillText(d.label, x, y);
}
function setFocus(k, pin) {
  if (!S || !S.G.hasNode(k)) return;
  S.focus = k; S.pinned = !!pin; S.near = new Set(S.G.neighbors(k)); S.renderer.refresh();
}
function clearFocus() { if (S && S.focus) { S.focus = null; S.near = null; S.pinned = false; S.renderer.refresh(); } }
// ponytail: recount/visible are O(N) per frame while playing; fine to ~10k nodes. Beyond that, keep per-cluster
// prefix sums of members by month and binary-search S.cur instead of filtering.
function recount() {
  S.counts = {};
  S.G.forEachNode((k, a) => { if (a.sup) S.counts[a.cluster] = a.months.filter((m) => m <= upTo()).length; });
}
function toggleCluster(id) {
  S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id);
  clearFocus(); rebuildAgg();
}
function rebuildAgg() {
  const { G, collapsed } = S;
  // Aggregate edges are kept and switched off ("dead") rather than dropped: sigma does O(edges) work per dropped edge,
  // which froze the tab for 30 s on unfolding with 3,000 people. One edge per circle/node pair, so they stay few.
  const stale = new Set(G.filterEdges((e, a) => a.agg && !a.dead));
  const acc = new Map();
  G.forEachEdge((e, a, s, t, sa, ta) => {
    if (a.agg) return;
    const cs = collapsed.has(sa.cluster), ct = collapsed.has(ta.cluster);
    if (!cs && !ct) return;
    const u = cs ? "c" + sa.cluster : s, v = ct ? "c" + ta.cluster : t;
    if (u === v) return;
    const key = u < v ? u + "|" + v : v + "|" + u, o = acc.get(key) || { u, v, w: 0, m: Infinity, layer: !!a.layer };
    o.w += a.weight; o.m = Math.min(o.m, Math.max(sa.m, ta.m)); acc.set(key, o);
  });
  acc.forEach((o, key) => {
    const k = "a:" + key, at = { agg: true, layer: o.layer, weight: o.w, m: o.m, size: Math.min(5, 0.5 + Math.log2(1 + o.w)) };
    if (G.hasEdge(k)) { G.replaceEdgeAttributes(k, at); stale.delete(k); } else G.addEdgeWithKey(k, o.u, o.v, at);
  });
  stale.forEach((k) => G.setEdgeAttribute(k, "dead", true));
  document.querySelectorAll("#legend button").forEach((b) => b.setAttribute("aria-pressed", collapsed.has(+b.dataset.id)));
  recount(); S.renderer.refresh();
}

// ---------- hover ----------
function wireHover() {
  const tip = $("tip"), r = S.renderer;
  r.on("enterNode", ({ node, event }) => {
    if (S.G.getNodeAttribute(node, "kind") === "head") return;
    if (!S.pinned) setFocus(node);
    showTip(node, event.x, event.y);
  });
  r.on("leaveNode", () => { tip.hidden = true; if (!S.pinned) clearFocus(); });
  r.on("clickNode", ({ node }) => {
    const a = S.G.getNodeAttributes(node);
    if (a.kind === "head") return;
    if (a.sup && S.view === "map") { tip.hidden = true; toggleCluster(a.cluster); return; }
    S.pinned && S.focus === node ? clearFocus() : setFocus(node, true);
  });
  r.on("clickStage", clearFocus);
}

// Tooltip for a node, at viewport point (x, y) inside #graph. Also used for keyboard pins (find box), at the node.
function showTip(node, x, y) {
  const tip = $("tip"), a = S.G.getNodeAttributes(node);
  tip.innerHTML = "";
  const add = (tag, txt) => { const el = document.createElement(tag); el.textContent = txt; tip.appendChild(el); };
  const links = [];  // layer neighbours, e.g. "◆ Python (endorsed you for)"
  S.G.forEachEdge(node, (e, ea, s, t) => { if (ea.layer) { const o = s === node ? t : s; links.push(`${S.G.getNodeAttribute(o, "label")} (${ea.kind})`); } });
  const more = (xs, n) => xs.slice(0, n).join(", ") + (xs.length > n ? `, +${xs.length - n} more` : "");
  if (a.sup) { add("b", a.label); add("span", `${S.counts[a.cluster]} people` + (S.view === "map" ? ". Click to unfold." : ". Click to keep its links highlighted.")); }
  else if (a.kind !== "person") {
    add("b", a.p.label); add("span", KINDS[a.kind].one + (a.p.how ? ` · ${a.p.how}` : ""));
    if (a.p.date) add("span", fmtDate(a.p.date));
    if (a.p.text) add("span", a.p.text);
    const n = S.G.filterEdges(node, (e, ea) => !ea.agg).length;  // its own links, not the circle summaries
    add("span", `${n} link${n === 1 ? "" : "s"}` + (a.p.outside ? `, plus ${a.p.outside} endorsements from people outside your connections` : ""));
  } else { add("b", a.p.name); add("span", [a.p.title, a.p.company].filter(Boolean).join(" at ") || "No title or company");
    add("span", `Connected ${fmtDate(a.p.connected_on)}`); add("span", `Circle: ${S.labels[a.p.cluster]}`);
    if (a.follows) add("span", "You follow them");
    if (links.length) add("span", more(links, 4)); }
  if (x === undefined) {  // keyboard: next to the node itself, and announced to screen readers
    const d = S.renderer.getNodeDisplayData(node), v = d && S.renderer.framedGraphToViewport(d), off = $("canvas").offsetTop;
    x = v ? v.x : 0; y = v ? v.y + off : off;
    $("live").textContent = [...tip.children].map((el) => el.textContent).join(". ");
  }
  const box = $("graph").getBoundingClientRect();
  tip.hidden = false;
  tip.style.left = Math.max(4, Math.min(x + 12, box.width - tip.offsetWidth - 4)) + "px";
  tip.style.top = Math.max(4, Math.min(y + 12, box.height - tip.offsetHeight - 4)) + "px";
}

// ---------- find ----------
function buildFind() {
  const dl = $("findList"); dl.innerHTML = ""; S.byLabel = new Map();
  S.G.forEachNode((k, a) => {
    if (a.kind === "head" || a.sup || !a.label) return;
    const label = a.kind === "person" ? a.label : a.label.replace(/^\S+ /, "");  // drop the kind glyph
    if (S.byLabel.has(label)) return;
    S.byLabel.set(label, k); const o = document.createElement("option"); o.value = label; dl.appendChild(o);
  });
  $("find").value = "";
}
function find(q) { const k = S && S.byLabel.get(q.trim()); if (k) goTo(k); }
// Pin a node and bring it into view: unhide its kind, unfold its circle, zoom, show and announce its tooltip.
function goTo(k) {
  const a = S.G.getNodeAttributes(k);
  if (S.hiddenKinds.has(a.kind)) { S.hiddenKinds.delete(a.kind); buildKinds(); }
  if (a.orphan && S.view === "map") setView("layers");
  if (a.kind === "person" && S.collapsed.has(a.cluster)) toggleCluster(a.cluster);
  setFocus(k, true);
  const d = S.renderer.getNodeDisplayData(k);
  const done = () => S.focus === k && showTip(k);
  if (d) S.renderer.getCamera().animate({ x: d.x, y: d.y, ratio: 0.35 }, { duration: reduceMotion.matches ? 0 : 500 }).then(done);
  else done();
}

// ---------- who do I know at… ----------
// The job the persona research ranked first (research/findings.md): given companies or role words, list the people
// you are already connected to there, longest-known first, with their circle; highlight them and hand back a CSV.
// Only first-degree connections: LinkedIn's export has nobody else, and no locations.
const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const LEGAL = new Set("inc ltd llc llp plc gmbh ag sa sas sarl bv nv co corp corporation limited company".split(" "));
const coKey = (s) => norm(s).split(" ").filter((t) => t && !LEGAL.has(t)).join(" ");
// -> [{ q, rows: [{ k, n, by }] }]; a person is listed once, under the first query that matched them
function whoKnow(text) {
  const seen = new Set();
  return text.split(/[\n,;]+/).map((q) => q.trim()).filter(Boolean).map((q) => {
    const ck = coKey(q), words = norm(q).split(" ").filter(Boolean), rows = [];
    if (ck) for (const n of S.data.nodes) {
      const k = String(n.id), co = ` ${coKey(n.company)} `, ti = ` ${norm(n.title)}`;
      const by = co.includes(` ${ck} `) ? "company" : words.every((w) => ti.includes(` ${w}`)) ? "title" : null;  // title: word starts
      if (by && !seen.has(k)) { seen.add(k); rows.push({ k, n, by }); }
    }
    rows.sort((a, b) => (a.n.connected_on || "9") .localeCompare(b.n.connected_on || "9") || a.n.name.localeCompare(b.n.name));
    return { q, rows };
  });
}
function buildKnow() {
  const top = {};  // quick picks: the companies you know most people at
  S.data.nodes.forEach((n) => { if (n.company) top[n.company] = (top[n.company] || 0) + 1; });
  const picks = $("knowPicks"); picks.innerHTML = "";
  Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([c]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c;
    b.onclick = () => { const v = $("knowQ").value.trim(); $("knowQ").value = v ? `${v}, ${c}` : c; runKnow(); };
    picks.appendChild(b);
  });
  clearKnow();
}
function clearKnow() {
  S.sel = null; S.selCircles = null; S.knowRows = [];
  $("knowList").innerHTML = ""; $("knowSummary").textContent = ""; $("knowCsv").hidden = $("knowClear").hidden = true;
  S.renderer.refresh();
}
function runKnow() {
  if (!S) return;
  const groups = whoKnow($("knowQ").value), list = $("knowList"), all = groups.flatMap((g) => g.rows);
  clearFocus(); list.innerHTML = "";
  if (!groups.length) return clearKnow();
  S.knowRows = groups.flatMap((g) => g.rows.map((r) => ({ ...r, q: g.q })));
  S.sel = new Set(all.map((r) => r.k)); S.selCircles = new Set(all.map((r) => S.G.getNodeAttribute(r.k, "cluster")));
  for (const g of groups) {
    const h = document.createElement("li"); h.className = "kq";
    h.textContent = g.rows.length ? `${g.q}: ${g.rows.length} ${g.rows.length === 1 ? "person" : "people"}` : `${g.q}: nobody you're connected to`;
    list.appendChild(h);
    for (const r of g.rows.slice(0, 100)) {
      const li = document.createElement("li"), b = document.createElement("button"), n = r.n;
      b.type = "button"; b.className = "kp";
      const name = document.createElement("b"); name.textContent = n.name;
      const what = document.createElement("span"); what.textContent = [n.title, n.company].filter(Boolean).join(" at ");
      const how = document.createElement("span");
      how.textContent = `${S.labels[n.cluster]} · ${n.connected_on ? "connected " + fmtDate(n.connected_on) : "connection date unknown"}`;
      b.append(name, what, how);
      b.onclick = () => goTo(r.k);
      li.appendChild(b); list.appendChild(li);
    }
    if (g.rows.length > 100) { const m = document.createElement("li"); m.className = "kq"; m.textContent = `+${g.rows.length - 100} more in the CSV`; list.appendChild(m); }
  }
  const hit = groups.filter((g) => g.rows.length).length;
  $("knowSummary").textContent = all.length
    ? `${all.length} ${all.length === 1 ? "person" : "people"} for ${hit} of ${groups.length} ${groups.length === 1 ? "search" : "searches"}, longest-known first. They're highlighted on the map.`
    : "Nobody you're connected to matches. Only your own connections are in the export, so people you could reach through them can't be listed.";
  $("knowCsv").hidden = !all.length; $("knowClear").hidden = false;
  S.renderer.refresh();
}
function knowCsv() {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["search", "matched on", "name", "title", "company", "circle", "connected on"].map(esc).join(",")];
  for (const r of S.knowRows) lines.push([r.q, r.by, r.n.name, r.n.title, r.n.company, S.labels[r.n.cluster], r.n.connected_on || ""].map(esc).join(","));
  const a = document.createElement("a");  // built in this tab; nothing is sent anywhere
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = "who-i-know.csv"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("knowForm").addEventListener("submit", (e) => { e.preventDefault(); runKnow(); });
$("knowCsv").addEventListener("click", knowCsv);
$("knowClear").addEventListener("click", () => { $("knowQ").value = ""; clearKnow(); });

// ---------- side panel ----------
function buildLegend() {
  const ul = $("legend"); ul.innerHTML = "";
  for (const c of S.clusters) {
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button"; b.dataset.id = c.id; b.setAttribute("aria-pressed", "false");
    const coh = c.cohesion == null ? "" : ` · ${c.cohesion.toFixed(2)}`;
    b.innerHTML = `<span class="sw" style="background:${colorOf(c.id)}"></span><span class="lbl"></span><span class="num">${c.size}${coh}</span>`;
    b.querySelector(".lbl").textContent = labelOf(c);
    b.title = `${c.size} people` + (c.cohesion == null ? "" : `, cohesion ${c.cohesion} (share of link weight inside the circle)`) + ". Click to fold or unfold.";
    b.onclick = () => toggleCluster(c.id);
    b.onmouseenter = b.onfocus = () => highlight(c.id);  // shows a circle's members without relying on its colour
    b.onmouseleave = b.onblur = () => highlight(null);
    li.appendChild(b); ul.appendChild(li);
    if (c.members) {  // list what the grey "smaller groups" row holds
      const d = document.createElement("details"), ml = document.createElement("ul");
      d.innerHTML = "<summary>Show the smaller groups</summary>";
      c.members.forEach((x) => { const i = document.createElement("li"); i.textContent = `${labelOf(x)} (${x.size})`; ml.appendChild(i); });
      d.appendChild(ml); li.appendChild(d);
    }
  }
  ul.dataset.clusterCount = S.data.clusters.filter((c) => c.id >= 0).length;
}
function highlight(c) {
  if (!S || S.hl === c) return;
  S.hl = c; S.hlNear = new Set();  // layer nodes linked to the circle's members stay in colour
  if (c != null) S.G.forEachNode((k, a) => { if (a.kind === "person" && a.cluster === grp(c)) S.G.forEachNeighbor(k, (o, oa) => { if (oa.kind !== "person") S.hlNear.add(o); }); });
  S.renderer.refresh();
}
function recolorLegend() { document.querySelectorAll("#legend .sw").forEach((s) => { s.style.background = colorOf(+s.parentNode.dataset.id); }); }
function buildMeta() {
  const m = S.data.meta, n = m.n_people, un = Math.round(m.share_unplaced * n);
  const drawn = S.data.edges.filter((e) => e.w >= MIN_W).length;
  const w = Object.entries(m.weights || {}).map(([k, v]) => `${W_NAMES[k] || k} ${v}`).join(", ");
  const linked = Object.entries(m.weights || {}).filter(([, v]) => v > 0).map(([k]) => SHARED[k] || k).join(" or ");
  const small = S.clusters.find((c) => c.members);
  const lines = [
    `${n} people in ${m.n_clusters} circles, ${m.n_edges.toLocaleString()} links.` + (drawn < m.n_edges ? ` ${drawn.toLocaleString()} are drawn (weight ≥ ${MIN_W}); the layout uses all of them.` : ""),
    `${un} people (${(m.share_unplaced * 100).toFixed(1)}%) are unplaced: they share no ${linked} with anyone else here.`,
    `Link weights: ${w}.` + (/ 0(,|$)/.test(w) ? " A weight of 0 means the attribute is shown but does not link people." : ""),
    small ? `Only ${SMALL} colours stay distinguishable, so the ${small.members.length} smallest circles (${small.size} people) are grey and listed under "${small.label}".` : null,
    m.modularity == null ? null : `Modularity ${m.modularity}. Company groups separate easily, so a high value is expected and is not proof the circles are right.`,
    "Cohesion is the share of a circle's link weight that stays inside it.",
    "The export has no links between your connections. Circles are inferred from shared employers and timing.",
    layerNote(S.data.layers),
  ];
  $("meta").innerHTML = ""; lines.filter(Boolean).forEach((t) => { const li = document.createElement("li"); li.textContent = t; $("meta").appendChild(li); });
}

function layerNote(L) {
  if (!L || !L.nodes.length) return null;
  const c = L.counts, out = L.nodes.reduce((t, n) => t + (n.outside || 0), 0);
  return "Layers are only about you: LinkedIn shares your skills, groups and posts, not your connections'. Layer nodes not tied to any connection appear only in the Layers view. " +
    "Skills link to the people who endorsed them" + (out ? ` (${out} more endorsements came from outside your connections)` : "") +
    "; organisations to people working there now; events to people you connected with in the week after." +
    (c.reactions ? ` ${c.reactions} reactions are counted, not drawn: the data doesn't say whose posts they were on.` : "") +
    " Followers are not available from LinkedIn at all.";
}

// ---------- timeline ----------
function setupTimeline() {
  const sl = $("month");
  document.querySelector(".timeline").hidden = !S.hasDates;  // no connection dates: no timeline
  sl.disabled = !S.hasDates; applyMotionPref();
  sl.min = 0; sl.max = S.m1 - S.m0; sl.value = sl.max;
  $("first").textContent = monthName(S.m0); $("last").textContent = monthName(S.m1);
  setMonth(S.m1);
}
function setMonth(m) {
  if (!S) return;
  S.cur = m; $("month").value = m - S.m0;
  recount();
  const shown = S.data.nodes.filter((n) => monthOf(n.connected_on) <= m).length, added = S.perMonth[m - S.m0] || 0;
  $("now").innerHTML = `<b>${monthName(m)}</b> · ${shown} people (+${added})`;
  $("month").setAttribute("aria-valuetext", `${monthName(m)}, ${shown} people, ${added} added that month`);
  drawSpark(); S.renderer.refresh();
}
function drawSpark() {
  const svg = $("spark"), W = svg.clientWidth || 300, H = 32, n = S.perMonth.length, max = Math.max(1, ...S.perMonth);
  const bw = W / n, gap = bw > 3 ? 1 : 0;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = S.perMonth.map((c, i) => {
    if (!c) return "";
    const h = Math.max(2, (c / max) * (H - 2)), m = S.m0 + i, cls = m === S.cur ? "cur" : m < S.cur ? "on" : "";
    return `<rect class="${cls}" x="${(i * bw).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${Math.max(1, bw - gap).toFixed(2)}" height="${h.toFixed(2)}" rx="1"><title>${monthName(m)}: ${c}</title></rect>`;
  }).join("");
}
function stopPlay(st = S) { if (st && st.playing) { cancelAnimationFrame(st.playing); st.playing = null; } $("play").textContent = "Play"; }
function play() {
  if (!S || !S.hasDates) return;
  if (S.playing) return stopPlay();
  if (reduceMotion.matches) return;
  const span = S.m1 - S.m0, start = S.cur >= S.m1 ? S.m0 : S.cur, t0 = performance.now() - ((start - S.m0) / (span || 1)) * PLAY_MS;
  $("play").textContent = "Pause";
  const step = (t) => {
    const m = S.m0 + Math.min(span, Math.floor(((t - t0) / PLAY_MS) * (span + 1)));
    if (m !== S.cur) setMonth(m);
    if (m >= S.m1) return stopPlay();
    S.playing = requestAnimationFrame(step);
  };
  S.playing = requestAnimationFrame(step);
}
function applyMotionPref() { $("play").disabled = reduceMotion.matches || !S || !S.hasDates; $("motionNote").hidden = !reduceMotion.matches; if (reduceMotion.matches) stopPlay(); }

// ---------- drop your own export (Pyodide, in this tab) ----------
let pyReady = null;
function getPyodide() {
  if (!pyReady) pyReady = new Promise((ok, fail) => {
    const s = document.createElement("script"); s.src = PYODIDE + "pyodide.js";
    s.onload = () => loadPyodide({ indexURL: PYODIDE }).then(ok, fail);
    s.onerror = () => fail(new Error("Could not download the Python runtime from cdn.jsdelivr.net."));
    document.head.appendChild(s);
  }).then(async (py) => {
    status("Loading pandas and igraph…");
    await py.loadPackage(["pandas", "igraph"]);
    const res = await fetch("../src/netmap.py", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load netmap.py (${res.status}). Serve the repo root so ../src/netmap.py is reachable.`);
    py.FS.writeFile("/home/pyodide/netmap.py", await res.text());
    return py;
  });
  pyReady.catch(() => { pyReady = null; });  // never cache a failed load
  return pyReady;
}
const tick = () => new Promise((r) => setTimeout(r, 30));
let busy = false;
async function runFiles(files) {
  if (busy || window.DEMO_GRAPH) return;  // one run at a time; later drops/picks are ignored until it finishes
  const all = [...files], csv = all.filter((f) => /\.csv$/i.test(f.name));
  if (all.some((f) => /\.zip$/i.test(f.name)) && !csv.length) return status("Zip files are not read. Unzip the export and drop the CSV files.", true);
  if (!csv.some((f) => /^connections\.csv$/i.test(f.name))) return status("Connections.csv is required. Drop it with the other CSV files from the export.", true);
  busy = true; $("pick").disabled = true;
  try {
    stopPlay();
    const texts = await Promise.all(csv.map((f) => f.text()));  // read everything before touching /in
    status("Downloading the Python runtime from the CDN (about 10 MB, first time only)…");
    const py = await getPyodide();
    status(`Reading ${csv.length} file${csv.length > 1 ? "s" : ""} in this tab…`);
    py.FS.mkdirTree("/in");
    for (const f of py.FS.readdir("/in")) if (f !== "." && f !== "..") py.FS.unlink("/in/" + f);
    csv.forEach((f, i) => py.FS.writeFile("/in/" + (EXPORT_NAMES.find((n) => n.toLowerCase() === f.name.toLowerCase()) || f.name), texts[i]));
    status("Finding circles…"); await tick();
    const out = py.runPython("import sys, json\nsys.path.insert(0, '/home/pyodide')\nimport netmap\njson.dumps(netmap.run('/in'))");
    status("Drawing…"); await tick();
    const data = JSON.parse(out);
    render(data, `Your export: ${data.meta.n_people} people, processed in this tab`);
    if ($("knowQ").value.trim()) runKnow();  // a search carried over from the showcase page (?know=) runs on your data
    status(`Done. ${data.meta.n_clusters} circles from ${csv.map((f) => f.name).join(", ")}. Nothing was uploaded.`);
  } catch (e) { console.error(e); status("Could not process the files: " + (e.message || e).toString().split("\n").slice(-2).join(" "), true); }
  finally { busy = false; $("pick").disabled = false; }
}

// ---------- wiring ----------
$("month").addEventListener("input", (e) => { if (!S) return; stopPlay(); setMonth(S.m0 + +e.target.value); });
$("play").addEventListener("click", play);
$("vMap").addEventListener("click", () => setView("map"));
$("vLayers").addEventListener("click", () => setView("layers"));
$("find").addEventListener("change", (e) => find(e.target.value));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S && S.focus && !$("how").open) { clearFocus(); $("tip").hidden = true; $("live").textContent = ""; } });
$("find").addEventListener("keydown", (e) => { if (e.key === "Enter") find(e.target.value); if (e.key === "Escape") { e.target.value = ""; clearFocus(); } });
$("howBtn").addEventListener("click", () => $("how").showModal());
// Visitors arriving from the showcase page (?know= or ?own=) have already read how it works.
const fromShowcase = /[?&](know|own)=/.test(location.search);
try { if (!fromShowcase && !localStorage.getItem("nc.seenHow")) { localStorage.setItem("nc.seenHow", "1"); $("how").showModal(); } } catch (e) { /* storage blocked: skip */ }
$("pick").addEventListener("click", () => $("files").click());
$("files").addEventListener("change", (e) => { if (e.target.files.length) runFiles(e.target.files); e.target.value = ""; });
// the whole page is the drop target; the banner highlights while files hover
const dz = $("drop");
window.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) dz.classList.remove("over"); });
window.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files.length) runFiles(e.dataTransfer.files); });
window.addEventListener("resize", () => S && drawSpark());
reduceMotion.addEventListener("change", applyMotionPref);
// ---------- measurement (tests/layout_test.py) ----------
// Proper crossings between straight segments [x1, y1, x2, y2, endA, endB]; segments sharing an end never count.
// ponytail: O(E²) pair scan; fine to a few thousand drawn edges, sweep-line if Layers ever draws more.
function crossings(segs) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const [a, b] = [segs[i], segs[j]];
    if (a[4] === b[4] || a[4] === b[5] || a[5] === b[4] || a[5] === b[5]) continue;
    if (o(a[0], a[1], a[2], a[3], b[0], b[1]) * o(a[0], a[1], a[2], a[3], b[2], b[3]) < 0 &&
        o(b[0], b[1], b[2], b[3], a[0], a[1]) * o(b[0], b[1], b[2], b[3], a[2], a[3]) < 0) n++;
  }
  return n;
}
// What is on screen right now: label boxes as drawn, drawn-edge crossings, and the graph-to-screen scale.
window.__measure = () => {
  const R = S.renderer, segs = [];
  S.G.forEachEdge((e, a, s, t) => {
    const d = R.getEdgeDisplayData(e);
    if (!d || d.hidden) return;
    const p = R.graphToViewport(S.G.getNodeAttributes(s)), q = R.graphToViewport(S.G.getNodeAttributes(t));
    segs.push([p.x, p.y, q.x, q.y, s, t]);
  });
  const g = (k) => S.G.getNodeAttributes(k), a = g("pad:l"), b = g("pad:r");
  const scale = a && b && b.x !== a.x ? (R.graphToViewport(b).x - R.graphToViewport(a).x) / (b.x - a.x) : null;
  return { view: S.view, layout: S.layoutStats, boxes: [...S.boxes.values()], edges: segs.length, scale,
           crossings: S.view === "layers" ? crossings(segs) : null,  // only meaningful (and affordable) in Layers
           width: S.box.clientWidth, height: S.box.clientHeight };
};

const retheme = () => { if (!S) return; readTokens(); S.edgeColor = T["--edge"]; S.renderer.setSetting("labelColor", { color: T["--ink"] }); recolorLegend(); S.renderer.refresh(); };
darkMQ.addEventListener("change", retheme);
new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
applyMotionPref();

(async () => {
  // Static demo build (src/build_demo.py) embeds the synthetic graph; there is no drop mode there.
  if (window.DEMO_GRAPH) {
    render(window.DEMO_GRAPH, `Synthetic demo: ${window.DEMO_GRAPH.meta.n_people} fictional people`);
    const know = new URLSearchParams(location.search).get("know");
    if (know) { $("knowQ").value = know; runKnow(); }
    return;
  }
  const qs = new URLSearchParams(location.search);
  if (qs.get("know")) $("knowQ").value = qs.get("know");
  // ?own=1 (from the showcase page's "open my files" step): wait for the visitor's files instead of showing the demo
  if (qs.get("own") === "1") {
    $("source").textContent = "Waiting for your files";
    $("empty").textContent = "Click Open your LinkedIn files above and select the CSV files from the folder you unzipped (at least Connections.csv). They're read in this tab and never uploaded." + (qs.get("know") ? " Your search will run as soon as they're read." : "");
    $("pick").focus();
    return;
  }
  const p = qs.get("data") || "../demo/graph.json";
  const url = new URL(p, location.href);
  const fail = (msg) => { $("source").textContent = "Not loaded"; $("empty").textContent = msg; };
  if (url.origin !== location.origin) return fail("Only graph.json files served next to this page can be loaded. Open your export instead.");
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    render(data, p === "../demo/graph.json" ? `Synthetic demo: ${data.meta.n_people} fictional people` : `Loaded ${url.pathname}`);
    if (qs.get("know")) runKnow();  // ?know=Halcyon Freight,recruiter (showcase page links)
    // recording hook: ?autoplay=1 plays the timeline once after layout (skipped under reduced motion)
    if (new URLSearchParams(location.search).get("autoplay") === "1" && !reduceMotion.matches && S.hasDates) { setMonth(S.m0); play(); }
  } catch (e) { console.error(e); fail(`Could not load ${p} (${e.message}). Serve the repo root with python3 -m http.server, or open your export.`); }
})();
