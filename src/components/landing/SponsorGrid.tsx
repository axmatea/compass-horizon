"use client";

import { useEffect, useState } from "react";
import type { HealthResponse, ProviderName, ProviderStatus } from "@/contract";
import { api, errorMessage } from "@/lib/client/api";

interface Sponsor {
  key: ProviderName;
  name: string;
  role: string;
  body: string;
}

const SPONSORS: Sponsor[] = [
  {
    key: "nimble",
    name: "Nimble",
    role: "Market evidence with sources",
    body: "Searches the public web for competitor offers per hypothesis and stores the title, url, fetched time and one fact for every source.",
  },
  {
    key: "liquid",
    name: "Liquid AI",
    role: "Cheap cognition on every event",
    body: "Extracts budget, timeline, decision maker and problem from each reply, with the quotes that support every field.",
  },
  {
    key: "tinybird",
    name: "Tinybird",
    role: "As-of metrics",
    body: "Mirrors the ledger and answers experiment metrics as of any day, so the past is queried the way it was known.",
  },
];

const PILL: Record<ProviderStatus, string> = {
  LIVE: "lv-pill lv-pill--ok",
  READY: "lv-pill lv-pill--gold",
  BLOCKED: "lv-pill lv-pill--faint",
  FIXTURE: "lv-pill lv-pill--faint",
  ERROR: "lv-pill lv-pill--bad",
};

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

export function SponsorGrid() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    api.health().then(
      (health) => {
        if (alive) setState({ kind: "ok", health });
      },
      (err: unknown) => {
        if (alive) setState({ kind: "error", message: errorMessage(err) });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="ld-sponsors">
      <ul className="ld-sponsor-grid">
        {SPONSORS.map((s) => (
          <li key={s.key} className="ld-sponsor">
            <p className="ld-sponsor-name">{s.name}</p>
            <h3 className="ld-sponsor-role">{s.role}</h3>
            <p className="ld-sponsor-body">{s.body}</p>
            <div className="ld-sponsor-status" aria-live="polite">
              <StatusLine sponsor={s} state={state} />
            </div>
          </li>
        ))}
      </ul>
      <div className="ld-sponsor-foot">
        <p className="ld-note">LIVE appears only after a real successful call. Missing keys show BLOCKED.</p>
        {state.kind === "ok" ? (
          <p className="ld-note ld-note--db">
            Ledger database{" "}
            <span className={state.health.db === "ready" ? "lv-pill lv-pill--ok" : "lv-pill lv-pill--faint"}>
              <span className="lv-dot" aria-hidden="true" />
              {state.health.db === "ready" ? "Ready" : "Blocked"}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StatusLine({ sponsor, state }: { sponsor: Sponsor; state: HealthState }) {
  if (state.kind === "loading") {
    return (
      <p className="ld-status ld-status--loading">
        <span className="ld-status-pulse" aria-hidden="true" />
        Checking status
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="ld-status ld-status--error">
        <span className="ld-status-label">Status unavailable</span>
        <span className="ld-status-detail">{state.message}</span>
      </p>
    );
  }
  const p = state.health.providers?.[sponsor.key];
  if (!p || !p.status || !(p.status in PILL)) {
    return (
      <p className="ld-status ld-status--error">
        <span className="ld-status-label">Status unavailable</span>
        <span className="ld-status-detail">The health check did not report this adapter.</span>
      </p>
    );
  }
  return (
    <p className="ld-status">
      <span className={PILL[p.status]}>
        <span className="lv-dot" aria-hidden="true" />
        {p.status}
      </span>
      {p.detail ? <span className="ld-status-detail">{p.detail}</span> : null}
    </p>
  );
}
