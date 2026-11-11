// Server-side model client. Keys stay in the environment.
// Nothing here is logged or sent to the browser.
//
// MiniMax M2.7 (General Compute default) cannot turn reasoning off. With no
// reasoning_split flag its answer is often `<think>…</think>` plus JSON, or the
// JSON lands in reasoning_content. GLM-5.3 (Nebius default) always reasons;
// reasoning_effort=low is the supported light setting. enable_thinking=false
// is not sent: GLM-5.3 rejects a disabled thinking mode.

export class LlmError extends Error {
  constructor(message, { status, code, cause, finishReason } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.code = code;
    this.finishReason = finishReason || '';
    if (cause) this.cause = cause;
  }
}

export function loadLlm(env = process.env, fetchImpl = fetch) {
  const nebius = {
    provider: 'nebius',
    apiKey: env.NEBIUS_API_KEY || '',
    baseUrl: (env.NEBIUS_BASE_URL || 'https://api.tokenfactory.us-north1.nebius.com/v1/').replace(/\/?$/, '/'),
    model: env.NEBIUS_MODEL || 'zai-org/GLM-5.3',
    timeoutMs: Math.min(Number(env.NEBIUS_TIMEOUT_MS || 8000) || 8000, 12000),
    thinking: env.NEBIUS_THINKING === 'on',
  };
  const generalcompute = {
    provider: 'generalcompute',
    apiKey: env.GENERALCOMPUTE_API_KEY || env.GENERAL_COMPUTE_API_KEY || '',
    baseUrl: (env.GENERALCOMPUTE_BASE_URL || env.GENERAL_COMPUTE_BASE_URL || 'https://api.generalcompute.com/v1/').replace(/\/?$/, '/'),
    model: env.GENERALCOMPUTE_MODEL || env.GENERAL_COMPUTE_MODEL || 'minimax-m2.7',
    timeoutMs: Math.min(Number(env.GENERALCOMPUTE_TIMEOUT_MS || env.GENERAL_COMPUTE_TIMEOUT_MS || env.NEBIUS_TIMEOUT_MS || 8000) || 8000, 12000),
    thinking: false,
  };
  const anthropic = {
    provider: 'anthropic',
    apiKey: env.ANTHROPIC_API_KEY || '',
    baseUrl: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/').replace(/\/?$/, '/'),
    model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
    timeoutMs: Math.min(Number(env.ANTHROPIC_TIMEOUT_MS || 8000) || 8000, 12000),
    thinking: false,
  };
  const forced = env.LLM_PROVIDER === 'nebius' ? 'nebius'
    : /^general[_-]?compute$/i.test(env.LLM_PROVIDER || '') ? 'generalcompute'
      : /^anthropic$/i.test(env.LLM_PROVIDER || '') ? 'anthropic' : null;
  const order = forced ? [forced] : ['anthropic', 'generalcompute', 'nebius'];
  const catalog = { anthropic, generalcompute, nebius };
  const configs = order.map(name => catalog[name]).filter(item => item && item.apiKey);
  const clients = configs.map(item => createClient({ ...item, fetchImpl }));
  const timeoutMs = clients.length ? Math.min(12000, Math.max(...clients.map(item => item.timeoutMs))) : 0;
  return {
    configured: clients.length > 0,
    client: clients.length ? createChain(clients, timeoutMs) : null,
    clients,
    provider: configs[0]?.provider || null,
    model: configs[0]?.model || null,
    timeoutMs,
  };
}

