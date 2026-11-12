import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCompassServer } from '../server.mjs';
import { normalizeEmail } from '../early-access.mjs';

const banned = /TODO|not connected|not on this page yet|coming soon|lorem ipsum|\bconcept\b|FIXME|TBD/i;

async function listen(env, fetchImpl, files) {
  const root = await mkdtemp(join(tmpdir(), 'compass-access-'));
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, name), body);
  const app = createCompassServer({ env: { STATIC_ROOT: root, COMPASS_REVISION: 'access-test', ...env }, fetchImpl });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, root, origin: 'http://127.0.0.1:' + app.server.address().port };
}

async function close(ctx) {
  await ctx.app.close();
  await rm(ctx.root, { recursive: true, force: true });
}

function post(origin, body, headers = {}) {
  return fetch(origin + '/api/early-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('email normalization rejects invalid and overlong addresses', () => {
  assert.equal(normalizeEmail('ada@example.com'), 'ada@example.com');
  assert.equal(normalizeEmail('  ada@example.com  '), 'ada@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('a@b'), null);
  assert.equal(normalizeEmail('ada@exam\nple.com'), null);
  assert.equal(normalizeEmail('a'.repeat(201) + '@example.com'), null);
  assert.equal(normalizeEmail('ada@' + 'b'.repeat(190) + '.com'), null);
});

test('early access validates, rate limits, ignores the honeypot, and falls back to mailto', async () => {
  const calls = [];
  const ctx = await listen({
    DEMO_RATE_LIMIT: '2',
    WAITLIST_WEBHOOK_URL: 'http://hooks.example.com/insecure',
  }, async (url, opts) => {
    calls.push({ url: String(url), body: opts.body });
    return new Response('no', { status: 200 });
  }, { 'index.html': '<h1>index</h1>', 'demo.html': '<h1>demo</h1>' });
  try {
    const invalid = await post(ctx.origin, { email: 'not-an-email' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { ok: false, stored: false, error: 'invalid_email' });

    const tooLong = await post(ctx.origin, { email: 'a'.repeat(64) + '@' + 'b'.repeat(140) + '.com' }, { 'x-forwarded-for': '203.0.113.21' });
    assert.equal(tooLong.status, 400);

    const honey = await post(ctx.origin, { email: 'ada@example.com', hp: 'filled by a bot' }, { 'x-forwarded-for': '203.0.113.22' });
    assert.equal(honey.status, 200);
    assert.deepEqual(await honey.json(), { ok: true, stored: false });

    const open = await post(ctx.origin, { email: 'ada@example.com' }, { 'x-forwarded-for': '203.0.113.23' });
    assert.equal(open.status, 200);
    const mailto = await open.json();
    assert.equal(mailto.ok, true);
    assert.equal(mailto.stored, false);
    assert.equal(mailto.delivery, 'mailto');
    assert.match(mailto.mailto, /^mailto:info@aimedia\.global\?subject=COMPASS%20early%20access&body=/);
    assert.match(decodeURIComponent(mailto.mailto), /Email: ada@example.com/);
    assert.equal(JSON.stringify(mailto).includes('http://hooks.example.com'), false);

    const again = await post(ctx.origin, { email: 'ada@example.com' }, { 'x-forwarded-for': '203.0.113.23' });
    assert.equal(again.status, 200);
    const limited = await post(ctx.origin, { email: 'ada@example.com' }, { 'x-forwarded-for': '203.0.113.23' });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);

    const method = await fetch(ctx.origin + '/api/early-access');
    assert.equal(method.status, 405);
    assert.equal(calls.length, 0);
  } finally {
    await close(ctx);
  }
});

test('a configured https webhook receives the email and timestamp, and a failure does not claim storage', async () => {
  const calls = [];
  const ctx = await listen({
    WAITLIST_WEBHOOK_URL: 'https://hooks.example.com/waitlist',
  }, async (url, opts) => {
    const payload = JSON.parse(opts.body);
    calls.push({ url: String(url), method: opts.method, payload, redirect: opts.redirect });
    if (payload.email.endsWith('@fail.example')) return new Response('no', { status: 500 });
    return new Response(null, { status: 204 });
  }, { 'index.html': '<h1>index</h1>', 'demo.html': '<h1>demo</h1>' });
  try {
    const ok = await post(ctx.origin, { email: 'ada@example.com', hp: '   ' }, { 'x-forwarded-for': '203.0.113.30' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, stored: true, delivery: 'webhook' });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://hooks.example.com/waitlist');
    assert.equal(calls[0].redirect, 'error');
    assert.equal(calls[0].payload.email, 'ada@example.com');
    assert.match(calls[0].payload.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.deepEqual(Object.keys(calls[0].payload).sort(), ['email', 'timestamp']);

    const failed = await post(ctx.origin, { email: 'ada@fail.example' }, { 'x-forwarded-for': '203.0.113.31' });
    assert.equal(failed.status, 502);
    const body = await failed.json();
    assert.equal(body.stored, false);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'delivery_failed');
    assert.equal(body.delivery, 'mailto');
    assert.match(body.mailto, /^mailto:info@aimedia\.global\?/);
  } finally {
    await close(ctx);
  }
});

test('homepage plays the bundled walkthrough unless DEMO_VIDEO_URL overrides it', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const demo = await readFile(new URL('../demo.html', import.meta.url), 'utf8');
  const plain = await listen({}, async () => new Response(''), { 'index.html': index, 'demo.html': demo });
  try {
    const home = await (await fetch(plain.origin + '/')).text();
    const demoHtml = await (await fetch(plain.origin + '/demo')).text();
    assert.equal((await fetch(plain.origin + '/')).status, 200);
    assert.equal((await fetch(plain.origin + '/demo')).status, 200);
    assert.match(home, /id="hero-secondary" href="#access">Request access/);
    assert.match(home, /href="#watch">Watch the demo/);
    assert.match(home, /id="watch-player"/);
    assert.match(home, /<video[^>]*\bmuted\b[^>]*preload="none"/);
    assert.match(home, /playsinline/);
    assert.match(home, /poster="\/assets\/demo\/compass-walkthrough\.jpg"/);
    assert.match(home, /<source src="\/assets\/demo\/compass-walkthrough\.mp4" type="video\/mp4">/);
    assert.match(home, /<track kind="captions" src="\/assets\/demo\/compass-walkthrough\.vtt"/);
    assert.match(home, /id="watch-note"/);
    assert.match(home, /aria-describedby="watch-note"/);
    assert.doesNotMatch(home, /id="compass-video"|Watch the video|not on this page yet/);
    assert.doesNotMatch(home + demoHtml, banned);
    assert.match(home, /AX Media Global builds software for business clients/);
    assert.match(home, /aimedia\.global/);
    assert.match(home, /jarrarcpa\.pro/);
    const health = await (await fetch(plain.origin + '/healthz')).json();
    assert.equal(health.ok, true);
    assert.equal((await (await fetch(plain.origin + '/api/config')).json()).demoVideoUrl, null);
  } finally {
    await close(plain);
  }

  const film = await listen({ DEMO_VIDEO_URL: 'https://cdn.example.com/compass.mp4' }, async () => new Response(''), { 'index.html': index, 'demo.html': demo });
  try {
    const home = await (await fetch(film.origin + '/')).text();
    assert.match(home, /id="hero-secondary" href="#access">Request access/);
    assert.match(home, /href="#watch">Watch the demo/);
    assert.match(home, /id="watch"/);
    assert.match(home, /<video[^>]*poster="\/assets\/hero\/compass-hero\.jpg"/);
    assert.match(home, /src="https:\/\/cdn\.example\.com\/compass\.mp4"/);
    assert.match(home, /title="COMPASS demo video"/);
    assert.doesNotMatch(home, /compass-walkthrough\.mp4|not on this page yet|See how it works/);
    assert.doesNotMatch(home, banned);
    assert.equal((await (await fetch(film.origin + '/api/config')).json()).demoVideoUrl, 'https://cdn.example.com/compass.mp4');
  } finally {
    await close(film);
  }

  const youtube = await listen({ DEMO_VIDEO_URL: 'https://youtu.be/abc123XYZ_-' }, async () => new Response(''), { 'index.html': index, 'demo.html': demo });
  try {
    const home = await (await fetch(youtube.origin + '/')).text();
    assert.match(home, /Watch the demo/);
    assert.match(home, /class="poster"/);
    assert.match(home, /poster" src="\/assets\/hero\/compass-hero\.jpg"/);
    assert.match(home, /data-embed="https:\/\/www\.youtube-nocookie\.com\/embed\/abc123XYZ_-"/);
    assert.doesNotMatch(home, /compass-walkthrough\.mp4|<video/);
    assert.doesNotMatch(home, banned);
    const insecure = await listen({ DEMO_VIDEO_URL: 'http://cdn.example.com/compass.mp4' }, async () => new Response(''), { 'index.html': index, 'demo.html': demo });
    try {
      const hidden = await (await fetch(insecure.origin + '/')).text();
      assert.match(hidden, /id="hero-secondary" href="#access">Request access/);
      assert.match(hidden, /href="#watch">Watch the demo/);
      assert.match(hidden, /src="\/assets\/demo\/compass-walkthrough\.mp4"/);
      assert.doesNotMatch(hidden, /http:\/\/cdn\.example\.com|Watch the video/);
    } finally {
      await close(insecure);
    }
  } finally {
    await close(youtube);
  }
});
