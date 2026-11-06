// Network Circles viewer. Plain script, no build. Globals from vendor/: graphology, graphologyLibrary, Sigma.
"use strict";
const $ = (id) => document.getElementById(id);
// dataviz reference categorical palette, fixed order; light and dark steps. Past 8 and "not in a circle" -> grey.
// Light green, yellow and pink are darkened to reach 3:1 against the surface (tests/palette_check.py).
const PAL = { light: ["#2a78d6", "#eb6834", "#19a573", "#c48400", "#d77198", "#008300", "#6250d6", "#e34948"],
              dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"] };
const SMALL = PAL.light.length;  // clusters past the palette fold into one "Smaller groups" entry (grey)
const grp = (c) => (c < 0 ? -1 : Math.min(c, SMALL));
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
const LABELLED = new Set(["skill", "org", "group", "event", "topic", "you"]);  // always labelled in Layers: few, and they name the layer
// Map: each circle is a disc of dots on a sunflower spiral (dot i at radius STEP·√i), so dots never overlap; discs are
// packed edge to edge. Dot radius = DOT_K·STEP at the fitted scale, under half the spiral's closest spacing (~1.5·STEP).
// Zooming in grows dots with √zoom but gaps with zoom, and zooming out past the fit is blocked: nodes can't overlap.
const STEP = 4, DOT_K = 0.42, GAP = 6, BAND = 14;
const MAX_LABELLED = 20;    // a pin or a search never names more people than this on the map
const VIEWS = ["list", "map", "circles"];

let S = null;               // current view state
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkMQ = matchMedia("(prefers-color-scheme: dark)");

const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : darkMQ.matches; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const T = {};               // theme tokens the canvas needs, re-read on theme change
const readTokens = () => ["--ink", "--ink-2", "--edge", "--small", "--unplaced", "--layer", "--layer-edge", "--surface", "--accent", "--dim", "--edge-focus", "--muted", "--line"]
  .forEach((v) => { T[v] = css(v); });
const colorOf = (g) => (g < 0 ? T["--unplaced"] : g >= SMALL ? T["--small"] : PAL[isDark() ? "dark" : "light"][g]);
// A circle's colour washed towards the surface: what everyone outside a search or pin is drawn in, so circles stay
// recognisable instead of all turning the same grey.
function mix(a, b, t) { const p = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, "0")).join(""); }
const fadeOf = (g) => mix(colorOf(g), T["--surface"], isDark() ? 0.4 : 0.55);  // dark surfaces swallow faint dots sooner
const monthOf = (d) => (d ? +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1) : -Infinity);
const monthName = (m) => `${MON[m % 12]} ${Math.floor(m / 12)}`;
const fmtDate = (d) => (d ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : "unknown date");
function prng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const labelOf = (c) => (c.id < 0 ? "Not in a circle" : c.label || `Circle ${c.id}`);  // one display label everywhere
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
function status(msg, err) { $("status").textContent = msg; $("status").className = err ? "err" : ""; }
// A/B hook: every event worth comparing between the three layouts goes through here. Nothing is sent anywhere today;
// wiring the anonymous counter from research/fake-door.md is one line (goatcounter.count) and the author's decision.
function track(name) { void name; }

// ---------- packed circles ----------
// Discs, biggest first, "not in a circle" last; each goes where it touches one or two placed discs, as close to the
// centre as it can without overlapping. ponytail: O(discs³) candidate scan; fine to a few hundred circles.
function pack(byCluster) {
  const discs = [...byCluster.entries()].map(([c, ps]) => ({ c, ps, n: ps.length, r: STEP * Math.sqrt(ps.length),
    R: STEP * Math.sqrt(ps.length) + (ps.length >= 4 ? BAND : GAP) })).sort((a, b) => (a.c < 0) - (b.c < 0) || b.n - a.n || a.c - b.c);
  const placed = [], free = (x, y, R) => placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.R + R + GAP - 1e-6);
  for (const d of discs) {
    const cand = placed.length ? [] : [[0, 0]];
    for (const a of placed) {
      for (let k = 0; k < 24; k++) { const t = (k / 24) * 2 * Math.PI, r = a.R + d.R + GAP; cand.push([a.x + r * Math.cos(t), a.y + r * Math.sin(t)]); }
      for (const b of placed) if (a !== b) {
        const ra = a.R + d.R + GAP, rb = b.R + d.R + GAP, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
        if (L > ra + rb || L < Math.abs(ra - rb)) continue;
        const u = (ra * ra - rb * rb + L * L) / (2 * L), h = Math.sqrt(Math.max(0, ra * ra - u * u)), mx = a.x + (u * dx) / L, my = a.y + (u * dy) / L;
        cand.push([mx - (h * dy) / L, my + (h * dx) / L], [mx + (h * dy) / L, my - (h * dx) / L]);
      }
    }
    const [x, y] = cand.filter(([x, y]) => free(x, y, d.R)).sort((p, q) => Math.hypot(...p) - Math.hypot(...q))[0];
    Object.assign(d, { x, y }); placed.push(d);
  }
  // centre the packing on (0, 0) so the ring of layer nodes around it wastes as little of the canvas as possible
  const cx = (Math.min(...discs.map((d) => d.x - d.R)) + Math.max(...discs.map((d) => d.x + d.R))) / 2;
  const cy = (Math.min(...discs.map((d) => d.y - d.R)) + Math.max(...discs.map((d) => d.y + d.R))) / 2;
  for (const d of discs) {
    d.x -= cx; d.y -= cy;
    d.ps.forEach((k, i) => { const a = i * 2.39996, r = STEP * Math.sqrt(i + 0.5); k.x = d.x + r * Math.cos(a); k.y = d.y + r * Math.sin(a); });
  }
  return discs;
}

