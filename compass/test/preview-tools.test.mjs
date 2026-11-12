import test from 'node:test';
import assert from 'node:assert/strict';
import { briefText, canExportPreview, previewDownload, previewView } from '../src/site/preview-tools.mjs';

test('copied brief contains the current intent, with readable sections and bounded text', () => {
  const text = briefText({
    version: 2,
    intent: { business: 'North & South', kind: 'bakery', tone: 'warm\n and\t friendly', theme: 'dark', sections: ['features', 'contact'] },
    patch: [{ field: 'sections', removed: ['pricing'] }],
  });
  assert.match(text, /^COMPASS brief · v2\nName: North & South\nWhat: bakery/);
  assert.match(text, /Tone: warm and friendly/);
  assert.match(text, /Sections: Features, Contact/);
  assert.doesNotMatch(text, /Pricing|undefined|\[object/);
  assert.equal(briefText(null), '');
  assert.equal(briefText({ intent: {} }), '');
  assert.ok(briefText({ intent: { business: 'x'.repeat(1000) } }).length < 550);
});

test('HTML export waits for a completed render and preserves its self-contained document', () => {
  const html = '<!doctype html><html><head><style>body{color:#eee}</style></head><body><section data-new><h1>A preview</h1></section></body></html>';
  const render = { html, version: 3, pending: [] };
  assert.equal(canExportPreview(null), false);
  assert.equal(canExportPreview({ html: 23 }), false);
  assert.equal(canExportPreview({ ...render, html: ' ' }), false);
  assert.equal(canExportPreview(render, true), false);
  assert.equal(canExportPreview({ ...render, pending: ['hero'] }), false);
  assert.equal(previewDownload({}, { ...render, pending: ['hero'] }), null);
  assert.equal(previewDownload({ version: 4 }, render), null);
  const download = previewDownload({ intent: { business: '../../North & South/\u0000' } }, render);
  assert.equal(download.filename, 'north-south-preview-v3.html');
  assert.equal(download.type, 'text/html;charset=utf-8');
  assert.equal(download.html, html.replace(' data-new', ''));
  assert.match(download.html, /<style>body\{color:#eee\}<\/style>/);
  assert.match(download.html, /<h1>A preview<\/h1>/);
});

test('view selection and exported filenames have safe defaults', () => {
  for (const view of ['web', 'phone', 'both']) assert.equal(previewView(view), view);
  assert.equal(previewView('desktop'), 'both');
  assert.equal(previewView(undefined), 'both');
  assert.equal(previewDownload({ intent: { business: '建物' } }, { html: '<p>Preview</p>', version: Infinity }).filename, 'compass-preview-v1.html');
});
