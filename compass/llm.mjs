// Server-side model client. Keys stay in the environment.
// A fallback line and a one-time model line may be logged. Neither includes
// keys, headers, prompts, or provider message text. Nothing is sent to the browser.
//
// MiniMax M2.7 (General Compute default) cannot turn reasoning off. With no
// reasoning_split flag its answer is often `<think>…</think>` plus JSON, or the
// JSON lands in reasoning_content. GLM-5.3 (Nebius default) always reasons;
// reasoning_effort=low is the supported light setting. enable_thinking=false
// is not sent: GLM-5.3 rejects a disabled thinking mode. The fast flavor is
// the same id with `-fast` appended, which Token Factory documents as the
// lower-latency serving path. A General Compute chat 404 loads GET /v1/models
// once and retries a single active id.

const MODEL_CACHE_MS = 10 * 60 * 1000;
const GC_PREFERENCE = ['gpt-oss-120b', 'minimax-m2.7', 'deepseek-v3.2', 'deepseek-v3.1'];
const modelLists = new Map();
const notedModels = new Set();
const modelNotices = [];

export function llmModelNotices() {
  return modelNotices.slice();
}

export class LlmError extends Error {
  constructor(message, { status, code, cause, finishReason, providerCode, model } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.code = code;
    this.finishReason = finishReason || '';
    this.providerCode = providerCode || '';
    this.model = model || '';
    if (cause) this.cause = cause;
  }
}

function safeToken(value, max = 96) {
  const clean = String(value ?? '').replace(/[^A-Za-z0-9_./:+-]/g, '').slice(0, max);
  return clean || '-';
}

function noteModel(provider, model) {
  const key = provider + '\0' + model;
  if (notedModels.has(key)) return;
  notedModels.add(key);
  const line = `compass demo llm model provider=${safeToken(provider)} model=${safeToken(model)}`;
  modelNotices.push(line);
  try { console.error(line); } catch { /* a log failure must not change the preview */ }
}

export function chooseNebius(env) {
  const pinned = String(env.NEBIUS_MODEL || '').trim();
  const fallback = String(env.NEBIUS_FALLBACK_MODEL || '').trim();
  const base = pinned || 'zai-org/GLM-5.3';
  if (pinned && !fallback) return { model: pinned, backupModel: '' };
  if (pinned && fallback !== pinned) return { model: pinned, backupModel: fallback };
  const fast = fallback || (base.endsWith('-fast') ? base : `${base}-fast`);
  return { model: fast, backupModel: fast === base ? '' : base };
}

function readProviderCode(text, secret) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return ''; }
  const node = parsed?.error;
  if (typeof node === 'string') return '';
  const bag = node && typeof node === 'object' ? node : parsed;
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return '';
  const raw = bag.code ?? bag.type;
  if ((typeof raw !== 'string' && typeof raw !== 'number') || (secret && String(raw).includes(secret))) return '';
  return String(raw).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60);
}

function isMissingModel(err) {
  if (err?.status === 404) return true;
  const code = String(err?.providerCode || '').toLowerCase().replace(/-/g, '_');
  return code === 'model_not_found' || code === 'unknown_model' || code === 'model_not_available' || code.includes('model_not_found');
}

function modelIds(json) {
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const ids = [];
  for (const item of data) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id !== 'string') continue;
    const clean = id.trim();
    if (!clean || clean.length > 120 || /\s/.test(clean)) continue;
    ids.push(clean);
  }
  return ids;
}

function preferModel(ids, failed) {
  const available = ids.filter(id => id !== failed);
  for (const id of GC_PREFERENCE) if (available.includes(id)) return id;
  return available[0] || '';
}

