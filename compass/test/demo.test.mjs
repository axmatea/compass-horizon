import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCompassServer } from '../server.mjs';
import { mock } from 'node:test';
import { clarifyLocal, planLocal, EXAMPLES, MAX_INTENT } from '../src/demo/catalog.mjs';
import { demoVideoUrl } from '../demo-api.mjs';
import { createDictation, defaultAnswers, joinSpeech, pauseShouldSubmit, voiceErrorMessage } from '../src/demo/voice.mjs';

const secret = 'super-secret-key-value';

async function listen(env, fetchImpl) {
  const root = await mkdtemp(join(tmpdir(), 'compass-demo-'));
  await writeFile(join(root, 'index.html'), '<h1>index</h1>');
  await writeFile(join(root, 'demo.html'), '<h1>demo</h1>');
  const app = createCompassServer({ env: { STATIC_ROOT: root, COMPASS_REVISION: 'demo-test', ...env }, fetchImpl });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, root, origin: 'http://127.0.0.1:' + app.server.address().port };
}

test('prepared examples ask questions and reflect the answers in the preview', () => {
  for (const example of EXAMPLES) {
    const clarified = clarifyLocal('', example.id);
    assert.equal(clarified.ok, true);
    assert.equal(clarified.questions.length >= 1 && clarified.questions.length <= 3, true);
    const answers = clarified.questions.map(question => ({ id: question.id, prompt: question.prompt, value: question.options[1] || question.options[0] }));
    const plan = planLocal(example.intent, example.id, answers);
    assert.equal(plan.ok, true);
    assert.ok(plan.screens.length >= 3);
    assert.ok(plan.dataModel.length >= 2);
    assert.ok(plan.integrations.length >= 1);
    assert.ok(plan.preview.tabs.length >= 2);
    const blob = JSON.stringify(plan.preview);
    assert.match(blob, new RegExp(answers[0].value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(blob, /\$\d/);
  }
  assert.equal(clarifyLocal('   ', null).error, 'empty');
  assert.equal(clarifyLocal('x'.repeat(MAX_INTENT + 1), null).error, 'too_long');
  const custom = planLocal('a shared reading list for my book club', null, [{ id: 'q1', value: 'A team' }]);
  assert.equal(custom.source, undefined);
  assert.match(custom.summary, /book club/);
  assert.match(JSON.stringify(custom.preview), /A team/);
});

test('video URL is https only and live mode falls back when the model fails', async () => {
  assert.equal(demoVideoUrl({}), null);
  assert.equal(demoVideoUrl({ DEMO_VIDEO_URL: 'http://example.com/a.mp4' }), null);
  assert.equal(demoVideoUrl({ DEMO_VIDEO_URL: 'https://user:pass@example.com/a.mp4' }), null);
  assert.equal(demoVideoUrl({ DEMO_VIDEO_URL: 'https://example.com/film.mp4' }), 'https://example.com/film.mp4');
  const seen = [];
  const ctx = await listen({
    COMPASS_DEMO_MODE: 'live',
    DEMO_VIDEO_URL: 'https://example.com/film.mp4',
    NEBIUS_API_KEY: secret,
    DEMO_RATE_LIMIT: '2',
  }, async () => { seen.push('called'); throw new Error('down'); });
  try {
    const config = await (await fetch(ctx.origin + '/api/config')).json();
    assert.equal(config.demoVideoUrl, 'https://example.com/film.mp4');
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' };
    const body = JSON.stringify({ exampleId: 'barber' });
    const first = await (await fetch(ctx.origin + '/api/demo/clarify', { method: 'POST', headers, body })).json();
    assert.equal(first.source, 'example');
    assert.equal(first.questions.length, 3);
    assert.equal(seen.length, 0, 'example runs do not call the model');
    const plan = await (await fetch(ctx.origin + '/api/demo/plan', { method: 'POST', headers, body: JSON.stringify({ exampleId: 'barber', answers: [{ id: 'q3', value: 'The barber' }] }) })).json();
    assert.equal(plan.ok, true);
    assert.match(JSON.stringify(plan.preview), /The barber/);
    const limited = await fetch(ctx.origin + '/api/demo/clarify', { method: 'POST', headers, body });
    assert.equal(limited.status, 429);
    const limitedBody = await limited.json();
    assert.equal(limitedBody.error, 'rate_limited');
    assert.equal(limitedBody.fallback.preview.tabs.length >= 2, true);
    assert.equal(JSON.stringify(limitedBody).includes(secret), false);
    const custom = await (await fetch(ctx.origin + '/api/demo/clarify', { method: 'POST', headers: { ...headers, 'x-forwarded-for': '203.0.113.11' }, body: JSON.stringify({ intent: 'a shared reading list for my book club' }) })).json();
    assert.equal(custom.source, 'fallback');
    assert.equal(custom.ok, true);
    assert.equal(seen.length > 0, true);
    const health = await (await fetch(ctx.origin + '/healthz')).json();
    assert.equal(health.demoMode, 'live');
    assert.equal(health.llmConfigured, true);
    assert.equal(JSON.stringify(health).includes(secret), false);
  } finally {
    await ctx.app.close();
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test('a valid model response is used and never echoes the key', async () => {
  let auth = '';
  const ctx = await listen({ COMPASS_DEMO_MODE: 'live', NEBIUS_API_KEY: secret, LLM_PROVIDER: 'nebius' }, async (_url, opts) => {
    auth = opts.headers.Authorization;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      questions: [{ prompt: 'Which first screen?', options: ['Schedule', 'List'] }],
    }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const res = await fetch(ctx.origin + '/api/demo/clarify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: 'a shared reading list for my book club' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.source, 'model');
    assert.equal(body.questions[0].options[0], 'Schedule');
    assert.match(auth, new RegExp('Bearer ' + secret));
    assert.equal(JSON.stringify(body).includes(secret), false);
  } finally {
    await ctx.app.close();
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test('voice skip defaults are the first answer and the transcript stays text', () => {
  assert.equal(pauseShouldSubmit({ text: '  a booking app ', manual: false }), false);
  assert.equal(pauseShouldSubmit({ text: '  a booking app ', manual: false, autoSubmit: true }), true);
  assert.equal(pauseShouldSubmit({ text: 'a booking app', manual: true }), false);
  assert.equal(pauseShouldSubmit({ text: '   ', manual: false }), false);
  assert.equal(joinSpeech(['  a booking ', 'app\nfor my shop'], 500), 'a booking app for my shop');
  assert.equal(joinSpeech(['a booking app for my barbershop with SMS'], 18), 'a booking app for');
  assert.equal(voiceErrorMessage('not-allowed'), 'Microphone access was denied. Type the idea instead.');
  for (const example of EXAMPLES) {
    const clarified = clarifyLocal(example.intent);
    const answers = defaultAnswers(clarified.questions);
    assert.deepEqual(answers.map(item => item.value), clarified.questions.map(question => question.options[0]));
    const plan = planLocal(clarified.intent, null, answers);
    assert.equal(plan.ok, true);
    assert.match(JSON.stringify(plan.preview), new RegExp(answers[0].value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('dictation streams interim speech and leaves paused text ready to edit', t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const seen = [];
  let session = null;
  class FakeRecognition {
    constructor() { session = this; }
    start() { this.started = true; }
    abort() { this.aborted = true; }
  }
  const dictation = createDictation({ SpeechRecognition: FakeRecognition }, {
    onState: state => seen.push('state:' + state),
    onTranscript: text => seen.push('text:' + text),
    onSubmit: text => seen.push('submit:' + text),
    onError: message => seen.push('error:' + message),
    onEnd: reason => seen.push('end:' + reason),
  }, { pauseMs: 1000, max: 80 });
  assert.equal(dictation.start(), true);
  assert.equal(session.started, true);
  assert.equal(session.interimResults, true);
  assert.equal(session.continuous, true);
  session.onresult({ results: [{ isFinal: false, 0: { transcript: 'a booking' } }] });
  assert.equal(seen.at(-1), 'text:a booking');
  mock.timers.tick(1000);
  assert.equal(seen.some(item => item.startsWith('submit:')), false);
  session.onspeechend();
  mock.timers.tick(999);
  assert.equal(seen.some(item => item.startsWith('submit:')), false);
  mock.timers.tick(1);
  assert.equal(seen.at(-1), 'end:pause');
  assert.equal(seen.some(item => item.startsWith('submit:')), false);
  assert.equal(session.aborted, true);
});

test('stopping the microphone or denying it does not submit', t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let session = null;
  class FakeRecognition {
    constructor() { session = this; }
    start() {}
    abort() { this.aborted = true; }
  }
  const submitted = [];
  const errors = [];
  const dictation = createDictation({ webkitSpeechRecognition: FakeRecognition }, {
    onSubmit: text => submitted.push(text),
    onError: message => errors.push(message),
    onState() {},
    onTranscript() {},
    onEnd() {},
  }, { pauseMs: 1000, max: 500 });
  dictation.start();
  session.onresult({ results: [{ isFinal: true, 0: { transcript: 'keep this draft' } }] });
  dictation.stop();
  mock.timers.tick(5000);
  assert.deepEqual(submitted, []);
  assert.equal(dictation.active, false);

  const denied = [];
  let deniedSession = null;
  class Denied {
    constructor() { deniedSession = this; }
    start() {}
    abort() {}
  }
  const second = createDictation({ SpeechRecognition: Denied }, {
    onSubmit: text => denied.push(text),
    onError: message => errors.push(message),
    onState() {},
    onTranscript() {},
    onEnd() {},
  }, { pauseMs: 1000, max: 500 });
  second.start();
  deniedSession.onresult({ results: [{ isFinal: false, 0: { transcript: 'secret audio' } }] });
  deniedSession.onerror({ error: 'not-allowed' });
  mock.timers.tick(5000);
  assert.deepEqual(denied, []);
  assert.match(errors.at(-1), /Microphone access was denied/);

  class SyncDeny {
    start() { this.onerror?.({ error: 'not-allowed' }); }
    abort() {}
  }
  const syncSubmits = [];
  const syncErrors = [];
  const sync = createDictation({ SpeechRecognition: SyncDeny }, {
    onSubmit: text => syncSubmits.push(text),
    onError: message => syncErrors.push(message),
    onState() {},
    onTranscript() {},
    onEnd() {},
  }, { pauseMs: 1000, max: 500 });
  assert.equal(sync.start(), false);
  assert.equal(sync.active, false);
  assert.deepEqual(syncSubmits, []);
  assert.match(syncErrors[0], /Microphone access was denied/);
});
