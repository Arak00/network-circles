#!/usr/bin/env python3
"""Layout invariants for the viewer, measured in a real browser on the synthetic test grid.

  python tests/grid.py && python tests/layout_test.py [case ...] [--axe]

For every case x width (390/768/1400) x theme (light/dark), in the List layout: map, map+result (search, click the
first result), map+pin, layers, layers+pin, map again; then the Map and Circles layouts with a result clicked:
  - no two drawn labels overlap (boxes recorded by the viewer's own label renderer)
  - Map: no dot overlaps another, no label covers a dot, the camera never zooms out past the fit
  - a pin or a search names at most 20 people on the map
  - search results stay listed and visible while a person is pinned
  - the status line is one short sentence; the timeline is collapsed exactly when most connections fall in 3 months
  - Layers draws at scale >= 0.95 (fitted, or the deliberate 1:1 pan mode on narrow screens)
  - when Layers is fitted, every label is inside the canvas
  - no horizontal page scroll, no console errors
Also reports edge crossings in Layers. --axe runs axe-core on the demo case. Exit code 1 on any failure.
Writes tests/report/layout.json (synthetic data only)."""
import functools, http.server, json, os, re, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT, REPORT = os.path.join(ROOT, "tests", "out"), os.path.join(ROOT, "tests", "report")
WIDTHS, THEMES = (390, 768, 1400), ("light", "dark")
AXE = "https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js"
SLACK = 1.0  # px of overlap tolerated (antialiasing)


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def dot_overlaps(dots):
    """-> pairs of dots (x, y, r, key, kind) whose discs overlap by more than SLACK px."""
    out, ds = [], sorted(dots)
    for i, a in enumerate(ds):
        for b in ds[i + 1:]:
            if b[0] - b[2] >= a[0] + a[2] - SLACK:
                break
            if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 < a[2] + b[2] - SLACK:
                out.append((a[3], b[3]))
    return out


def labels_on_dots(boxes, dots):
    """-> (label, dot key) where a label box covers a dot other than its own by more than SLACK px."""
    out = []
    for bx in boxes:
        for x, y, r, k, _ in dots:
            if k == bx.get("key"):
                continue
            dx, dy = x - max(bx["x"], min(x, bx["x"] + bx["w"])), y - max(bx["y"], min(y, bx["y"] + bx["h"]))
            if (dx * dx + dy * dy) ** 0.5 < r - SLACK:
                out.append((bx["label"], k))
    return out


def overlaps(boxes):
    """-> list of (label_a, label_b) whose boxes intersect by more than SLACK px on both axes."""
    out, bs = [], sorted(boxes, key=lambda b: b["x"])
    for i, a in enumerate(bs):
        for b in bs[i + 1:]:
            if b["x"] >= a["x"] + a["w"] - SLACK:
                break
            if min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]) > SLACK:
                out.append((a["label"], b["label"]))
    return out


FRAME = "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))"
# pin the most-connected node that is currently drawn (people in Map, layer or circle nodes in Layers)
PIN_TOP = """() => { const S = window.__netmap, R = S.renderer; let best = null, deg = -1;
  S.G.forEachNode((k, a) => { const d = R.getNodeDisplayData(k); if (!d || d.hidden || a.kind === "head") return;
    const n = S.G.degree(k); if (n > deg) { deg = n; best = k; } });
  setFocus(best, true); return best; }"""


PEOPLE_NAMED = "() => window.__measure().boxes.filter(b => window.__netmap.G.hasNode(b.key) && window.__netmap.G.getNodeAttribute(b.key, 'kind') === 'person').length"
RESULTS = """() => { const l = document.getElementById('knowList'), r = l.getBoundingClientRect();
  return { rows: l.querySelectorAll('li[data-k]').length, shown: !!l.offsetParent && r.height > 0 }; }"""


