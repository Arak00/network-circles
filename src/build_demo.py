"""Build a single-file demo page (synthetic data only) for static hosting: python src/build_demo.py [out.html]"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CDN = {  # same pinned versions as web/vendor/
    "vendor/graphology.umd.min.js": "https://cdn.jsdelivr.net/npm/graphology@0.26.0/dist/graphology.umd.min.js",
    "vendor/graphology-library.min.js": "https://cdn.jsdelivr.net/npm/graphology-library@0.8.0/dist/graphology-library.min.js",
    "vendor/sigma.min.js": "https://cdn.jsdelivr.net/npm/sigma@3.0.2/dist/sigma.min.js",
}
REPO_NOTE = ('<p>This is the synthetic demo: 300 fictional people. To map your own export, run the page locally from the '
             'repository; your files are read inside the tab and never uploaded.</p>'
             '<button type="button" id="pick" hidden>Open</button><input id="files" type="file" hidden>')


def build(out):
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    app = open(os.path.join(ROOT, "web", "app.js"), encoding="utf-8").read()
    graph = json.load(open(os.path.join(ROOT, "demo", "graph.json"), encoding="utf-8"))
    graph.pop("merges", None)
    for src, url in CDN.items():
        html = html.replace(f'<script src="{src}"></script>', f'<script src="{url}"></script>')
    data = json.dumps(graph, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace('<script src="app.js"></script>', f"<script>window.DEMO_GRAPH={data};</script>\n<script>\n{app}\n</script>")
    # drop mode needs Pyodide, which a static host's CSP may block: replace the banner text, keep the elements app.js expects
    html = re.sub(r'(<div id="drop")>.*?(<p id="status")', r'\1>' + REPO_NOTE + r'\2', html, flags=re.S)
    html = re.sub(r"(?is)<!doctype html>|</?html[^>]*>|</?head>|</?body>", "", html)  # artifact hosts add the skeleton
    open(out, "w", encoding="utf-8").write(html.strip() + "\n")
    print(f"wrote {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist", "demo.html"))
