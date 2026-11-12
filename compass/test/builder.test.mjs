import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCompassServer } from '../server.mjs';
import { loadLlm } from '../llm.mjs';

const LINES = [
  'Build me a premium website for an AI company. Make it minimal, dark and cinematic.',
  'Actually, make it warmer. Make the hero more ambitious, and add a pricing section.',
  'Now make it lighter, and add a testimonials section.',
];
const anthropicKey = 'anthropic-test-key';

async function listen(env, fetchImpl) {
  const root = await mkdtemp(join(tmpdir(), 'compass-builder-'));
  await writeFile(join(root, 'index.html'), '<h1>index</h1>');
  await writeFile(join(root, 'demo.html'), '<h1>demo</h1>');
  const app = createCompassServer({ env: { STATIC_ROOT: root, COMPASS_REVISION: 'builder-test', BUILDER_STEP_MS: '0', ...env }, fetchImpl });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, root, origin: 'http://127.0.0.1:' + app.server.address().port };
}

function anthropicMessage(text) {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function turn(origin, text, sessionId, headers = {}) {
  const response = await fetch(origin + '/api/site/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify({ text, sessionId }),
  });
  return { status: response.status, body: await response.json() };
}

test('a visitor with no key still sees the brief, the build, and the page', async () => {
  const seen = [];
  const ctx = await listen({}, async () => { seen.push('called'); throw new Error('no key'); });
  try {
    const first = await turn(ctx.origin, LINES[0]);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.source, 'prepared');
    assert.equal(first.body.intent.theme, 'dark');
    assert.equal(first.body.intent.kind, 'ai company');
    assert.match(first.body.html, /data-theme="dark"/);
    assert.match(first.body.html, /AI Company/);
    assert.ok(first.body.events.some(event => event.type === 'tool_call'));
    assert.ok(first.body.events.some(event => event.type === 'render'));
    assert.equal(seen.length, 0);
    const second = await turn(ctx.origin, LINES[1], first.body.sessionId);
    assert.equal(second.body.intent.accent, 'gold');
    assert.ok(second.body.intent.sections.includes('pricing'));
    assert.match(second.body.html, /Pricing/);
    const third = await turn(ctx.origin, LINES[2], first.body.sessionId);
    assert.equal(third.body.intent.theme, 'light');
    assert.ok(third.body.intent.sections.includes('testimonials'));
    assert.match(third.body.html, /data-theme="light"/);
    assert.match(third.body.html, /What people say/);
    assert.doesNotMatch(third.body.html, /\$\d|£\d|€\d/);
    const darker = await turn(ctx.origin, 'Make it darker.', first.body.sessionId);
    assert.equal(darker.body.source, 'prepared');
    assert.equal(darker.body.intent.theme, 'dark');
    assert.match(darker.body.html, /data-theme="dark"/);
    assert.equal(JSON.stringify(third.body).includes('sk-'), false);
    const page = await fetch(ctx.origin + '/api/site/session/' + first.body.sessionId + '/page');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /What people say/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  } finally {
    await ctx.app.close();
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test('anthropic is called first with the fast default and a stub failure still builds', async () => {
  const calls = [];
  const ctx = await listen({
    COMPASS_DEMO_MODE: 'live',
    ANTHROPIC_API_KEY: anthropicKey,
    GENERALCOMPUTE_API_KEY: 'gc-test-key',
    NEBIUS_API_KEY: 'nebius-test-key',
  }, async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body), key: opts.headers['x-api-key'] || '' });
    if (String(url).includes('anthropic.com')) return new Response('down', { status: 503 });
    return new Response('down', { status: 503 });
  });
  try {
    const loaded = loadLlm({ ANTHROPIC_API_KEY: anthropicKey, ANTHROPIC_TIMEOUT_MS: '999999', GENERALCOMPUTE_API_KEY: 'gc' });
    assert.equal(loaded.provider, 'anthropic');
    assert.equal(loaded.model, 'claude-haiku-5-5');
    assert.equal(loaded.clients[0].timeoutMs, 12000);
    assert.deepEqual(loaded.clients.map(item => item.provider), ['anthropic', 'generalcompute']);
    const out = await turn(ctx.origin, LINES[0]);
    assert.equal(out.status, 200);
    assert.equal(out.body.source, 'prepared');
    assert.match(out.body.html, /AI Company/);
    assert.match(calls[0].url, /api\.anthropic\.com/);
    assert.equal(calls[0].body.model, 'claude-haiku-5-5');
    assert.equal(calls[0].key, anthropicKey);
    assert.equal(JSON.stringify(calls[0].body).includes(anthropicKey), false);
    assert.equal(JSON.stringify(out.body).includes(anthropicKey), false);
  } finally {
    await ctx.app.close();
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test('a stub anthropic reply is used for the page and the prompt is not logged', async () => {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  const spec = JSON.stringify({
    set: { kind: 'bakery', theme: 'light', tone: 'warm', hero: 'centered', font: 'serif' },
    add_sections: ['features', 'contact'],
    remove_sections: [],
    unset: [],
    tool: 'write_copy',
    reply: 'Building a warm page for the bakery.',
  });
  const copy = JSON.stringify({
    hero: { headline: 'Bread, still warm', subhead: 'A page for a neighborhood bakery.', cta: 'Come by' },
    features: [
      { title: 'Morning loaves', text: 'The counter opens with what was baked today.' },
      { title: 'A short wait', text: 'The brief stays while the words are written.' },
      { title: 'Preview only', text: 'Nothing from this page is published.' },
    ],
    contact: { line: 'Write when you want a loaf.' },
    footer: 'Preview',
  });
  const darker = JSON.stringify({
    set: { theme: 'dark' },
    add_sections: [],
    remove_sections: [],
    unset: [],
    tool: null,
    reply: 'Theme updated to dark.',
  });
  let calls = 0;
  const ctx = await listen({ COMPASS_DEMO_MODE: 'live', ANTHROPIC_API_KEY: anthropicKey }, async () => {
    calls += 1;
    if (calls === 1) return anthropicMessage(spec);
    if (calls === 2) return anthropicMessage(copy);
    return anthropicMessage(darker);
  });
  try {
    const out = await turn(ctx.origin, 'Build me a website for a bakery');
    assert.equal(out.body.source, 'model');
    assert.equal(out.body.intent.kind, 'bakery');
    assert.match(out.body.html, /Bread, still warm/);
    assert.doesNotMatch(out.body.html, /\$\d/);
    assert.equal(calls >= 2, true);
    assert.equal(logs.join('\n').includes('bakery'), false);
    assert.equal(logs.join('\n').includes(anthropicKey), false);
    const revision = await turn(ctx.origin, 'Make it darker.', out.body.sessionId);
    assert.equal(revision.body.source, 'model');
    assert.equal(revision.body.placeholder, false);
    assert.equal(revision.body.intent.theme, 'dark');
    assert.match(revision.body.html, /data-theme="dark"/);
    assert.match(revision.body.html, /Bread, still warm/);
  } finally {
    console.error = original;
    await ctx.app.close();
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test('site turns are rate limited and length limited without an error page', async () => {
  const ctx = await listen({ DEMO_RATE_LIMIT: '1' }, async () => { throw new Error('should not call'); });
  try {
    const first = await turn(ctx.origin, LINES[0], undefined, { 'x-forwarded-for': '203.0.113.40' });
    assert.equal(first.status, 200);
    const limited = await turn(ctx.origin, LINES[1], first.body.sessionId, { 'x-forwarded-for': '203.0.113.40' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    assert.match(limited.body.fallback.html, /Pricing/);
    const stream = await fetch(ctx.origin + '/api/site/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-forwarded-for': '203.0.113.41' },
      body: JSON.stringify({ text: LINES[0] }),
    });
    assert.equal(stream.status, 200);
    const text = await stream.text();
    assert.match(text, /event: tool_call/);
    assert.match(text, /event: render/);
    assert.match(text, /event: result/);
    const tooLong = await turn(ctx.origin, 'x'.repeat(501), undefined, { 'x-forwarded-for': '203.0.113.42' });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error, 'text_too_long');
    assert.equal(tooLong.body.limit, 500);
  } finally {
    await ctx.app.close();
    await rm(ctx.root, { recursive: true, force: true });
  }
});
