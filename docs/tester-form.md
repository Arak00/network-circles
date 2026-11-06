# Tester form

Thanks for trying this. It takes about 15 minutes.

## Your data stays on your machine

You run the tool on your own computer with your own LinkedIn export. Nothing is uploaded. The only thing you send back is the three scores below and, if you want, a comment. Please don't include names of people or companies in the comment.

## Run it

1. Request your data from LinkedIn (Settings, Data privacy, Get a copy of your data). Pick the larger archive, which includes Connections and Positions. LinkedIn emails a zip.
2. Open https://arak00.github.io/network-circles/web/?own=1 and drop the zip on the page as it is. It's read in your browser tab and never uploaded.

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

Post one line as a [GitHub issue](https://github.com/Arak00/network-circles/issues/new?title=Tester%20result) or as a reply in the launch thread, in this format: `tester,q1,q2,q3,comment`, for example `T1,4,3,5,the work groups were right but my university friends were split in two`.
