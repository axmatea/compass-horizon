import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, access } from 'node:fs/promises';
import { createCompassServer } from '../server.mjs';
import { MODES, DEFAULT_MODE, REVISIONS, modeById } from '../src/site/modes.mjs';
import { briefMock, ideasMock, esc } from '../src/site/frames.mjs';
import {
  MAX_TEXT, createStudio, beginTurn, applyEvent, applyResult, closeTurn, briefRows, buildSteps,
  sourceLabel, previewName, previewDoc, parseSse, cleanText, turnError,
} from '../src/site/studio.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

async function listen(env = {}) {
  const app = createCompassServer({ env: { BUILDER_STEP_MS: '0', ...env }, fetchImpl: async () => { throw new Error('offline'); } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, origin: 'http://127.0.0.1:' + app.server.address().port };
}

async function turn(origin, state, text) {
  beginTurn(state);
  const response = await fetch(origin + '/api/site/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ sessionId: state.sessionId || undefined, text }),
  });
  if (response.status === 429) {
    applyResult(state, (await response.json()).fallback, { replay: true });
  } else {
    const { frames, rest } = parseSse(await response.text());
    assert.equal(rest, '');
    for (const frame of frames) frame.event === 'result' ? applyResult(state, frame.data) : applyEvent(state, frame.data);
  }
  closeTurn(state);
  return response.status;
}

test('homepage leads with templates while preserving builder and account navigation', async () => {
  const html = await read('index.html');
  assert.match(html, /type="search"/);
  assert.match(html, /data-public-nav/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /href="\/create\?view=account"/);
  assert.match(html, /data-platform-tour-trigger/);
  assert.doesNotMatch(html, /id="composer"|id="intent"|id="studio"/);
  for (const mode of MODES) {
    assert.equal(mode.ideas.length, 3);
    for (const idea of mode.ideas) assert.ok(idea.length <= MAX_TEXT);
  }
  assert.equal(DEFAULT_MODE, 'site');
  assert.equal(modeById('nope').id, 'site');
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  for (const [label, text] of REVISIONS) assert.ok(label && text.length <= MAX_TEXT);
});

test('template storefront keeps local assets, an honest preview story and neutral foundations', async () => {
  const html = await read('index.html');
  assert.match(html, /templates/i);
  assert.match(html, /src="\/src\/marketplace\/marketplace\.mjs"/);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\bMRR\b|testimonial|trusted by|backed by|funded|raised|Vincent/i);
  assert.match(html, /id="compass-video"/);
  assert.match(html, /rel="preload" as="font" type="font\/woff2" href="\/src\/site\/fonts\/inter-var-latin\.woff2" crossorigin/);
  await access(new URL('src/site/fonts/inter-var-latin.woff2', root));
  assert.match(await read('public/licenses/inter-OFL.txt'), /SIL OPEN FONT LICENSE/i);
  const css = await read('src/marketplace/marketplace.css');
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /https?:\/\//);
});

test('builder client follows a streamed turn, a revision and the prepared label', async (t) => {
  const { app, origin } = await listen();
  t.after(() => app.close());
  const state = createStudio();
  assert.deepEqual(buildSteps(state), []);
  assert.equal(sourceLabel(state), '');
  assert.equal(await turn(origin, state, 'A booking app for my barbershop, warm and friendly'), 200);
  assert.match(state.sessionId, /^s_/);
  assert.equal(state.phase, 'done');
  assert.equal(state.open, 0);
  assert.match(state.render.html, /^<!doctype html>/);
  assert.equal(state.render.version, 1);
  assert.equal(state.source, 'prepared');
  assert.equal(sourceLabel(state), 'Prepared copy');
  assert.equal(previewName(state.plan), 'barbershop-booking');
  assert.deepEqual(briefRows(state.plan).find(row => row.key === 'tone'), { key: 'tone', label: 'Tone', value: 'Warm', from: '' });
  assert.deepEqual(buildSteps(state).map(step => step.status), ['done', 'done', 'done']);
  assert.match(buildSteps(state)[1].text, /prepared copy/i);
  assert.match(state.reply, /\S/);

  const first = state.render.key;
  assert.equal(await turn(origin, state, 'Actually make it dark and cinematic, and add a pricing section'), 200);
  assert.equal(state.render.version, 2);
  assert.ok(state.render.key > first);
  const rows = briefRows(state.plan);
  assert.equal(rows.find(row => row.key === 'theme').from, 'Light');
  assert.equal(rows.find(row => row.key === 'theme').value, 'Dark');
  assert.ok(rows.find(row => row.key === 'sections').chips.some(chip => chip.text === 'Pricing' && chip.state === 'added'));
  assert.deepEqual(buildSteps(state).map(step => step.status), ['done', 'done', 'done']);
  const page = await fetch(origin + '/api/site/session/' + state.sessionId + '/page');
  assert.equal(page.status, 200);
});

