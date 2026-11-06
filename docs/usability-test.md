# Usability test

A script for testing the viewer with five people, one at a time, about 30 minutes each. You run it; nothing here is automated.

## What the viewer has to do

These five questions are the acceptance criteria for the viewer. A tester who has never seen it should be able to answer each one without help.

| Job | Question | Where |
|-----|----------|-------|
| J1 | Which circles is my network made of, and how big is each? | Your circles (list or cards), map |
| J2 | Which circle is a given person in, and who else is in it? | Search box, a result's detail |
| J3 | When did my network grow, and which circle came from which period? | Timeline card |
| J4 | Which organisations, skills, events and groups go with which circle? | Layers |
| J5 | What do two circles have in common? | Layers |

## Setup

Use the public demo (300 fictional people) for the timed tasks, so every task has one known answer and you can score it the same way for everyone. Serve the repo (`python3 -m http.server` from its folder) and open `web/?view=list`, `web/?view=map` or `web/?view=circles` (see "Comparing the three layouts" below). The published page at `https://arak00.github.io/network-circles/` only has the current version once it has been pushed. Clear the site data first, as a new user would have it. Nothing opens on top of the page any more; "How it works" is a link in the header.

Use a laptop with a mouse. If you also want a phone result, run a sixth session on a phone and keep it separate.

Record the screen and the tester's voice if they agree. Ask them to think aloud. Don't help, hint or point. If someone is stuck for two minutes, mark the task as failed, show them the answer and move on. Questions like "is this right?" get "what do you think?".

## Tasks

Read each task aloud, start a timer, and stop it when the tester gives an answer. Score each one as success (right answer, no help), partial (right answer after a wrong one, or with the wrong reasoning) or fail (wrong, gave up, or past two minutes).

| Task | Job | Say to the tester | Right answer |
|------|-----|-------------------|--------------|
| T1 | J1 | "This is someone's LinkedIn network. Which is their biggest group of people, and about how many are in it?" | Cobblestone Cloudworks · data, 44. Saying "Not in a circle, 59" is a fail: those are the people in no circle, and the viewer should make that clear. |
| T2 | J2 | "Find Goran Valcourt. Which group is this person in? Name two other people in the same group." | Ashgrove Mobility · eng, plus any two of its members (check by hovering them). |
| T3 | J3 | "In which month did this person add the most connections?" | September 2024 (24 people). August or October 2024 is a partial. The timeline card now states the busiest month in words, so this should be fast; note whether the tester reads it or uses the bars. |
| T4 | J4 | "Switch to the view that shows organisations. The people who work at Halcyon Freight: which group are they in?" | Halcyon Freight · ops. Typing "Halcyon Freight" in the search box also answers it (17 people, all in that circle); record which route the tester takes. |
| T5 | J5 | "Find a skill that two different groups share, and name the skill and both groups." | Any skill drawn with links to two or more circles, for example Roadmapping. Verify by hovering the skill. |
| T6 | Who do I know at a company (`research/findings.md`, job 1) | "A friend asks whether this person knows anyone at Kestrel Talent. How many people do they know there, and which group are those people in?" | 2 people, both in Glimmer Networks · eng. The search box at the top answers it directly; record what the tester tries first. |
| T7 | Who did I meet at an event (job 4, provisional) | "This person went to Lakemoor Data Meetup #4. Who did they connect with in the week after it? How many, and which group are most of them in?" | 7 people, connected 8 to 15 November 2023; 5 of them in Cobblestone Cloudworks · data. Route: search "Lakemoor", click the #4 event, then "List the people linked to it". |

Then ask, without timing: "What did you expect to happen that didn't?" and "What was the most confusing thing on the screen?". Write down their words.

## Comparing the three layouts

The viewer has three layouts of the same parts: List (search and results first, map beside them), Map (search in a rail, map large) and Circles (search on top, circles as cards, no map). Testers can switch between them with the buttons at the top, and the link decides where they start.

Rotate the starting layout: P1 list, P2 map, P3 circles, P4 list, P5 map, and so on, and write it in the `view` column. Note whether and when the tester switches. With five testers that is one or two people per layout, so it can only show a layout that clearly fails (both of its testers stuck on the same task), not which one is better. For a real comparison, either run each tester on two layouts with different tasks, or count online with the anonymous counter in `research/fake-door.md`; the viewer sends every layout switch, search, pin and CSV download through one empty `track()` function in `web/app.js` for that purpose. Turning that counter on is a privacy decision: it adds a request to a third party, though it never sees the files.

## Their own export (optional, private)

If the tester has their own LinkedIn export, let them open it in the viewer for five minutes after the tasks. Give them the one task that matches why they were recruited (`research/screener.md`), and only ask whether they managed it; don't look at the answer:

- Job search, fundraising or selling: "Find someone you already know at a company you'd like an introduction to."
- After an event: "Find the people you connected with after the last event you went to."

Then they fill in `docs/tester-form.md`. Their files stay on their machine and you don't look at their screen during this part. Only the three scores and an optional comment without names come back to you.

## SUS questionnaire

Hand this over at the end, on paper or in a form. The wording is the standard System Usability Scale (Brooke, 1996); keep it as is so scores compare with other products. Each item is answered 1 (strongly disagree) to 5 (strongly agree).

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

Scoring: for odd items take the answer minus 1, for even items take 5 minus the answer, add the ten numbers and multiply by 2.5. The result runs from 0 to 100. Across many studies the average is about 68.

## What counts as passing

The viewer passes a job when at least four of the five testers succeed on its task without help. It passes overall when every job passes and the mean SUS score is 68 or higher. With five people these are rough signals rather than statistics: a task that two people fail points to a real problem, and the think-aloud notes say what it is.

T6 and T7 are not part of the pass rule. They test the two jobs chosen in `research/findings.md`, one of which (event follow-up) the viewer only half supports today; report their results next to the fake-door counts, as evidence for what to build next. `own_task` is yes or no for the task on the tester's own export.

## Recording results

One row per tester in `docs/usability-results.csv`, which stays out of the repo if it holds anything identifying. Use codes (P1 to P5), never names:

```
tester,view,T1,T1_s,T2,T2_s,T3,T3_s,T4,T4_s,T5,T5_s,T6,T6_s,T7,T7_s,own_task,sus1,sus2,sus3,sus4,sus5,sus6,sus7,sus8,sus9,sus10,notes
P1,list,success,35,partial,80,success,20,fail,120,success,60,partial,95,success,50,yes,4,2,4,1,4,2,4,2,4,2,"looked for the timeline under the map first"
```

Outcomes are `success`, `partial` or `fail`; `_s` columns are seconds.
