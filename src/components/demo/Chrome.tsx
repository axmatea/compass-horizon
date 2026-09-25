"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProviderName, RunView, WorldView } from "@/contract";
import { dateLabel, providerTone } from "./format";
import { StepTrack } from "./OpsPanels";

/* ---------------------------------------------------------------- top bar */

const PROVIDER_LABEL: Record<ProviderName, string> = { nimble: "Nimble", liquid: "Liquid", tinybird: "Tinybird" };
const PROVIDER_ROLE: Record<ProviderName, string> = {
  nimble: "Market evidence with sources",
  liquid: "Cheap cognition on every event",
  tinybird: "As-of metrics",
};

export function TopBar({ world, mock }: { world: WorldView | null; mock: boolean }) {
  const providers = world?.providers;
  return (
    <header className="dm-top">
      <div className="dm-top-left">
        <Link href="/" className="lv-wordmark dm-wordmark" aria-label="Longview home">
          Longview
        </Link>
        <span className="dm-honest" title="Leads, replies and spend are synthetic in this scenario">
          Demo data
        </span>
        <span className="dm-honest" title="The presenter advances the clock one beat at a time">
          Simulated clock
        </span>
        {mock && (
          <span className="dm-mock" title="NEXT_PUBLIC_LV_MOCK=1: the UI is running against a local mock, not the engine">
            Mock
          </span>
        )}
      </div>
      {world && (
        <div className="dm-clock" aria-live="polite">
          <span className="dm-clock-day lv-num">
            Day <strong>{world.clock.day}</strong> <span className="dm-clock-of">of {world.clock.horizonDays}</span>
          </span>
          <span className="dm-clock-date">{dateLabel(world.clock.iso)}</span>
        </div>
      )}
      <ul className="dm-providers" aria-label="Sponsor provider status">
        {(["nimble", "liquid", "tinybird"] as ProviderName[]).map((p) => {
          const info = providers?.[p];
          const status = info?.status;
          const id = `dm-prov-tip-${p}`;
          return (
            <li key={p} className="dm-prov-item">
              <button type="button" className="dm-prov-btn" aria-describedby={id}>
                <span className="dm-prov-name">{PROVIDER_LABEL[p]}</span>
                <span className={`lv-pill lv-pill--${status ? providerTone(status) : "faint"}`}>{status ?? "Checking"}</span>
              </button>
              <span role="tooltip" id={id} className="dm-tip">
                <strong>
                  {PROVIDER_LABEL[p]}: {PROVIDER_ROLE[p]}
                </strong>
                {info?.detail ?? "Status not loaded yet."}
                <em>LIVE only after a real successful call. Missing keys show BLOCKED.</em>
              </span>
            </li>
          );
        })}
      </ul>
    </header>
  );
}

/* ---------------------------------------------------------------- time travel banner */