// ---------- build graph + layout ----------
// Builds the new state and renderer first; the old view is only torn down once that succeeded (callers show errors).
function render(data) {
  readTokens();
  const G = new graphology.Graph({ type: "undirected" });
  const all = data.clusters.slice().sort((a, b) => (a.id < 0) - (b.id < 0) || a.id - b.id);
  const small = all.filter((c) => c.id >= SMALL);
  const clusters = all.filter((c) => c.id >= 0 && c.id < SMALL);  // legend groups: palette clusters, smaller groups, not in a circle
  if (small.length) clusters.push({ id: SMALL, size: small.reduce((t, c) => t + c.size, 0), cohesion: null,
    label: `${small.length} smaller groups`, members: small });
  clusters.push(...all.filter((c) => c.id < 0));
  const rnd = prng(42), byCluster = new Map();
  for (const n of data.nodes) {  // members of a disc in the order you connected, so the oldest sit at its centre
    if (!byCluster.has(n.cluster)) byCluster.set(n.cluster, []);
    byCluster.get(n.cluster).push(n);
  }
  byCluster.forEach((ps) => ps.sort((a, b) => (a.connected_on || "9").localeCompare(b.connected_on || "9") || a.id - b.id));
  const pos = new Map();
  byCluster.forEach((ps, c) => byCluster.set(c, ps.map((n) => { const o = { id: n.id }; pos.set(n.id, o); return o; })));
  const discs = pack(byCluster);
  // The Map's camera fits the dots plus a margin; layer nodes sit on a frame inside that margin, beyond every dot.
  const ext = [Math.min(...discs.map((d) => d.x - d.r)), Math.max(...discs.map((d) => d.x + d.r)), Math.min(...discs.map((d) => d.y - d.r)), Math.max(...discs.map((d) => d.y + d.r))];
  const frame = [ext[0] - 12, ext[1] + 12, ext[2] - 12, ext[3] + 12], mapBBox = { x: [ext[0] - 22, ext[1] + 22], y: [ext[2] - 22, ext[3] + 22] };
  for (const n of data.nodes) {
    const p = pos.get(n.id);
    G.addNode(String(n.id), { x: p.x, y: p.y, label: n.name, size: 3, cluster: grp(n.cluster), m: monthOf(n.connected_on), p: n, kind: "person" });
  }
  for (const e of data.edges) G.addEdge(String(e.s), String(e.t), { weight: e.w, size: e.w >= 1 ? 1 : 0.5 });
  const kindCount = addLayers(G, data.layers, rnd, frame);

  // one hidden super-node per legend group at its members' centroid (the Layers view folds circles into these)
  for (const c of clusters) {
    if (G.someNode((k, a) => a.cluster === c.id)) G.addNode("c" + c.id, { x: 0, y: 0, sup: true, cluster: c.id, label: labelOf(c), size: 6, months: [] });
  }
  placeSupers(G);
  G.forEachNode((k, a) => { if (a.kind === "person") G.getNodeAttribute("c" + a.cluster, "months").push(a.m); });
  const mapPos = {};
  G.forEachNode((k, a) => { mapPos[k] = [a.x, a.y]; });

  const months = data.nodes.map((n) => monthOf(n.connected_on)).filter(isFinite);
  const m0 = months.length ? Math.min(...months) : 0, m1 = months.length ? Math.max(...months) : 0;
  const perMonth = new Array(m1 - m0 + 1).fill(0);
  months.forEach((m) => perMonth[m - m0]++);
  const next = { data, G, clusters, discs, collapsed: new Set(), m0, m1, cur: m1, perMonth, counts: {}, playing: null, edgeColor: T["--edge"],
    hasDates: months.length > 0, box: null, mapBBox, discOf: new Map(discs.map((d) => [d.c, d])), labels: Object.fromEntries(all.map((c) => [c.id, labelOf(c)])), dot: 3,
    kindCount, hiddenKinds: new Set(), view: "map", mapPos, layerPos: null, boxes: new Map(), queue: [], hl: null, sel: null, selCircles: null,
    knowRows: [], focus: null, near: null, nearLabel: null, pinned: false, listed: null };
  const box = (next.box = $("canvas").appendChild(document.createElement("div"))), old = S;
  next.bg = box.appendChild(document.createElement("canvas"));  // disc outlines and result rings, under sigma's canvases
  next.bg.setAttribute("aria-hidden", "true"); next.bg.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  try {
    S = next;  // reducers read S while sigma does its first render
    next.renderer = new Sigma.Sigma(G, box, {
      nodeReducer, edgeReducer, zIndex: true, labelRenderedSizeThreshold: 10, labelDensity: 0.6, labelFont: css("--sans"), labelSize: 12,
      labelColor: { color: T["--ink"] }, defaultEdgeColor: T["--edge"], defaultDrawNodeLabel: drawLabel, defaultDrawNodeHover: drawHover,
      maxCameraRatio: 1, minCameraRatio: 0.08, allowInvalidContainer: true,  // no zooming out past the fit; the map may start hidden (Circles)
    });
    next.renderer.on("beforeRender", () => { next.boxes.clear(); next.queue = []; });  // label boxes of this frame (tests read them)
    next.renderer.on("afterRender", () => { drawBg(); flushLabels(); });
  } catch (e) { S = old; box.remove(); throw e; }
  if (old) { stopPlay(old); old.renderer.kill(); old.box.remove(); old.ro && old.ro.disconnect(); }
  S.ro = new ResizeObserver(() => { if (!S.box.clientWidth) return; S.renderer.resize(); sizeDots(); S.renderer.refresh(); });
  S.ro.observe(S.box);
  S.renderer.setCustomBBox(mapBBox);
  $("tip").hidden = true;
  wireHover();
  $("empty").hidden = true;
  buildLegend(); buildKinds(); buildMeta(); setupTimeline(); buildKnow();
  ["vMap", "vLayers"].forEach((id) => $(id).setAttribute("aria-pressed", String(id === "vMap")));
  sizeDots(); S.renderer.refresh();
  window.__netmap = S;  // for tests / recording
}
// Graph units -> screen pixels at the current camera, and the dot radius that keeps the fitted map overlap-free.
function pxPerUnit() { const R = S.renderer, p = R.graphToViewport({ x: 0, y: 0 }), q = R.graphToViewport({ x: 100, y: 0 }); return Math.hypot(q.x - p.x, q.y - p.y) / 100; }
function sizeDots() { if (S.view === "map" && S.box.clientWidth) S.dot = Math.max(1, Math.min(7, DOT_K * STEP * pxPerUnit() * S.renderer.getCamera().ratio)); }

// ---------- layers: skills, orgs, events, groups, posts, topics, follows ----------
// In the Map, layer nodes sit on a frame just outside the outermost dots, in the direction of the people they link to,
// and only show for the person or item you point at. Unlinked nodes become orphans: left out of the Map, shown in their column in Layers.
function addLayers(G, L, rnd, frame) {
  const count = { person: G.order };
  if (!L || !L.nodes.length) return count;
  (L.followed || []).forEach((id) => G.hasNode(String(id)) && G.setNodeAttribute(String(id), "follows", true));
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
  for (let pass = 0; pass < 6 && todo.length; pass++) {  // centroid of already-placed neighbours, outward from the people
    const now = [];
    todo = todo.filter((k) => {
      let x = 0, y = 0, c = 0;
      G.forEachNeighbor(k, (nb, a) => { if (placed.has(nb)) { x += a.x; y += a.y; c++; } });
      if (!c) return true;
      G.mergeNodeAttributes(k, { x: x / c + 1e-3 * rnd(), y: y / c }); now.push(k); return false;
    });
    now.forEach((k) => placed.add(k));
  }
  todo.forEach((k) => G.mergeNodeAttributes(k, { orphan: true }));
  // onto the frame: keep each node's direction, push neighbours apart so no two share a spot, then go out along that
  // direction until the frame (a rectangle around all the dots)
  const ring = Math.min(frame[1], -frame[0], frame[3], -frame[2]);
  const onRing = L.nodes.filter((n) => G.hasNode(n.id) && !G.getNodeAttribute(n.id, "orphan"))
    .map((n) => [Math.atan2(G.getNodeAttribute(n.id, "y"), G.getNodeAttribute(n.id, "x")), n.id]).sort((a, b) => a[0] - b[0]);
  const gap = Math.min(16 / ring, (2 * Math.PI) / Math.max(1, onRing.length));
  onRing.forEach((v, i) => { if (i) v[0] = Math.max(v[0], onRing[i - 1][0] + gap); });
  if (onRing.length > 1 && onRing[onRing.length - 1][0] > onRing[0][0] + 2 * Math.PI - gap)  // wrapped round: space them evenly
    onRing.forEach((v, i) => { v[0] = onRing[0][0] + i * gap; });
  onRing.forEach(([a, k]) => { const cx = Math.cos(a), cy = Math.sin(a);
    const t = Math.min(cx > 0 ? frame[1] / cx : cx < 0 ? frame[0] / cx : Infinity, cy > 0 ? frame[3] / cy : cy < 0 ? frame[2] / cy : Infinity);
    G.mergeNodeAttributes(k, { x: t * cx, y: t * cy }); });
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
  // Layers shows circles, not 300 people in a thin bar: fold them all. The Map never folds.
  S.collapsed = v === "layers" ? new Set(S.clusters.map((c) => c.id)) : new Set();
  rebuildAgg();
  S.G.forEachNode((k) => { if (pos[k]) S.G.mergeNodeAttributes(k, { x: pos[k][0], y: pos[k][1] }); });
  ["vMap", "vLayers"].forEach((id) => $(id).setAttribute("aria-pressed", String((id === "vLayers") === (v === "layers"))));
  $("mapCap").textContent = v === "layers" ? "Your circles in the middle, what links to them either side." : "One disc per circle. Your results in full colour.";
  // Layers is laid out in pixels: keep node sizes fixed when zooming (the map grows them with √zoom, sigma's default)
  S.renderer.setSetting("zoomToSizeRatioFunction", v === "layers" ? () => 1 : Math.sqrt);
  S.renderer.setCustomBBox(v === "layers" ? null : S.mapBBox);
  S.renderer.refresh(); sizeDots(); buildKinds();
  const cam = S.renderer.getCamera(), duration = reduceMotion.matches ? 0 : 400;
  if (v === "layers" && S.layersFit < 1)  // too wide to read when fitted: 1:1 zoom centred on the circles
    cam.animate({ x: S.renderer.getNodeDisplayData("h:person").x, y: 0.5, ratio: S.layersFit }, { duration });
  else cam.animatedReset({ duration });
}
function buildKinds() {
  const ul = $("kinds"), present = Object.keys(KINDS).filter((k) => S.kindCount[k] && k !== "you");
  $("viewSwitch").hidden = present.length < 2; $("layersCard").hidden = present.length < 2 || S.view !== "layers";
  ul.innerHTML = "";
  for (const k of present) {
    const li = document.createElement("li"), lab = document.createElement("label"), cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !S.hiddenKinds.has(k);
    cb.onchange = () => { cb.checked ? S.hiddenKinds.delete(k) : S.hiddenKinds.add(k); S.renderer.refresh(); };
    lab.append(cb, ` ${KINDS[k].g} ${KINDS[k].name} `);
    const n = document.createElement("span"), ln = (S.kindCount.linked || {})[k];
    n.className = "num"; n.textContent = k === "person" || ln === S.kindCount[k] ? S.kindCount[k] : `${ln || 0} of ${S.kindCount[k]} linked`;
    if (k !== "person") n.title = "Linked = tied to at least one of your connections.";
    lab.append(n);
    li.appendChild(lab); ul.appendChild(li);
  }
}

