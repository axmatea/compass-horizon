#!/usr/bin/env python3
"""Memory X-ray dashboard server (stdlib). `python3 server.py` -> http://localhost:8765"""
import json
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
RUNS = ROOT / "runs"
FEED_KINDS = ("cleaner_op", "divergence", "restore", "restore_verdict", "memory_sql", "web_result",
              "strategist_plan", "doer_decision", "compaction")


def runs():
    out = []
    for d in sorted(RUNS.glob("*/"), key=lambda p: p.stat().st_mtime, reverse=True):
        res = d / "result.json"
        out.append({"id": d.name, "mode": d.name.split("-")[0], "finished": res.exists(),
                    "result": json.loads(res.read_text()) if res.exists() else None})
    return out


def timeline(run):
    p = RUNS / run / "timeline.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def events(run, after=0):
    p = RUNS / run / "events.db"
    if not p.exists():
        return []
    db = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    q = (f"SELECT seq,id,day,sim_ts,agent,kind,person,text,data FROM events WHERE seq>? AND kind IN "
         f"({','.join('?' * len(FEED_KINDS))}) ORDER BY seq LIMIT 500")
    rows = db.execute(q, (after, *FEED_KINDS)).fetchall()
    db.close()
    keys = ["seq", "id", "day", "sim_ts", "agent", "kind", "person", "text", "data"]
    out = []
    for r in rows:
        e = dict(zip(keys, r))
        e["data"] = json.loads(e["data"] or "{}")
        out.append(e)
    return out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path in ("/", "/index.html"):
            return self._send(200, (ROOT / "dashboard.html").read_bytes(), "text/html; charset=utf-8")
        if u.path == "/api/runs":
            return self._send(200, runs())
        if u.path == "/api/timeline":
            return self._send(200, timeline(qs.get("run", "")))
        if u.path == "/api/events":
            return self._send(200, events(qs.get("run", ""), int(qs.get("after", 0))))
        if u.path.startswith("/media/"):
            f = (RUNS / u.path[len("/media/"):]).resolve()
            if RUNS.resolve() in f.parents and f.exists():
                return self._send(200, f.read_bytes(), "video/mp4")
        self._send(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Memory X-ray on http://localhost:{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
