import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCompassServer } from '../server.mjs';
import { validateResumeIntent } from '../builder/index.mjs';
import { createSiteCopyTool } from '../builder/copy.mjs';
import { parseSse } from '../src/site/studio.mjs';

const brief = { business: 'Morning Bakery', kind: 'bakery', tone: 'warm', theme: 'light', sections: ['features', 'contact'] };

test('restored briefs accept bounded known fields and never accept executable or historical state', () => {
  const valid = validateResumeIntent(brief);
  assert.equal(valid.business, 'Morning Bakery');
  assert.equal(valid.theme, 'light');
  assert.equal(valid.font, 'serif');
  assert.equal(valid.density, 'balanced');
  assert.equal(valid.mobile, 'standard');
  assert.equal(validateResumeIntent({ ...brief, font: 'sans' }).font, 'sans', 'an existing stored font is preserved');
  assert.equal(validateResumeIntent({ ...brief, density: 'airy', mobile: 'comfortable' }).density, 'airy');
  assert.deepEqual(validateResumeIntent({ ...brief, sections: [] }).sections, []);
  for (const invalid of [null, [], 'text', {}, { theme: 'dark' }, { ...brief, html: '<script>bad()</script>' },
    { ...brief, history: [] }, { ...brief, version: 90 }, { ...brief, source: 'model' }, { ...brief, kind: {} },
    { ...brief, business: 'x'.repeat(141) }, { ...brief, theme: 'unknown' }, { ...brief, sections: ['<script>'] },
    { ...brief, density: 'anything' }, { ...brief, mobile: '<script>' }]) {
    assert.equal(validateResumeIntent(invalid), null);
  }
});

test('a restored brief creates fresh copy before any further refinement, including theme-only changes', async t => {
  let calls = 0;
  const app = createCompassServer({ env: { ANTHROPIC_API_KEY: 'unused-key', GENERALCOMPUTE_API_KEY: 'unused-key' },
    fetchImpl: async () => { calls += 1; throw new Error('must stay offline'); } });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const post = (body, accept = 'application/json') => fetch(origin + '/api/site/turn', {
    method: 'POST', headers: { 'content-type': 'application/json', accept }, body: JSON.stringify(body),
  });
  const resume = await post({ sessionId: 's_expired', resumeIntent: brief, text: 'Keep the same design' });
  assert.equal(resume.status, 200);
  const first = await resume.json();
  assert.equal(first.sessionReset, true);
  assert.notEqual(first.sessionId, 's_expired');
  assert.equal(first.intent.business, brief.business);
  assert.equal(first.source, 'prepared');
  assert.deepEqual(first.pending, []);
  assert.match(first.html, /Morning Bakery/);
  assert.ok(first.events.some(event => event.type === 'tool_result'));
  assert.equal(first.version, 1);
  // An existing session keeps its own context and ignores a supplied seed.
  const existing = await (await post({ sessionId: first.sessionId, resumeIntent: { html: 'ignored' }, text: 'Make it darker' })).json();
  assert.equal(existing.intent.business, brief.business);
  assert.equal(existing.intent.theme, 'dark');
  assert.equal(existing.version, 2);
  const stream = await post({ resumeIntent: brief, text: 'Make it darker' }, 'text/event-stream');
  const restored = parseSse(await stream.text()).frames.find(frame => frame.event === 'result')?.data;
  assert.equal(restored.intent.theme, 'dark');
  assert.equal(restored.source, 'prepared');
  assert.deepEqual(restored.pending, []);
  assert.match(restored.html, /Morning Bakery/);
  assert.ok(restored.events.some(event => event.type === 'tool_result'));
  const invalid = await post({ resumeIntent: { ...brief, html: '<script>bad()</script>' }, text: 'Make it dark' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_resume_intent');
  assert.equal(calls, 0);
});

test('prepared copy is available without advancing an artificial timer', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tool = createSiteCopyTool();
  const result = await tool.run({ kind: 'bakery', sections: ['features'] });
  assert.equal(result.fallback, true);
  assert.ok(result.hero.headline);
});
