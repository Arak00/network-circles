# Usability test

A script for testing the viewer with five people, one at a time, about 30 minutes each. You run it; nothing here is automated.

## What the viewer has to do

These five questions are the acceptance criteria for the viewer. A tester who has never seen it should be able to answer each one without help.

| Job | Question | Where |
|-----|----------|-------|
| J1 | Which circles is my network made of, and how big is each? | Map, Circles list |
| J2 | Which circle is a given person in, and who else is in it? | Map, find box |
| J3 | When did my network grow, and which circle came from which period? | Timeline |
| J4 | Which organisations, skills, events and groups go with which circle? | Layers |
| J5 | What do two circles have in common? | Layers |

## Setup

Use the public demo (300 fictional people) for the timed tasks, so every task has one known answer and you can score it the same way for everyone. Serve the repo (`python3 -m http.server` from its folder) and open `web/`. The published page at `https://arak00.github.io/network-circles/` only has the current version once it has been pushed. Clear the site data first so the "How it works" dialog appears, as it would for a new user.

Use a laptop with a mouse. If you also want a phone result, run a sixth session on a phone and keep it separate.

Record the screen and the tester's voice if they agree. Ask them to think aloud. Don't help, hint or point. If someone is stuck for two minutes, mark the task as failed, show them the answer and move on. Questions like "is this right?" get "what do you think?".

## Tasks

Read each task aloud, start a timer, and stop it when the tester gives an answer. Score each one as success (right answer, no help), partial (right answer after a wrong one, or with the wrong reasoning) or fail (wrong, gave up, or past two minutes).

| Task | Job | Say to the tester | Right answer |
|------|-----|-------------------|--------------|
| T1 | J1 | "This is someone's LinkedIn network. Which is their biggest group of people, and about how many are in it?" | Cobblestone Cloudworks · data, 44. Saying "Unplaced, 59" is a fail: unplaced people are the ones in no circle, and the viewer should make that clear. |
| T2 | J2 | "Find Goran Valcourt. Which group is he in? Name two other people in the same group." | Ashgrove Mobility · eng, plus any two of its members (check by hovering them). |
| T3 | J3 | "In which month did this person add the most connections?" | September 2024 (24 people). August or October 2024 is a partial. |
| T4 | J4 | "Switch to the view that shows organisations. The people who work at Halcyon Freight: which group are they in?" | Halcyon Freight · ops. |
| T5 | J5 | "Find a skill that two different groups share, and name the skill and both groups." | Any skill drawn with links to two or more circles, for example Roadmapping. Verify by hovering the skill. |

Then ask, without timing: "What did you expect to happen that didn't?" and "What was the most confusing thing on the screen?". Write down their words.

## Their own export (optional, private)

If the tester has their own LinkedIn export, let them open it in the viewer for five minutes after the tasks and fill in `docs/tester-form.md`. Their files stay on their machine and you don't look at their screen during this part. Only the three scores and an optional comment without names come back to you.

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

## Recording results

One row per tester in `docs/usability-results.csv`, which stays out of the repo if it holds anything identifying. Use codes (P1 to P5), never names:

```
tester,T1,T1_s,T2,T2_s,T3,T3_s,T4,T4_s,T5,T5_s,sus1,sus2,sus3,sus4,sus5,sus6,sus7,sus8,sus9,sus10,notes
P1,success,35,partial,80,success,20,fail,120,success,60,4,2,4,1,4,2,4,2,4,2,"looked for the timeline under the map first"
```

Outcomes are `success`, `partial` or `fail`; `_s` columns are seconds.
