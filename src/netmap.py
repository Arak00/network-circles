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

# Chosen by mean synthetic recovery over 10 seeds (validate.py ablation). era and role link near-cliques that
# force everyone into a few blobs; ego added nothing. They stay available for the ablation. Re-pick on hand labels.
DEFAULT_W = {"co": 1.0, "burst": 1.0}
SCALED = ("role", "era", "burst")  # big affiliations: contribution divided by log2(size+1)
# Employer strings that name no employer. Strangers share them, so they must never tie people together: one
# a single "Freelance" can pull most of a network into one circle. Matched on the whole clean() name, so "Acme Consulting" and
# "Independent Bank" stay companies. The name is still shown and searchable; it just links nobody.
GENERIC = re.compile(r"^(?:self ?employed|freelanc\w*|independent(?: (?:consultant|contractor|consulting|professional|advisor|adviser))?"
                     r"|consult(?:ant|ing)|stealth|stealth (?:mode|startup|start up|company)(?: \w+)?|startup|confidential|undisclosed"
                     r"|retired|unemployed|student|none|n a|na|various|multiple|self|myself|entrepreneur|my own (?:company|business)"
                     r"|own business|open to work|looking for .*|seeking .*|career break|sabbatical|private"
                     r"|ind[eé]pendante?|auto ?entrepreneur|micro ?entrepreneur|travailleur ind[eé]pendant|[àa] mon compte"
                     r"|freiberuf\w*|selbst(?:st)?[äa]ndig\w*|aut[oó]nom[oa]|zelfstandige?|zzp\w*)"
                     r"(?: (?:freelanc\w*|consultant|designer|developer|engineer|ux designer|ux|writer|photographer))?$")
is_generic = lambda name: not clean(name) or bool(GENERIC.match(clean(name)))
LEGAL = {"inc", "ltd", "gmbh", "sa", "sas", "llc", "plc", "group", "bv", "co", "corp", "limited", "ag"}

# ponytail: keyword map, first match wins; order matters (e.g. "data engineer" -> data, "product designer" -> design).
ROLES = [
    ("student", r"student|intern|phd candidate|undergraduate|graduate"),
    ("founder/exec", r"founder|co-founder|ceo|cto|coo|cfo|cmo|cpo|chief|president|managing director|managing partner|board member"),
    ("recruiting/hr", r"recruit|talent|hr|human resources|people (?:ops|partner|operations)|sourcer"),
    ("finance", r"financ|accountant|accounting|controller|investment|investor|banker|trader|treasury|audit|vc|venture"),
    ("data", r"data|analytics|analyst|machine learning|ml|ai|scientist|bi"),
    ("design", r"design|ux|ui|user experience|creative|art director|illustrator"),
    ("eng", r"engineer|developer|software|devops|sre|architect|programmer|tech lead|qa|test|firmware|backend|frontend|full.?stack"),
    ("product", r"product|pm|program manager|scrum|agile coach|delivery"),
    ("marketing", r"marketing|growth|brand|seo|content|communications|pr|social media|community|crm|retention|acquisition|affiliate"),
    ("sales/bd", r"sales|business development|bd|account (?:executive|manager)|partnerships|commercial|customer success|revenue"),
    ("research/academia", r"research|professor|lecturer|postdoc|academic|teacher|fellow"),
    ("ops", r"operations|ops|logistics|supply chain|procurement|project manager|office manager|administrat|coordinator|support|customer service"),
    ("founder/exec", r"vp|vice president|head of|director|general manager|partner|owner"),  # seniority only if no function matched
]
# Short tokens (pr, ai, hr, ...) must be whole words; longer ones may be prefixes (financ, recruit).
ROLE_RE = [(fam, re.compile(r"\b(?:" + "|".join(t + r"\b" if len(t) <= 3 else t for t in pat.split("|")) + ")", re.I))
           for fam, pat in ROLES]


