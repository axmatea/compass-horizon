import { useEffect, useRef, useState } from 'react';
import { ApiError, commandId, fetchSnapshot, listWorkspaces, request, workspacePath } from './api.ts';
import { createDemo } from './demo.ts';
import { isWorkspace, parseSequence, parseSnapshot } from './types.ts';
import { MAX_UPLOAD_BYTES, validateTitle } from './parsers.ts';
import type { Snapshot, Task, TaskInput, Workspace } from './types.ts';

export function useWorkspace(demo: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => demo ? createDemo() : null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => demo ? [createDemo().workspace] : []);
  const [selectedId, setSelectedId] = useState(demo ? 'demo' : '');
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [connection, setConnection] = useState(demo ? 'Local only' : 'Connecting');
  const [lastEvent, setLastEvent] = useState('');
  const currentId = useRef(selectedId);
  currentId.current = selectedId;
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const lock = useRef(false);
  const revision = useRef(0);
  const eventIds = useRef(new Set<string>());
  const pendingCommands = useRef(new Map<string, string>());
  const demoProjects = useRef(new Map<string, Snapshot>(demo ? [['demo', createDemo()]] : []));
  const [retryStream, setRetryStream] = useState(0);

  function clearPrivate() {
    revision.current++; currentId.current = ''; latest.current = null;
    setSnapshot(null); setWorkspaces([]); setSelectedId(''); setLastEvent('');
    eventIds.current.clear(); pendingCommands.current.clear();
  }

  function report(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    if (cause instanceof ApiError && cause.status === 401) { clearPrivate(); setAuthRequired(true); }
  }
  function apply(next: Snapshot, initial = false) {
    if (next.workspace.id !== currentId.current) return;
    if (latest.current?.workspace.id === next.workspace.id && parseSequence(next.seq) < parseSequence(latest.current.seq)) return;
    const fresh = next.events.filter(e => !eventIds.current.has(e.id));
    eventIds.current = new Set(next.events.map(e => e.id));
    const taskEvents = fresh.filter(event => event.type.startsWith('task.'));
    if (!initial && taskEvents.length) setLastEvent(taskEvents[taskEvents.length - 1].id);
    latest.current = next;
    setSnapshot(next);
    if (demo) demoProjects.current.set(next.workspace.id, next);
  }
  async function refresh() {
    if (demo || !currentId.current) return;
    const id = currentId.current;
    try { const next = await fetchSnapshot(id); apply(next); }
    catch (e) { if (id === currentId.current && e instanceof ApiError && [401, 403, 404].includes(e.status)) clearPrivate(); throw e; }
  }
  async function reloadList(signal?: AbortSignal) {
    const list = await listWorkspaces(signal);
    setWorkspaces(list);
    setAuthRequired(false);
    if (!list.some(w => w.id === currentId.current)) setSelectedId(list[0]?.id ?? '');
    return list;
  }
  useEffect(() => {
    if (demo) return;
    const abort = new AbortController();
    reloadList(abort.signal).catch(e => { if (!abort.signal.aborted) report(e); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [demo]);

  useEffect(() => {
    if (demo) {
      const saved = demoProjects.current.get(selectedId);
      if (saved) { eventIds.current = new Set(saved.events.map(e => e.id)); latest.current = saved; setSnapshot(saved); setLastEvent(''); }
      return;
    }
    if (!selectedId) return;
    let disposed = false;
    const abort = new AbortController();
    setSnapshot(null); latest.current = null; setLoading(true); setError(''); setLastEvent('');
    eventIds.current.clear();
    setConnection('Connecting');
    let stream: EventSource | undefined, timer: ReturnType<typeof setTimeout> | undefined, first = true;
    const recover = async () => {
      try {
        const next = await fetchSnapshot(selectedId, abort.signal);
        if (disposed || currentId.current !== selectedId) return;
        apply(next, first); first = false;
        stream = new EventSource(`/api/workspaces${workspacePath(selectedId)}/events`, { withCredentials: true });
        stream.onopen = () => { if (!disposed) setConnection('Connected'); };
        stream.addEventListener('state', event => {
          if (disposed) return;
          try {
            const update = parseSnapshot(JSON.parse((event as MessageEvent).data));
            if (update.workspace.id !== selectedId) throw new Error('Event stream returned a different workspace.');
            apply(update); setConnection('Connected');
          } catch (e) { stream?.close(); setConnection('Sync error'); report(e); }
        });
        stream.addEventListener('workspace-error', () => {
          if (disposed) return;
          disposed = true; stream?.close(); clearTimeout(timer); abort.abort(); clearPrivate();
          setConnection('Access changed'); setError('Workspace access changed. Private content has been cleared.');
          reloadList().catch(report);
        });
        stream.onerror = () => {
          if (disposed) return;
          stream?.close(); setConnection('Reconnecting');
          clearTimeout(timer); timer = setTimeout(recover, 1500);
        };
      } catch (e) {
        if (disposed) return;
        setConnection('Unavailable'); report(e);
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) { clearPrivate(); if (e.status !== 401) reloadList().catch(report); }
        else timer = setTimeout(recover, 5000);
      } finally { if (!disposed) setLoading(false); }
    };
    void recover();
    return () => { disposed = true; abort.abort(); stream?.close(); clearTimeout(timer); revision.current++; };
  }, [demo, selectedId, retryStream]);

  async function run<T,>(operation: () => Promise<T>): Promise<T> {
    if (lock.current) throw new Error('Please wait for the current change to finish.');
    lock.current = true; setBusy(true); setError('');
    try { return await operation(); }
    catch (e) { report(e); throw e; }
    finally { lock.current = false; setBusy(false); }
  }
  function localChange(transform: (data: Snapshot) => Snapshot, type: string) {
    if (!latest.current) throw new Error('Select a workspace first.');
    const next = transform(latest.current);
    next.events = [...next.events, { id: commandId(), type, createdAt: new Date().toISOString() }];
    next.seq = String(parseSequence(latest.current.seq) + 1n);
    apply(next);
  }
  async function write(path: string, method: string, body?: object, stableId?: string) {
    const id = currentId.current;
    if (!id || !latest.current) throw new Error('Select a verified workspace before saving.');
    const key = JSON.stringify([id, path, method, body]);
    const cmd = stableId ?? pendingCommands.current.get(key) ?? commandId();
    pendingCommands.current.set(key, cmd);
    const result = await request(workspacePath(id) + path, method, { ...body, commandId: cmd });
    if (id !== currentId.current) throw new Error('Workspace access changed before confirmation. No previous workspace content is shown.');
    if (id === currentId.current) {
      try { await refresh(); }
      catch (e) { throw new Error(`Change sent, but confirmation failed. Refresh before retrying to avoid duplicates. ${e instanceof Error ? e.message : ''}`); }
    }
    pendingCommands.current.delete(key);
    return result;
  }
  const addTask = (input: TaskInput, stableId?: string) => run(async () => {
    validateTitle(input.title);
    if (demo) localChange(s => ({ ...s, tasks: [...s.tasks, { ...input, id: commandId(), version: 1 }] }), 'task.created');
    else await write('/tasks', 'POST', input, stableId);
  });
  const updateTask = (task: Task, input: TaskInput) => run(async () => {
    validateTitle(input.title);
    if (demo) {
      if (latest.current?.tasks.find(t => t.id === task.id)?.version !== task.version) throw new Error('This task changed. Reopen it to review the latest version.');
      localChange(s => ({ ...s, tasks: s.tasks.map(t => t.id === task.id ? { ...t, ...input, version: t.version + 1 } : t) }), 'task.updated');
      return;
    }
    // Keep the original version for server compare-and-swap; never silently retry conflicts.
    const before = latest.current;
    try { await write(`/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { ...input, version: task.version }); }
    catch (e) {
      if (before?.workspace.id === currentId.current) {
        setSnapshot(latest.current ?? before);
        try { await refresh(); } catch { /* Preserve the original write error. */ }
      }
      throw e;
    }
  });
  const deleteTask = (task: Task) => run(async () => {
    if (demo) localChange(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== task.id) }), 'task.deleted');
    else await write(`/tasks/${encodeURIComponent(task.id)}`, 'DELETE', { version: task.version });
  });
  const addMaterial = (title: string, content: string, stableId?: string) => run(async () => {
    validateTitle(title);
    if (!content.trim() || content.includes('\u0000') || /[\uD800-\uDFFF]/u.test(content)) throw new Error('Add valid text without NUL characters.');
    if (new TextEncoder().encode(content).length > MAX_UPLOAD_BYTES) throw new Error('Context must be no larger than 5 MB of UTF-8 text.');
    if (demo) localChange(s => ({ ...s, materials: [...s.materials, { id: commandId(), title, content, createdAt: new Date().toISOString(), authorId: 'maya' }] }), 'material.created');
    else await write('/materials', 'POST', { title, content }, stableId);
  });
  const createProject = (input: { name: string; goal: string; deadline: string | null }) => run(async () => {
    validateTitle(input.name, 160);
    if (demo) {
      const workspace = { ...input, id: commandId(), role: 'owner' };
      const next = { ...createDemo(), workspace, tasks: [], materials: [], events: [] };
      setWorkspaces(previous => [...previous, workspace]); currentId.current = workspace.id; setSelectedId(workspace.id); apply(next, true);
    } else {
      const key = JSON.stringify(['create', input]);
      const cmd = pendingCommands.current.get(key) ?? commandId();
      pendingCommands.current.set(key, cmd);
      const result = await request('', 'POST', { ...input, commandId: cmd }) as { workspace?: unknown };
      if (!isWorkspace(result?.workspace)) throw new Error('Project creation returned an invalid response. Refresh the workspace list before retrying.');
      await reloadList(); setSelectedId(result.workspace.id);
      pendingCommands.current.delete(key);
    }
  });
  const invite = (email: string) => run(async () => {
    if (demo) throw new Error('Invitations are only available in a signed-in live workspace.');
    const result = await write('/invites', 'POST', { email }) as { token?: unknown; expiresAt?: unknown; signupRequired?: unknown };
    if (typeof result?.token !== 'string' || typeof result.expiresAt !== 'string' || typeof result.signupRequired !== 'boolean') throw new Error('Invalid invitation response.');
    return { token: result.token, expiresAt: result.expiresAt, signupRequired: result.signupRequired };
  });
  const acceptInvite = (token: string) => run(async () => {
    if (demo) throw new Error('Open the signed-in workspace to accept an invitation.');
    const key = JSON.stringify(['accept', token]);
    const cmd = pendingCommands.current.get(key) ?? commandId();
    pendingCommands.current.set(key, cmd);
    const result = await request('/accept-invite', 'POST', { token, commandId: cmd }) as { workspace?: unknown };
    const url = new URL(window.location.href); url.searchParams.delete('workspaceInvite'); url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    await reloadList();
    if (isWorkspace(result?.workspace)) setSelectedId(result.workspace.id);
    pendingCommands.current.delete(key);
  });
  const removeMember = (userId: string) => run(async () => {
    if (demo) localChange(s => ({ ...s, members: s.members.filter(m => m.userId !== userId), tasks: s.tasks.map(t => t.assigneeId === userId ? { ...t, assigneeId: null, version: t.version + 1 } : t) }), 'member.removed');
    else await write(`/members/${encodeURIComponent(userId)}`, 'DELETE');
  });
  const retry = () => run(async () => { await reloadList(); setRetryStream(value => value + 1); });
  const signOut = () => run(async () => {
    const response = await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Sign out failed. Please try again.');
    clearPrivate(); window.location.replace('/login?returnTo=/app');
  });
  return { snapshot, workspaces, selectedId, setSelectedId, loading, busy, error, setError, authRequired, connection, lastEvent,
    addTask, updateTask, deleteTask, addMaterial, createProject, invite, acceptInvite, removeMember, retry, signOut };
}
