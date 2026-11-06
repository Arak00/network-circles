# What the data can serve

For each job in `hypotheses.md`: the fields it needs, whether they exist in a real export and in the synthetic test grid (`tests/grid.py`), and a verdict. Real-export figures are aggregate fill rates from the author's own export (325 connections), measured 2026-11-06; no values are reproduced here.

Sources compared:
- Zip export ("larger archive" from Settings, Data privacy): Connections, Positions, Invitations, Recommendations, and in the full archive Skills, Endorsements, Messages, Shares, Comments, Reactions, Events, Groups.
- API snapshot (`src/fetch_snapshot.py`, Member Data Portability API): Connections, Positions, Education, Skills, Company Follows, Groups, Invitations, Recommendations returned rows. Endorsements, Member Following, Shares, Comments and Likes returned 0 rows; Events is not supported. Messages are never fetched by design.
- Synthetic grid: every layer file, including endorsements, events and posts.

## Field fill rates in the real export

| Field | Fill rate |
|-------|-----------|
| Connection: Company | 98% |
| Connection: Position (title) | 99% |
| Connection: Connected On | 100% |
| Connection: profile URL | 99% |
| Connection: Email Address | 0.9% |
| Invitation: personal message | 8% of 64 invitations |
| Endorsements (API) | 0 rows |
| Your posts, comments, likes (API) | 0 rows |

Fields that exist in no export: anyone's connections (2nd degree), connections' skills, education, location, industry or seniority, who follows you, who reacted to your posts.

## Matrix

| Job | Needs | Real export | Synthetic grid | Verdict |
|-----|-------|-------------|----------------|---------|
| H1 Warm intro at a target company | Connections' current company and title; how well you know them; who they know | Company and title yes (98%). Closeness only as connection date and the rare invitation message. Who they know: no | Same, plus fake endorsements | Servable with a feature: "who do I already know at these companies", grouped by circle and dated. Introductions through 2nd-degree people are not servable |
| H2 Door to an investor or customer | Company, title, seniority or industry, contact details | Company and title yes; seniority and industry no; email 0.9% | Same | Servable with a feature for title and role filtering and a CSV out; enrichment needs outside data (Clay and similar), not servable from the export |
| H3 Follow up after an event | Who you met there, when, notes | Connection dates 100%, so the week-after burst is visible; event list only in the zip archive; notes no | Events and bursts both present | Servable with a feature: "people you connected with in the week after date X", with a CSV out |
| H4 Keep in touch | When you last talked to each person | Messages exist only in the zip archive and the tool deliberately never reads them; otherwise only connection date | No messages | Not servable as built. Servable only with an opt-in, local-only read of messages, which is a privacy trade-off to decide on purpose |
| H5 Recruiter sourcing by skill | Connections' skills | No (only your own skills and who endorsed you) | Fake endorsements only | Not servable beyond searching titles |
| H6 Creator audience | Followers, people who react to your posts | No | No | Not servable |
| H7 Student alumni and mentors | Connections' education | No (only your own) | No | Not servable beyond company and title |
| H8 Curiosity, privacy audit | Everything in the export | Yes | Yes | Servable now (the current viewer) |

## A caution about the demo

The synthetic grid is richer than what an API user gets today. In the demo, skills link to people through endorsements and posts link to topics; an API user's export has 0 endorsement and 0 post rows, so their Skills layer shows "0 of 88 linked". Testers who compare their own export with the demo should be told this up front, or the gap will read as a bug.