// ---------- visibility (timeline + folds + layer toggles) ----------
// Month the view shows up to. At the end of the timeline, or with no connection dates (no timeline), everything shows,
// including layer items dated after the last connection.
const upTo = () => (!S.hasDates || S.cur >= S.m1 ? Infinity : S.cur);
function visible(k) {
  const a = S.G.getNodeAttributes(k);
  if (a.kind === "head") return S.view === "layers" && !S.hiddenKinds.has(a.of);
  if (a.sup) return S.collapsed.has(a.cluster) && S.counts[a.cluster] > 0 && !S.hiddenKinds.has("person");
  if (S.hiddenKinds.has(a.kind)) return false;
  // Map: a skill, organisation or event only shows, on the outer ring, for the person or item you point at
  if (a.kind !== "person") return a.m <= upTo() && (S.view === "layers" || (!a.orphan && (k === S.focus || !!(S.near && S.near.has(k)))));
  return !S.collapsed.has(a.cluster) && a.m <= upTo();
}
function nodeReducer(k, a) {
  const r = { ...a, color: a.kind === "person" || a.sup ? colorOf(a.cluster) : T["--layer"] };
  if (!visible(k)) { r.hidden = true; return r; }
  if (a.kind === "head") { r.color = T["--surface"]; r.forceLabel = true; r.zIndex = 3; r.size = 0.1; return r; }
  if (r.label && r.label.length > 26) r.label = r.label.slice(0, 25) + "…";
  return S.view === "map" ? mapNode(k, a, r) : layersNode(k, a, r);
}
// Map: everyone keeps their circle's colour; what isn't searched for, pinned or picked is washed out, not greyed, so
// you can still see which circle is which. Sizes are fixed by sizeDots so dots never touch.
function mapNode(k, a, r) {
  const person = a.kind === "person";
  r.size = person ? S.dot : S.dot * 1.4;
  if (!person) { r.forceLabel = true; r.zIndex = 2; r.labelLeft = a.x < 0; }  // ring labels point outwards
  // what stays in full colour: the pin and its links, else the circle you point at in the list, else the search results
  const on = S.focus ? k === S.focus || S.near.has(k) : S.hl != null ? a.cluster === grp(S.hl) : S.sel ? S.sel.has(k) : true;
  if (!person) return r;
  if (!on) { r.color = fadeOf(a.cluster); r.label = null; r.zIndex = 0; return r; }
  const named = S.focus ? S.nearLabel : S.hl != null ? null : S.sel ? S.selLabel : null;
  if (named) { r.forceLabel = named.has(k); r.zIndex = 1; }
  if (k === S.focus) { r.size = S.dot * 1.5; r.zIndex = 3; r.forceLabel = true; }
  else if (S.sel && S.sel.has(k) && S.hl == null) r.size = S.dot * 1.3;
  return r;
}
function layersNode(k, a, r) {
  if (a.sup) { const n = S.counts[a.cluster]; r.size = Math.min(4 + 2.2 * Math.sqrt(n), S.rowGap / 2 - 1); r.label = `${a.label} (${n})`; r.forceLabel = true; r.zIndex = 1; }
  // label the named layers unless a column is too dense to read (then hover reveals them)
  const col = a.sup ? KINDS.person.col : (KINDS[a.kind] || {}).col;
  r.labelLeft = col <= KINDS.person.col;
  if (LABELLED.has(a.kind) && !S.denseCols.has(col)) r.forceLabel = true;
  if (r.label && r.label.length > S.labelMax) r.label = r.label.slice(0, S.labelMax - 1) + "…";
  const dim = () => { r.color = T["--dim"]; r.label = null; r.forceLabel = false; r.zIndex = 0; };
  if (S.focus) { if (k === S.focus || S.near.has(k)) { r.forceLabel = true; r.zIndex = k === S.focus ? 3 : 2; if (k === S.focus) r.highlighted = true; } else dim(); }
  else if (S.hl != null && (a.sup ? a.cluster !== grp(S.hl) : !S.hlNear.has(k))) dim();
  else if (S.sel && !(a.sup ? S.selCircles.has(a.cluster) : S.sel.has(k))) dim();
  return r;
}
function edgeReducer(k, a) {
  const [s, t] = S.G.extremities(k);
  if (a.dead || !visible(s) || !visible(t) || (a.agg && a.m > upTo())) return { ...a, hidden: true };
  if (S.view === "map") {  // only the pointed-at node's own links into the layers; ties between people are the discs
    if (!S.focus || !a.layer || (s !== S.focus && t !== S.focus)) return { ...a, hidden: true };
    return { ...a, color: T["--edge-focus"], size: 1, zIndex: 1 };
  }
  if (S.focus) {  // only the focused node's own links
    if (s !== S.focus && t !== S.focus) return { ...a, hidden: true };
    return { ...a, color: T["--edge-focus"], size: Math.max(a.size, 1), zIndex: 1 };
  }
  if (S.hl != null && S.G.getNodeAttribute(s, "cluster") !== grp(S.hl) && S.G.getNodeAttribute(t, "cluster") !== grp(S.hl)) return { ...a, hidden: true };
  if (S.sel) {  // a search: only links that touch a circle holding a result
    const inSel = (x) => S.sel.has(x) || (S.G.getNodeAttribute(x, "sup") && S.selCircles.has(S.G.getNodeAttribute(x, "cluster")));
    if (!inSel(s) && !inSel(t)) return { ...a, hidden: true };
  }
  if (!a.layer) return { ...a, hidden: true };  // Layers: links into the layers, never person-person
  return { ...a, color: T["--layer-edge"] };
}

