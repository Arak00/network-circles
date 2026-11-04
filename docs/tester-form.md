# Tester form

Thanks for trying this. It takes about 15 minutes.

## Your data stays on your machine

You run the tool on your own computer with your own LinkedIn export. Nothing is uploaded. The only thing you send back is the three scores below and, if you want, a comment. Please don't include names of people or companies in the comment.

## Run it

1. Download your data from LinkedIn: Settings, Data privacy, Get a copy of your data. Pick the archive that includes Connections and Positions, then unzip it into a folder.
2. Open the viewer page (`web/index.html`, served with `python -m http.server` from the repo folder) and drop `Connections.csv` and `Positions.csv` onto it. Your files are read in the browser tab.

   Or from a terminal: `python src/netmap.py <your_export_folder> results/private/graph.json`, then load that file in the viewer.
3. Look through the groups for a few minutes.

## Questions

Score each from 1 (not at all) to 5 (completely).

| # | Question | Score (1-5) |
|---|----------|-------------|
| q1 | Do the groups match how you think of your network? | |
| q2 | Are the group labels recognisable? | |
| q3 | Did anything feel wrong or missing? (1 = a lot felt wrong or missing, 5 = nothing did) | |

Comment (optional, no names):

&nbsp;

Send back one line in this format: `tester,q1,q2,q3,comment`, for example `T1,4,3,5,the work groups were right but my university friends were split in two`.
