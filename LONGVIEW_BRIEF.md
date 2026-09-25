# LONGVIEW: product brief (single source of truth for all agents)

## 1. One line
**Longview is the acquisition agent that waits for the truth.** Ads are judged on day one; customers show up on day thirty. Longview keeps every experiment open until lead quality actually arrives, remembers what it believed and why, changes its mind with receipts when late evidence lands, and tightens its own decision rules when it learns it was fooled.

Built for the "Long Horizon Agents" hackathon (sponsors: Nimble, Liquid AI, Tinybird). First customer is ourselves: AI Media Global, which sells AI implementation to service businesses.

## 2. Non-negotiables
- Honesty: synthetic data and the simulated clock are always labeled on screen ("DEMO DATA", "SIMULATED CLOCK"). Sponsor status shows LIVE only after a real successful call. Missing credentials show BLOCKED, never a hidden fake. Fixtures show FIXTURE.
- Unknown stays unknown: a missing budget is null and rendered "Unknown", never $0. Leads without attribution go to an UNKNOWN bucket, never guessed into A or B.
- No winner on thin samples: the belief gate decides (INSUFFICIENT / LEANING / SUPPORTED). No guarantees in copy: we talk about target outcomes and evidence, never promises.
- No outbound actions: Longview drafts questions and follow-ups; it never sends email, never buys ads, never touches Meta. Secrets stay server-side. Receipts never contain tokens or PII.
- Copy rule: never use the em dash character anywhere (copy, code comments, docs). Use commas, colons, periods, parentheses.
- Do not touch anything outside /Users/axmatea/Projects/longview* . Never read, write or deploy the COMPASS repo (~/Projects/compass-acquisition) or its Railway/Tinybird resources.

## 3. The long-horizon primitives (what judges must see)
1. **Ledger**: append-only, bitemporal memory. Every event has `occurredAt` (when it happened) and `learnedAt` (when Longview learned it). Idempotent by event id: replaying a webhook changes nothing. Late events restate the past correctly (a field value with an older occurredAt never overrides a newer one).
2. **Commitments**: the agent schedules its own future work (ask the missing budget question in 2 days, check outcome on day 14, re-scan the market on day 14) and wakes up to keep those promises. Commitments are cancelled when the answer arrives first.
3. **Beliefs**: every conclusion is a versioned belief with status, probability, evidence links and a diff against the previous version. Lessons: when the agent discovers its own early read was biased, it records a lesson and raises its decision policy version.
4. **Crash-safe runs**: every wake-up is a run of checkpointed steps. Effects use deterministic keys so a replayed run never performs an effect twice. "Pull the plug" really kills the serverless process (process.exit on Vercel) mid-run; the next wake resumes from the last checkpoint.
5. **Time machine**: scrub the horizon to any day and the whole product shows the world exactly as the agent knew it then (filter the ledger by learnedDay <= asOf, re-project).

## 4. The story the demo tells (DEMO scenario "ai-media-q4")
Insight: **busy buyers answer late.** Cheap, fast responders make the early data lie. A dashboard (and a naive agent) learns the wrong lesson on day 3.

Campaigns (both $150/day simulated spend, 14-day test window, outcomes tracked to day 30):
- **A "Free AI Audit"**: broad audience, small business owners. Cheap leads, fast replies, mostly no budget or not the decision maker.
- **B "Close-the-books Autopilot"**: CPA firm partners, 5 to 50 staff. Expensive leads, slow replies (busy season), real budgets ($15k to $30k), decision makers.
- One organic lead with no UTM: UNKNOWN attribution (qualifies, but is never credited to A or B).

Numbers are computed by the engine from scenario events, never hardcoded in UI. Target shape: CPL(A) is always lower than CPL(B) (A "wins" the dashboard every day), cost per qualified lead flips in B's favor around day 6 to 9, pipeline and won revenue strongly favor B by day 21.

