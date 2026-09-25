import { boundedText, isRecord, requireValid } from './http.mjs';

function sourceUrl(raw) {
  requireValid(boundedText(raw, 2048));
  let url;
  try { url = new URL(raw); } catch { requireValid(false); }
  requireValid(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password);
  return url.href;
}

export async function research(config, http, { query } = {}) {
  requireValid(boundedText(query, 2000), 'INVALID_INPUT');
  const data = await http('https://sdk.nimbleway.com/v2/search', {
    method: 'POST', token: config.token,
    body: JSON.stringify({ query, search_depth: 'lite', focus: 'general', max_results: 10, full_content: false, output_format: 'plain_text' }),
  });
  requireValid(isRecord(data) && !data.error && Array.isArray(data.results) && data.results.length <= 10);
  const facts = data.results.map(row => {
    requireValid(isRecord(row) && typeof row.title === 'string' && row.title.length <= 2000);
    const text = row.description ?? row.content;
    requireValid(typeof text === 'string' && text.length <= 20000);
    return { sourceUrl: sourceUrl(row.url), title: row.title, text, evidenceType: 'search_snippet', verified: false };
  });
  return { sourceURLs: [...new Set(facts.map(fact => fact.sourceUrl))], facts };
}
