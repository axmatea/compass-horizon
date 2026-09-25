// Capability + latency probe for Nebius GLM-5.3. Run:
//   node --env-file=.env scripts/nebius-probe.mjs
// Prints results only. Never prints the API key.
// Default mode: thinking off (NEBIUS_THINKING=on to enable).
import { loadConfig } from '../server/config.mjs';
import { createNebiusClient, parseJsonLoose } from '../server/llm/nebius.mjs';

const cfg = loadConfig();
const llm = createNebiusClient(cfg.nebius);
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, ...detail }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail)); };

async function step(name, fn) {
  try { await fn(); } catch (err) { record(name, false, { error: err.code || err.name, message: String(err.message).slice(0, 200) }); }
}

await step('basic_completion', async () => {
  const r = await llm.chat({ messages: [{ role: 'user', content: 'Reply with exactly: COMPASS online' }], maxTokens: 400 });
  record('basic_completion', /COMPASS online/i.test(r.message.content || ''), { latencyMs: r.latencyMs, finish: r.finishReason, usage: r.usage, hasReasoning: Boolean(r.message.reasoning_content), content: (r.message.content || '').slice(0, 80) });
});

await step('json_mode', async () => {
  const r = await llm.chat({
    messages: [
      { role: 'system', content: 'Return only a JSON object: {"task":string,"time":"HH:MM"}.' },
      { role: 'user', content: 'Schedule dinner tomorrow at 7.' },
    ],
    responseFormat: { type: 'json_object' }, maxTokens: 400,
  });
  const obj = parseJsonLoose(r.message.content);
  record('json_mode', typeof obj.task === 'string' && /^\d{2}:\d{2}$/.test(obj.time), { latencyMs: r.latencyMs, obj });
});

await step('json_schema', async () => {
  const r = await llm.chat({
    messages: [{ role: 'user', content: 'Dinner tomorrow at 8 near Palo Alto. Extract fields.' }],
    responseFormat: { type: 'json_schema', json_schema: { name: 'slots', strict: true, schema: { type: 'object', additionalProperties: false, required: ['time', 'location'], properties: { time: { type: 'string' }, location: { type: 'string' } } } } },
    maxTokens: 400,
  });
  const obj = parseJsonLoose(r.message.content);
  record('json_schema', Boolean(obj.time && obj.location), { latencyMs: r.latencyMs, obj });
});

await step('tool_calling', async () => {
  const r = await llm.chat({
    messages: [{ role: 'user', content: 'Find an Italian restaurant near Palo Alto.' }],
    tools: [{ type: 'function', function: { name: 'search_places', description: 'Search restaurants', parameters: { type: 'object', properties: { cuisine: { type: 'string' }, location: { type: 'string' } }, required: ['cuisine', 'location'] } } }],
    toolChoice: 'auto', maxTokens: 400,
  });
  const call = r.message.tool_calls?.[0];
  record('tool_calling', call?.function?.name === 'search_places', { latencyMs: r.latencyMs, finish: r.finishReason, call: call ? { name: call.function.name, args: call.function.arguments } : null });
});

await step('abort_cancellation', async () => {
  const ac = new AbortController();
  const t0 = performance.now();
  setTimeout(() => ac.abort(), 150);
  try {
    await llm.chat({ messages: [{ role: 'user', content: 'Write 300 words about compasses.' }], maxTokens: 800, signal: ac.signal });
    record('abort_cancellation', false, { note: 'completed before abort' });
  } catch (err) {
    record('abort_cancellation', err.code === 'aborted', { code: err.code, cancelledAfterMs: Math.round(performance.now() - t0) });
  }
});

// Latency sample: 5 short structured calls per mode, typical of one turn.
for (const thinking of [false, true]) {
  const name = `latency_thinking_${thinking ? 'on' : 'off'}`;
  await step(name, async () => {
    const lat = [];
    for (let i = 0; i < 5; i++) {
      const r = await llm.chat({ messages: [{ role: 'system', content: 'Return only JSON {"time":"HH:MM"}.' }, { role: 'user', content: 'make it 8 pm' }], responseFormat: { type: 'json_object' }, maxTokens: 400, thinking });
      lat.push(r.latencyMs);
    }
    lat.sort((a, b) => a - b);
    record(name, true, { runsMs: lat, medianMs: lat[2], p90ish: lat[4] });
  });
}

console.log('SUMMARY', JSON.stringify({ model: llm.model, passed: results.filter(r => r.ok).length, total: results.length }));
