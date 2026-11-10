// Browser dictation for /demo.
// The listener shape comes from the pre-cleanup speech module (c5cb564 speech.ts):
// SpeechRecognition or webkitSpeechRecognition, interim results, no audio upload.
// Only the finished transcript is returned to the caller.

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

export function pauseShouldSubmit({ text, manual }) {
  return !manual && String(text ?? '').trim().length > 0
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
  return 'Voice input stopped. Type the idea instead.'
}

export function createDictation(win, handlers, options = {}) {
  const Ctor = recognitionCtor(win)
  if (!Ctor) return null
  const pauseMs = options.pauseMs ?? PAUSE_MS
  const max = options.max ?? 500
  const lang = options.lang || 'en-US'
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
  function finish(byUser) {
    if (settled) return
    settled = true
    const text = latest
    halt()
    handlers.onState?.('idle')
    if (byUser) return
    if (!pauseShouldSubmit({ text, manual: false })) {
      handlers.onEnd?.('empty')
      return
    }
    handlers.onSubmit?.(text)
  }
  function schedulePause() {
    clearPause()
    timer = setTimeout(() => finish(false), pauseMs)
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
    handlers.onTranscript?.(latest)
    if (latest.length >= max) {
      finish(false)
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
      const session = new Ctor()
      session.lang = lang
      session.continuous = true
      session.interimResults = true
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
        if (code === 'no-speech' || code === 'aborted') return
        settled = true
        latest = ''
        halt()
        handlers.onState?.('idle')
        handlers.onError?.(voiceErrorMessage(code))
      }
      session.onend = () => {
        if (rec !== session) return
        rec = null
        active = false
        clearPause()
        if (settled) return
        finish(false)
      }
      rec = session
      try {
        session.start()
      } catch {
        rec = null
        active = false
        return false
      }
      if (settled || rec !== session) return false
      active = true
      handlers.onState?.('listening')
      return true
    },
    stop() {
      if (!active && !rec) return
      finish(true)
    },
  }
}