export function createClient({ apiKey, baseUrl, model, provider, timeoutMs = 8000, thinking = false, fetchImpl = fetch }) {
  async function chat({ messages, temperature = 0.3, maxTokens = 900, signal, timeoutMs: timeoutOverride }) {
    const limit = Math.min(timeoutMs, Math.max(1, Number(timeoutOverride) || timeoutMs));
    const timeout = AbortSignal.timeout(limit);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (provider === 'anthropic') return anthropicChat({ apiKey, baseUrl, model, timeout, combined, signal, messages, temperature, maxTokens, fetchImpl });
    const body = { model, messages, temperature, max_tokens: maxTokens };
    if (provider === 'nebius' && !thinking) body.reasoning_effort = 'low';
    let res;
    try {
      res = await fetchImpl(new URL('chat/completions', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      if (signal?.aborted) throw new LlmError('LLM request cancelled', { code: 'aborted', cause: err });
      if (timeout.aborted) throw new LlmError('LLM request timed out', { code: 'timeout', cause: err });
      throw new LlmError('LLM network error', { code: 'network', cause: err });
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 180);
      throw new LlmError(`LLM HTTP ${res.status}`, { status: res.status, code: 'http', cause: text });
    }
    let json;
    try { json = await res.json(); }
    catch (err) { throw new LlmError('LLM response was not JSON', { code: 'parse', cause: err }); }
    const choice = json?.choices?.[0] ?? {};
    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : '';
    return { message: choice.message ?? {}, provider, model, finishReason };
  }
  return { chat, provider, model, timeoutMs };
}

async function anthropicChat({ apiKey, baseUrl, model, timeout, combined, signal, messages, temperature, maxTokens, fetchImpl }) {
  const system = messages.filter(item => item.role === 'system').map(item => contentToString(item.content)).filter(Boolean).join('\n\n');
  const dialogue = messages.filter(item => item.role !== 'system').map(item => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: contentToString(item.content),
  }));
  const body = { model, max_tokens: maxTokens, temperature, messages: dialogue.length ? dialogue : [{ role: 'user', content: 'Respond with one JSON object.' }] };
  if (system) body.system = system;
  let res;
  try {
    res = await fetchImpl(new URL('messages', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted) throw new LlmError('LLM request cancelled', { code: 'aborted', cause: err });
    if (timeout.aborted) throw new LlmError('LLM request timed out', { code: 'timeout', cause: err });
    throw new LlmError('LLM network error', { code: 'network', cause: err });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 180);
    throw new LlmError(`LLM HTTP ${res.status}`, { status: res.status, code: 'http', cause: text });
  }
  let json;
  try { json = await res.json(); }
  catch (err) { throw new LlmError('LLM response was not JSON', { code: 'parse', cause: err }); }
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
  const thinking = blocks.filter(block => block?.type === 'thinking' && typeof block.thinking === 'string').map(block => block.thinking).join('\n');
  return { message: { content: text, reasoning_content: thinking }, provider: 'anthropic', model, finishReason: typeof json?.stop_reason === 'string' ? json.stop_reason : '' };
}

export function createChain(clients, budgetMs = 8000) {
  if (clients.length === 1) return clients[0];
  return {
    provider: clients[0].provider,
    model: clients[0].model,
    timeoutMs: budgetMs,
    async chat(req) {
      const started = Date.now();
      let last;
      for (let i = 0; i < clients.length; i++) {
        if (req.signal?.aborted) throw new LlmError('LLM request cancelled', { code: 'aborted' });
        const remaining = budgetMs - (Date.now() - started);
        if (i > 0 && remaining < 250) break;
        try {
          return await clients[i].chat({ ...req, timeoutMs: Math.min(clients[i].timeoutMs || budgetMs, Math.max(1, remaining)) });
        } catch (err) {
          last = err;
          if (req.signal?.aborted || err?.code === 'aborted' || i === clients.length - 1) throw err;
        }
      }
      throw last;
    },
  };
}

const SCHEMA_KEYS = ['questions', 'clarifying_questions', 'clarifyingQuestions', 'screens', 'pages', 'dataModel', 'data_model', 'entities', 'integrations'];

function contentToString(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
    return '';
  }).join('');
}

function reasoningText(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.reasoning_content === 'string') return message.reasoning_content;
  if (typeof message.reasoning === 'string') return message.reasoning;
  return '';
}

