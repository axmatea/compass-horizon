# REMaster — the AI scrum master that sleeps on it

> Every AI agent today gets amnesia after a few hours. REMaster ran a startup
> for a full quarter and never forgot who was getting married.

Built in one day at the **Long Horizon Agents Hackathon** (AWS Builder Loft, SF,
Sep 25 2026, hosted by tokens&).

**The claim: it tests its own forgetting — and recovers the exact fact when a
decision would change.**

## The problem

Long-horizon agents die one of two deaths: keep everything (context rot) or
summarize (a generic model guesses *today* what will matter *later*, drops the
wrong thing, **permanently**, and nobody checks). For a team manager the facts
that matter most are tiny and old: "Tom underestimates by 40%", "Sarah is off
in week 9 — wedding". A summary of week-2 standups drops exactly these, and
five weeks later the plan breaks.

## The memory loop

REMaster is an autonomous scrum master running a simulated 6-person startup
for a 60-day quarter. Its innovation is a nightly memory loop:

1. **☀️ Work** — the **Doer** runs daily ops (standups, assignments,
   unblocking) on a small working memory, with `memory_sql` over its entire
   past.
2. **🌙 Sleep** — a **disposable fork of the Strategist** reviews the day and
   curates the Doer's memory **by intent** (it knows the quarter plan):
   keep / fold / promote / archive. Then the fork is thrown away — the
   Strategist never gets polluted by janitor work.
3. **👥 Check** — **Shadow Doers** with lagged memory (1 day / 1 week / never
   cleaned) replay key decisions read-only. If the real Doer and a shadow
   differ, the cleanup lost something that changes decisions.
4. **♻️ Recover** — a judge separates noise from real divergence, bisects
   which archived fact was load-bearing, and restores the **exact fact** from
   the append-only log. Nothing is ever deleted — every "forget" is a pointer.

A naive-summarization baseline runs the same world for comparison.

## Sponsor tools (each with a real job)

| Sponsor | Job |
|---|---|
| **Liquid AI** (`lfm-2.5-2.6b` via OpenRouter) | Every brain: strategist, doer, cleaner, shadows, judge |
| **Tinybird Rawtree** | Append-only event log; `memory_sql` tool; live dashboard feed |
| **Nimble** | Live web digests → market signals that force replanning |
| **Black Forest Labs FLUX** | Monday video briefings for the team |

## Results (60-day quarter, real Liquid brain)

_See `runs/` for raw logs and per-run `result.json`._

- **REMaster**: working context stays flat (~hundreds of tokens) while
  archiving the bulk of its history; nightly cleaner does real intent
  curation; `memory_sql` used routinely; planted long-tail facts survive to
  the decisions that need them.
- **Naive baseline**: context blob grows to ~5,300 tokens / 325 uncurated
  items; the 2.6B model drowns — it made **one** valid staffing decision in
  60 days, finished 3 tickets, and missed Demo Day.

## Run it

```bash
python3.12 run.py --days 60 --mode remaster   # full quarter
python3.12 run.py --days 60 --mode naive      # baseline
python3.12 server.py                          # Memory X-ray dashboard :8765
```

Config via `.env`: `OPENROUTER_API_KEY`, `RAWTREE_TOKEN`, `NIMBLE_API_KEY`,
`BFL_API_KEY`. Degrades gracefully: with no keys it runs on a mock brain.

## Layout

```
remaster/          package: config, llm, memory, context, world, agents, sim
  sponsors/        nimble, flux, rawtree adapters
run.py             CLI
server.py          live dashboard (Memory X-ray)
dashboard.html     judge-facing view: context size, cleaner ops, divergences
architecture.html  the memory loop, one worked example (the wedding save)
```

## Prior art we build on

Scroll (context-as-environment, SQL over own history), VISTA (agents seeing
their own memory stats), Self-GC (curation as ops, not rewrites), Slipstream
(compaction validated against future behavior), Letta sleep-time agents
(closest prior art — but their curator is a generic separate agent; ours is a
disposable fork of the strategist that forgets *by intent*, validated by
lagged shadow replay, with reversible forgetting).