def check_page(page, errors, case, width, theme, fails, crossings):
    def state(name):
        page.evaluate(FRAME)
        m = page.evaluate("window.__measure()")
        where = f"{case}/{width}/{theme}/{name}"
        ov = overlaps(m["boxes"])
        if ov:
            fails.append(f"{where}: {len(ov)} label overlaps, e.g. {ov[:3]}")
        if m["view"] == "map" and m["page"] != "circles":
            do, ld = dot_overlaps(m["dots"]), labels_on_dots(m["boxes"], m["dots"])
            if do:
                fails.append(f"{where}: {len(do)} dots overlap another, e.g. {do[:3]}")
            if ld:
                fails.append(f"{where}: {len(ld)} labels cover a dot, e.g. {ld[:3]}")
            if m["ratio"] > 1.0001:
                fails.append(f"{where}: zoomed out past the fit (ratio {m['ratio']})")
            named = page.evaluate(PEOPLE_NAMED)
            if named > 20:
                fails.append(f"{where}: {named} people named on the map (max 20)")
        if m["view"] == "layers":
            if m["scale"] is None or m["scale"] < 0.95:
                fails.append(f"{where}: Layers scale {m['scale']}")
            if page.evaluate("window.__netmap.layersFit") >= 1:
                off = [b["label"] for b in m["boxes"] if b["x"] < -SLACK or b["x"] + b["w"] > m["width"] + SLACK]
                if off:
                    fails.append(f"{where}: {len(off)} labels outside the canvas, e.g. {off[:3]}")
            if name == "layers" and theme == "light":
                crossings[f"{case}/{width}"] = {"crossings": m["crossings"], "edges": m["edges"], "layout": m.get("layout")}
        if page.evaluate("document.documentElement.scrollWidth > innerWidth"):
            fails.append(f"{where}: horizontal page scroll")
        return m

    st = page.evaluate("document.getElementById('status').textContent")
    if not re.fullmatch(r"[^.]+\.", st) or "/" in st or ".csv" in st or len(st) > 90:
        fails.append(f"{case}/{width}/{theme}: status is not one short sentence: {st!r}")
    tl = page.evaluate("({ hidden: document.getElementById('timeline').hidden, bunched: window.__netmap.bunched, sum: document.getElementById('tsum').textContent })")
    if case == "bunched" and not (tl["bunched"] and tl["hidden"]) or case == "demo" and tl["hidden"]:
        fails.append(f"{case}/{width}/{theme}: timeline should be collapsed only when connections bunch up: {tl}")
    state("map")
    chip = page.evaluate("document.querySelector('#knowPicks .chip')?.textContent")
    if chip:  # search, then click the first result: context kept, results kept
        page.fill("#knowQ", chip); page.press("#knowQ", "Enter"); page.evaluate(FRAME)
        before = page.evaluate(RESULTS)
        page.click("#knowList li[data-k] .kp"); state("map+result")
        page.evaluate(PIN_TOP); state("map+result+pin")
        after = page.evaluate(RESULTS)
        if after["rows"] != before["rows"] or not after["shown"]:
            fails.append(f"{case}/{width}/{theme}: results changed or hid while a person was pinned: {before} -> {after}")
        page.click("#knowClear")
    page.evaluate(PIN_TOP); state("map+pin"); page.evaluate("clearFocus()")
    if page.evaluate("!document.getElementById('viewSwitch').hidden"):
        page.click("#vLayers"); state("layers")
        page.evaluate(PIN_TOP); state("layers+pin"); page.evaluate("clearFocus()")
        page.click("#vMap"); state("map-again")
    if page.evaluate("document.querySelector('#knowPicks .chip') !== null"):  # who-do-I-know selection on the map
        page.click("#knowPicks .chip"); state("map+know")
        for view in ("map", "circles"):  # the other two layouts, with a result pinned
            page.click(f"#pageView [data-view={view}]"); page.wait_for_timeout(150)
            page.click("#knowList li[data-k] .kp"); state(f"{view}-layout+result")
            if not page.evaluate(RESULTS)["shown"]:
                fails.append(f"{case}/{width}/{theme}/{view}: results hidden while a person is pinned")
            page.keyboard.press("Escape")
        page.click("#pageView [data-view=list]"); page.click("#knowClear")
    # Ways in: companies ranked by who could get you in; pointing at one lights its people and names who to ask
    page.click("#pageView [data-view=ways]"); state("ways")
    w = page.evaluate("""() => { const W = window.__netmap.ways; return { rows: document.querySelectorAll('#waysOut .wr').length, total: W.rows.length,
        title: document.getElementById('waysTitle').textContent, mine: W.rows.filter((c) => c.people.some((p) => p.kind === 'mine')).length }; }""")
    where = f"{case}/{width}/{theme}/ways"
    if w["total"] and not w["rows"]:
        fails.append(f"{where}: {w['total']} companies but the board is empty")
    if not re.match(r"You have a way into \d+ compan", w["title"]):
        fails.append(f"{where}: headline {w['title']!r}")
    if w["mine"]:
        fails.append(f"{where}: {w['mine']} rows hold people at places you worked")
    if w["rows"]:
        page.hover("#waysOut .wr >> nth=0"); m = state("ways+row")
        got = page.evaluate("() => { const S = window.__netmap, c = S.ways.byK.get(S.ways.hover); return { sel: S.sel ? S.sel.size : 0, want: c ? c.people.length : -1 }; }")
        if got["sel"] != got["want"] or got["want"] < 1:
            fails.append(f"{where}: pointing at a company should light its people on the map: {got}")
        if not any(b["label"].startswith("Ask ") for b in m["boxes"]):
            fails.append(f"{where}: the person to ask isn't named on the map")
        page.mouse.move(0, 0)
    page.click("#pageView [data-view=list]")
    if errors:
        fails.append(f"{case}/{width}/{theme}: console errors {errors[:2]}")