test('builder client never dead-ends: rate limit, JSON reply and a model-written turn', async (t) => {
  const { app, origin } = await listen({ DEMO_RATE_LIMIT: '1' });
  t.after(() => app.close());
  const state = createStudio();
  assert.equal(await turn(origin, state, 'A website for my bakery'), 200);
  const limited = createStudio();
  assert.equal(await turn(origin, limited, 'A website for my bakery'), 429);
  assert.match(limited.render.html, /^<!doctype html>/);
  assert.equal(limited.phase, 'done');
  assert.equal(limited.limited, true);
  assert.equal(sourceLabel(limited), 'Prepared copy');

  const live = applyResult(createStudio(), { sessionId: 's_1', intent: { kind: 'bakery' }, patch: [], version: 1, html: '<!doctype html><p>x</p>', source: 'model', placeholder: false, reply: 'Done.' });
  assert.equal(sourceLabel(live), 'Live model');
  assert.equal(sourceLabel(applyResult(createStudio(), { intent: { kind: 'bakery' }, html: '<p>x</p>', source: 'model', placeholder: true })), 'Prepared copy');

  const busy = createStudio();
  beginTurn(busy);
  applyEvent(busy, { type: 'reasoning_status', stage: 'interpreting' });
  assert.equal(buildSteps(busy)[0].status, 'run');
  applyEvent(busy, { type: 'state_patch', sessionId: 's_2', version: 1, intent: { kind: 'studio', sections: ['features'] }, patch: [] });
  applyEvent(busy, { type: 'tool_call', actionId: 'a_1', tool: 'write_copy' });
  assert.equal(busy.phase, 'building');
  beginTurn(busy);
  assert.equal(busy.actions.length, 1);
  applyEvent(busy, { type: 'action_invalidated', actionId: 'a_1' });
  applyEvent(busy, { type: 'done' });
  assert.equal(busy.phase, 'thinking');
  assert.equal(buildSteps(busy).at(-1).status, 'off');
  closeTurn(busy);
  closeTurn(busy);
  assert.equal(busy.phase, 'idle');
  applyEvent(busy, { type: 'unknown_future_event' });
  applyEvent(busy, null);

  assert.deepEqual(parseSse(': compass\n\nevent: say\ndata: {"type":"say","text":"Hi"}\n\nevent: done\ndata: {"ty'), {
    frames: [{ event: 'say', data: { type: 'say', text: 'Hi' } }], rest: 'event: done\ndata: {"ty',
  });
  assert.deepEqual(parseSse('event: x\ndata: not json\n\n'), { frames: [], rest: '' });
  assert.equal(previewDoc('<head><title>x</title></head><body></body>'), '<head><title>x</title><style>html{scrollbar-width:none}</style></head><body></body>');
  assert.equal(previewDoc('<p>x</p>'), '<p>x</p><style>html{scrollbar-width:none}</style>');
  assert.equal(cleanText('  a\n\tb  '), 'a b');
  assert.equal(cleanText('x'.repeat(MAX_TEXT + 50)).length, MAX_TEXT);
  assert.match(turnError(400, 'text_too_long'), /500/);
  assert.match(turnError(0), /connection/i);
  assert.match(turnError(500), /Send it again/);
});

test('an interim render never inherits the previous live model label', () => {
  const state = applyResult(createStudio(), { intent: { kind: 'studio' }, html: '<p>First page</p>', version: 1, source: 'model' });
  beginTurn(state);
  applyEvent(state, { type: 'reasoning_status', stage: 'interpreting' });
  assert.equal(sourceLabel(state), 'Live model');
  applyEvent(state, { type: 'render', html: '<p>Interim page</p>', version: 2 });
  assert.equal(sourceLabel(state), '');
  applyResult(state, { html: '<p>Completed page</p>', version: 2, source: 'prepared' });
  closeTurn(state);
  assert.equal(sourceLabel(state), 'Prepared copy');
});
