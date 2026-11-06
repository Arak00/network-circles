"""Phase 3 validation -> results/metrics.json (aggregates only: no names, companies, titles or dates).

  python src/validate.py run [real_dir|none]     # default real_dir = data (real sections only if it exists)
  python src/validate.py templates data          # results/private/{labels,pairs}.csv for hand labelling
  python src/validate.py circles data            # results/private/circle_check.csv: 20 people + their circle, mark y/n

stdlib + igraph + netmap only. Deterministic: every random draw is seeded.
"""
import csv, glob, json, math, os, random, statistics, sys, time
from collections import Counter
from itertools import combinations

import igraph as ig

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netmap  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIV = os.path.join(ROOT, "results", "private")
DEMO = os.path.join(ROOT, "demo")
SNAP = os.path.join(ROOT, "data", "snap", "facebook")
N_NULL, SEEDS, N_BOOT = 100, range(10), 1000
ABLATION = {
    "co": {"co": 1.0},
    "co+burst (default)": {"co": 1.0, "burst": 1.0},
    "co+ego+burst": {"co": 1.0, "ego": 0.8, "burst": 1.0},
    "co+ego+era+burst": {"co": 1.0, "ego": 0.8, "era": 0.3, "burst": 1.0},
    "co+ego+era+burst+role0.2": {"co": 1.0, "ego": 0.8, "era": 0.3, "burst": 1.0, "role": 0.2},
}
PENDING = "pending"


def r4(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 4)


def canon(labels):
    """Any hashable labels -> 0..k ints; netmap's -1 (unplaced) becomes one singleton each."""
    ids, out = {}, []
    for i, lab in enumerate(labels):
        key = ("solo", i) if lab == -1 else lab
        out.append(ids.setdefault(key, len(ids)))
    return out


def cmp(a, b, method):
    return ig.compare_communities(canon(a), canon(b), method=method)


def leiden(g, seed, weights=None):
    random.seed(seed)
    return g.community_leiden(objective_function="modularity", weights=weights, n_iterations=-1).membership


# ---------- 1. SNAP ego-Facebook ----------
def f1(a, b):
    tp = len(a & b)
    return 2 * tp / (len(a) + len(b)) if tp else 0.0


def snap_ego(ego):
    edges = [tuple(l.split()) for l in open(os.path.join(SNAP, f"{ego}.edges")) if l.strip()]
    circles = [set(l.split()[1:]) for l in open(os.path.join(SNAP, f"{ego}.circles")) if len(l.split()) > 1]
    nodes = sorted({x for e in edges for x in e} | set().union(*circles) - {ego}, key=int)
    idx = {v: i for i, v in enumerate(nodes)}
    g = ig.Graph(n=len(nodes), edges=sorted({tuple(sorted((idx[a], idx[b]))) for a, b in edges
                                             if a != ego and b != ego and a != b}))
    memb = leiden(g, 0)
    comms = {}
    for v, c in zip(nodes, memb):
        comms.setdefault(c, set()).add(v)
    comms = [c for c in comms.values() if len(c) > 1]  # singletons (isolates) excluded from the comm->circle side
    c2m = statistics.mean(max((f1(c, m) for m in comms), default=0.0) for c in circles)
    m2c = statistics.mean(max(f1(m, c) for c in circles) for m in comms) if comms else 0.0
    count = Counter(v for c in circles for v in c)
    one = [v for v in nodes if count[v] == 1]
    lab = {v: k for k, c in enumerate(circles) for v in c}
    nmi = cmp([lab[v] for v in one], [memb[idx[v]] for v in one], "nmi") if len(one) > 1 else None
    return {"ego": int(ego), "n_alters": len(nodes), "n_edges": g.ecount(), "n_circles": len(circles),
            "n_communities": len(comms), "f1_circle_to_comm": r4(c2m), "f1_balanced": r4((c2m + m2c) / 2),
            "nmi_single_circle": r4(nmi), "n_single_circle": len(one)}


