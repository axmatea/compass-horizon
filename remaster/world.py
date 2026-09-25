"""Simulated startup for a reproducible quarter: 6 people, a backlog with dependencies,
hidden traits (skills, overrun), life events, and planted facts we later probe.

A "day" is one working day. 12 weeks x 5 days = 60 days. Demo Day = day 57 (W12D2).
"""
import copy
import random

DEMO_DAY = 57
DAYS = 60


def sim_ts(day):
    return f"W{(day - 1) // 5 + 1}D{(day - 1) % 5 + 1}"


PEOPLE = {
    "lina":  {"role": "backend engineer",  "skills": {"backend": 1.0, "frontend": 0.5, "design": 0.1, "mobile": 0.0, "growth": 0.2, "qa": 0.8}, "overrun": 1.0},
    "tom":   {"role": "frontend engineer", "skills": {"backend": 0.4, "frontend": 1.0, "design": 0.3, "mobile": 0.3, "growth": 0.2, "qa": 0.7}, "overrun": 1.4},
    "sarah": {"role": "product designer",  "skills": {"backend": 0.0, "frontend": 0.5, "design": 1.0, "mobile": 0.2, "growth": 0.4, "qa": 0.4}, "overrun": 1.0},
    "max":   {"role": "full-stack engineer", "skills": {"backend": 0.7, "frontend": 0.7, "design": 0.8, "mobile": 0.4, "growth": 0.3, "qa": 0.9}, "overrun": 1.0},
    "priya": {"role": "mobile engineer",   "skills": {"backend": 0.3, "frontend": 0.6, "design": 0.2, "mobile": 1.0, "growth": 0.1, "qa": 0.7}, "overrun": 1.0},
    "omar":  {"role": "growth lead",       "skills": {"backend": 0.0, "frontend": 0.2, "design": 0.3, "mobile": 0.0, "growth": 1.0, "qa": 0.3}, "overrun": 1.0},
    "jules": {"role": "sales lead",        "skills": {"sales": 1.0, "growth": 0.5, "cs": 0.4, "marketing": 0.3}, "overrun": 1.0},
    "mia":   {"role": "customer success",  "skills": {"cs": 1.0, "sales": 0.4, "qa": 0.5, "marketing": 0.2}, "overrun": 1.0},
    "dan":   {"role": "content marketer",  "skills": {"marketing": 1.0, "growth": 0.7, "design": 0.3, "sales": 0.2}, "overrun": 1.2},
    "eva":   {"role": "QA engineer",       "skills": {"qa": 1.0, "backend": 0.3, "frontend": 0.3, "cs": 0.3}, "overrun": 0.9},
}

# Absences (ground truth). Sarah's is the planted "wedding" fact.
ABSENT = {"sarah": set(range(41, 46)),       # all of W9
          "lina": {17, 18},                  # sick W4D2-D3
          "priya": {30}}                     # W6D5

