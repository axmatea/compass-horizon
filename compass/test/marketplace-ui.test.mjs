import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { TEMPLATE_CATALOG, getTemplate, filterTemplates } from '../marketplace/catalog.mjs'
import { readDraft, validPrompt, writeDraft } from '../src/create/draft.mjs'

const source = (await readFile(new URL('../src/marketplace/marketplace.mjs', import.meta.url), 'utf8'))
  .replace(/^import .+\n/gm, '').replace('export function', 'function')

class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.doc = doc; this.children = []; this.parentElement = null
    this.attributes = {}; this.dataset = {}; this.listeners = new Map(); this.hidden = false; this.disabled = false
    this.style = { setProperty(name, value) { this[name] = value } }; this._text = ''; this.value = ''; this.open = false
    this.clientWidth = 320; this.clientHeight = 460
  }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map(child => child.textContent).join('') }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node) } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; this.append(...nodes) }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'open') this.open = true }
  getAttribute(name) { return this.attributes[name] ?? null }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'href') delete this.href; if (name === 'open') this.open = false }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback) }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback) }
  async fire(type, extra = {}) {
    const event = { type, target: this, key: '', shiftKey: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.propagationStopped = true }, ...extra }
    for (const callback of [...this.listeners.get(type) || []]) await callback(event)
    return event
  }
  all() { return this.children.flatMap(child => [child, ...child.all()]) }
  contains(node) { return node === this || this.all().includes(node) }
  querySelectorAll(selector) {
    if (selector === '[data-template-kind]') return this.all().filter(node => node.dataset.templateKind)
    if (selector === '[data-open-film]') return this.all().filter(node => node.dataset.openFilm !== undefined)
    if (selector === 'dialog[open]') return this.all().filter(node => node.tagName === 'DIALOG' && node.open)
    return this.all().filter(node => (node.tagName === 'BUTTON' && !node.disabled) || ['INPUT', 'IFRAME', 'SUMMARY'].includes(node.tagName) || (node.tagName === 'A' && (node.href || node.attributes.href)) || node.attributes.tabindex === '0')
  }
  closest(selector) { if (selector === '[hidden]') { let node = this; while (node) { if (node.hidden) return node; node = node.parentElement } } return null }
  getBoundingClientRect() { return { left: 20, right: 1000, top: 20, bottom: 800, width: this.clientWidth, height: this.clientHeight } }
  focus() { this.doc.activeElement = this }
  get isConnected() { return this === this.doc.body || this.doc.body.contains(this) }
  showModal() { this.open = true; this.modal = true }
  close() { this.open = false }
}

