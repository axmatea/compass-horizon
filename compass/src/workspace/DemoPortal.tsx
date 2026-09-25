import { useState } from 'react';
import { createDemo } from './demo';
import TeamTable from './WorkspaceScene';
import type { TaskStatus } from './types';
import './styles.css';
import './portal.css';
import './scene.css';

const tabs = ['Workspace', 'Pipeline', 'Memory', 'Machines'] as const;
const stages: TaskStatus[] = ['todo', 'doing', 'done'];
const labels = { todo: 'Up next', doing: 'In motion', done: 'Complete' };

export default function DemoPortal() {
  const [tab, setTab] = useState<typeof tabs[number]>('Workspace');
  const [snapshot, setSnapshot] = useState(createDemo);
  const [source, setSource] = useState('m2');
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);
  const [notice, setNotice] = useState('');
  function reset() { setSnapshot(createDemo()); setStep(0); setApproved(false); setSource('m2'); setNotice('Demo reset.'); setTab('Workspace'); }
  function approve() {
    if (approved) return;
    setSnapshot(s => ({ ...s, tasks: [...s.tasks, { id: 'access-check', title: 'Verify step-free access before booking', assigneeId: 'maya', status: 'todo', dueDate: '2026-10-05', version: 1 }] }));
    setApproved(true); setNotice('One task added to Pipeline. Local demo only.');
  }
  const material = snapshot.materials.find(m => m.id === source)!;
  const completed = snapshot.tasks.filter(t => t.status === 'done').length;
  return <div className="cp-portal">
    <header className="cp-header"><a className="cp-brand" href="/">COMPASS<span>.</span></a><span className="cp-badge">INTERACTIVE DEMO</span><a href="/app">Real workspace ↗</a></header>
    <div className="cp-shell">
      <aside className="cp-sidebar"><p className="cp-kicker">SUNDAY STUDIO</p><nav aria-label="Demo sections">{tabs.map((name, i) => <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => { setTab(name); setNotice(''); }}><span>0{i + 1}</span>{name}<b>↗</b></button>)}</nav><div className="cp-account"><span className="cp-avatar">MC</span><div><strong>Maya Chen</strong><small>Fictional owner</small></div></div><button className="cp-text" onClick={reset}>Reset demo</button></aside>
      <main className="cp-main"><div className="cp-disclosure">LOCAL SIMULATION · Fictional team and scripted Machines. No live AI or integrations.</div><div className="cp-title"><div><p className="cp-kicker">THE WORK, WITH THE WHY</p><h1>{tab === 'Workspace' ? 'A place for the whole picture.' : tab === 'Pipeline' ? 'From intention to done.' : tab === 'Memory' ? 'Keep the reason, too.' : 'A decision you can inspect.'}</h1></div><span className="cp-date">DEMO DEADLINE<br /><strong>October 18</strong></span></div>
      {notice && <p role="status" className="cp-notice">{notice}</p>}
      {tab === 'Workspace' && <><div className="cp-overview"><TeamTable snapshot={snapshot} demo lastEvent="" onMember={m => setNotice(`${m.name}: fictional ${m.role}. Avatars do not indicate presence.`)} onTask={() => setTab('Pipeline')} onMaterials={() => setTab('Memory')} /><article className="cp-card cp-goal"><p className="cp-kicker">OUR NORTH STAR</p><h2>{snapshot.workspace.goal}</h2><p>Twenty neighbors. A shared meal. A plan everyone can follow.</p><div className="cp-number">{completed}<small> / {snapshot.tasks.length}</small></div><p>Tasks marked complete in this demo</p><button className="cp-primary" onClick={() => setTab('Machines')}>Explore a decision →</button></article></div><div className="cp-summary">{[['Pipeline', `${snapshot.tasks.length} shared tasks`, 'Move a card. See the plan change.'], ['Memory', '2 original sources', 'Trace a decision back to its context.'], ['Machines', approved ? '1 approved example' : '1 decision to explore', 'Inspect a scripted workflow.']].map(([name, value, desc]) => <button className="cp-card" key={name} onClick={() => setTab(name as typeof tabs[number])}><p className="cp-kicker">{name}</p><h2>{value}</h2><p>{desc}</p><span>Open →</span></button>)}</div></>}
      {tab === 'Pipeline' && <><p className="cp-lead">A task pipeline, not a sales CRM. Changes stay in this demo.</p><div className="cp-board">{stages.map((status, index) => <section className="cp-column" key={status}><h2><span className={`cp-dot cp-${status}`} />{labels[status]}<small>{snapshot.tasks.filter(t => t.status === status).length}</small></h2>{snapshot.tasks.filter(t => t.status === status).map(task => <article className="cp-task" key={task.id}><p className="cp-kicker">{task.dueDate}</p><h3>{task.title}</h3><p>{snapshot.members.find(m => m.userId === task.assigneeId)?.name}</p><button onClick={() => setSnapshot(s => ({ ...s, tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: stages[(index + 1) % 3], version: t.version + 1 } : t) }))}>{status === 'done' ? 'Reopen' : `Move to ${labels[stages[index + 1]]}`} →</button></article>)}{!snapshot.tasks.some(t => t.status === status) && <p className="cp-empty">Nothing here yet.</p>}</section>)}</div></>}
      {tab === 'Memory' && <div className="cp-memory"><section><p className="cp-lead">Original notes, not a claim of lossless AI memory.</p>{snapshot.materials.map(m => <button className={`cp-card cp-source ${source === m.id ? 'cp-selected' : ''}`} key={m.id} onClick={() => setSource(m.id)} aria-pressed={source === m.id}><p className="cp-kicker">SOURCE / {m.authorId === 'maya' ? 'MAYA' : 'LEO'}</p><h2>{m.title}</h2><p>Original text · September 25</p></button>)}<div className="cp-card"><p className="cp-kicker">DECISION TRAIL / SCRIPTED</p><p>Venue conversation → Accessibility check → {approved ? 'Task approved by you in this demo' : 'Awaiting your approval'}</p><button className="cp-text" onClick={() => setTab('Machines')}>Inspect decision →</button></div></section><article className="cp-card cp-document"><p className="cp-kicker">ORIGINAL SOURCE / {material.id}</p><h2>{material.title}</h2><pre>{material.content}</pre><p className="cp-fine">Synthetic example. No external document or personal data was imported.</p></article></div>}
      {tab === 'Machines' && <><p className="cp-lead">A visual prototype of an agent workflow. Advance each scripted step yourself. No model is running.</p><div className="cp-machine-grid">{['Read context', 'Check constraints', 'Propose next step'].map((name, i) => <article className={`cp-card cp-machine ${step > i ? 'cp-checked' : ''}`} key={name}><span className="cp-step">0{i + 1}</span><p className="cp-kicker">{step > i ? 'EXAMPLE REVEALED' : 'SCRIPTED STEP'}</p><h2>{name}</h2><p>{['Read the brief and venue note.', 'Booking needs an accessibility check.', 'Ask Maya to verify access before booking.'][i]}</p></article>)}</div><div className="cp-machine-action">{step < 3 ? <button className="cp-primary" onClick={() => setStep(n => Math.min(n + 1, 3))}>{step === 0 ? 'Play scripted example' : 'Reveal next step'} →</button> : <section className="cp-card cp-proposal"><div><p className="cp-kicker">SCRIPTED PROPOSAL / OWNER REVIEW</p><h2>Verify access before committing.</h2><p>Add a task for Maya to check the step-free entrance and restroom. No venue booking will be made.</p><button className="cp-text" onClick={() => { setSource('m2'); setTab('Memory'); }}>Read source: Venue conversation →</button></div><button className="cp-primary" disabled={approved} onClick={approve}>{approved ? 'Added to demo plan' : 'Approve demo task →'}</button></section>}</div></>}
      </main></div>
  </div>;
}
