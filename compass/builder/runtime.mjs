// In-memory site-builder sessions. The page exists only until the session expires.
import { randomUUID } from 'node:crypto';
import { createState, applyUpdate, hasSite } from './spec.mjs';
import { renderSite } from './render.mjs';
import { copyPlan } from './copy.mjs';

const CLAIM = /\b(published|deployed|deploying|launched|went live|is live|now live)\b/i;
const shortId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

function describe(patch) {
  return patch
    .filter((op) => op.status === 'active' && op.change === 'updated')
    .map((op) => op.field === 'sections' ? 'Sections updated.' : `${op.field} updated.`)
    .join(' ');
}

function picture(state, { patch = [], wrote = [] } = {}) {
  const spec = state.intent;
  const acts = state.actions.filter((action) => action.tool === 'write_copy');
  const running = acts.find((action) => action.status === 'running' || action.status === 'pending');
  const latest = [...acts].reverse().find((action) => action.result);
  let copy = latest?.result ?? null;
  let pending = [];
  if (running) {
    const plan = copyPlan(running.args, latest ? { args: latest.args, result: latest.result } : null);
    pending = plan.write;
    copy = latest ? Object.fromEntries(Object.entries(latest.result).filter(([key]) => plan.reuse.includes(key) || key === 'footer')) : null;
    if (copy && !Object.keys(copy).some((key) => key !== 'footer')) copy = null;
  } else if (!copy && (spec.kind || spec.business)) pending = ['hero', ...(spec.sections || [])];
  const highlight = new Set(wrote);
  for (const op of patch) {
    if (op.status !== 'active') continue;
    if (op.field === 'sections') for (const section of op.added || []) highlight.add(section);
    if (['hero', 'headline', 'subhead', 'cta', 'theme'].includes(op.field)) highlight.add('hero');
  }
  return {
    html: renderSite({ spec, copy, pending, highlight: [...highlight], version: state.version }),
    pending,
    highlight: [...highlight],
    placeholder: Boolean(copy?.fallback),
    version: state.version,
  };
}

