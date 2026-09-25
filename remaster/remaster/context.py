"""The Doer's working memory, expressed as blocks + a log of nightly cleanup ops.

Key idea: the context a Doer sees is a *pure function* of (all blocks, ops applied so
far). That makes shadow Doers trivial: a shadow with lag k is the same memory with the
last k nights of cleanup not yet applied. Restores are applied to every view.

Ops (emitted by the nightly Cleaner = fork of the Strategist):
  keep     {ids, why}                 no-op, recorded for audit
  fold     {ids, into, why}           hide ids, show one short synthesized line instead
  archive  {ids, why}                 hide ids; still reachable via memory_sql
  promote  {fact, ids?, why}          pin a durable fact in the Team Notes block
  restore  {ids, why}                 (validator) un-hide ids in every view
"""
from collections import defaultdict

from .llm import approx_tokens


class DoerMemory:
    def __init__(self):
        self.blocks = {}        # id -> block dict
        self.order = []         # ids in arrival order
        self.nights = []        # list of op-lists, one per night
        self.restores = []      # restore ops (global, applied to every view)

    def add(self, block):
        self.blocks[block["id"]] = block
        self.order.append(block["id"])

    def commit_night(self, ops):
        self.nights.append([o for o in ops if o.get("op") != "restore"])

    def restore(self, ids, why):
        op = {"op": "restore", "ids": list(ids), "why": why}
        self.restores.append(op)
        return op

    # -- views -----------------------------------------------------------------
    def view(self, lag=0):
        """Return (visible_ids, folds, pinned, hidden_ids) after applying cleanup ops
        from all nights except the last `lag` ones, plus every restore."""
        hidden, folds, pinned = set(), [], []
        applied = self.nights[: max(0, len(self.nights) - lag)]
        for night in applied:
            for op in night:
                ids = set(op.get("ids") or [])
                if op["op"] == "archive":
                    hidden |= ids
                elif op["op"] == "fold":
                    hidden |= ids
                    folds.append({"text": op.get("into", ""), "ids": sorted(ids)})
                elif op["op"] == "promote" and op.get("fact"):
                    pinned.append(op["fact"])
        restored = set()
        for op in self.restores:
            restored |= set(op["ids"])
        hidden -= restored
        visible = [i for i in self.order if i not in hidden]
        return visible, folds, pinned, hidden

    def render(self, lag=0, budget_hint=None):
        visible, folds, pinned, hidden = self.view(lag)
        parts = []
        if pinned:
            parts.append("## Team notes (durable, curated)\n" + "\n".join(f"- {p}" for p in dict.fromkeys(pinned)))
        if folds:
            parts.append("## Folded history\n" + "\n".join(f"- {f['text']}" for f in folds))
        if hidden:
            idx = defaultdict(list)
            for i in hidden:
                b = self.blocks[i]
                idx[(b.get("person") or "-", b["kind"])].append(b["day"])
            lines = [f"- {p} / {k}: {len(d)} items (days {min(d)}–{max(d)})" for (p, k), d in sorted(idx.items())]
            parts.append("## Archive index (not in context; query with memory_sql)\n" + "\n".join(lines))
        if visible:
            parts.append("## Recent memory\n" + "\n".join(
                f"[{i} {self.blocks[i]['sim_ts']} {self.blocks[i]['kind']}"
                f"{' ' + self.blocks[i]['person'] if self.blocks[i].get('person') else ''}] {self.blocks[i]['text']}"
                for i in visible))
        body = "\n\n".join(parts)
        stats = self.stats(lag, body)
        head = (f"## Memory proprioception\ncontext≈{stats['tokens']} tok | visible={stats['visible']} "
                f"| archived={stats['archived']} | folds={stats['folds']} | oldest visible day="
                f"{stats['oldest_visible_day']}" + (f" | budget≈{budget_hint}" if budget_hint else ""))
        return head + "\n\n" + body, stats

    def stats(self, lag=0, rendered=None):
        visible, folds, pinned, hidden = self.view(lag)
        if rendered is None:
            rendered = "\n".join(self.blocks[i]["text"] for i in visible)
        return {"tokens": approx_tokens(rendered), "visible": len(visible), "archived": len(hidden),
                "folds": len(folds), "pinned": len(pinned),
                "oldest_visible_day": min((self.blocks[i]["day"] for i in visible), default=None)}

    def diff_ids(self, lag_a, lag_b):
        """Ids visible in view(lag_b) but hidden in view(lag_a)."""
        va = set(self.view(lag_a)[0])
        vb = self.view(lag_b)[0]
        return [i for i in vb if i not in va]


class NaiveMemory:
    """Baseline: industry-default rolling summarization. When the context exceeds a
    budget, the oldest half is replaced by a generic summary. Lossy and irreversible."""

    def __init__(self, budget_tokens=6000):
        self.budget = budget_tokens
        self.summary = ""
        self.items = []
        self.blocks = {}

    def add(self, block):
        self.blocks[block["id"]] = block
        self.items.append(block)

    def needs_compaction(self):
        return approx_tokens(self._text()) > self.budget

    def oldest_half(self):
        return self.items[: len(self.items) // 2]

    def apply_summary(self, new_summary):
        self.items = self.items[len(self.items) // 2:]
        self.summary = new_summary

    def _text(self):
        return self.summary + "\n".join(b["text"] for b in self.items)

    def render(self, lag=0, budget_hint=None):
        parts = []
        if self.summary:
            parts.append("## Summary of earlier history\n" + self.summary)
        parts.append("## Recent memory\n" + "\n".join(
            f"[{b['id']} {b['sim_ts']} {b['kind']}{' ' + b['person'] if b.get('person') else ''}] {b['text']}"
            for b in self.items))
        body = "\n\n".join(parts)
        return body, {"tokens": approx_tokens(body), "visible": len(self.items), "archived": 0,
                      "folds": 1 if self.summary else 0, "pinned": 0,
                      "oldest_visible_day": self.items[0]["day"] if self.items else None}
