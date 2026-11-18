import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studioCompany, studioTeam, studioQuotes } from '../src/site/studio-content.mjs';
import { visibleTeam } from '../src/site/team.mjs';
import { testimonials, visibleTestimonials } from '../src/site/testimonials.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('studio content publishes only confirmed founder and company facts', () => {
  assert.equal(studioCompany.name, 'AX Media Global');
  assert.equal(studioCompany.url, 'https://aimedia.global');
  assert.equal(studioCompany.arr, '$240K ARR');
  assert.deepEqual([...studioCompany.buildsFor], ['CPAs', 'developers', 'fintech']);
  assert.equal(studioCompany.shipped.name, 'Jarrar CPA Pro');
  assert.equal(studioCompany.shipped.url, 'https://jarrarcpa.pro');
  assert.match(studioCompany.product.line, /web apps, mobile apps and full products/);
  assert.equal(studioTeam.length, 1);
  const founder = visibleTeam(studioTeam)[0];
  assert.equal(founder.name, 'Nayl Ahmadulin');
  assert.equal(founder.role, 'Founder');
  assert.equal(founder.initials, 'NA');
  assert.equal(founder.photo, '');
  assert.match(founder.bio, /AX Media Global/);
  assert.doesNotMatch(founder.bio, /Vincent|\bACV\b|customers|raised|funded/i);
});

test('studio voices stay hidden until approved sourced quotes exist', () => {
  assert.equal(testimonials, studioQuotes);
  assert.deepEqual(studioQuotes, []);
  assert.deepEqual(visibleTestimonials(), []);
});

test('marketplace links to Studio where the confirmed investor facts remain available', async () => {
  const home = await read('index.html');
  const studio = await read('studio.html');
  const page = await read('src/site/studio-page.js');
  assert.match(home, /href="\/studio"/);
  assert.match(home, /href="https:\/\/aimedia\.global"/);
  assert.doesNotMatch(home, /id="story"|\$240K ARR/);
  assert.match(studio, /id="people-title">The team\./);
  assert.match(studio, /\$240K ARR/);
  assert.match(studio, /Products for CPAs, developers and fintech/);
  assert.match(studio, /Shipped: Jarrar CPA Pro/);
  assert.match(studio, /id="studio-voices"[^>]*hidden/);
  assert.match(page, /studio-content\.mjs/);
  assert.match(page, /person-avatar/);
  assert.doesNotMatch(home + studio, /Vincent|placeholder quote|Lorem ipsum/i);
});
