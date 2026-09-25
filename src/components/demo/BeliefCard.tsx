"use client";

import { useState } from "react";
import type { BeliefView, LessonView, WorldView } from "@/contract";
import { beliefTone, campaignById, campaignKey, titleCase } from "./format";
import { useTicker } from "./hooks";

function StatusPill({ status }: { status: BeliefView["status"] }) {
  return (
    <span className={`lv-pill lv-pill--${beliefTone(status)} dm-status-pill`}>
      <span className="lv-dot" />
      {status}
    </span>
  );
}

function favorsLabel(world: WorldView, favors: string | null): string {
  if (!favors) return "No campaign favored";
  const c = campaignById(world, favors);
  return c ? `${c.key}: ${c.name}` : campaignKey(world, favors);
}

function Probability({ p }: { p: number | null }) {
  const shown = useTicker(p === null ? null : p * 100, 800);
  if (p === null || shown === null) {
    return (
      <div className="dm-prob dm-prob--none">
        <span className="dm-prob-num">Even</span>
      </div>
    );
  }
  return (
    <div className="dm-prob">
      <span className="dm-prob-num lv-num">
        {Math.round(shown)}
        <small>%</small>
      </span>
    </div>
  );
}

interface Props {
  world: WorldView;
}

export function BeliefCard({ world }: Props) {
  const beliefs = world.beliefs ?? [];
  const current = world.currentBelief;
  // A pinned older version is released whenever a new current version (or day) takes the stage.
  const resetKey = `${current?.version ?? "none"}-${world.asOfDay}`;
  const [pin, setPin] = useState<{ v: number; key: string } | null>(null);
  const pinned = pin && pin.key === resetKey ? pin.v : null;
  const setPinned = (v: number | null) => setPin(v === null ? null : { v, key: resetKey });

  const shown: BeliefView | null = (pinned !== null ? beliefs.find((b) => b.version === pinned) : null) ?? current ?? null;
  const isPinned = pinned !== null && shown !== null && shown.version !== current?.version;

  if (!shown) {
    return (
      <section className="dm-card dm-belief dm-belief--empty" aria-labelledby="dm-belief-h">
        <header className="dm-card-head">
          <h2 id="dm-belief-h" className="lv-eyebrow">
            Current belief
          </h2>
          <span className="lv-pill lv-pill--faint">
            <span className="lv-dot" />
            INSUFFICIENT
          </span>
        </header>
        <p className="dm-belief-statement">No belief recorded yet.</p>
        <p className="dm-belief-sub">
          The belief gate will not call a winner on zero evidence. It needs at least {world.policy?.minResolvedPerArmToLean ?? 1} resolved lead
          {(world.policy?.minResolvedPerArmToLean ?? 1) === 1 ? "" : "s"} per campaign and P at or above {world.policy?.leanAt ?? 0.75} before it leans.
        </p>
        <PolicyLine world={world} />
      </section>
    );
  }

  const changed = !!shown.revisedFrom;
  const favorsKey = shown.favors ? campaignKey(world, shown.favors) : null;

  return (
    <section className={`dm-card dm-belief dm-belief--${beliefTone(shown.status)}`} aria-labelledby="dm-belief-h" aria-live="polite">
      <header className="dm-card-head">
        <h2 id="dm-belief-h" className="lv-eyebrow">
          {isPinned ? `Belief v${shown.version}, recorded Day ${shown.day}` : `Current belief, v${shown.version}, recorded Day ${shown.day}`}
        </h2>
        <StatusPill status={shown.status} />
      </header>

      <div className="dm-belief-flip" key={`${shown.version}-${world.asOfDay}`}>
        <div className="dm-belief-top">
          <Probability p={shown.favors ? shown.probability : null} />
          <div className="dm-favors">
            <span className="dm-label">Favors</span>
            <span className={`dm-favors-name${favorsKey ? ` is-${favorsKey.toLowerCase()}` : ""}`}>{favorsLabel(world, shown.favors)}</span>
            <span className="dm-prob-cap">
              {shown.favors && shown.probability !== null
                ? "Probability this campaign yields more qualified leads per dollar"
                : "No campaign clears the bar yet"}
            </span>
          </div>
        </div>

        <p className="dm-belief-statement">{shown.statement}</p>

        {changed && shown.revisedFrom && (
          <div className="dm-diff">
            <div className="dm-diff-head">
              <span className="dm-label">Changed its mind</span>
              <span className="dm-diff-arrow">
                v{shown.revisedFrom.version} {titleCase(shown.revisedFrom.status)}
                {shown.revisedFrom.favors ? ` ${campaignKey(world, shown.revisedFrom.favors)}` : ""}
                <span aria-hidden="true"> to </span>
                <strong>
                  v{shown.version} {titleCase(shown.status)}
                  {favorsKey ? ` ${favorsKey}` : ""}
                </strong>
              </span>
            </div>
            <div className="dm-diff-before">
              <span className="dm-label">Before, v{shown.revisedFrom.version}</span>
              <p>{shown.revisedFrom.statement}</p>
            </div>
            {shown.changes && shown.changes.length > 0 && (
              <ul className="dm-changes" aria-label="What changed">
                {shown.changes.map((c, i) => (
                  <li key={c} style={{ ["--i" as string]: i }}>
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <dl className="dm-belief-grid">
          <div>
            <dt className="dm-label">Recommendation</dt>
            <dd>{shown.recommendation}</dd>
          </div>
          <div>
            <dt className="dm-label">Next test</dt>
            <dd>{shown.nextTest}</dd>
          </div>
        </dl>

        {shown.evidence?.length > 0 && (
          <div className="dm-evidence">
            <span className="dm-label">Evidence</span>
            <ul>
              {shown.evidence.map((e) => (
                <li key={`${e.eventId}-${e.day}`} className="dm-chip" title={e.eventId}>
                  <span className="dm-chip-day">Day {e.day}</span>
                  {e.label}
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>

      <footer className="dm-belief-foot">
        {beliefs.length > 0 && (
          <div className="dm-versions" role="group" aria-label="Belief versions">
            {beliefs.map((b) => {
              const active = b.version === shown.version;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`dm-version dm-version--${beliefTone(b.status)}${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setPinned(b.version === current?.version ? null : b.version)}
                  title={`v${b.version}, Day ${b.day}: ${b.status}${b.favors ? ` ${campaignKey(world, b.favors)}` : ""}`}
                >
                  <span className="dm-version-v">v{b.version}</span>
                  <span className="dm-version-d">
                    D{b.day} {b.favors ? campaignKey(world, b.favors) : "none"}
                  </span>
                </button>
              );
            })}
            {isPinned && (
              <button type="button" className="lv-btn lv-btn--quiet dm-version-back" onClick={() => setPinned(null)}>
                Back to current
              </button>
            )}
          </div>
        )}
        <PolicyLine world={world} belief={shown} />
      </footer>
    </section>
  );
}

function PolicyLine({ world, belief }: { world: WorldView; belief?: BeliefView }) {
  const p = world.policy;
  if (!p) return null;
  return (
    <p className="dm-policy lv-num">
      Policy v{belief?.policyVersion ?? p.version}: lean at P {p.leanAt} with {p.minResolvedPerArmToLean}+ resolved per campaign, support at P {p.supportAt} with{" "}
      {p.minResolvedPerArmToSupport}+. Rules v{belief?.rulesVersion ?? world.rules?.version}.
    </p>
  );
}

export function LessonCards({ lessons }: { lessons: LessonView[] }) {
  if (!lessons?.length) return null;
  return (
    <>
      {lessons.map((l) => (
        <section key={l.id} className="dm-card dm-lesson" aria-label="Lesson recorded">
          <header className="dm-card-head">
            <h3 className="dm-lesson-title">The agent corrected itself</h3>
            <span className="lv-pill lv-pill--gold lv-num">
              Policy v{l.policyFrom} to v{l.policyTo}
            </span>
          </header>
          <p className="dm-lesson-text">{l.text}</p>
          <div className="dm-lesson-meta">
            <span className="dm-label">Recorded Day {l.day}</span>
            {l.evidence?.length > 0 && (
              <ul>
                {l.evidence.map((e) => (
                  <li key={`${e.eventId}-${e.day}`} className="dm-chip">
                    <span className="dm-chip-day">Day {e.day}</span>
                    {e.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