function fixture({ url = 'https://mycompass.world/', request, mobile = false, draftStorage, replaceIdea = true } = {}) {
  const calls = [], timers = new Map(), intersections = []
  let timerId = 0, clock = 0, currentURL = new URL(url)
  const doc = new Element('document', null); doc.doc = doc; doc.body = new Element('body', doc); doc.body.style.overflow = 'auto'; doc.append(doc.body)
  doc.createElement = tag => new Element(tag, doc)
  doc.getElementById = id => doc.all().find(node => node.id === id) || null
  const ids = ['template-catalog', 'template-search', 'template-empty', 'template-reset', 'market-status', 'template-link-error', 'film']
  for (const id of ids) { const node = doc.createElement(id === 'template-search' ? 'input' : id === 'template-reset' ? 'button' : id === 'film' ? 'details' : 'div'); node.id = id; doc.body.append(node) }
  if (draftStorage) {
    const start = doc.createElement('form'); start.id = 'market-start'; start.hidden = true
    start.elements = { projectType: { value: 'app' } }
    const idea = doc.createElement('textarea'); idea.id = 'market-idea'
    const status = doc.createElement('p'); status.id = 'market-start-status'
    start.append(idea, status); doc.body.append(start)
  }
  for (const kind of ['all', 'website', 'mobile']) { const node = doc.createElement('button'); node.dataset.templateKind = kind; doc.body.append(node) }
  const filmLink = doc.createElement('a'); filmLink.dataset.openFilm = ''; doc.body.append(filmLink)
  const search = doc.getElementById('template-search'); search.focus()
  const view = new Element('window', doc)
  view.location = { get href() { return currentURL.href }, get search() { return currentURL.search }, replace(path) { view.replaced = path }, assign(path) { view.assigned = path } }
  view.confirm = () => replaceIdea
  const entries = [{ url: currentURL.href, state: null }]; let position = 0
  view.history = {
    get state() { return entries[position].state },
    pushState(state, _, path) { currentURL = new URL(path, currentURL); entries.splice(position + 1); entries.push({ url: currentURL.href, state }); position++ },
    replaceState(state, _, path) { currentURL = new URL(path, currentURL); entries[position] = { url: currentURL.href, state } },
    back() { if (position > 0) { position--; currentURL = new URL(entries[position].url); view.fire('popstate') } },
    forward() { if (position < entries.length - 1) { position++; currentURL = new URL(entries[position].url); view.fire('popstate') } },
  }
  view.setTimeout = (work, delay) => { timers.set(++timerId, { work, at: clock + delay }); return timerId }
  view.clearTimeout = id => timers.delete(id)
  view.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); intersections.push(this) }
    observe(node) { this.targets.add(node) }
    unobserve(node) { this.targets.delete(node) }
    disconnect() { this.targets.clear() }
  }
  view.ResizeObserver = class { observe() {} disconnect() {} }
  view.matchMedia = () => ({ matches: mobile })
  const fetch = async (path, options) => { calls.push({ path, options }); return request ? request(path, options) : new Response(null, { headers: { 'content-type': 'text/html; charset=utf-8' } }) }
  const context = { URL, URLSearchParams, AbortController, TEMPLATE_CATALOG, getTemplate, filterTemplates, validPrompt,
    readDraft: () => readDraft({ storage: draftStorage }),
    writeDraft: value => writeDraft(value, { storage: draftStorage }), globalThis: {} }
  vm.runInNewContext(source + ';globalThis.mount=mountMarketplace', context)
  const api = context.globalThis.mount({ document: doc, window: view, fetch })
  const elements = () => doc.body.all()
  const byClass = name => elements().find(node => node.className === name)
  const card = id => elements().find(node => node.className === 'market-card' && node.dataset.templateId === id)
  const reveal = async id => { const node = card(id); for (const observer of intersections) if (observer.targets.has(node)) observer.callback([{ target: node, isIntersecting: true }]); await flush() }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  const advance = async milliseconds => { clock += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.work() } await flush() }
  return { api, doc, view, calls, entries, timers, search, elements, byClass, card, reveal, flush, advance, get url() { return currentURL } }
}

test('homepage keeps the exact idea in session storage and routes by the chosen project type', async () => {
  const items = new Map()
  const storage = { getItem: key => items.get(key), setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }
  const ui = fixture({ draftStorage: storage })
  const start = ui.doc.getElementById('market-start')
  const idea = ui.doc.getElementById('market-idea')
  assert.equal(start.hidden, false)
  idea.value = 'ab'
  await start.fire('submit')
  assert.equal(items.size, 0)
  assert.equal(ui.view.assigned, undefined)
  idea.value = 'Project tracker\nfor a design studio'
  await start.fire('submit')
  assert.equal(ui.view.assigned, '/create?app=1')
  assert.equal(readDraft({ storage }).prompt, idea.value)
  assert.equal(readDraft({ storage }).ready, false)
  assert.equal(readDraft({ storage }).preferences.projectType, 'internal-tool')
  start.elements.projectType.value = 'website'
  idea.value = 'Architecture studio website'
  await start.fire('submit')
  assert.equal(ui.view.assigned, '/create')
  assert.equal(readDraft({ storage }).preferences.projectType, 'website')

  const cancel = fixture({ draftStorage: storage, replaceIdea: false })
  cancel.doc.getElementById('market-idea').value = 'A different idea'
  await cancel.doc.getElementById('market-start').fire('submit')
  assert.equal(cancel.view.assigned, undefined)
  assert.equal(readDraft({ storage }).prompt, 'Architecture studio website')
})

