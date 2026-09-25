"""Interactive REMaster demo server: a live week board you can poke.

Holds one in-memory Run. Endpoints:
  GET  /                  board UI
  GET  /api/state         full board + memory X-ray + event feed
  POST /api/step          advance one simulated day (async; busy flag in state)
  POST /api/inject        {"ticket": "B3", "days": 1, "note": "..."} provider delay
"""
import json
import sqlite3
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

from remaster import world as W
from remaster.ops import idle_fallback
from remaster.sim import Run

LOCK = threading.Lock()
RUN = Run("remaster", days=W.DAYS, run_id=None, out_dir="runs", flux_weeks=set(), verbose=True)
STATE = {"day": 0, "busy": False, "last_diff": None, "injected": [], "ack": None}


def snapshot_assignees():
    return {t["id"]: t["assignee"] for t in RUN.world.tickets.values()}


def do_step():
    day = STATE["day"] + 1
    before = snapshot_assignees()
    try:
        RUN.step(day)
    except Exception as e:  # keep the demo alive no matter what
        print(f"step {day} error: {e}", flush=True)
    after = snapshot_assignees()
    changes = [{"ticket": t, "from": before[t], "to": after[t]}
               for t in before if before[t] != after[t]]
    reasons = {}
    try:
        db = sqlite3.connect(RUN.dir / "events.db")
        row = db.execute("select data from events where kind='doer_decision' and day=? "
                         "order by seq desc limit 1", (day,)).fetchone()
        if row and row[0]:
            for a in (json.loads(row[0]).get("assignments") or []):
                if a.get("ticket") and a.get("reason"):
                    reasons[a["ticket"]] = a["reason"]
        db.close()
    except Exception:
        pass
    for c in changes:
        c["reason"] = reasons.get(c["ticket"], "")
    STATE["day"] = day
    STATE["last_diff"] = {"day": day, "changes": changes}
    STATE["busy"] = False


def replan(day, trigger):
    """Same-day emergency replan: the doer re-decides right now."""
    before = snapshot_assignees()
    focus = (f"{RUN.strategist.week_focus} | EMERGENCY REPLAN ({trigger}): a ticket just got "
             f"blocked. Anyone whose ticket is blocked must be reassigned to a READY ticket "
             f"matching their skills NOW - nobody idles.")
    try:
        dec = RUN.doer.decide(day, RUN.world, focus)
        applied = RUN.world.apply_assignments(dec.get("assignments"))
        for q in dec.get("_queries") or []:
            RUN.log("doer1", "memory_sql", day, q["sql"], rows=q["rows"], error=q["error"])
        if applied:
            txt = "; ".join(f"{a['ticket']}->{a['person']}" for a in applied)
            eid = RUN.log("doer1", "doer_decision", day,
                          f"Emergency replan ({trigger}): {txt}. {dec.get('report', '')}",
                          assignments=dec.get("assignments"))
            RUN.add_block(eid, day, "doer_decision", f"Emergency replan: {txt}")
    except Exception as e:
        print(f"replan error: {e}", flush=True)
        dec = {}
    # Nobody-idles policy: if the model left someone parked on a blocked ticket,
    # move them mechanically to their best ready ticket.
    fb = idle_fallback(RUN.world, day)
    if fb:
        RUN.world.apply_assignments(fb)
        txt = "; ".join(f"{a['ticket']}->{a['person']}" for a in fb)
        eid = RUN.log("doer1", "doer_decision", day,
                      f"Nobody-idles policy: {txt}", assignments=fb)
        RUN.add_block(eid, day, "doer_decision", f"Nobody-idles policy: {txt}")
    after = snapshot_assignees()
    reasons = {(a.get("ticket") or ""): a.get("reason") or ""
               for a in list(dec.get("assignments") or []) + fb}
    changes = [{"ticket": t, "from": before[t], "to": after[t], "reason": reasons.get(t, "")}
               for t in before if before[t] != after[t]]
    STATE["last_diff"] = {"day": day, "changes": changes}
    STATE["busy"] = False


def do_say(person, text):
    """A team member talks to the company manager; it interprets, adjusts, replans."""
    day = max(STATE["day"], 1)
    eid = RUN.log("team", "message", day, f"{person} says: {text}", person=person)
    RUN.add_block(eid, day, "message", f"{person} says: {text}", person)
    blocked = []
    try:
        out = RUN.doer_llm.json([
            {"role": "system", "content":
             "You are the company manager's intake. A team member sent a message. Decide if any "
             "board ticket must be DELAYED because of it.\nBoard:\n" + RUN.world.board(day)},
            {"role": "user", "content":
             f'{person} says: "{text}"\nReturn JSON only: '
             '{"delays": [{"ticket": "ID", "days": N}], "ack": "one short sentence to the team member"} '
             '(delays empty if the message implies none).'}], temperature=0)
    except Exception as e:
        print(f"say intake error: {e}", flush=True)
        out = {}
    for d in out.get("delays") or []:
        t = RUN.world.tickets.get(str(d.get("ticket", "")).strip().upper())
        if not t or t["done_day"] is not None:
            continue
        until = day + 1 + max(0, int(d.get("days", 1) or 1) - 1)
        t["not_before"] = max(t["not_before"], until + 1)
        blocked.append({"day": day, "ticket": t["id"], "until": W.sim_ts(until + 1)})
        ev = RUN.log("world", "world_event", day,
                     f"🚨 Reported by {person}: {t['id']} ({t['title']}) delayed - blocked "
                     f"until {W.sim_ts(until + 1)}.", ticket=t["id"])
        RUN.add_block(ev, day, "world_event",
                      f"{t['id']} blocked until {W.sim_ts(until + 1)} (reported by {person})")
        threading.Thread(target=RUN.market,
                         args=(day, f"{t['title']} vendor delay alternatives"),
                         daemon=True).start()
    STATE["injected"] += blocked
    STATE["ack"] = {"person": person, "text": out.get("ack") or "Got it - replanning.",
                    "day": day}
    replan(day, f"message from {person}")


