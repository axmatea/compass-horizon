// Live test against Nebius GLM-5.3. Run: npm run test:live  (needs NEBIUS_API_KEY in .env)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.mjs';
import { createNebiusClient } from '../../server/llm/nebius.mjs';
import { createGlmInterpreter } from '../../server/agent/interpreter.mjs';
import { createAgentRuntime } from '../../server/agent/runtime.mjs';
import { createToolRegistry } from '../../server/tools/registry.mjs';
import { createMockRestaurantSearch } from '../../server/tools/mock-restaurant-search.mjs';

const cfg = loadConfig();
const T1 = 'Schedule dinner tomorrow at 7 and find an Italian restaurant.';
const T2 = 'Actually make it 8. Somewhere near Palo Alto.';

test('live GLM-5.3: dinner 7pm -> interrupt 8pm Palo Alto', { skip: !cfg.nebius.apiKey && 'NEBIUS_API_KEY not set', timeout: 60_000 }, async () => {
  const runtime = createAgentRuntime({
    interpreter: createGlmInterpreter(createNebiusClient(cfg.nebius)),
    tools: createToolRegistry([createMockRestaurantSearch({ delayMs: 2500 })]),
  });
  const s = runtime.createSession();
  const log = [];
  runtime.subscribe(s.id, (e) => log.push({ ...e, t: performance.now() }));

  const t0 = performance.now();
  const p1 = runtime.runTurn(s.id, T1);
  // wait until turn 1's search is in flight, then interrupt
  const deadline = Date.now() + 25_000;
  while (!log.some((e) => e.type === 'tool_call')) {
    if (Date.now() > deadline) throw new Error(`turn 1 never started a tool; events: ${log.map((e) => e.type).join(',')}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  const tInterrupt = performance.now();
  const p2 = runtime.runTurn(s.id, T2);
  const [r1, r2] = await Promise.all([p1, p2]);

  const i = r2.state.intent;
  assert.match(i.task, /dinner/);
  assert.equal(i.date, 'tomorrow');
  assert.equal(i.time, '20:00');
  assert.equal(i.location, 'Palo Alto');
  assert.equal(i.cuisine, 'Italian');
  assert.equal(r2.state.version, 2);
  assert.equal(r1.superseded, true);
  assert.equal(r2.state.actions[0].status, 'invalidated');
  assert.equal(r2.state.actions.at(-1).status, 'done');
  assert.ok(log.some((e) => e.type === 'action_invalidated'));

  const patches = log.filter((e) => e.type === 'state_patch');
  console.log('LIVE', JSON.stringify({
    interpretLatencyMs: patches.map((p) => p.latencyMs),
    interruptToPatchMs: Math.round(patches[1].t - tInterrupt),
    interruptToInvalidateMs: Math.round(log.find((e) => e.type === 'action_invalidated').t - tInterrupt),
    interruptToFinalSayMs: Math.round(log.filter((e) => e.type === 'say' && e.final).at(-1).t - tInterrupt),
    totalMs: Math.round(performance.now() - t0),
    intent: i, reply1: r1.reply, reply2: r2.reply,
    acks: log.filter((e) => e.type === 'say').map((e) => e.text),
  }));
});