export function TravelBanner({ world, onReturn, busy }: { world: WorldView; onReturn: () => void; busy: boolean }) {
  if (!world.isTimeTravel) return null;
  return (
    <div className="dm-travel" role="status">
      <div className="dm-travel-inner">
        <span className="dm-travel-dot" aria-hidden="true" />
        <p>
          <strong>Viewing Day {world.asOfDay} as the agent knew it.</strong> Everything below is re-projected from ledger events learned on or before Day{" "}
          {world.asOfDay}. The clock is still at Day {world.clock.day}.
        </p>
        <button type="button" className="lv-btn lv-btn--primary" onClick={onReturn} disabled={busy}>
          Return to now <kbd>End</kbd>
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- latest wake strip */

export function WakeStrip({ world, onResume, busy }: { world: WorldView; onResume: () => void; busy: boolean }) {
  const run: RunView | undefined = world.runs?.[0];
  if (!run) {
    return (
      <div className="dm-wake is-empty">
        <span className="lv-eyebrow">Latest wake</span>
        <span className="dm-wake-msg">No wake has run yet. Press Next beat to launch Day 0.</span>
      </div>
    );
  }
  const interrupted = run.state === "INTERRUPTED";
  const lastDone = [...run.steps].reverse().find((s) => s.state === "DONE");
  const performed = run.effects.filter((e) => e.state === "PERFORMED").length;
  const skipped = run.effects.filter((e) => e.state === "SKIPPED_DUPLICATE").length;
  return (
    <div className={`dm-wake is-${run.state.toLowerCase()}`}>
      <div className="dm-wake-label">
        <span className="lv-eyebrow">Latest wake</span>
        <span className="dm-wake-title lv-num">
          Day {run.day}, {run.trigger === "RESUME" ? "resumed run" : `${run.trigger.toLowerCase()} run`}
        </span>
      </div>
      <div className="dm-wake-track">
        <StepTrack run={run} big />
      </div>
      <div className="dm-wake-side">
        {interrupted ? (
          <>
            <p className="dm-wake-alert">
              <strong>Worker died mid-run.</strong> Ledger intact after step {lastDone?.n ?? 0}.
            </p>
            {!world.isTimeTravel && (
              <button type="button" className="lv-btn lv-btn--primary" onClick={onResume} disabled={busy}>
                Resume
              </button>
            )}
          </>
        ) : (
          <p className="dm-wake-msg lv-num">
            {run.resumedFromStep !== undefined ? `Resumed at step ${run.resumedFromStep}. ` : ""}
            {performed} effect{performed === 1 ? "" : "s"} performed{skipped ? `, ${skipped} skipped as duplicate${skipped === 1 ? "" : "s"}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- stage bar */

interface StageProps {
  world: WorldView;
  busy: string | null;
  canPlug: boolean;
  canResume: boolean;
  onNext: () => void;
  onPlug: () => void;
  onResume: () => void;
  onReplay: () => void;
  onReset: () => void;
}

export function StageBar({ world, busy, canPlug, canResume, onNext, onPlug, onResume, onReplay, onReset }: StageProps) {
  const st = world.stage;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);
  const travel = world.isTimeTravel;
  const nextDisabled = !!busy || !st?.nextLabel || canResume || travel;
  return (
    <div className="dm-stage" role="region" aria-label="Stage controls">
      <div className="dm-stage-inner">
        <div className="dm-stage-text">
          {st ? (
            <>
              <div className="dm-stage-meta">
                <span className="lv-eyebrow lv-num">
                  Beat {st.beat + 1} of {st.totalBeats}
                </span>
                <ol className="dm-dots" aria-label={`Beat ${st.beat + 1} of ${st.totalBeats}`}>
                  {Array.from({ length: st.totalBeats }, (_, i) => (
                    <li key={i} className={i < st.beat ? "is-done" : i === st.beat ? "is-current" : undefined} />
                  ))}
                </ol>
              </div>
              <p className="dm-stage-title">{st.title}</p>
              <p className="dm-stage-caption">{st.caption}</p>
            </>
          ) : (
            <p className="dm-stage-title">Live workspace</p>
          )}
        </div>
        <div className="dm-stage-actions">
          <button type="button" className="lv-btn lv-btn--quiet" onClick={onReplay} disabled={!!busy || travel} title="Re-send the last webhook with the same externalId (R)">
            Replay webhook <kbd>R</kbd>
          </button>
          {canResume ? (
            <button type="button" className="lv-btn lv-btn--primary dm-resume-btn" onClick={onResume} disabled={!!busy || travel}>
              {busy === "wake" ? "Resuming" : "Resume run"}
            </button>
          ) : (
            <button type="button" className="lv-btn lv-btn--danger" onClick={onPlug} disabled={!!busy || !canPlug || travel} title="Arm chaos: the next run dies after step 3 (P)">
              {busy === "chaos" ? "Pulling the plug" : "Pull the plug"} <kbd>P</kbd>
            </button>
          )}
          {confirming ? (
            <span className="dm-confirm" role="group" aria-label="Confirm reset">
              <button
                type="button"
                className="lv-btn lv-btn--danger"
                onClick={() => {
                  setConfirming(false);
                  onReset();
                }}
                autoFocus
              >
                Confirm reset
              </button>
              <button type="button" className="lv-btn lv-btn--quiet" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="lv-btn lv-btn--quiet" onClick={() => setConfirming(true)} disabled={!!busy}>
              Reset
            </button>
          )}
          <button type="button" className="lv-btn lv-btn--primary dm-next-btn" onClick={onNext} disabled={nextDisabled} aria-keyshortcuts="ArrowRight Space">
            {busy === "beat" ? "Agent is waking" : st?.nextLabel ?? "End of demo"}
            <kbd aria-hidden="true">&rarr;</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

export interface Toast {
  id: number;
  tone: "ok" | "bad" | "gold" | "info";
  title: string;
  body?: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="dm-toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={`dm-toast is-${t.tone}`} role={t.tone === "bad" ? "alert" : "status"}>
          <div>
            <strong>{t.title}</strong>
            {t.body && <p>{t.body}</p>}
          </div>
          <button type="button" className="dm-toast-x" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
