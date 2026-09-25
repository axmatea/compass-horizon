// Offline tests for the website domain: brief patching, renderer safety, incremental copy,
// runtime flow (build -> design change -> add section -> interruption), HTTP routes, voice WS domain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createState, applyUpdate, normalizeSections } from '../server/state/site.mjs';
import { renderSite } from '../server/site/render.mjs';
import { createSiteCopyTool, copyPlan } from '../server/tools/site-copy.mjs';
import { createToolRegistry } from '../server/tools/registry.mjs';
import { createAgentRuntime } from '../server/agent/runtime.mjs';
import { siteDomain, guardSiteAck, describeSiteChanges } from '../server/domains/site.mjs';
import { validateSiteInterpretation } from '../server/agent/site-interpreter.mjs';
import { createCompassBackend } from '../server/app.mjs';
import { attachVoiceServer } from '../server/voice/ws-server.mjs';
import { scriptedInterpreter, sleep } from './helpers.mjs';

const B1 = 'Build me a landing page for Northwind Coffee, a small coffee roastery in Palo Alto. Warm and premium.';
const B2 = 'Make it darker, change the hero and add a product section.';
const B3 = 'Actually it is a tea house, not a coffee roastery.';
const B4 = 'Switch the accent to green.';
const SCRIPT = {
  [B1]: { set: { business: 'Northwind Coffee', kind: 'coffee roastery', audience: 'people in Palo Alto', tone: 'warm and premium', theme: 'light', accent: 'gold', font: 'serif', hero: 'centered', sections: ['features', 'signup'] }, tool: 'write_copy', reply: 'Building a warm landing page for Northwind Coffee.' },
  [B2]: { set: { theme: 'dark', hero: 'split' }, add_sections: ['products'], tool: 'write_copy', reply: 'Going dark, switching the hero, adding products.' },
  [B3]: { set: { kind: 'tea house' }, tool: 'write_copy', reply: 'A tea house it is.' },
  [B4]: { set: { accent: 'emerald' }, tool: null, reply: 'Green accent.' },
  'Your site is live now': { set: {}, tool: null, reply: 'Your site is live at northwind.com now.' },
};

/** Fake GLM for write_copy: returns JSON for exactly the requested sections after delayMs. */
function fakeCopyLlm({ delayMs = 30 } = {}) {
  const calls = [];
  return {
    calls,
    async chat({ messages, signal }) {
      const req = JSON.parse(messages[1].content);
      calls.push(req);
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { code: 'aborted' })); });
      });
      const k = req.brief.kind;
      const out = { footer: `© ${req.brief.business || k}` };
      for (const s of req.sections) {
        if (s === 'hero') out.hero = { headline: `${k} headline`, subhead: `${k} subhead`, cta: 'Visit' };
        if (s === 'features') out.features = [1, 2, 3].map((i) => ({ title: `${k} feature ${i}`, text: 'text' }));
        if (s === 'products') out.products = [1, 2, 3].map((i) => ({ name: `${k} product ${i}`, price: '$12', text: 'text' }));
        if (s === 'signup') out.signup = { headline: `Join ${k}`, text: 'text', cta: 'Join' };
      }
      return { message: { content: JSON.stringify(out) }, latencyMs: delayMs };
    },
  };
}

function makeSiteRuntime({ delayMs = 30, interpreter = scriptedInterpreter(SCRIPT) } = {}) {
  const llm = fakeCopyLlm({ delayMs });
  const tools = createToolRegistry([createSiteCopyTool({ llm })]);
  return { runtime: createAgentRuntime({ interpreter, tools, domain: siteDomain }), llm, tools, interpreter };
}

