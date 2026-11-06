# Verdict: redesign

The viewer scores 16/30, under the refine threshold of 20. The weakest load-bearing principles are useful (#2) and understandable (#4): the primary job is on screen but buried, and the screen has no first thing to do.

## Problems ranked by how much they block the jobs

| Rank | Problem | Jobs blocked | Evidence | Outcome (build on branch viewer-redesign) |
|---|---|---|---|---|
| 1 | A generic employer ("Freelance") forms a giant circle that floods search results, circle names and pins | T6, J1, J2, J4 | E3 | Fixed in `src/netmap.py`; grid case `generic` |
| 2 | No clear first action: the who-do-I-know box is in the side panel, last in focus order, about 1,000 px down on a phone, and a second search box in the toolbar does something else | T6, J2 | E2 | Done: one search box, first on every layout and width; it also finds names, skills and events |
| 3 | Clicking a result zooms to 0.35 and greys out everything; the person's circle and neighbours lose their labels; the tooltip lands on the toolbar | T6, J2 | E1, E2 | Done: no zoom on click, detail opens under the result; tested |
| 4 | A pin lights up the whole employer (all 60 people in onecircle, 434 nodes in large) with a starburst of links | J2, T6 | E1, E2 | Done: a pin keeps its own skill, organisation and event links only, names at most 20 people; tested |
| 5 | Nodes overlap (77% on the demo at fit, 97% on large) and names sit on discs, so the map can't be read where it's dense | J1, J2 | E1, E2 | Done: packed circles, no overlap by construction; tested |
| 6 | The timeline is a flat line with one spike when most connections fall in one month | J3, T7 | E2 | Done: collapses to a sentence naming the months; grid case `bunched` |
| 7 | Jargon on screen: circles, cohesion, unplaced, fold, Layers | J1, J4 | E2 | Mostly done: "Not in a circle", no fold, cohesion moved to the trust notes. "Circle" and "Layers" stay, explained in How it works |
| 8 | The status line shows a file path or a list of file names, not what happened | none directly | E2 | Done: one sentence, tested |
| 9 | A modal dialog opens before anything is visible on first visit | T1 to T7 start | E2 | Done: no dialog on first visit; the question itself is the first thing on screen |
| 10 | A 3,000-person network blocks the tab for about 21 s while it lays out | all, on big exports | E6 | Deferred, not improved: headless load measured 17 to 23 s across runs (about 21 s before): the layout itself now takes 2.5 s of script, and the rest is loading 193,000 links and drawing the first frame in software WebGL. Next step: leave person-to-person links out of the graph until Layers needs them |

## The moves with most leverage

1. Useful (#2): one search box that answers "who do I know at…" as the first thing on screen, on every width. Evidence: E2 (`index.html:184`, `index.html:204`).
2. Understandable (#4): a person click shows that person and their own links next to the list, at a scale where nodes don't touch. Evidence: `app.js:392`, `app.js:498`.
3. Aesthetic (#3): a map layout where nodes can't overlap, for example each circle packed as a disc of dots, instead of a force layout that piles big employers into blobs. Evidence: E1.
4. As little design as possible (#10): keep one search, one list, one map; move circle details, layer toggles and the timeline behind a second step. Evidence: E2.
5. Thorough (#8): a timeline that switches to a few labelled months when connections cluster. Evidence: E2 (`app.js:660`).

## Decision after the audit

The author chose to keep all three directions as layouts the visitor switches between (List, Map, Circles), so they can be compared in usability sessions (`?view=` assigns the starting one) and, if the author turns on the anonymous counter, online.

## Deferred on purpose

- J5 (what two circles have in common) now lives only in Layers: the packed map no longer places related circles near each other.
- The Layers view itself was not redesigned; it keeps its tests (label overlaps, scale, crossings).
- No online counting: `track()` in `web/app.js` is empty until the author decides.