export function createSiteRuntime({ interpret, tool, now = () => Date.now(), sessionTtlMs = 30 * 60_000, maxSessions = 500 }) {
  const sessions = new Map();

  function sweep() {
    const time = now();
    for (const [id, session] of sessions) if (time - session.lastSeen > sessionTtlMs) { session.controller?.abort(); sessions.delete(id); }
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value;
      sessions.get(oldest)?.controller?.abort();
      sessions.delete(oldest);
    }
  }

  function createSession(id = shortId('s')) {
    sweep();
    const session = { id, state: createState(id), lastSeen: now(), controller: null, lock: Promise.resolve() };
    sessions.set(id, session);
    return session;
  }

  function getSession(id) {
    const session = id && sessions.get(id);
    if (session) session.lastSeen = now();
    return session || null;
  }

  function startAction(session, args, turnId, localOnly) {
    const id = shortId('a');
    const previous = [...session.state.actions].reverse().find((action) => action.tool === 'write_copy' && action.result);
    session.state.actions.push({ id, tool: 'write_copy', args, dependsOn: tool.dependsOn, status: 'running', turnId, basedOnVersion: session.state.version });
    const controller = new AbortController();
    session.controller = controller;
    const promise = tool.run(args, { signal: controller.signal, localOnly, previous: previous ? { args: previous.args, result: previous.result } : null }).then(
      (result) => {
        const action = session.state.actions.find((item) => item.id === id);
        if (!action || action.status !== 'running') return { id, invalidated: true };
        action.status = 'done';
        action.result = result;
        return { id, result };
      },
      (err) => {
        const action = session.state.actions.find((item) => item.id === id);
        if (!action || action.status === 'invalidated') return { id, invalidated: true };
        action.status = 'failed';
        action.error = 'failed';
        if (err?.name === 'AbortError' || err?.code === 'aborted') return { id, invalidated: true };
        return { id, error: true };
      },
    );
    return { id, promise, args };
  }

  async function runTurn(sessionId, text, { onEvent, localOnly = false } = {}) {
    const session = getSession(sessionId) || createSession(sessionId || undefined);
    const turnId = shortId('t');
    const events = [];
    const emit = (type, data = {}) => {
      const event = { type, sessionId: session.id, turnId, version: session.state.version, at: new Date(now()).toISOString(), ...data };
      events.push(event);
      onEvent?.(event);
      return event;
    };
    let release;
    const previous = session.lock;
    session.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    let patch = [];
    let planned = null;
    let ack = '';
    let fromModel = false;
    try {
      emit('reasoning_status', { stage: 'interpreting' });
      let interp;
      try { interp = await interpret({ state: session.state, text, localOnly }); }
      catch { interp = null; }
      if (!interp) {
        ack = 'Prepared build is on the preview.';
        emit('say', { text: ack, final: true });
        emit('done', {});
        return { sessionId: session.id, turnId, reply: ack, patch: [], source: 'prepared', events, page: null };
      }
      fromModel = interp.source === 'model';
      const update = applyUpdate(session.state, interp, { turnId, text });
      session.state = update.state;
      patch = update.patch;
      emit('state_patch', { patch, changed: update.changed, intent: session.state.intent, source: interp.source || 'prepared' });

      if (update.changed.length) {
        for (const action of session.state.actions) {
          if (!['pending', 'running', 'done'].includes(action.status)) continue;
          const hit = (action.dependsOn || []).filter((field) => update.changed.includes(field));
          if (!hit.length) continue;
          if (action.status === 'running') session.controller?.abort();
          action.status = 'invalidated';
          emit('action_invalidated', { actionId: action.id, tool: action.tool, changedFields: hit });
        }
      }

      if (interp.tool === 'write_copy' && hasSite(session.state.intent)) {
        const args = tool.argsFromIntent(session.state.intent);
        planned = startAction(session, args, turnId, localOnly);
        emit('tool_call', { actionId: planned.id, tool: 'write_copy', args });
      }
      if (update.changed.length || planned) emit('render', { stage: 'state_patch', ...picture(session.state, { patch }) });
      ack = CLAIM.test(interp.reply || '') ? 'It is rendered in the preview. Nothing is published.' : (interp.reply || describe(patch) || 'Got it.');
      emit('say', { text: ack, final: !planned });
    } finally {
      release();
    }

    let source = fromModel ? 'model' : 'prepared';
    if (planned) {
      const outcome = await planned.promise;
      const action = session.state.actions.find((item) => item.id === planned.id);
      if (outcome.result) {
        source = outcome.result.fallback ? 'prepared' : 'model';
        emit('tool_result', { actionId: planned.id, tool: 'write_copy', result: { wrote: outcome.result.wrote, reused: outcome.result.reused, fallback: outcome.result.fallback } });
        emit('render', { stage: 'tool_result', ...picture(session.state, { patch, wrote: outcome.result.wrote || [] }) });
        const summary = tool.summarize(outcome.result, session.state.intent);
        if (summary) { ack = summary; emit('say', { text: summary, final: true }); }
      } else if (action?.status !== 'invalidated') {
        source = 'prepared';
        emit('say', { text: 'The page is still on the preview.', final: true });
      } else emit('reasoning_status', { stage: 'superseded' });
    }
    const view = hasSite(session.state.intent) ? picture(session.state, { patch }) : null;
    emit('done', {});
    return {
      sessionId: session.id,
      turnId,
      reply: ack,
      patch,
      intent: session.state.intent,
      source,
      version: session.state.version,
      placeholder: Boolean(view?.placeholder),
      events,
      page: view,
    };
  }

  return {
    createSession,
    getSession,
    runTurn,
    render(sessionId) {
      const session = getSession(sessionId);
      if (!session || !hasSite(session.state.intent)) return null;
      return picture(session.state);
    },
  };
}
