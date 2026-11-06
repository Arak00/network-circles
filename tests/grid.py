#!/usr/bin/env python3
"""Test grid: synthetic raw exports at several sizes plus edge cases, each run through netmap like a real export.
  python tests/grid.py            -> tests/out/<case>/data/*.csv and tests/out/<case>/graph.json
Everything is fictional (src/synth.py). tests/out/ is gitignored and rebuilt on every run."""
import csv, json, os, random, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))
import netmap, synth  # noqa: E402

OUT = os.path.join(ROOT, "tests", "out")
# fictional names in non-Latin scripts (combined at random, like synth's Latin lists)
NL_FIRST = "さくら 健太 Алина Дмитрий Σοφία Νίκος فاطمة يوسف प्रिया अर्जुन 민준 서연 美玲 志强 Ἀλέξης".split()
NL_LAST = "山田 佐藤 Иванова Смирнов Παπαδόπουλος حداد خليل शर्मा पटेल 김 이 王 李 Κωνσταντίνου".split()
LONG = " International Holdings Group Limited (Europe, Middle East and Africa Operations Division)"


def rewrite(path, fn):
    """Apply fn(header, row) -> row to a CSV that may start with LinkedIn's Notes preamble."""
    with open(path, newline="", encoding="utf-8") as f:
        lines = f.read().split("\n")
    i = next(k for k, l in enumerate(lines) if l.startswith("First Name") or l.startswith("Company Name"))
    rows = list(csv.reader(lines[i:]))
    head, body = rows[0], [r for r in rows[1:] if r]
    with open(path, "w", newline="", encoding="utf-8") as f:
        f.write("\n".join(lines[:i]) + ("\n" if i else ""))
        csv.writer(f, lineterminator="\n").writerows([head] + [fn(head, r) for r in body])


def case(name, scale=1.0, tweak=None):
    d = os.path.join(OUT, name)
    rows, truth, pos = synth.gen(42, scale=scale)
    synth.write(rows, truth, pos, out=d)
    if tweak:
        tweak(os.path.join(d, "data"), random.Random(1))
    res = netmap.run(os.path.join(d, "data"))
    with open(os.path.join(d, "graph.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False)
    m = res["meta"]
    print(f"{name:10} people={m['n_people']:5} clusters={m['n_clusters']:3} layer_nodes={len(res['layers']['nodes'])}")


def no_dates(d, rng):
    rewrite(os.path.join(d, "Connections.csv"), lambda h, r: r[:6] + [""])


def one_circle(d, rng):
    rewrite(os.path.join(d, "Connections.csv"), lambda h, r: r[:4] + ["Ashgrove Mobility"] + r[5:])


def skills_88(d, rng):
    adj = "Applied Strategic Digital Advanced Operational Agile Cloud Data".split()
    noun = "Analytics Planning Design Modelling Governance Delivery Research Security Pricing Testing Writing".split()
    with open(os.path.join(d, "Skills.csv"), "w", newline="", encoding="utf-8") as f:
        csv.writer(f, lineterminator="\n").writerows([["Name"]] + [[f"{a} {b}"] for a in adj for b in noun])
    for f in ("Endorsement_Received_Info.csv", "Endorsement_Given_Info.csv"):
        os.remove(os.path.join(d, f))  # like the API today: skills, but nobody linked to them


def non_latin(d, rng):
    rewrite(os.path.join(d, "Connections.csv"), lambda h, r: [rng.choice(NL_FIRST), rng.choice(NL_LAST)] + r[2:])


def long_names(d, rng):
    rewrite(os.path.join(d, "Connections.csv"), lambda h, r: r[:4] + [r[4] + LONG if r[4] else ""] + r[5:])
    rewrite(os.path.join(d, "Positions.csv"), lambda h, r: [r[0] + LONG] + r[1:])


# Strings people type when they have no employer to name; shared by strangers, so they must not make a circle.
GENERIC = ["Freelance", "Self-employed", "Self Employed", "Freelancer", "Independent Consultant", "Stealth Startup",
           "Consultant", "Indépendant", "Auto-entrepreneur", "Freelance UX Designer", "Stealth", "Confidential"]


def generic(d, rng):  # a quarter of the demo lists a generic employer (on real exports one "Freelance" swallowed most of the network)
    rewrite(os.path.join(d, "Connections.csv"), lambda h, r: r[:4] + [rng.choice(GENERIC) if rng.random() < 0.25 else r[4]] + r[5:])


def bunched(d, rng):  # most connections added in one month (an address-book import): the timeline must collapse
    rewrite(os.path.join(d, "Connections.csv"), lambda h, r: r[:6] + [f"{rng.randint(1, 30):02d} Sep 2024" if rng.random() < 0.7 else r[6]])


CASES = {"tiny": (0.1, None), "demo": (1.0, None), "large": (10.0, None), "nodates": (1.0, no_dates),
         "onecircle": (0.2, one_circle), "skills88": (1.0, skills_88), "nonlatin": (1.0, non_latin), "longnames": (1.0, long_names), "generic": (1.0, generic), "bunched": (1.0, bunched)}

if __name__ == "__main__":
    shutil.rmtree(OUT, ignore_errors=True)
    for k in sys.argv[1:] or CASES:
        case(k, *CASES[k])