def keyboard(page, fails):
    """Pin and release by keyboard only; a circle can be picked out without its colour."""
    name = page.evaluate("(() => { const S = window.__netmap; let best = null, deg = -1; S.G.forEachNode((k, a) => {"
                         " if (a.kind === 'person' && S.G.degree(k) > deg) { deg = S.G.degree(k); best = a.label; } }); return best; })()")
    page.focus("#knowQ"); page.keyboard.type(name); page.keyboard.press("Enter"); page.evaluate(FRAME)
    page.focus("#knowList li[data-k] .kp"); page.keyboard.press("Enter"); page.evaluate(FRAME); page.wait_for_timeout(150)
    st = page.evaluate("({ focus: window.__netmap.focus, pinned: window.__netmap.pinned, live: document.getElementById('live').textContent,"
                       " detail: !!document.querySelector('#knowList li.on .detail') })")
    if not (st["focus"] and st["pinned"] and name in st["live"] and st["detail"]):
        fails.append(f"keyboard: search + Enter on a result did not pin, open and announce {name!r}: {st}")
    page.keyboard.press("Escape"); page.evaluate(FRAME)
    if page.evaluate("window.__netmap.focus"):
        fails.append("keyboard: Escape did not release the pin")
    page.focus("#legend button")
    page.evaluate(FRAME)
    dimmed = page.evaluate("""(() => { const S = window.__netmap, R = S.renderer, c = +document.querySelector('#legend button').dataset.id;
      let inC = 0, outDim = 0, out = 0; S.G.forEachNode((k, a) => { if (a.kind !== 'person') return; const d = R.getNodeDisplayData(k);
        if (!d || d.hidden) return; if (a.cluster === c) inC++; else { out++; if (d.color !== colorOf(a.cluster)) outDim++; } });
      return { hl: S.hl, inC, out, outDim }; })()""")
    if dimmed["hl"] is None or dimmed["out"] != dimmed["outDim"] or not dimmed["inC"]:
        fails.append(f"keyboard: focusing a circle in the list did not single out its members: {dimmed}")
    page.evaluate("document.activeElement.blur()"); page.evaluate(FRAME)
    if page.evaluate("window.__netmap.hl") is not None:
        fails.append("keyboard: leaving the circle list did not clear the highlight")


