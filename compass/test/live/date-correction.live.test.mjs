// Live GLM-5.3: conversational date correction mutates the existing intent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.mjs';
import { createNebiusClient } from '../../server/llm/nebius.mjs';
import { createGlmInterpreter } from '../../server/agent/interpreter.mjs';
import { createAgentRuntime } from '../../server/agent/runtime.mjs';
import { createToolRegistry } from '../../server/tools/registry.mjs';
import { createMockRestaurantSearch } from '../../server/tools/mock-restaurant-search.mjs';

const cfg = loadConfig();
test('live GLM-5.3: "next week" then "the week after next" mutates date, keeps the rest', { skip: !cfg.nebius.apiKey && 'NEBIUS_API_KEY not set', timeout: 90_000 }, async () => {
  const runtime = createAgentRuntime({ interpreter: createGlmInterpreter(createNebiusClient(cfg.nebius)), tools: createToolRegistry([createMockRestaurantSearch({ delayMs: 50 })]) });
  const s = runtime.createSession();
  await runtime.runTurn(s.id, 'Schedule dinner tomorrow at 7 and find an Italian restaurant.');
  await runtime.runTurn(s.id, 'Actually make it 8. Somewhere near Palo Alto.');
  const r3 = await runtime.runTurn(s.id, 'Can we change it for next week?');
  assert.equal(r3.state.intent.date, 'next week');
  assert.ok(r3.reply, 'always acknowledges');
  const r4 = await runtime.runTurn(s.id, 'Actually, not next week. The week after next.');
  assert.equal(r4.state.intent.date, 'the week after next');
  assert.deepEqual({ ...r4.state.intent, date: null }, { task: r4.state.intent.task, date: null, time: '20:00', location: 'Palo Alto', cuisine: 'Italian', party_size: null });
  assert.match(r4.state.intent.task, /dinner/);
  const d = r4.patch.find((p) => p.field === 'date');
  assert.deepEqual([d.from, d.to, d.status, d.change], ['next week', 'the week after next', 'active', 'updated']);
  const search = r4.state.actions.at(-1);
  assert.equal(search.args.date, 'the week after next', 'search re-planned with the new date');
});