test('brief: a new site gets design defaults; later turns change only what was said', () => {
  const s0 = createState('s');
  const u1 = applyUpdate(s0, { set: { business: 'Northwind Coffee', kind: 'Coffee Roastery', theme: 'darker' } }, { lang: 'en' });
  assert.equal(u1.state.intent.theme, 'dark');
  assert.equal(u1.state.intent.kind, 'coffee roastery');
  assert.deepEqual(u1.state.intent.sections, ['features', 'signup']);
  assert.equal(u1.state.intent.accent, 'gold');
  assert.equal(u1.state.version, 1);
  const u2 = applyUpdate(u1.state, { set: { accent: 'green' }, add_sections: ['products', 'shop', 'unknownthing'] });
  assert.deepEqual(u2.changed.sort(), ['accent', 'sections']);
  assert.equal(u2.state.intent.accent, 'emerald');
  assert.deepEqual(u2.state.intent.sections, ['features', 'signup', 'products']);
  assert.ok(u2.rejected.some((r) => r.reason === 'unknown_section'));
  const sec = u2.patch.find((p) => p.field === 'sections');
  assert.deepEqual(sec.added, ['products']);
  assert.equal(u2.patch.find((p) => p.field === 'business').status, 'kept');
  const u3 = applyUpdate(u2.state, { remove_sections: ['signup'] });
  assert.deepEqual(u3.patch.find((p) => p.field === 'sections').removed, ['signup']);
  const noop = applyUpdate(u3.state, { set: { theme: 'dark' } });
  assert.equal(noop.state.version, u3.state.version);
  assert.deepEqual(normalizeSections('features, a photo gallery and pricing'), ['features', 'gallery', 'pricing']);
});

test('interpretation validation keeps only known fields and section ops', () => {
  const v = validateSiteInterpretation({ set: { theme: 'dark', bogus: 1 }, add_sections: ['products', 7], remove_sections: 'faq', unset: ['cta', 'nope'], tool: 'write_copy', reply: ' ok ' });
  assert.deepEqual(v, { set: { theme: 'dark' }, unset: ['cta'], add_sections: ['products'], remove_sections: [], tool: 'write_copy', reply: 'ok' });
});

test('renderer: no scripts, everything escaped, skeletons for pending sections, highlight marks', () => {
  const spec = { business: 'Evil <img src=x onerror=alert(1)>', kind: 'shop', theme: 'dark', accent: 'violet', font: 'display', hero: 'poster', sections: ['features', 'products', 'gallery', 'testimonials', 'pricing', 'faq', 'contact', 'signup'], lang: 'en', headline: null, subhead: null, cta: '"Go"' };
  const html = renderSite({ spec, copy: null, pending: ['hero', 'products'], highlight: ['products'], version: 3 });
  assert.ok(!/<script/i.test(html));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&quot;Go&quot;'));
  assert.ok(html.includes('data-theme="dark"'));
  assert.ok(html.includes('data-version="3"'));
  assert.ok(html.includes('<section data-new id="products"'));
  assert.ok(html.includes('class="sk"'), 'skeleton bars present');
  for (const id of spec.sections) assert.ok(html.includes(`id="${id}"`), id);
  const ru = renderSite({ spec: { ...spec, lang: 'ru' }, copy: { hero: { headline: 'Привет', subhead: 'x', cta: 'Войти' } }, version: 1 });
  assert.ok(ru.includes('Преимущества') && ru.includes('Привет'));
});

test('copyPlan: unchanged brief reuses written sections; changed brief rewrites all; hero layout rewrites hero', () => {
  const args = { business: 'N', kind: 'coffee', audience: null, tone: 'warm', lang: 'en', hero: 'centered', headline: null, subhead: null, cta: null, sections: ['features', 'signup'] };
  const prev = { args, result: { hero: {}, features: [], signup: {} } };
  assert.deepEqual(copyPlan({ ...args, sections: ['features', 'signup', 'products'] }, prev), { write: ['products'], reuse: ['hero', 'features', 'signup'] });
  assert.deepEqual(copyPlan({ ...args, kind: 'tea' }, prev).reuse, []);
  assert.deepEqual(copyPlan({ ...args, hero: 'split' }, prev), { write: ['hero'], reuse: ['features', 'signup'] });
  assert.deepEqual(copyPlan({ ...args, cta: 'Reserve a bag' }, prev), { write: [], reuse: ['hero', 'features', 'signup'] }, 'dictated words never trigger a rewrite');
  assert.deepEqual(copyPlan(args, null).write, ['hero', 'features', 'signup']);
});

test('write_copy falls back to labelled placeholders when the model is unavailable', async () => {
  const tool = createSiteCopyTool({ llm: null });
  const r = await tool.run({ business: null, kind: 'bakery', sections: ['features'], lang: 'en' }, {});
  assert.equal(r.fallback, true);
  assert.ok(r.hero.headline && r.features.length === 3);
  assert.match(tool.summarize(r, {}, 'en'), /placeholders/);
});

