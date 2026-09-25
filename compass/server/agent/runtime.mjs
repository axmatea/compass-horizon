// COMPASS agent runtime: sessions, turns, action lifecycle, event bus.
//
// Turn pipeline (per session, interpret+plan is serialized; tool execution is not):
//   reasoning_status -> interpret (GLM) -> state_patch -> action_invalidated* ->
//   tool_call* (new or reused) -> [render] -> say (ack) -> [await actions] -> tool_result* -> [render] -> say (final) -> done
// A later turn may invalidate an earlier turn's in-flight action; the earlier turn
// then resolves with superseded=true instead of speaking a stale answer.
//
// The domain plugin owns what the intent IS (dinner plan, website brief): createState,
// applyUpdate, describeChanges, optional refine / guardAck / askMissing / render.
import { randomUUID } from 'node:crypto';
import { addAction, updateAction, invalidateActions, findReusableAction } from '../state/intent.mjs';
import { missingFields } from '../tools/registry.mjs';
import { detectLang, matchesLang, describeChanges, t as tr } from '../i18n/lang.mjs';
import { dinnerDomain } from '../domains/dinner.mjs';

export { describeChanges };
const shortId = (p) => `${p}_${randomUUID().slice(0, 8)}`;

export function createAgentRuntime({ interpreter, tools, domain = dinnerDomain, sessionTtlMs = 30 * 60_000, maxSessions = 500, now = () => Date.now() }) {
  const sessions = new Map();

  function sweep() {
    const t = now();
    for (const [id, s] of sessions) if (t - s.lastSeen > sessionTtlMs) { for (const c of s.controllers.values()) c.abort(); sessions.delete(id); }
    while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
  }

  function createSession(id = shortId('s')) {
    sweep();
    const s = { id, state: domain.createState(id), lock: Promise.resolve(), controllers: new Map(), inflight: new Map(), listeners: new Set(), pendingTools: new Set(), lastSeen: now() };
    sessions.set(id, s);
    return s;
  }

  const getSession = (id) => { const s = id && sessions.get(id); if (s) s.lastSeen = now(); return s || null; };

  function emit(session, type, data = {}) {
    const ev = { type, sessionId: session.id, version: session.state.version, at: new Date(now()).toISOString(), ...data };
    for (const l of session.listeners) { try { l(ev); } catch { /* listener errors never break the turn */ } }
    return ev;
  }

  function setState(session, state) { session.state = state; }

  function refreshStatus(session) {
    const running = session.state.actions.some((a) => a.status === 'running' || a.status === 'pending');
    session.state = { ...session.state, status: running ? 'acting' : 'ready' };
  }

  /** Domains with a renderer (website) get a `render` event whenever the picture may have changed. */
  function emitRender(session, turnId, stage, ctx = {}) {
    if (!domain.render || (domain.hasContent && !domain.hasContent(session.state))) return;
    let r;
    try { r = domain.render(session.state, ctx); } catch (err) { emit(session, 'error', { turnId, code: 'render_failed', message: String(err?.message || err).slice(0, 120) }); return; }
    emit(session, 'render', { turnId, stage, html: r.html, pending: r.pending, highlight: r.highlight, placeholder: r.placeholder, version: session.state.version });
  }

  function startAction(session, tool, args, turnId) {
    const id = shortId('a');
    // The latest result of the same tool lets incremental tools keep what is still valid.
    const prev = [...session.state.actions].reverse().find((a) => a.tool === tool.name && a.result);
    const previous = prev ? { args: prev.args, result: prev.result } : null;
    setState(session, updateAction(addAction(session.state, { id, tool: tool.name, args, dependsOn: tool.dependsOn }), id, { status: 'running', turnId }));
    const controller = new AbortController();
    session.controllers.set(id, controller);
    emit(session, 'tool_call', { turnId, actionId: id, tool: tool.name, args, mock: tool.mock });
    refreshStatus(session);

    const promise = tool.run(args, { signal: controller.signal, previous }).then(
      (result) => {
        session.controllers.delete(id);
        const a = session.state.actions.find((x) => x.id === id);
        if (!a || a.status !== 'running') return { id, invalidated: true };
        setState(session, updateAction(session.state, id, { status: 'done', result }));
        refreshStatus(session);
        emit(session, 'tool_result', { turnId, actionId: id, tool: tool.name, result, mock: tool.mock });
        emitRender(session, turnId, 'tool_result', { wrote: Array.isArray(result?.wrote) ? result.wrote : [] });
        return { id, result };
      },
      (err) => {
        session.controllers.delete(id);
        const a = session.state.actions.find((x) => x.id === id);
        if (!a || a.status === 'invalidated') return { id, invalidated: true };
        setState(session, updateAction(session.state, id, { status: 'failed', error: String(err?.message || err).slice(0, 200) }));
        refreshStatus(session);
        emit(session, 'error', { turnId, actionId: id, tool: tool.name, code: 'tool_failed', message: 'Tool failed' });
        return { id, error: true };
      },
    );
    session.inflight.set(id, promise);
    promise.finally(() => session.inflight.delete(id));
    return { id, promise };
  }

  /** Attach to an existing live action instead of re-running it. */
  function reuseAction(session, action) {
    if (action.status === 'done') return { id: action.id, promise: Promise.resolve({ id: action.id, result: action.result }), reused: true };
    return { id: action.id, promise: session.inflight.get(action.id) ?? Promise.resolve({ id: action.id, invalidated: true }), reused: true };
  }

  async function runTurn(sessionId, text, { onEvent, signal, turnId: presetTurnId } = {}) {
    const lang = detectLang(text);
    const session = getSession(sessionId) || createSession(sessionId || undefined);
    const turnId = presetTurnId || shortId('t');
    const events = [];
    const listener = (ev) => { events.push(ev); onEvent?.(ev); };
    session.listeners.add(listener);

    try {
      // Serialize interpret+plan per session so patches apply in utterance order.
      let release;
      const prev = session.lock;
      session.lock = new Promise((r) => { release = r; });
      await prev;

      let planned = [];
      let patch = [];
      let ack = '';
      try {
        session.state = { ...session.state, status: 'thinking' };
        emit(session, 'reasoning_status', { turnId, stage: 'interpreting', text });

        let interp;
        try {
          interp = await interpreter.interpret({ state: session.state, text, lang, tools: tools.describe(), signal });
        } catch (err) {
          refreshStatus(session);
          emit(session, 'error', { turnId, code: err.code || 'interpret_failed', message: 'Could not interpret the request' });
          emit(session, 'say', { turnId, text: tr(lang).fallback, final: true });
          emit(session, 'done', { turnId });
          return { sessionId: session.id, turnId, state: session.state, patch: [], reply: tr(lang).fallback, toolResult: null, error: err.code || 'interpret_failed', events };
        }

        // Domain-specific corrections of the model output (e.g. explicit AM/PM beats the dinner default).
        const refined = domain.refine?.(text, interp, session.state);
        if (refined) {
          emit(session, 'reasoning_status', { turnId, ...refined.note });
          interp = refined.interp;
        }

        const upd = domain.applyUpdate(session.state, interp, { turnId, text, lang });
        setState(session, upd.state);
        patch = upd.patch;
        emit(session, 'state_patch', { turnId, patch, changed: upd.changed, rejected: upd.rejected, intent: session.state.intent, latencyMs: interp.latencyMs });

        // Invalidate only actions whose dependencies changed; abort the in-flight ones.
        const replan = new Set();
        if (upd.changed.length) {
          const inv = invalidateActions(session.state, upd.changed);
          setState(session, inv.state);
          for (const i of inv.invalidated) {
            session.controllers.get(i.id)?.abort(new Error('invalidated'));
            session.controllers.delete(i.id);
            replan.add(i.tool);
            emit(session, 'action_invalidated', { turnId, actionId: i.id, tool: i.tool, previousStatus: i.previousStatus, changedFields: i.changedFields, reason: 'intent_changed' });
          }
        }

        const waiting = new Set();
        // Tools the user asked for earlier that were waiting for a field stay wanted until they can run.
        const wanted = new Set([...replan, ...session.pendingTools]);
        if (interp.tool) {
          if (tools.get(interp.tool)) wanted.add(interp.tool);
          else emit(session, 'error', { turnId, code: 'unknown_tool', message: `Model requested unknown tool ${interp.tool}` });
        }

        for (const name of wanted) {
          const tool = tools.get(name);
          const missing = missingFields(tool, session.state.intent);
          if (missing.length) { missing.forEach((f) => waiting.add(f)); session.pendingTools.add(name); emit(session, 'reasoning_status', { turnId, stage: 'waiting_for_fields', tool: name, missing }); continue; }
          session.pendingTools.delete(name);
          const args = tool.argsFromIntent(session.state.intent);
          const existing = findReusableAction(session.state, name, args);
          planned.push(existing ? reuseAction(session, existing) : startAction(session, tool, args, turnId));
          if (existing) emit(session, 'reasoning_status', { turnId, stage: 'reusing_action', actionId: existing.id, tool: name });
        }

        refreshStatus(session);
        // The picture follows the brief immediately; sections still being written show as pending.
        if (upd.changed.length || planned.length) emitRender(session, turnId, 'state_patch', { patch });

        ack = interp.reply || domain.describeChanges(patch, lang) || (lang === 'ru' ? 'Понял.' : 'Got it.');
        // GLM sometimes answers in the wrong language; the spoken reply must follow the user.
        if (ack && !matchesLang(ack, lang)) ack = domain.describeChanges(patch, lang) || (lang === 'ru' ? 'Понял.' : 'Got it.');
        // Never let the model claim more than happened (booked, sent, published, deployed).
        const guarded = domain.guardAck?.(ack, session.state, lang);
        if (guarded) {
          emit(session, 'reasoning_status', { turnId, stage: 'completion_claim_removed', text: ack });
          ack = guarded;
        }
        if (!planned.length && waiting.size && domain.askMissing) {
          const q = domain.askMissing(waiting, lang, ack);
          if (q) ack = [ack, q].filter(Boolean).join(' ');
        }
        if (ack) emit(session, 'say', { turnId, text: ack, final: planned.length === 0 });
      } finally {
        release();
      }

      // Tool execution happens outside the lock so a new utterance can interrupt it.
      const outcomes = await Promise.all(planned.map((p) => p.promise));
      const live = outcomes.filter((o) => o.result);
      const superseded = planned.length > 0 && outcomes.every((o) => o.invalidated);

      let reply = ack || '';
      let toolResult = null;
      if (superseded) {
        reply = null;
        emit(session, 'reasoning_status', { turnId, stage: 'superseded' });
      } else if (live.length) {
        const first = live[0];
        const action = session.state.actions.find((a) => a.id === first.id);
        const tool = tools.get(action.tool);
        toolResult = { actionId: first.id, tool: action.tool, mock: tool.mock, result: first.result };
        reply = [domain.describeChanges(patch, lang), tool.summarize(first.result, session.state.intent, lang)].filter(Boolean).join(' ');
        if (reply) emit(session, 'say', { turnId, text: reply, final: true });
      } else if (planned.length && outcomes.some((o) => o.error)) {
        reply = tr(lang).toolFailed;
        emit(session, 'say', { turnId, text: reply, final: true });
      }
      emit(session, 'done', { turnId, superseded });
      return { sessionId: session.id, turnId, state: session.state, patch, reply, toolResult, superseded, events };
    } finally {
      session.listeners.delete(listener);
    }
  }

  /** Session-wide event subscription (all turns). Returns an unsubscribe function. */
  function subscribe(sessionId, fn) {
    const session = getSession(sessionId);
    if (!session) return () => {};
    session.listeners.add(fn);
    return () => session.listeners.delete(fn);
  }

  /** Current rendering of a session (domains with a renderer only). */
  function render(sessionId) {
    const session = getSession(sessionId);
    if (!session || !domain.render) return null;
    return domain.render(session.state);
  }

  return { createSession, getSession, runTurn, subscribe, render, domain, _sessions: sessions };
}
