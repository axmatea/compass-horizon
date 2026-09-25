"use client";

import type { CampaignView, WorldView } from "@/contract";
import { laneColor, money, plural } from "./format";
import { useTicker } from "./hooks";

export function Num({ value, format = money, className }: { value: number | null | undefined; format?: (n: number | null) => string; className?: string }) {
  const shown = useTicker(value ?? null);
  return <span className={`lv-num${className ? ` ${className}` : ""}`}>{format(shown === null ? null : shown)}</span>;
}

const count = (n: number | null) => (n === null ? "Unknown" : Math.round(n).toLocaleString("en-US"));

function AdMock({ c }: { c: CampaignView }) {
  return (
    <figure className="dm-ad" aria-label={`Ad creative for campaign ${c.key}`}>
      <div className="dm-ad-top">
        <span className="dm-ad-avatar" aria-hidden="true">
          AI
        </span>
        <span className="dm-ad-brand">
          AI Media Global
          <small>Sponsored</small>
        </span>
      </div>
      <p className="dm-ad-body">{c.creative?.body}</p>
      <div className={`dm-ad-visual is-${c.key.toLowerCase()}`} aria-hidden="true">
        <span>{c.creative?.headline}</span>
      </div>
      <div className="dm-ad-cta">
        <span className="dm-ad-offer">{c.offer}</span>
        <span className="dm-ad-btn">{c.creative?.cta}</span>
      </div>
    </figure>
  );
}

function CampaignCard({ c, leader }: { c: CampaignView; leader: { cpl: boolean; cpq: boolean } }) {
  return (
    <article className={`dm-card dm-campaign is-${c.key.toLowerCase()}`} aria-labelledby={`dm-c-${c.id}`}>
      <header className="dm-campaign-head">
        <span className="dm-key" style={{ color: laneColor(c.key), borderColor: laneColor(c.key) }}>
          {c.key}
        </span>
        <div>
          <h3 id={`dm-c-${c.id}`} className="dm-campaign-name">
            {c.name}
          </h3>
          <p className="dm-card-sub">{c.audience}</p>
        </div>
      </header>
      <AdMock c={c} />
      <div className="dm-duo">
        <div className={`dm-duo-cell${leader.cpl ? " is-lead" : ""}`}>
          <span className="dm-label">Cost per lead</span>
          <Num value={c.cplUsd} className="dm-duo-num" />
          <span className="dm-duo-cap">What the ad dashboard sees{leader.cpl ? ", cheaper" : ""}</span>
        </div>
        <div className={`dm-duo-cell is-truth${leader.cpq ? " is-lead" : ""}`}>
          <span className="dm-label">Cost per qualified</span>
          <Num value={c.costPerQualifiedUsd} className="dm-duo-num" />
          <span className="dm-duo-cap">What Longview waits for{leader.cpq ? ", cheaper" : ""}</span>
        </div>
      </div>
      <dl className="dm-metrics">
        <div>
          <dt>Spend</dt>
          <dd>
            <Num value={c.spendUsd} />
          </dd>
        </div>
        <div>
          <dt>Leads</dt>
          <dd>
            <Num value={c.leads} format={count} />
          </dd>
        </div>
        <div>
          <dt>Qualified</dt>
          <dd>
            <Num value={c.qualified} format={count} />
            <small className="lv-num">
              {" "}
              / {c.unresolved} open / {c.notAFit} no fit
            </small>
          </dd>
        </div>
        <div>
          <dt>Calls booked</dt>
          <dd>
            <Num value={c.callsBooked} format={count} />
          </dd>
        </div>
        <div>
          <dt>Pipeline</dt>
          <dd>
            <Num value={c.pipelineUsd} />
          </dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd className={c.wonUsd > 0 ? "is-won" : undefined}>
            <Num value={c.wonUsd} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function CampaignCards({ world }: { world: WorldView }) {
  const cs = world.campaigns ?? [];
  const minCpl = Math.min(...cs.map((c) => c.cplUsd ?? Infinity));
  const minCpq = Math.min(...cs.map((c) => c.costPerQualifiedUsd ?? Infinity));
  const u = world.unknownAttribution ?? { leads: 0, qualified: 0 };
  return (
    <div className="dm-campaigns">
      {cs.map((c) => (
        <CampaignCard
          key={c.id}
          c={c}
          leader={{
            cpl: cs.length > 1 && c.cplUsd !== null && c.cplUsd === minCpl,
            cpq: cs.length > 1 && c.costPerQualifiedUsd !== null && c.costPerQualifiedUsd === minCpq,
          }}
        />
      ))}
      <aside className="dm-card dm-unknown" aria-labelledby="dm-unknown-h">
        <header className="dm-campaign-head">
          <span className="dm-key" style={{ color: laneColor("Unknown"), borderColor: laneColor("Unknown") }}>
            ?
          </span>
          <div>
            <h3 id="dm-unknown-h" className="dm-campaign-name">
              Unknown attribution
            </h3>
            <p className="dm-card-sub">No UTM, no click id. Kept separate.</p>
          </div>
        </header>
        <div className="dm-unknown-nums">
          <div>
            <Num value={u.leads} format={count} className="dm-duo-num" />
            <span className="dm-label">{u.leads === 1 ? "Lead" : "Leads"}</span>
          </div>
          <div>
            <Num value={u.qualified} format={count} className="dm-duo-num" />
            <span className="dm-label">Qualified</span>
          </div>
        </div>
        <p className="dm-unknown-note">
          Never credited to A or B. Longview does not guess attribution, so {plural(u.leads, "lead")} stay{u.leads === 1 ? "s" : ""} in this bucket and out of every cost per
          qualified lead.
        </p>
      </aside>
    </div>
  );
}
