import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon, Portrait, TeamRow } from './components';
import type { AssignmentChange } from './components';
import type { Snapshot, Task } from './types';
import { STUDIO_IMAGE, STUDIO_PEOPLE } from './studio-art';

const taskLabels: Record<Task['status'], string> = {
  planned: 'Up next', active: 'In progress', blocked: 'Blocked', done: 'Complete',
};
const phaseLabels: Record<Snapshot['phase'], string> = {
  planning: 'Ready to make a plan', working: 'Work in motion',
  night: 'Folding working memory', checking: 'Shadow is checking',
  restoring: 'Restoring a source fact', finished: 'The quarter is complete',
};

export function StudioExperience({ snapshot, sprint, changes, onPerson, onTask, onDecision, onMemory }: {
  snapshot: Snapshot;
  sprint: number;
  changes: AssignmentChange[];
  onPerson: (id: string) => void;
  onTask: (id: string) => void;
  onDecision: (id: string) => void;
  onMemory: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  // A different live roster must not be misrepresented by the six illustrated people.
  const matchingRoster = snapshot.team.length === 6 && snapshot.team.every(person =>
    STUDIO_PEOPLE[person.id] && person.name.toLowerCase() === person.id,
  );
  const showRoom = matchingRoster && !imageFailed;
  const tasks = snapshot.tasks.filter(task => task.sprint === sprint);
  const latestDecision = [...snapshot.decisions].reverse().sort((a, b) => b.day - a.day)[0];
  const latestOp = snapshot.memoryOps.at(-1);
  const memoryMoment = ['night', 'checking', 'restoring'].includes(snapshot.phase);
  const check = snapshot.checks.at(-1);
  const focusIds = memoryMoment
    ? (check?.day === snapshot.day ? check.factIds : latestOp?.factIds ?? [])
    : [];
  const latestFact = snapshot.facts.find(fact => focusIds.includes(fact.id))
    ?? [...snapshot.facts].reverse().sort((a, b) => b.learnedDay - a.learnedDay)[0];
  const recentChanges = changes.filter(change => change.day === snapshot.day);
  const running = snapshot.status === 'running';

  return (
    <div className={`studio-experience ${running ? 'studio-running' : 'studio-still'}`}>
      <section className="studio-world" aria-label="Interactive team studio">
        {showRoom ? (
          <div className="studio-room" data-testid="studio-room">
            <img className="studio-room-image" src={STUDIO_IMAGE} width="1536" height="1024"
              alt="Illustrated miniature studio with six fictional teammates. Use the name buttons to inspect their current work."
              fetchPriority="high" onError={() => setImageFailed(true)} />
            <div className="studio-corner-note" aria-hidden="true">
              <span>THE TEAM'S STUDIO</span><strong>Small team.<br />Long memory.</strong>
            </div>
            <svg className="studio-transfer-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {recentChanges.map(change => {
                const from = STUDIO_PEOPLE[change.from], to = STUDIO_PEOPLE[change.to];
                if (!from || !to) return null;
                return <path key={`${change.taskId}-${change.day}`} d={`M${from.x},${from.y} Q50,5 ${to.x},${to.y}`} />;
              })}
            </svg>
            {snapshot.team.map(person => {
              const position = STUDIO_PEOPLE[person.id];
              const work = snapshot.tasks.filter(task => task.ownerId === person.id && task.status === 'active');
              const blocked = snapshot.tasks.some(task => task.ownerId === person.id && task.status === 'blocked');
              const state = blocked ? 'blocked' : work.length ? 'active' : 'idle';
              const caption = blocked ? 'Blocked work' : work.length ? `${work.length} active task` : 'No active task';
              return (
                <button key={person.id} type="button"
                  className={`rm-person studio-person ${state}`}
                  style={{ '--x': `${position.x}%`, '--y': `${position.y}%` } as CSSProperties}
                  aria-label={`Inspect ${person.name}, ${person.role}. ${caption}`}
                  onClick={() => onPerson(person.id)}>
                  <span className="studio-name"><i /><strong>{person.name}</strong><Icon name="chevron" /></span>
                  <span className="studio-person-caption">{caption}</span>
                  <span className="studio-person-tooltip">{person.role}<br />{work[0]?.title ?? caption}</span>
                </button>
              );
            })}
            {memoryMoment && (
              <button className={`studio-memory-moment ${snapshot.phase}`} onClick={onMemory} key={`${snapshot.day}-${snapshot.phase}`}>
                <Icon name={snapshot.phase === 'checking' ? 'shield' : 'memory'} />
                <span><small>DAY {snapshot.day} / MEMORY CHECKPOINT</small><strong>{phaseLabels[snapshot.phase]}</strong>
                  <span>{latestOp ? `${latestOp.op} / ${latestOp.factIds.length} source references` : 'Inspect the reported evidence'}</span></span>
                <Icon name="arrow" />
              </button>
            )}
            <div className="studio-room-footer">
              <span><i />{snapshot.status === 'idle' ? 'Click a teammate to look closer' : snapshot.status === 'paused' ? 'Paused. Take a closer look.' : phaseLabels[snapshot.phase]}</span>
              <span>Illustrated set / simulated team</span>
            </div>
          </div>
        ) : (
          <div className="studio-roster-fallback">
            <p>{imageFailed ? 'Studio artwork unavailable. All team controls still work.' : 'This runtime has a different team. Showing its reported roster.'}</p>
            <TeamRow snapshot={snapshot} onPerson={onPerson} />
          </div>
        )}
        <div className="studio-world-caption">
          <span><Icon name="mark" />{snapshot.team.length} people. One changing plan.</span>
          <span>{snapshot.executionMode === 'fixture' ? 'Scripted results, not a live agent.' : 'State from the connected runtime.'}</span>
        </div>
      </section>
      <aside className="studio-rail" aria-label="Current work and remembered context">
        <section className="studio-mission-intro">
          <span className="rm-kicker">THE MISSION</span>
          <h2>Get to Demo Day.<br /><span>Keep what matters.</span></h2>
          <p>{snapshot.status === 'idle' ? 'Start the quarter, then throw a change into the plan.' : snapshot.status === 'paused' ? 'The clock is stopped. Inspect a task or change the plan.' : snapshot.status === 'completed' ? 'The result is in. Inspect what changed and why.' : 'The plan is moving. Your next change will test its memory.'}</p>
        </section>
        <section className="studio-tasks" aria-label={`Sprint ${sprint} task board`}>
          <div className="studio-section-heading"><h3>SPRINT {String(sprint).padStart(2, '0')} / THE WORK</h3><span>{tasks.length}</span></div>
          {tasks.map(task => {
            const person = snapshot.team.find(member => member.id === task.ownerId);
            const change = changes.find(item => item.taskId === task.id && item.to === task.ownerId);
            return <button key={task.id} type="button" className={`rm-task-card studio-task ${task.status} ${change ? 'was-reassigned' : ''}`}
              onClick={() => onTask(task.id)} aria-label={`Inspect task: ${task.title}. ${task.status}. ${person?.name ?? 'Owner not reported'}`}>
              <span className="studio-task-state"><span className="studio-state-dot">{task.status === 'done' && <Icon name="check" />}</span>
                {taskLabels[task.status]}<small>{task.completedDay !== null ? `Done D${task.completedDay}` : `Due D${task.dueDay}`}</small></span>
              <strong>{task.title}</strong>
              <span className="studio-task-owner">{person && <Portrait person={person} index={snapshot.team.indexOf(person)} small />}
                <span>{person?.name ?? 'Owner not reported'}{change && <small>Reassigned D{change.day}</small>}</span>
                <Icon name="chevron" /></span>
            </button>;
          })}
          {!tasks.length && <p className="studio-empty">No tasks reported for this sprint.</p>}
        </section>
        <section className="studio-memory-preview">
          <div className="studio-section-heading"><h3><Icon name="memory" /> REMEMBERED CONTEXT</h3><span>{snapshot.facts.length}</span></div>
          <button className="studio-fact-preview" onClick={onMemory}>
            <strong>{latestFact?.text ?? 'A change today can matter weeks later.'}</strong>
            <span>{latestFact ? `${latestFact.state} / learned D${latestFact.learnedDay}` : 'Introduce a change after starting.'}<Icon name="arrow" /></span>
            {latestFact && <small>Source: {latestFact.source}</small>}
          </button>
        </section>
        {latestDecision && <button className={`rm-decision studio-last-decision ${latestDecision.state}`} key={latestDecision.id} onClick={() => onDecision(latestDecision.id)}>
          <span className="rm-kicker">LATEST DECISION / DAY {latestDecision.day} / {latestDecision.state}</span>
          <strong>{latestDecision.summary}</strong>
          <span className="rm-evidence-link">{latestDecision.evidenceIds.length} evidence references<Icon name="arrow" /></span>
        </button>}
      </aside>
    </div>
  );
}
