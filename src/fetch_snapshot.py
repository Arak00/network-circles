#!/usr/bin/env python3
"""Download your own LinkedIn data through the DMA Member Data Portability API and save it as export-style CSVs.

EEA/Switzerland members only. One-time setup (no partner review):
  1. Create an app at https://www.linkedin.com/developers/apps using the page
     "Member Data Portability (Member) Default Company".
  2. Products tab -> request "Member Data Portability API (Member)".
  3. Docs and tools -> OAuth Token Tools -> Create token, scope r_dma_portability_self_serve.
Then:
  LINKEDIN_TOKEN=... python src/fetch_snapshot.py [out_dir=data/api]
  python src/netmap.py data/api results/private/graph.json

Prints domain names, row counts and column names only, never values. The token is read from the environment
and sent only to api.linkedin.com.
"""
import csv, json, os, re, sys, urllib.error, urllib.parse, urllib.request

API = "https://api.linkedin.com/rest/memberSnapshotData"
# Snapshot domain -> file name netmap.py reads. RECOMMENDATIONS mixes given and received with no direction column. INBOX is deliberately absent: messages are never fetched.
FILES = {
    "CONNECTIONS": "Connections.csv", "POSITIONS": "Positions.csv", "EDUCATION": "Education.csv",
    "SKILLS": "Skills.csv", "ENDORSEMENTS": "Endorsements.csv", "COMPANY_FOLLOWS": "Company Follows.csv",
    "MEMBER_FOLLOWING": "Member_Follows.csv", "GROUPS": "Groups.csv", "EVENTS": "Events.csv",
    "MEMBER_SHARE_INFO": "Shares.csv", "ALL_COMMENTS": "Comments.csv", "ALL_LIKES": "Reactions.csv",
    "RECOMMENDATIONS": "Recommendations.csv", "INVITATIONS": "Invitations.csv",
}


SKIPPED = set()


def pages(domain, token):
    """All snapshotData rows for one domain. Pages run until LinkedIn answers 404 'No data found' ("total" is unreliable)."""
    start = 0
    while True:
        q = urllib.parse.urlencode({"q": "criteria", "domain": domain, "start": start})
        req = urllib.request.Request(f"{API}?{q}", headers={"Authorization": f"Bearer {token}", "Linkedin-Version": "202312"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return
            try:  # LinkedIn's error JSON carries a message ("Invalid access token", "Not enough permissions..."); no member data
                msg = json.loads(e.read().decode("utf-8", "replace")).get("message", "")
            except ValueError:
                msg = ""
            if e.code == 400 and "not supported" in msg:  # documented but not served (e.g. EVENTS): skip, keep going
                print(f"{domain:18}      - skipped: {msg}")
                SKIPPED.add(domain)
                return
            raise SystemExit(f"{domain}: HTTP {e.code} {e.reason}" + (f": {msg}" if msg else "")
                             + (" (check the token and its r_dma_portability_self_serve scope)" if e.code in (401, 403) else ""))
        rows = [x for el in body.get("elements", []) for x in el.get("snapshotData", [])]
        if not rows:
            return
        yield from rows
        if not any(l.get("rel") == "next" for l in body.get("paging", {}).get("links", [])):
            return
        start += 1


def write(path, rows):
    cols = list(dict.fromkeys(k for r in rows for k in r))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, cols, extrasaction="ignore")
        w.writeheader()
        w.writerows({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in r.items()} for r in rows)
    return cols


def main(out):
    token = re.sub(r"\x1b\[20[01]~|\s", "", os.environ.get("LINKEDIN_TOKEN", ""))  # bracketed-paste markers, newlines
    token = re.sub(r"(?i)^bearer", "", token.strip("\"'"))
    if not token:
        sys.exit(__doc__)
    if len(token) < 100 or re.search(r"[^\w.~+/=-]", token):  # access tokens are long and URL-safe
        sys.exit(f"LINKEDIN_TOKEN does not look like an access token ({len(token)} characters). Client ID and Client "
                 "Secret are short; the access token from OAuth Token Tools is several hundred characters.")
    os.makedirs(out, exist_ok=True)
    for domain, name in FILES.items():
        rows = list(pages(domain, token))
        if rows:
            print(f"{domain:18} {len(rows):6} rows -> {name}  columns: {', '.join(write(os.path.join(out, name), rows))}")
        if not rows and domain not in SKIPPED:
            print(f"{domain:18}      0 rows (not ready yet, or empty)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "api"))