test('only scriptless website starter products offer Open in Builder', () => {
  const ui = fixture()
  assert.equal(ui.api.open('atlas'), true)
  const link = ui.byClass('market-use-template')
  assert.equal(link.href, '/demo?template=atlas')
  assert.equal(link.hidden, false)
  assert.equal(ui.api.open('pulse'), true)
  assert.equal(link.hidden, true)
  assert.equal(link.href, undefined)
})

test('the storefront loads only visible public previews and keeps filters, search and reset usable', async () => {
  const ui = fixture()
  assert.equal(ui.elements().filter(node => node.className === 'market-card').length, 6)
  assert.equal(ui.calls.length, 0, 'catalog mounting does not eagerly load hidden previews')
  await ui.reveal('atlas')
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].path, '/api/templates/atlas/preview')
  assert.equal(ui.calls[0].options.method, 'HEAD'); assert.equal(ui.calls[0].options.credentials, 'omit')
  const cardFrame = ui.card('atlas').all().find(node => node.tagName === 'IFRAME')
  assert.equal(cardFrame.getAttribute('sandbox'), 'allow-scripts'); assert.equal(cardFrame.getAttribute('aria-hidden'), 'true'); assert.equal(cardFrame.tabIndex, -1); assert.equal(cardFrame.inert, true)
  assert.equal(cardFrame.style.width, '1100px', 'catalog thumbnails show a desktop layout')
  const mobile = ui.elements().find(node => node.dataset.templateKind === 'mobile')
  await mobile.fire('click')
  assert.deepEqual(ui.elements().filter(node => node.className === 'market-card' && !node.hidden).map(node => node.dataset.templateId), ['pulse', 'field', 'venue'])
  assert.equal(mobile.getAttribute('aria-pressed'), 'true')
  ui.search.value = 'booking'; await ui.search.fire('input')
  assert.deepEqual(ui.elements().filter(node => node.className === 'market-card' && !node.hidden).map(node => node.dataset.templateId), ['venue'])
  ui.search.value = 'no matching thing'; await ui.search.fire('input')
  assert.equal(ui.doc.getElementById('template-empty').hidden, false)
  assert.equal(ui.doc.getElementById('market-status').textContent, '0 templates')
  await ui.doc.getElementById('template-reset').fire('click')
  assert.equal(ui.search.value, ''); assert.equal(ui.doc.activeElement, ui.search)
  assert.equal(ui.elements().filter(node => node.className === 'market-card' && !node.hidden).length, 6)
  ui.api.destroy(); assert.equal(ui.timers.size, 0)
})

test('card detail navigation supports browser Back/Forward and closes without changing search', async () => {
  const ui = fixture()
  ui.search.value = 'architecture'; await ui.search.fire('input')
  const trigger = ui.card('atlas').all().find(node => node.className === 'market-card-open')
  trigger.focus(); await trigger.fire('click'); await ui.flush()
  assert.equal(ui.api.isOpen, true); assert.equal(ui.url.searchParams.get('template'), 'atlas')
  assert.equal(ui.entries.length, 2); assert.equal(ui.byClass('market-detail').modal, true)
  assert.equal(ui.byClass('market-detail').getAttribute('aria-modal'), 'true')
  assert.equal(ui.byClass('market-detail-info').children[0].textContent, 'Atlas')
  const responsiveFrame = ui.byClass('market-detail-stage').all().find(node => node.tagName === 'IFRAME')
  assert.equal(responsiveFrame.style.width, '320px', 'website detail uses its available width, including phone widths')
  assert.equal(responsiveFrame.style.transform, 'scale(1)')
  assert.equal(responsiveFrame.getAttribute('sandbox'), 'allow-scripts', 'website previews do not need form submission')
  assert.equal(ui.doc.body.style.overflow, 'hidden')
  ui.view.history.back(); await ui.flush()
  assert.equal(ui.api.isOpen, false); assert.equal(ui.doc.activeElement, trigger); assert.equal(ui.doc.body.style.overflow, 'auto')
  assert.equal(ui.search.value, 'architecture')
  ui.view.history.forward(); await ui.flush(); assert.equal(ui.api.isOpen, true)
  const event = await ui.byClass('market-detail').fire('keydown', { key: 'Escape' })
  assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true)
  assert.equal(ui.api.isOpen, false); assert.equal(ui.url.searchParams.has('template'), false)
  ui.api.destroy()
})