def snap_section():
    egos = sorted((os.path.basename(p)[:-8] for p in glob.glob(os.path.join(SNAP, "*.circles"))), key=int)
    if not egos:
        return PENDING
    per = [snap_ego(e) for e in egos]
    mean = {k: r4(statistics.mean(p[k] for p in per if p[k] is not None))
            for k in ("f1_circle_to_comm", "f1_balanced", "nmi_single_circle")}
    return {"n": len(per), "mean": mean, "per_ego": per,
            "note": "Leiden (modularity, seed 0) on SNAP ego-Facebook alter graphs vs user-drawn circles. Shows the "
                    "algorithm finds circles on real friendship edges; it does NOT validate inference from LinkedIn "
                    "exports, which have no alter-alter edges. Balanced F1 averages circle->community and "
                    "community->circle best match (singleton communities excluded from the latter)."}


# ---------- 2-4. graph-level metrics on a dataset ----------
def null_model(g, memb):
    """Unweighted configuration-model null. The weighted null is skipped (plan: 'Not now')."""
    gu = g.copy()
    del gu.es["weight"]
    q_unw_leiden = gu.modularity(leiden(gu, 0))
    deg = gu.degree()
    qs = []
    for s in range(N_NULL):
        random.seed(10_000 + s)  # igraph draws from Python's RNG
        h = ig.Graph.Degree_Sequence(deg, method="configuration")
        qs.append(h.modularity(leiden(h, s)))
    mu, sd = statistics.mean(qs), statistics.stdev(qs)
    # Weight-shuffle null: same topology, edge weights permuted. Asks whether the weights (which link types
    # people share) carry cluster structure beyond who is linked at all. ponytail: not a full weighted config model.
    q_w, w, qw = g.modularity(leiden(g, 0, "weight"), weights="weight"), list(g.es["weight"]), []
    for s in range(N_NULL):
        rng = random.Random(20_000 + s); ws = w[:]; rng.shuffle(ws)
        h = g.copy(); h.es["weight"] = ws
        qw.append(h.modularity(leiden(h, s, "weight"), weights="weight"))
    wmu, wsd = statistics.mean(qw), statistics.stdev(qw)
    return {"weight_shuffle": {"n": N_NULL, "q_leiden": r4(q_w), "null_mean": r4(wmu), "null_sd": r4(wsd),
                               "z": r4((q_w - wmu) / wsd) if wsd else None,
                               "note": "Leiden weighted Q vs the same graph with edge weights shuffled. Tests whether "
                                       "the link-type weights carry structure beyond graph topology."},
            "n": N_NULL, "n_nodes": g.vcount(), "n_edges": g.ecount(), "density": r4(gu.density()),
            "q_weighted": r4(g.modularity(canon(memb), weights="weight")),
            "q_unweighted_same_partition": r4(gu.modularity(canon(memb))),
            "q_unweighted_leiden": r4(q_unw_leiden), "null_mean": r4(mu), "null_sd": r4(sd),
            "z": r4((q_unw_leiden - mu) / sd) if sd else None,
            "note": "Leiden Q on the unweighted projection vs Leiden on 100 configuration-model graphs (same degrees, "
                    "multi-edges allowed). Weighted null skipped, so this ignores edge weights. Shared-company cliques are "
                    "trivially modular, so a large z says the structure is not degree noise, not that clusters are right; "
                    "on a dense projection (era/burst near-cliques) unweighted Q is near zero and the test says little."}


def stability(g):
    ms = [netmap.cluster(g, s)[0] for s in SEEDS]
    aris = [cmp(a, b, "ari") for a, b in combinations(ms, 2)]
    return {"n": len(aris), "n_seeds": len(ms), "ari_mean": r4(statistics.mean(aris)), "ari_min": r4(min(aris)),
            "n_clusters_range": [min(max(m) + 1 for m in ms), max(max(m) + 1 for m in ms)],
            "note": "Pairwise ARI between Leiden runs with seeds 0-9 on the default projection. Shows the partition "
                    "does not hinge on the seed; says nothing about whether it is correct."}