// ---------- labels ----------
// Greedy placement: sigma hands labels over during the frame (drawLabel queues them); after the frame they are drawn
// by priority and a label that would overlap one already drawn is skipped. In the Map a label may also not cover any
// dot but its own: a person whose name doesn't fit beside their dot gets a callout just outside their circle's dots,
// with a thin leader line. Circle names go above their dots. At most MAX_LABELLED people are named at once.
const LABEL_RANK = (d) => (d.key === S.focus ? 0 : d.kind === "head" ? 1 : d.sup ? 2 : d.kind !== "person" ? 3 : 4);
function drawLabel(ctx, d, st) { if (d.label) S.queue.push([ctx, d, st]); }
function drawHover(ctx, d, st) { if (d.label && S.view === "layers") paintLabel(ctx, d, st, true); }
function flushLabels() {
  const R = S.renderer, st = R.getSettings(), ctx = R.getCanvases().labels.getContext("2d");
  S.grid = S.view === "map" ? nodeGrid() : null;
  const q = S.queue.map((v, i) => [LABEL_RANK(v[1]), i, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  S.queue = [];
  let people = 0;
  if (S.view === "map") {
    const d = S.focus && R.getNodeDisplayData(S.focus);
    if (d && !d.hidden && d.label) { const v = R.framedGraphToViewport(d);
      if (paintLabel(ctx, { ...d, key: S.focus, x: v.x, y: v.y, size: R.scaleSize(d.size) }, st, false) && d.kind === "person") people++; }
    circleNames(ctx, st);
  }
  for (const [, , [c, d, s]] of q) {
    if (S.boxes.has(d.key) || (S.view === "map" && d.kind === "person" && people >= MAX_LABELLED)) continue;
    if (paintLabel(c, d, s, false) && d.kind === "person") people++;
  }
}
// visible dots on screen, bucketed in 24 px cells, for "does this label cover a dot?"
function nodeGrid() {
  const R = S.renderer, W = S.box.clientWidth, H = S.box.clientHeight, g = new Map(), C = 24;
  S.G.forEachNode((k, a) => {
    if (a.sup || a.kind === "head") return;
    const d = R.getNodeDisplayData(k); if (!d || d.hidden) return;
    const v = R.framedGraphToViewport(d), r = R.scaleSize(d.size);
    if (v.x < -r || v.y < -r || v.x > W + r || v.y > H + r) return;
    for (let i = Math.floor((v.x - r) / C); i <= Math.floor((v.x + r) / C); i++)
      for (let j = Math.floor((v.y - r) / C); j <= Math.floor((v.y + r) / C); j++) { const key = i + "," + j; if (!g.has(key)) g.set(key, []); g.get(key).push([v.x, v.y, r, k]); }
  });
  return g;
}
function coversDot(b, own) {
  const C = 24;
  for (let i = Math.floor(b.x / C); i <= Math.floor((b.x + b.w) / C); i++)
    for (let j = Math.floor(b.y / C); j <= Math.floor((b.y + b.h) / C); j++)
      for (const [x, y, r, k] of S.grid.get(i + "," + j) || []) {
        if (k === own) continue;
        const dx = x - Math.max(b.x, Math.min(x, b.x + b.w)), dy = y - Math.max(b.y, Math.min(y, b.y + b.h));
        if (dx * dx + dy * dy < (r - 0.5) * (r - 0.5)) return true;
      }
  return false;
}
function fits(b, own) {
  if (S.view === "map" && (b.x < 0 || b.y < 0 || b.x + b.w > S.box.clientWidth || b.y + b.h > S.box.clientHeight)) return false;
  for (const o of S.boxes.values())  // 1px gap; ponytail: linear scan, a grid if labels pass ~1000
    if (b.x < o.x + o.w + 1 && o.x < b.x + b.w + 1 && b.y < o.y + o.h + 1 && o.y < b.y + b.h + 1) return false;
  return !S.grid || !coversDot(b, own);
}
// Positions just outside a circle's dots, nearest to the person's own direction first: [anchor, box].
function callout(d, w, h) {
  const a = S.G.getNodeAttributes(d.key), disc = a.kind === "person" && S.discOf.get(a.p.cluster);
  if (!disc) return null;
  const c = S.renderer.graphToViewport(disc), k = pxPerUnit(), base = Math.atan2(d.y - c.y, d.x - c.x);
  for (const rad of [disc.r * k + d.size + 5, disc.R * k + 6, disc.R * k + 22]) for (let i = 0; i < 24; i++) {
    const t = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12), cx = Math.cos(t), cy = Math.sin(t);
    const px = c.x + rad * cx, py = c.y + rad * cy;
    const x = cx > 0.35 ? px : cx < -0.35 ? px - w : px - w / 2, y = cy > 0.35 ? py : cy < -0.35 ? py - h : py - h / 2;
    const b = { x, y, w, h, label: d.label, key: d.key };
    if (fits(b, d.key)) return [b, [px, py]];
  }
  return null;
}
function paintLabel(ctx, d, st, force) {
  ctx.font = `${d.kind === "head" ? 600 : st.labelWeight} ${st.labelSize}px ${st.labelFont}`;
  const w = ctx.measureText(d.label).width, h = st.labelSize;
  const x = d.kind === "head" ? d.x - w / 2 : d.labelLeft ? d.x - d.size - 4 - w : d.x + d.size + 4;
  let box = { x, y: d.y + h / 3 - h * 0.8, w, h, label: d.label, key: d.key }, lead = null;
  if (!force && !fits(box, d.key)) {
    const alt = S.view === "map" && d.kind === "person" && callout(d, w, h);
    if (!alt) return false;
    [box, lead] = alt;
  }
  S.boxes.set(d.key, box);
  if (lead) { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(lead[0], lead[1]); ctx.lineWidth = 1; ctx.strokeStyle = T["--edge-focus"]; ctx.stroke(); }
  const by = box.y + h * 0.8;
  ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = T["--surface"]; ctx.strokeText(d.label, box.x, by);
  ctx.fillStyle = d.kind === "head" ? T["--muted"] || T["--ink"] : T["--ink"]; ctx.fillText(d.label, box.x, by);
  return true;
}
// Circle names sit just above their own dots (inside the disc's empty band), or below them, biggest circles first.
function circleNames(ctx, st) {
  const R = S.renderer, k = pxPerUnit(), h = st.labelSize;
  const mine = S.focus && S.G.getNodeAttribute(S.focus, "kind") === "person" ? S.G.getNodeAttributes(S.focus).p.cluster : null;
  for (const disc of S.discs) {
    if (disc.n < 4 && disc.c !== mine) continue;
    const label = `${S.labels[disc.c]} · ${disc.n}`, bold = disc.c === mine || (S.hl != null && grp(disc.c) === grp(S.hl));
    ctx.font = `${bold ? 600 : 400} ${h}px ${st.labelFont}`;
    const w = ctx.measureText(label).width, c = R.graphToViewport(disc), off = disc.r * k + S.dot + 4;
    const b = [{ x: c.x - w / 2, y: c.y - off - h, w, h, label, key: "c:" + disc.c }, { x: c.x - w / 2, y: c.y + off, w, h, label, key: "c:" + disc.c }]
      .find((x) => fits(x, null));  // above the dots, else below them
    if (!b) continue;
    S.boxes.set(b.key, b);
    ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = T["--surface"]; ctx.strokeText(label, b.x, b.y + h * 0.8);
    ctx.fillStyle = T["--ink-2"]; ctx.fillText(label, b.x, b.y + h * 0.8);
  }
}
// Under sigma's canvases: each circle's outline (dashed for people in no circle, dark for the pinned person's own)
// and a ring around every result and the pinned dot.
function drawBg() {
  const c = S.bg, W = S.box.clientWidth, H = S.box.clientHeight, dpr = devicePixelRatio || 1;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  if (S.view !== "map") return;
  const R = S.renderer, k = pxPerUnit();
  const mine = S.focus && S.G.getNodeAttribute(S.focus, "kind") === "person" ? S.G.getNodeAttributes(S.focus).p.cluster : null;
  for (const d of S.discs) {
    const v = R.graphToViewport(d), on = d.c === mine || (S.hl != null && grp(d.c) === grp(S.hl));
    x.beginPath(); x.arc(v.x, v.y, d.R * k, 0, 2 * Math.PI); x.setLineDash(d.c < 0 ? [4, 4] : []);
    x.lineWidth = on ? 1.6 : 1; x.strokeStyle = on ? T["--ink"] : T["--line"]; x.stroke();
  }
  x.setLineDash([]);
  const ring = (key, lw) => { const d = R.getNodeDisplayData(key); if (!d || d.hidden) return; const v = R.framedGraphToViewport(d);
    x.beginPath(); x.arc(v.x, v.y, R.scaleSize(d.size) + 2.5, 0, 2 * Math.PI); x.lineWidth = lw; x.strokeStyle = T["--ink"]; x.stroke(); };
  // rings need room between dots; when they would run together (big circles, small screens), colour alone marks results
  if (S.sel && S.hl == null && 1.5 * STEP * k > 2 * (S.dot * 1.3 + 2.5) + 2) S.sel.forEach((key) => ring(key, 1.2));
  if (S.focus) ring(S.focus, 2.2);
}

// ---------- focus and pins ----------
// Hover (or click, to pin) a node: it and its own links stay in colour. A person's own links are what is tied to them
// alone (organisation, skills, events); everyone sharing their employer is their circle, outlined, not highlighted.
function setFocus(k, pin) {
  if (!S || !S.G.hasNode(k)) return;
  const a = S.G.getNodeAttributes(k);
  S.focus = k; S.pinned = !!pin;
  S.near = new Set(S.G.neighbors(k).filter((o) => a.kind !== "person" || S.G.getNodeAttribute(o, "kind") !== "person"));
  S.nearLabel = new Set([...S.near].filter((o) => S.G.getNodeAttribute(o, "kind") === "person").slice(0, MAX_LABELLED - 1));
  S.renderer.refresh();
  if (pin) showPinned();
}
function clearFocus() {
  if (S && S.focus) { S.focus = null; S.near = null; S.nearLabel = null; S.pinned = false; S.renderer.refresh(); }
  if (S) showPinned();
}
// ponytail: recount/visible are O(N) per frame while playing; fine to ~10k nodes. Beyond that, keep per-cluster
// prefix sums of members by month and binary-search S.cur instead of filtering.
function recount() {
  S.counts = {};
  S.G.forEachNode((k, a) => { if (a.sup) S.counts[a.cluster] = a.months.filter((m) => m <= upTo()).length; });
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
    if (S.G.getNodeAttribute(node, "kind") === "head") return;
    tip.hidden = true;
    S.pinned && S.focus === node ? clearFocus() : (setFocus(node, true), track("pin:map"));
  });
  r.on("clickStage", clearFocus);
}
// What we know about a node, one short line each: used by the tooltip, the pinned detail and the live region.
function describe(node) {
  const a = S.G.getNodeAttributes(node), out = [];
  const links = [];  // layer neighbours, e.g. "◆ Python (endorsed you for)"
  S.G.forEachEdge(node, (e, ea, s, t) => { if (ea.layer && !ea.agg) { const o = s === node ? t : s; links.push(`${S.G.getNodeAttribute(o, "label")} (${ea.kind})`); } });
  const more = (xs, n) => xs.slice(0, n).join(", ") + (xs.length > n ? `, +${xs.length - n} more` : "");
  if (a.sup) { out.push(a.label, `${S.counts[a.cluster]} people`); return out; }
  if (a.kind !== "person") {
    out.push(a.p.label, KINDS[a.kind].one + (a.p.how ? ` · ${a.p.how}` : ""));
    if (a.p.date) out.push(fmtDate(a.p.date));
    if (a.p.text) out.push(a.p.text);
    out.push(plural(links.length, "link") + (a.p.outside ? `, plus ${a.p.outside} endorsements from people outside your connections` : ""));
    return out;
  }
  const mates = S.data.nodes.filter((n) => n.cluster === a.p.cluster && n.id !== a.p.id);
  out.push(a.p.name, [a.p.title, a.p.company].filter(Boolean).join(" at ") || "No title or company", `Connected ${fmtDate(a.p.connected_on)}`);
  out.push(a.p.cluster < 0 ? "Not in a circle: they share no employer or connection days with anyone else here"
    : `In ${S.labels[a.p.cluster]} with ${plural(mates.length, "other")}` + (mates.length ? `, such as ${mates.slice(0, 3).map((n) => n.name).join(", ")}` : ""));
  if (a.follows) out.push("You follow them");
  out.push(links.length ? `Linked to ${more(links, 6)}` : "Nothing else in your export links to them");
  return out;
}
// Tooltip for a hovered node, at viewport point (x, y) inside #graph.
function showTip(node, x, y) {
  const tip = $("tip"), [head, ...rest] = describe(node);
  tip.innerHTML = "";
  const add = (tag, txt) => { const el = document.createElement(tag); el.textContent = txt; tip.appendChild(el); };
  add("b", head); rest.slice(0, 4).forEach((t) => add("span", t));
  const box = $("graph").getBoundingClientRect(), off = $("canvas").offsetTop;
  tip.hidden = false;
  tip.style.left = Math.max(4, Math.min(x + 12, box.width - tip.offsetWidth - 4)) + "px";
  tip.style.top = Math.max(off, Math.min(y + off + 12, box.height - tip.offsetHeight - 4)) + "px";
}
// Pin from the results list or the keyboard: no zoom, so the surrounding circles stay in view; pan only when the
// node is off screen at the current zoom. The detail opens under the result, and is announced.
function goTo(k) {
  const a = S.G.getNodeAttributes(k);
  if (S.hiddenKinds.has(a.kind)) { S.hiddenKinds.delete(a.kind); buildKinds(); }
  if (a.orphan && S.view === "map" && a.kind !== "person") setView("layers");
  if (S.pinned && S.focus === k) return clearFocus();
  setFocus(k, true); track("pin:result");
  $("tip").hidden = true;
  const d = S.renderer.getNodeDisplayData(k);
  if (d && !d.hidden && S.box.clientWidth) {
    const v = S.renderer.framedGraphToViewport(d);
    if (v.x < 0 || v.y < 0 || v.x > S.box.clientWidth || v.y > S.box.clientHeight)
      S.renderer.getCamera().animate({ x: d.x, y: d.y }, { duration: reduceMotion.matches ? 0 : 400 });
  }
  $("live").textContent = describe(k).join(". ");
}
// The pinned node's detail: under its row when it is in the results, otherwise in its own box above them. The results
// themselves never change on a pin.
function showPinned() {
  const k = S && S.pinned ? S.focus : null;
  if (!S || S.shownPin === k) return;  // hover comes and goes without a pin: leave the lists (and keyboard focus) alone
  S.shownPin = k;
  document.querySelectorAll("#knowList li.on").forEach((li) => { li.classList.remove("on"); li.querySelector(".detail")?.remove(); });
  $("pinned").innerHTML = "";
  if (k) {
    const li = document.querySelector(`#knowList li[data-k="${CSS.escape(k)}"]`);
    if (li) { li.classList.add("on"); li.appendChild(detail(k)); }
    else { const p = row(k); p.classList.add("on"); p.appendChild(detail(k)); $("pinned").appendChild(p); }
  }
  buildLegend();
}
function detail(k) {
  const a = S.G.getNodeAttributes(k), box = document.createElement("div"), [, , ...rest] = describe(k);
  box.className = "detail";
  rest.filter((t) => !t.startsWith("Connected ")).forEach((t) => { const s = document.createElement("span"); s.textContent = t; box.appendChild(s); });
  const acts = document.createElement("span"), btn = (txt, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "link"; b.textContent = txt; b.onclick = fn; acts.append(b, " "); };
  if (a.kind === "person" && a.p.cluster >= 0) btn(`List everyone in ${S.labels[a.p.cluster]}`, () => listCircle(grp(a.p.cluster), a.p.cluster));
  if (a.kind !== "person" && !a.sup) btn("List the people linked to it", () => listLinked(k));
  if ($("main").dataset.view === "circles") btn("Show on the map", () => setPage("map"));
  box.appendChild(acts);
  return box;
}

