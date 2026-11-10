// Server-side model client restored from c5cb564 compass/server/llm/nebius.mjs
// and the LLM half of compass/server/config.mjs. Keys stay in the environment.
// Nothing here is logged or sent to the browser.

export class LlmError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.code = code;
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
  const forced = env.LLM_PROVIDER === 'nebius' ? 'nebius' : /^general[_-]?compute$/i.test(env.LLM_PROVIDER || '') ? 'generalcompute' : null;
  const order = forced ? [forced] : ['generalcompute', 'nebius'];
  const configs = order.map(name => (name === 'nebius' ? nebius : generalcompute)).filter(item => item.apiKey);
  const clients = configs.map(item => createClient({ ...item, fetchImpl }));
  return { configured: clients.length > 0, client: clients.length ? createChain(clients) : null, provider: configs[0]?.provider || null, model: configs[0]?.model || null };
}

export function createClient({ apiKey, baseUrl, model, provider, timeoutMs = 8000, thinking = false, fetchImpl = fetch }) {
  async function chat({ messages, temperature = 0.3, maxTokens = 900, signal }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const body = { model, messages, temperature, max_tokens: maxTokens };
    if (!thinking && provider === 'nebius') body.chat_template_kwargs = { enable_thinking: false };
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
    const json = await res.json();
    const choice = json.choices?.[0] ?? {};
    return { message: choice.message ?? {}, provider, model };
  }
  return { chat, provider, model };
}

export function createChain(clients) {
  if (clients.length === 1) return clients[0];
  const retriable = err => ['network', 'timeout'].includes(err.code) || (err.code === 'http' && (err.status >= 500 || err.status === 429));
  return {
    provider: clients[0].provider,
    model: clients[0].model,
    async chat(req) {
      let last;
      for (let i = 0; i < clients.length; i++) {
        try { return await clients[i].chat(req); }
        catch (err) {
          last = err;
          if (req.signal?.aborted || !retriable(err) || i === clients.length - 1) throw err;
        }
      }
      throw last;
    },
  };
}

export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new LlmError('No text to parse', { code: 'parse' });
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new LlmError('Model output contained no JSON object', { code: 'parse' });
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch (err) { throw new LlmError('Model output JSON was invalid', { code: 'parse', cause: err }); }
}
