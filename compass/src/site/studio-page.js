import { createStudioExperience, studioSource, studioFiles } from '../studio/experience.mjs'
import { buildSteps, previewDoc } from './studio.mjs'
import { createProjectStore } from '../builder/project-store.mjs'
import { previewDownload } from './preview-tools.mjs'

const byId = id => document.getElementById(id)
const prompt = byId('studio-prompt'), instruction = byId('studio-instruction')
const buildButton = byId('studio-build'), updateButton = byId('studio-update')
const message = byId('studio-message'), retryButton = byId('studio-retry'), cancelButton = byId('studio-cancel')
const preview = byId('studio-frame'), surface = byId('studio-surface'), empty = byId('studio-empty')
const progress = byId('studio-progress'), files = byId('studio-files'), history = byId('studio-history')
const restoreButton = byId('studio-restore'), continueButton = byId('studio-continue'), downloadButton = byId('studio-download')
const exportStatus = byId('studio-export-status'), experience = byId('experience')
const design = [...document.querySelectorAll('[data-design-command]')]
const viewportButtons = [...document.querySelectorAll('[data-studio-viewport]')]
const sceneLinks = [...document.querySelectorAll('[data-scene-link]')]
const scenes = [...document.querySelectorAll('[data-scene]')]
const projectStore = createProjectStore()
let lastHtml = '', historyKey = '', savedProjectId = null, viewport = 'desktop'
const directionValues = { 'studio-accent':{sky:'Make it blue',emerald:'Make it green',violet:'Make it purple',rose:'Make it pink',slate:'Make it gray'}, 'studio-type':{sans:'Use sans font',serif:'Use serif font',display:'Use display font'}, 'studio-spacing':{airy:'Make it airy',compact:'Make it compact'}, 'studio-theme':{light:'Make it lighter',dark:'Make it darker'} }
const directionFields = {'studio-accent':'accent','studio-type':'font','studio-spacing':'density','studio-theme':'theme'}

