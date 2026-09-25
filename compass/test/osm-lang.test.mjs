import test from 'node:test';
import assert from 'node:assert/strict';
import { createOsmRestaurantSearch, cuisineTag } from '../server/tools/osm-restaurant-search.mjs';
import { createToolRegistry } from '../server/tools/registry.mjs';
import { createAgentRuntime } from '../server/agent/runtime.mjs';
import { detectLang, describeChanges } from '../server/i18n/lang.mjs';
import { scriptedInterpreter } from './helpers.mjs';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const PA = { lat: 37.4443, lon: -122.1598 };
const ELEMENTS = [
  { type: 'node', id: 2, lat: 37.4500, lon: -122.1600, tags: { name: 'Far Trattoria', cuisine: 'italian' } },
  { type: 'node', id: 1, lat: 37.4445, lon: -122.1600, tags: { name: 'Near Osteria', cuisine: 'italian;pizza', 'addr:housenumber': '1', 'addr:street': 'Main St', opening_hours: 'Mo-Su 17:00-22:00' } },
  { type: 'way', id: 3, center: { lat: 37.4470, lon: -122.1600 }, tags: { cuisine: 'italian' } }, // unnamed -> dropped
];

function fakeFetch({ overpassFail = 0 } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), ua: init.headers?.['User-Agent'] });
    if (String(url).includes('nominatim')) return json([{ lat: String(PA.lat), lon: String(PA.lon), display_name: 'Palo Alto' }]);
    if (overpassFail-- > 0) return json({}, 504);
    return json({ elements: ELEMENTS });
  };
  return { impl, calls };
}

test('osm tool: geocodes, queries overpass, drops unnamed, sorts by distance, never claims availability', async () => {
  const f = fakeFetch();
  const tool = createOsmRestaurantSearch({ fetchImpl: f.impl });
  const r = await tool.run({ cuisine: 'Italian', location: 'Palo Alto' });
  assert.equal(r.mock, false);
  assert.equal(r.source, 'openstreetmap');
  assert.deepEqual(r.results.map((x) => x.name), ['Near Osteria', 'Far Trattoria']);
  assert.ok(r.results.every((x) => x.availableAt === null));
  assert.equal(r.results[0].address, '1 Main St');
  assert.ok(f.calls.every((c) => c.ua && /COMPASS/.test(c.ua)), 'identifying User-Agent on every call');
  // second run: geocode cached
  await tool.run({ cuisine: 'Italian', location: 'palo alto' });
  assert.equal(f.calls.filter((c) => c.url.includes('nominatim')).length, 1);
});

test('osm tool: falls back to the second overpass endpoint', async () => {
  const f = fakeFetch({ overpassFail: 1 });
  const r = await createOsmRestaurantSearch({ fetchImpl: f.impl }).run({ cuisine: 'Italian', location: 'Palo Alto' });
  assert.equal(r.results.length, 2);
  assert.equal(f.calls.filter((c) => c.url.includes('interpreter')).length, 2);
});

test('osm tool: honors abort', async () => {
  const ac = new AbortController();
  const impl = (url, init) => new Promise((_, rej) => { if (init.signal.aborted) return rej(init.signal.reason); init.signal.addEventListener('abort', () => rej(init.signal.reason)); });
  const p = createOsmRestaurantSearch({ fetchImpl: impl }).run({ cuisine: 'Italian', location: 'Nowhere' }, { signal: ac.signal });
  ac.abort(new Error('invalidated'));
  await assert.rejects(p);
});

test('osm tool: summaries in en and ru, honest about availability', () => {
  const tool = createOsmRestaurantSearch({ fetchImpl: async () => json([]) });
  const result = { results: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] };
  const intent = { cuisine: 'Italian', location: 'Palo Alto', time: '20:00', date: 'next week' };
  assert.equal(tool.summarize(result, intent, 'en'), "Three Italian places near Palo Alto: A, B and C. I haven't checked tables yet.");
  assert.equal(tool.summarize(result, intent, 'ru'), 'Вот итальянские места рядом с Palo Alto: A, B и C. Свободные столики пока не проверены.');
  assert.match(tool.summarize({ results: [] }, intent, 'en'), /couldn't find/);
  assert.equal(cuisineTag('Steak House'), 'steak_house');
});