# ---------- 1. load ----------
def read_export_csv(path, min_fields=3):
    """Rows -> DataFrame. Header = first row with >= min_fields fields (skips the 'Notes:' preamble)."""
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    hi = next((i for i, r in enumerate(rows) if len(r) >= min_fields and any(c.strip() for c in r)), None)
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
    # pd.Series(dtype=object) keeps None as None (a datetime column would turn it into NaT, which breaks `is None`).
    conn["connected_on"] = pd.Series([parse_date(s, ("%d %b %Y",)) for s in conn.get("Connected On", [""] * len(conn))], index=conn.index, dtype=object)
    pos = read_export_csv(os.path.join(d, "Positions.csv"))
    if pos is None:
        pos = pd.DataFrame(columns=["Company Name", "Title", "Started On", "Finished On"])
    pos["start"] = pd.Series([parse_date(s, ("%b %Y", "%Y")) for s in pos["Started On"]], index=pos.index, dtype=object)
    pos["end"] = pd.Series([parse_date(s, ("%b %Y", "%Y")) for s in pos["Finished On"]], index=pos.index, dtype=object)  # None = current
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
    # Words shared by many different names ("international", "holdings", "group") say nothing about which company
    # it is, yet a long shared suffix can lift the whole-string ratio past the cutoff ("Alpha International Holdings
    # Group Ltd" ~ "Beta International Holdings Group Ltd"). So a match must also hold on the distinctive words.
    # This only ever removes merges; names made only of common words fall back to the whole-string score.
    df_tok = Counter(t for k in by_key for t in set(k.split()))
    common = {t for t, c in df_tok.items() if c >= 3 and c >= 0.02 * len(by_key)}
    core = {k: " ".join(t for t in k.split() if t not in common) for k in by_key}
    reps, members = [], defaultdict(list)  # rep clean key -> [(clean key, score)]
    for key in sorted(by_key, key=lambda k: (-sum(by_key[k].values()), k)):
        best, score = None, 0.0
        for r in reps:
            sm = difflib.SequenceMatcher(None, key, r)
            if sm.real_quick_ratio() >= cutoff and sm.quick_ratio() >= cutoff:
                s = sm.ratio()
                if core[key] and core[r] and core[key] != core[r] and ratio(core[key], core[r]) < cutoff:
                    continue
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
    ego_cos = {clean(c): c.strip() for c in pos["Company Name"].fillna("") if not is_generic(c)}
    rows = []
    for i, r in enumerate(conn.to_dict("records")):
        co = mapping.get(str(r.get("Company") or "").strip(), "")
        title = str(r.get("Position") or "").strip()
        role = role_of(title)
        affs = []
        if co and not is_generic(co):
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
    acc, co = defaultdict(float), defaultdict(float)  # co: the part of each weight that comes from a shared company
    for a, m in groups.items():
        t = a.split(":", 1)[0]
        w = W[t] / (math.log2(len(m) + 1) if t in SCALED else 1.0)
        for x in range(len(m)):
            for y in range(x + 1, len(m)):
                acc[(m[x], m[y])] += w
                if t in ("co", "ego"):
                    co[(m[x], m[y])] += w
    edges = sorted(acc)
    return ig.Graph(n=len(df), edges=edges, edge_attrs={"weight": [acc[e] for e in edges], "co": [co[e] for e in edges]})


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


def resample_ari(input_dir, frac=0.9, runs=10, seed=0):
    """Re-run the whole pipeline on a random `frac` of the raw connection rows; ARI of each run against the full run,
    on the people kept (unplaced people count as singletons). High = circles don't hinge on a few connections."""
    data = load(input_dir)
    ov = read_overrides(input_dir)
    full, _ = cluster(project(people(data, overrides=ov)[0]))
    conn, rng, out = data["connections"], random.Random(seed), []
    def canon(ms):  # compact 0..k ids, -1 (unplaced) -> one singleton each
        ids = {}
        return [ids.setdefault(("solo", i) if c == -1 else c, len(ids)) for i, c in enumerate(ms)]
    for _ in range(runs):
        keep = sorted(rng.sample(range(len(conn)), int(frac * len(conn))))
        sub = people(dict(data, connections=conn.iloc[keep].reset_index(drop=True)), overrides=ov)[0]
        m, _ = cluster(project(sub))
        out.append(ig.compare_communities(canon([full[i] for i in keep]), canon(m), method="ari"))
    return out


# ---------- 6. output ----------
def basis(company_share):
    """What holds a circle together, so testers can say which kind of circle is wrong without sharing their export.
    ponytail: fixed 0.8 / 0.2 cut-offs, first guess; tune once testers flag circles."""
    return "company" if company_share >= 0.8 else "dates" if company_share <= 0.2 else "both"


