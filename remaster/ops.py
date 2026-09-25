"""Deterministic 'nobody idles' policy.

After an emergency replan, anyone whose assigned tickets are all blocked (and who
has no ready work) gets moved to the best ready unassigned ticket for their
skills. Pure world logic - no LLM - so the demo always shows movement.
"""
from . import world as W


def staff_free(world, day):
    """Assign people with NO open ticket to their best ready unassigned ticket."""
    out, reserved = [], set()
    for p in W.PEOPLE:
        if not world.available(p, day):
            continue
        if any(t["assignee"] == p and t["done_day"] is None and not t["cut"]
               for t in world.tickets.values()):
            continue
        best, best_fit = None, 0.45
        for t in world.tickets.values():
            if t["assignee"] or t["cut"] or t["done_day"] is not None or t["id"] in reserved:
                continue
            if not world.is_ready(t, day):
                continue
            fit = W.PEOPLE[p]["skills"].get(t["skill"], 0)
            if fit > best_fit or (best and fit == best_fit and t["estimate"] < best["estimate"]):
                best, best_fit = t, fit
        if best:
            out.append({"ticket": best["id"], "person": p,
                        "reason": f"{p} was free - staffing policy: {best['id']} is the best skill fit"})
            reserved.add(best["id"])
    return out


def idle_fallback(world, day):
    """Return mechanical assignments [{ticket, person, reason}] for stuck people."""
    out, reserved = [], set()
    for p in W.PEOPLE:
        if not world.available(p, day):
            continue
        mine = [t for t in world.tickets.values()
                if t["assignee"] == p and t["done_day"] is None and not t["cut"]]
        if not mine or any(world.is_ready(t, day) for t in mine):
            continue  # nothing assigned (daily planner's job) or has workable work
        blocked = mine[0]["id"]
        best, best_fit = None, 0.45
        for t in world.tickets.values():
            if t["assignee"] or t["cut"] or t["done_day"] is not None or t["id"] in reserved:
                continue
            if not world.is_ready(t, day):
                continue
            fit = W.PEOPLE[p]["skills"].get(t["skill"], 0)
            if fit > best_fit or (best and fit == best_fit and t["estimate"] < best["estimate"]):
                best, best_fit = t, fit
        if best:
            why = (f"{blocked} is blocked - moved to {best['id']} (best skill fit) so nobody idles"
                   if blocked else f"was free - picked up {best['id']} (best skill fit)")
            out.append({"ticket": best["id"], "person": p, "reason": why})
            reserved.add(best["id"])
    return out
