#!/usr/bin/env python3
"""The visitor's own-data journey, end to end:  python tests/journey_test.py

Opens the viewer the way the showcase page's step 3 does (?own=1&know=...), picks the export (built from the synthetic
demo, never real data) in four forms: the CSV files; a zip with the files in a folder and a decoy messages.csv whose
compressed bytes are corrupted (the run fails if the viewer ever opens it); a streamed zip that stores sizes after the
data; and a zip without Connections.csv, which must give a clear error. For each, it waits for the in-browser run and
checks:
  - the carried-over search runs on the new data and finds people
  - no request carries a body (nothing is uploaded) and every request goes to this site or the Pyodide CDN
  - how long the first run takes (the showcase page promises "about 20 seconds")
Needs network access to cdn.jsdelivr.net for Pyodide. Exit code 1 on failure."""
import glob, io, os, sys, tempfile, time, zipfile
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout_test import ROOT, serve  # noqa: E402

ALLOWED = {"127.0.0.1", "cdn.jsdelivr.net"}
QUERY = "Halcyon Freight, recruiter"


class NoSeek(io.RawIOBase):  # makes zipfile stream, writing sizes in data descriptors after each entry
    def __init__(self, f): self.f = f
    def writable(self): return True
    def write(self, b): return self.f.write(b)


def make_zip(path, csvs, streamed=False, skip=()):
    out = open(path, "wb")
    with zipfile.ZipFile(NoSeek(out) if streamed else out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in csvs:
            if os.path.basename(f) not in skip:
                z.write(f, "Basic_LinkedInDataExport/" + os.path.basename(f))
        z.writestr("Basic_LinkedInDataExport/messages.csv", "FROM,TO,CONTENT\n" + "private,private,never read\n" * 200)
    out.close()
    if not streamed:  # corrupt the decoy's compressed bytes: reading it would throw
        with zipfile.ZipFile(path) as z:
            info = z.getinfo("Basic_LinkedInDataExport/messages.csv")
        with open(path, "r+b") as f:
            f.seek(info.header_offset + 26); n, x = int.from_bytes(f.read(2), "little"), int.from_bytes(f.read(2), "little")
            f.seek(info.header_offset + 30 + n + x); f.write(b"\xff" * info.compress_size)


def run(browser, base, label, files, fails, requests, expect_error=None):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.on("request", lambda r: requests.append((r.method, r.url, r.post_data)))
    page.goto(f"{base}/web/?own=1&know={QUERY}")
    if page.evaluate("window.__netmap !== undefined && window.__netmap !== null"):
        fails.append(f"{label}: ?own=1 should not load the demo")
    if page.evaluate("document.getElementById('how').open"):
        fails.append(f"{label}: the first-visit dialog should not interrupt a visitor coming from the showcase page")
    t0 = time.time()
    page.set_input_files("#files", files)
    if expect_error:
        page.wait_for_function("document.getElementById('status').classList.contains('err')", timeout=60000)
        msg = page.evaluate("document.getElementById('status').textContent")
        if expect_error not in msg:
            fails.append(f"{label}: expected an error mentioning {expect_error!r}, got {msg!r}")
        print(f"{label}: error shown: {msg}")
        return page.close()
    page.wait_for_function("window.__netmap && window.__netmap.renderer && /^Done/.test(document.getElementById('status').textContent)"
                           " || document.getElementById('status').classList.contains('err')", timeout=180000)
    status_text = page.evaluate("document.getElementById('status').textContent")
    secs = round(time.time() - t0, 1)
    got = page.evaluate("({ n: window.__netmap && window.__netmap.sel ? window.__netmap.sel.size : 0, q: document.getElementById('knowQ').value })")
    if got["q"] != QUERY or got["n"] < 1:
        fails.append(f"{label}: the carried-over search did not run on the new data: {got}, status {status_text!r}")
    print(f"{label}: {secs} s from picking files to results; {got['n']} people found for {QUERY!r}")
    page.close()
    return got["n"]


def main():
    srv, fails, requests = serve(), [], []
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    files = sorted(glob.glob(os.path.join(ROOT, "demo", "data", "*.csv")))
    tmp = tempfile.mkdtemp()
    zips = {k: os.path.join(tmp, f"{k}.zip") for k in ("archive", "streamed", "no-connections")}
    make_zip(zips["archive"], files)
    make_zip(zips["streamed"], files, streamed=True)
    make_zip(zips["no-connections"], files, skip=("Connections.csv",))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        n_csv = run(browser, base, "csv files", files, fails, requests)
        n_zip = run(browser, base, "zip", [zips["archive"]], fails, requests)
        n_str = run(browser, base, "streamed zip", [zips["streamed"]], fails, requests)
        run(browser, base, "zip without Connections.csv", [zips["no-connections"]], fails, requests, expect_error="no Connections.csv")
        if not (n_csv == n_zip == n_str):
            fails.append(f"zip and CSV gave different results: csv {n_csv}, zip {n_zip}, streamed {n_str}")
        browser.close()
    srv.shutdown()
    sent = [(m, u) for m, u, body in requests if body]
    hosts = sorted({urlparse(u).hostname for _, u, _ in requests if urlparse(u).hostname})
    if sent:
        fails.append(f"requests with a body (possible upload): {sent[:3]}")
    if not set(hosts) <= ALLOWED:
        fails.append(f"requests to unexpected hosts: {sorted(set(hosts) - ALLOWED)}")
    print(f"{len(requests)} requests, hosts: {hosts}, with a body: {len(sent)}")
    print(f"{len(fails)} failures")
    for f in fails:
        print("  FAIL", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
