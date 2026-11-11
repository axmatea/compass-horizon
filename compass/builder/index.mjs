// Public site builder. Sessions live in memory. Model calls stay in this process.
import { loadLlm } from '../llm.mjs';
import { createSiteCopyTool } from './copy.mjs';
import { interpretLocal, interpretSite } from './interpret.mjs';
import { createSiteRuntime } from './runtime.mjs';

export const MAX_TEXT = 500;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function createSiteBuilder({ env = process.env, fetchImpl = fetch } = {}) {
  const stepMs = Math.min(Math.max(Number(env.BUILDER_STEP_MS ?? 800) || 0, 0), 4000);
  const clients = () => loadLlm(env, fetchImpl).clients;
  const tool = createSiteCopyTool({ clients, stepMs });
  const runtime = createSiteRuntime({
    tool,
    interpret: ({ state, text, localOnly }) => localOnly
      ? Promise.resolve({ ...interpretLocal(state, text), source: 'prepared' })
      : interpretSite({ state, text, env, fetchImpl }),
  });
  return { runtime, maxText: MAX_TEXT };
}

export function publicTurn(result, extra = {}) {
  return {
    ok: true,
    sessionId: result.sessionId,
    turnId: result.turnId,
    reply: result.reply || '',
    patch: result.patch || [],
    intent: result.intent || null,
    source: result.source || 'prepared',
    version: result.version || 0,
    placeholder: Boolean(result.placeholder),
    html: result.page?.html || '',
    pending: result.page?.pending || [],
    highlight: result.page?.highlight || [],
    events: result.events || [],
    ...extra,
  };
}

export function sessionIdFrom(value, runtime) {
  const requested = typeof value === 'string' ? value : '';
  if (!ID_RE.test(requested)) return { sessionId: null, reset: Boolean(requested) };
  return { sessionId: runtime.getSession(requested) ? requested : null, reset: !runtime.getSession(requested) };
}