Stage beats (Next beat button; each beat advances the simulated clock and runs one agent wake):
0. **Day 0 Launch**: two campaigns with creatives, qualification rules v1, decision policy v1, market scan per hypothesis (Nimble; BLOCKED if no key). Belief v1: INSUFFICIENT.
1. **Day 3 The dashboard says A**: A has ~12 leads at ~$50 CPL, B has 3 at ~$200. Two fast A leads confirm budget. Agent records belief LEANING A (thin evidence, policy v1 allows leaning at 1 resolved lead per arm) and schedules ASK_MISSING commitments for every unresolved lead.
2. **Day 6 Busy buyers answer**: B partners reply with budgets and timelines (Liquid extraction with quotes); one reply arrives twice from the webhook and is ignored as duplicate. Several A follow-ups reveal no budget. Belief: INSUFFICIENT (mixed).
3. **Day 9 The agent changes its mind**: belief LEANING B, REVISED from LEANING A, with a diff. Lesson recorded: "My day 3 read favored fast responders. Policy v2: require at least 3 resolved leads per arm before leaning." Policy version rises.
4. **Day 11 Late truth**: a CRM sync delivers two calls booked that occurred on day 5 and day 7 (learnedDay 11). Timeline draws arcs from occurred to learned. Belief SUPPORTED B.
5. **Day 14 Pull the plug**: the day 14 wake has due commitments (market re-scan, outcome checks, follow-up drafts). Presenter arms chaos, the process dies after step 3, the run shows INTERRUPTED; next press resumes from step 4, effects already performed show SKIPPED_DUPLICATE.
6. **Day 21 Outcome**: B wins an $18,000 deal, A's only call ghosts. Belief SUPPORTED B with recommendation and next test (B offer for an adjacent segment surfaced by the market scan). Counterfactual line: what scaling A on day 3 would have bought.
7. **Time machine**: drag back to day 3, show belief v1 and its evidence, drag forward to day 21. End.

## 5. Engine (pure, deterministic TypeScript, runs identically in tests, server and browser)
- Ledger event: `{ id, workspaceId, type, occurredAt, learnedAt, source, mode, payload }`. Types: campaign.launched, spend.recorded, lead.captured, lead.replied, lead.fields.extracted, lead.qualified, outcome.recorded, market.scanned, rules.versioned, policy.versioned, lesson.recorded, commitment.created, commitment.kept, commitment.cancelled, effect.performed, belief.recorded, run.started, run.step, run.resumed, run.completed, receipt, webhook.duplicate_ignored, chaos.armed, chaos.fired.
- `project(events, asOfDay?) => WorldView` (see src/contract.ts). Pure. Field merge by occurredAt. Curves: for each day d in 0..asOf, metrics as known on day d.
- Qualification is rules, not model: QUALIFIED if budget >= minBudget, timeline <= maxTimeline, decisionMaker true (if required). NOT_A_FIT if any known field fails. UNRESOLVED if something is unknown. `missing` lists unknown fields; `nextQuestion` is a drafted question for the first missing field.
- Belief gate: Beta(1+q, 1+r-q) posterior per arm on qualified rate among resolved leads, cost adjusted by CPL; P(arm X yields more qualified per dollar) by seeded Monte Carlo (deterministic seed from inputs). Policy v1: lean if each arm has >= 1 resolved and P >= 0.75; support if each arm >= 5 resolved and P >= 0.9. Policy v2 raises lean minimum to 3. Record a new belief version only when status or favored arm changes, or when day 21 outcomes land.
- Runs: steps 1 ingest (materialize scenario events due by now, idempotent ids), 2 extract (Liquid or rules fallback), 3 qualify, 4 commitments (create, keep, cancel; drafts are effects), 5 metrics (+ Tinybird mirror), 6 decide (belief, lesson, policy), 7 market (Nimble when a scan is due). Each step appends `run.step` with id `${runId}:step:${n}`. Effects use id = effect key. Resume = find the latest run.started without run.completed, continue after its last step, report skipped steps and skipped duplicate effects.

