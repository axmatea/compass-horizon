// Record the canonical 2-turn dinner session as a /api/turn v1 contract fixture.
// Goes through the real HTTP layer and live Nebius GLM-5.3; response bodies are
// stored verbatim. Run: node --env-file=.env scripts/record-fixture.mjs
// Output contains no secrets. Restaurant results come from the MOCK tool.
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createCompassBackend } from '../server/app.mjs';

const TOOL_DELAY = 2500;
const backend = createCompassBackend({ env: { ...process.env, COMPASS_TOOLS: 'mock', MOCK_TOOL_DELAY_MS: String(TOOL_DELAY) } });
if (!backend.config.nebius.configured) throw new Error('NEBIUS_API_KEY not set');
const server = createServer((req, res) => backend.handleApi(req, res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const T1 = 'Schedule dinner tomorrow at 7 and find an Italian restaurant.';
const T2 = 'Actually make it 8. Somewhere near Palo Alto.';
const { sessionId } = await (await post('/api/session', {})).json();

// Watch the session stream so T2 is sent while T1's search is in flight.
const t0 = performance.now();
let searchStarted = false;
backend.runtime.subscribe(sessionId, (e) => { if (e.type === 'tool_call') searchStarted = true; });

const req1 = { sessionId, text: T1 };
const p1 = post('/api/turn', req1).then(async (r) => ({ status: r.status, body: await r.text() }));
const deadline = Date.now() + 30_000;
while (!searchStarted) { if (Date.now() > deadline) throw new Error('T1 never started a tool'); await new Promise((r) => setTimeout(r, 20)); }
await new Promise((r) => setTimeout(r, 900)); // interrupt mid-search
const sentT2 = Math.round(performance.now() - t0);
const req2 = { sessionId, text: T2 };
const p2 = post('/api/turn', req2).then(async (r) => ({ status: r.status, body: await r.text() }));
const [r1, r2] = await Promise.all([p1, p2]);
server.close();

const fixture = {
  contract: 'COMPASS /api/turn v1',
  recordedAt: new Date().toISOString(),
  source: { transport: 'HTTP POST /api/turn (application/json)', model: 'zai-org/GLM-5.3', tool: 'mock_restaurant_search (MOCK data)', mockToolDelayMs: TOOL_DELAY },
  note: 'Real GLM-5.3 interpretation through the real HTTP layer. Response bodies are verbatim. Restaurant results are mock placeholders, not real venues.',
  turns: [
    { request: req1, sentAtMs: 0, status: r1.status, response: JSON.parse(r1.body) },
    { request: req2, sentAtMs: sentT2, status: r2.status, response: JSON.parse(r2.body) },
  ],
};
writeFileSync(new URL('../test/fixtures/dinner-turns.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
const final = fixture.turns[1].response;
console.log(JSON.stringify({ ok: r1.status === 200 && r2.status === 200, sentT2, t1Superseded: fixture.turns[0].response.superseded, intent: final.state.intent, reply: final.reply }));
process.exit(0);