// ---------- search: who do I know at… ----------
// The job the persona research ranked first (research/findings.md): given companies, role words, names, skills or
// events, list the people you are already connected to there, longest-known first, with their circle; mark them on
// the map and hand back a CSV. Only first-degree connections: LinkedIn's export has nobody else, and no locations.
const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const LEGAL = new Set("inc ltd llc llp plc gmbh ag sa sas sarl bv nv co corp corporation limited company".split(" "));
const coKey = (s) => norm(s).split(" ").filter((t) => t && !LEGAL.has(t)).join(" ");
const byDate = (a, b) => (a.n.connected_on || "9").localeCompare(b.n.connected_on || "9") || a.n.name.localeCompare(b.n.name);
// -> [{ q, rows: [{ k, n, by }], things: [layer node keys] }]; a person is listed once, under the first query that matched them
function whoKnow(text) {
  const seen = new Set();
  return text.split(/[\n,;]+/).map((q) => q.trim()).filter(Boolean).map((q) => {
    const ck = coKey(q), words = norm(q).split(" ").filter(Boolean), rows = [], things = [];
    const starts = (s) => words.every((w) => s.includes(` ${w}`));  // every word starts a word of s
    if (ck) for (const n of S.data.nodes) {
      const k = String(n.id), by = ` ${coKey(n.company)} `.includes(` ${ck} `) ? "company" : starts(` ${norm(n.title)}`) ? "title" : starts(` ${norm(n.name)}`) ? "name" : null;
      if (by && !seen.has(k)) { seen.add(k); rows.push({ k, n, by }); }
    }
    rows.sort(byDate);
    if (words.length) S.G.forEachNode((k, a) => { if (a.p && !a.sup && a.kind !== "person" && a.kind !== "post" && starts(` ${norm(a.p.label)}`)) things.push(k); });
    return { q, rows, things };
  });
}
// Quick picks: the companies you know most people at (never a generic employer) and your two biggest role families.
const ROLE_WORD = { "recruiting/hr": "recruiter", design: "designer", eng: "engineer", data: "data", product: "product", "sales/bd": "sales",
  "founder/exec": "founder", marketing: "marketing", finance: "finance", ops: "operations", "research/academia": "research" };
