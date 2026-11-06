# Findings: which jobs the evidence supports

Desk research of 2026-11-06, testing the predictions in `hypotheses.md` (written before it). Quotes are in `evidence.csv` and cited here by id (E01 to E76). The field work in `screener.md`, `interview-guide.md` and `fake-door.md` is what should confirm or overturn these conclusions.

## Sources and how far to trust them

| Source | Quotes | How checked |
|--------|--------|-------------|
| Hacker News comments (Algolia API) | 28 | Full comment text from the API; three re-fetched independently |
| News, blogs, LinkedIn's own pages, archived pages (InMaps and similar tools) | 21 | Fetched pages; three re-checked against the raw HTML |
| Product Hunt reviews (Dex, Folk, Clay, Sales Navigator, Kumu) | 27 | Through a page-reading tool only; Product Hunt blocks raw fetching, so wording is unconfirmed. Dates are approximate ("3 years ago") |

Gaps: Reddit, G2, Capterra and TrustRadius refused automated access, and the research did not try to get around that. LinkedIn's help forum returned nothing usable, and no quotes came from Graph Commons users. Hacker News leans towards technical people, and many quotes are old (2011 to 2016 for InMaps). Nothing turned up about creators (H6) or students (H7), because no sweep was aimed at them. The counts below are counts of collected quotes, so they show which themes exist, not how common they are. The visualisation theme has more quotes partly because one sweep searched only that.

## Affinity map

| Job (cluster) | Quotes | What people describe | Ids |
|---------------|--------|----------------------|-----|
| Who do I know at X (warm introductions) | 10 | Working back from a job post or an investor list to 1st- and 2nd-degree connections; referrals from former coworkers | E03 E04 E06 E07 E08 E09 E10 E11 E25 E26 |
| My own searchable copy of my network | 12 | Exporting connections and tagging them by role, company and location to answer questions like "do you know any good recruiters in NYC?"; keeping a local copy in case the account is lost; pruning connections they don't really know | E01 E02 E05 E16 E18 E23 E53 E54 E58 E60 E67 E70 |
| Keep in touch | 8 | Forgetting who people are; reminders; paying for, or building, personal CRMs | E12 E14 E15 E51 E52 E63 E68 E69 |
| Fundraising and sales pipeline | 5 | Folk for a seed round and investor relations, Clay for personalised outreach, Sales Navigator for finding targets outside the network | E56 E59 E62 E73 E74 |
| Follow up after an event | 3 | People met at events are forgotten; nobody follows up beyond connecting on LinkedIn | E13 E50 E55 |
| Look at my network | 17 | Delight on first look, maps that are hard to read past ~300 people, recipes to rebuild InMaps after it closed | E19 E20 E21 E29 E30 E31 E34 E35 E36 E39 E40 E41 E42 E44 E45 E48 E76 |
| Why network maps disappeared | 6 | InMaps retired "to focus"; successors lost API access; Vizify bought and closed | E37 E38 E43 E46 E47 E49 |
| Data and privacy limits | 6 | Export without emails; EU complete archive reported in 2025 to lack the connections file; anxiety about uploading connections | E17 E22 E24 E27 E28 E65 |
| Recruiter sourcing | 2 | A sourcer found no practical sourcing use in InMaps | E32 E33 |
| Tool usability complaints | 7 | Duplicates, bulk edit, credits, trial length | E57 E61 E64 E66 E71 E72 E75 |

The first two rows describe the same need from two sides: knowing, on demand, who you already know at a company or in a role. E01 is the clearest case: a manager asks for recruiter contacts in a city, and a tagged export answers it in a couple of clicks. Together they are the largest cluster of need-driven quotes (22).

## Verdicts on the predictions