# id: (title, skill, estimate_days, deps, not_before_day)
BACKLOG = {
    "B1": ("Auth & accounts", "backend", 6, [], 1),
    "B2": ("Core data model", "backend", 5, ["B1"], 1),
    "B3": ("Payments API (Stripe)", "backend", 8, ["B2"], 1),
    "B4": ("Notifications service", "backend", 5, ["B2"], 1),
    "B5": ("Analytics events", "backend", 4, ["B2"], 1),
    "B6": ("Perf hardening", "backend", 5, ["B3", "B4"], 1),
    "F1": ("Web app shell", "frontend", 5, [], 1),
    "F2": ("Onboarding flow (web)", "frontend", 6, ["F1", "D1"], 1),
    "F3": ("Dashboard", "frontend", 8, ["F1", "B2"], 1),
    "F4": ("Checkout UI", "frontend", 6, ["B3", "D2"], 1),
    "F5": ("Settings page", "frontend", 4, ["F1"], 1),
    "F6": ("Landing page build", "frontend", 4, ["D4"], 1),
    "D1": ("Onboarding designs", "design", 4, [], 1),
    "D2": ("Checkout designs", "design", 4, ["D1"], 1),
    "D3": ("Design system", "design", 6, [], 1),
    "D4": ("Launch visuals & landing design", "design", 8, [], 36),
    "M1": ("Mobile app shell", "mobile", 6, [], 1),
    "M2": ("Mobile onboarding", "mobile", 6, ["M1", "D1"], 1),
    "M3": ("Mobile checkout", "mobile", 6, ["M2", "B3"], 1),
    "G1": ("Waitlist & referral", "growth", 4, [], 1),
    "G2": ("Launch copy", "growth", 5, ["F3"], 1),
    "G3": ("Product Hunt launch kit", "growth", 4, ["D4"], 1),
    "G4": ("Press list outreach", "growth", 3, [], 1),
    "Q1": ("Launch QA pass", "qa", 4, ["F4", "F6", "M3", "B6"], 1),
    "S1": ("Sales pipeline & CRM setup", "sales", 4, [], 1),
    "S2": ("First 10 customer demos", "sales", 6, ["S1", "F3"], 1),
    "S3": ("Pricing page & contracts", "sales", 4, ["S1"], 1),
    "C1": ("Support playbook & help center", "cs", 5, [], 1),
    "C2": ("Beta onboarding calls", "cs", 5, ["C1", "F2"], 1),
    "K1": ("Content calendar & SEO posts", "marketing", 6, [], 1),
    "K2": ("Launch email campaign", "marketing", 4, ["K1", "D4"], 36),
}
LAUNCH_REQUIRED = ["B6", "F2", "F3", "F4", "F5", "F6", "M3", "G2", "G3", "Q1"]

# Planted facts: (day, person, text, probe_question, expected_keyword)
PLANTED = [
    (2, "lina", "Heads up: I can't do mobile work at all, never touched Swift/Kotlin.",
     "Can Lina take a mobile ticket?", "no"),
    (8, "sarah", "FYI I'm off the whole of week 9 (W9) - getting married!",
     "Is Sarah available in week 9?", "no"),
    (12, "tom", "B-t-w my ticket took way longer than I estimated, again. I always lowball.",
     "How reliable are Tom's estimates?", "underestimate"),
    (16, "lina", "Feeling sick, I'll be out tomorrow and the day after.",
     "Was Lina out in W4?", "yes"),
    (26, "omar", "Client call: they want to see the checkout flow at Demo Day above all else.",
     "What does the client care most about at Demo Day?", "checkout"),
]

# External world events (fed through Nimble when live; fixture text offline).
WEB_EVENTS = {
    21: {"query": "Product Hunt launch AI onboarding startup this week",
         "fixture": "Product Hunt today: 'Launchly' (#1 of the day) launched AI-guided onboarding - "
                    "same promise as ours. Commenters praise its checkout simplicity."},
}


