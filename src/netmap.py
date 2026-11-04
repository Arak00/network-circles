"""LinkedIn export -> clustered network map (graph.json).

Runs from the CLI and inside Pyodide 0.27.7 (igraph 0.11.4, pandas 2.2.3), so stdlib + pandas + igraph only.
  python src/netmap.py <input_dir> <out.json>    # prints counts only, never names
  python src/netmap.py --selftest
"""
import csv, difflib, json, math, os, random, re, sys, tempfile
from collections import Counter, defaultdict
from datetime import datetime

import igraph as ig
import pandas as pd

# Chosen on synthetic recovery (validate.py ablation); role links hurt there, so role is shown, not linked.
# Re-pick on hand labels when available.
DEFAULT_W = {"co": 1.0, "ego": 0.8, "era": 0.3, "burst": 1.0, "role": 0.0}
SCALED = ("role", "era", "burst")  # big affiliations: contribution divided by log2(size+1)
LEGAL = {"inc", "ltd", "gmbh", "sa", "sas", "llc", "plc", "group", "bv", "co", "corp", "limited", "ag"}

# ponytail: keyword map, first match wins; order matters (e.g. "data engineer" -> data, "product designer" -> design).
ROLES = [
    ("student", r"student|intern|phd candidate|undergraduate|graduate"),
    ("founder/exec", r"founder|co-founder|ceo|cto|coo|cfo|cmo|cpo|chief|owner|president|managing director|partner|board"),
    ("recruiting/hr", r"recruit|talent|hr|human resources|people (?:ops|partner|operations)|sourcer"),
    ("data", r"data|analytics|analyst|machine learning|ml|ai|scientist|bi"),
    ("design", r"design|ux|ui|user experience|creative|art director|illustrator"),
    ("eng", r"engineer|developer|software|devops|sre|architect|programmer|tech lead|qa|test|cto|firmware|backend|frontend|full.?stack"),
    ("product", r"product|pm|program manager|scrum|agile coach|delivery"),
    ("marketing", r"marketing|growth|brand|seo|content|communications|pr|social media|community|crm|retention|acquisition|affiliate"),
    ("sales/bd", r"sales|business development|bd|account (?:executive|manager)|partnerships|commercial|customer success|revenue"),
    ("finance", r"financ|accountant|accounting|controller|investment|investor|analyst|banker|trader|treasury|audit|vc|venture"),
    ("research/academia", r"research|professor|lecturer|postdoc|academic|teacher|fellow"),
    ("ops", r"operations|ops|logistics|supply chain|procurement|project manager|office manager|administrat|coordinator|support|customer service"),
    ("founder/exec", r"vp|vice president|head of|director|general manager"),  # seniority only if no function matched
]
ROLE_RE = [(fam, re.compile(r"\b(?:" + pat + r")", re.I)) for fam, pat in ROLES]


# ---------- 1. load ----------
def read_export_csv(path):
    """Rows -> DataFrame. Header = first row with >2 fields (skips the 'Notes:' preamble)."""
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    hi = next((i for i, r in enumerate(rows) if len(r) > 2), None)
    if hi is None:
        return None
    head = [h.strip() for h in rows[hi]]
    body = [(r + [""] * len(head))[: len(head)] for r in rows[hi + 1:] if any(c.strip() for c in r)]
    return pd.DataFrame(body, columns=head)


def parse_date(s, fmts):
    s = (s or "").strip()
    for fmt in fmts:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def load(d):
    conn = read_export_csv(os.path.join(d, "Connections.csv"))
    if conn is None:
        raise FileNotFoundError("Connections.csv missing or empty in " + d)
    conn["connected_on"] = [parse_date(s, ("%d %b %Y",)) for s in conn.get("Connected On", [""] * len(conn))]
    pos = read_export_csv(os.path.join(d, "Positions.csv"))
    if pos is None:
        pos = pd.DataFrame(columns=["Company Name", "Title", "Started On", "Finished On"])
    pos["start"] = [parse_date(s, ("%b %Y", "%Y")) for s in pos["Started On"]]
    pos["end"] = [parse_date(s, ("%b %Y", "%Y")) for s in pos["Finished On"]]  # None = current
    return {
        "connections": conn,
        "positions": pos,
        "invitations": read_export_csv(os.path.join(d, "Invitations.csv")),
        "recommendations": read_export_csv(os.path.join(d, "Recommendations_Received.csv")),
    }