| Id | Prediction | Verdict | Evidence |
|----|------------|---------|----------|
| H0 | A network picture alone is a one-off curiosity | Supported, weakly | Every positive quote is a first-look reaction (E20 E34 E35 E36); the only claims of repeated looking come from LinkedIn's launch post and its own data scientist (E30 E31). Wolfram's Facebook analytics reached over a million people (E48), which shows reach, not return visits. No source has repeat-use data either way |
| H1 | Job seekers' network job is the warm introduction | Supported | E03 E04 E07 E08 E09 E26 describe exactly this, with spreadsheets and LinkedIn search as the workaround. The specific complaint that LinkedIn doesn't show who really knows whom is only indirect (E16 E17 E18: networks full of people they don't know) |
| H2 | Founders export to a spreadsheet or Clay; the export is thin | Supported, with a correction | Spreadsheets of investors checked against LinkedIn (E06), Folk for fundraising (E56 E59 E62), Clay for outreach (E73). Thin export confirmed (E28: no emails). Correction: they reach for a CRM, not for their raw export, once they are serious |
| H3 | After events, the pain is remembering and following up, not measuring | Supported, thinly | E13 E50 E55 are about forgetting and not following up; no quote asks how much an event grew a network. Only three quotes, and organisers weren't searched for |
| H4 | Keeping in touch is the most repeated job; the pain is forgetting | Supported | E12 E15 E51 E52 E63 E68. No personal-CRM review asks for network mapping. It is a crowded market (Dex, Folk, Clay, Monica) that people still find hard (E12 "still bad at keeping in touch") |
| H5 | Recruiters won't use a map of their own network | Supported, thinly | A sourcer's verdict: "there isn't really much applicable sourcing use" (E32), and no search in the map (E33) |
| H6 | Creators need audience data the export lacks | Untested | No evidence found either way |
| H7 | Students are served by the alumni tool | Untested | No evidence found either way |
| H8 | InMaps closed because people didn't come back | Weakened | LinkedIn's stated reason was to "focus our attention and resources" (E37 E38); TechCrunch said its popularity was unclear and that LinkedIn was moving analytics into the profile (E39). Reactions to the shutdown were few and mild (E21 E42 E44), which fits low attachment, but no source says usage fell. Its successors died of lost API access (E43 E46 E47), a risk this project shares |

## Ranking

| Rank | Job | Frequency (quotes) | Pain | Data fit (`feasibility.md`) | Call |
|------|-----|-------------------|------|-----------------------------|------|
| 1 | Who do I already know at a company or in a role | 22 | High: "freakin' HARD" (E06), 2,000+ applications after going through the network (E26), people build their own tag systems (E01 E02) | Servable with a feature: company and title are 98 to 99% filled; no location, no 2nd degree | Focus |
| 2 | Keep in touch | 8 | High, and people pay for it | Not servable without reading messages | Drop for now |
| 3 | Fundraising and sales pipeline | 5 | Medium; already served by CRMs | Only the part that is job 1 | Merge into job 1 |
| 4 | Follow up after an event | 3 | Medium | Servable with a feature: connection dates are complete, and the timeline already shows the week-after burst | Second focus, provisional |
| 5 | Look at my network | 17 (inflated) | Low | Servable now | Keep as the way in, not as the job |
| 6 | Recruiter sourcing, creator audience, student alumni | 2, 0, 0 | Low or unknown | Not servable | Drop |

## Recommendation

Focus on two jobs.

1. "Who do I already know at these companies, or in these roles?" It has the most need-driven evidence, the clearest workaround to replace (a tagged export or a spreadsheet, E01 E02 E03 E04), and the data supports it. The feature it implies: type or paste target companies or role words and get the people you know there, with their circle and when you connected, and a CSV out. Today the viewer only finds organisations from your own history and follows, so most target companies can't be searched yet.
2. "Who did I meet around that event?", provisionally. The evidence is thin (three quotes), but it is the one job where the timeline is unique and the data is complete. Keep it only if at least three of six event interviewees describe forgetting people they met and a workaround they use.

Drop keeping in touch: it is the most painful job after introductions, but serving it means reading messages, and that is a privacy decision to make on purpose, not by drift. Several mature tools already serve it. Drop recruiter, creator and student until someone brings evidence.

Two risks found along the way:
- E27 (2025) reports that the EU complete archive no longer contains the connections file. The API route avoids this, but the drop-your-zip path may fail for EU users; check with a fresh export.
- Anxiety about uploading connections (E24, E65) supports the local-only design and should be said clearly on the page.

## What the field work must settle

- Whether job 1 is pulled by job seekers, founders, or both. The fake door splits them only if they read the card differently, so the interviews must ask.
- Whether event follow-up is real enough to build (the rule above).
- Whether anyone returns to the map after the first look (H0). The fake-door counts and a second-visit question in the interviews are the only evidence we can get.
