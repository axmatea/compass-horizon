"""Runs a simulated quarter.

mode="remaster": Strategist + Doer + nightly Cleaner fork + tiered Shadows + Judge + restore.
mode="naive":    same Doer, industry-default rolling summarization, no archive access.
"""
import json
import threading
import time
from pathlib import Path

from . import config, world as W
from .agents import Cleaner, Doer, Judge, Strategist, Summarizer
from .context import DoerMemory, NaiveMemory
from .llm import LLMError, doer_client, liquid_client, strategist_client
from .memory import EventStore
from .sponsors import flux, nimble

FULL = 10 ** 6
SHADOW_TIERS = [("shadow_1d", 1), ("shadow_1w", 5), ("oracle", FULL)]


def launch_protected():
    """Launch-required tickets plus every transitive dependency: not cuttable."""
    prot, todo = set(), list(W.LAUNCH_REQUIRED)
    while todo:
        tid = todo.pop()
        if tid in prot:
            continue
        prot.add(tid)
        todo.extend(W.BACKLOG[tid][3])
    return prot


class Run:
    def __init__(self, mode="remaster", days=W.DAYS, run_id=None, out_dir="runs", flux_weeks=(),
                 verbose=True):
        self.mode, self.days, self.verbose = mode, days, verbose
        self.run_id = run_id or f"{mode}-{time.strftime('%H%M%S')}"
        self.dir = Path(out_dir) / self.run_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.store = EventStore(str(self.dir / "events.db"), self.run_id)
        self.world = W.World()
        mock = config.mock_llm()
        self.strat_llm = None if mock else strategist_client()
        self.doer_llm = None if mock else doer_client()
        self.liquid = None if mock else (liquid_client() or self.doer_llm)
        self.strategist = Strategist(self.strat_llm)
        self.memory = DoerMemory() if mode == "remaster" else NaiveMemory()
        self.doer = Doer(self.doer_llm, self.memory, self.store)
        if mode == "naive":
            self.doer.system = self.doer.system.replace("You may query your full history with\n  memory_sql",
                                                        "Older history is summarized; there is no archive. (ignore memory_sql")
        self.cleaner = Cleaner(self.strat_llm)
        self.judge = Judge(self.liquid, self.doer_llm)
        self.summarizer = Summarizer(self.doer_llm)
        self.flux_weeks, self.flux_threads = set(flux_weeks), []
        self.timeline = open(self.dir / "timeline.jsonl", "w")
        self.metrics = {"divergences": 0, "real_divergences": 0, "restores": 0, "confirmed_restores": 0,
                        "cleaner_ops": {}, "memory_sql_calls": 0, "compactions": 0}

    # ------------------------------------------------------------------ helpers
    def say(self, msg):
        if self.verbose:
            print(msg, flush=True)

    def log(self, agent, kind, day, text="", person=None, **data):
        return self.store.log(agent, kind, day, W.sim_ts(day), text, person, **data)

    def add_block(self, eid, day, kind, text, person=None):
        self.memory.add({"id": eid, "day": day, "sim_ts": W.sim_ts(day), "kind": kind, "person": person, "text": text})

    def market(self, day, query):
        res = nimble.search(query)
        if res.get("live") and res.get("results"):
            text = "Nimble web: " + nimble.digest(res["results"])
            src = "nimble"
        elif day in W.WEB_EVENTS:
            text, src = "Web (fixture): " + W.WEB_EVENTS[day]["fixture"], "fixture"
        else:
            return None
        eid = self.log("strategist", "web_result", day, text, query=query, source=src)
        self.add_block(eid, day, "web_result", text)
        self.say(f"  🌐 {text[:140]}")
        return text

    # ------------------------------------------------------------------ main loop
    def run(self):
        self.say(f"== {self.run_id} | sponsors: {config.status()}")
        for day in range(1, self.days + 1):
            self.step(day)
        return self.finish()

    def step(self, day):
        ts, wk = W.sim_ts(day), (day - 1) // 5 + 1
        # Monday: Strategist plans the week (and watches the market via Nimble).
        if day % 5 == 1:
            try:
                plan, market = self.strategist.weekly(day, self.world.board(day), self.market)
            except LLMError as e:
                self.say(f"  ⚠️ strategist weekly failed ({e}); keeping last week's plan")
                plan, market = {}, None
            for op in plan.get("board_ops") or []:
                t = self.world.tickets.get(op.get("ticket"))
                if op.get("op") == "cut" and t and t["id"] not in launch_protected():
                    t["cut"] = True
            self.log("strategist", "strategist_plan", day, self.strategist.week_focus,
                     state_doc=self.strategist.state_doc, board_ops=plan.get("board_ops"))
            self.strategist.reports = []
            if wk in self.flux_weeks and config.BFL_API_KEY:
                b = plan.get("briefing") or {}
                p = flux.briefing_prompt(wk, b.get("headline", self.strategist.week_focus), b.get("lines") or [])
                th = threading.Thread(target=self._flux, args=(wk, p), daemon=True)
                th.start()
                self.flux_threads.append(th)

        # Standups -> events + memory blocks.
        for person, text in self.world.standups(day):
            eid = self.log("team", "standup", day, text, person=person)
            self.add_block(eid, day, "standup", text, person)

        # Doer decides.
        try:
            dec = self.doer.decide(day, self.world, self.strategist.week_focus)
        except LLMError as e:
            self.say(f"  ⚠️ doer failed ({e}); skipping day {day}")
            dec = {"assignments": [], "_queries": [], "report": "skipped (LLM failure)"}
        self.metrics["memory_sql_calls"] += len(dec["_queries"])
        for q in dec["_queries"]:
            self.log("doer1", "memory_sql", day, q["sql"], rows=q["rows"], error=q["error"])
            self.say(f"  🔎 memory_sql: {q['sql'][:120]} -> {q['rows']} rows")

        # Shadows validate today's decisions (remaster only).
        if self.mode == "remaster" and dec["assignments"]:
            dec = self.validate(day, dec)

        applied = self.world.apply_assignments(dec["assignments"])
        if applied:
            txt = "; ".join(f"{a['ticket']}->{a['person']}" for a in applied)
            eid = self.log("doer1", "doer_decision", day, f"Assigned {txt}. {dec.get('report', '')}",
                           assignments=dec["assignments"])
            self.add_block(eid, day, "doer_decision", f"Assigned {txt}")
            self.say(f"{ts} 🧑‍💼 {txt}")
        self.strategist.reports.append(f"{ts}: {dec.get('report', '')}")
        self.world.work_day(day)

        # Night.
        if self.mode == "remaster":
            ops = self.cleaner.night(day, self.strategist, self.memory)
            self.memory.commit_night(ops)
            for op in ops:
                self.metrics["cleaner_ops"][op["op"]] = self.metrics["cleaner_ops"].get(op["op"], 0) + 1
                self.log("cleaner", "cleaner_op", day, op.get("fact") or op.get("into") or op.get("why", ""),
                         op=op["op"], ids=op.get("ids"), why=op.get("why"))
                if op["op"] == "promote":
                    self.say(f"  🌙 promote: {op.get('fact')}")
        elif self.memory.needs_compaction():
            self.summarizer.compact(self.memory)
            self.metrics["compactions"] += 1
            self.log("summarizer", "compaction", day, self.memory.summary)
            self.say(f"  🗜️ naive compaction -> {self.memory.summary[:100]}")

        self.tick(day, dec)

    # ------------------------------------------------------------------ validation
    def validate(self, day, dec):
        d1 = {a["ticket"]: a for a in dec["assignments"]}
        for name, lag in SHADOW_TIERS:
            if lag < FULL and lag > len(self.memory.nights):
                continue  # identical view to an earlier tier
            hidden = self.memory.diff_ids(0, lag)
            if not hidden:
                continue
            sh = self.doer.decide(day, self.world, self.strategist.week_focus, lag=lag, agent=name)
            self.log(name, "shadow_decision", day, json.dumps(sh["assignments"])[:500], ctx=sh["_ctx"])
            for a in sh["assignments"]:
                mine = d1.get(a.get("ticket"))
                if not mine or mine.get("person") == a.get("person"):
                    continue
                self.metrics["divergences"] += 1
                v = self.judge.classify(a["ticket"], mine["person"], mine.get("reason", ""),
                                        a["person"], a.get("reason", ""))
                self.log("judge", "divergence", day, v.get("why", ""), ticket=a["ticket"], doer=mine["person"],
                         shadow=a["person"], shadow_tier=name, verdict=v.get("verdict"), judge=self.judge.using)
                self.say(f"  ⚠️ divergence [{name}] {a['ticket']}: doer->{mine['person']} vs shadow->{a['person']} "
                         f"=> {v.get('verdict')} ({self.judge.using})")
                if v.get("verdict") != "real":
                    continue
                self.metrics["real_divergences"] += 1
                ids = [i for i in a.get("facts_used") or [] if i in hidden] or self.bisect(day, a, hidden)
                if not ids:
                    continue
                self.memory.restore(ids, f"divergence on {a['ticket']} vs {name}")
                self.metrics["restores"] += 1
                for i in ids:
                    b = self.memory.blocks[i]
                    self.log("validator", "restore", day, b["text"], restored_id=i, from_day=b["day"],
                             shadow_tier=name, ticket=a["ticket"])
                    self.say(f"  ♻️ restored {i} ({b['sim_ts']}, {day - b['day']} days old): {b['text'][:100]}")
                new = self.doer.decide(day, self.world, self.strategist.week_focus)
                now = {x["ticket"]: x for x in new["assignments"]}.get(a["ticket"])
                ok = bool(now and now.get("person") == a["person"])
                self.metrics["confirmed_restores"] += int(ok)
                self.log("validator", "restore_verdict", day, "confirmed" if ok else "unconfirmed",
                         ticket=a["ticket"], new_person=(now or {}).get("person"))
                self.say(f"  ✅ doer now: {a['ticket']} -> {(now or {}).get('person')} ({'confirmed' if ok else 'unconfirmed'})")
                return new
        return dec

    def bisect(self, day, target, hidden, max_steps=4):
        """Find a minimal set of hidden ids that makes Doer 1 match the shadow's choice."""
        cand = list(hidden)
        for _ in range(max_steps):
            if len(cand) <= 2:
                break
            half = cand[len(cand) // 2:]
            self.memory.restores.append({"op": "restore", "ids": half, "why": "bisect-probe"})
            try:
                out = self.doer.decide(day, self.world, self.strategist.week_focus, agent="bisect")
            finally:
                self.memory.restores.pop()
            hit = any(x.get("ticket") == target["ticket"] and x.get("person") == target["person"]
                      for x in out["assignments"])
            cand = half if hit else cand[: len(cand) // 2]
        return cand

    # ------------------------------------------------------------------ bookkeeping
    def tick(self, day, dec):
        st = self.memory.render(0)[1]
        row = {"day": day, "ts": W.sim_ts(day), "mode": self.mode, "ctx_tokens": st["tokens"],
               "visible": st["visible"], "archived": st["archived"], "done": sum(
                   1 for t in self.world.tickets.values() if t["done_day"]),
               "divergences": self.metrics["divergences"], "restores": self.metrics["restores"]}
        if self.mode == "remaster":
            row["oracle_tokens"] = self.memory.render(FULL)[1]["tokens"]
        self.timeline.write(json.dumps(row) + "\n")
        self.timeline.flush()
        self.log("system", "ctx", day, "", **{k: v for k, v in row.items() if k != "day"})

    def _flux(self, wk, prompt):
        try:
            p = flux.generate(prompt, str(self.dir / f"briefing_w{wk}.mp4"))
            self.say(f"  🎬 Flux briefing W{wk}: {p}")
        except Exception as e:
            self.say(f"  🎬 Flux briefing W{wk} failed: {e}")

    def usage(self):
        u = {}
        for name, c in (("strategist", self.strat_llm), ("doer", self.doer_llm), ("liquid", self.liquid)):
            if c:
                u[name] = c.usage
        return u

    def finish(self):
        for th in self.flux_threads:
            th.join(timeout=900)
        self.store.flush()
        res = {"run": self.run_id, "mode": self.mode, "world": self.world.summary(), "metrics": self.metrics,
               "usage": self.usage(), "sponsors": config.status(),
               "final_ctx": self.memory.render(0)[1]}
        (self.dir / "result.json").write_text(json.dumps(res, indent=2, default=str))
        self.timeline.close()
        return res