class World:
    def __init__(self, seed=7):
        self.rng = random.Random(seed)
        self.tickets = {}
        for tid, (title, skill, est, deps, nb) in BACKLOG.items():
            self.tickets[tid] = {"id": tid, "title": title, "skill": skill, "estimate": est,
                                 "deps": deps, "not_before": nb, "assignee": None,
                                 "progress": 0.0, "done_day": None, "cut": False}
        self.day = 0
        self.log = []   # (day, person, ticket, work) for metrics
        self.idle_in_absence = []  # (day, person, ticket) - assigned work sitting idle

    def clone(self):
        return copy.deepcopy(self)

    # -- state ---------------------------------------------------------------
    def available(self, person, day):
        return day not in ABSENT.get(person, set())

    def true_effort(self, t, person):
        return t["estimate"] * PEOPLE[person]["overrun"]

    def is_ready(self, t, day):
        return (not t["cut"] and t["done_day"] is None and day >= t["not_before"]
                and all(self.tickets[d]["done_day"] is not None for d in t["deps"]))

    def status(self, t, day):
        if t["cut"]:
            return "cut"
        if t["done_day"] is not None:
            return f"done({sim_ts(t['done_day'])})"
        if not self.is_ready(t, day):
            if day < t["not_before"]:
                return f"blocked(not before {sim_ts(t['not_before'])})"
            return "blocked(deps: " + ",".join(d for d in t["deps"] if self.tickets[d]["done_day"] is None) + ")"
        return "in_progress" if t["assignee"] and t["progress"] > 0 else ("ready" if not t["assignee"] else "assigned")

    def board(self, day):
        rows = []
        for t in self.tickets.values():
            eff = self.true_effort(t, t["assignee"]) if t["assignee"] else t["estimate"]
            pct = int(100 * min(1.0, t["progress"] / eff)) if t["progress"] else 0
            deps = ",".join(t["deps"]) or "-"
            rows.append(f"{t['id']:<3} {t['title']:<32} skill={t['skill']:<8} est={t['estimate']}d deps={deps:<12} "
                        f"assignee={t['assignee'] or '-':<6} {pct:>3}% {self.status(t, day)}")
        return "\n".join(rows)

    def team_roster(self):
        return "\n".join(f"- {p}: {v['role']}" for p, v in PEOPLE.items())

    # -- dynamics ------------------------------------------------------------
    def apply_assignments(self, assignments):
        applied = []
        for a in assignments or []:
            t = self.tickets.get(a.get("ticket"))
            p = a.get("person")
            if not t or p not in PEOPLE or t["done_day"] is not None or t["cut"]:
                continue
            if t["assignee"] and t["assignee"] != p and t["progress"]:
                # carry progress proportionally to the new person's effort scale
                t["progress"] *= self.true_effort(t, p) / self.true_effort(t, t["assignee"])
            t["assignee"] = p
            applied.append({"ticket": t["id"], "person": p})
        return applied

    def work_day(self, day):
        """Each available person works on their highest-priority ready ticket."""
        self.day = day
        order = list(BACKLOG)
        for p in PEOPLE:
            mine = [self.tickets[i] for i in order if self.tickets[i]["assignee"] == p
                    and self.is_ready(self.tickets[i], day)]
            if not mine:
                continue
            t = mine[0]
            if not self.available(p, day):
                self.idle_in_absence.append((day, p, t["id"]))
                continue
            rate = PEOPLE[p]["skills"].get(t["skill"], 0)
            if rate <= 0.05:
                continue
            t["progress"] += rate
            self.log.append((day, p, t["id"], rate))
        for t in self.tickets.values():
            if t["assignee"] and t["done_day"] is None and t["progress"] >= self.true_effort(t, t["assignee"]) - 1e-9:
                t["done_day"] = day

    def standups(self, day):
        """Short, deterministic standup lines (+ planted facts)."""
        out = []
        planted = {(d, p): txt for d, p, txt, _, _ in PLANTED}
        for p in PEOPLE:
            if not self.available(p, day):
                continue
            mine = [t for t in self.tickets.values() if t["assignee"] == p and t["done_day"] is None]
            done_today = [t for t in self.tickets.values() if t["assignee"] == p and t["done_day"] == day - 1]
            bits = []
            if done_today:
                bits.append("shipped " + ", ".join(t["id"] for t in done_today))
            if mine:
                cur = mine[0]
                if self.is_ready(cur, day):
                    eff = self.true_effort(cur, p)
                    bits.append(f"on {cur['id']} ({int(100 * min(1, cur['progress'] / eff))}%)")
                else:
                    bits.append(f"waiting on {cur['id']} ({self.status(cur, day)})")
            else:
                bits.append("no ticket assigned, free")
            if (day, p) in planted:
                bits.append(planted[(day, p)])
            out.append((p, "; ".join(bits)))
        return out

    # -- scoring ---------------------------------------------------------------
    def launch_day(self):
        days = [self.tickets[t]["done_day"] for t in LAUNCH_REQUIRED if not self.tickets[t]["cut"]]
        return None if any(d is None for d in days) else max(days)

    def summary(self):
        ld = self.launch_day()
        return {
            "launch_day": ld, "launch_ts": sim_ts(ld) if ld else None,
            "demo_day": DEMO_DAY,
            "made_demo_day": bool(ld and ld <= DEMO_DAY),
            "days_vs_demo_day": (DEMO_DAY - ld) if ld else None,
            "done": sum(1 for t in self.tickets.values() if t["done_day"]),
            "idle_during_absence": len(self.idle_in_absence),
            "idle_detail": self.idle_in_absence[:12],
        }