def know(page, fails):
    """Who do I know at…: known answers on the demo, CSV contents, clear."""
    page.fill("#knowQ", "Kestrel Talent"); page.click("#knowForm button[type=submit]"); page.evaluate(FRAME)
    got = page.evaluate("""(() => ({ n: window.__netmap.sel.size, circles: [...document.querySelectorAll('#knowList li[data-k] .kp')]
      .filter(b => window.__netmap.G.getNodeAttribute(b.parentNode.dataset.k, 'kind') === 'person').map(b => b.querySelector('span:last-child').textContent) }))()""")
    if got["n"] != 2 or not all(c.startswith("Glimmer Networks · eng · ") for c in got["circles"]):
        fails.append(f"know: Kestrel Talent should give 2 people in Glimmer Networks · eng, got {got}")
    with page.expect_download() as dl:
        page.click("#knowCsv")
    rows = open(dl.value.path(), encoding="utf-8-sig").read().strip().split("\n")
    if len(rows) != 3 or not rows[0].startswith('"search","matched on","name"'):
        fails.append(f"know: CSV should have a header and 2 rows, got {len(rows)} lines")
    page.click("#knowClear"); page.evaluate(FRAME)
    if page.evaluate("window.__netmap.sel !== null"):
        fails.append("know: Clear did not remove the selection")


def axe(page, where, fails, summary):
    page.add_script_tag(url=AXE)
    res = page.evaluate("axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => "
                        "({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help })))")
    summary[where] = res
    for v in res:
        if v["impact"] in ("serious", "critical"):
            fails.append(f"axe {where}: {v['impact']} {v['id']} x{v['n']} ({v['help']})")


def main(argv):
    cases = [a for a in argv if not a.startswith("--")] or sorted(os.listdir(OUT))
    srv, fails, crossings, axe_summary, load = serve(), [], {}, {}, {}
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for case in cases:
            for width in WIDTHS:
                for theme in THEMES:
                    ctx = browser.new_context(viewport={"width": width, "height": 900}, color_scheme=theme, reduced_motion="reduce")
                    ctx.add_init_script("try { localStorage.setItem('nc.seenHow', '1') } catch (e) {}")
                    page, errors = ctx.new_page(), []
                    # Headless Chromium draws WebGL in software: with ~190k edges (the 3,000-person case) one frame can
                    # take 15 s+ of native time that a real GPU doesn't need, so give clicks room instead of failing.
                    page.set_default_timeout(120000)
                    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    t0 = time.time()
                    page.goto(f"{base}/web/?data=../tests/out/{case}/graph.json&view=list")
                    page.wait_for_function("window.__netmap && window.__netmap.renderer", timeout=120000)
                    load[case] = max(load.get(case, 0), round(time.time() - t0, 1))
                    check_page(page, errors, case, width, theme, fails, crossings)
                    if case == "demo" and width == 1400 and theme == "light":
                        keyboard(page, fails)
                        know(page, fails)
                    if "--axe" in argv and case == "demo":
                        axe(page, f"{width}/{theme}", fails, axe_summary)
                        page.click("#pageView [data-view=ways]"); page.evaluate(FRAME)
                        axe(page, f"ways/{width}/{theme}", fails, axe_summary)
                    ctx.close()
            print(f"{case}: done, {len(fails)} failures so far", flush=True)
        browser.close()
    srv.shutdown()
    os.makedirs(REPORT, exist_ok=True)
    with open(os.path.join(REPORT, "layout.json"), "w", encoding="utf-8") as f:
        json.dump({"fails": fails, "crossings": crossings, "axe": axe_summary, "load_s": load}, f, ensure_ascii=False, indent=1)
    print("\nLayers crossings (case/width: crossings of drawn edges):")
    for k, v in crossings.items():
        lay = v.get("layout") or {}
        print(f"  {k:18} {v['crossings']:6} drawn / {v['edges']} edges   (layout: first pass {lay.get('crossingsBefore')}, kept {lay.get('crossingsAfter')})")
    print("\nslowest load per case (s):", load)
    print(f"\n{len(fails)} failures")
    for f_ in fails[:60]:
        print("  FAIL", f_)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
