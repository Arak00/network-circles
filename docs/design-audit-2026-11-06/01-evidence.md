# Evidence

Numbers from `tests/report/before-shots.json`. "Overlap" is the share of nodes on screen whose disc covers at least 10% of another node's radius. "Labels" counts drawn name labels; "highlighted" counts people kept in colour.

## E1. Measured states

| Case, 1400 light | Step | Camera ratio | Nodes on screen | Overlap | Labels | Highlighted |
|---|---|---|---|---|---|---|
| demo | first screen | 1 | 384 | 77% | 0 | 0 |
| demo | search "Kestrel Talent" | 1 | 384 | 77% | 1 | 2 |
| demo | click first result | 0.35 | 157 | 52% | 2 | 2 |
| demo | pin top person | 0.35 | 157 | 52% | 3 | 51 |
| onecircle | search "Ashgrove Mobility" | 1 | 133 | 31% | 0 | 60 |
| onecircle | pin top person | 0.35 | 29 | 14% | 22 | 64 |
| large | search "Ashgrove Mobility" | 1 | 3083 | 97% | 0 | 363 |
| large | click first result | 0.35 | 527 | 94% | 11 | 417 |
| large | pin top person | 0.35 | 527 | 94% | 12 | 434 |

## E2. Structure (web/index.html, web/app.js)

- About 35 interactive controls on the first screen of the demo: How it works, Open your files, Map, Layers, Find box, Play, month slider, the who-do-I-know box with 5 company chips, Find, Download CSV, Clear, 10 circle rows, the smaller-groups disclosure, 8 layer checkboxes and the trust disclosure.
- Two search boxes with overlapping jobs: the toolbar "Find a person, skill or company" (`index.html:184`, exact-match datalist, pins one node) and "Who do I know at…" (`index.html:204`, company or role words, lists people). A first-time visitor has to choose between them.
- The primary job's box sits in the side panel (`index.html:199`), after the map and the timeline in source order. At 390 px it starts about 1,000 px down the page (`before-demo-390-light-2-search.png`).
- A pin keeps every graph neighbour in colour (`app.js:392`, `S.near = new Set(S.G.neighbors(k))`). Person-person edges come from a shared current employer, so a pin lights up the whole employer: in onecircle all 60 people plus 4 layer nodes, in large 434 nodes.
- Clicking a result calls `goTo()`, which always animates to `ratio: 0.35` (`app.js:498`) and dims everything except the 2 search hits. Circle names and the person's neighbours lose their labels (`before-demo-1400-light-3-result.png`).
- Node size grows with weighted degree (`app.js:79`), so people in big employer cliques are the biggest discs, which packs the big circles into solid blobs (`before-large-1400-dark-3-result.png`).
- Labels are placed right of the node with no test against other nodes' discs, only against other labels (`app.js:384`). In the large case names sit on top of discs.
- The keyboard and click tooltip is positioned before the camera animation lands, so it appears at the top-left corner over the Map/Layers switch and the find box, with its first line cut off (`before-demo-1400-light-3-result.png`, `app.js:466-474`).
- Timeline: one bar per month from first to last connection (`app.js:660`). When most connections fall in one month, that bar takes the full height and the rest of the strip reads as empty. The demo spreads over 10 years, so the demo hides this.
- The source line shows a path ("Loaded /tests/out/demo/graph.json", `app.js:852`); after a file run the status lists every file name (`app.js:766`).
- First visit opens a modal "How it works" dialog before anything is visible (`app.js:782`).

## E3. Data

- Generic employer strings ("Freelance", "Self-employed", "Stealth") created company ties between strangers. On the test case `generic` (demo with a quarter of employers made generic) this gave circles named "Freelance · data" (19), "Self-employed · eng" (12), "Stealth · design" (9) and "Freelance UX Designer · eng" (4). On a real export the same bug put most of the network into one circle. Fixed at source in `src/netmap.py` (`GENERIC`, `is_generic`); see `02-scorecard.md` notes.

## E4. Visual system

- One token set for light and dark (`index.html:10-23`), system font, type sizes 11/12/13/14/16/18 px, radii 4/6/10 px. Palette passes 3:1 and CVD checks (`tests/palette_check.py`).
- States present: empty (own-data prompt), loading ("Loading the demo network…"), error (`#status.err`), success (status line), focus rings (`:focus-visible`), disabled (Play under reduced motion), zero results for a search.

## E5. Honesty

- "Nothing is uploaded" is verified by `tests/journey_test.py` (no request carries a body).
- "How it works" says colours are "people linked by a shared company or added around the same days" (`index.html:173`). Before the fix, a "Freelance" circle broke that claim.
- Circle names say they are generated, and the trust notes say modularity is not proof.

## E6. Weight

- Vendored JS about 430 KB unminified-equivalent (sigma 187 KB, graphology 74 KB, graphology-library 168 KB) plus `app.js` 40 KB; 6 requests for the demo. Pyodide (about 10 MB) loads only when a visitor opens their own files.
- No idle animation; Play is off under reduced motion; dark mode honoured.
- ForceAtlas2 with 300 iterations blocks the tab for about 21 s on the 3,000-person case (`RESUME.md`).

## E7. Accessibility

- `role=img` on the canvas with a text alternative, `#live` polite region, Esc releases a pin, circle list hover and focus single out members without colour, find + Enter pins. axe: no serious or critical findings on the demo (`tests/layout_test.py --axe`).
- No skip link. Focus order runs header, files, toolbar, timeline, then the side panel, so the primary job is the last thing a keyboard user reaches.
