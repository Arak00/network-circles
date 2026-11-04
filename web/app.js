// Network Circles viewer. Plain script, no build. Globals from vendor/: graphology, graphologyLibrary, Sigma.
"use strict";
const $ = (id) => document.getElementById(id);
// dataviz reference categorical palette, fixed order; light and dark steps. Past 8 and "unplaced" -> grey.
const PAL = { light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
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
const EXPORT_NAMES = ["Connections.csv", "Positions.csv", "Invitations.csv", "Recommendations_Received.csv", "merge_overrides.csv"];

let S = null;               // current view state
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkMQ = matchMedia("(prefers-color-scheme: dark)");

const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : darkMQ.matches; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const T = {};               // theme tokens the canvas needs, re-read on theme change
const readTokens = () => ["--ink", "--edge", "--small", "--unplaced"].forEach((v) => { T[v] = css(v); });
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
      cluster: grp(n.cluster), m: monthOf(n.connected_on), p: n });
  }
  for (const e of data.edges) G.addEdge(String(e.s), String(e.t), { weight: e.w, size: e.w >= 1 ? 1 : 0.5 });
  const fa2 = graphologyLibrary.layoutForceAtlas2;
  fa2.assign(G, { iterations: 300, settings: fa2.inferSettings(G), getEdgeWeight: "weight" });

  // node size by weighted degree, gentle range
  const wdeg = {}; let maxW = 0;
  G.forEachNode((k) => { let s = 0; G.forEachEdge(k, (e, a) => { s += a.weight; }); wdeg[k] = s; maxW = Math.max(maxW, s); });
  G.forEachNode((k) => G.setNodeAttribute(k, "size", 2.5 + 5 * Math.sqrt(wdeg[k] / (maxW || 1))));

  // one hidden super-node per cluster at its members' centroid
  for (const c of clusters) {
    let x = 0, y = 0, n = 0;
    G.forEachNode((k, a) => { if (a.cluster === c.id) { x += a.x; y += a.y; n++; } });
    if (n) G.addNode("c" + c.id, { x: x / n, y: y / n, sup: true, cluster: c.id, label: labelOf(c), size: 6, months: [] });
  }
  G.forEachNode((k, a) => { if (!a.sup) G.getNodeAttribute("c" + a.cluster, "months").push(a.m); });

  const months = data.nodes.map((n) => monthOf(n.connected_on)).filter(isFinite);
  const m0 = months.length ? Math.min(...months) : 0, m1 = months.length ? Math.max(...months) : 0;
  const perMonth = new Array(m1 - m0 + 1).fill(0);
  months.forEach((m) => perMonth[m - m0]++);
  const next = { data, G, clusters, collapsed: new Set(), m0, m1, cur: m1, perMonth, counts: {}, playing: null, edgeColor: T["--edge"],
    hasDates: months.length > 0, box: null, labels: Object.fromEntries(all.map((c) => [c.id, labelOf(c)])) };
  const box = (next.box = $("canvas").appendChild(document.createElement("div"))), old = S;
  try {
    S = next;  // reducers read S while sigma does its first render
    next.renderer = new Sigma.Sigma(G, box, {
      nodeReducer, edgeReducer, zIndex: true, labelRenderedSizeThreshold: 9, labelFont: css("--sans"), labelSize: 12,
      labelColor: { color: T["--ink"] }, defaultEdgeColor: T["--edge"],
    });
  } catch (e) { S = old; box.remove(); throw e; }
  if (old) { stopPlay(old); old.renderer.kill(); old.box.remove(); }
  $("tip").hidden = true;
  wireHover();
  $("source").textContent = sourceText; $("empty").hidden = true;
  buildLegend(); buildMeta(); setupTimeline();
  window.__netmap = S;  // for tests / recording
}

// ---------- visibility (timeline + collapse) ----------
function visible(k) {
  const a = S.G.getNodeAttributes(k);
  if (a.sup) return S.collapsed.has(a.cluster) && S.counts[a.cluster] > 0;
  return !S.collapsed.has(a.cluster) && a.m <= S.cur;
}
function nodeReducer(k, a) {
  const r = { ...a, color: colorOf(a.cluster) };
  if (!visible(k)) r.hidden = true;
  else if (a.sup) { const n = S.counts[a.cluster]; r.size = 5 + 2.2 * Math.sqrt(n); r.label = `${a.label} (${n})`; r.forceLabel = true; r.zIndex = 1; }
  return r;
}
function edgeReducer(k, a) {
  const [s, t] = S.G.extremities(k);
  if (a.weight < MIN_W || !visible(s) || !visible(t) || (a.agg && a.m > S.cur)) return { ...a, hidden: true };
  return { ...a, color: S.edgeColor };
}
// ponytail: recount/visible are O(N) per frame while playing; fine to ~10k nodes. Beyond that, keep per-cluster
// prefix sums of members by month and binary-search S.cur instead of filtering.
function recount() {
  S.counts = {};
  S.G.forEachNode((k, a) => { if (a.sup) S.counts[a.cluster] = a.months.filter((m) => m <= S.cur).length; });
}
function toggleCluster(id) {
  const { G, collapsed } = S;
  collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
  G.filterEdges((e, a) => a.agg).forEach((e) => G.dropEdge(e));
  const acc = new Map();
  G.forEachEdge((e, a, s, t, sa, ta) => {
    if (a.agg) return;
    const cs = collapsed.has(sa.cluster), ct = collapsed.has(ta.cluster);
    if (!cs && !ct) return;
    const u = cs ? "c" + sa.cluster : s, v = ct ? "c" + ta.cluster : t;
    if (u === v) return;
    const key = u < v ? u + "|" + v : v + "|" + u, o = acc.get(key) || { u, v, w: 0, m: Infinity };
    o.w += a.weight; o.m = Math.min(o.m, Math.max(sa.m, ta.m)); acc.set(key, o);
  });
  acc.forEach((o, key) => G.addEdgeWithKey("a:" + key, o.u, o.v, { agg: true, weight: o.w, m: o.m, size: Math.min(4, 0.5 + Math.log2(1 + o.w)) }));
  document.querySelectorAll("#legend button").forEach((b) => b.setAttribute("aria-pressed", collapsed.has(+b.dataset.id)));
  recount(); S.renderer.refresh();
}

