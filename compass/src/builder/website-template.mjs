import { getTemplate } from '../../marketplace/catalog.mjs'
import { validateEditableHtml } from '../../html/edit.mjs'
import { completedRevision, MAX_HTML } from './project-store.mjs'

const intents = {
  atlas: { kind: 'portfolio', font: 'serif', accent: 'slate', sections: ['gallery', 'contact'] },
  forma: { kind: 'studio', font: 'sans', accent: 'sky', sections: ['gallery', 'features', 'contact'] },
  mono: { kind: 'saas', font: 'sans', accent: 'violet', sections: ['features', 'contact'] },
}

// Only the public website preview can become an editable project. The mobile
// preview scripts and the marketplace's original package delivery stay separate.
export async function openWebsiteTemplate(id, { request = fetch, signal } = {}) {
  const template = getTemplate(id)
  if (template?.kind !== 'website' || !Object.hasOwn(intents, id)) return null
  const response = await request('/api/templates/' + template.id + '/preview', {
    credentials: 'omit',
    redirect: 'error',
    signal,
  })
  if (!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '') ||
      Number(response.headers.get('content-length')) > MAX_HTML) return null
  const document = validateEditableHtml(await response.text())
  if (!document.ok) return null

  const intent = { business: template.name, theme: 'light', density: 'balanced', ...intents[id] }
  const revision = completedRevision({
    plan: { version: 1, intent },
    render: { version: 1, html: document.html, pending: [] },
    source: 'template',
  }, 'Started from ' + template.name)
  return revision ? { name: template.name, revision } : null
}