test('flow: build -> design-only change keeps the words -> added section writes only the new one', async () => {
  const { runtime, llm } = makeSiteRuntime();
  const s = runtime.createSession();
  const seen = [];
  runtime.subscribe(s.id, (e) => seen.push(e));

  const r1 = await runtime.runTurn(s.id, B1);
  assert.equal(r1.state.version, 1);
  assert.equal(r1.state.intent.lang, 'en');
  assert.equal(r1.toolResult.tool, 'write_copy');
  assert.deepEqual(r1.toolResult.result.wrote, ['hero', 'features', 'signup']);
  assert.match(r1.reply, /^Words are in for the hero, features and the signup\.$/);
  const renders1 = seen.filter((e) => e.type === 'render');
  assert.equal(renders1.length, 2, 'skeleton render then final render');
  assert.deepEqual(renders1[0].pending, ['hero', 'features', 'signup']);
  assert.deepEqual(renders1[1].pending, []);
  assert.ok(renders1[1].html.includes('coffee roastery headline'));
  assert.ok(renders1[0].html.includes('class="sk"') && !renders1[1].html.includes('class="sk"'));
  const say1 = seen.filter((e) => e.type === 'say');
  assert.equal(say1[0].text, 'Building a warm landing page for Northwind Coffee.');
  assert.equal(say1[0].final, false);

  seen.length = 0;
  const r4 = await runtime.runTurn(s.id, B4);
  assert.equal(r4.state.intent.accent, 'emerald');
  assert.equal(r4.state.actions.length, 1, 'no copy re-run for an accent change');
  assert.equal(llm.calls.length, 1);
  const render4 = seen.find((e) => e.type === 'render');
  assert.ok(render4 && render4.html.includes('coffee roastery headline') && render4.pending.length === 0);
  assert.equal(seen.find((e) => e.type === 'say').text, 'Green accent.');
  assert.equal(seen.find((e) => e.type === 'say').final, true);

  seen.length = 0;
  const r2 = await runtime.runTurn(s.id, B2);
  assert.equal(r2.state.intent.theme, 'dark');
  assert.equal(r2.state.intent.hero, 'split');
  assert.deepEqual(r2.state.intent.sections, ['features', 'signup', 'products']);
  assert.equal(llm.calls.length, 2);
  assert.deepEqual(llm.calls[1].sections, ['hero', 'products'], 'hero (new layout) and products only');
  assert.deepEqual(r2.toolResult.result.reused, ['features', 'signup']);
  const renders2 = seen.filter((e) => e.type === 'render');
  assert.deepEqual(renders2[0].pending, ['hero', 'products']);
  assert.ok(renders2[0].html.includes('coffee roastery feature 1'), 'kept features shown while products are written');
  assert.ok(renders2[0].html.includes('data-theme="dark"'));
  assert.ok(renders2.at(-1).html.includes('coffee roastery product 1'));
  assert.ok(renders2.at(-1).highlight.includes('products') && renders2.at(-1).highlight.includes('hero'));
  assert.match(r2.reply, /Switched to a dark theme\. New hero layout\. Added products\. Words are in for the hero and products\./);
  // the old copy action was invalidated (sections changed) and replaced, never re-spoken
  assert.equal(r2.state.actions.filter((a) => a.status === 'invalidated').length, 1);
  assert.ok(seen.some((e) => e.type === 'action_invalidated'));
});

test('interruption: changing the business mid-write cancels the stale copy and rewrites everything', async () => {
  const { runtime, llm } = makeSiteRuntime({ delayMs: 250 });
  const s = runtime.createSession();
  const t1 = runtime.runTurn(s.id, B1);
  await sleep(40);
  const t3 = runtime.runTurn(s.id, B3);
  const [r1, r3] = await Promise.all([t1, t3]);
  assert.equal(r1.superseded, true);
  assert.equal(r1.reply, null);
  assert.equal(r3.state.intent.kind, 'tea house');
  assert.equal(r3.state.intent.business, 'Northwind Coffee', 'unrelated fields kept');
  assert.equal(llm.calls.length, 2);
  assert.deepEqual(llm.calls[1].sections, ['hero', 'features', 'signup'], 'brief changed: rewrite all');
  assert.equal(r3.toolResult.result.hero.headline, 'tea house headline');
  const [a1, a2] = r3.state.actions;
  assert.equal(a1.status, 'invalidated');
  assert.equal(a2.status, 'done');
});

