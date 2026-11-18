import { TEMPLATE_CATALOG, getTemplate, filterTemplates } from '../../marketplace/catalog.mjs'

const FORMAT_LABELS = { website: 'Website', 'mobile-web': 'Mobile web', 'ios-android': 'iOS & Android' }
let instanceSequence = 0

// Preview HTML is served by the public, engineer-authored template route. No
// project source, account storage or generated-code runner enters this module.
export function mountMarketplace({
  document: doc = globalThis.document,
  window: view = globalThis.window,
  fetch: request = globalThis.fetch,
} = {}) {
  if (!doc || !view) return null
  if (new URLSearchParams(view.location.search).get('start') === 'app') {
    view.location.replace('/demo?start=app')
    return null
  }
  const grid = doc.getElementById('template-catalog')
  const search = doc.getElementById('template-search')
  const filters = [...doc.querySelectorAll('[data-template-kind]')]
  const empty = doc.getElementById('template-empty')
  const reset = doc.getElementById('template-reset')
  const status = doc.getElementById('market-status')
  const linkError = doc.getElementById('template-link-error')
  if (!grid || !search || !empty || !reset || !status || !linkError) return null

  const instance = `marketplace-${++instanceSequence}`
  const disposers = []
  const previews = new Set()
  const cards = new Map()
  let destroyed = false
  let kind = 'all'
  let dialog = null
  let current = null
  let detailPreview = null
  let previousFocus = null
  let previousOverflow = ''
  let detail = null
  let activeFormat = null

  function element(tag, className, text) {
    const node = doc.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  function listen(node, type, callback) {
    node.addEventListener(type, callback)
    disposers.push(() => node.removeEventListener(type, callback))
  }
  function button(className, text, action) {
    const node = element('button', className, text)
    node.type = 'button'
    if (action) node.addEventListener('click', action)
    return node
  }

  function previewFor(template, stage, { interactive = false, onState = () => {} } = {}) {
    const box = element('div', 'market-frame-box')
    const feedback = element('div', 'market-preview-status')
    const label = element('span', '', 'Loading preview')
    const retry = button('market-retry', 'Retry preview', event => {
      event.stopPropagation()
      start()
    })
    retry.hidden = true
    feedback.setAttribute('role', interactive ? 'status' : 'presentation')
    if (interactive) feedback.setAttribute('aria-live', 'polite')
    feedback.append(label, retry)
    stage.append(box, feedback)
    let frame = null
    let controller = null
    let timer = null
    let generation = 0
    let state = 'idle'
    let disposed = false
    const url = `/api/templates/${template.id}/preview`

    function setState(value) {
      state = value
      feedback.dataset.state = value
      feedback.hidden = value === 'ready'
      retry.hidden = value !== 'error'
      label.textContent = value === 'error' ? 'Preview unavailable' : 'Loading preview'
      stage.dataset.previewState = value
      onState(value)
    }
    function resize() {
      if (!frame || disposed) return
      const width = Math.max(1, box.clientWidth || box.getBoundingClientRect().width || 1)
      // On phones, interactive apps use the available width without shrinking
      // their text. Desktop device frames and catalog thumbnails stay scaled.
      const fullWidthMobile = interactive && template.kind === 'mobile' && view.matchMedia?.('(max-width:700px)')?.matches
      const sourceWidth = template.kind === 'mobile' ? (fullWidthMobile ? width : 390) : interactive ? width : 1100
      const scale = width / sourceWidth
      const height = Math.max(1, box.clientHeight || box.getBoundingClientRect().height || 700)
      frame.style.width = `${sourceWidth}px`
      frame.style.height = `${Math.ceil(height / scale)}px`
      frame.style.transform = `scale(${scale})`
    }
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(resize) : null
    observer?.observe(box)
    if (!observer) view.addEventListener('resize', resize)

    function clearLoading() {
      if (timer !== null) view.clearTimeout(timer)
      timer = null
    }
    function fail(token) {
      if (disposed || token !== generation) return
      clearLoading()
      controller?.abort()
      frame?.remove()
      frame = null
      setState('error')
    }
    async function start() {
      if (disposed || destroyed || ['checking', 'loading', 'ready'].includes(state)) return
      const token = ++generation
      controller?.abort()
      controller = new AbortController()
      clearLoading()
      frame?.remove()
      frame = null
      setState('checking')
      timer = view.setTimeout(() => fail(token), 12000)
      try {
        const response = await request(url, { method: 'HEAD', credentials: 'omit', cache: 'no-cache', redirect: 'error', signal: controller.signal })
        if (disposed || destroyed || token !== generation || state !== 'checking') return
        if (!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('preview-unavailable')
        clearLoading()
        frame = element('iframe')
        frame.title = `${template.name} ${template.kind === 'mobile' ? 'mobile web' : 'website'} preview`
        // Mobile demos use local submit handlers. The preview response CSP
        // still denies form destinations and network connections.
        frame.setAttribute('sandbox', interactive && template.kind === 'mobile' ? 'allow-scripts allow-forms' : 'allow-scripts')
        frame.setAttribute('referrerpolicy', 'no-referrer')
        if (!interactive) {
          frame.tabIndex = -1
          frame.inert = true
          frame.setAttribute('aria-hidden', 'true')
        }
        frame.addEventListener('load', () => {
          if (disposed || token !== generation || state !== 'loading') return
          clearLoading()
          setState('ready')
        })
        frame.addEventListener('error', () => fail(token))
        setState('loading')
        timer = view.setTimeout(() => fail(token), 12000)
        frame.src = url
        box.append(frame)
        resize()
      } catch {
        fail(token)
      }
    }
    const record = {
      start,
      dispose() {
        if (disposed) return
        disposed = true
        generation++
        controller?.abort()
        clearLoading()
        observer?.disconnect()
        if (!observer) view.removeEventListener('resize', resize)
        frame?.remove()
        box.remove()
        feedback.remove()
        previews.delete(record)
      },
    }
    previews.add(record)
    return record
  }

  const intersection = typeof view.IntersectionObserver === 'function'
    ? new view.IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const card = cards.get(entry.target.dataset.templateId)
        if (card && !card.article.hidden) {
          card.preview.start()
          intersection.unobserve(entry.target)
        }
      }
    }, { rootMargin: '160px' }) : null

  for (const template of TEMPLATE_CATALOG) {
    const article = element('article', 'market-card')
    article.dataset.templateId = template.id
    const stage = element('div', 'market-card-preview')
    stage.dataset.kind = template.kind
    stage.style.setProperty('--template-accent', template.accent)
    const open = button('market-card-open', '', () => openTemplate(template.id, { push: true, trigger: open }))
    open.setAttribute('aria-label', `View ${template.name} template`)
    open.setAttribute('aria-haspopup', 'dialog')
    const caption = element('div', 'market-card-caption')
    const title = element('div')
    title.append(element('h2', '', template.name), element('p', '', template.category))
    caption.append(title, element('span', 'market-card-format', template.kind === 'mobile' ? 'Web · iOS · Android' : 'Website'))
    const preview = previewFor(template, stage)
    stage.append(open)
    article.append(stage, caption)
    grid.append(article)
    cards.set(template.id, { article, stage, open, preview })
    if (intersection) intersection.observe(article)
    else preview.start()
  }
  grid.setAttribute('aria-busy', 'false')

  function filterCards() {
    const matches = new Set(filterTemplates({ kind, query: search.value }).map(template => template.id))
    for (const [id, card] of cards) {
      card.article.hidden = !matches.has(id)
      if (!card.article.hidden) {
        if (intersection) intersection.observe(card.article)
        else card.preview.start()
      }
    }
    for (const control of filters) control.setAttribute('aria-pressed', String(control.dataset.templateKind === kind))
    empty.hidden = matches.size > 0
    status.textContent = `${matches.size} ${matches.size === 1 ? 'template' : 'templates'}`
  }
  listen(search, 'input', filterCards)
  for (const control of filters) listen(control, 'click', () => {
    kind = control.dataset.templateKind
    filterCards()
  })
  listen(reset, 'click', () => {
    kind = 'all'
    search.value = ''
    filterCards()
    search.focus()
  })
  filterCards()

  function currentURL() { return new URL(view.location.href) }
  function queryTemplate() { return currentURL().searchParams.get('template') }
  function setURL(id, method) {
    const url = currentURL()
    if (id) url.searchParams.set('template', id)
    else url.searchParams.delete('template')
    const state = { ...(view.history.state || {}) }
    if (id) state.compassMarketplace = instance
    else delete state.compassMarketplace
    view.history[method](state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  function ensureDialog() {
    if (dialog) return
    dialog = element('dialog', 'market-detail')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', `${instance}-title`)
    const top = element('header', 'market-detail-top')
    const category = element('p')
    const close = button('market-close', '×', () => closeTemplate())
    close.setAttribute('aria-label', 'Close template')
    top.append(category, close)
    const body = element('div', 'market-detail-body')
    const visual = element('div', 'market-detail-visual')
    const tabs = element('div', 'market-detail-tabs')
    tabs.setAttribute('role', 'group')
    tabs.setAttribute('aria-label', 'Template format')
    const stage = element('div', 'market-detail-stage')
    const previewNote = element('p', 'market-detail-preview-note')
    const previewLabel = element('span')
    const previewLink = element('a', '', 'Open preview ↗')
    previewLink.target = '_blank'
    previewLink.rel = 'noopener noreferrer'
    previewLink.hidden = true
    previewNote.append(previewLabel, previewLink)
    visual.append(tabs, stage, previewNote)
    const info = element('div', 'market-detail-info')
    const title = element('h2')
    title.id = `${instance}-title`
    const productCategory = element('p', 'market-detail-category')
    const description = element('p', 'market-detail-description')
    const includes = element('div', 'market-detail-includes')
    const formats = element('p', 'market-detail-formats')
    const features = element('ul')
    includes.append(element('h3', '', 'Included'), formats, features)
    const purchase = button('market-purchase', 'Purchase')
    purchase.disabled = true
    const purchaseNote = element('p', 'market-purchase-note', 'Purchases open soon.')
    purchaseNote.id = `${instance}-purchase-note`
    purchase.setAttribute('aria-describedby', purchaseNote.id)
    info.append(title, productCategory, description, includes, purchase, purchaseNote)
    body.append(visual, info)
    dialog.append(top, body)
    doc.body.append(dialog)
    detail = { category, close, title, productCategory, description, formats, features, tabs, stage, previewLabel, previewLink }
    listen(dialog, 'cancel', event => {
      event.preventDefault()
      closeTemplate()
    })
    listen(dialog, 'click', event => {
      if (event.target !== dialog) return
      const rect = dialog.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeTemplate()
    })
    listen(dialog, 'keydown', event => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        closeTemplate()
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll('button:not([disabled]),a[href],iframe,input,summary,[tabindex="0"]')]
        .filter(node => !node.hidden && !node.closest('[hidden]'))
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) {
        event.preventDefault()
        first?.focus()
      }
    })
  }
  function selectFormat(format, { focus = false } = {}) {
    if (!current || !current.formats.includes(format)) return
    activeFormat = format
    detailPreview?.dispose()
    detailPreview = null
    detail.stage.replaceChildren()
    detail.stage.dataset.kind = current.kind
    detail.stage.dataset.format = format
    detail.stage.style.setProperty('--template-accent', current.accent)
    detail.previewLink.hidden = true
    detail.previewLink.removeAttribute('href')
    for (const control of detail.tabs.children) control.setAttribute('aria-pressed', String(control.dataset.format === format))
    if (format === 'ios-android') {
      const native = element('div', 'market-native')
      const mark = element('div', 'market-native-mark', '↗')
      mark.setAttribute('aria-hidden', 'true')
      const showWeb = button('', 'Preview mobile web', () => selectFormat('mobile-web', { focus: true }))
      native.append(mark, element('h3', '', 'Expo + React Native'), element('p', '', 'Source project for iOS and Android. Device builds are not verified.'), showWeb)
      detail.stage.append(native)
      detail.previewLabel.textContent = 'Editable source project'
    } else {
      detail.previewLabel.textContent = format === 'mobile-web' ? 'Mobile web preview · Local demo' : 'Website preview'
      const id = current.id
      detailPreview = previewFor(current, detail.stage, {
        interactive: true,
        onState(state) {
          if (!current || current.id !== id || activeFormat !== format) return
          detail.previewLink.hidden = state !== 'ready'
          if (state === 'ready') detail.previewLink.href = `/api/templates/${id}/preview`
          else detail.previewLink.removeAttribute('href')
        },
      })
      detailPreview.start()
    }
    if (focus) [...detail.tabs.children].find(control => control.dataset.format === format)?.focus()
  }
  function openTemplate(id, { push = false, trigger } = {}) {
    if (destroyed) return false
    const template = getTemplate(id)
    if (!template) {
      linkError.textContent = 'Template not found.'
      linkError.hidden = false
      hideDialog()
      return false
    }
    // Native dialogs make the rest of the document inert. Do not stack a new
    // modal on a currently open guide or account dialog.
    const other = [...doc.querySelectorAll('dialog[open]')].find(node => node !== dialog)
    if (other) return false
    ensureDialog()
    const wasOpen = Boolean(current)
    if (!wasOpen) {
      previousFocus = trigger || doc.activeElement
      previousOverflow = doc.body.style.overflow
    }
    linkError.hidden = true
    current = template
    detail.category.textContent = template.kind === 'mobile' ? 'Mobile app' : 'Website'
    detail.title.textContent = template.name
    detail.productCategory.textContent = template.category
    detail.description.textContent = template.description
    detail.formats.textContent = template.formats.map(format => FORMAT_LABELS[format]).join(' · ')
    detail.features.replaceChildren(...template.features.map(feature => element('li', '', feature)))
    detail.tabs.replaceChildren(...template.formats.map(format => {
      const control = button('', FORMAT_LABELS[format], () => selectFormat(format))
      control.dataset.format = format
      return control
    }))
    if (push && queryTemplate() !== id) setURL(id, 'pushState')
    if (!dialog.open) dialog.showModal()
    doc.body.style.overflow = 'hidden'
    selectFormat(template.formats[0])
    detail.close.focus()
    dialog.scrollTop = 0
    return true
  }
  function hideDialog() {
    if (!current) return
    current = null
    activeFormat = null
    detailPreview?.dispose()
    detailPreview = null
    if (dialog?.open) dialog.close()
    doc.body.style.overflow = previousOverflow
    if (previousFocus?.isConnected && !previousFocus.closest('[hidden]')) previousFocus.focus()
    else search.focus()
    previousFocus = null
  }
  function closeTemplate() {
    const ownedEntry = view.history.state?.compassMarketplace === instance
    hideDialog()
    if (!queryTemplate()) return
    if (ownedEntry) view.history.back()
    else setURL(null, 'replaceState')
  }
  function syncURL() {
    const id = queryTemplate()
    if (id !== null) openTemplate(id)
    else {
      hideDialog()
      linkError.hidden = true
    }
  }
  listen(view, 'popstate', syncURL)
  for (const link of doc.querySelectorAll('[data-open-film]')) listen(link, 'click', () => {
    const film = doc.getElementById('film')
    if (film) film.open = true
  })
  syncURL()

  return {
    open: id => openTemplate(id, { push: true }),
    close: closeTemplate,
    get isOpen() { return Boolean(current) },
    destroy() {
      if (destroyed) return
      destroyed = true
      hideDialog()
      intersection?.disconnect()
      for (const preview of [...previews]) preview.dispose()
      for (const dispose of disposers) dispose()
      dialog?.remove()
      grid.replaceChildren()
    },
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') mountMarketplace()