// ---------- hover ----------
function wireHover() {
  const tip = $("tip"), r = S.renderer;
  r.on("enterNode", ({ node, event }) => {
    const a = S.G.getNodeAttributes(node);
    tip.innerHTML = "";
    const add = (tag, txt) => { const el = document.createElement(tag); el.textContent = txt; tip.appendChild(el); };
    if (a.sup) { add("b", a.label); add("span", `${S.counts[a.cluster]} people folded. Click to unfold.`); }
    else { add("b", a.p.name); add("span", [a.p.title, a.p.company].filter(Boolean).join(" at ") || "No title or company");
      add("span", `Connected ${fmtDate(a.p.connected_on)}`); add("span", `Circle: ${S.labels[a.p.cluster]}`); }
    const box = $("graph").getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = Math.min(event.x + 12, box.width - tip.offsetWidth - 4) + "px";
    tip.style.top = Math.min(event.y + 12, box.height - tip.offsetHeight - 4) + "px";
  });
  r.on("leaveNode", () => { tip.hidden = true; });
  r.on("clickNode", ({ node }) => { const a = S.G.getNodeAttributes(node); if (a.sup) { tip.hidden = true; toggleCluster(a.cluster); } });
}

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
  ];
  $("meta").innerHTML = ""; lines.filter(Boolean).forEach((t) => { const li = document.createElement("li"); li.textContent = t; $("meta").appendChild(li); });
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
  if (busy) return;  // one run at a time; later drops/picks are ignored until it finishes
  const all = [...files], csv = all.filter((f) => /\.csv$/i.test(f.name));
  if (all.some((f) => /\.zip$/i.test(f.name)) && !csv.length) return status("Zip files are not read. Unzip the export and drop the CSV files.", true);
  if (!csv.some((f) => /^connections\.csv$/i.test(f.name))) return status("Connections.csv is required. Drop it together with Positions.csv.", true);
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
    status(`Done. ${data.meta.n_clusters} circles from ${csv.map((f) => f.name).join(", ")}. Nothing was uploaded.`);
  } catch (e) { console.error(e); status("Could not process the files: " + (e.message || e).toString().split("\n").slice(-2).join(" "), true); }
  finally { busy = false; $("pick").disabled = false; }
}

// ---------- wiring ----------
$("month").addEventListener("input", (e) => { if (!S) return; stopPlay(); setMonth(S.m0 + +e.target.value); });
$("play").addEventListener("click", play);
$("pick").addEventListener("click", () => $("files").click());
$("files").addEventListener("change", (e) => { if (e.target.files.length) runFiles(e.target.files); e.target.value = ""; });
// the whole page is the drop target; the banner highlights while files hover
const dz = $("drop");
window.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) dz.classList.remove("over"); });
window.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files.length) runFiles(e.dataTransfer.files); });
window.addEventListener("resize", () => S && drawSpark());
reduceMotion.addEventListener("change", applyMotionPref);
const retheme = () => { if (!S) return; readTokens(); S.edgeColor = T["--edge"]; S.renderer.setSetting("labelColor", { color: T["--ink"] }); recolorLegend(); S.renderer.refresh(); };
darkMQ.addEventListener("change", retheme);
new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
applyMotionPref();

(async () => {
  const p = new URLSearchParams(location.search).get("data") || "../demo/graph.json";
  const url = new URL(p, location.href);
  const fail = (msg) => { $("source").textContent = "Not loaded"; $("empty").textContent = msg; };
  if (url.origin !== location.origin) return fail("Only graph.json files served next to this page can be loaded. Open your export instead.");
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    render(data, p === "../demo/graph.json" ? `Synthetic demo: ${data.meta.n_people} fictional people` : `Loaded ${url.pathname}`);
    // recording hook: ?autoplay=1 plays the timeline once after layout (skipped under reduced motion)
    if (new URLSearchParams(location.search).get("autoplay") === "1" && !reduceMotion.matches && S.hasDates) { setMonth(S.m0); play(); }
  } catch (e) { console.error(e); fail(`Could not load ${p} (${e.message}). Serve the repo root with python3 -m http.server, or open your export.`); }
})();
