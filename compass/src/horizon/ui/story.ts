import type { BeliefView, WorldView } from "../contract";

export function pct(p: number | null | undefined): string | null {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  return `${Math.round(p * 100)}%`;
}

/** Short money: null or undefined is unknown and renders as null, never $0. */
export function moneyShort(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${Math.round(n)}`;
}

function key(frame: WorldView, campaignId: string | null): string | null {
  if (!campaignId) return null;
  return frame.campaigns.find((c) => c.id === campaignId)?.key ?? campaignId;
}

/** Deals won for a campaign, learned in (fromDay, toDay]. null when a won deal has no known value. */
function wonBetween(frame: WorldView, campaignId: string, fromDay: number, toDay: number): { count: number; usd: number | null } {
  let count = 0;
  let usd: number | null = 0;
  for (const lead of frame.leads) {
    if (lead.campaignId !== campaignId) continue;
    for (const o of lead.outcomes) {
      if (o.stage !== "WON" || o.learnedDay <= fromDay || o.learnedDay > toDay) continue;
      count++;
      usd = o.valueUsd === undefined || usd === null ? null : usd + o.valueUsd;
    }
  }
  return { count, usd };
}

export interface BeliefLabel {
  day: number;
  version: number;
  text: string;
  num: string | null;
}

/** A few words per belief version, drawn on the Agent lane at the day it was recorded. */
export function beliefLabels(frame: WorldView): BeliefLabel[] {
  const out: BeliefLabel[] = [];
  let leanedBefore = false;
  let prevDay = -1;
  for (const b of frame.beliefs) {
    const k = key(frame, b.favors);
    let text = "Too early";
    let num: string | null = null;
    if (b.status === "INSUFFICIENT") {
      text = leanedBefore ? "Unsure" : "Too early";
    } else if (b.status === "LEANING") {
      text = `Leans ${k}`;
      num = pct(b.probability);
      leanedBefore = true;
    } else {
      const won = b.favors ? wonBetween(frame, b.favors, prevDay, b.day) : { count: 0, usd: null };
      if (won.count > 0) {
        text = won.usd === null ? `${k} won` : `${moneyShort(won.usd)} won`;
      } else {
        text = `${k} confirmed`;
        num = pct(b.probability);
      }
      leanedBefore = true;
    }
    out.push({ day: b.day, version: b.version, text, num });
    prevDay = b.day;
  }
  return out;
}

/** The readout under the graph: a probability and a short status. */
export function readout(frame: WorldView): { num: string | null; status: string } {
  const b: BeliefView | null = frame.currentBelief;
  if (!b) return { num: null, status: "Waiting for data" };
  const k = key(frame, b.favors);
  if (b.status === "INSUFFICIENT") {
    const leanedBefore = frame.beliefs.some((x) => x.status !== "INSUFFICIENT");
    return { num: null, status: leanedBefore ? "Unsure" : "Too early to tell" };
  }
  if (b.status === "LEANING") return { num: pct(b.probability), status: `Leaning ${k}` };
  return { num: pct(b.probability), status: `${k} confirmed` };
}
