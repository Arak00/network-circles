# Plan 01: Network map ("where your network comes from")

## Primary goal
Someone drops their LinkedIn export into a local page and, without any data leaving the tab,
sees their connections grouped into the circles they came from, how those circles grew over
time, and how far to trust each grouping. A public demo shows the same thing on synthetic data.

Constraints: RESUME.md (privacy, no employer material, neutral framing, one weekend, ponytail).
Option A was chosen on 2026-11-04: no betweenness or Burt's constraint, because the export has no
alter-to-alter edges.

---

## Phase 0: Documentation discovery (done 2026-11-04)
**How this serves the primary goal:** one code path has to run both locally and in the browser,
so it can only use APIs that exist in both places.

Verified by running them (Python 3.12 venv; Pyodide lock v0.27.7):
- `igraph.Graph.community_leiden(objective_function='modularity', weights=, resolution=, n_iterations=-1)`.
  Seed it with `random.seed(s)` (python-igraph uses Python's RNG). Same seed gives the same partition (checked on Zachary).
- `igraph.compare_communities(a, b, method='ari'|'nmi')` for ARI/NMI. No sklearn needed.
- `igraph.Graph.Degree_Sequence(out, method='configuration')` for the null model. `g.modularity(membership, weights=)`.
- `igraph.Graph.bipartite_projection(types=, multiplicity=True)` exists, but the weights are custom, so we build edges directly.
- Pyodide 0.27.7 ships `igraph 0.11.4`, `pandas 2.2.3` and `networkx`. **No leidenalg, no rapidfuzz.**
  So: no leidenalg import and no rapidfuzz; fuzzy matching uses stdlib `difflib.SequenceMatcher`.
- JS (UMD, jsDelivr, return 200): `sigma@3.0.2/dist/sigma.min.js`, `graphology@0.26.0/dist/graphology.umd.min.js`,
  `graphology-library@0.8.0/dist/graphology-library.min.js` (has `layout.forceAtlas2`), `pyodide v0.27.7 full`.
  sigma 4 is out, but 3.0.2 has a known UMD build. Use 3.0.2.
- SNAP `https://snap.stanford.edu/data/facebook.tar.gz` returns 200 (has `*.circles` and `*.edges` per ego).
- Export CSV quirk: Connections.csv has a "Notes:" preamble. Find the header row by scanning for the first row with >2 fields.
  Dates: Connections `%d %b %Y`; Positions `%b %Y` or `%Y`, with an empty Finished On meaning "current".

Anti-patterns: `import leidenalg` / `import rapidfuzz` in netmap.py (breaks Pyodide); sigma 4 ESM-only imports;
any `fetch`/XHR with a body in web/.

---

## Phase 1: Pipeline core: `src/netmap.py` (one file, stdlib + pandas + igraph)
**How this serves the primary goal:** this is the analysis itself. The same file runs from the
CLI and inside Pyodide, so the local result and the drop-in result are identical.

Implement:
1. `load(dir)` reads Connections, Positions, Invitations (optional) and Recommendations (optional), using the header-scan quirk above.
2. `clean(name)` lowercases the name, strips legal suffixes (inc, ltd, gmbh, sa, sas, llc, plc, group, bv),
   punctuation and a leading "the". `merge(names, cutoff=0.88)` uses greedy difflib clustering, picking the
   most frequent spelling as canonical. It writes a `merges.csv` (raw, canonical, score) for review and reads
   an optional `merge_overrides.csv` (raw, canonical) that wins.
3. Each person gets four "affiliations" (orgs in the bipartite graph):
   - `co:` merged current company
   - `ego:` your own position whose company fuzzy-matches their current company ("works where you worked")
   - `role:` role family from the title, using a keyword map (eng, product, design, data, sales/bd, marketing,
     recruiting/hr, founder/exec, finance, ops, research/academia, student, other). Note: a ~30-line dict, not ML.
   - `era:` your position active on their Connected On date (the most recent if several overlap).
4. Projection: for each pair sharing affiliation(s), the weight is the sum of per-type weights
   `W = {co: 1.0, ego: 0.8, era: w_era, role: w_role}`. Large affiliations (role, era) would form huge cliques,
   so scale their contribution by `1/log2(size+1)`. Note in a comment: O(n²) per affiliation, fine for under 5k
   connections; use a sparse kNN if that's ever too slow.
5. Leiden with modularity, `resolution` param, seed. Isolates are kept as their own "unplaced" group, which is reported, not hidden.
6. Output `graph.json`: nodes {id, name, company, title, role, connected_on, cluster}, edges {s, t, w},
   clusters {id, size, label = top company + top role, cohesion = internal weight share}, plus `meta` (counts,
   share of isolates, weights used). Cluster labels are generated, never hand-written.
7. CLI: `python src/netmap.py data/ out/graph.json`. Real data goes to `results/private/` (gitignored).

Verification: `__main__` self-check: a tiny inline fixture of 3 companies plus noise recovers 3 clusters
with ARI = 1; `merge()` joins "Acme Inc." and "ACME"; the header scan handles the Notes preamble.
Then a real run: print counts only (no names).

Anti-patterns: per-type weight config files; classes; pandas-only tricks that Pyodide's pandas 2.2 lacks.

---

## Phase 2: Synthetic export generator: `src/synth.py`
**How this serves the primary goal:** the public demo must never contain real people. Planted
ground truth also gives a sanity check that the pipeline recovers known circles.

Implement: a seeded generator that writes export-shaped CSVs (same headers and preamble) for one fictional
ego with about 6 planted circles (e.g. two past employers, a university, a meetup scene, a client
company, recruiters). It includes realistic noise: company spelling variants, 70% singleton companies,
and a bootstrap burst in the timeline. Names come from a small first/last list, and the fictional companies
are checked against a deny-list. Writes `demo/data/*.csv` + `demo/truth.csv`.

Verification: running netmap on the synthetic data gives an ARI vs truth, reported in metrics as a "synthetic recovery" number.
Grep check: no company or last name from data/Connections.csv appears in demo/ (the script prints a count only).

---

## Phase 3: Validation: `src/validate.py` → `results/metrics.json` (aggregates only, no names)
**How this serves the primary goal:** "how far to trust each grouping" needs numbers, and each
number needs its n and its limits stated next to it.

1. **SNAP ego-Facebook** (download to data/snap/): for each of the 10 egos, run Leiden on the alter graph and
   score against the circles with average best-match F1 (McAuley & Leskovec 2012 style) plus NMI on alters that
   are in exactly one circle. The label says "the algorithm works on real friendship edges". It does NOT
   validate inference from LinkedIn exports.
2. **Modularity vs configuration-model null**: 100 `Degree_Sequence(method='configuration')` graphs
   (on the unweighted projection; the weighted null is skipped, and a comment says so). Report Q, null mean and SD, and z.
   Expect a high Q here: company cliques are trivially modular. Write that down; don't celebrate it.
3. **Seed stability**: 10 seeds, mean and min pairwise ARI.
4. **Weight ablation**: {co}, {co, ego}, {co, ego, era}, {co, ego, era, role}. Report each one's agreement with the
   hand labels, and pick the default by that.
5. **Hand labels** (user, n=50): `make-templates` writes `results/private/labels.csv` (50 random connections, seeded,
   `how_i_know` empty) and `pairs.csv` (30 pairs: 15 inferred same cluster, 15 different, with column `know_each_other`
   y/n/unsure). Metrics: ARI/NMI vs labels with a 1000x bootstrap CI; pair precision/recall with Wilson 95% CIs.
   Until the files are filled, metrics say `"pending"`.
6. **External testers** (2–3): `docs/tester-form.md`, three questions on a 1–5 scale plus free text. Report them as quotes and counts, not statistics.

Verification: `python src/validate.py` is idempotent. The JSON has a `n` field next to every metric, and nothing with a name.

**Milestone A review:** run `code-review` + `simplify` on src/.

---

## Phase 4: Local viewer: `web/` (index.html, app.js, vendor/)
**How this serves the primary goal:** this is where the user sees the circles and their growth,
and where someone else drops their own export with nothing leaving the tab.

Load the `dataviz` and `artifact-design` skills first.
1. Vendor the three UMD bundles into web/vendor/ (pinned versions from Phase 0).
2. Load `graph.json` from `?data=` or `demo/graph.json`. ForceAtlas2 runs synchronously for a fixed number of iterations (~300)
   and is seeded by cluster-grouped initial positions, so the layout is stable.
3. Colour by cluster using the dataviz categorical palette. Clusters beyond the palette and the "unplaced" group are neutral grey.
4. Collapsible clusters: clicking a legend item toggles that cluster between its members and one super-node sized by its count.
5. Timeline slider over `connected_on` uses `nodeReducer` to hide later nodes, with a Play button (also used for the recording)
   and a monthly count sparkline under it.
6. Side panel: cluster list with size, generated label, cohesion, and the caveat line from meta.
7. Drop mode: an `<input type=file multiple>` plus a drop zone. Files are read with `File.text()`, written into the Pyodide FS,
   then `netmap.py` runs (served next to the page) and the result is rendered. Pyodide loads from the jsDelivr CDN; a banner says
   "libraries download from a CDN; your files are read in this tab and never uploaded". Vendoring Pyodide is skipped (about 10 MB);
   add it if someone needs offline use.

Verification: the `run` skill serves `python -m http.server` and takes Playwright screenshots of the demo and drop mode
(with the synthetic CSVs). Playwright's network log during drop mode shows only GETs to jsDelivr and localhost, with no request body.

**Milestone B review:** `design-is` audit → fix the top issues; `code-review` + `simplify` on web/.

---

## Phase 5: Deliverables
**How this serves the primary goal:** the user presents it publicly. The demo, recording and
write-up are what other people see, so they have to be synthetic-only and accurate.

1. Method diagram (`diagram-design`): export CSVs → clean/merge → affiliations → projection → Leiden → viewer,
   with a side note on "what the export doesn't contain".
2. Demo artifact: a self-contained HTML with the synthetic graph.json inlined and libraries from cdn.jsdelivr.net/npm.
   Drop mode is not included in the artifact (the Pyodide path is outside /npm/). It links to the repo for local use.
3. Recording, 20–30 s: Playwright `recordVideo` of Play on the synthetic demo, giving `docs/timeline.webm` (convert to mp4 if ffmpeg exists).
4. `docs/writeup.md`: method, validation table (every metric with n and CI), what the data can't support, privacy.
   Then `docs/post.md` (LinkedIn, neutral framing, no employer names). Run `humanizer`, then `verify-claims`, then
   show the table to the user before finalising.

---

## Phase 6: Verify
**How this serves the primary goal:** proves the privacy promise and the numbers before anything is public.

- `python src/netmap.py` self-check and `python src/synth.py` recovery pass.
- Privacy grep: no name or company from data/Connections.csv in demo/, docs/, web/ or the artifact HTML (counts only).
- Employer grep: no employer project names in the repo (same list as RESUME.md).
- `grep -rn "fetch\|XMLHttpRequest\|sendBeacon" web/app.js`: only GETs of local graph.json and netmap.py.
- `git status --ignored` shows data/ and results/private/ ignored.
- verify-claims table is all VERIFIED or cut.

## Needs the user (blocking only their own metrics)
Fill labels.csv (50) and pairs.csv (30) · review merges.csv · send the tester form to 2–3 people.

## Not now
Betweenness/Burt · weighted null model · vendored Pyodide/offline · company industry enrichment · overlapping communities.
