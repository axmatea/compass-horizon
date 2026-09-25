import { useDeferredValue, useState } from "react";
import { money } from "./demo";
import type {
  AnswerInput,
  AnswerOutcome,
  Lead,
  ServiceStatus,
  State,
  Tab,
} from "./types";
import {
  AsyncForm,
  Creative,
  EmptyState,
  Icon,
  QualificationBadge,
  value,
} from "./ui";
import { ProposalReview } from "./ProposalReview";

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
function PanelTitle({
  number,
  title,
  action,
}: {
  number?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>
        {number && <span className="section-number">{number}</span>}
        {title}
      </h2>
      {action}
    </div>
  );
}
export function Stats({ state }: { state: State }) {
  return (
    <div className="stats-grid" aria-label="Pipeline metrics">
      {[
        {
          label: "Total leads",
          count: state.metrics.totalLeads,
          hint: "Every conversation counts",
          kind: "",
        },
        {
          label: "Qualified",
          count: state.metrics.qualified,
          hint: "Fits your current rules",
          kind: "positive",
        },
        {
          label: "Needs context",
          count: state.metrics.unresolved,
          hint: "A question, not a guess",
          kind: "amber",
        },
        {
          label: "Not a fit",
          count: state.metrics.notIcp,
          hint: "Clarity is progress, too",
          kind: "",
        },
      ].map((metric) => (
        <div className={`stat ${metric.kind}`} key={metric.label}>
          <span>{metric.label}</span>
          <strong>{String(metric.count).padStart(2, "0")}</strong>
          <small>{metric.hint}</small>
        </div>
      ))}
    </div>
  );
}
function AcquisitionChain({ state }: { state: State }) {
  const research = state.runs.filter(
    (run) => run.operation === "research" && run.status === "completed",
  );
  const hasHypotheses = state.experiments.length >= 2;
  const pending = state.leads.some(
    (lead) => lead.qualification.status === "NEEDS_CONTEXT",
  );
  const steps = [
    {
      name: "Research",
      detail:
        state.mode === "DEMO"
          ? "Synthetic research fixture"
          : research.length
            ? `${research.length} completed provider run${research.length > 1 ? "s" : ""}`
            : "No completed research run",
      ready: state.mode === "DEMO" || research.length > 0,
    },
    {
      name: "Hypotheses",
      detail: `${state.experiments.length} saved · ${hasHypotheses ? "ready to compare" : "need at least 2"}`,
      ready: hasHypotheses,
    },
    {
      name: "Leads",
      detail: `${state.leads.length} ${state.mode === "DEMO" ? "synthetic conversations" : "recorded conversations"}`,
      ready: state.leads.length > 0,
    },
    {
      name: "Qualification",
      detail: pending
        ? "Context pending · ask next"
        : state.leads.length
          ? "Current answers evaluated"
          : "Awaiting first lead",
      ready: state.leads.length > 0 && !pending,
    },
    { name: "Next test", detail: "Gather evidence. No winner.", ready: false },
  ];
  return (
    <section
      className="acquisition-chain"
      aria-label="Acquisition evidence chain"
    >
      <div className="chain-heading">
        <span className="eyebrow">FROM QUESTION TO NEXT TEST</span>
        <span>State-derived, not a progress score</span>
      </div>
      <ol>
        {steps.map((step, index) => (
          <li key={step.name} className={step.ready ? "observed" : ""}>
            <span className="chain-index">
              {step.ready ? (
                <Icon name="check" />
              ) : (
                String(index + 1).padStart(2, "0")
              )}
            </span>
            <div>
              <strong>{step.name}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function Mission({
  state,
  onNavigate,
  onSettings,
  onDelayed,
  onSelectLead,
  onExperiment,
}: {
  state: State;
  onNavigate: (tab: Tab) => void;
  onSettings: () => void;
  onDelayed: () => void;
  onSelectLead: (id: string) => void;
  onExperiment: () => void;
}) {
  const nextLead = state.leads.find(
    (lead) => lead.qualification.status === "NEEDS_CONTEXT",
  );
  const demo = state.mode === "DEMO";
  return (
    <>
      <SectionHeading
        eyebrow="THE ACQUISITION WORKSPACE"
        title="A late reply is not a lost lead."
        description="Test the message. Qualify the buyer. Keep learning when the answers change."
        action={
          <button className="button secondary" onClick={onSettings}>
            <Icon name="settings" />
            Edit mission
          </button>
        }
      />
      <AcquisitionChain state={state} />
      <div className="workspace-grid">
        <div className="main-column">
          <section className="mission-card">
            <div className="mission-topline">
              <span className="eyebrow">YOUR ACQUISITION MISSION</span>
              <span className="mission-mark" aria-hidden="true">
                <Icon name="compass" />
              </span>
            </div>
            <h2>
              {state.project?.goal ??
                "Give your next chapter a little direction."}
            </h2>
            <p>
              {state.project
                ? `${state.project.name} · Business memory v${state.project.rulesVersion}`
                : "Start with your business, a clear goal, and the clients you actually want."}
            </p>
            <div className="mission-bottom">
              <span>
                <span className="light-dot" />
                {demo
                  ? "Synthetic workspace · explore freely"
                  : "Private workspace · you stay in control"}
              </span>
              <button
                className="mission-link"
                onClick={
                  state.project ? () => onNavigate("memory") : onSettings
                }
              >
                {state.project ? "View the brief" : "Set up your business"}
                <Icon name="arrow" />
              </button>
            </div>
          </section>
          <Stats state={state} />
          <p className="data-caption">
            {state.metrics.source} ·{" "}
            {demo
              ? "Illustrative counts, not results"
              : "Workspace counts, not campaign performance"}
          </p>
          <section className="section-block">
            <PanelTitle
              number="01"
              title="Ideas in the field"
              action={
                <button
                  className="text-button"
                  onClick={() => onNavigate("experiments")}
                >
                  All experiments <Icon name="arrow" />
                </button>
              }
            />
            {state.experiments.length ? (
              <div className="experiment-grid">
                {state.experiments.slice(0, 2).map((experiment, index) => (
                  <button
                    className="experiment-preview"
                    key={experiment.id}
                    onClick={() => onNavigate("experiments")}
                  >
                    <Creative index={index} title={experiment.name} />
                    <div className="preview-caption">
                      <div>
                        <small>
                          EXPERIMENT {String(index + 1).padStart(2, "0")}
                        </small>
                        <h3>{experiment.name}</h3>
                      </div>
                      <Icon name="arrow" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="One good hypothesis is a start."
                action={
                  <button className="button secondary" onClick={onExperiment}>
                    Create your first experiment
                  </button>
                }
              >
                Save an audience, a message, and a reason to test it.
              </EmptyState>
            )}
          </section>
          <div className="evidence-note">
            <Icon name="info" />
            <div>
              <strong>Signal before certainty.</strong>
              <p>
                {state.metrics.sampleStatus === "insufficient_evidence" ||
                state.leads.length < 10
                  ? "The sample is too small to pick a winner. Keep the questions open."
                  : "Review the evidence and attribution before deciding what to try next."}
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("memory")}
            >
              See evidence
              <Icon name="arrow" />
            </button>
          </div>
        </div>
        <aside className="context-column">
          <section className="panel next-move">
            <p className="eyebrow">
              <span className="status-dot" />
              THE NEXT USEFUL MOVE
            </p>
            <h2>
              {nextLead
                ? "The fit is in the follow-up."
                : "Find the next useful signal."}
            </h2>
            <p>
              {nextLead
                ? `${nextLead.name.split(" ")[0]} has missing answers. Ask for context before deciding whether to pursue the lead.`
                : "Current leads have a decision. Add a conversation or test a new hypothesis."}
            </p>
            {nextLead && (
              <div className="question-note">
                <span>ONE QUESTION TO ASK</span>
                <p>"{nextLead.qualification.nextQuestion}"</p>
                <small>Suggested question only. Nothing sent.</small>
              </div>
            )}
            <button
              className="button dark full"
              onClick={() =>
                nextLead ? onSelectLead(nextLead.id) : onNavigate("pipeline")
              }
            >
              {nextLead ? "Open conversation" : "View pipeline"}
              <Icon name="arrow" />
            </button>
            {demo &&
              !state.events.some(
                (event) => event.externalId === "mira-budget-reply",
              ) && (
                <button className="text-button demo-answer" onClick={onDelayed}>
                  <Icon name="play" />
                  Simulate a reply in 2 days
                </button>
              )}
          </section>
          <section className="panel compact-panel">
            <PanelTitle
              title="Your guardrails"
              action={
                <button
                  className="icon-button"
                  aria-label="Edit qualification rules"
                  onClick={onSettings}
                >
                  <Icon name="settings" />
                </button>
              }
            />
            <dl className="rules-list">
              <div>
                <dt>Minimum budget</dt>
                <dd>
                  {state.project
                    ? money(state.project.rules.minBudget)
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Start within</dt>
                <dd>
                  {state.project
                    ? `${state.project.rules.maxTimelineDays} days`
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Decision maker</dt>
                <dd>Required</dd>
              </div>
              <div>
                <dt>Missing answers</dt>
                <dd>Stay unknown</dd>
              </div>
            </dl>
          </section>
          <div className="margin-note">
            <span className="hand-line" />
            <p>
              Not a bigger funnel.
              <br />A better sense of direction.
            </p>
            <span>THE COMPASS APPROACH</span>
          </div>
        </aside>
      </div>
    </>
  );
}

export function Experiments({
  state,
  onCreate,
  onPipeline,
}: {
  state: State;
  onCreate: () => void;
  onPipeline: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <>
      <SectionHeading
        eyebrow="SMALL BETS. USEFUL LEARNING."
        title="Make the next idea testable."
        description="An audience, a hypothesis, a message. Keep the evidence close."
        action={
          <button className="button primary" onClick={onCreate}>
            <Icon name="plus" />
            New experiment
          </button>
        }
      />
      <div className="sample-banner">
        <Icon name="info" />
        <div>
          <strong>Insufficient evidence to choose a winner</strong>
          <p>
            {state.leads.length} {state.mode === "DEMO" ? "synthetic " : ""}
            leads. {state.metrics.unknownAttribution} unattributed. These counts
            are descriptive, not proof of lift.
          </p>
        </div>
        <span className="badge neutral">No winner declared</span>
      </div>
      {state.experiments.length ? (
        <div className="experiment-grid full-experiments">
          {state.experiments.map((experiment, index) => {
            const metric = state.metrics.experiments.find(
              (row) => row.experimentId === experiment.id,
            );
            return (
              <article className="experiment-card" key={experiment.id}>
                {state.mode === "DEMO" && index < 2 ? (
                  <Creative index={index} title={experiment.name} />
                ) : (
                  <div className="text-creative">
                    <span className="eyebrow">
                      MESSAGE / {String(index + 1).padStart(2, "0")}
                    </span>
                    <p>{experiment.message}</p>
                    <span>Unpublished concept</span>
                  </div>
                )}
                <div className="experiment-body">
                  <div className="section-head">
                    <span className="eyebrow">
                      EXPERIMENT {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="badge neutral">
                      {state.mode === "DEMO"
                        ? "Synthetic brief"
                        : "Saved brief"}
                    </span>
                  </div>
                  <h2>{experiment.name}</h2>
                  <p>{experiment.hypothesis}</p>
                  <div className="audience-line">
                    <Icon name="pipeline" />
                    <span>{experiment.audience}</span>
                  </div>
                  <div className="experiment-metrics">
                    <div>
                      <strong>{metric?.total ?? 0}</strong>
                      <span>leads</span>
                    </div>
                    <div>
                      <strong>{metric?.qualified ?? 0}</strong>
                      <span>qualified</span>
                    </div>
                    <div className="sample-cell">
                      <span className="status-dot" />
                      Small sample
                    </div>
                  </div>
                  {expanded === experiment.id && (
                    <div
                      className="brief-expanded"
                      id={`brief-${experiment.id}`}
                    >
                      <span className="eyebrow">MESSAGE</span>
                      <p>{experiment.message}</p>
                      <small>
                        Concept only. No ad buying, publishing, or outreach.
                      </small>
                    </div>
                  )}
                  <div className="card-actions">
                    <button
                      className="text-button"
                      aria-expanded={expanded === experiment.id}
                      aria-controls={`brief-${experiment.id}`}
                      onClick={() =>
                        setExpanded(
                          expanded === experiment.id ? null : experiment.id,
                        )
                      }
                    >
                      {expanded === experiment.id
                        ? "Close brief"
                        : "Read brief"}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => onPipeline(experiment.id)}
                    >
                      View leads
                      <Icon name="arrow" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Start with a question."
          action={
            <button className="button primary" onClick={onCreate}>
              Create experiment
            </button>
          }
        >
          What would bring the right people into a conversation? Turn that
          thought into a test brief.
        </EmptyState>
      )}
      <p className="data-caption">
        Source: {state.metrics.source}. No campaign spend or performance is
        implied.
      </p>
    </>
  );
}

export function LeadDetail({
  lead,
  state,
  onAnswer,
  onDelayed,
  onReplay,
}: {
  lead: Lead;
  state: State;
  onAnswer: (lead: Lead) => void;
  onDelayed: () => void;
  onReplay: () => void;
}) {
  const fields = lead.fields;
  const labels = [
    ["Problem", fields.problem ?? "Not known yet"],
    [
      "Decision maker",
      fields.decisionMaker === null
        ? "Not known yet"
        : fields.decisionMaker
          ? "Yes"
          : "No",
    ],
    ["Budget", fields.budget === null ? "Not known yet" : money(fields.budget)],
    [
      "Timeline",
      fields.timelineDays === null
        ? "Not known yet"
        : `${fields.timelineDays} days`,
    ],
    [
      "Business fit",
      fields.businessFit === null
        ? "Not known yet"
        : fields.businessFit
          ? "Yes"
          : "No",
    ],
  ];
  const delayed = state.events.some(
    (event) => event.externalId === "mira-budget-reply",
  );
  return (
    <section
      className="lead-detail panel"
      aria-label={`${lead.name} qualification details`}
    >
      <div className="section-head">
        <span className="eyebrow">THE CONTEXT, NOT JUST A SCORE</span>
        {state.mode === "DEMO" && (
          <span className="synthetic-tag">SYNTHETIC</span>
        )}
      </div>
      <span className="avatar large">
        {lead.name
          .split(" ")
          .map((part) => part[0])
          .slice(0, 2)
          .join("")}
      </span>
      <h2>{lead.name}</h2>
      <QualificationBadge status={lead.qualification.status} />
      <p className="lead-problem">
        {fields.problem ?? "There is still a story to understand."}
      </p>
      <dl className="lead-fields">
        {labels.map(([label, content]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={content === "Not known yet" ? "unknown" : ""}>
              {content}
            </dd>
          </div>
        ))}
      </dl>
      <div className="reason-box">
        <span className="eyebrow">WHY THIS DECISION</span>
        {lead.qualification.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        <small>
          Rules v{lead.qualification.rulesVersion} ·{" "}
          {lead.qualification.missing.length} missing answers
        </small>
      </div>
      {lead.qualification.nextQuestion && (
        <div className="question-note">
          <span>NEXT QUESTION</span>
          <p>{lead.qualification.nextQuestion}</p>
          <small>Not sent automatically.</small>
        </div>
      )}
      <button className="button dark full" onClick={() => onAnswer(lead)}>
        Add new context
        <Icon name="plus" />
      </button>
      {state.mode === "DEMO" && lead.id === "mira" && (
        <div className="simulation-box">
          <span className="eyebrow">LOCAL DEMO CONTROLS</span>
          <button className="button secondary full" onClick={onDelayed}>
            {delayed ? "Reply already received" : "Receive delayed answer"}
            <Icon name={delayed ? "check" : "play"} />
          </button>
          <button
            className="text-button"
            onClick={onReplay}
            disabled={!delayed}
          >
            Replay duplicate event
            <Icon name="refresh" />
          </button>
          <p>
            Synthetic reply · 2 days compressed into one click. No message is
            sent.
          </p>
        </div>
      )}
    </section>
  );
}

export function Pipeline({
  state,
  selectedId,
  onSelect,
  experimentFilter,
  onExperimentFilter,
  onCreate,
  onAnswer,
  onDelayed,
  onReplay,
}: {
  state: State;
  selectedId: string | null;
  onSelect: (id: string) => void;
  experimentFilter: string;
  onExperimentFilter: (id: string) => void;
  onCreate: () => void;
  onAnswer: (lead: Lead) => void;
  onDelayed: () => void;
  onReplay: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const deferred = useDeferredValue(query.toLowerCase());
  const leads = state.leads.filter(
    (lead) =>
      (filter === "ALL" || lead.qualification.status === filter) &&
      (!experimentFilter || lead.experimentId === experimentFilter) &&
      `${lead.name} ${lead.fields.problem ?? ""}`
        .toLowerCase()
        .includes(deferred),
  );
  const selected = leads.find((lead) => lead.id === selectedId) ?? leads[0];
  return (
    <>
      <SectionHeading
        eyebrow="PEOPLE, WITH CONTEXT"
        title="Better conversations start here."
        description="Know who fits, what is missing, and the next question worth asking."
        action={
          <button className="button primary" onClick={onCreate}>
            <Icon name="plus" />
            Add lead
          </button>
        }
      />
      <div className="pipeline-layout">
        <section className="pipeline-list panel">
          <div className="pipeline-toolbar">
            <label className="search-field">
              <Icon name="search" />
              <span className="sr-only">Search leads</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a person or a problem"
              />
            </label>
            <label className="sr-only" htmlFor="attribution-filter">
              Filter by experiment
            </label>
            <select
              id="attribution-filter"
              value={experimentFilter}
              onChange={(event) => onExperimentFilter(event.target.value)}
            >
              <option value="">All experiments</option>
              {state.experiments.map((experiment) => (
                <option value={experiment.id} key={experiment.id}>
                  {experiment.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-row" aria-label="Qualification filters">
            {[
              ["ALL", "All", state.leads.length],
              ["NEEDS_CONTEXT", "Needs context", state.metrics.unresolved],
              ["QUALIFIED", "Qualified", state.metrics.qualified],
              ["NOT_ICP", "Not a fit", state.metrics.notIcp],
            ].map(([id, label, count]) => (
              <button
                aria-pressed={filter === id}
                key={id}
                onClick={() => setFilter(String(id))}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="list-label">
            <span>PERSON / PROBLEM</span>
            <span>QUALIFICATION</span>
          </div>
          {leads.length ? (
            <div className="lead-list">
              {leads.map((lead) => (
                <button
                  className={`lead-row ${selected?.id === lead.id ? "selected" : ""}`}
                  aria-pressed={selected?.id === lead.id}
                  key={lead.id}
                  onClick={() => onSelect(lead.id)}
                >
                  <span className="avatar">
                    {lead.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span className="lead-row-copy">
                    <strong>{lead.name}</strong>
                    <span>
                      {lead.fields.problem ?? "Problem not known yet"}
                    </span>
                    <small>
                      {state.experiments.find(
                        (experiment) => experiment.id === lead.experimentId,
                      )?.name ?? "Unknown attribution"}
                    </small>
                  </span>
                  <QualificationBadge status={lead.qualification.status} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                state.leads.length
                  ? "No matching conversations."
                  : "Every good fit starts somewhere."
              }
            >
              {state.leads.length
                ? "Try another search or filter."
                : "Add your first lead manually. Missing details are welcome."}
            </EmptyState>
          )}
          <div className="list-footer">
            <span>
              {leads.length} of {state.leads.length} leads
            </span>
            <span>
              {state.mode === "DEMO"
                ? "Synthetic people, real interactions"
                : state.metrics.source}
            </span>
          </div>
        </section>
        {selected ? (
          <LeadDetail
            key={selected.id}
            lead={selected}
            state={state}
            onAnswer={onAnswer}
            onDelayed={onDelayed}
            onReplay={onReplay}
          />
        ) : (
          <div className="detail-placeholder">
            <Icon name="pipeline" />
            <p>A little context changes everything.</p>
          </div>
        )}
      </div>
    </>
  );
}

export function Memory({
  state,
  onSettings,
  onRaiseBudget,
}: {
  state: State;
  onSettings: () => void;
  onRaiseBudget: () => void;
}) {
  const entries = [
    ...state.decisions.map((decision) => ({
      id: decision.id,
      kind:
        decision.status === "insufficient_evidence"
          ? "EVIDENCE CHECK"
          : "DECISION / MEMORY",
      text: decision.recommendation,
      time: decision.createdAt,
      detail: `Rules v${decision.rulesVersion} · ${decision.evidenceIds.length} evidence references`,
      evidenceIds: decision.evidenceIds,
      icon: "memory" as const,
    })),
    ...state.events.map((event) => ({
      id: event.id,
      kind: event.mode === "DEMO" ? "SYNTHETIC SIGNAL" : "RECEIVED SIGNAL",
      text: `${state.leads.find((lead) => lead.id === event.leadId)?.name ?? "Lead"} · ${event.externalId === "mira-budget-reply" ? "Budget answer arrived: $6,500. Qualification updated." : event.source}`,
      time: event.receivedAt,
      detail: `Occurred ${formatDate(event.occurredAt)} · ${event.externalId}`,
      evidenceIds: [event.id],
      icon: "pipeline" as const,
    })),
  ].sort((a, b) => b.time.localeCompare(a.time));
  return (
    <>
      <SectionHeading
        eyebrow="CONTEXT THAT STAYS WITH YOU"
        title="A business with a memory."
        description="Your rules, incoming signals, and the reasoning behind the next move."
        action={
          <button className="button secondary" onClick={onSettings}>
            <Icon name="settings" />
            Edit business memory
          </button>
        }
      />
      <div className="workspace-grid">
        <div className="main-column">
          <section className="panel memory-brief">
            <div className="section-head">
              <span className="eyebrow">THE CURRENT BRIEF</span>
              <span className="version-chip">
                VERSION {state.project?.rulesVersion ?? 0}
              </span>
            </div>
            <h2>{state.project?.name ?? "Your business starts here"}</h2>
            <p>
              {state.project?.goal ??
                "Add your business profile to give future decisions a useful starting point."}
            </p>
            <div className="memory-rule-grid">
              <div>
                <span>Minimum budget</span>
                <strong>
                  {state.project
                    ? money(state.project.rules.minBudget)
                    : "Not set"}
                </strong>
              </div>
              <div>
                <span>Maximum timeline</span>
                <strong>
                  {state.project
                    ? `${state.project.rules.maxTimelineDays} days`
                    : "Not set"}
                </strong>
              </div>
              <div>
                <span>Missing information</span>
                <strong>Ask. Do not assume.</strong>
              </div>
            </div>
          </section>
          <section className="section-block">
            <PanelTitle number="02" title="The evidence trail" />
            <div className="timeline">
              {entries.length ? (
                entries.map((entry) => (
                  <article key={entry.id} className="timeline-entry">
                    <span className="timeline-icon">
                      <Icon name={entry.icon} />
                    </span>
                    <div>
                      <div className="timeline-top">
                        <span className="eyebrow">{entry.kind}</span>
                        <time dateTime={entry.time}>
                          {formatDate(entry.time)}
                        </time>
                      </div>
                      <h3>{entry.text}</h3>
                      <p>{entry.detail}</p>
                      <details className="evidence-details">
                        <summary>
                          Inspect evidence ({entry.evidenceIds.length})
                        </summary>
                        {entry.evidenceIds.map((id) => {
                          const event = state.events.find(
                            (item) => item.id === id,
                          );
                          const run = state.runs.find(
                            (item) => `run:${item.id}` === id,
                          );
                          return (
                            <div key={id}>
                              <code>{id}</code>
                              {event ? (
                                <>
                                  <p>
                                    {event.source} · occurred{" "}
                                    {formatDate(event.occurredAt)} · received{" "}
                                    {formatDate(event.receivedAt)}
                                  </p>
                                  <pre>
                                    {JSON.stringify(
                                      event.fields ?? {
                                        note: "Field payload not reported by this server",
                                      },
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </>
                              ) : run ? (
                                <p>
                                  {run.operation} · {run.status} · checkpoint{" "}
                                  {run.checkpoint}
                                </p>
                              ) : (
                                <p>
                                  {id.startsWith("rules:")
                                    ? `Qualification rules version ${id.slice(6)}`
                                    : "Referenced evidence is not included in this state snapshot."}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </details>
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState title="A clean slate.">
                  Saved signals and decisions will appear here. There is no
                  imported history.
                </EmptyState>
              )}
            </div>
          </section>
        </div>
        <aside className="context-column">
          <section className="panel memory-principle">
            <Icon name="memory" />
            <h2>
              Change the rule.
              <br />
              Keep the context.
            </h2>
            <p>
              When your business changes, the same people can be evaluated
              against the new brief. Nothing needs to be invented or forgotten.
            </p>
            {state.mode === "DEMO" && (
              <>
                <button className="button dark full" onClick={onRaiseBudget}>
                  Try an $8,000 minimum
                  <Icon name="arrow" />
                </button>
                <small>
                  Local simulation. Watch Mira become "Not a fit" after the rule
                  changes.
                </small>
              </>
            )}
          </section>
          <section className="panel compact-panel">
            <h3>Evidence, with boundaries.</h3>
            <ul className="principles">
              <li>
                <Icon name="check" />
                Unknown is not zero.
              </li>
              <li>
                <Icon name="check" />
                Duplicates are not new leads.
              </li>
              <li>
                <Icon name="check" />A small sample is not a winner.
              </li>
              <li>
                <Icon name="check" />A configured provider is not a result.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

export function formatDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "Time unavailable"
    : parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export function ServicePanel({
  status,
  error,
  loading,
  onRefresh,
}: {
  status: ServiceStatus | null;
  error: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="service-panel">
      <p className="muted">
        Reported by <code>GET /api/acquisition/status</code>. Readiness is not
        proof of a successful provider call.
      </p>
      <div className="service-database">
        <span>Durable database</span>
        <span
          className={`badge ${status?.database === "ready" ? "qualified" : "neutral"}`}
        >
          {status?.database ?? "Unknown"}
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Checking service status...</p>}
      {!loading && !status?.integrations.length && (
        <p className="muted">
          No provider status has been reported. Integrations are not assumed
          connected.
        </p>
      )}
      {status?.integrations.map((provider) => (
        <div
          className="provider-row"
          key={`${provider.name}-${provider.operation}`}
        >
          <div>
            <strong>{provider.name}</strong>
            <span>{provider.operation}</span>
          </div>
          <span className="badge neutral">{provider.status}</span>
          {provider.reason && <p>{provider.reason}</p>}
        </div>
      ))}
      <div className="provider-row">
        <div>
          <strong>Voice</strong>
          <span>
            {status?.voice?.reason ??
              "This frontend uses text only. No microphone recording or voice provider call is started."}
          </span>
        </div>
        <span className="badge neutral">Not connected in UI</span>
      </div>
      <p className="fine-print">
        Billing disabled. No payment collection.{" "}
        {status?.sponsorCallsEnabled === false
          ? "Sponsor calls disabled pending approval."
          : "Provider operations require explicit action."}
      </p>
      <button
        className="button secondary"
        onClick={onRefresh}
        disabled={loading}
      >
        <Icon name="refresh" />
        Refresh status
      </button>
    </div>
  );
}

export function RunsPanel({
  state,
  onRun,
  onResume,
  onAccept,
}: {
  state: State;
  onRun: (input: {
    operation: string;
    query?: string;
    text?: string;
    leadId?: string;
  }) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onAccept: (input: AnswerInput) => Promise<AnswerOutcome>;
}) {
  const [operation, setOperation] = useState("research");
  return (
    <div>
      <p className="muted">
        Real provider operations, never hidden fixtures. Missing configuration
        produces a blocked run. Only start a run you intend to execute.
      </p>
      <AsyncForm
        submit="Start provider operation"
        onSubmit={async (data) => {
          await onRun({
            operation,
            ...(operation === "research"
              ? { query: value(data, "query") }
              : operation === "extract"
                ? {
                    text: value(data, "text"),
                    ...(value(data, "leadId")
                      ? { leadId: value(data, "leadId") }
                      : {}),
                  }
                : {}),
          });
        }}
      >
        <label>
          Operation
          <select
            value={operation}
            onChange={(event) => setOperation(event.target.value)}
          >
            <option value="research">Research</option>
            <option value="extract">Extract context</option>
            <option value="metrics">Provider metrics</option>
          </select>
        </label>
        {operation === "research" && (
          <label>
            Research query
            <textarea name="query" rows={3} required maxLength={1000} />
          </label>
        )}
        {operation === "extract" && (
          <>
            <label>
              Text to extract
              <textarea name="text" rows={4} required maxLength={4000} />
            </label>
            <label>
              Related lead
              <select name="leadId" required>
                <option value="">Choose a lead</option>
                {state.leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </AsyncForm>
      <div className="run-list">
        <h3>Persisted runs</h3>
        {state.runs.length ? (
          [...state.runs]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((run) => (
              <article className="run-card" key={run.id}>
                <div className="section-head">
                  <strong>{run.operation}</strong>
                  <span className="badge neutral">{run.status}</span>
                </div>
                <p>Checkpoint: {run.checkpoint || "Not started"}</p>
                {run.reason && <p className="run-reason">{run.reason}</p>}
                {run.result != null && (
                  <details>
                    <summary>View returned result</summary>
                    <pre>{JSON.stringify(run.result, null, 2)}</pre>
                  </details>
                )}
                {run.operation === "extract" && (
                  <ProposalReview run={run} state={state} onAccept={onAccept} />
                )}
                {["blocked", "failed"].includes(run.status) && (
                  <AsyncForm
                    submit="Resume checkpoint"
                    onSubmit={async () => onResume(run.id)}
                  >
                    <p className="fine-print">
                      Completed work is not repeated. Uncertain outcomes cannot
                      be automatically retried.
                    </p>
                  </AsyncForm>
                )}
              </article>
            ))
        ) : (
          <p className="muted">No operations have been started.</p>
        )}
      </div>
    </div>
  );
}
