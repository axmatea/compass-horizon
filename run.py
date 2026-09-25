#!/usr/bin/env python3
"""REMaster CLI.

  python3 run.py                       # REMaster over the full quarter
  python3 run.py --mode naive          # industry-default baseline
  python3 run.py --compare             # both, side by side
  python3 run.py --days 15             # shorter run
  python3 run.py --flux 1,5,9          # Flux 3 briefing videos for those weeks
"""
import argparse
import json

from remaster import config
from remaster.sim import Run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["remaster", "naive"], default="remaster")
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--flux", default="")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    weeks = [int(x) for x in a.flux.split(",") if x.strip()]
    modes = ["remaster", "naive"] if a.compare else [a.mode]
    results = [Run(m, days=a.days, flux_weeks=weeks, verbose=not a.quiet).run() for m in modes]
    print("\n==== RESULTS ====")
    for r in results:
        w = r["world"]
        print(f"{r['mode']:>9}: launch={w['launch_ts']} demo_day_ok={w['made_demo_day']} "
              f"margin={w['days_vs_demo_day']}d idle_during_absence={w['idle_during_absence']} "
              f"final_ctx={r['final_ctx']['tokens']}tok restores={r['metrics']['restores']} "
              f"divergences={r['metrics']['divergences']}")
    print(json.dumps({"sponsors": config.status()}, indent=1))


if __name__ == "__main__":
    main()