test('a direct product link opens without an extra history entry; close preserves unrelated URL data', async () => {
  const ui = fixture({ url: 'https://mycompass.world/?campaign=launch&template=field#catalog' })
  await ui.flush()
  assert.equal(ui.api.isOpen, true); assert.equal(ui.entries.length, 1)
  assert.match(ui.byClass('market-detail').textContent, /Field/)
  ui.api.close(); assert.equal(ui.entries.length, 1)
  assert.equal(ui.url.searchParams.get('campaign'), 'launch'); assert.equal(ui.url.hash, '#catalog')
  assert.equal(ui.url.searchParams.has('template'), false)
  const invalid = fixture({ url: 'https://mycompass.world/?template=..%2Faccount%2Fprojects' })
  assert.equal(invalid.api.isOpen, false); assert.equal(invalid.calls.length, 0)
  assert.equal(invalid.doc.getElementById('template-link-error').textContent, 'Template not found.')
  ui.api.destroy(); invalid.api.destroy()
})

test('mobile formats show an interactive mobile web preview and honest native-source information with purchases off', async () => {
  const ui = fixture(); ui.api.open('pulse'); await ui.flush()
  const stage = ui.byClass('market-detail-stage')
  let frame = stage.all().find(node => node.tagName === 'IFRAME')
  assert.ok(frame); assert.equal(frame.title, 'Pulse mobile web preview')
  assert.equal(frame.style.width, '390px', 'desktop detail retains the phone viewport')
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms'); assert.notEqual(frame.getAttribute('aria-hidden'), 'true')
  assert.doesNotMatch(frame.getAttribute('sandbox'), /allow-same-origin/)
  await frame.fire('load')
  assert.equal(ui.byClass('market-detail-preview-note').children[1].hidden, false)
  assert.equal(ui.byClass('market-detail-preview-note').children[0].textContent, 'Mobile web preview · Local demo')
  const native = ui.byClass('market-detail-tabs').children.find(node => node.dataset.format === 'ios-android')
  const oldSignal = ui.calls[0].options.signal
  await native.fire('click')
  assert.equal(oldSignal.aborted, true); assert.equal(stage.all().some(node => node.tagName === 'IFRAME'), false)
  assert.match(stage.textContent, /Expo \+ React Native/)
  assert.match(stage.textContent, /Source project for iOS and Android\. Device builds are not verified\./)
  assert.equal(ui.calls.length, 1, 'native format info never loads a fake emulator')
  assert.equal(ui.byClass('market-purchase').disabled, true)
  assert.equal(ui.byClass('market-purchase-note').textContent, 'Purchases open soon.')
  assert.doesNotMatch(ui.byClass('market-detail').textContent, /App Store.ready|\$\d|Buy now|Download source/i)
  await ui.byClass('market-native').children.find(node => node.tagName === 'BUTTON').fire('click'); await ui.flush()
  assert.equal(ui.calls.length, 2); assert.equal(ui.doc.activeElement.dataset.format, 'mobile-web')
  ui.api.destroy()
})

test('on phones, mobile detail uses readable host-width rendering while catalog thumbnails retain their phone viewport', async () => {
  const ui = fixture({ mobile: true })
  await ui.reveal('pulse')
  const thumbnail = ui.card('pulse').all().find(node => node.tagName === 'IFRAME')
  assert.equal(thumbnail.style.width, '390px')
  assert.notEqual(thumbnail.style.transform, 'scale(1)')
  ui.api.open('pulse'); await ui.flush()
  const stage = ui.byClass('market-detail-stage')
  const frame = stage.all().find(node => node.tagName === 'IFRAME')
  assert.equal(stage.dataset.format, 'mobile-web')
  assert.equal(frame.style.width, '320px')
  assert.equal(frame.style.transform, 'scale(1)')
  assert.equal(frame.style.height, '460px')
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms')
  ui.api.destroy()
})

