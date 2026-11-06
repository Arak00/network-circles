# Fake-door test on the live demo

A cheap way to rank the jobs by what visitors actually click, before building any of them. Not yet live: changing the published site needs the author's go-ahead.

## What visitors see

A row of cards above the map, titled "What do you want to do with your network?". Each card names one job in the visitor's words. Clicking a card opens a small panel that says plainly that this isn't built yet, thanks them, and returns them to the map. No form and no email field: the only thing recorded is which card was clicked.

| Card | Job | Why it's there |
|------|-----|----------------|
| Who do I already know at a company, or in a role? | Job 1 in `findings.md` (warm introductions, own searchable network) | First focus; servable with a feature |
| Who did I meet at that event? | Job 4, event follow-up | Second focus, provisional; servable with a feature |
| Who have I lost touch with? | Keep in touch (dropped for now) | A probe: only a clear win here would justify discussing an opt-in read of messages |
| Who reads and reacts to my posts? | H6 creator audience (control) | Not servable. It measures how much people click on anything that sounds useful; a real job has to beat it clearly |

Card order is shuffled on every visit, and the position is recorded with the click, so the top card doesn't win by being first.

## Counting without tracking people

GoatCounter (goatcounter.com) counts page views and named events. Its documentation says "The IP address and User-Agent are never stored to the database or disk"; visits are told apart by an in-memory hash kept for 8 hours (https://www.goatcounter.com/help/sessions). Check its privacy page for cookies and terms before going live. It never sees the user's files: the cards are static HTML and don't touch the drop zone or the viewer.

- One script tag in `web/index.html`: `<script data-goatcounter="https://<site>.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>` (the `<site>` code is created by the author).
- On a card click: `window.goatcounter && goatcounter.count({ path: "fd/<job>/pos<n>", title: "<card text>", event: true })`.
- The page view of `/network-circles/web/` is the denominator.
- Add one sentence to the "How far to trust this" panel: the page counts visits and card clicks anonymously, and never sees your files.

## When to read the results

Run until the page has 400 visits or four weeks have passed, whichever comes first. Read nothing before that; early numbers swing a lot.

## What counts as a signal

For each card, click rate = its clicks / page visits, all positions combined.

- A job is a signal when it gets at least 15 clicks and its click rate is at least 3%, and at least twice the control card's rate.
- If no card clears that bar, the cards haven't found a job people want from this page. Then the interviews, not the cards, decide.
- Two jobs within a third of each other's rate count as a tie; let the interviews break it.
- If one position (say, first) collects more than half of all clicks, report rates by position as well; the shuffle should make this rare.

## Removing it

Take the cards and the script out once the test has run. Keep the counts in `research/fake-door-results.md` (totals only).
