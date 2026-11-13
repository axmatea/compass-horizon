import { BRIEF_FIELDS, SECTION_NAMES } from './studio.mjs'

export const PREVIEW_VIEWS = ['web', 'phone', 'both']
export const previewView = value => PREVIEW_VIEWS.includes(value) ? value : 'both'

const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
const versionOf = value => Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value) || 1)) : 1

export function briefText(plan) {
  if (!plan?.intent || typeof plan.intent !== 'object') return ''
  const lines = [`COMPASS brief · v${versionOf(plan.version)}`]
  for (const [key, label] of BRIEF_FIELDS) {
    const value = plan.intent[key]
    const text = Array.isArray(value)
      ? value.slice(0, 12).map(item => clean(SECTION_NAMES[item] || item)).filter(Boolean).join(', ')
      : clean(value)
    if (text) lines.push(`${label}: ${text}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

export function canExportPreview(render, busy = false, plan = null) {
  return Boolean(!busy && typeof render?.html === 'string' && render.html.trim() && !render.pending?.length
    && (!plan?.version || versionOf(plan.version) === versionOf(render.version)))
}

export function previewDownload(plan, render) {
  if (!canExportPreview(render, false, plan)) return null
  const raw = plan?.intent?.business || plan?.intent?.kind || 'compass'
  const slug = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'compass'
  return {
    filename: `${slug}-preview-v${versionOf(render.version)}.html`,
    type: 'text/html;charset=utf-8',
    // The highlight marks a fresh section in the studio; it is not part of
    // the exported design. All styles already live inside the rendered page.
    html: render.html.replace(/ data-new(?=[\s=>])/g, ''),
  }
}

export function createPreviewTools({ root, surface, getPlan, getRender, isBusy = () => false, document:doc = root?.ownerDocument || globalThis.document }) {
  if (!root || !surface) return { update() {} }
  const views = [...root.querySelectorAll('[data-preview-view-button]')]
  const copy = root.querySelector('[data-preview-copy]')
  const download = root.querySelector('[data-preview-download]')
  const status = root.querySelector('[data-preview-status]')
  const source=doc.createElement('button');source.type='button';source.textContent='View code'
  const codePanel=doc.createElement('section');codePanel.className='preview-code';codePanel.hidden=true;codePanel.setAttribute('aria-label','Website source')
  const codeTitle=doc.createElement('h3');codeTitle.textContent='HTML source'
  const closeCode=doc.createElement('button');closeCode.type='button';closeCode.textContent='Close code'
  const pre=doc.createElement('pre'),code=doc.createElement('code');pre.tabIndex=0;pre.append(code);codePanel.append(codeTitle,closeCode,pre);surface.append(codePanel)
  root.querySelector('.preview-actions')?.prepend(source)
  source.addEventListener('click',()=>{if(!canExportPreview(getRender(),isBusy(),getPlan()))return;code.textContent=getRender().html;codePanel.hidden=false;closeCode.focus()})
  closeCode.addEventListener('click',()=>{codePanel.hidden=true;source.focus()})
  const say = text => { if (status) status.textContent = text }
  let lastHtml = ''
  let copying = false

  function setView(value) {
    const view = previewView(value)
    surface.dataset.previewView = view
    for (const button of views) button.setAttribute('aria-pressed', String(button.dataset.previewViewButton === view))
  }
  for (const button of views) button.addEventListener('click', () => setView(button.dataset.previewViewButton))
  setView(surface.dataset.previewView)

  copy?.addEventListener('click', async () => {
    const text = briefText(getPlan())
    if (!text || !canExportPreview(getRender(), isBusy(), getPlan()) || copying) return
    copying = true
    copy.disabled = true
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('clipboard_unavailable')
      await navigator.clipboard.writeText(text)
      say('Brief copied. You can paste it into a document or message.')
    } catch {
      say('Clipboard access is unavailable. Select the brief text in the panel to copy it.')
    } finally {
      copying = false
      update()
    }
  })

  download?.addEventListener('click', () => {
    if (!canExportPreview(getRender(), isBusy(), getPlan())) return
    const file = previewDownload(getPlan(), getRender())
    if (!file) return
    try {
      const url = URL.createObjectURL(new Blob([file.html], { type: file.type }))
      const link = doc.createElement('a')
      link.href = url
      link.download = file.filename
      link.hidden = true
      doc.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      say('HTML download started. This is a local preview file; nothing was published.')
    } catch {
      say('The download could not start in this browser. Open the page preview and save it there.')
    }
  })

  function update() {
    const render = getRender()
    const ready = canExportPreview(render, isBusy(), getPlan())
    if (copy) copy.disabled = copying || !ready || !briefText(getPlan())
    if (download) download.disabled = !ready
    source.disabled=!ready
    if(!ready)codePanel.hidden=true
    if(!codePanel.hidden)code.textContent=render.html
    if ((render?.html || '') !== lastHtml) {
      lastHtml = render?.html || ''
      say('')
    }
  }
  update()
  return { update, setView }
}
