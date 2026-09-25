import type { BeliefStatus, CampaignView, CommitmentState, LeadStatus, ProviderStatus, WorldView } from "@/contract";

/** Money: null is Unknown, never $0. */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Unknown";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function moneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Unknown";
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${Math.round(n)}`;
}

export function usd2(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Unknown";
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
}

export function pct(p: number | null | undefined): string | null {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  return `${Math.round(p * 100)}%`;
}

export function dateLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function timeLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function campaignById(world: WorldView, id: string | null | undefined): CampaignView | undefined {
  if (!id) return undefined;
  return (world.campaigns ?? []).find((c) => c.id === id);
}

/** 'A' | 'B' | 'Unknown' for a campaign id (null = unknown attribution). */
export function campaignKey(world: WorldView, id: string | null | undefined): string {
  if (id === null || id === undefined || id === "unknown") return "Unknown";
  return campaignById(world, id)?.key ?? id;
}

export function laneColor(key: string): string {
  if (key === "A") return "var(--lv-a)";
  if (key === "B") return "var(--lv-b)";
  if (key === "Unknown") return "var(--lv-unknown)";
  return "var(--lv-cream)";
}

export function beliefTone(s: BeliefStatus | undefined): "faint" | "warn" | "ok" {
  if (s === "SUPPORTED") return "ok";
  if (s === "LEANING") return "warn";
  return "faint";
}

export function leadTone(s: LeadStatus): "ok" | "warn" | "bad" {
  if (s === "QUALIFIED") return "ok";
  if (s === "NOT_A_FIT") return "bad";
  return "warn";
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  QUALIFIED: "Qualified",
  UNRESOLVED: "Unresolved",
  NOT_A_FIT: "Not a fit",
};

export function commitmentTone(s: CommitmentState): "gold" | "ok" | "faint" | "bad" {
  if (s === "OPEN") return "gold";
  if (s === "KEPT") return "ok";
  if (s === "OVERDUE") return "bad";
  return "faint";
}

export function providerTone(s: ProviderStatus): "ok" | "gold" | "faint" | "bad" | "warn" {
  if (s === "LIVE") return "ok";
  if (s === "READY") return "gold";
  if (s === "ERROR") return "bad";
  if (s === "BLOCKED") return "warn";
  return "faint";
}

export const FIELD_LABEL: Record<string, string> = {
  budgetUsd: "Budget",
  timelineDays: "Timeline",
  decisionMaker: "Decision maker",
  problem: "Problem",
};

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function plural(n: number, one: string, many?: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many ?? `${one}s`}`;
}
