import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('builder entry points use the same Builder name', async () => {
  const demo = await read('demo.html')
  const create = await read('create.html')
  const plan = await read('plan.html')
  const studio = await read('studio.html')
  assert.match(demo, /Skip to the builder/)
  assert.match(demo, /Your page, from one idea\./)
  assert.doesNotMatch(demo, /Open Platform Tour for a quick guide/)
  assert.match(create, /href="\/demo">Builder/)
  assert.match(create, /What would you like to make\?/)
  assert.doesNotMatch(create, /Open demo/)
  assert.match(plan, /href="\/demo">Builder</)
  assert.doesNotMatch(plan, /the demo</)
  assert.match(studio, /href="\/demo">Builder/)
  assert.doesNotMatch(studio, /Start something/)
  const flow = await read('src/create/create.js')
  assert.match(flow, /prompt:'What would you like to make\?'/)
  assert.match(flow, /prompt:appEntry \? 'Describe a data app and the records it will manage\.' : 'Describe your website\.'/)
})

test('an empty builder hides utility chrome and inactive actions do not use the active fill', async () => {
  const demo = await read('demo.html')
  const css = await read('src/builder/builder.css')
  assert.match(demo, /<div class="project-bar" hidden>/)
  assert.match(demo, /<div class="context-row" hidden>/)
  assert.match(demo, /<details class="history-details" hidden>/)
  assert.match(demo, /<span class="count"[^>]*hidden/)
  assert.match(demo, /class="public-nav-secondary"[^>]*href="\/studio"/)
  assert.match(demo, /class="public-nav-secondary"[^>]*data-app-preview href="\/create\?app=1"/)
  assert.match(css, /#send:disabled\{background:#f4f5f7;color:#5c6370/)
  assert.match(css, /\.export-menu\.is-inert>summary\{[^}]*pointer-events:none/)
  assert.match(css, /\.stage:has\(#empty:not\(\[hidden\]\)\) \.chrome\{display:none\}/)
  assert.match(css, /flex-wrap:nowrap/)
  assert.match(css, /body:not\(\.account-workspace\) \.stage\{order:-1/)
  assert.match(css, /\.chrome \.viewport-tabs\{flex-wrap:nowrap/)
})
