# Longview: 3:00 stage script

Generated from `src/app/deck/content.ts`, the same data behind the `/deck` speaker notes (press N) and the printable `/script` page. Edit the data, not this file, then regenerate with `node --no-warnings _tools/gen-script.mjs`.

- Speakers: **NAYL** opens and closes, **VINCENT** drives the live demo.
- Length: 383 spoken words (NAYL 187, VINCENT 196), about 2:56 at 155 words per minute including click time. Target 3:00.
- Lines in [brackets] are clicks or actions, not words. Demo cues match the /demo stage bar: Next beat, Pull the plug, Resume, Replay webhook, and the time machine handle.
- Honesty: the campaign data and the clock are simulated; the agent, the ledger, the crash and the resume are real; sponsor calls are live only where the screen says LIVE. Said once, on slide 6.

## Before going on

- Tab 1: /deck on slide 1. Use the browser full screen (Ctrl+Cmd+F on a Mac) so switching tabs keeps it.
- Tab 2: /demo (the stage link if the team set one). Press Reset. Confirm Day 0, the Next beat button, and the DEMO DATA and SIMULATED CLOCK labels.
- Offline backup: /deck/longview-deck.pdf saved on the desktop.
- Rehearse with N (speaker notes) on; press N again to hide them before going live.

## Script

### Slide 1: Longview

| Time | Who | Line |
| --- | --- | --- |
| 0:00 | NAYL | [Deck open on slide 1, full screen. Start on silence.] |
| 0:00 | NAYL | I'm NAYL, from AI Media Global, and this is Vincent. We built Longview: the acquisition agent that waits for the truth. |

### Slide 2: Judged on day one

| Time | Who | Line |
| --- | --- | --- |
| 0:08 | NAYL | [Click] |
| 0:09 | NAYL | Ads are judged on day one. When a purchase takes thought, the customer arrives on day thirty. By then, the budget has moved. |

### Slide 3: Busy buyers answer late

| Time | Who | Line |
| --- | --- | --- |
| 0:18 | NAYL | [Click] |
| 0:19 | NAYL | Why? Busy buyers answer late. Fast responders fill the early data, so dashboards, and naive agents, learn the wrong lesson. |

### Slide 4: What Longview does

| Time | Who | Line |
| --- | --- | --- |
| 0:27 | NAYL | [Click] |
| 0:28 | NAYL | Longview keeps every experiment open until the truth arrives. It remembers what it believed and why, changes its mind with receipts, and corrects its own rules. |

### Slide 5: Four primitives

| Time | Who | Line |
| --- | --- | --- |
| 0:38 | NAYL | [Click] |
| 0:39 | NAYL | Four primitives make that work: a bitemporal ledger, commitments across time, versioned beliefs, and crash-safe runs. Plus a time machine. Vincent. |

### Slide 6: Live demo (then the live demo)

| Time | Who | Line |
| --- | --- | --- |
| 0:47 | VINCENT | [Click, then switch to the /demo tab (or click the /demo link)] |
| 0:49 | VINCENT | One honest note. The campaign data and the clock are simulated. The agent, the ledger, the crash and the resume are real. Sponsor calls are live only where the screen says LIVE. |
| 1:01 | VINCENT | [Next beat (Day 0)] |
| 1:03 | VINCENT | Day zero. Two campaigns, same spend. A: a free AI audit for any small business. B: close-the-books autopilot for CPA partners. |
| 1:11 | VINCENT | [Next beat (Day 3)] |
| 1:12 | VINCENT | Day three. A: about a dozen leads near fifty dollars. B: three, near two hundred. A dashboard says scale A. Longview only leans A, and schedules questions for missing budgets. |
| 1:24 | VINCENT | [Next beat (Day 6)] |
| 1:26 | VINCENT | Day six. The busy partners answer, with real budgets. Liquid extracts each field with its quote. |
| 1:32 | VINCENT | [Replay webhook] |
| 1:33 | VINCENT | Same webhook again: ignored. Nothing changes. |
| 1:36 | VINCENT | [Next beat (Day 9)] |
| 1:37 | VINCENT | Day nine. It changes its mind: leaning B, with a diff. And a lesson: my day three read favored fast responders. Policy version two. |
| 1:46 | VINCENT | [Next beat (Day 11)] |
| 1:48 | VINCENT | Day eleven. The CRM reports two calls from days five and seven. Late truth restates the past. Supported B. |
| 1:55 | VINCENT | [Pull the plug, then Next beat (Day 14)] |
| 1:58 | VINCENT | Day fourteen. I pulled the plug: the run died after step three. |
| 2:02 | VINCENT | [Resume] |
| 2:04 | VINCENT | It resumes at step four. Effects already done are skipped, not repeated. |
| 2:09 | VINCENT | [Next beat (Day 21)] |
| 2:10 | VINCENT | Day twenty-one. B wins an eighteen thousand dollar deal. A's only call ghosts. |
| 2:15 | VINCENT | [Drag the time machine to Day 3] |
| 2:17 | VINCENT | And the time machine: exactly what it knew on day three. |
| 2:21 | VINCENT | [Drag back to Day 21. Switch to the deck tab and hand over] |