function buildKnow() {
  const generic = new Set(S.data.meta.generic || []), co = {}, role = {};
  S.data.nodes.forEach((n) => { if (n.company && !generic.has(n.company)) co[n.company] = (co[n.company] || 0) + 1; if (ROLE_WORD[n.role]) role[n.role] = (role[n.role] || 0) + 1; });
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
  const picks = $("knowPicks"); picks.innerHTML = "<span>Try:</span>";
  [...top(co, 4), ...top(role, 2).map((r) => ROLE_WORD[r])].forEach((c) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c;
    b.onclick = () => { $("knowQ").value = c; runKnow(); };
    picks.appendChild(b);
  });
  clearKnow();
}
function clearKnow() {
  S.sel = null; S.selCircles = null; S.selLabel = null; S.knowRows = []; S.listed = null;
  $("knowList").innerHTML = ""; $("knowSummary").textContent = ""; $("knowCsv").hidden = $("knowClear").hidden = true; $("knowEmpty").hidden = false;
  S.shownPin = undefined; clearFocus(); S.renderer.refresh();
}
function runKnow() {
  if (!S) return;
  const groups = whoKnow($("knowQ").value);
  if (!groups.length) return clearKnow();
  const people = groups.reduce((t, g) => t + g.rows.length, 0), things = groups.reduce((t, g) => t + g.things.length, 0), hit = groups.filter((g) => g.rows.length).length;
  track("search");
  showResults(groups, people
    ? `${plural(people, "person", "people")} for ${hit} of ${plural(groups.length, "search", "searches")}, longest known first.`
    : things ? `No one's company, title or name matches, but ${things === 1 ? "this item does" : `these ${things} items do`}; click one to see who is linked to it.`
      : "Nobody you're connected to matches; the export only has your own connections.");
}
function listCircle(id, only) {
  const c = S.clusters.find((x) => x.id === id) || { id, label: S.labels[only] };
  const rows = S.data.nodes.filter((n) => (only != null ? n.cluster === only : grp(n.cluster) === id)).map((n) => ({ k: String(n.id), n, by: "circle" })).sort(byDate);
  const name = only != null ? S.labels[only] : labelOf(c);
  $("knowQ").value = ""; track("circle");
  showResults([{ q: name, rows, things: [] }], `${name}: ${plural(rows.length, "person", "people")}, longest known first.`);
  S.listed = id; buildLegend();
}
function listLinked(k) {
  const rows = S.G.neighbors(k).filter((o) => S.G.getNodeAttribute(o, "kind") === "person").map((o) => ({ k: o, n: S.G.getNodeAttribute(o, "p"), by: "linked" })).sort(byDate);
  const name = S.G.getNodeAttribute(k, "p").label;
  showResults([{ q: name, rows, things: [] }], `${name}: ${plural(rows.length, "person", "people")} linked, longest known first.`);
}
function showResults(groups, summary) {
  S.shownPin = undefined; clearFocus();
  const all = groups.flatMap((g) => g.rows);
  S.knowRows = groups.flatMap((g) => g.rows.map((r) => ({ ...r, q: g.q })));
  S.sel = new Set(all.map((r) => r.k)); S.selCircles = new Set(all.map((r) => S.G.getNodeAttribute(r.k, "cluster")));
  S.selLabel = new Set(all.slice(0, MAX_LABELLED).map((r) => r.k)); S.listed = null;
  const list = $("knowList"); list.innerHTML = "";
  for (const g of groups) {
    if (groups.length > 1 || !g.rows.length) { const h = document.createElement("li"); h.className = "kq";
      h.textContent = g.rows.length ? `${g.q}: ${plural(g.rows.length, "person", "people")}` : g.things.length ? `${g.q}: in your skills, organisations and events`
        : `${g.q}: nobody you're connected to`; list.appendChild(h); }
    for (const r of g.rows.slice(0, 100)) list.appendChild(row(r.k));
    if (g.rows.length > 100) { const m = document.createElement("li"); m.className = "kq"; m.textContent = `+${g.rows.length - 100} more in the CSV`; list.appendChild(m); }
    for (const k of g.things) list.appendChild(row(k));
  }
  $("knowSummary").textContent = summary;
  $("knowCsv").hidden = !all.length; $("knowClear").hidden = false; $("knowEmpty").hidden = true;
  buildLegend(); S.renderer.refresh();
}
// One result row: a person (name; title at company; circle · when you connected) or a layer item (skill, org, event).
function row(k) {
  const a = S.G.getNodeAttributes(k), li = document.createElement("li"), b = document.createElement("button");
  li.dataset.k = k; b.type = "button"; b.className = "kp";
  const sw = document.createElement("span"), name = document.createElement("b"), what = document.createElement("span"), how = document.createElement("span");
  sw.className = "sw";
  if (a.kind === "person") {
    const n = a.p;
    sw.style.background = colorOf(a.cluster); name.textContent = n.name;
    what.textContent = [n.title, n.company].filter(Boolean).join(" at ") || "No title or company";
    how.textContent = `${S.labels[n.cluster]} · ${n.connected_on ? "connected " + fmtDate(n.connected_on) : "connection date unknown"}`;
  } else {
    sw.textContent = KINDS[a.kind] ? KINDS[a.kind].g : ""; sw.style.cssText = "width:auto;height:auto;border-radius:0";
    name.textContent = a.p ? a.p.label : a.label; what.textContent = (KINDS[a.kind] || {}).one || "";
    how.textContent = plural(S.G.neighbors(k).filter((o) => S.G.getNodeAttribute(o, "kind") === "person").length, "person", "people") + " linked";
  }
  b.append(sw, name, what, how);
  b.onclick = () => goTo(k);
  li.appendChild(b);
  return li;
}
function knowCsv() {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["search", "matched on", "name", "title", "company", "circle", "connected on"].map(esc).join(",")];
  for (const r of S.knowRows) lines.push([r.q, r.by, r.n.name, r.n.title, r.n.company, S.labels[r.n.cluster], r.n.connected_on || ""].map(esc).join(","));
  const a = document.createElement("a");  // built in this tab; nothing is sent anywhere
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = "who-i-know.csv"; document.body.appendChild(a); a.click(); a.remove(); track("csv");
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("knowForm").addEventListener("submit", (e) => { e.preventDefault(); runKnow(); });
$("knowCsv").addEventListener("click", knowCsv);
$("knowClear").addEventListener("click", () => { $("knowQ").value = ""; clearKnow(); buildLegend(); });

