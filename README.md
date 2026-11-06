# LinkedIn network map

A small tool that turns your LinkedIn data export into a map of where your network comes from. It groups your connections into circles based on shared current companies and on people you added around the same days, then lets you collapse circles and play back how they grew month by month. Everything runs on your machine or inside your browser tab, and the public demo uses synthetic people only. The export has no ties between your contacts, so the groups are inferences; [docs/writeup.md](docs/writeup.md) explains what that means for how far to trust them.

<!-- Screenshot placeholder: add docs/screenshot.png of the synthetic demo here. -->
![Network map of the synthetic demo](docs/screenshot.png)

## Who do I know at…

Type the companies or roles you're aiming for in the side panel and the viewer lists the people you're connected to there, longest-known first, with the circle each one belongs to. They're highlighted on the map and you can download the list as a CSV. It's the use case that came out on top of the persona research in [research/findings.md](research/findings.md). [who/](who/) is a page that explains it and walks a visitor from requesting their LinkedIn data to their first search; `web/?know=Acme,recruiter` opens the viewer with a search filled in, and `&own=1` waits for the visitor's files instead of showing the demo.

## Quick start

```sh
uv venv && uv pip install -r requirements.txt
# or: python -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Request your data from LinkedIn (Settings, Data privacy, Get a copy of your data) and unzip it into a folder. Members in the EEA or Switzerland can also pull the same data through LinkedIn's DMA portability API, which needs no partner approval:

```sh
LINKEDIN_TOKEN=... python src/fetch_snapshot.py data/api    # setup steps are at the top of the script
```

The script writes export-style CSVs into `data/api/` and prints only row counts and column names. It never requests messages. Then either:

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
# open http://localhost:8000/web/ and drop the export's CSV files on the page
```

Opening `/web/` with no file shows the synthetic demo. Drop mode downloads the Pyodide runtime (about 10 MB) from jsDelivr the first time. You can pick the zip LinkedIn sends as it is: the viewer decompresses only the files it uses (with the browser's `DecompressionStream`) and never unpacks the rest, such as messages. Unzipped CSV files work too.

## Which export files are used

- `Connections.csv` (required): first and last name, current company, title and connected-on date.
- `Positions.csv` (optional): your own jobs. They become organisation nodes, and feed optional links that are off by default.
- `Invitations.csv` and `Recommendations_Received.csv` are loaded if present but don't affect the result yet.
- An optional `merge_overrides.csv` (`raw,canonical`) in the export folder corrects company merges.

These files add layers around the people. They don't change the circles.

| File | Layer | Linked to |
|---|---|---|
| `Skills.csv`, `Endorsement_Received_Info.csv`, `Endorsement_Given_Info.csv` | skills | the connections who endorsed you, or whom you endorsed |
| `Positions.csv`, `Education.csv`, `Company Follows.csv` | organisations | connections who work there now |
| `Events.csv` | events | connections you added in the 7 days after |
| `Shares.csv`, `Comments.csv` | posts | the hashtags and skills they mention (comments only when they mention one) |
| `Groups.csv` | groups | hashtags and skills in the group name |
| `Member_Follows.csv` | people you follow | flags connections; the rest hang off "You" |

`Reactions.csv` is only counted, since it doesn't say whose post you reacted to. LinkedIn gives no list of your followers, through the export or any API, so followers can't be shown. The viewer has two layouts. Map places each layer node next to the people it links to. Layers puts each kind in its own column, ordered so that linked nodes sit at similar heights.

Messages are never read: `netmap.py` doesn't open `messages.csv`, and `fetch_snapshot.py` doesn't request the inbox. Email addresses and profile URLs from `Connections.csv` are not copied into the output. In the browser, CSVs other than the ones listed here are copied into the tab's memory and ignored.

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

This rewrites `results/metrics.json` with the hand-label section set to `pending`. Real-export aggregates only ever go to `results/private/metrics_real.json`. The SNAP section also stays `pending` unless you download `https://snap.stanford.edu/data/facebook.tar.gz` and extract it into `data/snap/`.

## Repo layout

```
src/netmap.py       pipeline: load, merge, affiliations, projection, Leiden, graph.json
src/fetch_snapshot.py  pulls your own data through the DMA portability API (EEA/Switzerland)
src/synth.py        seeded generator for the fictional demo export, layer files included
src/validate.py     validation, writes results/metrics.json (aggregates only)
web/                viewer (index.html, app.js, vendored sigma.js and graphology)
demo/               synthetic export, planted truth and its graph.json
docs/               write-up, method diagram, tester form
results/metrics.json
plans/              build plan
```

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Released under the [MIT License](LICENSE).