def summarise(df, g, memb):
    internal, incident, internal_co = Counter(), Counter(), Counter()
    has_co = "co" in g.es.attributes()
    for e in g.es:
        a, b = memb[e.source], memb[e.target]
        incident[a] += e["weight"]
        if a == b:
            internal[a] += e["weight"]
            internal_co[a] += e["co"] if has_co else 0
        else:
            incident[b] += e["weight"]
    out = []
    for c in sorted(set(memb)):
        idx = [i for i, m in enumerate(memb) if m == c]
        if c == -1:
            out.append({"id": -1, "size": len(idx), "label": "unplaced", "cohesion": None})
            continue
        cos = Counter(df["company"].iloc[i] for i in idx if not is_generic(df["company"].iloc[i]))
        roles = Counter(df["role"].iloc[i] for i in idx if df["role"].iloc[i] != "other")
        share = round(internal_co[c] / internal[c], 3) if internal[c] else 0.0
        b = basis(share)
        if b == "dates":  # held together by when you connected, so a company name would mislead
            months = Counter(d.strftime("%b %Y") for d in (df["connected_on"].iloc[i] for i in idx) if d is not None)
            parts = [f"Added {months.most_common(1)[0][0]}"] if months else []
        else:
            parts = [cos.most_common(1)[0][0]] if cos else []
        parts += [roles.most_common(1)[0][0]] if roles else []
        out.append({"id": c, "size": len(idx), "label": " · ".join(parts) or f"cluster {c}",
                    "cohesion": round(internal[c] / incident[c], 3) if incident[c] else None,
                    "basis": b, "company_share": share})
    return out


# ---------- 7. layers: skills, orgs, events, groups, posts, topics, follows ----------
# Export file names; the API fetcher (fetch_snapshot.py) writes the same names. Every file is optional.
# Column names differ between the zip export and the API, so each lookup lists the known spellings.
def col(df, *names):
    if df is None:
        return None
    norm = {re.sub(r"[^a-z]", "", c.lower()): c for c in df.columns}
    return next((norm[k] for k in (re.sub(r"[^a-z]", "", n.lower()) for n in names) if k in norm), None)


def any_date(s):
    """Loose date parser for the many export/API formats -> date or None."""
    s = str(s or "").strip()
    m = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if m:
        return datetime(*map(int, m.groups())).date()
    m = re.search(r"\b([A-Z][a-z]{2})[a-z]* (\d{1,2})\b.*?\b(\d{4})\b", s)  # "Thu Jan 05 10:00:00 UTC 2023", "Jan 5, 2023"
    d = parse_date(f"{m[2]} {m[1]} {m[3]}", ("%d %b %Y",)) if m else None
    d = d or parse_date(s, ("%d %b %Y", "%m/%d/%y", "%m/%d/%Y", "%b %Y", "%Y"))
    return d.date() if d else None


HASHTAG = re.compile(r"#(\w{2,40})")


