"use client";

import { useState } from "react";
import type { CommitmentState, CommitmentView, RunView, WorldView } from "@/contract";
import { campaignKey, commitmentTone, providerTone, timeLabel, titleCase, usd2 } from "./format";
import { Num } from "./CampaignCards";

/* ---------------------------------------------------------------- commitments */

const STATE_ORDER: CommitmentState[] = ["OVERDUE", "OPEN", "KEPT", "CANCELLED"];

export function CommitmentsPanel({ world }: { world: WorldView }) {
  const all = world.commitments ?? [];
  const [filter, setFilter] = useState<CommitmentState | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, all.filter((c) => c.state === s).length])) as Record<CommitmentState, number>;
  const sorted = all
    .filter((c) => filter === "all" || c.state === filter)
    .slice()
    .sort((a, b) => {
      const ra = STATE_ORDER.indexOf(a.state);
      const rb = STATE_ORDER.indexOf(b.state);
      if (ra !== rb) return ra - rb;
      if (a.state === "KEPT" || a.state === "CANCELLED") return (b.keptDay ?? b.dueDay) - (a.keptDay ?? a.dueDay);
      return a.dueDay - b.dueDay;
    });
  const limit = expanded ? sorted.length : 7;
  return (
    <section className="dm-card dm-commitments" aria-labelledby="dm-cmt-h">
      <header className="dm-card-head dm-card-head--wrap">
        <div>
          <h2 id="dm-cmt-h" className="dm-card-title">
            Commitments
          </h2>
          <p className="dm-card-sub">Promises the agent made to its future self, and kept.</p>
        </div>
        <div className="dm-seg" role="group" aria-label="Filter commitments">
          <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "is-on" : undefined} onClick={() => setFilter("all")}>
            All <span className="lv-num">{all.length}</span>
          </button>
          {STATE_ORDER.map((s) => (
            <button key={s} type="button" aria-pressed={filter === s} className={filter === s ? "is-on" : undefined} onClick={() => setFilter(s)}>
              {titleCase(s)} <span className="lv-num">{counts[s]}</span>
            </button>
          ))}
        </div>
      </header>
      {sorted.length === 0 ? (
        <p className="dm-empty">{all.length ? "None in this state." : "No commitments yet. The agent books its first follow-ups at its next wake."}</p>
      ) : (
        <ul className="dm-cmt-list">
          {sorted.slice(0, limit).map((c) => (
            <CommitmentRow key={c.id} c={c} world={world} />
          ))}
        </ul>
      )}
      {sorted.length > 7 && (
        <button type="button" className="lv-btn lv-btn--quiet dm-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  );
}

function CommitmentRow({ c, world }: { c: CommitmentView; world: WorldView }) {
  const lead = c.leadId ? world.leads?.find((l) => l.id === c.leadId) : undefined;
  const when =
    c.state === "KEPT" && c.keptDay !== undefined
      ? `Kept Day ${c.keptDay}`
      : c.state === "CANCELLED"
        ? `Was due Day ${c.dueDay}`
        : c.state === "OVERDUE"
          ? `Overdue since Day ${c.dueDay}`
          : `Due Day ${c.dueDay}`;
  return (
    <li className={`dm-cmt is-${c.state.toLowerCase()}`}>
      <div className="dm-cmt-main">
        <span className="dm-cmt-kind">
          {titleCase(c.kind)}
          {lead ? `, ${campaignKey(world, lead.campaignId)}` : ""}
        </span>
        <span className="dm-cmt-title">{c.title}</span>
        <span className="dm-cmt-reason">{c.reason}</span>
      </div>
      <div className="dm-cmt-side">
        <span className={`lv-pill lv-pill--${commitmentTone(c.state)}`}>{titleCase(c.state)}</span>
        <span className="dm-cmt-when lv-num">{when}</span>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- runs */

export function StepTrack({ run, big = false }: { run: RunView; big?: boolean }) {
  return (
    <ol className={`dm-steps${big ? " is-big" : ""}`} aria-label={`Run steps for Day ${run.day}`}>
      {run.steps.map((s) => (
        <li key={s.n} className={`dm-step is-${s.state.toLowerCase()}`} title={`${s.n}. ${s.name}: ${s.state.replace(/_/g, " ").toLowerCase()}${s.summary ? `. ${s.summary}` : ""}`}>
          <span className="dm-step-bar" />
          <span className="dm-step-name">
            <span className="lv-num">{s.n}</span> {s.name}
          </span>
          <span className="lv-sr-only">{s.state.replace(/_/g, " ").toLowerCase()}</span>
        </li>
      ))}
    </ol>
  );
}

function runTone(r: RunView) {
  return r.state === "INTERRUPTED" ? "bad" : r.state === "RUNNING" ? "gold" : "ok";
}

function RunCard({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false);
  const performed = run.effects.filter((e) => e.state === "PERFORMED").length;
  const skipped = run.effects.filter((e) => e.state === "SKIPPED_DUPLICATE").length;
  const lastDone = [...run.steps].reverse().find((s) => s.state === "DONE");
  const effects = open ? run.effects : run.effects.slice(0, 4);
  return (
    <li className={`dm-run is-${run.state.toLowerCase()}`}>
      <div className="dm-run-head">
        <span className="dm-run-title lv-num">
          Day {run.day} wake <span className="dm-run-trigger">{titleCase(run.trigger)}</span>
        </span>
        <span className={`lv-pill lv-pill--${runTone(run)}`}>
          <span className="lv-dot" />
          {run.state}
        </span>
      </div>
      {run.state === "INTERRUPTED" && (
        <p className="dm-run-alert">Worker died after step {lastDone?.n ?? 0}. Ledger intact. Resume continues from step {(lastDone?.n ?? 0) + 1}.</p>
      )}
      {run.resumedFromStep !== undefined && (
        <p className="dm-run-resumed lv-num">
          Resumed from step {run.resumedFromStep}. Steps 1 to {run.resumedFromStep - 1} were already checkpointed and skipped.
        </p>
      )}
      <StepTrack run={run} />
      <div className="dm-run-foot lv-num">
        <span>
          {performed} effect{performed === 1 ? "" : "s"} performed
          {skipped ? `, ${skipped} skipped as duplicate${skipped === 1 ? "" : "s"}` : ""}
        </span>
        <span>Cognition {usd2(run.costUsd)}</span>
      </div>
      {run.effects.length > 0 && (
        <ul className="dm-effects">
          {effects.map((e) => (
            <li key={e.key} className={`is-${e.state.toLowerCase()}`}>
              <code title={e.key}>{e.key}</code>
              <span className="dm-effect-kind">{titleCase(e.kind)}</span>
              <span className={`lv-pill lv-pill--${e.state === "PERFORMED" ? "ok" : "gold"}`}>{e.state === "PERFORMED" ? "Performed" : "Skipped duplicate"}</span>
            </li>
          ))}
        </ul>
      )}
      {run.effects.length > 4 && (
        <button type="button" className="lv-btn lv-btn--quiet dm-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Fewer effects" : `All ${run.effects.length} effects`}
        </button>
      )}
    </li>
  );
}

export function RunsPanel({ world }: { world: WorldView }) {
  const runs = world.runs ?? [];
  const [all, setAll] = useState(false);
  const list = all ? runs : runs.slice(0, 3);
  return (
    <section className="dm-card dm-runs" aria-labelledby="dm-runs-h">
      <header className="dm-card-head">
        <div>
          <h2 id="dm-runs-h" className="dm-card-title">
            Runs
          </h2>
          <p className="dm-card-sub">Every wake is 7 checkpointed steps. Effects carry deterministic keys, so nothing happens twice.</p>
        </div>
      </header>
      {runs.length === 0 ? (
        <p className="dm-empty">No runs yet.</p>
      ) : (
        <ul className="dm-run-list">
          {list.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </ul>
      )}
      {runs.length > 3 && (
        <button type="button" className="lv-btn lv-btn--quiet dm-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show recent runs" : `Show all ${runs.length} runs`}
        </button>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- receipts + market */

export function ReceiptsPanel({ world }: { world: WorldView }) {
  const receipts = world.receipts ?? [];
  const market = world.market ?? [];
  const [all, setAll] = useState(false);
  const list = all ? receipts : receipts.slice(0, 6);
  return (
    <section className="dm-card dm-receipts" aria-labelledby="dm-rc-h">
      <header className="dm-card-head">
        <div>
          <h2 id="dm-rc-h" className="dm-card-title">
            Receipts
          </h2>
          <p className="dm-card-sub">Every sponsor call, attempted or blocked. No tokens, no personal data.</p>
        </div>
      </header>
      {receipts.length === 0 ? (
        <p className="dm-empty">No provider calls yet.</p>
      ) : (
        <ul className="dm-rc-list">
          {list.map((r) => (
            <li key={r.id}>
              <span className="dm-rc-provider">{titleCase(r.provider)}</span>
              <code>{r.operation}</code>
              <span className={`lv-pill lv-pill--${providerTone(r.status)}`}>{r.status}</span>
              <span className="dm-rc-meta lv-num">
                Day {r.day}
                {r.latencyMs !== undefined ? `, ${r.latencyMs} ms` : ""}
                {r.model ? `, ${r.model}` : ""}
                {r.wallTime ? `, ${timeLabel(r.wallTime)}` : ""}
              </span>
              {r.note && <span className="dm-rc-note">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {receipts.length > 6 && (
        <button type="button" className="lv-btn lv-btn--quiet dm-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${receipts.length}`}
        </button>
      )}

      <h3 className="dm-label dm-sub-h">Market evidence</h3>
      {market.length === 0 ? (
        <p className="dm-empty">No market scan yet.</p>
      ) : (
        <ul className="dm-market">
          {market.map((m) => (
            <li key={m.id}>
              <div className="dm-market-head">
                <span className="lv-num">
                  {campaignKey(world, m.campaignId)}, Day {m.day}
                </span>
                <span className={`lv-pill lv-pill--${providerTone(m.status)}`}>{m.status}</span>
              </div>
              <p className="dm-market-q">&ldquo;{m.query}&rdquo;</p>
              {m.sources.length === 0 ? (
                <p className="dm-market-none">No sources. {m.status === "BLOCKED" ? "Nimble is blocked here, and Longview never invents sources." : "Nothing returned."}</p>
              ) : (
                <ul className="dm-sources">
                  {m.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                      <span>{s.fact}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- stats */

export function StatsRow({ world }: { world: WorldView }) {
  const s = world.stats ?? { events: 0, duplicatesIgnored: 0, lateEvents: 0, effectsPerformed: 0, effectsSkipped: 0, cognitionCostUsd: 0 };
  const int = (n: number | null) => (n === null ? "Unknown" : Math.round(n).toLocaleString("en-US"));
  const items: { label: string; value: number; fmt: (n: number | null) => string; note?: string }[] = [
    { label: "Ledger events", value: s.events, fmt: int },
    { label: "Duplicates ignored", value: s.duplicatesIgnored, fmt: int },
    { label: "Late events", value: s.lateEvents, fmt: int },
    { label: "Effects performed", value: s.effectsPerformed, fmt: int },
    { label: "Effects skipped", value: s.effectsSkipped, fmt: int, note: "duplicates" },
    { label: "Cognition spend", value: s.cognitionCostUsd, fmt: usd2, note: world.providers?.liquid?.status === "LIVE" ? "real calls" : "rules fallback" },
  ];
  return (
    <dl className="dm-stats">
      {items.map((it) => (
        <div key={it.label}>
          <dt>{it.label}</dt>
          <dd>
            <Num value={it.value} format={it.fmt} />
            {it.note && <small>{it.note}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