test('lang: detection and localized change descriptions', () => {
  assert.equal(detectLang('Перенеси на следующую неделю.'), 'ru');
  assert.equal(detectLang('Move it to next week.'), 'en');
  const patch = [{ field: 'date', from: 'next week', to: 'the week after next', status: 'active', change: 'updated' }];
  assert.equal(describeChanges(patch, 'en'), 'Moved to the week after next.');
  assert.equal(describeChanges(patch, 'ru'), 'Дата теперь: через две недели.');
});

function osmRuntime(script, fetchImpl) {
  const tools = createToolRegistry([createOsmRestaurantSearch({ fetchImpl })]);
  return createAgentRuntime({ interpreter: scriptedInterpreter(script), tools });
}

test('runtime: ru utterance with an English GLM reply is spoken in Russian; date change reuses map results', async () => {
  const f = fakeFetch();
  const rt = osmRuntime({
    'Найди итальянский ресторан в Пало-Альто на завтра.': { set: { task: 'find restaurant', cuisine: 'Italian', location: 'Palo Alto', date: 'tomorrow' }, tool: 'restaurant_search', reply: 'Looking for Italian places.' },
    'Перенеси на следующую неделю.': { set: { date: 'next week' }, reply: 'Moved to next week.' },
  }, f.impl);
  const s = rt.createSession();
  const r1 = await rt.runTurn(s.id, 'Найди итальянский ресторан в Пало-Альто на завтра.');
  assert.match(r1.reply, /^Вот итальянские места рядом с Palo Alto: Near Osteria и Far Trattoria\./);
  const acks = r1.events.filter((e) => e.type === 'say').map((e) => e.text);
  assert.ok(acks.every((x) => /[А-я]/.test(x)), `all spoken text Russian: ${acks}`);
  const r2 = await rt.runTurn(s.id, 'Перенеси на следующую неделю.');
  assert.equal(r2.reply, 'Дата теперь: следующая неделя.');
  assert.ok(r2.events.some((e) => e.type === 'reasoning_status' && e.stage === 'reusing_action') || !r2.events.some((e) => e.type === 'tool_call'), 'no new search for a date-only change');
  assert.equal(f.calls.filter((c) => c.url.includes('interpreter')).length, 1);
});

test('runtime: missing location -> asks where; tool failure -> honest spoken failure', async () => {
  const rt = osmRuntime({
    'Find an Italian restaurant.': { set: { cuisine: 'Italian' }, tool: 'restaurant_search', reply: 'Looking for Italian food.' },
    'In Palo Alto.': { set: { location: 'Palo Alto' }, tool: 'restaurant_search', reply: 'Searching Palo Alto.' },
  }, async () => json({}, 503));
  const s = rt.createSession();
  const r1 = await rt.runTurn(s.id, 'Find an Italian restaurant.');
  assert.equal(r1.reply, 'Looking for Italian food. Where should I look?');
  const r2 = await rt.runTurn(s.id, 'In Palo Alto.');
  assert.equal(r2.reply, "I couldn't reach the map service just now. Want me to try again?");
  assert.equal(r2.state.actions.at(-1).status, 'failed');
});

test('runtime: a search requested before the location is known runs once the location arrives, even if GLM omits the tool', async () => {
  const f = fakeFetch();
  const rt = osmRuntime({
    'Find an Italian restaurant.': { set: { cuisine: 'Italian' }, tool: 'restaurant_search', reply: 'Italian it is. Where should I search?' },
    'Near Palo Alto.': { set: { location: 'Palo Alto' }, tool: null, reply: 'Searching near Palo Alto.' },
  }, f.impl);
  const s = rt.createSession();
  const r1 = await rt.runTurn(s.id, 'Find an Italian restaurant.');
  assert.equal(r1.reply, 'Italian it is. Where should I search?', 'no double question');
  const r2 = await rt.runTurn(s.id, 'Near Palo Alto.');
  assert.equal(r2.state.actions.length, 1);
  assert.equal(r2.state.actions[0].status, 'done');
  assert.match(r2.reply, /Near Osteria/);
});
