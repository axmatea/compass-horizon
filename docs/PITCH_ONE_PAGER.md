# Longview: pitch one-pager

**The acquisition agent that waits for the truth.** NAYL (AI Media Global) and Vincent, Long Horizon Agents hackathon.

## Submission description (150 words)

Ad dashboards judge a campaign on day one, but when a purchase takes thought, the customer arrives on day thirty. Busy buyers answer late, so fast responders fill the early data and teach dashboards, and naive agents, the wrong lesson. Longview keeps every experiment open until lead quality actually arrives. It writes every event to a bitemporal, idempotent ledger, schedules its own follow-ups as commitments, and holds versioned beliefs that move only when an evidence gate allows. When late evidence lands, it changes its mind with a diff and records a lesson that tightens its own decision policy. Every wake-up is a crash-safe run of checkpointed steps with exactly-once effects, and a time machine shows what the agent knew on any day. Nimble supplies sourced market evidence, Liquid extracts reply fields with quotes, Tinybird serves as-of metrics. Rules, not the model, decide who qualifies. Early access: $299/month per business.

## What is real

- **Real:** the agent, the append-only Postgres ledger with on-conflict idempotency, commitments, belief versions and lessons, the crash (the process really exits mid-run), the resume with skipped duplicate effects, and the time machine replay.
- **Simulated, and labeled on screen:** the campaign data (DEMO DATA) and the clock (SIMULATED CLOCK). No real customer results are claimed.
- **Sponsor calls:** live only where the screen says LIVE. Without keys a sponsor shows BLOCKED and a labeled fallback runs (rules extractor, LOCAL metrics); nothing is faked.