def layers(d, df):
    """Heterogeneous layer around the people graph: {"nodes": [...], "edges": [...], "counts": {...}}.
    Person ends of edges are person ids (int); other nodes have string ids "<kind>:<key>"."""
    rd = lambda name: read_export_csv(os.path.join(d, name), min_fields=1)
    nodes, acc = {}, Counter()
    who = {n.lower(): i for i, n in zip(df["id"], df["name"]) if n}

    def node(kind, label, **extra):
        label = re.sub(r"\s+", " ", str(label or "")).strip()
        if not label:
            return None
        k = f"{kind}:{label.lower()}"
        if k not in nodes:
            nodes[k] = {"id": k, "kind": kind, "label": label}
        nodes[k].update({a: b for a, b in extra.items() if b is not None and a not in nodes[k]})
        return k

    def link(a, b, kind, w=1.0):
        if a is not None and b is not None and a != b:
            acc[(a, b, kind)] += w

    def rows(df_, *cols):
        if df_ is None:
            return []
        cs = [col(df_, *c) if isinstance(c, tuple) else col(df_, c) for c in cols]
        return [[(r[c] if c else "") for c in cs] for r in df_.to_dict("records")]

    # skills + endorsements (the only new data that names other people)
    for (name,) in rows(rd("Skills.csv"), ("Name", "Skill Name", "Skill")):
        node("skill", name, how="on your profile")
    for f in ("Endorsement_Received_Info.csv", "Endorsements.csv"):
        for sk, fn, ln, when in rows(rd(f), ("Skill Name", "Skill"), "Endorser First Name", "Endorser Last Name", ("Endorsement Date", "Date")):
            p = who.get(f"{fn} {ln}".strip().lower())
            if fn and sk:
                s = node("skill", sk, how="endorsed on your profile")
                if p is not None:
                    link(p, s, "endorsed you for")
                else:  # endorser is not a 1st-degree connection: count only
                    nodes[s]["outside"] = nodes[s].get("outside", 0) + 1
    for f in ("Endorsement_Given_Info.csv", "Endorsements.csv"):
        for sk, fn, ln in rows(rd(f), ("Skill Name", "Skill"), "Endorsee First Name", "Endorsee Last Name"):
            p = who.get(f"{fn} {ln}".strip().lower())
            if p is not None and sk:
                link(p, node("skill", sk, how="you endorsed someone for it"), "you endorsed for")

    # organisations: your employers, schools, followed companies -> people currently there
    orgs = [(c, "you worked here") for (c,) in rows(rd("Positions.csv"), "Company Name")]
    orgs += [(c, "you studied here") for (c,) in rows(rd("Education.csv"), ("School Name", "School"))]
    orgs += [(c, "you follow it") for c, _ in rows(rd("Company Follows.csv"), ("Organization", "Company", "Name"), ("Followed On", "Date"))]
    by_co = defaultdict(list)
    for i, co in zip(df["id"], df["company"]):
        if not is_generic(co):
            by_co[clean(co)].append(i)
    for name, how in orgs:
        o, ck = node("org", name, how=how), clean(name)
        if o and ck:
            hit = max(by_co, key=lambda k: ratio(ck, k), default=None)
            for p in (by_co[hit] if hit is not None and ratio(ck, hit) >= 0.88 else []):
                link(p, o, "works at")

    # events -> people you connected with in the week after
    dated = [(i, c.date()) for i, c in zip(df["id"], df["connected_on"]) if c is not None]
    for name, when in rows(rd("Events.csv"), ("Event Name", "Name", "Title"), ("Event Time", "Date", "Start Date")):
        day = any_date(when)
        e = node("event", name, date=day.isoformat() if day else None)
        for i, c in dated if day else []:
            if 0 <= (c - day).days <= 7:
                link(i, e, "connected after")

    # posts and comments -> hashtags (topics) and skills they mention
    skill_rx = {k: re.compile(r"(?<!\w)" + re.escape(v["label"]) + r"(?!\w)", re.I)
                for k, v in nodes.items() if v["kind"] == "skill" and len(v["label"]) >= 2}

    def mentions(src, text):
        for t in HASHTAG.findall(text):
            link(src, node("topic", "#" + t.lower()), "tagged")
        for k, rx in skill_rx.items():
            if rx.search(text):
                link(src, k, "mentions")

    n_posts = 0
    for when, text in rows(rd("Shares.csv"), "Date", ("ShareCommentary", "Commentary", "Text")):
        text, day = str(text or "").strip(), any_date(when)
        if text:
            n_posts += 1
            p = node("post", f"{(day or '')} {text[:48]}…" if len(text) > 48 else f"{(day or '')} {text}",
                     date=day.isoformat() if day else None, text=text[:280], how="your post")
            mentions(p, text)
    for when, text in rows(rd("Comments.csv"), "Date", ("Message", "Comment", "Text")):
        text, day = str(text or "").strip(), any_date(when)
        if HASHTAG.search(text) or any(rx.search(text) for rx in skill_rx.values()):  # unlinked comments add nothing
            p = node("post", f"{(day or '')} {text[:48]}…" if len(text) > 48 else f"{(day or '')} {text}",
                     date=day.isoformat() if day else None, text=text[:280], how="your comment")
            mentions(p, text)

    # groups -> topics/skills their name mentions
    for (name,) in rows(rd("Groups.csv"), ("Title", "Group Name", "Name")):
        g = node("group", name, how="you are a member")
        if g:
            words = set(re.findall(r"\w+", name.lower()))
            for k, v in list(nodes.items()):
                if (v["kind"] == "topic" and v["label"][1:] in words) or (k in skill_rx and skill_rx[k].search(name)):
                    link(g, k, "about")

    # people you follow: flag connections, add the rest as their own nodes
    followed = set()
    for (name,) in rows(rd("Member_Follows.csv"), ("FullName", "Full Name", "Name")):
        p = who.get(str(name).strip().lower())
        followed.add(p) if p is not None else node("follow", name, how="you follow them, not connected")

    # recommendations: a direct tie to you
    for f, kind in (("Recommendations_Received.csv", "recommended you"), ("Recommendations_Given.csv", "you recommended"),
                    ("Recommendations.csv", "recommendation")):  # API: given and received mixed, direction unknown
        for fn, ln in rows(rd(f), "First Name", "Last Name"):
            p = who.get(f"{fn} {ln}".strip().lower())
            if p is not None:
                link(p, "you", kind)

    # anything with no other link hangs off "you", so nothing floats
    linked = {x for a, b, _ in acc for x in (a, b)}
    for k in nodes:
        if k not in linked:
            link(k, "you", "yours")
    if any("you" in (a, b) for a, b, _ in acc):
        nodes["you"] = {"id": "you", "kind": "you", "label": "You"}
    kinds = Counter(v["kind"] for v in nodes.values())
    reacts = rd("Reactions.csv")
    return {
        "nodes": list(nodes.values()),
        "edges": [{"s": a, "t": b, "kind": k, "w": w} for (a, b, k), w in sorted(acc.items(), key=str)],
        "followed": sorted(int(x) for x in followed),
        "counts": {**kinds, "posts": n_posts, "reactions": 0 if reacts is None else len(reacts)},
    }


