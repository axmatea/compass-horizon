import test from 'node:test';
import assert from 'node:assert/strict';
import { briefText, canExportPreview, createPreviewTools, previewDownload, previewView } from '../src/site/preview-tools.mjs';

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

test('export stays inactive until a completed preview can actually be saved', () => {
  const nodes = new Map()
  class Node {
    constructor() { this.attributes = {}; this.disabled = false; this.hidden = false; this.open = false; this.tabIndex = 0; this.children = []; this.dataset = {}; this.className = ''; this._classes = new Set() }
    set textContent(value) { this._text = String(value) }
    get textContent() { return this._text || '' }
    setAttribute(name, value) { this.attributes[name] = String(value) }
    removeAttribute(name) { delete this.attributes[name] }
    addEventListener() {}
    append() {}
    querySelector(selector) { return nodes.get(selector) || null }
    querySelectorAll(selector) { return selector === '[data-preview-view-button]' ? [...nodes.get('views')] : [] }
    get classList() { return { toggle: (name, on) => { this._classes[on ? 'add' : 'delete'](name); this.className = [...this._classes].join(' ') } } }
  }
  const summary = new Node(), menu = new Node(), copy = new Node(), download = new Node(), source = new Node(), status = new Node(), surface = new Node(), root = new Node()
  for (const view of ['web', 'tablet', 'phone', 'both']) {
    const button = new Node(); button.dataset.previewViewButton = view
    ;(nodes.get('views') || nodes.set('views', []) && nodes.get('views')).push(button)
  }
  menu.querySelector = selector => selector === 'summary' ? summary : null
  root.querySelector = selector => ({ '[data-preview-copy]': copy, '[data-preview-download]': download, '[data-preview-status]': status, '.export-menu': menu, '[data-preview-code]': source })[selector] || null
  root.querySelectorAll = selector => selector === '[data-preview-view-button]' ? nodes.get('views') : []
  surface.dataset.previewView = 'web'
  surface.querySelector = () => null
  let render = null
  const tools = createPreviewTools({ root, surface, getPlan: () => ({ version: 1, intent: { business: 'Atelier' } }), getRender: () => render, document: { createElement: () => new Node() } })
  assert.equal(menu.className, 'is-inert')
  assert.equal(summary.attributes['aria-disabled'], 'true')
  assert.equal(summary.tabIndex, -1)
  assert.equal(copy.disabled, true)
  assert.equal(download.disabled, true)
  assert.equal(source.disabled, true)
  render = { html: '<p>Atelier</p>', version: 1, pending: [] }
  tools.update()
  assert.equal(menu.className, '')
  assert.equal(summary.attributes['aria-disabled'], 'false')
  assert.equal(summary.attributes.tabindex, undefined)
  assert.equal(download.disabled, false)
  assert.equal(source.disabled, false)
})

test('view selection and exported filenames have safe defaults', () => {
  for (const view of ['web', 'phone', 'both']) assert.equal(previewView(view), view);
  assert.equal(previewView('desktop'), 'both');
  assert.equal(previewView(undefined), 'both');
  assert.equal(previewDownload({ intent: { business: '建物' } }, { html: '<p>Preview</p>', version: Infinity }).filename, 'compass-preview-v1.html');
});
