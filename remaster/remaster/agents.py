"""REMaster agents.

Strategist  long horizon (quarter). Explicit mutable State Doc, weekly planning, market watch.
Doer        daily ops: reads standups + board + its memory, assigns work. Can query its past.
Cleaner     nightly *fork* of the Strategist (same prefix -> prompt-cache hit). Emits ops on the
            Doer's memory, then is discarded: the Strategist never sees it.
Shadows     read-only Doers over lagged views of the same memory. Divergence => lost context.
Judge       Liquid LFM (fallback: Doer model) classifying divergences as real vs noise.
Summarizer  naive baseline: generic rolling summary (the industry default).

Every agent has a deterministic mock policy so the whole pipeline runs without API keys.
"""
import json
import re

from . import world as W
from .llm import approx_tokens

# ----------------------------------------------------------------------------- prompts

STRATEGIST_SYSTEM = """You are the STRATEGIST of REMaster, an autonomous AI scrum master / operations manager.
You own the quarter: a 6-person startup must launch before Demo Day ({demo}, day {demo_day} of 60).
You think in weeks, not tickets. You keep an explicit, compact STATE DOC (goal, sprint plan, risks,
team model, decisions). You never micro-manage; a separate Doer runs the daily work.

Team:
{roster}

Launch requires: {required}.
Respond ONLY with JSON."""

STRATEGIST_WEEKLY = """It is Monday {ts} (day {day}). Doer's reports since last week:
{reports}

Board right now:
{board}

Update the plan. Return JSON:
{{"state_doc": {{"goal": str, "sprint_focus": str, "risks": [str], "team_model": [str], "decisions": [str]}},
  "week_focus": "one sentence for the Doer",
  "market_query": "optional web search query to watch competitors/dependencies, or empty",
  "board_ops": [{{"op": "cut", "ticket": "ID", "why": str}}],
  "briefing": {{"headline": str, "lines": [str, str, str]}}}}
Keep state_doc under 200 words. Only cut non-required tickets."""

CLEANER_TASK = """[NIGHT {ts}] You are a temporary copy of the Strategist. Your ONLY task tonight: curate the
Doer's working memory for the long term. You know where the quarter is going; use that.

Doer's visible memory (ids in brackets):
{memory}

Emit operations. Goals: keep the Doer's context lean (target <= {target} visible items) while never losing
anything the rest of the quarter needs. Durable facts about people (availability, skills, estimation
habits, constraints) should be PROMOTED to one-line team notes. Closed threads should be FOLDED into one line.
Stale routine updates should be ARCHIVED (still retrievable via SQL, but out of context).
Return JSON: {{"ops": [
  {{"op": "promote", "fact": "one line", "ids": [..], "why": str}},
  {{"op": "fold", "ids": [..], "into": "one line", "why": str}},
  {{"op": "archive", "ids": [..], "why": str}},
  {{"op": "keep", "ids": [..], "why": str}}]}}
Only use ids that appear above."""

DOER_SYSTEM = """You are the DOER of REMaster, an autonomous AI scrum master / operations manager running a
6-person startup day to day. Your job: keep everyone productive on the right work so the team launches
before Demo Day ({demo}). Match tickets to skills, anticipate availability, balance load, unblock.

Team:
{roster}

Rules:
- Assign only real ticket ids to real people. One person works on one ticket at a time; queue at most 2.
- Tickets marked blocked(not before ..) can be pre-assigned so the right person starts on time.
- A ticket can be re-assigned (progress carries over).
- Think about WHO will actually be available while the ticket is being worked on.
- Your memory is curated nightly; older items may be archived. You may query your full history with
  memory_sql ({sql_hint}).
Respond ONLY with JSON."""

DOER_DAY = """Strategist's focus this week: {focus}

{memory}

Today is {ts} (day {day}). Board:
{board}

{scratch}Decide today's assignment changes. Return JSON:
{{"memory_sql": ["SELECT ..."],            // optional: queries to run before deciding (max 2)
  "assignments": [{{"ticket": "ID", "person": "name", "reason": "short", "facts_used": ["E00012", ...]}}],
  "report": "one line for the Strategist"}}
If you include memory_sql, leave assignments empty; you'll get the results and decide in the next round.
facts_used = ids of memory items that influenced the decision."""

JUDGE_TASK = """Two copies of the same scrum-master agent decided who should do ticket {ticket}.
Copy A (curated memory) chose {pa}: "{ra}"
Copy B (more memory) chose {pb}: "{rb}"
Is this a REAL divergence caused by B knowing a relevant fact that A lacks, or NOISE (both reasonable,
no missing fact)? Return JSON {{"verdict": "real" | "noise", "why": "short"}}"""

