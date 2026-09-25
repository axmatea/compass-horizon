import { useEffect, useReducer, useRef, useState } from 'react';
import type { Material, Task, TaskStatus } from '../workspace/types.ts';
import { ACCESSIBILITY_TASK_ID, ACCESSIBILITY_TITLE, createMission, missionReducer, SOURCE_ID } from './model.ts';
import './styles.css';

const views = ['Workspace', 'Pipeline', 'Memory', 'Machines', 'Horizon'] as const;
type View = typeof views[number];
const statuses: { id: TaskStatus; label: string; symbol: string }[] = [
  { id: 'todo', label: 'To do', symbol: '○' },
  { id: 'doing', label: 'In progress', symbol: '◐' },
  { id: 'done', label: 'Done', symbol: '✓' },
];
const descriptions: Record<View, string> = {
  Workspace: 'The people, context, and next steps behind one shared plan.',
  Pipeline: 'From something said to something agreed. Nothing skips the owner.',
  Memory: 'Keep the original words beside the decisions they inform.',
  Machines: 'A scripted assistant proposes. A person decides what enters the plan.',
  Horizon: 'A separate experiment, not your team’s activity or performance.',
};

function Icon({ name }: { name: View | 'source' | 'arrow' }) {
  const paths = {
    Workspace: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M9 10h12" /></>,
    Pipeline: <><path d="M4 5h16M7 12h10M10 19h4M12 5v14" /></>,
    Memory: <><path d="M5 3h11l3 3v15H5zM9 9h6M9 13h6M9 17h4" /></>,
    Machines: <><rect x="5" y="6" width="14" height="12" rx="3" /><path d="M9 10v4M15 10v4M9 3v3M15 3v3M9 18v3M15 18v3M2 10h3M19 10h3" /></>,
    Horizon: <><path d="M2 17h20M4 13a8 8 0 0116 0M12 2v2M3 6l2 2M21 6l-2 2" /></>,
    source: <><path d="M5 3h10l4 4v14H5zM14 3v5h5M9 12h6M9 16h6" /></>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function shortDate(date: string | null) {
  if (!date) return 'No date';
  const [, month, day] = date.split('-');
  return `${month === '10' ? 'Oct' : 'Sep'} ${Number(day)}`;
}

export default function App() {
  const [state, dispatch] = useReducer(missionReducer, undefined, createMission);
  const [view, setView] = useState<View>('Workspace');
  const [person, setPerson] = useState('all');
  const [sourceId, setSourceId] = useState(SOURCE_ID);
  const [openSource, setOpenSource] = useState<Material | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(view);
  const { snapshot, step } = state;
  const source = snapshot.materials.find(item => item.id === sourceId) ?? snapshot.materials[0];
  const venue = snapshot.materials.find(item => item.id === SOURCE_ID)!;
  const completed = snapshot.tasks.filter(task => task.status === 'done').length;
  const inspected = step !== 'ready';
  const proposed = step === 'proposed' || step === 'approved';
  const approved = step === 'approved';

  useEffect(() => {
    if (openSource && !dialog.current?.open) dialog.current?.showModal();
    if (!openSource && dialog.current?.open) dialog.current.close();
  }, [openSource]);

  useEffect(() => {
    if (previousView.current !== view) heading.current?.focus();
    previousView.current = view;
  }, [view]);

  function reset() {
    dispatch({ type: 'reset' });
    setPerson('all');
    setSourceId(SOURCE_ID);
    setOpenSource(null);
    setView('Workspace');
  }

  function inspect() {
    dispatch({ type: 'inspect' });
    setOpenSource(venue);
  }

  function taskCard(task: Task) {
    const member = snapshot.members.find(item => item.userId === task.assigneeId);
    return <article className={`ms-task ${task.id === ACCESSIBILITY_TASK_ID ? 'ms-task-confirmed' : ''}`} key={task.id}>
      <div className="ms-task-top"><span className="ms-task-id">SS-{task.id === ACCESSIBILITY_TASK_ID ? '05' : task.id.slice(1).padStart(2, '0')}</span>
        {task.id === ACCESSIBILITY_TASK_ID && <span className="ms-small-tag">Owner confirmed</span>}
        {task.id === 't2' && <span className="ms-small-tag">Venue</span>}
      </div>
      <h4>{task.title}</h4>
      {task.id === ACCESSIBILITY_TASK_ID && <button className="ms-text-button ms-task-source" onClick={() => setOpenSource(venue)}><Icon name="source" /> Venue conversation</button>}
      <div className="ms-task-meta"><span>{member?.name.split(' ')[0] ?? 'Unassigned'}</span><span>{shortDate(task.dueDate)}</span></div>
      <label className="ms-status-control"><span className="ms-sr-only">Status for {task.title}</span>
        <select value={task.status} onChange={event => dispatch({ type: 'move', id: task.id, status: event.target.value as TaskStatus })}>
          {statuses.map(status => <option value={status.id} key={status.id}>{status.label}</option>)}
        </select>
      </label>
    </article>;
  }

  function sourceReader() {
    return <article className="ms-document">
      <div className="ms-document-top"><span className="ms-eyebrow">Original source · Synthetic</span><Icon name="source" /></div>
      <h3>{source.title}</h3>
      <p className="ms-document-byline">{snapshot.members.find(member => member.userId === source.authorId)?.name} · September 25, 2026</p>
      <div className="ms-document-body">{source.content}</div>
      <button className="ms-text-button" onClick={() => setOpenSource(source)}>Open full source <Icon name="arrow" /></button>
    </article>;
  }

  return <div className="ms-app">
    <a className="ms-skip" href="#mission-main">Skip to workspace</a>
    <header className="ms-header">
      <a className="ms-wordmark" href="/" aria-label="COMPASS home">COMPASS<span className="ms-mark-dot">.</span></a>
      <div className="ms-header-context"><span className="ms-header-divider" />A shared place for the work.</div>
      <nav className="ms-header-links" aria-label="Product links">
        <a href="/presentation">Presentation</a><a href="/horizon">Horizon</a><a className="ms-secondary-link" href="/voice-demo">Voice demo</a><a className="ms-account-link" href="/app">Real account <span aria-hidden="true">↗</span></a>
      </nav>
    </header>

    <div className="ms-shell">
      <aside className="ms-sidebar">
        <div className="ms-workspace-label"><span className="ms-project-monogram" aria-hidden="true">S</span><div><strong>Sunday studio</strong><span>Example team workspace</span></div></div>
        <nav className="ms-nav" aria-label="Workspace sections">
          {views.map(item => <button key={item} aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}><Icon name={item} /><span>{item}</span>{item === 'Machines' && step === 'proposed' && <span className="ms-nav-count" aria-label="1 proposal">1</span>}</button>)}
        </nav>
        <section className="ms-team" aria-labelledby="ms-team-heading"><h2 id="ms-team-heading" className="ms-eyebrow">People on this project</h2>
          {snapshot.members.map(member => <div className="ms-person" key={member.userId}><span className="ms-person-initials" aria-hidden="true">{member.name.split(' ').map(word => word[0]).join('')}</span><div><strong>{member.name}</strong><span>{member.role === 'owner' ? 'Owner · confirms the plan' : 'Member · shapes the work'}</span></div></div>)}
        </section>
        <div className="ms-sidebar-bottom"><span className="ms-eyebrow">The boundary is clear</span><p>People own the decisions.<br />Machines can only propose.</p><div className="ms-runtime"><span aria-hidden="true">◇</span> Private AI runtime unavailable</div></div>
      </aside>

      <main id="mission-main" className="ms-main" tabIndex={-1}>
        <div className="ms-demo-bar"><p><strong>Synthetic local demo</strong><span>No live AI. No server persistence. Refresh clears changes.</span></p><button className="ms-reset" onClick={reset}>Reset demo <span aria-hidden="true">↺</span></button></div>
        <div className="ms-main-inner">
          <div className="ms-breadcrumb">Sunday studio <span>/</span> {view}</div>
          <section className="ms-project-heading"><div><span className="ms-eyebrow">Neighborhood gathering / October 18, 2026</span><h1 ref={heading} tabIndex={-1}>{view === 'Workspace' ? 'Good work, together.' : view === 'Machines' ? 'A proposal. Not a decision.' : view === 'Memory' ? 'Context worth keeping.' : view === 'Pipeline' ? 'From source to shared plan.' : 'Beyond this workspace.'}</h1><p>{descriptions[view]}</p></div><div className="ms-project-stamp"><span className="ms-eyebrow">Sunday studio</span><span>20 neighbors.<br />One shared table.</span></div></section>

          {view === 'Workspace' && <div className="ms-workspace-grid">
            <section className="ms-board-area" aria-labelledby="ms-board-heading">
              <div className="ms-section-heading"><div><h2 id="ms-board-heading">The shared plan <span>{snapshot.tasks.length}</span></h2><p>Bring the neighborhood to the table.</p></div><label className="ms-filter"><span className="ms-sr-only">Filter tasks by person</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="all">Everyone</option>{snapshot.members.map(member => <option key={member.userId} value={member.userId}>{member.name.split(' ')[0]}</option>)}</select></label></div>
              <div className="ms-board-progress"><span>{completed} of {snapshot.tasks.length} tasks complete</span><progress value={completed} max={snapshot.tasks.length} aria-label="Tasks completed" /></div>
              <div className="ms-board">{statuses.map(status => {
                const tasks = snapshot.tasks.filter(task => task.status === status.id && (person === 'all' || task.assigneeId === person));
                return <section key={status.id} className={`ms-column ms-column-${status.id}`} aria-labelledby={`ms-column-${status.id}`}><h3 id={`ms-column-${status.id}`}><span className="ms-status-symbol" aria-hidden="true">{status.symbol}</span>{status.label}<span className="ms-column-count">{tasks.length}</span></h3><div className="ms-task-stack">{tasks.map(taskCard)}{tasks.length === 0 && <p className="ms-empty-column">{person === 'all' ? 'No tasks here yet.' : 'No tasks for this person.'}<span>Move a task using its status menu.</span></p>}</div></section>;
              })}</div>
              <div className="ms-board-note"><span aria-hidden="true">↳</span> Change any task’s status to move it. Every change stays in this session.</div>
              <section className="ms-next-decision"><div className="ms-decision-number">01</div><div><span className="ms-eyebrow">{approved ? 'Decision recorded locally' : 'The next decision'}</span><h3>{approved ? 'Accessibility is now part of the plan.' : 'A welcoming venue starts with access.'}</h3><p>{approved ? 'Maya confirmed one task, linked to Leo’s original note.' : 'Leo’s venue note needs a check before anyone confirms the booking.'}</p></div><button className="ms-button" onClick={() => setView('Machines')}>{approved ? 'View decision' : 'Review with Machines'}<Icon name="arrow" /></button></section>
            </section>
            <aside className="ms-source-rail" aria-label="Project source material"><div className="ms-section-heading"><h2>Behind the work <span>2</span></h2><button className="ms-text-button" onClick={() => setView('Memory')}>All sources</button></div><div className="ms-source-tabs" role="group" aria-label="Select a source">{snapshot.materials.map(item => <button key={item.id} aria-pressed={sourceId === item.id} onClick={() => setSourceId(item.id)}>{item.id === SOURCE_ID ? 'Venue note' : 'Project brief'}</button>)}</div>{sourceReader()}<div className="ms-source-footnote"><span className="ms-eyebrow">Source → proposal → confirmation</span><p>The original note stays intact.<br />Only an owner-confirmed task enters the plan.</p></div></aside>
          </div>}

          {view === 'Pipeline' && <section aria-labelledby="ms-pipeline-heading"><div className="ms-section-heading"><h2 id="ms-pipeline-heading">One decision, end to end</h2><span className="ms-muted">Venue accessibility</span></div><div className="ms-pipeline">{[
            { label: 'Source', number: '01', state: 'Available', title: 'Leo adds context', text: 'The venue requires a written accessibility check before confirmation.', action: 'Read the venue note', click: () => setOpenSource(venue), active: true },
            { label: 'Proposal', number: '02', state: proposed ? 'Prepared' : 'Not yet proposed', title: 'A machine suggests', text: 'A fixed example turns the requirement into one reviewable task.', action: proposed ? 'View proposal' : 'Inspect & propose', click: () => setView('Machines'), active: proposed },
            { label: 'Confirmation', number: '03', state: approved ? 'Confirmed locally' : 'Owner required', title: 'Maya decides', text: 'The demo owner explicitly chooses whether to add the proposed task.', action: approved ? 'Read decision' : 'Review as demo owner', click: () => setView('Machines'), active: approved },
            { label: 'Plan', number: '04', state: approved ? 'One task added' : 'Unchanged', title: 'Everyone sees the next step', text: 'The confirmed accessibility task belongs to Maya, with the source attached.', action: 'Open shared plan', click: () => setView('Workspace'), active: approved },
          ].map(item => <article key={item.number} className={`ms-pipeline-card ${item.active ? 'is-active' : ''}`}><div className="ms-pipeline-number">{item.number}<Icon name="arrow" /></div><span className="ms-eyebrow">{item.label}</span><h3>{item.title}</h3><p>{item.text}</p><span className="ms-pipeline-state">{item.state}</span><button className="ms-text-button" onClick={item.click}>{item.action}<Icon name="arrow" /></button></article>)}</div><div className="ms-boundary-note"><strong>No hidden steps.</strong> This is a synthetic project workflow, not a sales pipeline. Nothing is booked, sent, or executed.</div></section>}

          {view === 'Memory' && <div className="ms-memory-grid"><section aria-labelledby="ms-memory-heading"><div className="ms-section-heading"><h2 id="ms-memory-heading">Source library <span>2</span></h2><span className="ms-muted">Synthetic documents</span></div><div className="ms-source-list">{snapshot.materials.map(item => <button className="ms-source-row" key={item.id} aria-pressed={sourceId === item.id} onClick={() => setSourceId(item.id)}><Icon name="source" /><span><strong>{item.title}</strong><small>{snapshot.members.find(member => member.userId === item.authorId)?.name} · Sep 25</small></span><Icon name="arrow" /></button>)}</div><section className="ms-decision-log"><span className="ms-eyebrow">Decision record / This session</span><h3>{approved ? 'An explicit yes, with the context attached.' : 'No owner confirmation yet.'}</h3><p>{approved ? 'Maya confirmed the scripted accessibility proposal. One task was added, due October 5. The original venue note has not been changed.' : 'Reading a source does not change the plan. A decision appears here only after the demo owner confirms the proposal.'}</p><button className="ms-text-button" onClick={() => setView(approved ? 'Workspace' : 'Machines')}>{approved ? 'View the task' : 'Review the example'}<Icon name="arrow" /></button></section></section>{sourceReader()}</div>}

          {view === 'Machines' && <section aria-labelledby="ms-machines-heading"><div className="ms-machine-banner"><div><h2 id="ms-machines-heading">Venue accessibility check</h2><p>A prewritten walkthrough. No model runs, paid calls, or autonomous actions.</p></div><span className="ms-small-tag">Scripted example</span></div><ol className="ms-machine-steps">
            <li className={inspected ? 'is-complete' : 'is-current'}><span className="ms-step-number">01</span><div className="ms-step-content"><span className="ms-eyebrow">Inspect the evidence</span><h3>Start with what Leo actually said.</h3><blockquote>“The venue needs a written accessibility check before we confirm.”</blockquote><p>Source: Venue conversation · Leo Martin · September 25</p><button className="ms-button" onClick={inspect}>{inspected ? 'Inspect source again' : 'Inspect source'}<Icon name="source" /></button></div><span className="ms-step-state">{inspected ? 'Inspected' : 'Start here'}</span></li>
            <li className={proposed ? 'is-complete' : inspected ? 'is-current' : ''}><span className="ms-step-number">02</span><div className="ms-step-content"><span className="ms-eyebrow">Create a proposal</span><h3>Make the missing step reviewable.</h3><p>This button reveals a fixed proposal based on the source. It does not generate AI output or add a task.</p>{proposed ? <div className="ms-proposal"><span className="ms-eyebrow">Proposed task</span><strong>{ACCESSIBILITY_TITLE}</strong><span>Maya Chen · To do · October 5, 2026</span><small>The assignee and date are scripted suggestions for this demo.</small></div> : <button className="ms-button" disabled={!inspected} onClick={() => dispatch({ type: 'propose' })}>Create scripted proposal<Icon name="arrow" /></button>}{!inspected && <small className="ms-prerequisite">Inspect the source to unlock this step.</small>}</div><span className="ms-step-state">{proposed ? 'Prepared' : 'Proposal only'}</span></li>
            <li className={approved ? 'is-complete' : proposed ? 'is-current' : ''}><span className="ms-step-number">03</span><div className="ms-step-content"><span className="ms-eyebrow">Owner confirms</span><h3>{approved ? 'One task added. The source stays attached.' : 'Only a person can update the plan.'}</h3><p>{approved ? 'Confirmed as fictional owner Maya. You can move the new task on the board. Approving never confirms the venue booking.' : 'You are acting as Maya, the fictional owner. Confirmation adds one local accessibility task, not a booking.'}</p>{approved ? <button className="ms-button ms-button-gold" onClick={() => setView('Workspace')}>View updated plan<Icon name="arrow" /></button> : <button className="ms-button ms-button-gold" disabled={!proposed} onClick={() => dispatch({ type: 'approve' })}>Confirm as demo owner<Icon name="arrow" /></button>}{!proposed && <small className="ms-prerequisite">Create the proposal before confirming.</small>}</div><span className="ms-step-state">{approved ? 'Confirmed locally' : 'Human approval'}</span></li>
          </ol><div className="ms-boundary-note"><strong>Demo, not a connected runtime.</strong> Private workspace AI is unavailable. No integrations, learning, or revenue outcomes are claimed. Reset clears this decision and every local task change.</div></section>}

          {view === 'Horizon' && <section className="ms-horizon-panel" aria-labelledby="ms-horizon-heading"><div className="ms-horizon-rule" aria-hidden="true"><span /><span /><span /></div><span className="ms-eyebrow">Companion experience / Separate simulation</span><h2 id="ms-horizon-heading">A longer view.<br /><em>A different experiment.</em></h2><p>Horizon compares two simulated paths in an A/B experiment. It does not read this workspace, report team performance, or run a live AI system.</p><div className="ms-horizon-disclaimer">All percentages and the $18k figure are illustrative scenario values, not measured results, earnings, or forecasts. This workspace makes no paid calls.</div><a className="ms-button ms-button-gold" href="/horizon">Open separate Horizon demo <span aria-hidden="true">↗</span></a><span className="ms-muted">Your local workspace does not sync with Horizon.</span></section>}

          <footer className="ms-footer"><span>COMPASS / Made for the people doing the work.</span><span>Fictional team. Local session. Human decisions.</span></footer>
        </div>
      </main>
    </div>
    <div className="ms-announcement" role="status" aria-live="polite" aria-atomic="true">{state.notice}</div>
    <dialog className="ms-source-dialog" ref={dialog} aria-labelledby="ms-dialog-title" onClose={() => setOpenSource(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="ms-dialog-inner"><div className="ms-dialog-heading"><span className="ms-eyebrow">Source viewer / Synthetic document</span><button className="ms-button" onClick={() => dialog.current?.close()} autoFocus>Close <span aria-hidden="true">×</span></button></div><h2 id="ms-dialog-title">{openSource?.title}</h2><p className="ms-muted">{snapshot.members.find(member => member.userId === openSource?.authorId)?.name} · September 25, 2026</p><div className="ms-full-source">{openSource?.content}</div><p className="ms-dialog-note">Source text is evidence, not permission to act. This document is fictional and read-only.</p></div>
    </dialog>
  </div>;
}
