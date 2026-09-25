/**
 * Liquid AI extraction adapter. OpenAI-compatible chat completions.
 * Direct: {LIQUID_BASE_URL}/chat/completions with LIQUID_API_KEY and LIQUID_MODEL.
 * OpenRouter: https://openrouter.ai/api/v1 when OPENROUTER_API_KEY is set and LIQUID_MODEL starts with 'liquid/'.
 * Output is validated with zod; only quotes that are exact substrings of the reply survive.
 */
import { z } from 'zod';
import type { Extraction } from '@/engine/extract-rules';
import type { ReceiptInput } from '@/engine/wake';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export interface LiquidEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  via: 'liquid' | 'openrouter';
}

export function liquidEndpoint(env: NodeJS.ProcessEnv = process.env): LiquidEndpoint | null {
  const model = env.LIQUID_MODEL;
  if (env.OPENROUTER_API_KEY && model && model.startsWith('liquid/')) {
    return { baseUrl: OPENROUTER_BASE, apiKey: env.OPENROUTER_API_KEY, model, via: 'openrouter' };
  }
  if (env.LIQUID_API_KEY && env.LIQUID_BASE_URL && model) {
    return { baseUrl: env.LIQUID_BASE_URL.replace(/\/+$/, ''), apiKey: env.LIQUID_API_KEY, model, via: 'liquid' };
  }
  return null;
}

const quote = z.string().min(1).max(400).nullable().optional();
export const LiquidOutput = z.object({
  budgetUsd: z.number().nonnegative().nullable(),
  timelineDays: z.number().nonnegative().nullable(),
  decisionMaker: z.boolean().nullable(),
  problem: z.string().max(400).nullable(),
  quotes: z
    .object({ budgetUsd: quote, timelineDays: quote, decisionMaker: quote, problem: quote })
    .partial()
    .default({}),
});

const SYSTEM = [
  'You extract sales qualification fields from one reply written by a business lead.',
  'Return only a JSON object with keys: budgetUsd (number or null), timelineDays (number of days or null),',
  'decisionMaker (true, false or null), problem (short string or null), quotes (object with the same keys,',
  'each value an exact, verbatim substring of the reply that supports the field).',
  'Use null when the reply does not state a field. "No budget" means budgetUsd 0. Never guess.',
].join(' ');

function parseJson(content: string): unknown {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(content.slice(start, end + 1));
}

/** Keep a field only when its quote is an exact substring of the text. */
export function toExtraction(text: string, out: z.infer<typeof LiquidOutput>): Extraction {
  const q = out.quotes ?? {};
  const keep = <T,>(value: T | null, qt: string | null | undefined) =>
    value !== null && typeof qt === 'string' && qt.length > 0 && text.includes(qt) ? { value, quote: qt } : null;
  return {
    budgetUsd: keep(out.budgetUsd === null ? null : Math.round(out.budgetUsd), q.budgetUsd),
    timelineDays: keep(out.timelineDays === null ? null : Math.round(out.timelineDays), q.timelineDays),
    decisionMaker: keep(out.decisionMaker, q.decisionMaker),
    problem: keep(out.problem, q.problem),
  };
}

export async function liquidExtract(
  text: string,
  opts: { fetchImpl?: typeof fetch; endpoint?: LiquidEndpoint | null; timeoutMs?: number } = {},
): Promise<{ extraction: Extraction | null; receipt: ReceiptInput }> {
  const ep = opts.endpoint === undefined ? liquidEndpoint() : opts.endpoint;
  const f = opts.fetchImpl ?? fetch;
  if (!ep) return { extraction: null, receipt: { provider: 'liquid', operation: 'extract', status: 'BLOCKED', note: 'LIQUID_API_KEY not set, no call made' } };
  const started = Date.now();
  const base: Pick<ReceiptInput, 'provider' | 'operation' | 'model'> = { provider: 'liquid', operation: 'extract', model: ep.model };
  try {
    const res = await f(`${ep.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ep.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ep.model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text },
        ],
        ...(ep.via === 'openrouter' ? { usage: { include: true } } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { extraction: null, receipt: { ...base, status: 'ERROR', latencyMs, note: `HTTP ${res.status}; rules fallback used` } };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = LiquidOutput.safeParse(parseJson(content));
    if (!parsed.success) return { extraction: null, receipt: { ...base, status: 'ERROR', latencyMs, note: 'output failed schema validation; rules fallback used' } };
    const extraction = toExtraction(text, parsed.data);
    const costUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : 0;
    const kept = Object.values(extraction).filter(Boolean).length;
    return { extraction, receipt: { ...base, status: 'LIVE', latencyMs, costUsd, note: `${kept} fields kept with exact quotes${costUsd ? '' : ', provider reported no cost'}` } };
  } catch (err) {
    const name = (err as Error).name;
    return {
      extraction: null,
      receipt: { ...base, status: 'ERROR', latencyMs: Date.now() - started, note: `${name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : name === 'SyntaxError' ? 'invalid JSON' : `error ${name}`}; rules fallback used` },
    };
  }
}