def inject(ticket, days, note):
    day = STATE["day"] or 1
    t = RUN.world.tickets.get(ticket)
    if not t:
        return {"error": f"no ticket {ticket}"}
    until = day + 1 + max(0, int(days) - 1)
    t["not_before"] = max(t["not_before"], until + 1)  # blocked THROUGH `until`
    text = (f"🚨 EXTERNAL EVENT: supplier/provider for {ticket} ({t['title']}) is delayed - "
            f"deliverable now expected {W.sim_ts(until + 1)}. {ticket} is blocked until then. "
            f"{note or ''} Whoever is on it should be redeployed; replan around this.")
    eid = RUN.log("world", "world_event", day, text, ticket=ticket)
    RUN.add_block(eid, day, "world_event", text)
    STATE["injected"].append({"day": day, "ticket": ticket, "until": W.sim_ts(until + 1)})
    # Nimble: research the outside world about the delay, feed it to memory too.
    threading.Thread(target=RUN.market, args=(day, f"{t['title']} vendor delay alternatives"),
                     daemon=True).start()
    return {"ok": True, "ticket": ticket, "blocked_until": W.sim_ts(until + 1)}


def state():
    ppl = []
    for p, v in W.PEOPLE.items():
        ppl.append({"name": p, "role": v["role"],
                    "absent": sorted(W.ABSENT.get(p, []))[:8]})
    day = STATE["day"]
    tickets = {}
    for t in RUN.world.tickets.values():
        eff = RUN.world.true_effort(t, t["assignee"]) if t["assignee"] else t["estimate"]
        tickets[t["id"]] = {
            "id": t["id"], "title": t["title"], "skill": t["skill"], "est": t["estimate"],
            "deps": t["deps"], "assignee": t["assignee"], "not_before": t["not_before"],
            "pct": int(100 * min(1.0, t["progress"] / eff)) if t["progress"] else 0,
            "status": RUN.world.status(t, max(day, 1)),
        }
    mem_text, mem = RUN.memory.render()
    feed = []
    try:
        db = sqlite3.connect(RUN.dir / "events.db")
        for k, d, ts, txt in db.execute(
                "select kind, day, sim_ts, substr(text,1,180) from events where kind in "
                "('doer_decision','world_event','web_result','cleaner_op','restore','divergence',"
                "'memory_sql','strategist_plan','message') order by seq desc limit 25"):
            feed.append({"kind": k, "day": d, "ts": ts, "text": txt})
        db.close()
    except Exception as e:
        print(f"feed error: {e!r}", flush=True)
    return {"run_id": RUN.run_id, "day": day, "ts": W.sim_ts(max(day, 1)) if day else "-",
            "week": (max(day, 1) - 1) // 5 + 1, "demo_day": W.DEMO_DAY,
            "busy": STATE["busy"], "last_diff": STATE["last_diff"], "injected": STATE["injected"],
            "ack": STATE["ack"],
            "people": ppl, "tickets": tickets,
            "work_log": [[d, p, t] for d, p, t, _ in RUN.world.log][-400:],
            "memory": {"ctx_tokens": mem["tokens"], "visible": mem["visible"],
                       "archived": mem["archived"], "pinned": mem["pinned"]},
            "metrics": RUN.metrics, "feed": feed}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/state"):
            with LOCK:
                return self._send(200, state())
        if self.path == "/" or self.path.startswith("/board"):
            return self._send(200, Path("board.html").read_bytes(), "text/html")
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}") if n else {}
        if self.path == "/api/step":
            with LOCK:
                if STATE["busy"]:
                    return self._send(409, {"error": "busy"})
                if STATE["day"] >= RUN.days:
                    return self._send(400, {"error": "quarter over"})
                STATE["busy"] = True
                threading.Thread(target=do_step, daemon=True).start()
            return self._send(200, {"ok": True, "stepping_to": STATE["day"] + 1})
        if self.path == "/api/inject":
            with LOCK:
                return self._send(200, inject(body.get("ticket"), body.get("days", 1),
                                              body.get("note", "")))
        if self.path == "/api/say":
            person, text = body.get("person"), (body.get("text") or "").strip()
            if person not in W.PEOPLE or not text:
                return self._send(400, {"error": "need person + text"})
            with LOCK:
                if STATE["busy"]:
                    return self._send(409, {"error": "busy"})
                STATE["busy"] = True
                threading.Thread(target=do_say, args=(person, text), daemon=True).start()
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})


if __name__ == "__main__":
    port = 8770
    print(f"REMaster LIVE board on http://localhost:{port}  (run {RUN.run_id})", flush=True)
    HTTPServer(("0.0.0.0", port), H).serve_forever()