export function loadLlm(env = process.env, fetchImpl = fetch) {
  if (env.COMPASS_DEMO_MODE === 'examples') {
    return { configured: false, client: null, clients: [], provider: null, model: null, timeoutMs: 0 };
  }
  const nebiusChoice = chooseNebius(env);
  const nebius = {
    provider: 'nebius',
    apiKey: env.NEBIUS_API_KEY || '',
    baseUrl: (env.NEBIUS_BASE_URL || 'https://api.tokenfactory.us-north1.nebius.com/v1/').replace(/\/?$/, '/'),
    model: nebiusChoice.model,
    backupModel: nebiusChoice.backupModel,
    timeoutMs: Math.min(Number(env.NEBIUS_TIMEOUT_MS || 8000) || 8000, 12000),
    thinking: env.NEBIUS_THINKING === 'on',
  };
  const generalcompute = {
    provider: 'generalcompute',
    apiKey: env.GENERALCOMPUTE_API_KEY || env.GENERAL_COMPUTE_API_KEY || '',
    baseUrl: (env.GENERALCOMPUTE_BASE_URL || env.GENERAL_COMPUTE_BASE_URL || 'https://api.generalcompute.com/v1/').replace(/\/?$/, '/'),
    model: env.GENERALCOMPUTE_MODEL || env.GENERAL_COMPUTE_MODEL || 'minimax-m2.7',
    backupModel: '',
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

export function createClient({ apiKey, baseUrl, model, backupModel = '', provider, timeoutMs = 8000, thinking = false, fetchImpl = fetch }) {
  async function send(modelId, messages, temperature, maxTokens, signal, timeout, providerCaps) {
    const body = { model: modelId, messages, temperature, max_tokens: maxTokens };
    if (provider === 'nebius') {
      const cap = Math.min(maxTokens, Number(providerCaps?.nebius) || maxTokens);
      body.max_tokens = cap;
      // max_completion_tokens counts reasoning tokens. Without it, GLM can
      // think until the shared deadline even when max_tokens is small.
      body.max_completion_tokens = cap;
      if (!thinking) body.reasoning_effort = 'low';
    }
    let res;
    try {
      res = await fetchImpl(new URL('chat/completions', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted && !timeout?.aborted) throw new LlmError('LLM request cancelled', { code: 'aborted', cause: err, model: modelId });
      if (timeout?.aborted) throw new LlmError('LLM request timed out', { code: 'timeout', cause: err, model: modelId });
      throw new LlmError('LLM network error', { code: 'network', cause: err, model: modelId });
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 2000);
      throw new LlmError(`LLM HTTP ${res.status}`, { status: res.status, code: 'http', providerCode: readProviderCode(text, apiKey), model: modelId });
    }
    let json;
    try { json = await res.json(); }
    catch (err) { throw new LlmError('LLM response was not JSON', { code: 'parse', cause: err, model: modelId }); }
    const choice = json?.choices?.[0] ?? {};
    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : '';
    noteModel(provider, modelId);
    return { message: choice.message ?? {}, provider, model: modelId, finishReason };
  }

  async function activeModels(signal) {
    const now = Date.now();
    const hit = modelLists.get(baseUrl);
    if (hit && !hit.pending && hit.expires > now) return hit.ids;
    if (hit?.pending) return hit.pending;
    const pending = (async () => {
      const res = await fetchImpl(new URL('models', baseUrl), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      return json ? modelIds(json) : null;
    })().then(ids => {
      if (ids) modelLists.set(baseUrl, { ids, expires: Date.now() + MODEL_CACHE_MS });
      else {
        const current = modelLists.get(baseUrl);
        if (current?.pending) modelLists.delete(baseUrl);
      }
      return ids;
    }).catch(err => {
      const current = modelLists.get(baseUrl);
      if (current?.pending) modelLists.delete(baseUrl);
      throw err;
    });
    modelLists.set(baseUrl, { pending });
    return pending;
  }

  async function chat({ messages, temperature = 0.3, maxTokens = 900, signal, timeoutMs: timeoutOverride, providerCaps }) {
    const limit = Math.min(timeoutMs, Math.max(1, Number(timeoutOverride) || timeoutMs));
    const timeout = AbortSignal.timeout(limit);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (provider === 'anthropic') return anthropicChat({ apiKey, baseUrl, model, timeout, combined, signal, messages, temperature, maxTokens, fetchImpl });
    const attempt = modelId => send(modelId, messages, temperature, maxTokens, combined, timeout, providerCaps);
    try {
      return await attempt(model);
    } catch (err) {
      if (signal?.aborted || err?.code === 'aborted' || timeout.aborted || err?.code === 'timeout') throw err;
      if (!isMissingModel(err)) throw err;
      if (provider === 'generalcompute') {
        let ids = null;
        try { ids = await activeModels(combined); }
        catch (listErr) {
          if (timeout.aborted) throw new LlmError('LLM request timed out', { code: 'timeout', cause: listErr, model });
          if (signal?.aborted) throw new LlmError('LLM request cancelled', { code: 'aborted', cause: listErr, model });
          throw err;
        }
        const next = Array.isArray(ids) ? preferModel(ids, model) : '';
        if (!next) throw err;
        return await attempt(next);
      }
      if (provider === 'nebius' && backupModel && backupModel !== model) return await attempt(backupModel);
      throw err;
    }
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
    throw new LlmError(`LLM HTTP ${res.status}`, { status: res.status, code: 'http', providerCode: readProviderCode(text, apiKey), model });
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
  const model = typeof err?.model === 'string' && err.model ? err.model : client.model;
  const providerCode = typeof err?.providerCode === 'string' ? err.providerCode.slice(0, 60) : '';
  return { provider: client.provider, model, code, status, category, providerCode };
}

// One shared deadline for every configured provider. A fast failure (4xx,
// unparseable JSON, rejected shape) still tries the next provider. A call
// that uses the whole timeout does not start another one past the cap.
export async function completeJson({ clients, messages, maxTokens, accept, signal, providerCaps }) {
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
        providerCaps,
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