def ablation(df, scorer):
    rows = {}
    for name, w in ABLATION.items():
        g = netmap.project(df, w)
        ms = [netmap.cluster(g, sd)[0] for sd in SEEDS]
        sc = [scorer(m) for m in ms]
        agree = sc[0] if sc[0] == PENDING else {"ari_mean": r4(statistics.mean(x["ari"] for x in sc)),
                                                 "ari_min": r4(min(x["ari"] for x in sc)), "n": sc[0]["n"]}
        rows[name] = {"weights": w, "n_clusters": max(ms[0]) + 1,
                      "share_unplaced": r4(ms[0].count(-1) / len(ms[0])), "agreement": agree}
    return {"n": len(df), "sets": rows,
            "note": "Each weight set clustered with seeds 0-9 (agreement = mean). Agreement is ARI against the reference (planted truth "
                    "for synthetic, hand labels for real); n_clusters/unplaced show how much each link type connects."}


# ---------- 5. synthetic recovery ----------
def read_truth():
    with open(os.path.join(DEMO, "truth.csv"), encoding="utf-8") as f:
        return {int(r["id"]): r["circle"] for r in csv.DictReader(f)}


def vs_truth(memb, truth, method="ari"):
    keep = [i for i in range(len(memb)) if truth.get(i, "noise") != "noise"]
    return r4(cmp([truth[i] for i in keep], [memb[i] for i in keep], method))


def synthetic_section():
    df, g, _ = netmap.build(os.path.join(DEMO, "data"))
    truth = read_truth()
    memb, _ = netmap.cluster(g, 0)
    aris = [vs_truth(netmap.cluster(g, s)[0], truth) for s in SEEDS]
    keep = sum(1 for i in range(len(df)) if truth.get(i, "noise") != "noise")
    rec = {"n": keep, "n_total": len(df), "ari": vs_truth(memb, truth), "nmi": vs_truth(memb, truth, "nmi"),
           "ari_seed_mean": r4(statistics.mean(aris)), "ari_seed_range": [min(aris), max(aris)], "n_seeds": len(aris),
           "note": "Default weights on demo/data vs planted circles in demo/truth.csv, noise rows excluded. A sanity "
                   "check on data this project generated (it knows the planted signals), not a validation."}
    return df, g, memb, rec, (lambda m: {"ari": vs_truth(m, truth), "n": keep})


# ---------- 6. hand labels ----------
def read_csv(p):
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p, d = k / n, 1 + z * z / n
    c, h = (p + z * z / (2 * n)) / d, z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [r4(c - h), r4(c + h)]


def labelled(memb):
    rows = [r for r in read_csv(os.path.join(PRIV, "labels.csv")) or [] if (r.get("how_i_know") or "").strip()]
    return [(memb[int(r["id"])], r["how_i_know"].strip().lower()) for r in rows if int(r["id"]) < len(memb)]


def hand_label_scorer(memb):
    pts = labelled(memb)
    return {"ari": r4(cmp([p[1] for p in pts], [p[0] for p in pts], "ari")), "n": len(pts)} if len(pts) > 1 else PENDING


def hand_labels_section(memb):
    out = {}
    pts = labelled(memb)
    if len(pts) > 1:
        rng, boot = random.Random(1), {"ari": [], "nmi": []}
        for _ in range(N_BOOT):
            s = [pts[rng.randrange(len(pts))] for _ in pts]
            for m in boot:
                v = cmp([p[1] for p in s], [p[0] for p in s], m)
                if not math.isnan(v):
                    boot[m].append(v)
        ci = lambda xs: [r4(xs[round(0.025 * (len(xs) - 1))]), r4(xs[round(0.975 * (len(xs) - 1))])] if xs else None
        out["labels"] = {"n": len(pts), "n_boot": N_BOOT, "n_label_values": len({p[1] for p in pts}),
                         "ari": r4(cmp([p[1] for p in pts], [p[0] for p in pts], "ari")), "ari_ci95": ci(sorted(boot["ari"])),
                         "nmi": r4(cmp([p[1] for p in pts], [p[0] for p in pts], "nmi")), "nmi_ci95": ci(sorted(boot["nmi"])),
                         "note": "Inferred clusters vs the user's own 'how I know them' labels on a seeded random sample; "
                                 "percentile bootstrap CI. One person's labels, so it measures fit to their view only."}
    else:
        out["labels"] = PENDING
    pairs = [r for r in read_csv(os.path.join(PRIV, "pairs.csv")) or []
             if (r.get("know_each_other") or "").strip().lower()[:1] in ("y", "n")]
    if pairs:
        know = lambda r: r["know_each_other"].strip().lower().startswith("y")
        key = {(r["id_a"], r["id_b"]): r["same_cluster"] for r in read_csv(os.path.join(PRIV, "pairs_key.csv")) or []}
        same = lambda r: key.get((r["id_a"], r["id_b"]), "").strip().lower().startswith("y")
        tp = sum(1 for r in pairs if same(r) and know(r))
        ns, nk = sum(map(same, pairs)), sum(map(know, pairs))
        out["pairs"] = {"n": len(pairs), "n_same": ns, "n_know": nk,
                        "precision": r4(tp / ns) if ns else None, "precision_ci95": wilson(tp, ns),
                        "recall_in_sample": r4(tp / nk) if nk else None, "recall_ci95": wilson(tp, nk),
                        "note": "Does 'same cluster' imply the two know each other? 'unsure' excluded. Pairs were drawn "
                                "15 same / 15 different, so recall is for this stratified sample, not the whole network."}
    else:
        out["pairs"] = PENDING
    return out