test('truthful acks: publishing claims are replaced, spoken changes are described', async () => {
  assert.match(guardSiteAck('Your site is live at northwind.com now.', {}, 'en'), /Nothing is published/);
  assert.equal(guardSiteAck('Going dark and adding products.', {}, 'en'), null);
  assert.match(guardSiteAck('Сайт опубликован!', {}, 'ru'), /не опубликовано/);
  const { runtime } = makeSiteRuntime();
  const s = runtime.createSession();
  await runtime.runTurn(s.id, B1);
  const r = await runtime.runTurn(s.id, 'Your site is live now');
  assert.equal(r.reply, "It's rendered in the preview. Nothing is published.");
  const patch = [{ field: 'theme', from: 'light', to: 'dark', status: 'active', change: 'updated' }, { field: 'sections', from: ['features'], to: ['features', 'faq'], status: 'active', change: 'updated', added: ['faq'], removed: [] }];
  assert.equal(describeSiteChanges(patch, 'en'), 'Switched to a dark theme. Added an FAQ.');
  assert.equal(describeSiteChanges(patch, 'ru'), 'Тема теперь тёмная. Добавлено: вопросы.');
});

test('HTTP: /api/site/turn, session events with render, /page with strict CSP; dinner routes untouched', async () => {
  const llm = fakeCopyLlm({ delayMs: 20 });
  const backend = createCompassBackend({
    env: { NEBIUS_API_KEY: 'nb-SECRET', BOSON_API_KEY: '' },
    interpreter: scriptedInterpreter({}),
    siteInterpreter: scriptedInterpreter(SCRIPT),
    siteTools: createToolRegistry([createSiteCopyTool({ llm })]),
    logger: { error() {} },
  });
  const server = createServer((req, res) => backend.handleApi(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.site.implemented, true);
    assert.equal(health.site.publishes, false);
    assert.ok(!JSON.stringify(health).includes('SECRET'));

    const { sessionId } = await (await post('/api/site/session', {})).json();
    const r1 = await (await post('/api/site/turn', { sessionId, text: B1 })).json();
    assert.equal(r1.sessionId, sessionId);
    assert.ok(typeof r1.page === 'string' && r1.page.includes('coffee roastery headline'));
    assert.equal(r1.state.intent.business, 'Northwind Coffee');

    const page = await fetch(`${base}/api/site/session/${sessionId}/page`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.ok((await page.text()).includes('Northwind Coffee'));

    // SSE turn streams render events
    const res = await post('/api/site/turn', { sessionId, text: B4 }, { Accept: 'text/event-stream' });
    const text = await res.text();
    assert.ok(text.includes('event: render'));
    assert.ok(text.includes('event: result'));

    // events stream resumes with the current page
    const ctrl = new AbortController();
    const ev = await fetch(`${base}/api/site/session/${sessionId}/events`, { signal: ctrl.signal });
    const reader = ev.body.getReader();
    let buf = '';
    while (!buf.includes('event: render')) { const { value, done } = await reader.read(); if (done) break; buf += new TextDecoder().decode(value); }
    ctrl.abort();
    assert.ok(buf.includes('event: state') && buf.includes('event: render'));

    assert.equal((await fetch(`${base}/api/site/session/nope/page`)).status, 404);
    assert.equal((await fetch(`${base}/api/site/whatever`)).status, 404);
    assert.equal((await fetch(`${base}/api/session/${sessionId}`)).status, 404, 'dinner runtime does not know site sessions');
    assert.equal((await post('/api/session', {})).status, 201);
  } finally { server.close(); }
});

test('voice WS: ?domain=site routes the bridge to the website runtime', async () => {
  const { runtime: siteRuntime } = makeSiteRuntime();
  const { runtime: dinnerRuntime } = makeSiteRuntime();
  const http = createServer();
  const up = { send() {}, close() {}, on() { return up; } };
  attachVoiceServer(http, { runtime: dinnerRuntime, runtimes: { dinner: dinnerRuntime, site: siteRuntime }, config: { boson: { apiKey: 'x', voice: 'nora', turnDetection: 'semantic_vad' } }, connectUpstream: async () => up, logger: { error() {} } });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${http.address().port}/api/voice/realtime?domain=site`);
  await new Promise((r) => ws.on('open', r));
  await sleep(50);
  assert.equal(siteRuntime._sessions.size, 1, 'session created in the site runtime');
  assert.equal(dinnerRuntime._sessions.size, 0);
  ws.close(); http.close();
});
