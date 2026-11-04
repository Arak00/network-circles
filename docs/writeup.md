# Where a network comes from: method and validation

This tool reads a LinkedIn data export, groups your connections into the circles they probably came from, and shows how those circles grew. Every validation result below comes from `results/metrics.json`, written by `src/validate.py`.

## What the export contains and what it doesn't

`Connections.csv` has one row per connection: name, current company, current title and the date you connected. `Positions.csv` lists your own jobs with start and end months. That is all the clustering uses.

The export has no ties between your contacts. It says you know Ana and you know Ben, but not whether Ana and Ben know each other. Bridges, betweenness and Burt's constraint all ask whether you connect people who are otherwise unconnected, so they need those alter-to-alter ties. Without them there is nothing to compute, and the tool doesn't report them.

What it can do is infer likely circles from shared attributes. Two people at the same company, or added within a few days of each other, probably came into your network through the same door. The validation below is about how far to trust that inference.

## Method

`src/netmap.py` runs from the command line and inside the browser (Pyodide 0.27.7), so both give identical results.

1. Load `Connections.csv` and `Positions.csv`, skipping LinkedIn's "Notes:" preamble.
2. Clean company names (lowercase, punctuation, legal suffixes such as Inc or GmbH) and merge spellings with a greedy `difflib` match at a 0.88 similarity cutoff. Every merge goes to `merges.csv` for review, and an optional `merge_overrides.csv` wins over the automatic choice.
3. Give each person a set of affiliations. Two are on by default: their current company, and a connection burst (a run of three or more people added no more than 3 days apart). Three more are kept for the ablation and are off by default: a company you also worked at, the job you held when you connected, and a role family taken from the title by a keyword map.
4. Link every pair of people who share an affiliation and add up the weights. Large affiliations (bursts, roles, eras) are divided by log2(size + 1) so they don't swamp company links.
5. Cluster with Leiden (modularity, weighted, seeded). People with no shared affiliation stay unplaced and are counted, not hidden.
6. The viewer draws the graph with sigma.js and ForceAtlas2, with collapsible clusters and a monthly timeline.

The default weights were picked by mean synthetic recovery over 10 seeds (see the ablation row below). They should be re-picked once hand labels exist.

Diagram of the pipeline: [docs/method.png](method.png)

## Validation table

| Check | n | Result | What it shows, and what it doesn't |
|---|---|---|---|
| SNAP ego-Facebook | 10 egos (58 to 1,035 alters each) | Mean F1 circle to community 0.35; balanced F1 0.45 (range 0.15 to 0.57); NMI on single-circle alters 0.68 (range 0.41 to 0.93) | Leiden finds hand-drawn circles on real friend edges. It doesn't test inference from an export, which has none. |
| Synthetic recovery | 220 of 300 people (noise excluded), 10 seeds | ARI 0.61 (seed range 0.61 to 0.61); NMI 0.66 at seed 0 | Recovers circles planted in data this project generated. A sanity check, since the project knows what it planted. |
| Weight ablation (synthetic) | 220 people, 10 seeds per set | Company only 0.40; company + burst 0.61 (default); + ego 0.57; + era 0.52 (min 0.39); + role 0.50 (min 0.35) | Era and role links force everyone into a few blobs (23 clusters become 6, none unplaced). The ego link added nothing. Real-data agreement is pending. |
| Seed stability (synthetic) | 45 seed pairs (10 seeds) | Mean ARI 0.99, min 0.95; 23 to 24 clusters | The partition does not hinge on the random seed. A stable answer can still be wrong. |
| Configuration-model null (synthetic) | 100 null graphs; 300 nodes, 1,729 edges | Unweighted Leiden Q 0.69 vs null mean 0.22, z = 110.04 | The structure isn't degree noise. Weak because same-company cliques are modular by construction, and it ignores weights. |
| Weight-shuffle null (synthetic) | 100 shuffles | Weighted Q 0.66 vs shuffled 0.69, z = -9.68 | Shuffled weights score slightly higher, so the weights add no modularity beyond which pairs are linked. Weak because modularity measures separability, not correctness. |
| Hand labels | planned 50 | pending | ARI and NMI against my own "how I know them" labels, 1,000-sample bootstrap CI. One person's view. |
| Pairs | planned 30 (15 same cluster, 15 different) | pending | Precision and recall of "same cluster means they know each other", with Wilson 95% CIs. |
| Testers | planned 2 to 3 | pending | Three 1 to 5 scores plus a comment ([form](tester-form.md)), reported as counts. |

## Where the data is too thin

The pending checks are small because one person has to fill them in. Thirty yes/no answers give a 95% interval of roughly ±18 points around 50%. Precision only uses the 15 pairs the tool put in the same cluster, so its interval will be wider, about ±23 points with a Wilson interval. Two or three testers are anecdotes; their scores will be reported as counts.

Many people share nothing with anyone. With the default links, 0.20 of the synthetic export is unplaced, and 0.30 with company links alone. The map says nothing about where those people came from.

Timing is the other weak spot. A new account often adds a large batch of people in its first weeks, such as old colleagues and classmates. Bursts are chained runs of connections no more than 3 days apart, so a bootstrap period can become one long burst. The log2 scaling dampens it but doesn't remove it, and that burst then pulls in people who arrived from different places. The burst link is still in the default because it raised synthetic recovery from 0.40 to 0.61, but on a real export it can dominate.

## Privacy

In the browser, your CSV files are read inside the tab with `File.text()` and processed by `netmap.py` running in Pyodide. Nothing is uploaded. The Pyodide runtime downloads from the jsDelivr CDN; sigma.js and graphology are vendored in `web/vendor/`. The command-line path runs entirely on your machine.

The repository contains only synthetic data (`demo/`, fictional names and companies) and aggregate metrics with no names, companies, titles or dates. `data/` and `results/private/` are gitignored.

## Limitations and next steps

- No alter-to-alter ties, so no bridges, brokerage or overlap between circles. Each person gets exactly one cluster.
- The export only has each contact's current company, so a former colleague who has moved on is grouped with their new company.
- Role keywords are English, and dates are parsed in LinkedIn's English format (`15 Oct 2025`). Exports in other languages may parse badly.
- `Invitations.csv` and `Recommendations_Received.csv` are loaded if present but don't feed the clustering yet.
- The configuration-model null is unweighted; a weighted one is not built yet.
- Next: fill the 50 labels and 30 pairs, collect 2 to 3 tester forms, then re-pick the default weights on the hand labels instead of synthetic truth.

## From my own export (optional, remove before publishing if preferred)

I ran the tool on my own export, 325 connections. With the default links it finds 7 clusters of 222, 30, 20, 14, 12, 2 and 2 people, with an unplaced share of 0.07. Across 10 seeds (45 pairs) the mean ARI is 1.00 and the lowest is 0.98, with 6 or 7 clusters.

The largest group, 222 people, lines up with the connections I added in the first two months after setting up the account: 234 of the 325 are dated January and February 2025. That is my reading of the dates, and the hand labels will confirm it or not. If it holds, that group is the bootstrap burst described above, and the biggest group on my map reflects when I joined more than where those people came from.