// ---------- circles: a list (List, Map) or cards (Circles) ----------
// Each card draws its circle the way the map does (a sunflower of dots, oldest connection in the middle), rings your
// results and the pinned person, and says when you met its people and where they work.
function discSVG(members, g) {
  const dots = members.slice(0, 500), r = Math.sqrt(dots.length + 0.5) + 1, pin = S.pinned ? S.focus : null;  // ponytail: cap at 500 dots per card
  let s = `<svg class="disc" viewBox="${-r - 1} ${-r - 1} ${2 * r + 2} ${2 * r + 2}" aria-hidden="true"><circle r="${r}" fill="none" stroke="${T["--line"]}" stroke-width="0.12"/>`;
  dots.forEach((n, i) => { const a = i * 2.39996, d = Math.sqrt(i + 0.5), x = (d * Math.cos(a)).toFixed(2), y = (d * Math.sin(a)).toFixed(2), k = String(n.id);
    const hit = S.sel && S.sel.has(k);
    s += `<circle cx="${x}" cy="${y}" r="0.4" fill="${hit || !S.sel ? colorOf(g) : fadeOf(g)}"/>`;
    if (hit || k === pin) s += `<circle cx="${x}" cy="${y}" r="0.68" fill="none" stroke="${T["--ink"]}" stroke-width="${k === pin ? 0.22 : 0.12}"/>`; });
  return s + "</svg>";
}
function buildLegend() {
  const ul = $("legend"), cards = $("main").dataset.view === "circles"; ul.innerHTML = "";
  const max = Math.max(1, ...S.clusters.map((c) => c.size)), pinC = S.pinned && S.G.getNodeAttribute(S.focus, "kind") === "person" ? S.G.getNodeAttribute(S.focus, "cluster") : null;
  for (const c of S.clusters) {
    const li = document.createElement("li"), b = document.createElement("button");
    const members = S.data.nodes.filter((n) => grp(n.cluster) === c.id).sort((p, q) => (p.connected_on || "9").localeCompare(q.connected_on || "9"));
    const hits = S.sel ? members.filter((n) => S.sel.has(String(n.id))).length : 0;
    b.type = "button"; b.dataset.id = c.id; b.setAttribute("aria-pressed", String(S.listed === c.id));
    if (pinC === c.id || S.listed === c.id) li.className = "on";
    const lbl = document.createElement("span"), sub = document.createElement("span"), num = document.createElement("span");
    lbl.className = "lbl"; lbl.textContent = labelOf(c); num.className = "num"; num.textContent = c.size;
    if (cards) {
      const ds = members.map((n) => n.connected_on).filter(Boolean), co = {};
      members.forEach((n) => { if (n.company) co[n.company] = (co[n.company] || 0) + 1; });
      const tops = Object.entries(co).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
      sub.className = "sub"; sub.textContent = `${plural(c.size, "person", "people")}` + (ds.length ? ` · connected ${ds[0].slice(0, 4)}–${ds[ds.length - 1].slice(0, 4)}` : "") +
        (c.id >= 0 && c.id < SMALL && tops ? `. ${tops}` : "") + (hits ? `. ${hits} of your results` : "");
      b.innerHTML = discSVG(members, c.id);
      b.append(lbl, sub);
    } else {
      const sw = document.createElement("span"), bar = document.createElement("span");
      sw.className = "sw"; sw.style.background = colorOf(c.id);
      bar.className = "bar"; bar.style.width = `${Math.max(2, (80 * c.size) / max)}px`; bar.style.background = colorOf(c.id);
      b.append(sw, lbl, bar, num);
    }
    b.title = `${plural(c.size, "person", "people")}. Click to list them.`;
    b.onclick = () => listCircle(c.id);
    b.onmouseenter = b.onfocus = () => highlight(c.id);  // shows a circle's members without relying on its colour
    b.onmouseleave = b.onblur = () => highlight(null);
    li.appendChild(b); ul.appendChild(li);
    if (c.members) {  // list what the grey "smaller groups" row holds
      const d = document.createElement("details"), ml = document.createElement("ul");
      d.innerHTML = "<summary>Show the smaller groups</summary>";
      c.members.forEach((x) => { const i = document.createElement("li"), lb = document.createElement("button");
        lb.type = "button"; lb.className = "link"; lb.textContent = `${labelOf(x)} (${x.size})`; lb.onclick = () => listCircle(SMALL, x.id); i.appendChild(lb); ml.appendChild(i); });
      d.appendChild(ml); li.appendChild(d);
    }
  }
  ul.dataset.clusterCount = S.data.clusters.filter((c) => c.id >= 0).length;
}
function highlight(c) {
  if (!S || S.hl === c) return;
  S.hl = c; S.hlNear = new Set();  // layer nodes linked to the circle's members stay in colour (Layers)
  if (c != null) S.G.forEachNode((k, a) => { if (a.kind === "person" && a.cluster === grp(c)) S.G.forEachNeighbor(k, (o, oa) => { if (oa.kind !== "person") S.hlNear.add(o); }); });
  S.renderer.refresh();
}
function buildMeta() {
  const m = S.data.meta, n = m.n_people, un = Math.round(m.share_unplaced * n), gen = m.generic || [];
  const w = Object.entries(m.weights || {}).map(([k, v]) => `${W_NAMES[k] || k} ${v}`).join(", ");
  const linked = Object.entries(m.weights || {}).filter(([, v]) => v > 0).map(([k]) => SHARED[k] || k).join(" or ");
  const small = S.clusters.find((c) => c.members);
  const coh = S.data.clusters.filter((c) => c.id >= 0 && c.id < SMALL && c.cohesion != null).map((c) => `${c.label} ${c.cohesion.toFixed(2)}`).join(", ");
  const lines = [
    `${n} people in ${m.n_clusters} circles, ${m.n_edges.toLocaleString()} links. The map places each circle as its own disc; distances between discs mean nothing.`,
    `${un} people (${(m.share_unplaced * 100).toFixed(1)}%) are in no circle: they share no ${linked} with anyone else here.`,
    gen.length ? `${plural(gen.length, "generic employer name")} (${gen.slice(0, 4).map((g) => `"${g}"`).join(", ")}${gen.length > 4 ? "…" : ""}) link nobody: people who type them don't work together.` : null,
    `Link weights: ${w}.` + (/ 0(,|$)/.test(w) ? " A weight of 0 means the attribute is shown but does not link people." : ""),
    small ? `Only ${SMALL} colours stay distinguishable, so the ${small.members.length} smallest circles (${small.size} people) are grey and listed under "${small.label}".` : null,
    m.modularity == null ? null : `Modularity ${m.modularity}. Company groups separate easily, so a high value is expected and is not proof the circles are right.`,
    coh ? `Cohesion, the share of a circle's link weight that stays inside it: ${coh}.` : null,
    "The export has no links between your connections. Circles are inferred from shared employers and timing.",
    layerNote(S.data.layers),
  ];
  $("meta").innerHTML = ""; lines.filter(Boolean).forEach((t) => { const li = document.createElement("li"); li.textContent = t; $("meta").appendChild(li); });
}
function layerNote(L) {
  if (!L || !L.nodes.length) return null;
  const c = L.counts, out = L.nodes.reduce((t, n) => t + (n.outside || 0), 0);
  return "Layers are only about you: LinkedIn shares your skills, groups and posts, not your connections'. " +
    "Skills link to the people who endorsed them" + (out ? ` (${out} more endorsements came from outside your connections)` : "") +
    "; organisations to people working there now; events to people you connected with in the week after." +
    (c.reactions ? ` ${c.reactions} reactions are counted, not drawn: the data doesn't say whose posts they were on.` : "") +
    " Followers are not available from LinkedIn at all.";
}

// ---------- timeline ----------
// When most connections fall in a few months (an import, a new job), a month-by-month strip is one spike and a flat
// line, so the card says which months instead and keeps the strip behind a button.
function setupTimeline() {
  const sl = $("month");
  $("timeCard").hidden = !S.hasDates;  // no connection dates: no timeline
  sl.disabled = !S.hasDates; applyMotionPref();
  sl.min = 0; sl.max = S.m1 - S.m0; sl.value = sl.max;
  $("first").textContent = monthName(S.m0); $("last").textContent = monthName(S.m1);
  const dated = S.perMonth.reduce((a, b) => a + b, 0), top = S.perMonth.map((c, i) => [c, S.m0 + i]).filter((v) => v[0]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const few = top.slice(0, 3), inFew = few.reduce((t, v) => t + v[0], 0);
  S.bunched = dated > 0 && S.perMonth.length > 3 && inFew >= 0.5 * dated;
  const shown = few.filter((v, i) => !i || v[0] >= 0.1 * dated).map(([c, m]) => `${monthName(m)} (${c})`);
  $("tsum").textContent = !dated ? "" : S.bunched ? `${Math.round((100 * inFew) / dated)}% of your connections came in ${shown.length > 1 ? shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1] : shown[0]}.`
    : `Busiest month: ${monthName(top[0][1])} (${plural(top[0][0], "person", "people")} added).`;
  showTimeline(!S.bunched);
  setMonth(S.m1);
}
function showTimeline(on) {
  $("timeline").hidden = !on; $("tToggle").setAttribute("aria-expanded", String(on));
  $("tToggle").textContent = on ? "Hide the timeline" : "Show the timeline";
  if (on && S) drawSpark();
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

// ---------- three layouts of the same parts ----------
// ?view= wins (a usability session or an A/B link assigns it, and it isn't remembered); otherwise the visitor's last
// choice; otherwise the list. The parts and the state don't change, only where they sit.
function setPage(v, save = true) {
  if (!VIEWS.includes(v)) v = "list";
  $("main").dataset.view = v;
  document.querySelectorAll("#pageView button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  if (save) try { localStorage.setItem("nc.view", v); } catch (e) { /* storage blocked: not remembered */ }
  track("view:" + v);
  if (!S) return;
  S.shownPin = undefined; showPinned();
  requestAnimationFrame(() => { if (S.box.clientWidth) { S.renderer.resize(); sizeDots(); S.renderer.refresh(); } });
}
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
// Reads the zip LinkedIn sends, so nobody has to unzip it: end-of-central-directory -> central directory -> each entry.
// Only entries the tool uses (EXPORT_NAMES, matched by file name in any folder) are decompressed, with the browser's
// own DecompressionStream; messages and everything else in the archive are never opened.
// ponytail: stored and deflate entries only, no zip64 or encryption; LinkedIn's export uses neither.
async function zipEntries(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer), u8 = new TextDecoder();
  let e = buf.length - 22;
  while (e >= 0 && e >= buf.length - 65557 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0 || dv.getUint32(e, true) !== 0x06054b50) throw new Error(`${file.name} doesn't look like a zip file.`);
  let p = dv.getUint32(e + 16, true);
  const count = dv.getUint16(e + 10, true), out = [];
  if (p === 0xffffffff) throw new Error(`${file.name} is a zip64 archive, which isn't supported. Unzip it and pick the CSV files instead.`);
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error(`${file.name} looks damaged. Download it again from LinkedIn's email.`);
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), rest = dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true), at = dv.getUint32(p + 42, true);
    const base = u8.decode(buf.subarray(p + 46, p + 46 + nlen)).split("/").pop();
    p += 46 + nlen + rest;
    const name = EXPORT_NAMES.find((n) => n.toLowerCase() === base.toLowerCase());
    if (!name || out.some((o) => o.name === name)) continue;
    if (flags & 1) throw new Error(`${file.name} is password-protected.`);
    const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true), raw = buf.subarray(start, start + size);
    const bytes = method === 0 ? raw : method === 8
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())
      : null;
    if (!bytes) throw new Error(`${base} in ${file.name} uses a compression this page can't read. Unzip it and pick the CSV files instead.`);
    out.push({ name, text: u8.decode(bytes) });
  }
  return out;
}
const tick = () => new Promise((r) => setTimeout(r, 30));
let busy = false;
async function runFiles(files) {
  if (busy || window.DEMO_GRAPH) return;  // one run at a time; later drops/picks are ignored until it finishes
  const all = [...files], zips = all.filter((f) => /\.zip$/i.test(f.name)), csvs = all.filter((f) => /\.csv$/i.test(f.name));
  if (!zips.length && !csvs.length) return status("Pick the zip file LinkedIn sent you, or the CSV files from it.", true);
  busy = true; $("pick").disabled = true;
  try {
    stopPlay();
    if (zips.length) status("Opening the zip in this tab…");
    const csv = [];  // read everything before touching /in
    for (const z of zips) csv.push(...(await zipEntries(z)).filter((f) => !csv.some((c) => c.name === f.name)));
    for (const f of csvs) {
      const name = EXPORT_NAMES.find((n) => n.toLowerCase() === f.name.toLowerCase()) || f.name;
      if (!csv.some((c) => c.name === name)) csv.push({ name, text: await f.text() });
    }
    if (!csv.some((f) => f.name === "Connections.csv"))
      throw new Error(zips.length ? "There's no Connections.csv in this zip. Request your data again from LinkedIn and include Connections." : "Connections.csv is required. Pick it with the other CSV files from the export, or pick the zip itself.");
    status("Downloading the Python runtime from the CDN (about 10 MB, first time only)…");
    const py = await getPyodide();
    status("Reading your files in this tab…");
    py.FS.mkdirTree("/in");
    for (const f of py.FS.readdir("/in")) if (f !== "." && f !== "..") py.FS.unlink("/in/" + f);
    csv.forEach((f) => py.FS.writeFile("/in/" + f.name, f.text));
    status("Finding circles…"); await tick();
    const out = py.runPython("import sys, json\nsys.path.insert(0, '/home/pyodide')\nimport netmap\njson.dumps(netmap.run('/in'))");
    status("Drawing…"); await tick();
    const data = JSON.parse(out);
    render(data);
    if ($("knowQ").value.trim()) runKnow();  // a search carried over from the showcase page (?know=) runs on your data
    status(`Done: ${data.meta.n_people} people in ${data.meta.n_clusters} circles, read in this tab and not uploaded.`);
  } catch (e) { console.error(e); status("Could not process the files: " + (e.message || e).toString().split("\n").slice(-2).join(" "), true); }
  finally { busy = false; $("pick").disabled = false; }
}

