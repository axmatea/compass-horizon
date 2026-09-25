"""The hippocampus: an append-only event log of everything every agent sees or does.

Local SQLite is always written (fast, lets memory_sql work offline). When Rawtree
credentials are present, every event is also shipped there (the demo's source of
truth + dashboard). Nothing is ever deleted: context cleanup only changes what the
Doer *sees*, never what is stored.
"""
import json
import re
import sqlite3
import threading
import urllib.error
import urllib.request

from . import config


class EventStore:
    def __init__(self, path, run_id):
        self.run_id = run_id
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("""CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, seq INTEGER, run TEXT, day INTEGER, sim_ts TEXT,
            agent TEXT, kind TEXT, person TEXT, text TEXT, data TEXT)""")
        self.db.commit()
        self._seq = self.db.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0]
        self._lock = threading.Lock()
        self.ro = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
        self.sink = RawtreeSink() if config.RAWTREE_TOKEN else None

    def log(self, agent, kind, day, sim_ts, text="", person=None, **data):
        with self._lock:
            self._seq += 1
            eid = f"E{self._seq:05d}"
            self.db.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (eid, self._seq, self.run_id, day, sim_ts, agent, kind, person,
                             text, json.dumps(data, default=str)))
            self.db.commit()
        if self.sink:
            self.sink.send({"id": eid, "seq": self._seq, "run": self.run_id, "day": day,
                            "sim_ts": sim_ts, "agent": agent, "kind": kind, "person": person,
                            "text": text, **data})
        return eid

    def get(self, eid):
        r = self.db.execute("SELECT id, day, sim_ts, agent, kind, person, text FROM events WHERE id=?",
                            (eid,)).fetchone()
        return dict(zip(["id", "day", "sim_ts", "agent", "kind", "person", "text"], r)) if r else None

    def memory_sql(self, sql, limit=20):
        """Read-only SQL the Doer can run against its own past."""
        s = sql.strip().rstrip(";")
        if not s.lower().startswith(("select", "with")):
            return {"error": "only SELECT queries are allowed"}
        if self.sink:
            return self.sink.query(s, limit)
        try:
            cur = self.ro.execute(s)
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchmany(limit)]
            return {"rows": rows}
        except Exception as e:
            return {"error": str(e)}

    def flush(self):
        if self.sink:
            self.sink.flush()

    def sql_hint(self):
        if self.sink:
            return RAWTREE_HINT.format(table=self.sink.table, run=self.run_id)
        return SQLITE_HINT


SQLITE_HINT = (
    "Table `events(id, seq, run, day, sim_ts, agent, kind, person, text, data)`. "
    "`kind` in (standup, doer_decision, web_result, cleaner_op, divergence, restore, strategist_plan, "
    "world_event). `sim_ts` looks like 'W2D3', `day` is 1..60. `text` holds the natural-language content. "
    "SQLite dialect: use LIKE '%word%' (case-insensitive) for text search."
)
RAWTREE_HINT = (
    "Table `{table}` (ClickHouse SQL). Columns: id, seq, run, day, sim_ts, agent, kind, person, text. "
    "`kind` in (standup, doer_decision, web_result, cleaner_op, divergence, restore, strategist_plan, "
    "world_event). `sim_ts` looks like 'W2D3', `day` is 1..60. Always filter run = '{run}'. "
    "Use text ILIKE '%word%' for text search. ONLY these columns exist - anything else (status, name, assignee, date...) is an ERROR. "
)


def _post_json(url, body, timeout=30):
    headers = {"Authorization": f"Bearer {config.RAWTREE_TOKEN}", "Content-Type": "application/json"}
    if config.RAWTREE_DATABASE:
        headers["x-rawtree-database"] = config.RAWTREE_DATABASE
    req = urllib.request.Request(url, data=json.dumps(body, default=str).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


class RawtreeSink:
    """Rawtree (Tinybird): schemaless JSON ingest + ClickHouse SQL over HTTP."""

    def __init__(self, batch=25):
        self.buf, self.batch, self.errors = [], batch, 0
        self.host = config.RAWTREE_HOST.rstrip("/")
        self.table = config.RAWTREE_TABLE

    def send(self, ev):
        self.buf.append(ev)
        if len(self.buf) >= self.batch:
            self.flush()

    def flush(self):
        if not self.buf:
            return
        batch, self.buf = self.buf, []
        try:
            _post_json(f"{self.host}/v1/tables/{self.table}", batch)
        except Exception as e:
            self.errors += 1
            print(f"[rawtree] ingest failed ({self.errors}): {e}", flush=True)

    def query(self, sql, limit=20):
        self.flush()
        # Rawtree columns are ClickHouse Dynamic; `col IN (...)` needs a cast.
        sql = re.sub(r"\b(id|run|sim_ts|agent|kind|person|text)(\s+IN\s*\()",
                     r"toString(\1)\2", sql, flags=re.IGNORECASE)
        try:
            res = _post_json(f"{self.host}/v1/query", {"sql": sql, "format": "JSON"})
            return {"rows": (res.get("data") or [])[:limit]}
        except urllib.error.HTTPError as e:
            return {"error": f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"}
        except Exception as e:
            return {"error": str(e)}
