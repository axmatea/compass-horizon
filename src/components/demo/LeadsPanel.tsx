"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValue, LeadStatus, LeadView, WorldView } from "@/contract";
import { campaignById, campaignKey, FIELD_LABEL, LEAD_STATUS_LABEL, laneColor, leadTone, money, titleCase } from "./format";

type CampFilter = "all" | string;
type StatusFilter = "all" | LeadStatus;

function CampChip({ world, id }: { world: WorldView; id: string | null }) {
  const key = campaignKey(world, id);
  return (
    <span className="dm-camp-chip" style={{ color: laneColor(key), borderColor: laneColor(key) }} title={id === null ? "Unknown attribution" : campaignById(world, id)?.name}>
      {key === "Unknown" ? "?" : key}
    </span>
  );
}

export function LeadsPanel({ world, onOpen, openId }: { world: WorldView; onOpen: (id: string, el: HTMLElement) => void; openId: string | null }) {
  const [camp, setCamp] = useState<CampFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const leads = useMemo(() => world.leads ?? [], [world.leads]);
  const campaigns = world.campaigns ?? [];

  const filtered = useMemo(() => {
    return leads
      .filter((l) => (camp === "all" ? true : camp === "unknown" ? l.campaignId === null : l.campaignId === camp))
      .filter((l) => (status === "all" ? true : l.status === status))
      .slice()
      .sort((a, b) => {
        const rank = (s: LeadStatus) => (s === "QUALIFIED" ? 0 : s === "UNRESOLVED" ? 1 : 2);
        return rank(a.status) - rank(b.status) || b.capturedDay - a.capturedDay || a.name.localeCompare(b.name);
      });
  }, [leads, camp, status]);

  const counts = {
    QUALIFIED: leads.filter((l) => l.status === "QUALIFIED").length,
    UNRESOLVED: leads.filter((l) => l.status === "UNRESOLVED").length,
    NOT_A_FIT: leads.filter((l) => l.status === "NOT_A_FIT").length,
  };

  return (
    <section className="dm-card dm-leads" aria-labelledby="dm-leads-h">
      <header className="dm-card-head dm-card-head--wrap">
        <div>
          <h2 id="dm-leads-h" className="dm-card-title">
            Leads
          </h2>
          <p className="dm-card-sub lv-num">
            {leads.length} captured: {counts.QUALIFIED} qualified, {counts.UNRESOLVED} unresolved, {counts.NOT_A_FIT} not a fit
          </p>
        </div>
        <div className="dm-filters">
          <div className="dm-seg" role="group" aria-label="Filter by campaign">
            {[{ id: "all", label: "All" }, ...campaigns.map((c) => ({ id: c.id, label: c.key })), { id: "unknown", label: "Unknown" }].map((f) => (
              <button key={f.id} type="button" aria-pressed={camp === f.id} className={camp === f.id ? "is-on" : undefined} onClick={() => setCamp(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="dm-seg" role="group" aria-label="Filter by status">
            {(["all", "QUALIFIED", "UNRESOLVED", "NOT_A_FIT"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} className={status === s ? "is-on" : undefined} onClick={() => setStatus(s)}>
                {s === "all" ? "Any status" : LEAD_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </header>
      {filtered.length === 0 ? (
        <p className="dm-empty">{leads.length === 0 ? "No leads yet. Campaigns just launched." : "No leads match these filters."}</p>
      ) : (
        <ul className="dm-lead-list">
          {filtered.map((l) => (
            <li key={l.id}>
              <button type="button" className={`dm-lead-row${openId === l.id ? " is-open" : ""}`} onClick={(e) => onOpen(l.id, e.currentTarget)} aria-haspopup="dialog">
                <CampChip world={world} id={l.campaignId} />
                <span className="dm-lead-who">
                  <strong>{l.name}</strong>
                  <span>
                    {l.role}, {l.company}
                  </span>
                </span>
                <span className="dm-lead-missing">
                  {l.status === "UNRESOLVED" && l.missing.length > 0 ? `Missing ${l.missing.map((m) => FIELD_LABEL[m]?.toLowerCase() ?? m).join(", ")}` : l.status === "QUALIFIED" ? money(l.fields.budgetUsd.value) : (l.reasons[0] ?? "")}
                </span>
                <span className={`lv-pill lv-pill--${leadTone(l.status)}`}>{LEAD_STATUS_LABEL[l.status]}</span>
                <span className="dm-lead-day lv-num">Day {l.capturedDay}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fieldValue(key: string, f: FieldValue<unknown>): string {
  if (f.status === "UNKNOWN" || f.value === null || f.value === undefined) return "Unknown";
  if (key === "budgetUsd") return money(f.value as number);
  if (key === "timelineDays") return `${f.value} days`;
  if (key === "decisionMaker") return f.value ? "Yes" : "No";
  return String(f.value);
}

export function LeadDrawer({ world, lead, onClose }: { world: WorldView; lead: LeadView | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!lead) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead) return null;
  const key = campaignKey(world, lead.campaignId);
  const camp = campaignById(world, lead.campaignId);
  const fields = (["budgetUsd", "timelineDays", "decisionMaker", "problem"] as const).map((k) => ({ k, f: lead.fields?.[k] as FieldValue<unknown> | undefined }));

  return (
    <div className="dm-drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dm-drawer" role="dialog" aria-modal="true" aria-labelledby="dm-drawer-h" ref={panelRef}>
        <header className="dm-drawer-head">
          <div>
            <p className="lv-eyebrow lv-num">
              {`${key === "Unknown" ? "Unknown attribution" : `Campaign ${key}: ${camp?.name ?? ""}`}, captured Day ${lead.capturedDay}`}
            </p>
            <h2 id="dm-drawer-h" className="dm-drawer-title">
              {lead.name}
            </h2>
            <p className="dm-card-sub">
              {lead.role}, {lead.company}
            </p>
          </div>
          <button ref={closeRef} type="button" className="lv-btn lv-btn--quiet dm-drawer-close" onClick={onClose} aria-label="Close lead details">
            Close <kbd>Esc</kbd>
          </button>
        </header>

        <div className="dm-drawer-body">
          <div className="dm-drawer-status">
            <span className={`lv-pill lv-pill--${leadTone(lead.status)}`}>
              <span className="lv-dot" />
              {LEAD_STATUS_LABEL[lead.status]}
            </span>
            <span className="dm-card-sub lv-num">Rules v{lead.rulesVersion}</span>
          </div>
          {lead.reasons?.length > 0 && (
            <ul className="dm-reasons">
              {lead.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          <h3 className="dm-label dm-drawer-sec">Fields and provenance</h3>
          <dl className="dm-fields">
            {fields.map(({ k, f }) => {
              const known = f && f.status === "CONFIRMED" && f.value !== null;
              return (
                <div key={k} className={known ? "is-known" : "is-unknown"}>
                  <dt>{FIELD_LABEL[k]}</dt>
                  <dd>
                    <span className="dm-field-val">{f ? fieldValue(k, f) : "Unknown"}</span>
                    {known && f?.source ? (
                      <span className="dm-prov">
                        <span className="dm-prov-chip">
                          Confirmed, Day {f.source.day}, {f.source.provider === "rules" ? "rules extractor" : f.source.provider === "liquid" ? "Liquid" : "form"}
                        </span>
                        {f.source.quote && f.source.quote !== String(f.value) && <q className="dm-quote">{f.source.quote}</q>}
                      </span>
                    ) : (
                      <span className="dm-prov">
                        <span className="dm-prov-chip is-unknown">Unknown</span>
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          {lead.missing?.length > 0 && (
            <p className="dm-missing">
              <span className="dm-label">Missing</span> {lead.missing.map((m) => FIELD_LABEL[m] ?? m).join(", ")}
            </p>
          )}

          {lead.nextQuestion && (
            <div className="dm-draft">
              <span className="dm-draft-label">Draft, not sent</span>
              <p>{lead.nextQuestion}</p>
            </div>
          )}

          {lead.outcomes?.length > 0 && (
            <>
              <h3 className="dm-label dm-drawer-sec">Outcomes</h3>
              <ol className="dm-outcomes">
                {lead.outcomes.map((o, i) => (
                  <li key={`${o.stage}-${i}`}>
                    <strong>{titleCase(o.stage)}</strong>
                    <span className="lv-num">Day {o.day}</span>
                    {o.learnedDay > o.day && <span className="lv-pill lv-pill--gold lv-num">Learned late, Day {o.learnedDay}</span>}
                    {o.valueUsd !== undefined && <span className="lv-num dm-outcome-val">{money(o.valueUsd)}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}

          {lead.messages?.length > 0 && (
            <>
              <h3 className="dm-label dm-drawer-sec">Messages</h3>
              <ol className="dm-thread">
                {lead.messages.map((m, i) => (
                  <li key={i} className={m.from === "agent-draft" ? "is-draft" : "is-lead"}>
                    <span className="dm-msg-meta lv-num">
                      {m.from === "agent-draft" ? "Agent draft, not sent" : lead.name.split(" ")[0]}, Day {m.day}
                    </span>
                    <p>{m.text}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="dm-drawer-foot">Longview drafts questions. It never sends email or messages on its own.</p>
        </div>
      </div>
    </div>
  );
}
