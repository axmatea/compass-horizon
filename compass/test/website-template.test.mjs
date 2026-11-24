import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTemplatePreview } from '../marketplace/preview.mjs'
import { validateEditableHtml } from '../html/edit.mjs'
import { createProjectStore, restoredProject } from '../src/builder/project-store.mjs'
import { openWebsiteTemplate } from '../src/builder/website-template.mjs'

test('website templates open as exact editable public previews and survive save and reopen', async () => {
  const items = new Map()
  const store = createProjectStore({ storage: { getItem: key => items.get(key), setItem: (key, value) => items.set(key, value) } })
  for (const id of ['atlas', 'forma', 'mono']) {
    const html = renderTemplatePreview(id)
    const starter = await openWebsiteTemplate(id, { request: async (path, options) => {
      assert.equal(path, '/api/templates/' + id + '/preview')
      assert.equal(options.redirect, 'error')
      assert.equal(options.credentials, 'omit')
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    } })
    assert.equal(starter.revision.render.html, validateEditableHtml(html).html)
    assert.equal(starter.revision.source, 'template')
    assert.equal(starter.revision.plan.intent.business, starter.name)
    const saved = store.save({ name: starter.name, revisions: [starter.revision] })
    assert.equal(saved.ok, true)
    const restored = restoredProject(store.read().projects.find(project => project.id === saved.project.id))
    assert.equal(restored.render.html, starter.revision.render.html)
    assert.equal(restored.history[0].source, 'template')
  }
})

test('template opening rejects bad preview responses and never requests mobile or unknown products', async () => {
  for (const id of ['pulse', 'field', 'venue', 'unknown']) {
    assert.equal(await openWebsiteTemplate(id, { request: () => assert.fail('must not request unsupported template') }), null)
  }
  assert.equal(await openWebsiteTemplate('atlas', { request: () => new Response(null, { status: 404 }) }), null)
  assert.equal(await openWebsiteTemplate('atlas', { request: () => new Response('Not HTML') }), null)
  assert.equal(await openWebsiteTemplate('atlas', { request: () => new Response(renderTemplatePreview('pulse'), { headers: { 'content-type': 'text/html' } }) }), null)
})