SUMMARIZER_TASK = """Summarize the following project-management history concisely for future reference.
Previous summary:
{prev}

New items:
{items}

Return JSON {{"summary": "..."}} (max 150 words)."""


def _fmt_reports(reports):
    return "\n".join(f"- {r}" for r in reports[-10:]) or "- (none yet)"


# ----------------------------------------------------------------------------- strategist

class Strategist:
    def __init__(self, llm):
        self.llm = llm
        self.state_doc = {"goal": f"Launch before Demo Day {W.sim_ts(W.DEMO_DAY)}", "sprint_focus": "kickoff",
                          "risks": [], "team_model": [], "decisions": []}
        self.reports, self.week_focus = [], "Kick off: start foundations (auth, app shells, designs)."
        self.system = STRATEGIST_SYSTEM.format(demo=W.sim_ts(W.DEMO_DAY), demo_day=W.DEMO_DAY,
                                               roster=W.World().team_roster(),
                                               required=", ".join(W.LAUNCH_REQUIRED))

    def messages(self):
        """The Strategist's *current context*. The Cleaner forks exactly this prefix."""
        return [{"role": "system", "content": self.system},
                {"role": "user", "content": "STATE DOC:\n" + json.dumps(self.state_doc, indent=1)
                 + "\n\nWEEK FOCUS: " + self.week_focus}]

    def weekly(self, day, board, market_fn):
        ts = W.sim_ts(day)
        if self.llm is None:
            out = self._mock_weekly(day)
        else:
            out = self.llm.json(self.messages() + [{"role": "user", "content": STRATEGIST_WEEKLY.format(
                ts=ts, day=day, reports=_fmt_reports(self.reports), board=board)}], cache_key="strategist")
        self.state_doc = out.get("state_doc") or self.state_doc
        self.week_focus = out.get("week_focus") or self.week_focus
        market = None
        q = (out.get("market_query") or "").strip()
        if q:
            market = market_fn(day, q)
            if market:
                self.reports.append(f"{ts} market: {market[:200]}")
        return out, market

    def _mock_weekly(self, day):
        week = (day - 1) // 5 + 1
        return {"state_doc": self.state_doc, "week_focus": f"Week {week}: keep the critical path moving.",
                "market_query": "Product Hunt launch AI onboarding startup this week" if day == 21 else "",
                "board_ops": [], "briefing": {"headline": f"Week {week}", "lines": []}}


# ----------------------------------------------------------------------------- cleaner

class Cleaner:
    def __init__(self, llm, target_visible=30):
        self.llm, self.target = llm, target_visible

    def night(self, day, strategist, memory):
        visible, _, _, _ = memory.view(0)
        if not visible:
            return []
        lines = "\n".join(f"[{i} {memory.blocks[i]['sim_ts']} {memory.blocks[i]['kind']}"
                          f"{' ' + memory.blocks[i]['person'] if memory.blocks[i].get('person') else ''}] "
                          f"{memory.blocks[i]['text']}" for i in visible)
        if self.llm is None:
            return self._mock(day, memory, visible)
        # Fork: exact copy of the Strategist's context + one extra task. Discarded afterwards.
        msgs = strategist.messages() + [{"role": "user", "content": CLEANER_TASK.format(
            ts=W.sim_ts(day), memory=lines, target=self.target)}]
        out = self.llm.json(msgs, cache_key="strategist")
        valid = set(visible)
        ops = []
        for op in out.get("ops", []):
            op["ids"] = [i for i in op.get("ids", []) if i in valid]
            if op.get("op") in ("fold", "archive", "keep") and not op["ids"]:
                continue
            if op.get("op") in ("promote", "fold", "archive", "keep"):
                ops.append(op)
        return ops

    def _mock(self, day, memory, visible):
        """Generic policy: archive routine items older than 3 days (loses buried facts on purpose)."""
        old = [i for i in visible if memory.blocks[i]["day"] <= day - 3]
        return [{"op": "archive", "ids": old, "why": "routine update older than 3 days"}] if old else []


# ----------------------------------------------------------------------------- doer

