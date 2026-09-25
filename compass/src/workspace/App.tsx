import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Avatar, TeamTable } from './TeamTable.tsx';
import { parseTaskCSV, validateUpload } from './parsers.ts';
import type { Material, Member, Task, TaskInput, TaskStatus } from './types.ts';
import { useWorkspace } from './useWorkspace.ts';
import { commandId } from './api.ts';
import './styles.css';

type Drawer = { kind: 'task'; task?: Task } | { kind: 'member'; member: Member } | { kind: 'material'; material: Material } | { kind: 'materials' | 'context' | 'create' | 'invite' | 'upload' | 'proposal' | 'members' | 'activity' };
type Upload = { name: string; content: string; tasks: (TaskInput & { commandId: string })[] | null; commandId: string; sourceSaved: boolean };
const statusNames: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', done: 'Done' };
const ignore = () => {};
function dateLabel(date: string | null) {
  if (!date) return 'No deadline';
  const parsed = new Date(date.length === 10 ? `${date}T12:00:00` : date);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : date;
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />, arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />, check: <path d="m5 12 4 4L19 6" />,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></>,
    context: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    team: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v5m10-5v5M3 11h18m-13 5h3" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3" /></>,
    compass: <><circle cx="12" cy="12" r="10" /><path d="m16 7-3 7-6 3 3-7Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.context}</svg>;
}

function DrawerShell({ title, children, onClose, error, locked }: { title: string; children: ReactNode; onClose: () => void; error: string; locked: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog className="cw-drawer" ref={dialog} onCancel={e => { if (locked) e.preventDefault(); }} onClose={onClose} aria-labelledby="cw-drawer-title" onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose(); } }}>
    <header className="cw-drawer-header"><span className="cw-eyebrow">COMPASS / YOUR WORKSPACE</span><button className="cw-icon-button" disabled={locked} onClick={onClose} aria-label="Close drawer"><Icon name="close" /></button></header>
    <h2 id="cw-drawer-title">{title}</h2>
    {error && <div role="alert" className="cw-error">{error}</div>}
    {children}
  </dialog>;
}

function TaskEditor({ task, members, busy, onSave, onDelete }: { task?: Task; members: Member[]; busy: boolean; onSave: (input: TaskInput) => Promise<void>; onDelete: () => Promise<void> }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) { (event.currentTarget.elements.namedItem('title') as HTMLInputElement).setCustomValidity('Enter a task title.'); return; }
    onSave({ title, assigneeId: String(form.get('assigneeId') || '') || null, status: form.get('status') as TaskStatus, dueDate: String(form.get('dueDate') || '') || null }).catch(ignore);
  };
  return <form className="cw-form" onSubmit={submit}>
    <p className="cw-muted">A clear next step, with someone to carry it forward.</p>
    <label>Task title<input name="title" required maxLength={240} defaultValue={task?.title} onInput={e => e.currentTarget.setCustomValidity('')} placeholder="What needs to happen?" /></label>
    <label>Assigned to<select name="assigneeId" defaultValue={task?.assigneeId ?? ''}><option value="">Unassigned</option>{members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
    <div className="cw-form-row"><label>Status<select name="status" defaultValue={task?.status ?? 'todo'}>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Due date<input type="date" name="dueDate" defaultValue={task?.dueDate?.slice(0, 10) ?? ''} /></label></div>
    {task && <p className="cw-fine">Editing version {task.version}. Conflicting changes are never silently overwritten.</p>}
    <button className="cw-primary" disabled={busy} type="submit">{busy ? 'Saving...' : task ? 'Save changes' : 'Create task'}<Icon name="arrow" /></button>
    {task && <div className="cw-delete-zone">{confirmDelete ? <><p>Delete this task permanently?</p><button className="cw-danger" type="button" disabled={busy} onClick={() => onDelete().catch(ignore)}>Confirm delete</button><button className="cw-quiet" type="button" onClick={() => setConfirmDelete(false)}>Keep task</button></> : <button className="cw-quiet cw-danger-text" type="button" onClick={() => setConfirmDelete(true)}>Delete task</button>}</div>}
  </form>;
}