# ---------- 2. clean + merge ----------
def clean(name):
    s = re.sub(r"[^\w\s]", " ", (name or "").lower())
    toks = s.split()
    if toks and toks[0] == "the":
        toks = toks[1:]
    while len(toks) > 1 and toks[-1] in LEGAL:
        toks = toks[:-1]
    return " ".join(toks)


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def merge(names, cutoff=0.88, overrides=None):
    """Greedy fuzzy clustering of company spellings. Returns ({raw: canonical}, [(raw, canonical, score)])."""
    # ponytail: greedy O(n * clusters) difflib; fine for a few thousand distinct names. No transitive re-merging.
    raw_counts = Counter(n.strip() for n in names if n and n.strip())
    by_key = defaultdict(Counter)
    for raw, c in raw_counts.items():
        by_key[clean(raw)][raw] += c
    reps, members = [], defaultdict(list)  # rep clean key -> [(clean key, score)]
    for key in sorted(by_key, key=lambda k: (-sum(by_key[k].values()), k)):
        best, score = None, 0.0
        for r in reps:
            sm = difflib.SequenceMatcher(None, key, r)
            if sm.real_quick_ratio() >= cutoff and sm.quick_ratio() >= cutoff:
                s = sm.ratio()
                if s > score:
                    best, score = r, s
        if best is None or score < cutoff:
            reps.append(key)
            best, score = key, 1.0
        members[best].append((key, score))
    mapping, merges = {}, []
    for rep, keys in members.items():
        spellings = Counter()
        for k, _ in keys:
            spellings.update(by_key[k])
        canon = sorted(spellings.items(), key=lambda kv: (-kv[1], len(kv[0]), kv[0]))[0][0]
        for k, s in keys:
            for raw in by_key[k]:
                mapping[raw] = canon
                if raw != canon:
                    merges.append((raw, canon, round(s, 3)))
    for raw, canon in (overrides or {}).items():
        mapping[raw] = canon
        merges = [m for m in merges if m[0] != raw] + ([(raw, canon, "override")] if raw != canon else [])
    return mapping, merges


def read_overrides(d):
    p = os.path.join(d, "merge_overrides.csv")
    if not os.path.exists(p):
        return {}
    with open(p, encoding="utf-8-sig", newline="") as f:
        return {r["raw"].strip(): r["canonical"].strip() for r in csv.DictReader(f) if r.get("raw")}


# ---------- 3. affiliations ----------
def role_of(title):
    for fam, rx in ROLE_RE:
        if rx.search(title or ""):
            return fam
    return "other"


def era_of(when, pos):
    """Ego position active at `when` (month resolution); most recent start wins."""
    if when is None:
        return None
    ym = (when.year, when.month)
    live = [(p["start"], p) for _, p in pos.iterrows()
            if p["start"] is not None and (p["start"].year, p["start"].month) <= ym
            and (p["end"] is None or ym <= (p["end"].year, p["end"].month))]
    if not live:
        return None
    p = max(live, key=lambda t: t[0])[1]
    return f"{p['Company Name'].strip()} / {p['Title'].strip()}"


def people(data, cutoff=0.88, overrides=None):
    conn, pos = data["connections"], data["positions"]
    raw_cos = [str(c) for c in conn["Company"].fillna("")]
    mapping, merges = merge(raw_cos, cutoff, overrides)
    ego_cos = {clean(c): c.strip() for c in pos["Company Name"].fillna("") if clean(c)}
    rows = []
    for i, r in enumerate(conn.to_dict("records")):
        co = mapping.get(str(r.get("Company") or "").strip(), "")
        title = str(r.get("Position") or "").strip()
        role = role_of(title)
        affs = []
        if co:
            affs.append("co:" + co)
            ck = clean(co)
            hit = max(ego_cos, key=lambda k: ratio(ck, k), default=None)
            if hit is not None and ratio(ck, hit) >= cutoff:
                affs.append("ego:" + ego_cos[hit])
        if role != "other":
            affs.append("role:" + role)
        era = era_of(r["connected_on"], pos)
        if era:
            affs.append("era:" + era)
        name = f"{r.get('First Name', '')} {r.get('Last Name', '')}".strip()
        rows.append({"id": i, "name": name, "company": co, "title": title, "role": role,
                     "connected_on": r["connected_on"], "affs": affs})
    for k, b in zip(range(len(rows)), bursts([r["connected_on"] for r in rows])):
        if b:
            rows[k]["affs"].append(b)
    return pd.DataFrame(rows, columns=["id", "name", "company", "title", "role", "connected_on", "affs"]), merges


