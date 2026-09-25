// Minimal OpenAI-compatible chat client (Nebius Token Factory, General Compute, any /v1/chat/completions).
// No SDK dependency: plain fetch, AbortSignal support, timeout, redacted errors.

export class LlmError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export function createNebiusClient({ apiKey, baseUrl, model, provider = 'nebius', timeoutMs = 20000, thinking = false, fetchImpl = fetch }) {
  if (!apiKey) throw new LlmError(`${provider.toUpperCase()}_API_KEY is not configured`, { code: 'not_configured' });

  // thinking=false disables GLM reasoning tokens on Nebius (chat_template_kwargs.enable_thinking),
  // which cuts latency and prevents reasoning from exhausting max_tokens. Other providers ignore it.
  async function chat({ messages, tools, toolChoice, responseFormat, temperature = 0.2, maxTokens = 600, signal, thinking: think = thinking, extra = {} }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const body = { model, messages, temperature, max_tokens: maxTokens, ...extra };
    if (!think && provider === 'nebius') body.chat_template_kwargs = { enable_thinking: false, ...(extra.chat_template_kwargs || {}) };
    if (tools?.length) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
    if (responseFormat) body.response_format = responseFormat;

    const started = performance.now();
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
      if (timeout.aborted) throw new LlmError(`LLM request timed out after ${timeoutMs}ms`, { code: 'timeout', cause: err });
      throw new LlmError('LLM network error', { code: 'network', cause: err });
    }
    if (!res.ok) {
      // Error bodies from the provider never contain our key, but truncate anyway.
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new LlmError(`LLM HTTP ${res.status}: ${text}`, { status: res.status, code: 'http' });
    }
    const json = await res.json();
    const choice = json.choices?.[0] ?? {};
    return {
      message: choice.message ?? {},
      finishReason: choice.finish_reason,
      usage: json.usage,
      latencyMs: Math.round(performance.now() - started),
      provider,
      model,
    };
  }

  return { chat, model, provider };
}
export const createOpenAiCompatibleClient = createNebiusClient;

/**
 * Chain of clients: the primary answers; on transport/server errors (network, timeout, 5xx, 429)
 * the next one takes the same request. Model-specific errors (4xx) are not retried elsewhere.
 */
export function createLlmChain(clients, { logger = console } = {}) {
  if (!clients.length) throw new LlmError('No LLM configured', { code: 'not_configured' });
  if (clients.length === 1) return clients[0];
  const retriable = (err) => ['network', 'timeout'].includes(err.code) || (err.code === 'http' && (err.status >= 500 || err.status === 429));
  return {
    model: clients[0].model,
    provider: clients[0].provider,
    async chat(req) {
      let lastErr;
      for (let i = 0; i < clients.length; i++) {
        try {
          const out = await clients[i].chat(req);
          return i ? { ...out, fellBack: true } : out;
        } catch (err) {
          lastErr = err;
          if (req.signal?.aborted || !retriable(err) || i === clients.length - 1) throw err;
          logger.warn?.('[llm]', clients[i].provider, 'failed', err.code, err.status ?? '', '-> trying', clients[i + 1].provider);
        }
      }
      throw lastErr;
    },
  };
}

/** Extract the first JSON object from model text (tolerates ```json fences). */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new LlmError('No text to parse', { code: 'parse' });
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new LlmError('Model output contained no JSON object', { code: 'parse' });
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new LlmError('Model output JSON was invalid', { code: 'parse', cause: err });
  }
}