def run(input_dir, weights=None, seed=0, resolution=1.0, cutoff=0.88):
    W = dict(DEFAULT_W if weights is None else weights)
    df, g, merges = build(input_dir, W, cutoff)
    memb, q = cluster(g, seed, resolution)
    n = len(df)
    clusters = summarise(df, g, memb)
    return {
        "meta": {"n_people": n, "n_edges": g.ecount(), "n_clusters": sum(1 for c in clusters if c["id"] >= 0),
                 "share_unplaced": round(memb.count(-1) / n, 3) if n else 0.0, "weights": W, "seed": seed,
                 "resolution": resolution, "modularity": None if q is None else round(q, 4),
                 "generic": sorted({c for c in df["company"] if c and is_generic(c)})},
        "nodes": [{"id": int(r["id"]), "name": r["name"], "company": r["company"], "title": r["title"],
                   "role": r["role"], "connected_on": r["connected_on"].date().isoformat() if r["connected_on"] else None,
                   "cluster": memb[k]} for k, r in enumerate(df.to_dict("records"))],
        "edges": [{"s": e.source, "t": e.target, "w": round(e["weight"], 4)} for e in g.es],
        "clusters": clusters,
        "merges": [{"raw": r, "canonical": c, "score": s} for r, c, s in merges],
        "layers": layers(input_dir, df),
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
    for name, head, body in [
        ("Skills.csv", ["Name"], [["Python"], ["Forecasting"]]),
        ("Endorsement_Received_Info.csv", ["Endorsement Date", "Skill Name", "Endorser First Name", "Endorser Last Name"],
         [["2024/01/02 10:00:00 UTC", "Python", "P0", "Test"], ["2024/01/02 10:00:00 UTC", "Python", "Not", "Connected"]]),
        ("Company Follows.csv", ["Organization", "Followed On"], [["Globex Corporation", "Thu Jan 05 10:00:00 UTC 2023"]]),
        ("Events.csv", ["Event Name", "Event Time"], [["Expo", "Oct 12, 2025, 9:00 AM"]]),
        ("Shares.csv", ["Date", "ShareCommentary"], [["2024-03-01 10:00:00", "Shipping #forecasting work in python"]]),
        ("Groups.csv", ["Title"], [["Forecasting Guild"], ["Quiet Club"]]),
    ]:
        with open(os.path.join(d, name), "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerows([head] + body)
    data = load(d)
    assert len(data["connections"]) == len(rows) and "Connected On" in data["connections"].columns, "header scan"
    assert data["invitations"] is None, "optional files tolerated"
    mapping, merges = merge(["Acme Inc.", "ACME", "Acme", "Acme", "Globex"])
    assert mapping["Acme Inc."] == mapping["ACME"] == "Acme", mapping
    assert all(r != c for r, c, _ in merges)
    tail = " International Holdings Group Limited (EMEA Operations Division)"  # long shared suffix must not merge
    mapping, _ = merge([f"{w}{tail}" for w in ("Alpha", "Beta", "Gamma", "Delta")] + ["Acme Inc.", "ACME"])
    assert len({mapping[f"{w}{tail}"] for w in ("Alpha", "Beta", "Gamma", "Delta")}) == 4 and mapping["ACME"] == mapping["Acme Inc."], mapping
    for name in ("Freelance", "Self-Employed", "self employed", "Freelance UX designer", "Stealth Startup", "Independent Consultant",
                 "Indépendant", "Auto-entrepreneur", "Consultant", "n/a", "", "Selbstständig"):
        assert is_generic(name), ("generic employer not caught", name)
    for name in ("Acme Consulting", "Independent Bank", "Stealth Bio", "Freelancer.com Ltd", "Student Loans Company", "Initech"):
        assert not is_generic(name), ("real company caught as generic", name)
    gen = [{"First Name": f"F{k}", "Last Name": "Test", "Company": c, "Position": "Engineer", "connected_on": None}
           for k, c in enumerate(["Freelance", "Freelance", "freelance", "Self-employed", "Self Employed"])]
    gdf, _ = people(dict(data, connections=pd.DataFrame(gen)))
    assert not any(a.startswith(("co:", "ego:")) for affs in gdf["affs"] for a in affs), "generic employer made a company tie"
    assert project(gdf).ecount() == 0, "people sharing only a generic employer must not be linked"
    out = run(d)
    truth = [cos[co] for co, _ in rows if co in cos]
    got = [n["cluster"] for n, (co, _) in zip(out["nodes"], rows) if co in cos]
    ari = ig.compare_communities(truth, got, method="ari")
    assert abs(ari - 1.0) < 1e-9, ("ARI", ari, got)
    assert any(a.startswith("ego:") for a in people(data)[0]["affs"].iloc[-6]), "ego affiliation"
    L = out["layers"]
    E = {(e["s"], e["t"], e["kind"]) for e in L["edges"]}
    assert (0, "skill:python", "endorsed you for") in E, "endorsement -> person-skill edge"
    assert sum(1 for e in E if e[1] == "org:globex corporation" and e[2] == "works at") == 5, "followed org -> its people"
    assert sum(1 for e in E if e[1] == "event:expo") == len(rows), "event -> people connected that week"
    post = next(n["id"] for n in L["nodes"] if n["kind"] == "post")
    assert {(post, "topic:#forecasting", "tagged"), (post, "skill:python", "mentions")} <= E, "post -> topic, skill"
    assert ("group:forecasting guild", "topic:#forecasting", "about") in E and ("group:quiet club", "you", "yours") in E
    assert any_date("Thu Jan 05 10:00:00 UTC 2023").isoformat() == "2023-01-05" and any_date("Oct 12, 2025, 9:00 AM").day == 12
    # circle basis: 4 people at 4 companies added the same week vs 3 colleagues -> "dates" (named by month) and "company"
    bd = pd.DataFrame({"company": ["Aa", "Bb", "Cc", "Dd", "Ee", "Ee", "Ee"], "role": ["other"] * 7,
                       "connected_on": [datetime(2024, 3, k) for k in (1, 2, 3, 4)] + [datetime(2020, 1, 1)] * 3})
    bg = ig.Graph(n=7, edges=[(0, 1), (1, 2), (2, 3), (0, 3), (4, 5), (5, 6)], edge_attrs={"weight": [1.0] * 6, "co": [0, 0, 0, 0, 1, 1]})
    bs = {c["id"]: c for c in summarise(bd, bg, [0, 0, 0, 0, 1, 1, 1])}
    assert (bs[0]["basis"], bs[0]["label"], bs[1]["basis"], bs[1]["label"]) == ("dates", "Added Mar 2024", "company", "Ee"), bs
    assert basis(0.5) == "both" and all(c["basis"] in ("company", "dates", "both") for c in out["clusters"] if c["id"] >= 0)
    demo = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo", "data")
    rs = resample_ari(demo, frac=0.9, runs=5)  # synthetic demo; measured mean 0.92 over 10 runs
    assert sum(rs) / len(rs) >= 0.8, ("circles unstable when 10% of connections are dropped", rs)
    print(f"selftest ok: ARI={ari}, clusters={out['meta']['n_clusters']}, edges={out['meta']['n_edges']}, "
          f"resample ARI (90%, 5 runs, demo) mean={sum(rs) / len(rs):.3f} min={min(rs):.3f}")


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
        print("layers: " + " ".join(f"{k}={v}" for k, v in sorted(res["layers"]["counts"].items())))
    else:
        sys.exit(__doc__)