## 6. Storage and API
- Neon Postgres (DATABASE_URL already in .env.local and on Vercel). One table `ledger (workspace_id, id, seq bigserial, type, occurred_at, learned_at, wall_at default now(), source, mode, payload jsonb, primary key(workspace_id, id))`, `insert ... on conflict do nothing` is the idempotency. Tables `workspaces` and `early_access`. Additive `create table if not exists` migrations on first use.
- Workspace from httpOnly cookie `lv_ws` (random uuid, created on first visit, DEMO scenario seeded). Server never trusts a client-sent workspace id. `/demo?stage=<STAGE_KEY>` switches the cookie to the fixed stage workspace.
- Endpoints exactly as listed at the bottom of src/contract.ts. Node runtime, `dynamic = 'force-dynamic'`.

## 7. Sponsors (real adapters, honest status)
- **Nimble** (market evidence): search the public web for competitor offers per hypothesis; store title, url, fetchedAt, one extracted fact. Env NIMBLE_API_KEY. Docs: /Users/axmatea/.claude/plugins/synced/dd28f164-7e76-4355-9515-5a39cc75dfad_60fb20b2-b406-4303-8f68-58284f28ccea/nimble~g3/ (AUTH.md, skills). No personal contact scraping.
- **Liquid AI** (cheap cognition on every event): extract {budgetUsd, timelineDays, decisionMaker, problem} with quotes from each reply, JSON validated by zod. OpenAI-compatible chat completions. Env LIQUID_API_KEY, LIQUID_BASE_URL, LIQUID_MODEL (or OPENROUTER_API_KEY with a liquid/* model). Without keys: deterministic rules extractor labeled "rules fallback". Cost meter sums real per-call cost only.
- **Tinybird** (as-of metrics): mirror ledger events via Events API (`/v0/events?name=longview_events`, NDJSON), query experiment metrics as of a day with dedupe by id. Env TINYBIRD_TOKEN, TINYBIRD_HOST. Ship `tinybird/` datasource and pipe files for setup. Without keys: metrics computed from Postgres, labeled LOCAL, provider BLOCKED.

## 8. Visual system
Black, gold, cream (tokens in src/styles/tokens.css). Georgia for headlines and big editorial numbers, Helvetica for UI, tabular numerals for data. Premium, calm, spacious, desktop-first for the stage (1440 and 1920), fully usable at 390. The signature element is **the Horizon**: a thin gold line from Day 0 to Day 30 carrying the ledger as dots on lanes (A, B, Unknown, Agent), late events drawn as arcs from occurred to learned, and the time machine handle riding on it. Motion explains change (new dots rise onto the horizon, the belief card flips and highlights the diff), respects prefers-reduced-motion, never blocks input. No stock imagery, no mascots, no gradients-as-decoration, no emoji.

## 9. Routes
- `/` landing: hero, the insight, four primitives, how it works, sponsors with live status, what is real vs simulated, early access ($299/month per business, ad spend separate, no automatic billing yet), CTA to /demo and /deck.
- `/demo` the product on the DEMO scenario with the stage bar (Next beat, Pull the plug, Replay webhook, Reset) and the time machine.
- `/deck` presentation (keyboard arrows, N toggles speaker notes, F fullscreen). `/script` printable 3 minute script with click cues.

## 10. Ownership (parallel worktrees, merged by the orchestrator)
- ENGINE agent: src/engine/**, src/server/**, src/app/api/**, tinybird/**, tests, package.json and lockfile (only this agent adds dependencies).
- UI agent: src/app/page.tsx, src/app/demo/**, src/app/layout.tsx, src/app/globals.css, src/components/**, src/lib/client/**, public/brand/**. No new dependencies.
- DECK agent: src/app/deck/**, src/app/script/**, docs/SCRIPT.md, docs/PLAN.md, public/deck/**. No new dependencies.
- Nobody edits src/contract.ts or src/styles/tokens.css (ask the orchestrator in your final report). Nobody commits to main, nobody deploys: commit on your own branch only, the orchestrator merges and deploys.
