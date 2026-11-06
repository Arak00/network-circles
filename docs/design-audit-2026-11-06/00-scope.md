# Scope

Audited: the viewer at `web/` (`web/index.html`, `web/app.js`) as of commit f293273 plus the generic-employer fix on branch `viewer-redesign`, served locally.

Screens: synthetic data only. The demo (300 people), and two test-grid cases that reproduce problems seen on a real export: `onecircle` (60 people, one employer) and `large` (3,000 people). Each at 1400 px (light and dark) and 390 px, in four steps: first screen, a who-do-I-know search, a click on the first result, a pin on the most-connected person. Screenshots and numbers: `tests/report/before-*.png` and `tests/report/before-shots.json` (gitignored), made by `tests/shots.py before`.

Primary user and task: someone who has just opened their LinkedIn export and wants to know who they already know at a company or in a role (`research/findings.md`, job 1). The map is the way in, not the job.

Acceptance: the jobs in `docs/usability-test.md`, J1 to J5 plus T6 (who do I know at) and T7 (who did I meet at an event).

Constraints: plain script, no build step, sigma + graphology already vendored, runs from GitHub Pages, everything stays in the tab, keyboard and screen-reader access kept, synthetic data only in anything committed.

Evidence was collected by the orchestrator directly (whole viewer read, screenshots, in-page measurements) instead of by evidence subagents.