// ---------- wiring ----------
$("month").addEventListener("input", (e) => { if (!S) return; stopPlay(); setMonth(S.m0 + +e.target.value); });
$("play").addEventListener("click", play);
$("tToggle").addEventListener("click", () => showTimeline($("timeline").hidden));
$("vMap").addEventListener("click", () => setView("map"));
$("vLayers").addEventListener("click", () => setView("layers"));
document.querySelectorAll("#pageView button").forEach((b) => b.addEventListener("click", () => setPage(b.dataset.view)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S && S.focus && !$("how").open) { clearFocus(); $("tip").hidden = true; $("live").textContent = ""; } });
$("howBtn").addEventListener("click", () => $("how").showModal());
$("pick").addEventListener("click", () => $("files").click());
$("files").addEventListener("change", (e) => { if (e.target.files.length) runFiles(e.target.files); e.target.value = ""; });
// the whole page is the drop target; the header's open button is outlined while files hover
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
// What is on screen right now: label boxes as drawn, visible dots (Map), drawn-edge crossings, the graph-to-screen scale.
window.__measure = () => {
  const R = S.renderer, segs = [], dots = [];
  S.G.forEachEdge((e, a, s, t) => {
    const d = R.getEdgeDisplayData(e);
    if (!d || d.hidden) return;
    const p = R.graphToViewport(S.G.getNodeAttributes(s)), q = R.graphToViewport(S.G.getNodeAttributes(t));
    segs.push([p.x, p.y, q.x, q.y, s, t]);
  });
  if (S.view === "map") S.G.forEachNode((k, a) => {
    if (a.sup || a.kind === "head") return;
    const d = R.getNodeDisplayData(k); if (!d || d.hidden) return;
    const v = R.framedGraphToViewport(d), r = R.scaleSize(d.size);
    if (v.x > -r && v.y > -r && v.x < S.box.clientWidth + r && v.y < S.box.clientHeight + r) dots.push([+v.x.toFixed(2), +v.y.toFixed(2), +r.toFixed(2), k, a.kind]);
  });
  const g = (k) => S.G.getNodeAttributes(k), a = g("pad:l"), b = g("pad:r");
  const scale = a && b && b.x !== a.x ? (R.graphToViewport(b).x - R.graphToViewport(a).x) / (b.x - a.x) : null;
  return { view: S.view, page: $("main").dataset.view, layout: S.layoutStats, boxes: [...S.boxes.values()], dots, edges: segs.length, scale,
           ratio: R.getCamera().ratio, crossings: S.view === "layers" ? crossings(segs) : null,  // only meaningful (and affordable) in Layers
           width: S.box.clientWidth, height: S.box.clientHeight };
};

const retheme = () => { if (!S) return; readTokens(); S.edgeColor = T["--edge"]; S.renderer.setSetting("labelColor", { color: T["--ink"] }); buildLegend();
  document.querySelectorAll("#knowList .sw, #pinned .sw").forEach((s) => { const k = s.closest("li").dataset.k; if (S.G.getNodeAttribute(k, "kind") === "person") s.style.background = colorOf(S.G.getNodeAttribute(k, "cluster")); });
  S.renderer.refresh(); };
darkMQ.addEventListener("change", retheme);
new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
applyMotionPref();

(async () => {
  const qs = new URLSearchParams(location.search);
  let saved = null; try { saved = localStorage.getItem("nc.view"); } catch (e) { /* storage blocked */ }
  setPage(qs.get("view") || saved || "list", false);
  const shown = (d, what) => status(what ? `Showing ${what}: ${d.meta.n_people} people in ${d.meta.n_clusters} circles.` : `Showing the demo: ${d.meta.n_people} fictional people in ${d.meta.n_clusters} circles.`);
  // Static demo build (src/build_demo.py) embeds the synthetic graph; there is no drop mode there.
  if (window.DEMO_GRAPH) {
    render(window.DEMO_GRAPH); shown(window.DEMO_GRAPH);
    if (qs.get("know")) { $("knowQ").value = qs.get("know"); runKnow(); }
    return;
  }
  if (qs.get("know")) $("knowQ").value = qs.get("know");
  // ?own=1 (from the showcase page's "open my files" step): wait for the visitor's files instead of showing the demo
  if (qs.get("own") === "1") {
    status("Waiting for your LinkedIn zip.");
    $("empty").textContent = $("knowEmpty").textContent = "Click Open your LinkedIn zip at the top and pick the zip file LinkedIn sent you. No need to unzip it. It's read in this tab and never uploaded." + (qs.get("know") ? " Your search will run as soon as it's read." : "");
    $("pick").focus();
    return;
  }
  const p = qs.get("data") || "../demo/graph.json";
  const url = new URL(p, location.href);
  const fail = (msg) => { status("Nothing loaded.", true); $("empty").textContent = msg; };
  if (url.origin !== location.origin) return fail("Only graph.json files served next to this page can be loaded. Open your export instead.");
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    render(data); shown(data, p === "../demo/graph.json" ? null : url.pathname.split("/").slice(-2, -1)[0] || "a saved map");
    if (qs.get("know")) runKnow();  // ?know=Halcyon Freight,recruiter (showcase page links)
    // recording hook: ?autoplay=1 plays the timeline once (skipped under reduced motion)
    if (qs.get("autoplay") === "1" && !reduceMotion.matches && S.hasDates) { showTimeline(true); setMonth(S.m0); play(); }
  } catch (e) { console.error(e); fail(`Could not load ${p} (${e.message}). Serve the repo root with python3 -m http.server, or open your export.`); }
})();
