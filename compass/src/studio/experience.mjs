import { createStudio, beginTurn, closeTurn, applyEvent, applyResult, parseSse, cleanText } from '../site/studio.mjs'
import { completedRevision, appendRevision } from '../builder/project-store.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const MAX_RESPONSE = 2000000

// A thin client of the shared generation API. No model, storage or account
// implementation lives here; only completed, validated revisions enter history.
export function createStudioExperience({ fetchImpl = globalThis.fetch, onChange = () => {}, timeout = 45000 } = {}) {
  let engine = createStudio(), request = null, epoch = 0, resumeIntent = null
  const state = { busy:false, current:null, history:[], progress:null, error:'', retry:'', restored:false, prompt:'' }
  const notify = () => onChange(state)
  function ready() { return Boolean(state.current && !state.busy) }
  function cancel() {
    if (!request) return false
    epoch += 1
    request.abort(); request = null
    state.busy = false; state.progress = null
    state.error = state.current ? 'Update stopped. Your previous version is ready.' : 'Build stopped. Your idea is kept.'
    notify(); return true
  }
  async function submit(value, { preferences } = {}) {
    const text = cleanText(value)
    if (!text || state.busy) return { ok:false, error:'not_ready' }
    const mine = ++epoch, previous = clone(engine)
    const candidate = engine.sessionId ? clone(engine) : createStudio()
    beginTurn(candidate)
    const controller = new AbortController(); request = controller
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
    state.busy = true; state.error = ''; state.retry = text; state.progress = candidate
    notify()
    try {
      const payload = { text, ...(engine.sessionId ? {sessionId:engine.sessionId} : {}), ...(resumeIntent ? {resumeIntent} : {}), ...(!engine.sessionId && preferences ? {preferences} : {}) }
      const response = await fetchImpl('/api/site/turn', { method:'POST', headers:{'content-type':'application/json',accept:'text/event-stream'}, body:JSON.stringify(payload), signal:controller.signal })
      if (mine !== epoch) return {ok:false,error:'cancelled'}
      let result = null
      if (response.status === 429) {
        const data = await response.json()
        result = data.fallback || null
        if (!result) throw new Error('limit')
      } else if (!response.ok) throw new Error('request')
      else if ((response.headers.get('content-type') || '').includes('text/event-stream') && response.body) {
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let buffer = '', bytes = 0
        try {
          while (true) {
            const part = await reader.read()
            if (mine !== epoch) { await reader.cancel(); return {ok:false,error:'cancelled'} }
            if (part.done) break
            bytes += part.value.byteLength
            if (bytes > MAX_RESPONSE) throw new Error('too_large')
            const parsed = parseSse(buffer + decoder.decode(part.value,{stream:true})); buffer = parsed.rest
            for (const frame of parsed.frames) {
              if (frame.event === 'result') {
                if (result) throw new Error('duplicate_result')
                result = frame.data
              } else if (!result) applyEvent(candidate,frame.data)
            }
            notify()
          }
          if (buffer.trim()) throw new Error('incomplete')
        } finally { reader.releaseLock() }
      } else {
        const textBody = await response.text()
        if (textBody.length > MAX_RESPONSE) throw new Error('too_large')
        result = JSON.parse(textBody)
      }
      if (mine !== epoch) return {ok:false,error:'cancelled'}
      if (!result || typeof result.html !== 'string' || !result.intent || result.pending?.length) throw new Error('incomplete')
      // The final object is the authority. Intermediate renders explain actual
      // progress but never replace a complete preview or inherit its live badge.
      applyResult(candidate,result,{replay:true}); closeTurn(candidate)
      const revision = completedRevision({ ...candidate, busy:false },text)
      if (!revision) throw new Error('invalid_preview')
      engine = candidate; resumeIntent = null
      state.history = appendRevision(state.history,revision); state.current = state.history.at(-1)
      state.restored = false; state.prompt = text; state.retry = ''
      return {ok:true,revision:state.current}
    } catch (error) {
      if (mine !== epoch) return {ok:false,error:'cancelled'}
      controller.abort()
      engine = previous
      state.error = error.message === 'limit' ? 'Build limit reached. Try again shortly.' : timedOut ? 'This build took too long. Try again.' : 'Build interrupted. Try again.'
      if (state.current) state.error += ' Your previous version is ready.'
      return {ok:false,error:timedOut ? 'timeout' : error.message}
    } finally {
      clearTimeout(timer)
      if (mine === epoch) { request = null; state.busy = false; state.progress = null; notify() }
    }
  }
  function restore(id) {
    if (state.busy) return false
    const revision = state.history.find(item => item.id === id)
    if (!revision) return false
    state.current = clone(revision); state.error = ''; state.restored = true
    engine = createStudio(); resumeIntent = clone(revision.plan.intent)
    notify(); return true
  }
  function revisionsForSave() {
    if (!ready()) return null
    if (state.current.id === state.history.at(-1)?.id) return clone(state.history)
    const restored = completedRevision({ ...state.current, busy:false },'Restored revision ' + state.current.number)
    return clone(appendRevision(state.history,restored))
  }
  return { state, submit, cancel, restore, ready, revisionsForSave, destroy:cancel }
}

export function studioSource(state) {
  if (!state.current) return ''
  if (state.busy) return 'Previous version'
  if (state.restored) return 'Restored revision'
  return state.current.source === 'model' && !state.current.placeholder ? 'Live model' : 'Prepared copy'
}

export function studioFiles(state) {
  const current = state.progress?.plan || state.current?.plan
  if (!current?.intent) return []
  return [
    { name:'index.html', detail:state.busy ? 'Building' : 'Ready' },
    { name:'style', detail:[current.intent.theme,current.intent.font,current.intent.density].filter(Boolean).join(' · ') },
    ...(current.intent.sections || []).map(section => ({name:section,detail:'Section'})),
  ]
}
