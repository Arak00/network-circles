#!/usr/bin/env python3
"""Screenshots + measurements of the viewer's main journey, for before/after comparisons. Synthetic data only.

  python tests/shots.py before|after [case ...]     (default cases: demo onecircle large)

Per case x (1400 light, 1400 dark, 390 light): first screen, a who-do-I-know search, click the first result, pin the
most-connected person. Writes tests/report/<tag>-<case>-<width>-<theme>-<step>.png and tests/report/<tag>-shots.json
with, per step: camera ratio, share of on-screen nodes overlapping another node, labels drawn, people highlighted,
and whether the tooltip covers the results list."""
import json, os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout_test import FRAME, REPORT, serve  # noqa: E402

MEASURE = """() => { const S = window.__netmap, R = S.renderer, pts = [];
  S.G.forEachNode((k, a) => { const d = R.getNodeDisplayData(k); if (!d || d.hidden || a.kind === 'head') return;
    const v = R.framedGraphToViewport(d), r = R.scaleSize(d.size);
    if (v.x > -r && v.y > -r && v.x < S.box.clientWidth + r && v.y < S.box.clientHeight + r) pts.push([v.x, v.y, r]); });
  let hit = 0; for (let i = 0; i < pts.length; i++) for (let j = 0; j < pts.length; j++)
    if (i !== j && Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < (pts[i][2] + pts[j][2]) * 0.9) { hit++; break; }
  const rect = (id) => { const e = document.getElementById(id); return e && !e.hidden && e.offsetParent ? e.getBoundingClientRect() : null; };
  const t = rect('tip'), l = rect('knowList') || rect('results');
  const cover = !!(t && l && t.width && l.width && t.left < l.right && l.left < t.right && t.top < l.bottom && l.top < t.bottom);
  const list = l ? (l.bottom > 0 && l.top < innerHeight && l.height > 0) : false;
  return { ratio: +R.getCamera().ratio.toFixed(3), onScreen: pts.length, overlapShare: pts.length ? +(hit / pts.length).toFixed(2) : 0,
           labels: S.boxes.size, highlighted: S.near ? S.near.size : (S.sel ? S.sel.size : 0), tipCoversList: cover, listVisible: list,
           status: (document.getElementById('status') || {}).textContent || '' }; }"""


def run(tag, cases):
    srv = serve(); base = f"http://127.0.0.1:{srv.server_address[1]}"; out = {}
    os.makedirs(REPORT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for case in cases:
            for width, theme in ((1400, "light"), (1400, "dark"), (390, "light")):
                ctx = b.new_context(viewport={"width": width, "height": 900}, color_scheme=theme, reduced_motion="reduce")
                ctx.add_init_script("try { localStorage.setItem('nc.seenHow', '1') } catch (e) {}")
                pg = ctx.new_page(); pg.set_default_timeout(120000)
                pg.goto(f"{base}/web/?data=../tests/out/{case}/graph.json")
                pg.wait_for_function("window.__netmap && window.__netmap.renderer", timeout=120000)
                key = f"{case}-{width}-{theme}"; out[key] = {}
                def shot(step):
                    pg.evaluate(FRAME); pg.wait_for_timeout(700)
                    out[key][step] = pg.evaluate(MEASURE)
                    pg.screenshot(path=os.path.join(REPORT, f"{tag}-{key}-{step}.png"), full_page=width < 800)
                shot("1-first")
                q = "Kestrel Talent" if case == "demo" else pg.evaluate("document.querySelector('#knowPicks .chip, .chip')?.textContent || ''")
                pg.evaluate("q => window.__shotSearch ? window.__shotSearch(q) : (document.getElementById('knowQ').value = q, runKnow())", q)
                shot("2-search")
                pg.evaluate("() => (document.querySelector('#knowList .kp, #results .kp')).click()")
                pg.wait_for_timeout(800); shot("3-result")
                pg.evaluate("() => { const S = window.__netmap; let best = null, deg = -1; S.G.forEachNode((k, a) => {"
                            " if (a.kind === 'person' && S.G.degree(k) > deg) { deg = S.G.degree(k); best = k; } }); window.__shotPin ? window.__shotPin(best) : setFocus(best, true); }")
                shot("4-pin")
                ctx.close()
            print(case, json.dumps({k: v for k, v in out.items() if k.startswith(case)}, indent=None)[:1500], flush=True)
        b.close()
    srv.shutdown()
    with open(os.path.join(REPORT, f"{tag}-shots.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2:] or ["demo", "onecircle", "large"])
