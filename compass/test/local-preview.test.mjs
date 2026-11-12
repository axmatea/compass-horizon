import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, preview } from 'vite';
import { parseSse } from '../src/site/studio.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = join(root, 'vite.config.ts');

async function verifyApplication(origin) {
  const health = await (await fetch(origin + '/healthz')).json();
  assert.equal(health.ok, true);
  assert.equal(health.llmConfigured, false);
  const home = await (await fetch(origin + '/')).text();
  assert.match(home, /id="hero-secondary">Request access/);
  assert.match(home, /href="#watch">Watch the demo/);
  assert.match(home, /id="watch-player"/);
  assert.match(home, /src="\/assets\/demo\/compass-walkthrough\.mp4"/);
  assert.doesNotMatch(home, /id="compass-video"/);
  for (const path of ['/', '/demo?source=local', '/voice-demo/', '/plan?source=local', '/studio?source=local', '/studio/']) {
    const page = await fetch(origin + path);
    assert.equal(page.status, 200, path);
    const html = await page.text();
    assert.match(html, path === '/' ? /id="intent"/ : path.startsWith('/plan') ? /id="intent-form"/ : path.startsWith('/studio') ? /<h1\b/ : /id="sd-input"/);
    // Check the actual entry's built or development scripts and styles, so a
    // successful HTML route cannot conceal a missing fourth build entry.
    for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
      if (!tag.startsWith('<script') && !/rel="stylesheet"/.test(tag)) continue;
      const asset = /(?:src|href)="(\/[^"]+)"/.exec(tag)?.[1];
      if (asset) assert.equal((await fetch(origin + asset)).status, 200, path + ': ' + asset);
    }
  }
  assert.equal((await fetch(origin + '/studio/legacy')).status, 410);
  assert.equal((await fetch(origin + '/api/not-a-route')).status, 404);

  const turn = await fetch(origin + '/api/site/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ text: 'A website for my bakery, warm and friendly' }),
  });
  assert.equal(turn.status, 200);
  assert.match(turn.headers.get('content-type'), /text\/event-stream/);
  const frames = parseSse(await turn.text()).frames;
  const first = frames.find(frame => frame.event === 'result')?.data;
  assert.equal(first?.source, 'prepared');
  assert.match(first?.html || '', /<!doctype html>/);
  assert.ok(frames.some(frame => frame.event === 'render'));
  const revision = await fetch(origin + '/api/site/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: first.sessionId, text: 'Make it darker and add a pricing section' }),
  });
  const next = await revision.json();
  assert.equal(next.sessionId, first.sessionId);
  assert.equal(next.intent.theme, 'dark');
  assert.ok(next.intent.sections.includes('pricing'));
  assert.ok(next.version > first.version);
  const rendered = await fetch(origin + '/api/site/session/' + next.sessionId + '/page');
  assert.equal(rendered.status, 200);
  assert.match(rendered.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  // Turn previews highlight newly changed sections; the standalone page keeps
  // the same content without those transient highlights.
  assert.equal(await rendered.text(), next.html.replace(/ data-new/g, ''));

  const access = await fetch(origin + '/api/early-access', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'local-preview@example.com' }),
  });
  const delivery = await access.json();
  assert.equal(delivery.stored, false);
  assert.equal(delivery.delivery, 'mailto');
}

test('Vite dev and preview serve the prepared builder and its session page', async t => {
  const output = await mkdtemp(join(tmpdir(), 'compass-vite-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const previous = Object.fromEntries(['ANTHROPIC_API_KEY', 'WAITLIST_WEBHOOK_URL', 'DEMO_VIDEO_URL'].map(key => [key, process.env[key]]));
  // Even inherited credentials must not turn a local preview into a live call.
  process.env.ANTHROPIC_API_KEY = 'unused-local-test-key';
  process.env.WAITLIST_WEBHOOK_URL = 'https://disabled.invalid/waitlist';
  delete process.env.DEMO_VIDEO_URL;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  await t.test('development', async () => {
    const dev = await createServer({ configFile, root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
    try {
      await dev.listen();
      await verifyApplication('http://127.0.0.1:' + dev.httpServer.address().port);
    } finally { await dev.close(); }
  });
  await build({ configFile, root, logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
  await t.test('built preview', async () => {
    const built = await preview({ configFile, root, logLevel: 'silent', build: { outDir: output }, preview: { host: '127.0.0.1', port: 0 } });
    try { await verifyApplication('http://127.0.0.1:' + built.httpServer.address().port); }
    finally { await new Promise((resolve, reject) => built.httpServer.close(error => error ? reject(error) : resolve())); }
  });
});