def bursts(dates, gap_days=3, min_size=3):
    """burst:<start date> for runs of connections no more than gap_days apart (events, onboarding weeks)."""
    # ponytail: fixed gap; a bootstrap month becomes one big burst, which SCALED weighting dampens.
    order = sorted((d, i) for i, d in enumerate(dates) if d is not None)
    out, run = [None] * len(dates), []
    for d, i in order + [(None, None)]:
        if run and (d is None or (d - dates[run[-1]]).days > gap_days):
            if len(run) >= min_size:
                for j in run:
                    out[j] = "burst:" + dates[run[0]].strftime("%Y-%m-%d")
            run = []
        if d is not None:
            run.append(i)
    return out


# ---------- 4. projection ----------
def project(df, weights=None):
    """Weighted person-person graph from shared affiliations."""
    # ponytail: O(n^2) per affiliation (role/era are near-cliques); fine under ~5k connections, else sparse kNN.
    W = DEFAULT_W if weights is None else weights
    groups = defaultdict(list)
    for i, affs in zip(df["id"], df["affs"]):
        for a in affs:
            if W.get(a.split(":", 1)[0], 0) > 0:
                groups[a].append(i)
    acc = defaultdict(float)
    for a, m in groups.items():
        t = a.split(":", 1)[0]
        w = W[t] / (math.log2(len(m) + 1) if t in SCALED else 1.0)
        for x in range(len(m)):
            for y in range(x + 1, len(m)):
                acc[(m[x], m[y])] += w
    edges = sorted(acc)
    return ig.Graph(n=len(df), edges=edges, edge_attrs={"weight": [acc[e] for e in edges]})


def build(input_dir, weights=None, cutoff=0.88):
    """-> (people_df, igraph.Graph, merges). Reused by validate.py."""
    df, merges = people(load(input_dir), cutoff, read_overrides(input_dir))
    return df, project(df, weights), merges


# ---------- 5. Leiden ----------
def cluster(g, seed=0, resolution=1.0):
    """Membership list; isolates -> -1; other ids renumbered by size (0 = largest)."""
    if g.ecount() == 0:
        return [-1] * g.vcount(), None
    random.seed(seed)  # python-igraph draws from Python's RNG
    part = g.community_leiden(objective_function="modularity", weights="weight",
                              resolution=resolution, n_iterations=-1)
    raw = part.membership
    q = g.modularity(raw, weights="weight")
    deg = g.degree()
    sizes = Counter(c for c, d in zip(raw, deg) if d > 0)
    order = {c: k for k, (c, _) in enumerate(sorted(sizes.items(), key=lambda kv: (-kv[1], kv[0])))}
    return [order[c] if d > 0 else -1 for c, d in zip(raw, deg)], q


# ---------- 6. output ----------
def summarise(df, g, memb):
    internal, incident = Counter(), Counter()
    for e in g.es:
        a, b = memb[e.source], memb[e.target]
        incident[a] += e["weight"]
        if a == b:
            internal[a] += e["weight"]
        else:
            incident[b] += e["weight"]
    out = []
    for c in sorted(set(memb)):
        idx = [i for i, m in enumerate(memb) if m == c]
        if c == -1:
            out.append({"id": -1, "size": len(idx), "label": "unplaced", "cohesion": None})
            continue
        cos = Counter(df["company"].iloc[i] for i in idx if df["company"].iloc[i])
        roles = Counter(df["role"].iloc[i] for i in idx if df["role"].iloc[i] != "other")
        parts = [cos.most_common(1)[0][0]] if cos else []
        parts += [roles.most_common(1)[0][0]] if roles else []
        out.append({"id": c, "size": len(idx), "label": " · ".join(parts) or f"cluster {c}",
                    "cohesion": round(internal[c] / incident[c], 3) if incident[c] else None})
    return out