def write_templates(real_dir):
    paths = [os.path.join(PRIV, f) for f in ("labels.csv", "pairs.csv", "pairs_key.csv")]
    if any(os.path.exists(p) for p in paths):
        sys.exit("refusing to overwrite existing " + ", ".join(p for p in paths if os.path.exists(p)))
    os.makedirs(PRIV, exist_ok=True)
    df, g, _ = netmap.build(real_dir)
    memb, _ = netmap.cluster(g, 0)
    rng, n = random.Random(7), len(df)
    with open(paths[0], "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "name", "company", "how_i_know"])
        for i in sorted(rng.sample(range(n), min(50, n))):
            w.writerow([i, df["name"].iloc[i], df["company"].iloc[i], ""])
    placed = [i for i in range(n) if memb[i] >= 0]
    same = [p for p in combinations(placed, 2) if memb[p[0]] == memb[p[1]]]
    diff = [p for p in combinations(placed, 2) if memb[p[0]] != memb[p[1]]]
    picks = [(p, "y") for p in rng.sample(same, min(15, len(same)))] + [(p, "n") for p in rng.sample(diff, min(15, len(diff)))]
    rng.shuffle(picks)
    with open(paths[1], "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id_a", "name_a", "id_b", "name_b", "know_each_other"])  # blind: answer key kept separately
        for (a, b), s in picks:
            w.writerow([a, df["name"].iloc[a], b, df["name"].iloc[b], ""])
    with open(paths[2], "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id_a", "id_b", "same_cluster"])
        for (a, b), s in picks:
            w.writerow([a, b, s])
    print(f"wrote labels.csv ({min(50, n)} rows), pairs.csv ({len(picks)} rows) to results/private/")


def resample_section(d, runs=20):
    rs = netmap.resample_ari(d, 0.9, runs)
    return {"n_runs": runs, "frac_kept": 0.9, "ari_mean": r4(statistics.mean(rs)), "ari_min": r4(min(rs)),
            "note": "Whole pipeline re-run on a random 90% of the connection rows; ARI against the full run on the "
                    "people kept. Shows the circles don't hinge on a few connections; says nothing about correctness."}


# ---------- circle check: is each sampled person in the right circle? ----------
CHECK = os.path.join(PRIV, "circle_check.csv")


def write_circle_check(real_dir, n=20):
    if os.path.exists(CHECK):
        sys.exit(f"refusing to overwrite existing {CHECK}")
    df, g, _ = netmap.build(real_dir)
    memb, _ = netmap.cluster(g, 0)
    label = {c["id"]: c["label"] for c in netmap.summarise(df, g, memb)}
    rng, by = random.Random(11), {}
    for i, c in enumerate(memb):
        by.setdefault(c, []).append(i)
    pools = [rng.sample(v, len(v)) for _, v in sorted(by.items(), key=lambda kv: (kv[0] < 0, kv[0]))]
    picks = []  # round-robin over circles (unplaced last), so small circles get checked too
    while len(picks) < min(n, len(memb)):
        for pool in pools:
            if pool and len(picks) < n:
                picks.append(pool.pop())
    os.makedirs(PRIV, exist_ok=True)
    with open(CHECK, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "name", "company", "circle", "right"])
        for i in sorted(picks):
            w.writerow([i, df["name"].iloc[i], df["company"].iloc[i], label[memb[i]], ""])
    print(f"wrote {len(picks)} rows to {os.path.relpath(CHECK, ROOT)}. In 'right' put y (right circle; for "
          f"'unplaced': right that they're in none) or n, then run: python src/validate.py run")


