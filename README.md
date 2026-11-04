# LinkedIn network map

A small tool that turns your LinkedIn data export into a map of where your network comes from. It groups your connections into circles based on shared current companies and on people you added around the same days, then lets you collapse circles and play back how they grew month by month. Everything runs on your machine or inside your browser tab, and the public demo uses synthetic people only. The export has no ties between your contacts, so the groups are inferences; [docs/writeup.md](docs/writeup.md) explains what that means for how far to trust them.

<!-- Screenshot placeholder: add docs/screenshot.png of the synthetic demo here. -->
![Network map of the synthetic demo](docs/screenshot.png)

## Quick start

```sh
uv venv && uv pip install -r requirements.txt
# or: python -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Request your data from LinkedIn (Settings, Data privacy, Get a copy of your data) and unzip it into a folder. Then either:

Run it from the command line and view the result:

```sh
python src/netmap.py <export_dir> results/private/graph.json
python -m http.server
# open http://localhost:8000/web/?data=../results/private/graph.json
```

The script prints counts only. It also writes `merges.csv` (the company spellings it merged) next to the output, so write into `results/private/`, which is gitignored.

Or skip the command line:

```sh
python -m http.server
# open http://localhost:8000/web/ and drop Connections.csv and Positions.csv on the page
```

Opening `/web/` with no file shows the synthetic demo. Drop mode downloads the Pyodide runtime (about 10 MB) from jsDelivr the first time. It doesn't read zip files, so unzip the export first.

## Which export files are used

- `Connections.csv` (required): first and last name, current company, title and connected-on date.
- `Positions.csv` (optional): your own jobs, used only by the optional links that are off by default.
- `Invitations.csv` and `Recommendations_Received.csv` are loaded if present but don't affect the result yet.
- An optional `merge_overrides.csv` (`raw,canonical`) in the export folder corrects company merges.

Messages are never read: `netmap.py` doesn't open `messages.csv`. Email addresses and profile URLs from `Connections.csv` are not copied into the output. In the browser, drop only the two files above; any other CSV you drop is copied into the tab's memory and ignored.

## Privacy

- In drop mode your files are read inside the tab and processed there. Nothing is uploaded.
- `data/` and `results/private/` are gitignored. Keep your export and anything generated from it there.
- Never commit your export, a `graph.json` or `merges.csv` built from it, or screenshots with real names.
- The repo contains only the synthetic export in `demo/` and aggregate metrics in `results/metrics.json`.

## Validation

The clustering is checked against SNAP ego-Facebook circles, planted circles in the synthetic export, seed stability, two null models and a weight ablation. Checks against hand labels and outside testers are still pending. The full table, with the n, range and limits of each number, is in [docs/writeup.md](docs/writeup.md).

To regenerate the synthetic-data metrics:

```sh
python src/validate.py run none
```

This rewrites `results/metrics.json` and sets the real-data and hand-label sections to `pending`. The SNAP section also stays `pending` unless you download `https://snap.stanford.edu/data/facebook.tar.gz` and extract it into `data/snap/`.

## Repo layout

```
src/netmap.py       pipeline: load, merge, affiliations, projection, Leiden, graph.json
src/synth.py        seeded generator for the fictional demo export
src/validate.py     validation, writes results/metrics.json (aggregates only)
web/                viewer (index.html, app.js, vendored sigma.js and graphology)
demo/               synthetic export, planted truth and its graph.json
docs/               write-up, method diagram, tester form
results/metrics.json
plans/              build plan
```

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Released under the [MIT License](LICENSE).