def run(input_dir, weights=None, seed=0, resolution=1.0, cutoff=0.88):
    W = dict(DEFAULT_W if weights is None else weights)
    df, g, merges = build(input_dir, W, cutoff)
    memb, q = cluster(g, seed, resolution)
    n = len(df)
    clusters = summarise(df, g, memb)
    return {
        "meta": {"n_people": n, "n_edges": g.ecount(), "n_clusters": sum(1 for c in clusters if c["id"] >= 0),
                 "share_unplaced": round(memb.count(-1) / n, 3) if n else 0.0, "weights": W, "seed": seed,
                 "resolution": resolution, "modularity": None if q is None else round(q, 4)},
        "nodes": [{"id": int(r["id"]), "name": r["name"], "company": r["company"], "title": r["title"],
                   "role": r["role"], "connected_on": r["connected_on"].date().isoformat() if r["connected_on"] else None,
                   "cluster": memb[k]} for k, r in enumerate(df.to_dict("records"))],
        "edges": [{"s": e.source, "t": e.target, "w": round(e["weight"], 4)} for e in g.es],
        "clusters": clusters,
        "merges": [{"raw": r, "canonical": c, "score": s} for r, c, s in merges],
    }


# ---------- 8. self-test ----------
def selftest():
    cos = {"Acme Inc.": 0, "ACME": 0, "Acme": 0, "Globex Corporation": 1, "Initech": 2}
    rows = [("Acme Inc.", "Software Engineer"), ("ACME", "Product Manager"), ("Acme", "Designer"),
            ("Acme", "Data Scientist"), ("Acme Inc.", "Sales Lead")]
    rows += [("Globex Corporation", t) for t in ("Engineer", "Recruiter", "CEO", "Analyst", "Marketing Lead")]
    rows += [("Initech", t) for t in ("Engineer", "Recruiter", "Accountant", "Ops Manager", "Student")]
    rows += [(f"Solo {k} Ltd", "Engineer") for k in "ABCD"]  # singletons
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "Connections.csv"), "w", newline="", encoding="utf-8") as f:
        f.write("Notes:\n\"When exporting your connection data, you may notice...\"\n\n")
        w = csv.writer(f)
        w.writerow(["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"])
        for k, (co, t) in enumerate(rows):
            w.writerow([f"P{k}", "Test", "", "", co, t, "15 Oct 2025"])
    with open(os.path.join(d, "Positions.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Company Name", "Title", "Description", "Location", "Started On", "Finished On"])
        w.writerow(["Initech", "Engineer", "", "", "Jan 2020", ""])
        w.writerow(["Old Co", "Intern", "", "", "2015", "Jun 2016"])
    data = load(d)
    assert len(data["connections"]) == len(rows) and "Connected On" in data["connections"].columns, "header scan"
    assert data["invitations"] is None, "optional files tolerated"
    mapping, merges = merge(["Acme Inc.", "ACME", "Acme", "Acme", "Globex"])
    assert mapping["Acme Inc."] == mapping["ACME"] == "Acme", mapping
    assert all(r != c for r, c, _ in merges)
    out = run(d)
    truth = [cos[co] for co, _ in rows if co in cos]
    got = [n["cluster"] for n, (co, _) in zip(out["nodes"], rows) if co in cos]
    ari = ig.compare_communities(truth, got, method="ari")
    assert abs(ari - 1.0) < 1e-9, ("ARI", ari, got)
    assert any(a.startswith("ego:") for a in people(data)[0]["affs"].iloc[-6]), "ego affiliation"
    print(f"selftest ok: ARI={ari}, clusters={out['meta']['n_clusters']}, edges={out['meta']['n_edges']}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    elif len(sys.argv) == 3:
        res = run(sys.argv[1])
        os.makedirs(os.path.dirname(os.path.abspath(sys.argv[2])), exist_ok=True)
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        with open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[2])), "merges.csv"), "w", newline="",
                  encoding="utf-8") as f:
            csv.writer(f).writerows([("raw", "canonical", "score")] + [tuple(m.values()) for m in res["merges"]])
        m = res["meta"]
        print(f"people={m['n_people']} edges={m['n_edges']} clusters={m['n_clusters']} "
              f"unplaced={m['share_unplaced']} modularity={m['modularity']} merges={len(res['merges'])}")
    else:
        sys.exit(__doc__)