test('preview HTTP failures and load timeouts are visible and retryable', async () => {
  let attempts = 0
  const ui = fixture({ request: async () => attempts++ ? new Response(null, { headers: { 'content-type': 'text/html' } }) : new Response(null, { status: 503 }) })
  ui.api.open('mono'); await ui.flush()
  const stage = ui.byClass('market-detail-stage')
  assert.equal(stage.dataset.previewState, 'error'); assert.match(stage.textContent, /Preview unavailable/)
  assert.equal(stage.all().some(node => node.tagName === 'IFRAME'), false)
  await stage.all().find(node => node.className === 'market-retry').fire('click'); await ui.flush()
  assert.equal(stage.dataset.previewState, 'loading'); assert.equal(ui.calls.length, 2)
  await ui.advance(12001)
  assert.equal(stage.dataset.previewState, 'error'); assert.equal(stage.all().some(node => node.tagName === 'IFRAME'), false)
  await stage.all().find(node => node.className === 'market-retry').fire('click'); await ui.flush()
  await stage.all().find(node => node.tagName === 'IFRAME').fire('load')
  assert.equal(stage.dataset.previewState, 'ready'); assert.equal(ui.timers.size, 0)
  assert.equal(ui.byClass('market-detail-preview-note').children[1].hidden, false)
  ui.api.destroy()
})

test('late preview checks cannot populate a closed dialog or replace the chosen native view', async () => {
  const completions = []
  const ui = fixture({ request: () => new Promise(resolve => completions.push(resolve)) })
  ui.api.open('venue'); ui.api.close()
  assert.equal(ui.calls[0].options.signal.aborted, true)
  completions[0](new Response(null, { headers: { 'content-type': 'text/html' } })); await ui.flush()
  assert.equal(ui.api.isOpen, false); assert.equal(ui.byClass('market-detail-stage').all().some(node => node.tagName === 'IFRAME'), false)
  ui.api.open('venue')
  await ui.byClass('market-detail-tabs').children.find(node => node.dataset.format === 'ios-android').fire('click')
  completions[1](new Response(null, { headers: { 'content-type': 'text/html' } })); await ui.flush()
  assert.match(ui.byClass('market-detail-stage').textContent, /Expo \+ React Native/)
  assert.equal(ui.byClass('market-detail-stage').all().some(node => node.tagName === 'IFRAME'), false)
  ui.api.destroy(); assert.equal(ui.timers.size, 0)
})

test('modal keyboard focus stays contained, other dialogs do not stack, and film access stays explicit', async () => {
  const ui = fixture(); ui.api.open('atlas'); await ui.flush()
  const dialog = ui.byClass('market-detail'), close = ui.byClass('market-close')
  close.focus(); const reverse = await dialog.fire('keydown', { key: 'Tab', shiftKey: true })
  assert.equal(reverse.defaultPrevented, true)
  assert.equal(ui.doc.activeElement, ui.byClass('market-use-template'))
  const forward = await dialog.fire('keydown', { key: 'Tab' })
  assert.equal(forward.defaultPrevented, true); assert.equal(ui.doc.activeElement, close)
  assert.equal((await dialog.fire('keydown', { key: 'Enter', metaKey: true })).propagationStopped, true)
  ui.api.close()
  const other = ui.doc.createElement('dialog'); other.showModal(); ui.doc.body.append(other)
  assert.equal(ui.api.open('mono'), false); assert.equal(ui.api.isOpen, false)
  other.close()
  await ui.elements().find(node => node.dataset.openFilm !== undefined).fire('click')
  assert.equal(ui.doc.getElementById('film').open, true)
  ui.api.destroy()
})

test('legacy app-start navigation redirects before mounting cards or making requests', () => {
  const ui = fixture({ url: 'https://mycompass.world/?start=app' })
  assert.equal(ui.api, null); assert.equal(ui.view.replaced, '/demo?start=app')
  assert.equal(ui.calls.length, 0); assert.equal(ui.doc.getElementById('template-catalog').children.length, 0)
})