export default function App() {
  // /app always remains live, even when someone adds ?demo to its URL.
  const [demo] = useState(() => !/^\/app\/?$/.test(window.location.pathname));
  const model = useWorkspace(demo);
  const { snapshot, busy } = model;
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [upload, setUpload] = useState<Upload | null>(null);
  const [importing, setImporting] = useState(false);
  const importLock = useRef(false);
  const selectedRef = useRef(model.selectedId);
  selectedRef.current = model.selectedId;
  const [imported, setImported] = useState(0);
  const [inviteResult, setInviteResult] = useState<{ token: string; expiresAt: string; signupRequired: boolean } | null>(null);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('workspaceInvite') ?? '');
  const [approved, setApproved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const open = (next: Drawer) => { model.setError(''); setNotice(''); setDrawer(next); };
  const close = () => { if (!importLock.current) setDrawer(null); };
  const success = (message: string) => { setDrawer(null); setNotice(demo ? `${message} Saved for this demo session only.` : message); };
  useEffect(() => { document.title = 'COMPASS | A shared direction'; }, []);
  useEffect(() => { setDrawer(null); setApproved(false); setInviteResult(null); setUpload(null); setNotice(''); }, [model.selectedId]);
  const hasSnapshot = !!snapshot;
  useEffect(() => {
    if (!hasSnapshot) { setDrawer(null); setUpload(null); setInviteResult(null); setNotice(''); }
  }, [hasSnapshot]);
  useEffect(() => {
    const target = window as Window & { render_game_to_text?: () => string };
    target.render_game_to_text = () => JSON.stringify({ product: 'COMPASS', mode: demo ? 'LOCAL_DEMO' : 'LIVE', connection: model.connection, busy: busy || importing, workspace: snapshot?.workspace ?? null,
      members: snapshot?.members.map(m => ({ id: m.userId, name: m.name, role: m.role })) ?? [], tasks: snapshot?.tasks ?? [], materialCount: snapshot?.materials.length ?? 0,
      eventCount: snapshot?.events.length ?? 0, seq: snapshot?.seq ?? null, lastEvent: model.lastEvent, ai: { status: 'BLOCKED', reason: snapshot?.ai.reason ?? 'No verified workspace connection.' }, drawer: drawer?.kind ?? null, error: model.error });
    return () => { delete target.render_game_to_text; };
  }, [snapshot, demo, model.connection, busy, importing, model.lastEvent, model.error, drawer]);

  async function readUpload(file?: File) {
    if (!file || !snapshot) return;
    const selected = model.selectedId;
    try {
      const kind = validateUpload(file);
      const content = await file.text();
      if (selected !== selectedRef.current) return;
      if (!content.trim()) throw new Error('This file has no content.');
      if (content.includes('\u0000') || content.includes('\uFFFD')) throw new Error('Choose a valid UTF-8 text file. Binary or invalid text is not supported.');
      const tasks = kind === 'csv' ? parseTaskCSV(content, snapshot.members.map(m => m.userId)).map(t => ({ ...t, commandId: commandId() })) : null;
      setUpload({ name: file.name, content, tasks, commandId: commandId(), sourceSaved: false }); setImported(0); open({ kind: 'upload' });
    } catch (e) { model.setError(e instanceof Error ? e.message : 'Could not read this file.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  async function confirmUpload() {
    if (!upload || importLock.current) return;
    importLock.current = true; setImporting(true);
    const workspaceId = model.selectedId;
    try {
      if (!upload.sourceSaved) {
        await model.addMaterial(upload.name, upload.content, upload.commandId);
        if (selectedRef.current !== workspaceId) return;
        setUpload(previous => previous ? { ...previous, sourceSaved: true } : previous);
      }
      if (upload.tasks) {
        const tasks = [...upload.tasks];
        for (let i = 0; i < tasks.length; i++) {
          if (selectedRef.current !== workspaceId) return;
          const { commandId: rowId, ...input } = tasks[i];
          await model.addTask(input, rowId);
          if (selectedRef.current !== workspaceId) return;
          setImported(count => count + 1);
          setUpload(previous => previous ? { ...previous, tasks: tasks.slice(i + 1) } : previous);
        }
        success(`${tasks.length} tasks imported.`);
      } else { success('Material added.'); }
      setUpload(null);
    } catch { /* Retain only unconfirmed rows; the API layer reports the failure. */ }
    finally { importLock.current = false; setImporting(false); }
  }
  const filteredTasks = snapshot?.tasks.filter(t => (filter === 'all' || t.status === filter) && t.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  const done = snapshot?.tasks.filter(t => t.status === 'done').length ?? 0;
  const total = snapshot?.tasks.length ?? 0;
  const inviteParams = inviteResult ? new URLSearchParams({ returnTo: '/app', workspaceInvite: inviteResult.token, ...(inviteResult.signupRequired ? { token: inviteResult.token } : {}) }) : null;
  const inviteLink = inviteParams ? `${window.location.origin}/login?${inviteParams}` : '';
  const loginParams = new URLSearchParams({ returnTo: '/app', ...(inviteToken ? { workspaceInvite: inviteToken } : {}) });
  const drawerTitle = drawer?.kind === 'task' ? drawer.task ? 'A little more detail.' : 'Make the next move.' : drawer?.kind === 'member' ? drawer.member.name : drawer?.kind === 'material' ? drawer.material.title : ({ materials: 'The shared context.', context: 'Put it on the table.', create: 'Start something together.', invite: 'Make room for someone.', upload: 'A look before it lands.', proposal: 'A decision, with context.', members: 'Your people.', activity: 'What changed.' } as Record<string, string>)[drawer?.kind ?? ''];

  return <div className="cw-app">
    <a className="cw-skip" href="#cw-main">Skip to workspace</a>
    <header className="cw-topbar"><a href="/" className="cw-brand" aria-label="COMPASS home"><Icon name="compass" size={28} />COMPASS<span className="cw-brand-period">.</span></a>
      <span className="cw-topbar-note">A shared direction.</span><div className="cw-topbar-right"><span className={`cw-mode ${demo ? 'is-demo' : ''}`}>{demo ? 'LOCAL DEMO' : 'TEAM WORKSPACE'}</span><a className="cw-mode-link" aria-label={demo ? 'Your workspace' : 'Explore demo'} href={demo ? '/app' : '/?demo'}>{demo ? 'Your workspace' : 'Explore demo'}<Icon name="arrow" size={15} /></a>{!demo && <button className="cw-sign-out" disabled={busy || importing} onClick={() => model.signOut().catch(ignore)}>Sign out</button>}</div>
    </header>
    <div className="cw-mode-banner">{demo ? <><strong>A little space to try things.</strong><span>Fictional team. Local changes reset on reload. No APIs or live AI.</span></> : <><Icon name="lock" size={14} /><span>Private collaboration</span><span className="cw-connection">{model.connection}{busy ? ' / Saving changes' : ''}</span></>}</div>
    <main id="cw-main" className="cw-main">
      {(demo || model.authRequired) && <p className="cw-fine"><a href="/demo/workspace">Open demo account: Pipeline, Memory &amp; Machines →</a></p>}
      <div className="cw-project-nav"><div className="cw-workspace-picker"><Icon name="context" size={17} /><label className="cw-sr-only" htmlFor="cw-workspace-select">Select workspace</label><select id="cw-workspace-select" disabled={busy || importing || !model.workspaces.length} value={model.selectedId} onChange={e => model.setSelectedId(e.target.value)}>{!model.workspaces.length && <option value="">Your workspaces</option>}{model.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div><button className="cw-quiet" onClick={() => open({ kind: 'create' })} disabled={busy || importing}><Icon name="plus" size={16} />New project</button><span className="cw-project-spacer" /><button className="cw-quiet" onClick={() => open({ kind: 'activity' })} disabled={!snapshot}>Activity<Icon name="arrow" size={15} /></button></div>
      {!demo && inviteToken && <section className="cw-invite-banner"><div><strong>You have a workspace invitation.</strong><p>Accept only if you recognize the person who shared it. Nothing is joined automatically.</p></div><button className="cw-primary" disabled={busy} onClick={() => model.acceptInvite(inviteToken).then(() => { setInviteToken(''); setNotice('Invitation accepted.'); }).catch(ignore)}>Accept invitation</button></section>}
      {model.error && <div className="cw-error" role="alert"><span>{model.error}</span>{model.authRequired ? <a href={`/login?${loginParams}`}>Sign in</a> : !demo && <button className="cw-quiet" disabled={busy} onClick={() => model.retry().catch(ignore)}>Refresh workspace</button>}</div>}
      {notice && <div className="cw-notice" role="status"><Icon name="check" size={17} /><span>{notice}</span><button className="cw-icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><Icon name="close" size={15} /></button></div>}
      {snapshot ? <>
        <section className="cw-heading"><div><p className="cw-eyebrow">SMALL TEAM. SHARED AMBITION.</p><h1>{snapshot.workspace.name}<span>.</span></h1><p className="cw-goal">{snapshot.workspace.goal || 'Give your next project a shared direction.'}</p></div><div className="cw-deadline"><Icon name="calendar" size={19} /><div><span>THE SHARED DEADLINE</span><strong>{dateLabel(snapshot.workspace.deadline)}</strong></div></div></section>
        <div className="cw-workspace-grid"><div className="cw-left-column"><TeamTable snapshot={snapshot} onMember={member => open({ kind: 'member', member })} onTask={task => open({ kind: 'task', task })} onMaterials={() => open({ kind: 'materials' })} lastEvent={model.lastEvent} demo={demo} />
          <div className="cw-table-footer"><div className="cw-member-stack">{snapshot.members.slice(0, 4).map((m, i) => <button key={m.userId} onClick={() => open({ kind: 'member', member: m })} aria-label={`View ${m.name}`}><Avatar name={m.name} variant={i} small /></button>)}<button className="cw-team-count" onClick={() => open({ kind: 'members' })}>{snapshot.members.length} {snapshot.members.length === 1 ? 'person' : 'people'}, one team<Icon name="arrow" size={14} /></button></div><button className="cw-quiet" onClick={() => open({ kind: 'invite' })}><Icon name="plus" size={16} />Invite someone</button></div>
        </div>
        <aside className="cw-side-rail" aria-label="Shared goal and context"><section className="cw-direction"><div className="cw-section-label"><span className="cw-eyebrow">OUR NORTH STAR</span><Icon name="compass" size={19} /></div><h2>{snapshot.workspace.goal || 'A shared direction starts here.'}</h2><div className="cw-progress-label"><span>Tasks completed</span><strong>{done}<span> / {total}</span></strong></div><progress value={done} max={total || 1} aria-label={`${done} of ${total} tasks completed`} /><p className="cw-fine">{total ? 'A view of task status, not a productivity score.' : 'Add the first step. Build from there.'}</p></section>
          <section className="cw-context-section"><div className="cw-section-label"><h2>On the table</h2><button className="cw-icon-button" aria-label="Add shared context" onClick={() => open({ kind: 'context' })}><Icon name="plus" size={18} /></button></div><p className="cw-muted">The things everyone should know.</p>{snapshot.materials.slice(-2).reverse().map((m, i) => <button key={m.id} className="cw-material-card" onClick={() => open({ kind: 'material', material: m })}><span className={`cw-file-icon cw-file-${i}`}><Icon name="context" /></span><span><strong>{m.title}</strong><small>Shared note / {dateLabel(m.createdAt)}</small></span><Icon name="arrow" size={16} /></button>)}{!snapshot.materials.length && <button className="cw-empty-note" onClick={() => open({ kind: 'context' })}>Add a brief, a decision, or a useful detail.</button>}<button className="cw-text-link" onClick={() => open({ kind: 'materials' })}>All context ({snapshot.materials.length})<Icon name="arrow" size={14} /></button></section>
          {demo && snapshot.materials.some(m => m.id === 'm2') ? <button className="cw-proposal-card" onClick={() => open({ kind: 'proposal' })}><span className="cw-eyebrow">SCRIPTED DEMO EXAMPLE</span><strong>{approved ? 'One decision. A clear next step.' : 'Before we book the courtyard...'}</strong><span>{approved ? 'Your approved example task is on the board.' : 'A source-backed proposal, for a human to review.'}</span><span className="cw-proposal-action">{approved ? 'Review example' : 'Review the proposal'}<Icon name="arrow" size={18} /></span></button> : <section className="cw-ai-blocked"><Icon name="lock" size={18} /><div><strong>AI is not connected</strong><p>{snapshot.ai.reason || 'AI execution is unavailable in this workspace.'}</p><small>Manual collaboration is ready.</small></div></section>}
        </aside></div>
        <section className="cw-tasks" aria-labelledby="cw-tasks-heading"><div className="cw-tasks-heading"><div><span className="cw-eyebrow">THE NEXT RIGHT THINGS</span><h2 id="cw-tasks-heading">A little closer, together<span className="cw-task-count">{total}</span></h2></div><button className="cw-primary" onClick={() => open({ kind: 'task' })} disabled={busy}><Icon name="plus" size={17} />Add task</button></div><div className="cw-task-toolbar"><div className="cw-filters" role="group" aria-label="Filter tasks">{(['all', 'todo', 'doing', 'done'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All tasks' : statusNames[value]}</button>)}</div><label className="cw-task-search"><span className="cw-sr-only">Search tasks</span><input type="search" placeholder="Find a task..." value={search} onChange={e => setSearch(e.target.value)} /></label></div>
          <div className="cw-task-list">{filteredTasks.map(task => <button className="cw-task-row" key={task.id} onClick={() => open({ kind: 'task', task })}><span className={`cw-task-check ${task.status}`}>{task.status === 'done' && <Icon name="check" size={13} />}{task.status === 'doing' && <span />}</span><strong>{task.title}</strong><span className={`cw-task-status ${task.status}`}>{statusNames[task.status]}</span><span className="cw-task-assignee">{snapshot.members.find(m => m.userId === task.assigneeId)?.name.split(' ')[0] ?? 'Unassigned'}</span><span className="cw-task-date">{task.dueDate ? dateLabel(task.dueDate) : 'No date'}</span><Icon name="arrow" size={17} /></button>)}{!filteredTasks.length && <div className="cw-empty-tasks"><Icon name="compass" size={28} /><h3>{total ? 'Nothing in this view.' : 'Every good thing starts somewhere.'}</h3><p>{total ? 'Try another filter or search.' : 'Add a task and give your team a first step.'}</p><button className="cw-quiet" onClick={() => total ? (setFilter('all'), setSearch('')) : open({ kind: 'task' })}>{total ? 'Clear filters' : 'Add your first task'}<Icon name="arrow" size={15} /></button></div>}</div>
        </section>
      </> : <section className="cw-welcome"><div className="cw-welcome-mark"><Icon name="compass" size={55} /></div><p className="cw-eyebrow">A SHARED DIRECTION</p><h1>{model.loading ? 'Making room for your team.' : model.authRequired ? 'Your people. Your space.' : model.error ? 'Your workspace is unavailable.' : 'Good things start together.'}</h1><p>{model.loading ? 'Loading your workspace securely.' : model.authRequired ? 'Sign in to bring the work, the people, and the context together.' : model.error ? 'No demo data is shown here. Reconnect to continue with your real team.' : 'Create a project. Invite your people. Put the next step on the table.'}</p>{model.authRequired ? <a className="cw-primary" href={`/login?${loginParams}`}>Sign in to COMPASS<Icon name="arrow" /></a> : !model.loading && !model.error && <button className="cw-primary" onClick={() => open({ kind: 'create' })}>Create your first project<Icon name="plus" /></button>}</section>}
      <footer className="cw-page-footer"><span>Made for people making things happen.</span><span>COMPASS / {demo ? 'DEMO' : 'WORKSPACE'}</span></footer>
    </main>
    <div className="cw-compose-bar" aria-label="Add shared context and upload files"><div className="cw-compose-intro"><span className="cw-compose-icon"><Icon name="plus" /></span><div><strong>Something the team should know?</strong><span>A note, a brief, a change of plan. Keep it together.</span></div></div><button className="cw-secondary" onClick={() => fileInput.current?.click()} disabled={!snapshot || busy || importing}><Icon name="upload" size={18} />Upload<span className="cw-desktop-only"> a file</span></button><button className="cw-primary" onClick={() => open({ kind: 'context' })} disabled={!snapshot || busy || importing}>Add context<Icon name="arrow" size={18} /></button><input className="cw-sr-only" tabIndex={-1} type="file" accept=".txt,.md,.csv" ref={fileInput} onChange={e => readUpload(e.target.files?.[0])} aria-label="Upload text, Markdown, or CSV up to 5 MB" /></div>
    {drawer && (snapshot || drawer.kind === 'create') && <DrawerShell key={drawer.kind === 'task' ? `task-${drawer.task?.id ?? 'new'}-${drawer.task?.version ?? 0}` : drawer.kind === 'material' ? drawer.material.id : drawer.kind === 'member' ? drawer.member.userId : drawer.kind} title={drawerTitle} onClose={close} locked={importing} error={model.error}>
      {drawer.kind === 'task' && drawer.task && snapshot?.tasks.some(t => t.id === drawer.task?.id && t.version !== drawer.task.version) && <div className="cw-upload-info">A newer version is available. Your open form has not been overwritten.<button className="cw-text-link" onClick={() => { const task = snapshot.tasks.find(t => t.id === drawer.task?.id); if (task) open({ kind: 'task', task }); }}>Discard these edits and load latest<Icon name="arrow" size={15} /></button></div>}
      {drawer.kind === 'task' && snapshot && <TaskEditor task={drawer.task} members={snapshot.members} busy={busy} onSave={async input => { if (drawer.task) await model.updateTask(drawer.task, input); else await model.addTask(input); success('Task saved.'); }} onDelete={async () => { if (drawer.task) { await model.deleteTask(drawer.task); success('Task deleted.'); } }} />}
      {drawer.kind === 'context' && <form className="cw-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); model.addMaterial(String(data.get('title')).trim(), String(data.get('content')).trim()).then(() => success('Context added.')).catch(ignore); }}><p className="cw-muted">Give decisions a place to live. Your text stays text, including Markdown and links.</p><label>Title<input name="title" required maxLength={240} placeholder="A useful bit of context" pattern=".*\S.*" /></label><label>The context<textarea name="content" required rows={10} placeholder="What changed? What should we keep in mind?" /></label><button className="cw-primary" disabled={busy}>Share with the team<Icon name="arrow" /></button><p className="cw-fine">{demo ? 'Local demo only. Nothing is sent.' : 'Visible to everyone in this workspace.'}</p></form>}
      {drawer.kind === 'create' && <form className="cw-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); model.createProject({ name: String(data.get('name')).trim(), goal: String(data.get('goal')).trim(), deadline: String(data.get('deadline')) || null }).then(() => success('Project created.')).catch(ignore); }}><p className="cw-muted">A name, a shared goal, and a date to work toward.</p><label>Project name<input name="name" required maxLength={120} pattern=".*\S.*" placeholder="Our next good thing" /></label><label>Shared goal<textarea name="goal" required maxLength={2000} rows={3} placeholder="What are we here to make happen?" /></label><label>Deadline <span className="cw-optional">optional</span><input type="date" name="deadline" /></label><button className="cw-primary" disabled={busy}>Create {demo ? 'demo ' : ''}project<Icon name="arrow" /></button></form>}
      {drawer.kind === 'material' && <><p className="cw-muted">Shared by {snapshot?.members.find(m => m.userId === drawer.material.authorId)?.name ?? 'a workspace member'} / {dateLabel(drawer.material.createdAt)}</p><pre className="cw-material-content">{drawer.material.content}</pre></>}
      {drawer.kind === 'materials' && <><p className="cw-muted">Original notes and source material. Always available to the team.</p><div className="cw-drawer-list">{snapshot?.materials.map(m => <button key={m.id} onClick={() => open({ kind: 'material', material: m })}><Icon name="context" /><span><strong>{m.title}</strong><small>{dateLabel(m.createdAt)}</small></span><Icon name="arrow" /></button>)}</div><button className="cw-primary" onClick={() => open({ kind: 'context' })}>Add context<Icon name="plus" /></button></>}
      {drawer.kind === 'members' && <><p className="cw-muted">Workspace membership, not an online indicator.</p><div className="cw-drawer-list">{snapshot?.members.map((m, i) => <button key={m.userId} onClick={() => open({ kind: 'member', member: m })}><Avatar name={m.name} variant={i} small /><span><strong>{m.name}</strong><small>{m.role}</small></span><Icon name="arrow" /></button>)}</div><button className="cw-primary" onClick={() => open({ kind: 'invite' })}>Invite someone<Icon name="plus" /></button></>}
      {drawer.kind === 'member' && snapshot && <MemberDetails member={drawer.member} snapshot={snapshot} busy={busy} onTask={task => open({ kind: 'task', task })} onRemove={async () => { await model.removeMember(drawer.member.userId); success('Member removed.'); }} />}
      {drawer.kind === 'invite' && <>{demo ? <div className="cw-callout"><Icon name="team" size={26} /><h3>A real team needs a real workspace.</h3><p>Invitations are disabled in this local demo. Sign in to invite people to your project.</p><a className="cw-primary" href="/app">Open your workspace<Icon name="arrow" /></a></div> : snapshot?.workspace.role !== 'owner' ? <p className="cw-callout">Only the workspace owner can create invitations.</p> : <form className="cw-form" onSubmit={e => { e.preventDefault(); setInviteResult(null); model.invite(String(new FormData(e.currentTarget).get('email')).trim()).then(setInviteResult).catch(ignore); }}><p className="cw-muted">Create a private invitation for one person. They can sign in or create an account. No email is sent.</p><label>Their email<input type="email" name="email" required maxLength={254} placeholder="teammate@example.com" /></label><button className="cw-primary" disabled={busy}>Create invitation<Icon name="arrow" /></button></form>}{inviteResult && <div className="cw-invite-result"><h3>Ready to share, personally.</h3><p>{inviteResult.signupRequired ? 'This invitation includes account signup.' : 'They will sign in with their existing account.'} Expires {dateLabel(inviteResult.expiresAt)}.</p><label>Invitation link<textarea readOnly rows={4} value={inviteLink} onFocus={e => e.target.select()} /></label><button className="cw-secondary" onClick={() => navigator.clipboard.writeText(inviteLink).then(() => setNotice('Invitation link copied.')).catch(() => model.setError('Clipboard unavailable. Select the invitation link and copy it manually.'))}>Copy invitation link</button><label>Manual token<input readOnly value={inviteResult.token} onFocus={e => e.target.select()} /></label>{notice && <p role="status">{notice}</p>}<p className="cw-fine">Share only with the intended recipient. COMPASS has not emailed them.</p></div>}</>}
      {drawer.kind === 'upload' && upload && <><p className="cw-muted">{upload.name} / {upload.tasks ? `${upload.tasks.length} tasks remaining` : 'Shared text material'}</p><div className="cw-upload-info">Preview only. Nothing is imported until you confirm. HTML is never rendered.</div>{upload.tasks ? <div className="cw-upload-preview">{upload.tasks.map((t, i) => <div key={i}><span>{i + 1}</span><div><strong>{t.title}</strong><small>{statusNames[t.status]} / {t.dueDate ?? 'No date'} / {snapshot?.members.find(m => m.userId === t.assigneeId)?.name ?? 'Unassigned'}</small></div></div>)}</div> : <pre className="cw-material-content">{upload.content.slice(0, 12000)}{upload.content.length > 12000 ? '\n\n[Preview truncated. The full file will be saved.]' : ''}</pre>}<p className="cw-fine">CSV columns: title, assigneeId, status, dueDate. Up to 200 tasks. Files up to 5 MB. {imported > 0 && `${imported} tasks confirmed so far.`}</p><button className="cw-primary" disabled={busy || importing || upload.tasks?.length === 0} onClick={() => confirmUpload()}>{importing ? 'Importing, please keep this open...' : upload.tasks ? `Import ${upload.tasks.length} tasks` : 'Add this material'}<Icon name="arrow" /></button></>}
      {drawer.kind === 'proposal' && <><span className="cw-demo-label">LOCAL DEMO / SCRIPTED EXAMPLE / NOT LIVE AI</span><p className="cw-proposal-intro">Check accessibility before confirming the courtyard.</p><p className="cw-muted">This proposal is prewritten to demonstrate a review flow. It was not generated from your data.</p><section className="cw-evidence"><span className="cw-eyebrow">01 / THE EVIDENCE</span><h3>Venue conversation</h3><blockquote>"The venue needs a written accessibility check before we confirm."</blockquote><button className="cw-text-link" onClick={() => { const material = snapshot?.materials.find(m => m.id === 'm2'); if (material) open({ kind: 'material', material }); }}>Read the original note<Icon name="arrow" size={15} /></button></section><section className="cw-evidence"><span className="cw-eyebrow">02 / THE PROPOSED NEXT STEP</span><h3>Review the courtyard accessibility</h3><p>Assign to Maya. Due October 5. No booking, message, or payment.</p></section><p className="cw-fine">Approval adds one local demo task. It does not execute an agent or contact the venue.</p><button className="cw-primary" disabled={busy || approved} onClick={() => model.addTask({ title: 'Review the courtyard accessibility', assigneeId: snapshot?.members.some(m => m.userId === 'maya') ? 'maya' : null, status: 'todo', dueDate: '2026-10-05' }).then(() => { setApproved(true); success('Example proposal approved. One task added.'); }).catch(ignore)}>{approved ? 'Example approved' : 'Approve and add example task'}<Icon name="check" /></button></>}
      {drawer.kind === 'activity' && <><p className="cw-muted">{demo ? 'Actions taken in this local demo session.' : 'Events received from this workspace. Not a measure of presence or productivity.'}</p><div className="cw-activity-list">{snapshot?.events.slice(-50).reverse().map(e => <div key={e.id}><span className="cw-activity-mark" /><div><strong>{e.type.replace(/[._]/g, ' ')}</strong><small>{e.createdAt ? dateLabel(e.createdAt) : 'Workspace event'}</small></div></div>)}{!snapshot?.events.length && <p className="cw-callout">No events yet. Your next shared change starts the story.</p>}</div><section className="cw-ai-blocked"><Icon name="lock" /><div><strong>AI execution blocked</strong><p>{snapshot?.ai.reason ?? 'No verified workspace connection.'}</p></div></section></>}
    </DrawerShell>}
  </div>;
}

function MemberDetails({ member, snapshot, busy, onTask, onRemove }: { member: Member; snapshot: NonNullable<ReturnType<typeof useWorkspace>['snapshot']>; busy: boolean; onTask: (task: Task) => void; onRemove: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const tasks = snapshot.tasks.filter(t => t.assigneeId === member.userId);
  return <><div className="cw-member-profile"><Avatar name={member.name} variant={snapshot.members.findIndex(m => m.userId === member.userId)} /><div><strong>{member.role}</strong><p>{member.email}</p><small>Illustrated avatar / not presence</small></div></div><h3>On their plate <span className="cw-muted">({tasks.length})</span></h3><div className="cw-drawer-list">{tasks.map(t => <button key={t.id} onClick={() => onTask(t)}><span className={`cw-status-dot ${t.status}`} /><span><strong>{t.title}</strong><small>{statusNames[t.status]}</small></span><Icon name="arrow" size={17} /></button>)}{!tasks.length && <p className="cw-muted">No tasks assigned yet.</p>}</div>{snapshot.workspace.role === 'owner' && member.role !== 'owner' && <div className="cw-delete-zone">{confirm ? <><p>Remove {member.name} from this workspace? Their access will end.</p><button disabled={busy} className="cw-danger" onClick={() => onRemove().catch(ignore)}>Confirm removal</button><button className="cw-quiet" onClick={() => setConfirm(false)}>Keep member</button></> : <button className="cw-quiet cw-danger-text" onClick={() => setConfirm(true)}>Remove from workspace</button>}</div>}</>;
}
