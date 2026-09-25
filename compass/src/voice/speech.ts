/**
 * Browser voice I/O.
 * Speaker keeps the existing voice adapter contract (src/presentation/voice-adapter.js):
 *   speak(text, { onState(state, detail) }), stop(), supported()
 *   states: preparing | speaking | ended | unavailable | stopped
 * A Boson/Higgs adapter can replace createSpeaker() without touching the UI.
 * Listener = continuous SpeechRecognition used for barge-in. No audio leaves the browser
 * except through the browser's own speech provider.
 */
export type SpeakState = 'preparing' | 'speaking' | 'ended' | 'unavailable' | 'stopped'
export interface Speaker {
  speak(text: string, opts?: { onState?: (state: SpeakState, detail?: string) => void }): void
  stop(): void
  supported(): boolean
}

export function createSpeaker(): Speaker {
  let token = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let callback: ((s: SpeakState, d?: string) => void) | null = null
  const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  function stop() {
    token++
    if (timer) clearTimeout(timer)
    timer = null
    if (supported()) window.speechSynthesis.cancel()
    const cb = callback; callback = null
    cb?.('stopped')
  }
  function speak(text: string, { onState = () => {} }: { onState?: (s: SpeakState, d?: string) => void } = {}) {
    stop()
    callback = onState
    const id = token
    if (!supported()) { callback('unavailable', 'Browser voice unavailable.'); callback = null; return }
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.02
    // English voice only for Latin-script text; otherwise let the browser pick a voice for the content.
    const latin = !/[^\u0000-\u024F\u2000-\u206F]/.test(text)
    if (latin) u.lang = 'en-US'
    const voices = latin ? window.speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang)) : []
    u.voice = voices.find(v => v.localService && /Samantha|Ava|Allison|Victoria|Serena|Karen|Moira|Fiona|Susan|Zira|Aria|Jenny/i.test(v.name)) || voices.find(v => v.localService) || voices[0] || null
    let started = false
    callback('preparing')
    const finish = (s: SpeakState, d?: string) => {
      if (id !== token) return
      if (timer) clearTimeout(timer)
      timer = null
      const cb = callback; callback = null
      cb?.(s, d)
    }
    u.onstart = () => { if (id !== token) return; started = true; if (timer) clearTimeout(timer); callback?.('speaking') }
    u.onend = () => finish('ended')
    u.onerror = () => finish('unavailable', 'Browser voice could not play.')
    timer = setTimeout(() => { if (id !== token || started) return; token++; window.speechSynthesis.cancel(); const cb = callback; callback = null; cb?.('unavailable', 'Browser voice did not start.') }, 4000)
    try { window.speechSynthesis.speak(u) } catch { finish('unavailable', 'Browser voice unavailable.') }
  }
  return Object.freeze({ speak, stop, supported })
}

/* ---------------- Listener ---------------- */

interface RecAlt { transcript: string }
interface RecResult { isFinal: boolean; length: number; [i: number]: RecAlt }
interface RecEvent { resultIndex: number; results: { length: number; [i: number]: RecResult } }
interface BrowserRecognition {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: RecEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onspeechstart?: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type RecCtor = new () => BrowserRecognition
type SpeechWindow = Window & { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }

export interface ListenerHandlers {
  onInterim(text: string): void
  onFinal(text: string): void
  onError(message: string): void
  onEnd(): void
}
export interface Listener { start(): boolean; stop(): void; readonly active: boolean }

export const recognitionSupported = () => typeof window !== 'undefined' && Boolean((window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition)

/** Continuous listener. Chrome ends sessions after silence; we restart while `wanted` is true. */
export function createListener(h: ListenerHandlers, lang = 'en-US'): Listener {
  let rec: BrowserRecognition | null = null
  let wanted = false
  let restarts = 0
  function spawn(): boolean {
    const w = window as SpeechWindow
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) return false
    const r = new Ctor()
    r.lang = lang; r.continuous = true; r.interimResults = true
    r.onresult = e => {
      if (rec !== r) return
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = res[0].transcript.trim()
        if (!text) continue
        if (res.isFinal) h.onFinal(text)
        else interim += (interim ? ' ' : '') + text
      }
      if (interim) h.onInterim(interim)
    }
    r.onerror = e => {
      if (rec !== r) return
      if (e.error === 'no-speech' || e.error === 'aborted') return
      wanted = false
      h.onError(e.error === 'not-allowed' ? 'Microphone access was not granted. Type instead, or use the prepared lines.' : 'Voice input stopped (' + e.error + '). Type instead, or tap the mic again.')
    }
    r.onend = () => {
      if (rec !== r) return
      if (wanted && restarts < 50) { restarts++; try { r.start(); return } catch { /* fall through */ } }
      rec = null; wanted = false; h.onEnd()
    }
    rec = r
    try { r.start(); return true } catch { rec = null; return false }
  }
  return {
    start() { if (rec) return true; wanted = true; restarts = 0; return spawn() },
    stop() { wanted = false; const r = rec; rec = null; r?.abort(); h.onEnd() },
    get active() { return rec !== null },
  }
}

/** Echo guard: a mic without headphones hears COMPASS itself. Ignore speech that mostly repeats what is being spoken. */
export function isEcho(heard: string, speaking: string | null): boolean {
  if (!speaking) return false
  const words = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}: ]+/gu, ' ').split(/\s+/).filter(Boolean)
  const h = words(heard); if (!h.length) return true
  const said = new Set(words(speaking))
  const overlap = h.filter(w => said.has(w)).length / h.length
  return overlap >= 0.6
}
