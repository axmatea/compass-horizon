"""Side-by-side demo numbers: REMaster vs naive. Usage: python3 compare.py <rem_dir> <naive_dir>"""
import json
import sys
from pathlib import Path


def load(d):
    d = Path(d)
    r = json.loads((d / "result.json").read_text())
    tl = [json.loads(l) for l in (d / "timeline.jsonl").read_text().splitlines()]
    r["_tl"] = tl
    return r


def row(label, f, fmt="{}"):
    a, b = f(rem), f(nai)
    print(f"{label:38} {fmt.format(a):>18} {fmt.format(b):>18}")


rem, nai = load(sys.argv[1]), load(sys.argv[2])
print(f"{'':38} {'REMaster':>18} {'naive':>18}")
row("Launched (day)", lambda r: r["world"]["launch_day"] or "never")
row("Made Demo Day (57)", lambda r: r["world"]["made_demo_day"])
row("Tickets done", lambda r: r["world"]["done"])
row("Final working context (tokens)", lambda r: r["_tl"][-1]["ctx_tokens"])
row("Peak working context (tokens)", lambda r: max(t["ctx_tokens"] for t in r["_tl"]))
row("Items visible at end", lambda r: r["_tl"][-1]["visible"])
row("Items archived (recoverable)", lambda r: r["_tl"][-1]["archived"])
row("Divergences caught", lambda r: r["metrics"]["divergences"])
row("Real (decision-changing)", lambda r: r["metrics"]["real_divergences"])
row("Facts restored from archive", lambda r: r["metrics"]["restores"])
row("memory_sql queries", lambda r: r["metrics"]["memory_sql_calls"])
ops = rem["metrics"].get("cleaner_ops") or {}
print(f"\nREMaster cleaner ops over the quarter: "
      + ", ".join(f"{k}={v}" for k, v in sorted(ops.items())) if ops else "")
u = {k: v for k, v in rem.get("usage", {}).items() if isinstance(v, dict)}
calls = sum(v.get("calls", 0) for v in u.values())
print(f"REMaster LLM calls: {calls} (all Liquid LFM-2.5-2.6B via OpenRouter, $0)")
