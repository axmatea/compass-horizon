/** Nimble web search adapter (market evidence). POST https://sdk.nimbleway.com/v2/search with a bearer key. */
import type { MarketSource, ReceiptInput } from '@/engine/wake';

export const NIMBLE_SEARCH_URL = 'https://sdk.nimbleway.com/v2/search';

export function nimbleConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NIMBLE_API_KEY);
}

/** Strip anything that looks like personal contact data from a fact. No personal contact scraping. */
export function scrubFact(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number removed]')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(s: string): string {
  const t = scrubFact(s);
  const m = t.match(/^(.{20,240}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 240)).trim();
}

interface NimbleResult {
  title?: string;
  url?: string;
  description?: string;
  content?: string;
}

export async function nimbleSearch(
  query: string,
  opts: { fetchImpl?: typeof fetch; apiKey?: string; timeoutMs?: number; now?: () => string } = {},
): Promise<{ sources: MarketSource[] | null; receipt: ReceiptInput }> {
  const apiKey = opts.apiKey ?? process.env.NIMBLE_API_KEY;
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  if (!apiKey) return { sources: null, receipt: { provider: 'nimble', operation: 'search', status: 'BLOCKED', note: 'NIMBLE_API_KEY not set, no call made' } };
  const started = Date.now();
  try {
    const res = await f(NIMBLE_SEARCH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, focus: 'general', max_results: 5, search_depth: 'lite' }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { sources: null, receipt: { provider: 'nimble', operation: 'search', status: 'ERROR', latencyMs, note: `HTTP ${res.status}` } };
    const data = (await res.json()) as { results?: NimbleResult[] };
    const results = Array.isArray(data.results) ? data.results : [];
    const fetchedAt = now();
    const sources: MarketSource[] = results
      .filter((r) => r.url && r.title && /^https?:\/\//.test(r.url))
      .slice(0, 3)
      .map((r) => ({ title: scrubFact(r.title as string).slice(0, 160), url: r.url as string, fetchedAt, fact: firstSentence(r.description || r.content || r.title || '') }));
    return { sources, receipt: { provider: 'nimble', operation: 'search', status: 'LIVE', latencyMs, note: `${sources.length} sources kept (title, url, one fact)` } };
  } catch (err) {
    const name = (err as Error).name;
    return { sources: null, receipt: { provider: 'nimble', operation: 'search', status: 'ERROR', latencyMs: Date.now() - started, note: name === 'TimeoutError' || name === 'AbortError' ? 'timeout after 10s' : `network error: ${name}` } };
  }
}