function layoutPreview() {
  if (preview.hidden) return
  const width = {desktop:1280,tablet:820,mobile:390}[viewport]
  const available = Math.max(1,surface.clientWidth - (viewport === 'mobile' ? 24 : 0))
  const scale = Math.min(1,available / width)
  preview.style.width = width + 'px'
  preview.style.height = Math.ceil(surface.clientHeight / scale) + 'px'
  preview.style.transform = 'scale(' + scale + ')'
  preview.style.transformOrigin = 'top left'
  preview.style.position = 'absolute'
  preview.style.left = Math.max(0,(surface.clientWidth - width * scale) / 2) + 'px'
}
function currentScene(name) {
  if (!scenes.some(scene => scene.dataset.scene === name)) return
  experience.dataset.activeScene = name
  for (const link of sceneLinks) {
    if (link.dataset.sceneLink === name) link.setAttribute('aria-current','step')
    else link.removeAttribute('aria-current')
  }
}
function paint(state) {
  const ready = Boolean(state.current), idle = !state.busy
  buildButton.disabled = state.busy || !prompt.value.trim()
  buildButton.textContent = state.busy ? 'Building…' : ready ? 'Update this idea ↗' : 'Build this idea ↗'
  updateButton.disabled = !ready || state.busy || !instruction.value.trim()
  instruction.disabled = !ready || state.busy
  prompt.disabled = state.busy
  cancelButton.hidden = !state.busy
  restoreButton.disabled = !ready || state.busy || !history.value || history.value === state.current?.id
  history.disabled = !ready || state.busy
  continueButton.disabled = downloadButton.disabled = !ready || state.busy
  for (const select of design) {
    select.disabled = !ready || state.busy
    select.value = directionValues[select.id]?.[state.current?.plan.intent[directionFields[select.id]]] || ''
  }
  surface.setAttribute('aria-busy',String(state.busy))
  byId('studio-building').hidden = !state.busy
  byId('studio-building-label').textContent = state.progress?.phase === 'thinking' ? 'Understanding your idea' : 'Shaping your page'
  message.textContent = state.error
  message.dataset.error = String(Boolean(state.error))
  message.setAttribute('role',state.error ? 'alert' : 'status')
  retryButton.hidden = !state.error || !state.retry || state.busy
  const steps = state.progress ? buildSteps(state.progress) : ready ? [{text:'Brief captured',status:'done'},{text:'Website rendered',status:'done'},{text:'Revision ' + state.current.number + ' ready',status:'done'}] : [{text:'Waiting for your idea.',status:''}]
  progress.replaceChildren(...steps.map(step => { const li = document.createElement('li');li.textContent = step.text;li.dataset.state = step.status;return li }))
  if (state.current?.render.html && state.current.render.html !== lastHtml) {
    lastHtml = state.current.render.html
    preview.srcdoc = previewDoc(lastHtml)
    preview.hidden = false; empty.hidden = true
    layoutPreview()
  }
  byId('studio-project-name').textContent = state.current?.plan.intent.business || state.current?.plan.intent.kind || 'Your project'
  byId('studio-source').textContent = studioSource(state) || 'Website canvas'
  byId('studio-version').textContent = ready ? 'v' + state.current.number : ''
  const structure = studioFiles(state)
  byId('structure-heading').textContent = structure.length ? 'One self-contained HTML file' : 'Your project takes shape here.'
  files.replaceChildren(...structure.map(file => { const li = document.createElement('li'),name = document.createElement('span'),detail = document.createElement('span');name.textContent = file.name;detail.textContent = file.detail;li.append(name,detail);return li }))
  const key = state.history.map(item => item.id).join(',')
  if (key !== historyKey) {
    historyKey = key
    history.replaceChildren(...[...state.history].reverse().map(item => { const option = document.createElement('option');option.value = item.id;option.textContent = 'v' + item.number + ' · ' + item.prompt.slice(0,52);return option }))
    if (state.current) history.value = state.current.id
  }
  restoreButton.disabled = !ready || state.busy || !history.value || history.value === state.current?.id
  byId('studio-history-note').textContent = state.restored ? 'Restored. Your next change continues from here.' : ready ? state.history.length + (state.history.length === 1 ? ' revision in this session.' : ' revisions in this session.') : 'Your earlier versions stay close.'
}
const studio = createStudioExperience({onChange:paint})
function goTo(name) {
  currentScene(name)
  const target = name === 'creation' && window.matchMedia('(max-width:800px)').matches ? byId('studio-canvas') : byId(name)
  target?.scrollIntoView({behavior:document.documentElement.dataset.studioMotion === 'off' ? 'instant' : 'smooth',block:'start'})
}
async function build(text, options) {
  exportStatus.textContent = ''
  const first=!studio.state.current
  const result = await studio.submit(text,options)
  if (result.ok) {instruction.value = '';if(first || window.matchMedia('(max-width:800px)').matches)goTo('creation')}
  paint(studio.state)
  return result
}
byId('studio-build-form').addEventListener('submit',event => {
  event.preventDefault()
  if (studio.state.busy || !prompt.value.trim()) return
  goTo('intelligence'); void build(prompt.value)
})
byId('studio-refine-form').addEventListener('submit',event => {event.preventDefault();if (studio.ready()) void build(instruction.value)})
for (const select of design) select.addEventListener('change',() => {if (studio.ready() && select.value) void build(select.value)})
prompt.addEventListener('input',() => {byId('studio-prompt-count').textContent = prompt.value.length > 400 ? prompt.value.length + '/500' : '';paint(studio.state)})
instruction.addEventListener('input',() => paint(studio.state))
cancelButton.addEventListener('click',() => studio.cancel())
retryButton.addEventListener('click',() => {if (studio.state.retry) void build(studio.state.retry)})
history.addEventListener('change',() => {restoreButton.disabled = !studio.ready() || history.value === studio.state.current?.id})
restoreButton.addEventListener('click',() => studio.restore(history.value))
for (const button of viewportButtons) button.addEventListener('click',() => {
  viewport = button.dataset.studioViewport; surface.dataset.viewport = viewport
  for (const item of viewportButtons) item.setAttribute('aria-pressed',String(item === button))
  layoutPreview()
})
for (const link of sceneLinks) link.addEventListener('click',event => {event.preventDefault();goTo(link.dataset.sceneLink)})
document.addEventListener('keydown',event => {
  if (event.key === 'Escape' && studio.state.busy) {event.preventDefault();studio.cancel()}
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing && [prompt,instruction].includes(event.target)) {event.preventDefault();event.target.form.requestSubmit()}
})
continueButton.addEventListener('click',() => {
  const revisions = studio.revisionsForSave()
  if (!revisions) return
  const intent = studio.state.current.plan.intent
  const result = projectStore.save({projectId:savedProjectId,name:(intent.business || intent.kind || 'Studio project').slice(0,64),revisions})
  if (!result.ok) {
    exportStatus.textContent = ['full','quota'].includes(result.error) ? 'Device storage is full. Download HTML or manage saved projects in Builder.' : 'Device save is unavailable. Your preview is kept; you can download HTML.'
    return
  }
  savedProjectId = result.project.id
  location.assign('/demo?project=' + encodeURIComponent(savedProjectId))
})
downloadButton.addEventListener('click',() => {
  if (!studio.ready()) return
  const file = previewDownload(studio.state.current.plan,studio.state.current.render)
  if (!file) return
  try {
    const url = URL.createObjectURL(new Blob([file.html],{type:file.type})),link = document.createElement('a')
    link.href = url;link.download = file.filename;link.hidden = true;document.body.append(link);link.click();link.remove()
    setTimeout(() => URL.revokeObjectURL(url),1500)
    exportStatus.textContent = 'HTML download started. Nothing was published.'
  } catch {exportStatus.textContent = 'Download could not start. Open this project in Builder to export it.'}
})
const reducedMotion = window.matchMedia('(prefers-reduced-motion:reduce)'), slowDisplay = window.matchMedia('(update:slow)')
function motionPreference() {document.documentElement.dataset.studioMotion = reducedMotion.matches || slowDisplay.matches || navigator.connection?.saveData || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2) ? 'off' : 'on'}
motionPreference();reducedMotion.addEventListener?.('change',motionPreference);slowDisplay.addEventListener?.('change',motionPreference)
let sceneObserver, sizeObserver
function observe() {
  if ('IntersectionObserver' in window) {
    sceneObserver?.disconnect()
    sceneObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)
      if (visible[0]) currentScene(visible[0].target.dataset.scene)
    },{rootMargin:'-18% 0px -25% 0px',threshold:[0,.15,.35,.6]})
    for (const scene of scenes) sceneObserver.observe(scene)
  }
  if ('ResizeObserver' in window) {sizeObserver?.disconnect();sizeObserver = new ResizeObserver(layoutPreview);sizeObserver.observe(surface)}
}
observe();window.addEventListener('resize',layoutPreview)
window.addEventListener('pagehide',() => {studio.destroy();sceneObserver?.disconnect();sizeObserver?.disconnect()})
window.addEventListener('pageshow',event => {if (event.persisted) {observe();layoutPreview()}})
paint(studio.state)