def circle_check_section():
    rows = [r for r in read_csv(CHECK) or [] if (r.get("right") or "").strip().lower()[:1] in ("y", "n")]
    if not rows:
        return PENDING
    k = sum(r["right"].strip().lower().startswith("y") for r in rows)
    return {"n": len(rows), "share_right": r4(k / len(rows)), "ci95": wilson(k, len(rows)),
            "note": "The author marked whether each sampled connection sits in the right circle. Circles sampled "
                    "round-robin; Wilson 95% interval. One person's judgement on one export."}


# ---------- 7. testers ----------
def testers_section():
    rows = read_csv(os.path.join(ROOT, "docs", "tester-feedback.csv"))
    if not rows:
        return PENDING
    out = {"n": len(rows), "n_comments": sum(1 for r in rows if (r.get("comment") or "").strip()),
           "note": "Self-reported 1-5 scores from testers who ran the tool on their own export. Counts and medians "
                   "only; too few people for statistics. Comments are kept out of this public file."}
    for q in ("q1", "q2", "q3"):
        v = [int(r[q]) for r in rows if (r.get(q) or "").strip().isdigit()]
        out[q] = {"n": len(v), "median": statistics.median(v) if v else None,
                  "counts": {str(k): v.count(k) for k in range(1, 6)}}
    return out


# ---------- main ----------
def run(real_dir):
    t0 = time.time()
    df, g, memb, rec, truth_scorer = synthetic_section()
    m = {"generated_by": "src/validate.py", "dataset_note": "null_model/stability/ablation/synthetic_recovery use "
         "the synthetic demo export. Real-export aggregates stay in results/private/metrics_real.json (gitignored); "
         "only the hand-label agreement scores are published here.",
         "snap": snap_section(), "null_model": null_model(g, memb), "stability": stability(g),
         "resample": resample_section(os.path.join(DEMO, "data")),
         "ablation": ablation(df, truth_scorer), "synthetic_recovery": rec, "hand_labels": PENDING,
         "testers": testers_section()}
    if real_dir and os.path.isdir(real_dir):
        rdf, rg, _ = netmap.build(real_dir)
        rm, _ = netmap.cluster(rg, 0)
        sizes = sorted(Counter(x for x in rm if x >= 0).values(), reverse=True)
        m["hand_labels"] = hand_labels_section(rm)
        m["circle_check"] = circle_check_section()
        real = {"n": len(rdf), "n_edges": rg.ecount(), "n_clusters": len(sizes),
                     "share_unplaced": r4(rm.count(-1) / len(rm)), "cluster_sizes": sizes,
                     "null_model": null_model(rg, rm), "stability": stability(rg), "resample": resample_section(real_dir),
                     "ablation": ablation(rdf, hand_label_scorer),
                     "note": "The author's own export, aggregates only. No ground truth beyond hand labels."}
        os.makedirs(PRIV, exist_ok=True)
        with open(os.path.join(PRIV, "metrics_real.json"), "w", encoding="utf-8") as f:
            json.dump(real, f, indent=2)
    os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
    with open(os.path.join(ROOT, "results", "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, ensure_ascii=True)
        f.write("\n")
    print(f"wrote results/metrics.json in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["run"]:
        d = a[1] if len(a) > 1 else os.path.join(ROOT, "data")
        run(None if d.lower() == "none" else d)
    elif a[:1] == ["circles"] and len(a) == 2:
        write_circle_check(a[1])
    elif a[:1] == ["templates"] and len(a) == 2:
        write_templates(a[1])
    else:
        sys.exit(__doc__)
