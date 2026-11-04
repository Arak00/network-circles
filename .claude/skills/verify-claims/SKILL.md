---
name: verify-claims
description: Check every factual claim in the write-up, README or LinkedIn post against the pipeline's actual results before it is published. Use when asked to verify, fact-check, or sanity-check a write-up, post or results summary.
---

# Verify claims

Run on a draft write-up (docs/writeup.md), the README, or the LinkedIn post.
Memory files, HANDOFF notes, earlier agent summaries and earlier turns in this
conversation are NOT evidence. A reviewer saying "confirmed" is a lead, not proof.

## 1. Extract the claims

List every verifiable assertion: a metric value (ARI, modularity, precision,
recall, agreement), a sample size, a dataset property, what the code does
(e.g. "runs entirely in the browser", "no data leaves the device"), what the
demo contains (e.g. "synthetic data only"). Skip opinions.

For each, write down what would settle it: a key in results/*.json, a
file:line in src/ or web/, a test or command whose output proves it.

## 2. Check

- **Number claims**: read the value from results/*.json produced by the latest
  run. Check its timestamp/seed matches the run the write-up describes. Rounding
  must match; "about" is fine only if the number really is close.
- **Sample-size claims**: count the rows in the input (labels file, pairs file,
  benchmark) rather than trusting the prose.
- **Code/privacy claims**: read the source. "Runs locally" means no fetch/XHR/
  beacon to a non-local origin in web/; grep for it.
- **Demo claims**: the demo's data file must come from the synthetic generator;
  grep it for any name from data/Connections.csv (never print the matches).

Output a table and nothing else: `claim | VERIFIED | STALE | UNVERIFIABLE | evidence`.
Evidence is a file:line, a JSON key path, or a command. If no evidence turns
up, the claim is UNVERIFIABLE. Don't reason your way to a plausible answer.

## 3. Reconcile

Show the table before editing the draft.

- VERIFIED: state plainly.
- STALE: correct it to match the results and cite the evidence.
- UNVERIFIABLE: cut it, or mark it UNVERIFIED. Never smooth it into confident prose.
- Any claim resting on a sample under ~30 gets its n stated next to it.

Wait for the user's nod on the table before touching the draft.