class Doer:
    def __init__(self, llm, memory, store, name="doer1"):
        self.llm, self.memory, self.store, self.name = llm, memory, store, name
        self.system = DOER_SYSTEM.format(demo=W.sim_ts(W.DEMO_DAY), roster=W.World().team_roster(),
                                         sql_hint=store.sql_hint())

    def decide(self, day, world, focus, lag=0, agent=None, max_rounds=3):
        agent = agent or self.name
        mem_text, stats = self.memory.render(lag)
        scratch, queries_run = "", []
        for rnd in range(max_rounds):
            if self.llm is None:
                out = mock_doer(day, world, mem_text + "\n" + scratch)
            else:
                prompt = DOER_DAY.format(focus=focus, memory=mem_text, ts=W.sim_ts(day), day=day,
                                         board=world.board(day), scratch=scratch)
                if rnd == max_rounds - 1:
                    prompt += ("\n\nFINAL ROUND: no more memory_sql. Output your assignments "
                               "NOW. Anyone on a blocked ticket must be moved to a ready one.")
                out = self.llm.json([{"role": "system", "content": self.system},
                                     {"role": "user", "content": prompt}], temperature=0, cache_key=agent)
            qs = [q for q in (out.get("memory_sql") or []) if isinstance(q, str)][:2]
            if qs and rnd < max_rounds - 1:
                res = []
                for q in qs:
                    r = self.store.memory_sql(q)
                    queries_run.append({"sql": q, "rows": len(r.get("rows", [])), "error": r.get("error")})
                    res.append(f"SQL: {q}\nRESULT: {json.dumps(r, default=str)[:1500]}")
                scratch = "Results of your memory_sql queries:\n" + "\n\n".join(res) + "\n\n"
                continue
            break
        out.setdefault("assignments", [])
        out["_ctx"] = stats
        out["_queries"] = queries_run
        return out


def _availability_from_text(text):
    """Mock helper: parse 'off ... week N' style facts about people from visible memory."""
    off = {}
    for line in text.splitlines():
        m = re.search(r"standup (\w+)\][^\n]*off the whole of week (\d+)", line)
        if m:
            off.setdefault(m.group(1), set()).add(int(m.group(2)))
        m = re.search(r"- (\w+) (?:is )?off (?:in )?W(\d+)", line, re.I)
        if m:
            off.setdefault(m.group(1).lower(), set()).add(int(m.group(2)))
    ids = {}
    for line in text.splitlines():
        m = re.match(r"\[(E\d+) [^\]]*standup (\w+)\][^\n]*off the whole of week", line)
        if m:
            ids[m.group(2)] = m.group(1)
    return off, ids


def mock_doer(day, world, text):
    """Deterministic policy: best-skill free person; avoid people known to be off during the work."""
    off, fact_ids = _availability_from_text(text)
    load = {p: sum(1 for t in world.tickets.values() if t["assignee"] == p and t["done_day"] is None)
            for p in W.PEOPLE}
    out = []
    for t in world.tickets.values():
        if t["assignee"] or t["done_day"] or t["cut"]:
            continue
        soon = world.is_ready(t, day) or (day >= t["not_before"] - 2 and
                                          all(world.tickets[d]["done_day"] for d in t["deps"]))
        if not soon:
            continue
        start = max(day, t["not_before"])
        span_weeks = {(d - 1) // 5 + 1 for d in range(start, start + t["estimate"] + 2)}
        ranked = sorted(W.PEOPLE, key=lambda p: (-W.PEOPLE[p]["skills"].get(t["skill"], 0), load[p]))
        for p in ranked:
            if W.PEOPLE[p]["skills"].get(t["skill"], 0) < 0.5 or load[p] >= 2:
                continue
            if off.get(p, set()) & span_weeks:
                continue
            used = [fact_ids[q] for q in fact_ids if q in off and off[q] & span_weeks]
            out.append({"ticket": t["id"], "person": p, "reason": f"best available {t['skill']}",
                        "facts_used": used})
            load[p] += 1
            break
    return {"assignments": out, "report": f"{len(out)} assignments"}


# ----------------------------------------------------------------------------- judge

class Judge:
    def __init__(self, liquid, fallback):
        self.llm = liquid or fallback
        self.using = "liquid" if liquid else ("openai" if fallback else "rule")

    def classify(self, ticket, pa, ra, pb, rb):
        if self.llm is None:
            return {"verdict": "real" if pa != pb else "noise", "why": "mock rule"}
        try:
            return self.llm.json([{"role": "user", "content": JUDGE_TASK.format(
                ticket=ticket, pa=pa, ra=ra, pb=pb, rb=rb)}], temperature=0)
        except Exception as e:
            return {"verdict": "real", "why": f"judge error, defaulting to real: {e}"}


# ----------------------------------------------------------------------------- naive baseline

class Summarizer:
    def __init__(self, llm):
        self.llm = llm

    def compact(self, mem):
        items = mem.oldest_half()
        text = "\n".join(f"[{b['sim_ts']} {b['kind']} {b.get('person') or ''}] {b['text']}" for b in items)
        if self.llm is None:
            # generic lossy summary: keeps only who shipped what
            shipped = re.findall(r"shipped ([A-Z]\d(?:, [A-Z]\d)*)", text)
            s = (mem.summary + " Shipped: " + ", ".join(shipped)).strip()[:600]
        else:
            s = self.llm.json([{"role": "user", "content": SUMMARIZER_TASK.format(
                prev=mem.summary or "(none)", items=text)}]).get("summary", "")
        mem.apply_summary(s)
        return approx_tokens(s)