import { visibleTeam } from './team.mjs'
import { studioTeam } from './studio-content.mjs'
import { visibleTestimonials } from './testimonials.mjs'

const people = document.querySelector('#studio-people')
const members = visibleTeam(studioTeam)
if (people && members.length) {
  people.replaceChildren(...members.map(person => {
    const article = document.createElement('article')
    article.className = 'person'
    const avatar = document.createElement('div')
    avatar.className = 'person-avatar'
    avatar.setAttribute('aria-hidden', 'true')
    if (person.photo) {
      const img = document.createElement('img')
      img.src = person.photo
      img.alt = ''
      img.width = 72
      img.height = 72
      img.loading = 'lazy'
      img.decoding = 'async'
      avatar.append(img)
    } else {
      avatar.textContent = person.initials || '?'
    }
    const name = document.createElement('h3')
    name.textContent = person.name
    article.append(avatar, name)
    if (person.role) {
      const role = document.createElement('p')
      role.className = 'person-role'
      role.textContent = person.role
      article.append(role)
    }
    if (person.bio) {
      const bio = document.createElement('p')
      bio.textContent = person.bio
      article.append(bio)
    }
    return article
  }))
  people.hidden = false
}

const section = document.querySelector('#studio-voices')
const quotes = document.querySelector('#studio-quotes')
const statements = visibleTestimonials()
if (section && quotes && statements.length) {
  quotes.replaceChildren(...statements.map(statement => {
    const figure = document.createElement('figure')
    figure.className = 'voice-quote'
    const quote = document.createElement('blockquote')
    quote.textContent = statement.quote
    const attribution = document.createElement('figcaption')
    const name = document.createElement('strong')
    name.textContent = statement.name
    attribution.append(name)
    if (statement.role) attribution.append(document.createTextNode(' · ' + statement.role))
    const source = document.createElement('a')
    source.href = statement.sourceUrl
    source.rel = 'noopener noreferrer'
    source.textContent = 'Read the source ↗'
    figure.append(quote, attribution, source)
    return figure
  }))
  section.hidden = false
}
