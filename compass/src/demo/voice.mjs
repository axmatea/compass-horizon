// Browser-managed speech recognition. Browsers may use their own speech service.
// COMPASS receives submitted text; dictation never submits a prompt by default.

export const PAUSE_MS = 1000

export function recognitionCtor(win) {
  if (!win) return null
  return win.SpeechRecognition || win.webkitSpeechRecognition || null
}

export function joinSpeech(parts, max) {
  const text = []
  for (const part of parts) {
    const clean = String(part ?? '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim()
    if (clean) text.push(clean)
  }
  return text.join(' ').slice(0, max).trim()
}

export function pauseShouldSubmit({ text, manual, autoSubmit = false }) {
  return autoSubmit && !manual && String(text ?? '').trim().length > 0
}

export function defaultAnswers(questions) {
  return (questions || []).map(question => ({
    id: String(question?.id || ''),
    prompt: String(question?.prompt || ''),
    value: String(question?.options?.[0] || ''),
  })).filter(item => item.id && item.value)
}

export function voiceErrorMessage(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone access was denied. Type the idea instead.'
  if (code === 'audio-capture') return 'No microphone was found. Type the idea instead.'
  if (code === 'no-speech') return 'No speech was detected. Try the microphone again, or type the idea.'
  if (code === 'network') return 'The speech service could not connect. Keep editing the text, or try again.'
  if (code === 'start-failed') return 'Voice input could not start. Try again, or type the idea.'
  return 'Voice input stopped. Your text stays editable.'
}

export function createDictation(win, handlers, options = {}) {
  const Ctor = recognitionCtor(win)
  if (!Ctor) return null
  const pauseMs = options.pauseMs ?? PAUSE_MS
  const max = options.max ?? 500
  const lang = options.lang || 'en-US'
  const autoSubmit = options.autoSubmit === true
  let rec = null
  let active = false
  let settled = false
  let timer = null
  let latest = ''

  function clearPause() {
    if (timer) clearTimeout(timer)
    timer = null
  }
  function halt() {
    clearPause()
    const current = rec
    rec = null
    active = false
    try { current?.abort() } catch { /* the session already ended */ }
  }
  function finish(reason, code) {
    if (settled) return
    settled = true
    const text = latest
    halt()
    handlers.onState?.('idle')
    if (code) handlers.onError?.(voiceErrorMessage(code), code)
    handlers.onEnd?.(code ? 'error' : text.trim() ? reason : 'empty', text)
    if (!code && pauseShouldSubmit({ text, manual: reason === 'stopped', autoSubmit })) handlers.onSubmit?.(text)
  }
  function schedulePause() {
    clearPause()
    timer = setTimeout(() => finish('pause'), pauseMs)
  }
  function applyResults(results) {
    const finals = []
    const interims = []
    for (let i = 0; i < results.length; i++) {
      const row = results[i]
      const text = row?.[0]?.transcript || ''
      if (row?.isFinal) finals.push(text)
      else interims.push(text)
    }
    latest = joinSpeech([...finals, ...interims], max)
    handlers.onTranscript?.(latest, { final: interims.length === 0 })
    if (latest.length >= max) {
      finish('limit')
      return
    }
    if (interims.length) clearPause()
    else if (finals.length) schedulePause()
  }

  return {
    supported: true,
    get active() { return active },
    start() {
      if (active) return true
      settled = false
      latest = ''
      handlers.onState?.('starting')
      let session
      try { session = new Ctor() }
      catch { finish('error', 'start-failed'); return false }
      session.lang = lang
      session.continuous = true
      session.interimResults = true
      session.onstart = () => {
        if (rec !== session || settled) return
        handlers.onState?.('listening')
      }
      session.onresult = event => {
        if (rec !== session || settled) return
        applyResults(event?.results || [])
      }
      session.onspeechend = () => {
        if (rec !== session || settled) return
        if (latest.trim()) schedulePause()
      }
      session.onerror = event => {
        if (rec !== session || settled) return
        const code = event?.error || ''
        if (code === 'aborted') { finish('ended'); return }
        finish('error', code || 'unknown')
      }
      session.onend = () => {
        if (rec !== session) return
        rec = null
        active = false
        clearPause()
        if (settled) return
        finish('ended')
      }
      rec = session
      active = true
      try {
        session.start()
      } catch (error) {
        finish('error', error?.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed')
        return false
      }
      if (settled || rec !== session) return false
      return true
    },
    stop() {
      if (!active && !rec) return
      finish('stopped')
    },
  }
}
