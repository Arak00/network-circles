#!/usr/bin/env python3
"""The visitor's own-data journey, end to end:  python tests/journey_test.py

Opens the viewer the way the showcase page's step 3 does (?own=1&know=...), picks the export CSVs (the synthetic
demo's, never real data), waits for the in-browser Python run, and checks:
  - the carried-over search runs on the new data and finds people
  - no request carries a body (nothing is uploaded) and every request goes to this site or the Pyodide CDN
  - how long the first run takes (the showcase page promises "about 20 seconds")
Needs network access to cdn.jsdelivr.net for Pyodide. Exit code 1 on failure."""
import glob, os, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout_test import ROOT, serve  # noqa: E402

ALLOWED = {"127.0.0.1", "cdn.jsdelivr.net"}
QUERY = "Halcyon Freight, recruiter"


def main():
    srv, fails, requests = serve(), [], []
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    files = sorted(glob.glob(os.path.join(ROOT, "demo", "data", "*.csv")))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("request", lambda r: requests.append((r.method, r.url, r.post_data)))
        page.goto(f"{base}/web/?own=1&know={QUERY}")
        if page.evaluate("window.__netmap !== undefined && window.__netmap !== null"):
            fails.append("?own=1 should not load the demo")
        if page.evaluate("document.getElementById('how').open"):
            fails.append("the first-visit dialog should not interrupt a visitor coming from the showcase page")
        t0 = time.time()
        page.set_input_files("#files", files)
        page.wait_for_function("window.__netmap && window.__netmap.renderer && /Done\\./.test(document.getElementById('status').textContent)", timeout=180000)
        secs = round(time.time() - t0, 1)
        got = page.evaluate("({ n: window.__netmap.sel ? window.__netmap.sel.size : 0, q: document.getElementById('knowQ').value, s: document.getElementById('knowSummary').textContent })")
        if got["q"] != QUERY or got["n"] < 1:
            fails.append(f"the carried-over search did not run on the new data: {got}")
        browser.close()
    srv.shutdown()
    sent = [(m, u) for m, u, body in requests if body]
    hosts = sorted({urlparse(u).hostname for _, u, _ in requests if urlparse(u).hostname})
    if sent:
        fails.append(f"requests with a body (possible upload): {sent[:3]}")
    if not set(hosts) <= ALLOWED:
        fails.append(f"requests to unexpected hosts: {sorted(set(hosts) - ALLOWED)}")
    print(f"first run: {secs} s from picking files to results; {got['n']} people found for {QUERY!r}")
    print(f"{len(requests)} requests, hosts: {hosts}, with a body: {len(sent)}")
    print(f"{len(fails)} failures")
    for f in fails:
        print("  FAIL", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
