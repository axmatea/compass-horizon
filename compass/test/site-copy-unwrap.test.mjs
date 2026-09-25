import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteCopyTool, unwrap } from '../server/tools/site-copy.mjs';

test('unwrap: JSON-encoded strings become objects/arrays, plain strings stay', () => {
  assert.deepEqual(unwrap('{"headline":"Hi","subhead":"x","cta":"Go"}'), { headline: 'Hi', subhead: 'x', cta: 'Go' });
  assert.deepEqual(unwrap(['{"title":"A","text":"b"}']), [{ title: 'A', text: 'b' }]);
  assert.equal(unwrap('Just words'), 'Just words');
  assert.equal(unwrap('{broken'), '{broken');
  assert.deepEqual(unwrap({ a: 1 }), { a: 1 });
});

test('write_copy accepts sections returned as JSON strings (minimax-m2.7 shape) without fallback', async () => {
  const llm = { chat: async () => ({ message: { content: JSON.stringify({
    hero: JSON.stringify({ headline: 'Authentic Italian in Palo Alto', subhead: 'Handmade pasta.', cta: 'Book' }),
    features: JSON.stringify([{ title: 'Handmade pasta', text: 'Fresh daily.' }, { title: 'Wood-fired', text: 'Real oven.' }, { title: 'Wine', text: 'Regional list.' }]),
    signup: JSON.stringify({ headline: 'Stay close', text: 'Get the menu.', cta: 'Join' }),
    footer: 'La Bella',
  }) }, latencyMs: 5 }) };
  const tool = createSiteCopyTool({ llm });
  const out = await tool.run({ business: 'La Bella', kind: 'italian restaurant', audience: 'diners', tone: 'warm', lang: 'en', hero: 'poster', headline: null, subhead: null, cta: null, sections: ['features', 'signup'] }, {});
  assert.equal(out.fallback, false);
  assert.equal(out.hero.headline, 'Authentic Italian in Palo Alto');
  assert.equal(out.features.length, 3);
  assert.equal(out.signup.cta, 'Join');
  assert.equal(out.footer, 'La Bella');
});