function prepareModelText(text) {
  const closed = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  const unclosed = /<think(?:ing)?>/i.test(closed);
  return { body: closed.replace(/<\/?think(?:ing)?>/gi, ''), unclosed };
}

function balancedEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseObject(slice) {
  const repaired = slice.replace(/,\s*([}\]])/g, '$1');
  for (const item of repaired === slice ? [slice] : [slice, repaired]) {
    try {
      const value = JSON.parse(item);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* try the repaired form, then the next brace */ }
  }
  return null;
}

function schemaScore(obj) {
  let score = 0;
  for (const key of SCHEMA_KEYS) if (Array.isArray(obj[key])) score += obj[key].length + 1;
  if (typeof obj.title === 'string' || typeof obj.summary === 'string') score += 1;
  return score;
}

function selectJson(text, { preferLast = false } = {}) {
  const found = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch !== '{') continue;
    const end = balancedEnd(text, i);
    if (end < 0) continue;
    const obj = parseObject(text.slice(i, end + 1));
    if (obj) found.push(obj);
    i = end;
  }
  if (!found.length) return null;
  const interesting = found.map((obj, index) => ({ obj, index, score: schemaScore(obj) })).filter(item => item.score > 0);
  if (!interesting.length) return found[preferLast ? found.length - 1 : 0];
  if (preferLast) return interesting[interesting.length - 1].obj;
  interesting.sort((a, b) => b.score - a.score || a.index - b.index);
  return interesting[0].obj;
}

export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new LlmError('No text to parse', { code: 'parse' });
  const prepared = prepareModelText(text);
  const json = selectJson(prepared.body, { preferLast: prepared.unclosed });
  if (!json) throw new LlmError('Model output contained no JSON object', { code: 'parse' });
  return json;
}

export function jsonCandidates(message) {
  const candidates = [];
  const content = contentToString(message?.content);
  if (content.trim()) {
    try { candidates.push(parseJsonLoose(content)); }
    catch { /* content had no JSON object; reasoning_content may */ }
  }
  const reasoning = reasoningText(message);
  if (reasoning.includes('{')) {
    const parsed = selectJson(reasoning, { preferLast: true });
    if (parsed) candidates.push(parsed);
  }
  return candidates;
}

function describeFailure(err, client) {
  const code = typeof err?.code === 'string' && err.code ? err.code : 'error';
  const status = Number.isInteger(err?.status) ? err.status : '';
  let category = code === 'http' ? `http ${status || 'error'}` : code;
  if (code === 'parse' && err?.finishReason === 'length') category = 'truncated';
  return { provider: client.provider, model: client.model, code, status, category };
}

// One shared deadline for every configured provider. A fast failure (4xx,
// unparseable JSON, rejected shape) still tries the next provider. A call
// that uses the whole timeout does not start another one past the cap.
export async function completeJson({ clients, messages, maxTokens, accept, signal }) {
  if (!clients?.length) return { json: null, failures: [] };
  const budgetMs = Math.min(12000, Math.max(...clients.map(item => item.timeoutMs || 8000)));
  const started = Date.now();
  const failures = [];
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    if (signal?.aborted) break;
    const remaining = budgetMs - (Date.now() - started);
    if (i > 0 && remaining < 250) break;
    try {
      const out = await client.chat({
        messages,
        maxTokens,
        signal,
        timeoutMs: Math.min(client.timeoutMs || budgetMs, Math.max(1, remaining)),
      });
      const candidates = jsonCandidates(out.message);
      const accepted = candidates.find(item => accept(item));
      if (accepted) return { json: accepted, provider: out.provider, model: out.model, failures: [] };
      throw new LlmError(candidates.length ? 'Model output shape was rejected' : 'Model output contained no JSON object', {
        code: candidates.length ? 'shape' : 'parse',
        finishReason: out.finishReason,
      });
    } catch (err) {
      failures.push(describeFailure(err, client));
      if (signal?.aborted || err?.code === 'aborted') break;
    }
  }
  return { json: null, failures };
}
