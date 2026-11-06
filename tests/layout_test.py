#!/usr/bin/env python3
"""Layout invariants for the viewer, measured in a real browser on the synthetic test grid.

  python tests/grid.py && python tests/layout_test.py [case ...] [--axe]

For every case x width (390/768/1400) x theme (light/dark) x state (map, map+pin, layers, layers+pin):
  - no two drawn labels overlap (boxes recorded by the viewer's own label renderer)
  - Layers draws at scale >= 0.95 (fitted, or the deliberate 1:1 pan mode on narrow screens)
  - when Layers is fitted, every label is inside the canvas
  - no horizontal page scroll, no console errors
Also reports edge crossings in Layers. --axe runs axe-core on the demo case. Exit code 1 on any failure.
Writes tests/report/layout.json (synthetic data only)."""
import functools, http.server, json, os, sys, threading, time
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


def check_page(page, errors, case, width, theme, fails, crossings):
    def state(name):
        page.evaluate(FRAME)
        m = page.evaluate("window.__measure()")
        where = f"{case}/{width}/{theme}/{name}"
        ov = overlaps(m["boxes"])
        if ov:
            fails.append(f"{where}: {len(ov)} label overlaps, e.g. {ov[:3]}")
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

    state("map")
    page.evaluate(PIN_TOP); state("map+pin"); page.evaluate("clearFocus()")
    if page.evaluate("!document.getElementById('viewSwitch').hidden"):
        page.click("#vLayers"); state("layers")
        page.evaluate(PIN_TOP); state("layers+pin"); page.evaluate("clearFocus()")
        page.click("#vMap"); state("map-again")
    if page.evaluate("document.querySelector('#knowPicks .chip') !== null"):  # who-do-I-know selection on the map
        page.click("#knowPicks .chip"); state("map+know"); page.click("#knowClear")
    if errors:
        fails.append(f"{case}/{width}/{theme}: console errors {errors[:2]}")


def keyboard(page, fails):
    """Pin and release by keyboard only; a circle can be picked out without its colour."""
    name = page.evaluate("(() => { const S = window.__netmap; let best = null, deg = -1; S.G.forEachNode((k, a) => {"
                         " if (a.kind === 'person' && S.G.degree(k) > deg) { deg = S.G.degree(k); best = a.label; } }); return best; })()")
    page.focus("#find"); page.keyboard.type(name); page.keyboard.press("Enter"); page.evaluate(FRAME); page.wait_for_timeout(150)
    st = page.evaluate("({ focus: window.__netmap.focus, pinned: window.__netmap.pinned, live: document.getElementById('live').textContent,"
                       " tip: !document.getElementById('tip').hidden })")
    if not (st["focus"] and st["pinned"] and name in st["live"] and st["tip"]):
        fails.append(f"keyboard: find + Enter did not pin and announce {name!r}: {st}")
    page.keyboard.press("Escape"); page.evaluate(FRAME)
    if page.evaluate("window.__netmap.focus"):
        fails.append("keyboard: Escape did not release the pin")
    page.focus("#legend button")
    page.evaluate(FRAME)
    dimmed = page.evaluate("""(() => { const S = window.__netmap, R = S.renderer, c = +document.querySelector('#legend button').dataset.id;
      let inC = 0, outDim = 0, out = 0; S.G.forEachNode((k, a) => { if (a.kind !== 'person') return; const d = R.getNodeDisplayData(k);
        if (!d || d.hidden) return; if (a.cluster === c) inC++; else { out++; if (d.color === getComputedStyle(document.documentElement).getPropertyValue('--dim').trim()) outDim++; } });
      return { hl: S.hl, inC, out, outDim }; })()""")
    if dimmed["hl"] is None or dimmed["out"] != dimmed["outDim"] or not dimmed["inC"]:
        fails.append(f"keyboard: focusing a circle in the list did not single out its members: {dimmed}")
    page.evaluate("document.activeElement.blur()"); page.evaluate(FRAME)
    if page.evaluate("window.__netmap.hl") is not None:
        fails.append("keyboard: leaving the circle list did not clear the highlight")


def know(page, fails):
    """Who do I know at…: known answers on the demo, CSV contents, clear."""
    page.fill("#knowQ", "Kestrel Talent"); page.click("#knowForm button[type=submit]"); page.evaluate(FRAME)
    got = page.evaluate("""(() => ({ n: window.__netmap.sel.size, circles: [...document.querySelectorAll('#knowList .kp span:last-child')].map(e => e.textContent) }))()""")
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
                    page.goto(f"{base}/web/?data=../tests/out/{case}/graph.json")
                    page.wait_for_function("window.__netmap && window.__netmap.renderer", timeout=120000)
                    load[case] = max(load.get(case, 0), round(time.time() - t0, 1))
                    check_page(page, errors, case, width, theme, fails, crossings)
                    if case == "demo" and width == 1400 and theme == "light":
                        keyboard(page, fails)
                        know(page, fails)
                    if "--axe" in argv and case == "demo":
                        axe(page, f"{width}/{theme}", fails, axe_summary)
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
