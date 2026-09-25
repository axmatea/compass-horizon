import { createAgentRuntime } from '../server/agent/runtime.mjs';
import { createToolRegistry } from '../server/tools/registry.mjs';
import { createMockRestaurantSearch } from '../server/tools/mock-restaurant-search.mjs';

/** Deterministic stand-in for GLM: maps utterance -> interpretation. */
export function scriptedInterpreter(script, { delayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async interpret({ text, state }) {
      calls.push({ text, version: state.version });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const out = script[text];
      if (!out) { const e = new Error('no script'); e.code = 'parse'; throw e; }
      return { set: {}, unset: [], tool: null, reply: '', ...out, latencyMs: delayMs };
    },
  };
}

export const DINNER_SCRIPT = {
  'Schedule dinner tomorrow at 7 and find an Italian restaurant.': {
    set: { task: 'schedule dinner', date: 'tomorrow', time: '19:00', cuisine: 'Italian' },
    tool: 'mock_restaurant_search', reply: 'Dinner tomorrow at 7. Looking for Italian places.',
  },
  'Actually make it 8. Somewhere near Palo Alto.': {
    set: { time: '20:00', location: 'Palo Alto' },
    tool: 'mock_restaurant_search', reply: 'Moving it to 8, searching near Palo Alto.',
  },
  'We are four people.': { set: { party_size: 4 }, reply: 'Party of four.' },
};

export const T1 = 'Schedule dinner tomorrow at 7 and find an Italian restaurant.';
export const T2 = 'Actually make it 8. Somewhere near Palo Alto.';

export function makeRuntime({ toolDelayMs = 200, interpreter = scriptedInterpreter(DINNER_SCRIPT) } = {}) {
  const tools = createToolRegistry([createMockRestaurantSearch({ delayMs: toolDelayMs })]);
  return { runtime: createAgentRuntime({ interpreter, tools }), interpreter, tools };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
