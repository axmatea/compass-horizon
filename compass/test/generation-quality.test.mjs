import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteBuilder, validateResumeIntent } from '../builder/index.mjs';
import { createState, normalizeFont } from '../builder/spec.mjs';
import { interpretSite } from '../builder/interpret.mjs';
import { createSiteCopyTool, preparedCopy } from '../builder/copy.mjs';
import { renderSite } from '../builder/render.mjs';
import { safeSavedHtml } from '../src/builder/project-store.mjs';
import { loadLlm } from '../llm.mjs';

const offline = () => createSiteBuilder({ env: {}, fetchImpl: async () => { throw new Error('no provider should be called'); } }).runtime;
const body = html => html.slice(html.indexOf('<body>'));
function anchorsExist(html) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]), `missing destination ${match[1]}`);
}

test('real-estate prompts produce a property composition and real in-page destinations', async () => {
  const runtime = offline();
  const result = await runtime.runTurn(undefined, 'Build a premium real estate website called Northline.');
  assert.equal(result.intent.kind, 'real estate');
  assert.equal(result.intent.business, 'Northline');
  assert.equal(result.intent.font, 'serif');
  assert.equal(result.intent.hero, 'split');
  assert.deepEqual(result.intent.sections, ['products', 'features', 'contact']);
  assert.equal(result.source, 'prepared');
  const html = result.page.html;
  assert.match(body(html), /href="#products"/);
  assert.match(body(html), /Listing placeholder/);
  assert.match(body(html), /Property 01/);
  assert.doesNotMatch(body(html), /hello@example|href="#signup"|Built in this session|Most popular|[$£€]\s?\d/);
  assert.equal(safeSavedHtml(html), html, 'new compositions remain saveable as inert documents');
  anchorsExist(html);
});

test('booking pages expose useful form fields and never pretend to send or reserve', async () => {
  const result = await offline().runTurn(undefined, 'Create a modern booking page for a barbershop called Northline.');
  assert.match(result.intent.kind, /barbershop.*booking/);
  assert.equal(result.intent.business, 'Northline');
  assert.deepEqual(result.intent.sections, ['features', 'contact']);
  const html = body(result.page.html);
  assert.match(html, /href="#contact"/);
  assert.match(html, /<label>Preferred date<input name="date" type="date">/);
  assert.match(html, /<label>Preferred time<select name="time">/);
  assert.match(html, /<label>Service<select/);
  assert.match(html, /<button type="button" class="btn" disabled>Request a time/);
  assert.match(html, /Form preview · nothing is sent/);
  assert.doesNotMatch(html, /<form\b|\baction=|Booking confirmed|Appointment confirmed|<script/);
  anchorsExist(result.page.html);
});

test('minimal, mobile and typography refinements change the rendered design while retaining the brief', async () => {
  const runtime = offline();
  const first = await runtime.runTurn(undefined, 'A website for an architecture studio called Atelier.');
  const next = text => runtime.runTurn(first.sessionId, text);
  const minimal = await next('Make this website more minimal.');
  assert.equal(minimal.intent.business, first.intent.business);
  assert.deepEqual(minimal.intent.sections, first.intent.sections);
  assert.equal(minimal.intent.density, 'airy');
  assert.equal(minimal.intent.hero, 'centered');
  assert.match(minimal.page.html, /--gap:44px;--card-space:0px/);
  assert.match(body(minimal.page.html), /<header[^>]*class="hero centered"/);
  assert.doesNotMatch(body(minimal.page.html).split('</header>')[0], /class="media"/);
  const mobile = await next('Improve the mobile layout.');
  assert.equal(mobile.intent.mobile, 'comfortable');
  assert.equal(mobile.intent.density, 'airy');
  assert.match(mobile.page.html, /data-mobile="comfortable"/);
  assert.match(mobile.page.html, /\[data-mobile="comfortable"\] \.gallery-grid\{grid-template-columns:1fr\}/);
  assert.match(mobile.page.html, /\[data-mobile="comfortable"\] input,\[data-mobile="comfortable"\] select\{min-height:54px\}/);
  const type = await next('Change the typography.');
  assert.equal(type.intent.font, 'serif');
  assert.equal(type.intent.mobile, 'comfortable');
  assert.match(type.page.html, /h1,h2,h3\{font-family:"Iowan Old Style"/);
  assert.notEqual(type.page.html, mobile.page.html);
  const compact = await next('Make it compact.');
  assert.equal(compact.intent.density, 'compact');
  assert.match(compact.page.html, /--gap:20px;--card-space:20px/);
  assert.equal(compact.intent.business, 'Atelier');
  assert.ok(compact.version > type.version);
  assert.deepEqual(validateResumeIntent(compact.intent), compact.intent);
  anchorsExist(compact.page.html);
});

test('every possible section combination has valid anchors; contact and signup remain separate inert controls', () => {
  const all = ['features', 'products', 'gallery', 'testimonials', 'pricing', 'faq', 'contact', 'signup'];
  for (let mask = 0; mask < 256; mask += 1) {
    const sections = all.filter((_, i) => mask & (1 << i));
    const spec = { kind: 'project', font: 'sans', sections };
    const html = renderSite({ spec, copy: preparedCopy(spec, ['hero', ...sections]), version: 1 });
    anchorsExist(html);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate ids in a combined contact/signup page');
    assert.equal(safeSavedHtml(html), html);
  }
});

test('model interpretation cannot drop an explicit mobile or type refinement when it omits the field', async () => {
  const state = createState('s_existing');
  state.intent = { ...state.intent, kind: 'portfolio', business: 'Atelier', font: 'sans', theme: 'light', sections: ['gallery', 'contact'] };
  const interpreted = await interpretSite({ state, text: 'Improve the mobile layout and make the headline more concise.', env: { ANTHROPIC_API_KEY: 'sentinel' }, fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ set: { headline: 'Work, clearly.' }, tool: 'write_copy', reply: 'Layout and headline updated.' }) }] }), { status: 200, headers: { 'content-type': 'application/json' } }) });
  assert.equal(interpreted.set.mobile, 'comfortable');
  assert.equal(interpreted.set.headline, 'Work, clearly.');
  assert.equal(interpreted.source, 'model');
  assert.equal(interpreted.set.business, undefined);
  assert.equal(normalizeFont('sans-serif'), 'sans');
});

