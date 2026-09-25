import { useEffect, useId, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Decision, Fact, Person, Preset, Snapshot, Task } from "./types";
import { STUDIO_IMAGE, STUDIO_PEOPLE } from './studio-art';

export type IconName =
  | "mark"
  | "play"
  | "pause"
  | "arrow"
  | "close"
  | "memory"
  | "change"
  | "reset"
  | "expand"
  | "check"
  | "clock"
  | "link"
  | "shield"
  | "chevron"
  | "info";
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    mark: (
      <>
        <path d="m10 2 7 4v8l-7 4-7-4V6zM3 6l7 4 7-4M10 10v8" />
        <path d="m6.5 4 7 4v5" />
      </>
    ),
    play: <path d="m7 4 9 6-9 6z" />,
    pause: (
      <>
        <path d="M6 4v12M14 4v12" strokeWidth="3" />
      </>
    ),
    arrow: <path d="M3 10h13m-5-5 5 5-5 5" />,
    close: <path d="m5 5 10 10M15 5 5 15" />,
    memory: (
      <>
        <path d="m10 2 8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" />
      </>
    ),
    change: (
      <>
        <path d="M3 5h14M3 15h14M7 2v6M13 12v6M3 10h14" />
        <circle cx="10" cy="10" r="2" />
      </>
    ),
    reset: (
      <>
        <path d="M4 7a7 7 0 1 1 0 7M3 2v5h5" />
      </>
    ),
    expand: <path d="M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4" />,
    check: <path d="m4 10 4 4 8-8" />,
    clock: (
      <>
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 5v5l3 2" />
      </>
    ),
    link: (
      <>
        <path d="m8 12 4-4M6 11l-2 2a3 3 0 0 0 4 4l3-3M9 6l3-3a3 3 0 0 1 4 4l-2 2" />
      </>
    ),
    shield: (
      <>
        <path d="m10 2 7 3v5c0 4-7 8-7 8s-7-4-7-8V5z" />
        <path d="m6 10 3 3 5-6" />
      </>
    ),
    chevron: <path d="m8 5 5 5-5 5" />,
    info: (
      <>
        <circle cx="10" cy="10" r="8" />
        <path d="M10 9v5M10 6v.1" />
      </>
    ),
  };
  return (
    <svg
      className={`rm-icon ${className}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const skin = ["#e8b79d", "#b68369", "#efcfaf", "#d6a789", "#b77960", "#e0b391"];
const hair = ["#403b34", "#3c3532", "#aa754b", "#3d3a38", "#342e2b", "#6c4d37"];
export function Portrait({
  person,
  index,
  small = false,
}: {
  person: Person;
  index: number;
  small?: boolean;
}) {
  const variant = index % 6;
  const studio = STUDIO_PEOPLE[person.id];
  if (studio && person.name.toLowerCase() === person.id) {
    return (
      <span className={`rm-portrait studio-portrait ${small ? 'small' : ''}`} aria-hidden="true">
        <img src={STUDIO_IMAGE} alt="" style={{ transform: `translate(-${studio.x}%, -${studio.faceY}%)` }} />
      </span>
    );
  }
  return (
    <span
      className={`rm-portrait ${small ? "small" : ""}`}
      style={{ "--person-color": person.color } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 80 80" fill="none">
        <path d="M6 80c0-18 13-28 34-28s34 10 34 28" fill={person.color} />
        {(variant === 0 || variant === 2 || variant === 5) && (
          <path d="M20 31C20 8 61 8 61 32l4 32H16z" fill={hair[variant]} />
        )}
        <path d="M33 48h14v14c-4 6-10 6-14 0z" fill={skin[variant]} />
        <ellipse cx="40" cy="35" rx="19" ry="23" fill={skin[variant]} />
        {variant === 0 && (
          <path
            d="M20 30C19 3 65 7 60 31c-13-1-18-10-19-14-3 9-12 14-21 13"
            fill={hair[variant]}
          />
        )}
        {variant === 1 && (
          <path
            d="M20 26c-4-16 7-23 15-18 7-8 19-2 18 3 10-1 13 11 7 20l-6-10-27 1-6 13z"
            fill={hair[variant]}
          />
        )}
        {variant === 2 && (
          <path
            d="M20 32C16 1 65 9 60 30l-9-4-6-12c-3 10-14 17-25 18"
            fill={hair[variant]}
          />
        )}
        {variant === 3 && (
          <>
            <path
              d="M20 30c0-29 44-23 40 0l-5-12-27 3-8 15"
              fill={hair[variant]}
            />
            <path
              d="M27 44c4 6 22 6 26-1-1 11-8 17-13 17-6 0-12-5-13-16"
              fill={hair[variant]}
            />
          </>
        )}
        {variant === 4 && (
          <>
            <path
              d="M20 31c-7-11 0-22 7-20 2-12 17-12 23-5 10-2 18 12 9 24l-3-8c-9 4-20 3-29-1l-5 11"
              fill={hair[variant]}
            />
            <path
              d="M25 32h12v8H25zM43 32h12v8H43zM37 35h6"
              stroke="#403d33"
              strokeWidth="2"
            />
          </>
        )}
        {variant === 5 && (
          <path
            d="M19 30C16 4 65 6 61 32l-12-7-7-13c-2 13-12 18-23 18"
            fill={hair[variant]}
          />
        )}
        <path
          d="M32 34v2M48 34v2"
          stroke="#3c342e"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="m39 37-2 6h4"
          stroke="#805846"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M35 49q5 4 10-1"
          stroke="#734537"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="m25 61 15 12 15-12"
          stroke="#fff"
          strokeOpacity=".35"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}

export function Overlay({
  title,
  kicker,
  children,
  onClose,
  variant = "drawer",
}: {
  title: string;
  kicker: string;
  children: ReactNode;
  onClose: () => void;
  variant?: "drawer" | "sheet" | "xray";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`rm-overlay rm-${variant}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="rm-overlay-inner">
        <header className="rm-overlay-header">
          <div>
            <p className="rm-kicker">{kicker}</p>
            <h2 id={id}>{title}</h2>
          </div>
          <button
            type="button"
            className="rm-icon-button"
            aria-label="Close panel"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function SprintPath({
  snapshot,
  selected,
  current,
  onSelect,
}: {
  snapshot: Snapshot;
  selected: number;
  current: number;
  onSelect: (sprint: number) => void;
}) {
  return (
    <nav className="rm-sprint-path" aria-label="Six-sprint path">
      {Array.from({ length: 6 }, (_, index) => index + 1).map((sprint) => {
        const tasks = snapshot.tasks.filter((task) => task.sprint === sprint);
        const done = tasks.filter((task) => task.status === "done").length;
        return (
          <button
            type="button"
            key={sprint}
            className={`rm-sprint ${sprint === current ? "is-current" : ""} ${sprint === selected ? "is-selected" : ""}`}
            aria-pressed={sprint === selected}
            onClick={() => onSelect(sprint)}
            aria-label={`Sprint ${sprint}, ${done} of ${tasks.length} tasks complete${sprint === current ? ", current sprint" : ""}`}
          >
            <span className="rm-sprint-number">
              {tasks.length > 0 && done === tasks.length ? (
                <Icon name="check" />
              ) : (
                `0${sprint}`
              )}
            </span>
            <span>
              <strong>Sprint {sprint}</strong>
              <small>
                {sprint === 6
                  ? "Demo Day"
                  : `Days ${(sprint - 1) * 10 + 1}-${sprint * 10}`}
              </small>
            </span>
            <span className="rm-sprint-count">
              {done}/{tasks.length}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function TeamRow({
  snapshot,
  onPerson,
}: {
  snapshot: Snapshot;
  onPerson: (id: string) => void;
}) {
  return (
    <section className="rm-team-section" aria-label="Simulated teammates">
      <div className="rm-section-label">
        <h2>The team</h2>
        <span>{snapshot.team.length} simulated teammates</span>
      </div>
      <div className="rm-team-row">
        {snapshot.team.map((person, index) => {
          const tasks = snapshot.tasks.filter(
            (task) => task.ownerId === person.id && task.status === "active",
          );
          const blocked = snapshot.tasks.some(
            (task) => task.ownerId === person.id && task.status === "blocked",
          );
          return (
            <button
              className={`rm-person ${tasks.length ? "is-working" : ""}`}
              key={person.id}
              onClick={() => onPerson(person.id)}
              type="button"
              aria-label={`Inspect ${person.name}, ${person.role}`}
            >
              <Portrait person={person} index={index} />
              <span className="rm-person-copy">
                <strong>{person.name}</strong>
                <span>{person.role}</span>
                <small
                  className={
                    blocked ? "is-blocked" : tasks.length ? "is-active" : ""
                  }
                >
                  <i />
                  {blocked
                    ? "Blocked work"
                    : tasks.length
                      ? `${tasks.length} active ${tasks.length === 1 ? "task" : "tasks"}`
                      : "No active task"}
                </small>
              </span>
              <Icon name="chevron" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export type AssignmentChange = {
  taskId: string;
  from: string;
  to: string;
  day: number;
};
export function TaskBoard({
  snapshot,
  sprint,
  changes,
  onTask,
}: {
  snapshot: Snapshot;
  sprint: number;
  changes: AssignmentChange[];
  onTask: (id: string) => void;
}) {
  const sprintTasks = snapshot.tasks.filter((task) => task.sprint === sprint);
  const columns: {
    name: string;
    statuses: Task["status"][];
    className: string;
    empty: string;
  }[] = [
    {
      name: "Up next",
      statuses: ["planned"],
      className: "planned",
      empty: "No planned tasks in this sprint.",
    },
    {
      name: "In motion",
      statuses: ["active", "blocked"],
      className: "active",
      empty: "Nothing in motion yet.",
    },
    {
      name: "Done",
      statuses: ["done"],
      className: "done",
      empty: "Good work will land here.",
    },
  ];
  return (
    <section className="rm-board" aria-label={`Sprint ${sprint} task board`}>
      <div className="rm-board-heading">
        <div>
          <span className="rm-kicker">THE WORK, AS IT HAPPENS</span>
          <h2>
            Sprint {sprint}
            <span> / 06</span>
          </h2>
        </div>
        <span className="rm-board-count">
          {sprintTasks.length} tasks in this sprint
        </span>
      </div>
      <div className="rm-task-columns">
        {columns.map((column) => {
          const tasks = sprintTasks.filter((task) =>
            column.statuses.includes(task.status),
          );
          return (
            <section
              className={`rm-task-column ${column.className}`}
              key={column.name}
              aria-label={column.name}
            >
              <div className="rm-column-heading">
                <h3>
                  <i />
                  {column.name}
                </h3>
                <span>{tasks.length}</span>
              </div>
              <div className="rm-task-stack">
                {tasks.map((task) => {
                  const person = snapshot.team.find(
                    (member) => member.id === task.ownerId,
                  );
                  const change = changes.find(
                    (item) =>
                      item.taskId === task.id && item.to === task.ownerId,
                  );
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`rm-task-card ${task.status} ${change ? "was-reassigned" : ""}`}
                      onClick={() => onTask(task.id)}
                      aria-label={`Inspect task: ${task.title}. ${task.status}. ${person?.name ?? "Owner not reported"}`}
                    >
                      <span className="rm-task-topline">
                        <span>{task.id}</span>
                        {task.status === "blocked" ? (
                          <span className="rm-task-flag">Blocked</span>
                        ) : change ? (
                          <span className="rm-task-flag reassigned">
                            Reassigned
                          </span>
                        ) : task.status === "done" ? (
                          <Icon name="check" />
                        ) : (
                          <span className="rm-task-day">Day {task.dueDay}</span>
                        )}
                      </span>
                      <strong>{task.title}</strong>
                      <span className="rm-task-bottom">
                        <span>
                          {person && (
                            <Portrait
                              person={person}
                              index={snapshot.team.indexOf(person)}
                              small
                            />
                          )}
                          {person?.name ?? "Unreported owner"}
                        </span>
                        {task.dependsOn.length > 0 && (
                          <span
                            className="rm-dependency"
                            aria-label={`${task.dependsOn.length} dependencies`}
                          >
                            <Icon name="link" />
                            {task.dependsOn.length}
                          </span>
                        )}
                        {task.completedDay !== null && (
                          <span className="rm-completed-day">
                            D{task.completedDay}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {!tasks.length && (
                  <div className="rm-empty-column">
                    <span aria-hidden="true">
                      {column.className === "done" ? (
                        <Icon name="check" />
                      ) : (
                        <Icon name="mark" />
                      )}
                    </span>
                    <p>{column.empty}</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function DecisionFeed({
  snapshot,
  onDecision,
}: {
  snapshot: Snapshot;
  onDecision: (id: string) => void;
}) {
  const decisions = [...snapshot.decisions]
    .sort((a, b) => b.day - a.day)
    .slice(0, 3);
  const feed = [...snapshot.feed].sort((a, b) => b.day - a.day).slice(0, 2);
  return (
    <aside className="rm-signal-panel">
      <div className="rm-section-label">
        <h2>From the room</h2>
        <span className="rm-phase-dot" />
      </div>
      <p className="rm-signal-intro">Decisions, with their receipts.</p>
      <div className="rm-decisions">
        {decisions.map((decision) => (
          <button
            className={`rm-decision ${decision.state}`}
            key={decision.id}
            onClick={() => onDecision(decision.id)}
            type="button"
          >
            <span className="rm-decision-line">
              <span>DAY {String(decision.day).padStart(2, "0")}</span>
              <span>{decision.state}</span>
            </span>
            <strong>{decision.summary}</strong>
            {decision.before && decision.after && (
              <span className="rm-decision-change">
                <span>{decision.before}</span>
                <Icon name="arrow" />
                <span>{decision.after}</span>
              </span>
            )}
            <span className="rm-evidence-link">
              {decision.evidenceIds.length} evidence{" "}
              {decision.evidenceIds.length === 1 ? "reference" : "references"}
              <Icon name="arrow" />
            </span>
          </button>
        ))}
      </div>
      {!decisions.length && (
        <div className="rm-no-decisions">
          <Icon name="memory" />
          <p>No decisions yet.</p>
          <span>Start the quarter to see the plan take shape.</span>
        </div>
      )}
      {feed.length > 0 && (
        <div className="rm-recent-feed">
          <span className="rm-kicker">LATEST SIGNALS</span>
          {feed.map((entry) => (
            <details key={entry.id}>
              <summary>
                <span>D{entry.day}</span>
                {entry.title}
              </summary>
              <p>{entry.detail}</p>
              {entry.evidenceIds.length > 0 && (
                <small>Evidence: {entry.evidenceIds.join(", ")}</small>
              )}
            </details>
          ))}
        </div>
      )}
    </aside>
  );
}

export function Evidence({
  ids,
  snapshot,
}: {
  ids: string[];
  snapshot: Snapshot;
}) {
  if (!ids.length)
    return <p className="rm-muted">No evidence references reported.</p>;
  return (
    <div className="rm-evidence-list">
      {ids.map((id) => {
        const fact = snapshot.facts.find((item) => item.id === id);
        const task = snapshot.tasks.find((item) => item.id === id);
        const source = snapshot.feed.find((item) => item.id === id);
        return (
          <details key={id}>
            <summary>
              <code>{id}</code>
              {fact && (
                <span className={`rm-tag ${fact.state}`}>{fact.state}</span>
              )}
            </summary>
            {fact ? (
              <>
                <p>{fact.text}</p>
                <dl className="rm-detail-pairs">
                  <div>
                    <dt>Learned</dt>
                    <dd>Day {fact.learnedDay}</dd>
                  </div>
                  <div>
                    <dt>Effective</dt>
                    <dd>
                      Days {fact.effectiveFrom}-{fact.effectiveTo}
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{fact.source}</dd>
                  </div>
                  <div>
                    <dt>Source event</dt>
                    <dd>
                      <code>{fact.sourceEventId}</code>
                    </dd>
                  </div>
                </dl>
              </>
            ) : task ? (
              <p>
                {task.title} · {task.status} · due day {task.dueDay}
              </p>
            ) : source ? (
              <p>
                {source.title}: {source.detail}
              </p>
            ) : (
              <p>This reference is not included in the current snapshot.</p>
            )}
          </details>
        );
      })}
    </div>
  );
}

function FactCard({ fact, snapshot }: { fact: Fact; snapshot: Snapshot }) {
  const person = snapshot.team.find((member) => member.id === fact.personId);
  return (
    <details className={`rm-fact ${fact.state}`}>
      <summary>
        <span className="rm-fact-state" />
        <span>
          <strong>{fact.text}</strong>
          <small>
            {fact.id} · {person?.name ?? "Project context"}
          </small>
        </span>
        <span className={`rm-tag ${fact.state}`}>{fact.state}</span>
      </summary>
      <dl className="rm-detail-pairs">
        <div>
          <dt>Learned</dt>
          <dd>Day {fact.learnedDay}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>
            Days {fact.effectiveFrom}-{fact.effectiveTo}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{fact.source}</dd>
        </div>
        <div>
          <dt>Source event</dt>
          <dd>
            <code>{fact.sourceEventId}</code>
          </dd>
        </div>
      </dl>
    </details>
  );
}

export function MemoryXray({
  snapshot,
  onClose,
}: {
  snapshot: Snapshot;
  onClose: () => void;
}) {
  const checks = [...snapshot.checks].sort((a, b) => b.day - a.day);
  const operations = [...snapshot.memoryOps].sort((a, b) => b.day - a.day);
  return (
    <Overlay
      title="What did the team remember?"
      kicker={`MEMORY X-RAY / DAY ${String(snapshot.day).padStart(2, "0")}`}
      onClose={onClose}
      variant="xray"
    >
      <div className="rm-xray-context">
        <Icon name="memory" />
        <p>
          {snapshot.executionMode === "fixture"
            ? "Scripted memory and Shadow checks. No model calls or provider receipts."
            : "Reported runtime facts, cleanup operations, and Shadow checks."}{" "}
          {snapshot.stressTest
            ? "Deliberate memory fault enabled."
            : "No deliberate memory fault."}
        </p>
      </div>
      <div className="rm-xray-metrics">
        <span>
          <strong>{snapshot.metrics.protectedFacts}</strong> protected facts
        </span>
        <span>
          <strong>{snapshot.metrics.conflictsDetected}</strong> conflicts
          detected
        </span>
        <span>
          <strong>{snapshot.metrics.restores}</strong> restores
        </span>
        {snapshot.metrics.contextTokens !== null && (
          <span>
            <strong>{snapshot.metrics.contextTokens.toLocaleString()}</strong>{" "}
            context tokens
          </span>
        )}
      </div>
      <div className="rm-xray-grid">
        <section>
          <div className="rm-section-label">
            <h3>The memory shelf</h3>
            <span>{snapshot.facts.length} reported facts</span>
          </div>
          {snapshot.facts.length ? (
            snapshot.facts.map((fact) => (
              <FactCard key={fact.id} fact={fact} snapshot={snapshot} />
            ))
          ) : (
            <p className="rm-empty-copy">No facts have been reported.</p>
          )}
        </section>
        <section>
          <div className="rm-section-label">
            <h3>Cleanup & recovery</h3>
            <span>{operations.length} operations</span>
          </div>
          <div className="rm-memory-ops">
            {operations.map((operation) => (
              <details key={operation.id}>
                <summary>
                  <span className={`rm-operation-mark ${operation.op}`}>
                    <Icon
                      name={operation.op === "restore" ? "reset" : "memory"}
                    />
                  </span>
                  <span>
                    <strong>{operation.op}</strong>
                    <small>Day {operation.day}</small>
                  </span>
                </summary>
                <p>{operation.why}</p>
                <Evidence ids={operation.factIds} snapshot={snapshot} />
              </details>
            ))}
            {!operations.length && (
              <p className="rm-empty-copy">Nothing has been cleaned up yet.</p>
            )}
          </div>
          <div className="rm-section-label rm-checks-heading">
            <h3>Shadow checks</h3>
            <span>{checks.length} checks</span>
          </div>
          {checks.map((check) => (
            <details className="rm-shadow-check" key={check.id}>
              <summary>
                <span className={`rm-tag ${check.verdict}`}>
                  {check.verdict}
                </span>
                <span>Day {check.day}</span>
              </summary>
              <p>{check.summary}</p>
              <div className="rm-check-comparison">
                <div>
                  <span>DOER</span>
                  <p>{check.doer}</p>
                </div>
                <div>
                  <span>SHADOW</span>
                  <p>{check.shadow}</p>
                </div>
              </div>
              <Evidence ids={check.factIds} snapshot={snapshot} />
            </details>
          ))}
          {!checks.length && (
            <p className="rm-empty-copy">
              No check has been reported. Agreement is not assumed.
            </p>
          )}
        </section>
      </div>
      {snapshot.receipts.length > 0 && (
        <section className="rm-receipts">
          <h3>Runtime receipts</h3>
          {snapshot.receipts.map((receipt, index) => (
            <div key={`${receipt.operation}-${receipt.at}-${index}`}>
              <strong>{receipt.provider}</strong>
              <span>{receipt.operation}</span>
              <span>{receipt.status}</span>
              {receipt.model && <code>{receipt.model}</code>}
              <time dateTime={receipt.at}>{receipt.at}</time>
            </div>
          ))}
        </section>
      )}
    </Overlay>
  );
}

export type DrawerTarget = { kind: "person" | "task" | "decision"; id: string };
export function DetailDrawer({
  target,
  snapshot,
  changes,
  onClose,
  onSelect,
}: {
  target: DrawerTarget;
  snapshot: Snapshot;
  changes: AssignmentChange[];
  onClose: () => void;
  onSelect: (target: DrawerTarget) => void;
}) {
  const person =
    target.kind === "person"
      ? snapshot.team.find((item) => item.id === target.id)
      : null;
  const task =
    target.kind === "task"
      ? snapshot.tasks.find((item) => item.id === target.id)
      : null;
  const decision =
    target.kind === "decision"
      ? snapshot.decisions.find((item) => item.id === target.id)
      : null;
  const title =
    person?.name ??
    task?.title ??
    decision?.summary ??
    "No longer in this snapshot";
  const owner = snapshot.team.find((item) => item.id === task?.ownerId);
  const change = changes.find((item) => item.taskId === task?.id);
  return (
    <Overlay
      title={title}
      kicker={`${target.kind.toUpperCase()} / DAY ${snapshot.day}`}
      onClose={onClose}
    >
      {person && (
        <>
          <div className="rm-person-detail">
            <Portrait person={person} index={snapshot.team.indexOf(person)} />
            <div>
              <h3>{person.role}</h3>
              <span>Simulated teammate</span>
            </div>
          </div>
          <div className="rm-skill-list">
            {person.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
          <h3 className="rm-detail-heading">Assigned work</h3>
          <div className="rm-related-tasks">
            {snapshot.tasks
              .filter((item) => item.ownerId === person.id)
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect({ kind: "task", id: item.id })}
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      Sprint {item.sprint} · due day {item.dueDay}
                    </small>
                  </span>
                  <span className={`rm-tag ${item.status}`}>{item.status}</span>
                </button>
              ))}
          </div>
          <h3 className="rm-detail-heading">Relevant memory</h3>
          <Evidence
            ids={snapshot.facts
              .filter((fact) => fact.personId === person.id)
              .map((fact) => fact.id)}
            snapshot={snapshot}
          />
        </>
      )}
      {task && (
        <>
          <div className="rm-detail-status">
            <span className={`rm-tag ${task.status}`}>{task.status}</span>
            <code>{task.id}</code>
          </div>
          <dl className="rm-detail-pairs">
            <div>
              <dt>Owner</dt>
              <dd>
                {owner ? (
                  <button
                    className="rm-text-button"
                    onClick={() => onSelect({ kind: "person", id: owner.id })}
                  >
                    {owner.name}
                    <Icon name="arrow" />
                  </button>
                ) : (
                  "Not reported"
                )}
              </dd>
            </div>
            <div>
              <dt>Sprint</dt>
              <dd>{task.sprint} of 6</dd>
            </div>
            <div>
              <dt>Planned start</dt>
              <dd>Day {task.startDay}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>Day {task.dueDay}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>
                {task.completedDay === null
                  ? "Not completed"
                  : `Day ${task.completedDay}`}
              </dd>
            </div>
          </dl>
          {change && (
            <div className="rm-assignment-note">
              <Icon name="change" />
              <p>
                Owner changed from{" "}
                {snapshot.team.find((member) => member.id === change.from)
                  ?.name ?? change.from}{" "}
                to{" "}
                {snapshot.team.find((member) => member.id === change.to)
                  ?.name ?? change.to}{" "}
                on day {change.day}. Observed in the transport snapshot.
              </p>
            </div>
          )}
          <h3 className="rm-detail-heading">Dependencies</h3>
          {task.dependsOn.length ? (
            <div className="rm-related-tasks">
              {task.dependsOn.map((id) => {
                const dependency = snapshot.tasks.find(
                  (item) => item.id === id,
                );
                return (
                  <button
                    key={id}
                    onClick={() => onSelect({ kind: "task", id })}
                  >
                    <span>
                      <strong>{dependency?.title ?? id}</strong>
                      <small>
                        {dependency?.status ?? "Not included in snapshot"}
                      </small>
                    </span>
                    <Icon name="arrow" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rm-muted">No dependencies reported.</p>
          )}
        </>
      )}
      {decision && (
        <>
          <div className="rm-detail-status">
            <span className={`rm-tag ${decision.state}`}>{decision.state}</span>
            <span>Day {decision.day}</span>
          </div>
          {(decision.before || decision.after) && (
            <div className="rm-before-after">
              {decision.before && (
                <div>
                  <span>BEFORE</span>
                  <p>{decision.before}</p>
                </div>
              )}
              {decision.after && (
                <div>
                  <span>AFTER</span>
                  <p>{decision.after}</p>
                </div>
              )}
            </div>
          )}
          <h3 className="rm-detail-heading">Why this decision?</h3>
          <p className="rm-muted">
            Inspect the referenced facts, not an invented explanation.
          </p>
          <Evidence ids={decision.evidenceIds} snapshot={snapshot} />
        </>
      )}
      {!person && !task && !decision && (
        <p className="rm-muted">
          This item is not included in the current authoritative snapshot.
        </p>
      )}
    </Overlay>
  );
}

export const presets: {
  id: Preset;
  title: string;
  description: string;
  icon: IconName;
}[] = [
  {
    id: "sarah-leave",
    title: "Sarah needs time away.",
    description:
      "Introduce an availability change. See how the runtime handles the plan.",
    icon: "clock",
  },
  {
    id: "deadline-shift",
    title: "Demo Day moves closer.",
    description:
      "Change the deadline. The result is not guaranteed to be a win.",
    icon: "change",
  },
  {
    id: "dependency-delay",
    title: "A dependency slips.",
    description: "Delay upstream work. Watch the consequences reach the board.",
    icon: "link",
  },
];
export function ChangeSheet({
  snapshot,
  pending,
  error,
  onInject,
  onClose,
}: {
  snapshot: Snapshot;
  pending: boolean;
  error: string;
  onInject: (preset: Preset) => void;
  onClose: () => void;
}) {
  return (
    <Overlay
      title="Plans meet real life."
      kicker="INTRODUCE A CHANGE"
      onClose={onClose}
      variant="sheet"
    >
      <p className="rm-overlay-intro">
        Choose one change. The{" "}
        {snapshot.executionMode === "fixture"
          ? "fixture engine"
          : "live runtime"}{" "}
        decides what happens next.
      </p>
      <div className="rm-preset-list">
        {presets.map((preset) => {
          const used = snapshot.injections.includes(preset.id);
          return (
            <button
              type="button"
              key={preset.id}
              data-preset={preset.id}
              disabled={pending || used}
              onClick={() => onInject(preset.id)}
            >
              <span className="rm-preset-icon">
                <Icon name={preset.icon} />
              </span>
              <span>
                <strong>{preset.title}</strong>
                <small>{preset.description}</small>
              </span>
              {used ? (
                <span className="rm-tag active">Introduced</span>
              ) : (
                <Icon name="arrow" />
              )}
            </button>
          );
        })}
      </div>
      {pending && (
        <p className="rm-inline-status" role="status">
          Waiting for the transport. The board has not been changed locally.
        </p>
      )}
      {error && (
        <p className="rm-inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="rm-sheet-footnote">
        One instance of each change per run. No outbound messages or real team
        actions.
      </p>
    </Overlay>
  );
}

export function Outcome({
  snapshot,
  onMemory,
}: {
  snapshot: Snapshot;
  onMemory: () => void;
}) {
  if (!snapshot.outcome && snapshot.status !== "completed") return null;
  return (
    <section
      className={`rm-outcome ${snapshot.outcome?.success ? "success" : "missed"}`}
      role="status"
    >
      <span className="rm-outcome-symbol">
        <Icon name={snapshot.outcome?.success ? "check" : "info"} />
      </span>
      <div>
        <span className="rm-kicker">
          {snapshot.outcome
            ? snapshot.outcome.success
              ? "DEMO DAY / MADE IT"
              : "DEMO DAY / NOT THIS TIME"
            : "QUARTER FINISHED"}
        </span>
        <h2>{snapshot.outcome?.title ?? "The run is complete."}</h2>
        <p>
          {snapshot.outcome?.reason ??
            "No outcome was reported by the runtime."}
        </p>
      </div>
      <button className="rm-button rm-secondary" onClick={onMemory}>
        Inspect the memory
        <Icon name="arrow" />
      </button>
    </section>
  );
}