### Slide 7: How it runs

| Time | Who | Line |
| --- | --- | --- |
| 2:23 | NAYL | [Click to slide 7] |
| 2:24 | NAYL | Underneath: one append-only Postgres ledger. Nimble brings sourced market evidence, Liquid reads every reply, Tinybird serves metrics as of any day. Rules, not the model, decide who qualifies. |

### Slide 8: What we proved

| Time | Who | Line |
| --- | --- | --- |
| 2:35 | NAYL | [Click] |
| 2:36 | NAYL | Every property you just saw is covered by a test. |

### Slide 9: Business

| Time | Who | Line |
| --- | --- | --- |
| 2:40 | NAYL | [Click] |
| 2:41 | NAYL | We run it on our own pipeline first. Early access: 299 dollars a month per business, ad spend separate. It never buys ads or sends messages. |

### Slide 10: Close

| Time | Who | Line |
| --- | --- | --- |
| 2:51 | NAYL | [Click] |
| 2:52 | NAYL | Your dashboard remembers the click. Longview remembers what happened next. Thank you. |

End at about 2:56. Stay on slide 10 for questions.

## If the network fails (about 20 seconds)

- When: The demo does not load within 5 seconds, or a click hangs.
- Do: [Stay on slide 6 and point along the horizon, left to right.]
- VINCENT says:

> The network is down, so here is the run. Day three: the dashboard says A. Day six: busy buyers answer. Day nine: Longview changes its mind, with a lesson. Day eleven: late calls restate the past. Day fourteen: we kill the run, and it resumes without repeats. Day twenty-one: B wins.

Then NAYL continues from slide 7 as written. The offline deck is `public/deck/longview-deck.pdf`.

## Judge Q&A

**1. Why not just use a CRM?**

A CRM keeps the latest value of each field. Longview keeps when each fact happened and when we learned it, so it can show what it believed on any day and why it changed. It sits between the ads and the CRM, reads both, and writes decisions with evidence. You keep your CRM.

**2. How does it know it was wrong?**

Every belief is versioned with its evidence and the policy that produced it. When later evidence flips the favored campaign, it diffs the new belief against the old one, sees that the early read rested on fast responders, records a lesson, and raises the policy version. In the demo that means three resolved leads per campaign before it will lean.

**3. What does exactly-once mean here?**

Delivery can repeat; effects happen once. Every effect, like a drafted follow-up, has a deterministic key written to the ledger with insert on conflict do nothing. A replayed webhook or a resumed run finds the key and skips the effect. You saw that as SKIPPED_DUPLICATE after the crash.

**4. Why Liquid?**

Every reply needs a small extraction: budget, timeline, decision maker, each with its quote. That runs on every event, so it has to be cheap and fast, which is what small Liquid models are for. The output is schema validated, and rules, not the model, make the qualification call. Without a key it falls back to a rules extractor, labeled as such.

**5. Why Tinybird?**

Decisions need metrics as of a given day, with duplicates removed, while events keep streaming in. Tinybird takes the event stream and answers as-of queries with dedupe by id. Without a key we compute the same metrics from Postgres and label them LOCAL.

**6. What changes with real ad data?**

Only the ingest step. Spend, leads and replies arrive through the same events endpoint, from ad reporting and CRM webhooks, instead of the scenario, and the clock becomes the real clock. The ledger, beliefs, commitments and runs stay the same, and it still never changes a campaign. We start on our own pipeline.

**7. What about privacy?**

Secrets stay on the server. Receipts never contain tokens or personal data. Longview never sends messages and never touches the ad account. Nimble is used for public market evidence only, never for scraping personal contacts. The demo data is synthetic.

**8. What does it cost?**

Early access is 299 dollars a month per business, ad spend separate. No automatic billing yet. We run it on our own pipeline first, then with service businesses whose buyers take their time.

## Speaker notes beyond the 3:00 run

- Slide 1 (Longview): Built for the Long Horizon Agents hackathon with Nimble, Liquid AI and Tinybird.
- Slide 2 (Judged on day one): CPL is what an ad dashboard shows. Cost per qualified lead and revenue arrive weeks later.
- Slide 3 (Busy buyers answer late): The curves are an illustration of the demo scenario, not customer data.
- Slide 5 (Four primitives): Ledger: every event has occurredAt and learnedAt. Idempotent by event id. Commitments are cancelled when the answer arrives first. Beliefs only change version when status or favored arm changes.
- Slide 6 (Live demo): If the network fails, use the 20 second fallback on /script while this slide stays up. If Liquid shows BLOCKED or rules fallback on stage, say: 'The extractor pulls each field with its quote.' If a beat is slow, keep talking about what the agent is doing; the run finishes in the background.
- Slide 7 (How it runs): Idempotency is the primary key: insert on conflict do nothing. Each step appends run.step with a deterministic id, so a resumed run skips finished steps. Without keys each sponsor shows BLOCKED and a labeled fallback runs instead.
- Slide 8 (What we proved): The engine is pure and deterministic, so the same tests run in the server and the browser.
- Slide 9 (Business): First customers: AI implementation firms, agencies, B2B services. No automatic billing yet.