test('canonical style edits retain model copy without another provider call, while compound content edits still use the model', async () => {
  let calls = 0;
  let interpretations = 0;
  const runtime = createSiteBuilder({ env: { COMPASS_DEMO_MODE: 'live', ANTHROPIC_API_KEY: 'sentinel' }, fetchImpl: async (_url, opts) => {
    calls += 1;
    const request = JSON.parse(opts.body);
    const interpreting = String(request.system || request.messages[0].content).includes('update a website brief');
    const value = interpreting
      ? (++interpretations === 1
        ? { set: { kind: 'architecture studio', business: 'Atelier', theme: 'light', hero: 'split', font: 'sans', sections: ['features', 'contact'] }, tool: 'write_copy', reply: 'Building the studio page.' }
        : { set: { headline: 'A new point of view.' }, tool: 'write_copy', reply: 'Headline updated.' })
      : { hero: { headline: 'A considered studio.', subhead: 'Care in every detail.', cta: 'Get in touch' }, features: [{ title: 'A clear direction', text: 'Consider the whole.' }], contact: { line: 'Tell us what you have in mind.' } };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } }).runtime;
  const first = await runtime.runTurn(undefined, 'A website for an architecture studio called Atelier.');
  assert.equal(first.source, 'model');
  assert.equal(calls, 2);
  for (const text of ['Make it darker.', 'Improve the mobile layout.', 'Change the typography.']) {
    const result = await runtime.runTurn(first.sessionId, text);
    assert.equal(result.source, 'model', 'rendered words still have model provenance');
    assert.match(result.page.html, /A considered studio\./);
    assert.equal(calls, 2, 'a canonical presentation edit stays local');
  }
  const changed = await runtime.runTurn(first.sessionId, 'Make it darker and rewrite the headline.');
  assert.equal(calls, 4, 'a compound content instruction is not swallowed by the style shortcut');
  assert.equal(changed.source, 'model');
  assert.match(changed.page.html, /A new point of view\./);
  const prepared = await offline().runTurn(undefined, 'A website for a studio.');
  assert.equal(prepared.source, 'prepared');
});

test('model copy cannot manufacture testimonials or contact identities, and all output is escaped', async () => {
  const clients = loadLlm({ ANTHROPIC_API_KEY: 'sentinel' }, async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ hero: { headline: 'A studio.', subhead: 'Care in every detail.', cta: 'Explore' }, testimonials: [{ quote: 'Best product ever', who: 'Invented Client' }], contact: { line: 'Say hello', email: 'invented@example.com', place: '123 Imaginary Street' } }) }] }), { status: 200, headers: { 'content-type': 'application/json' } })).clients;
  const copy = createSiteCopyTool({ clients });
  const result = await copy.run({ kind: 'creative studio', sections: ['testimonials', 'contact'] });
  assert.deepEqual(result.testimonials, []);
  assert.equal(result.fallback, false, 'the safety checks apply to an actual model response, not only prepared copy');
  assert.equal(result.contact.email, undefined);
  assert.equal(result.contact.place, undefined);
  const html = renderSite({ spec: { kind: 'creative studio', headline: '<script>alert(1)</script>', sections: ['testimonials', 'contact'] }, copy: result });
  assert.match(body(html), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(body(html), /<script|onerror=|Invented Client|Best product ever|invented@example|123 Imaginary/);
});
