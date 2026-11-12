import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCompassServer } from '../server.mjs';
import { loadLlm } from '../llm.mjs';
import { parseSse } from '../src/site/studio.mjs';

const keys = {
  ANTHROPIC_API_KEY: 'unused-anthropic-sentinel',
  GENERALCOMPUTE_API_KEY: 'unused-generalcompute-sentinel',
  NEBIUS_API_KEY: 'unused-nebius-sentinel',
};
const prepared = { configured: false, client: null, clients: [], provider: null, model: null, timeoutMs: 0 };

test('examples mode disables all provider clients even with configured keys', () => {
  assert.deepEqual(loadLlm({ ...keys, COMPASS_DEMO_MODE: 'examples' }), prepared);
  // Direct client use retains its existing contract; the HTTP server owns
  // the public default and passes its resolved mode to every model path.
  assert.equal(loadLlm(keys).configured, true);
  assert.equal(loadLlm({ ...keys, COMPASS_DEMO_MODE: 'live' }).configured, true);
});

test('public default and invalid modes never call providers across builder and plan APIs', async t => {
  for (const mode of [undefined, 'examples', 'typo', 'LIVE']) {
    await t.test(mode === undefined ? 'unset' : mode, async () => {
      let calls = 0;
      const env = { ...keys, BUILDER_STEP_MS: '0', COMPASS_REVISION: 'examples-test', DEMO_VIDEO_URL: 'https://example.com/demo.mp4' };
      if (mode !== undefined) env.COMPASS_DEMO_MODE = mode;
      const app = createCompassServer({ env, fetchImpl: async () => { calls += 1; throw new Error('provider calls are forbidden in examples mode'); } });
      try {
        app.server.listen(0, '127.0.0.1');
        await once(app.server, 'listening');
        const origin = 'http://127.0.0.1:' + app.server.address().port;
        const health = await (await fetch(origin + '/healthz')).json();
        assert.equal(health.demoMode, 'examples');
        assert.equal(health.llmConfigured, false);
        assert.equal(health.revision, 'examples-test');
        assert.equal((await (await fetch(origin + '/api/config')).json()).demoVideoUrl, env.DEMO_VIDEO_URL);
        const post = (path, body, accept = 'application/json') => fetch(origin + path, {
          method: 'POST', headers: { 'content-type': 'application/json', accept }, body: JSON.stringify(body),
        });
        const intent = 'a shared reading list for my book club';
        const first = await (await post('/api/site/turn', { text: intent })).json();
        assert.equal(first.source, 'prepared');
        assert.equal(first.placeholder, true);
        assert.match(first.html, /<!doctype html>/);
        const stream = await post('/api/site/turn', { sessionId: first.sessionId, text: 'Make it warmer and add pricing' }, 'text/event-stream');
        const result = parseSse(await stream.text()).frames.find(frame => frame.event === 'result')?.data;
        assert.equal(result.source, 'prepared');
        assert.equal(result.sessionId, first.sessionId);
        assert.match(result.html, /id="pricing"/);
        const clarify = await (await post('/api/demo/clarify', { intent })).json();
        assert.equal(clarify.ok, true);
        assert.equal(clarify.source, 'fallback');
        const plan = await (await post('/api/demo/plan', { intent, answers: [] })).json();
        assert.equal(plan.ok, true);
        assert.equal(plan.source, 'fallback');
        assert.equal(calls, 0);
        assert.equal(env.COMPASS_DEMO_MODE, mode, 'the caller environment is not mutated');
        assert.doesNotMatch(JSON.stringify({ health, first, result, clarify, plan }), /unused-.*-sentinel/);
      } finally { await app.close(); }
    });
  }
});
