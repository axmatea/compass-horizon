/**
 * Boson Higgs Realtime voice, served by the backend at /api/voice/client.js (no key in the browser:
 * audio goes browser <-> /api/voice/realtime <-> Boson). Primary voice when /api/health reports
 * boson.configured. Otherwise, or with ?voice=browser, the demo uses Web Speech (speech.ts).
 * The client is loaded at runtime from the backend, so static/mock builds never depend on it.
 */
import type { AgentEvent } from './types'

export type VoiceSource = 'gradium' | 'boson' | 'browser'
export type BosonStatus = 'LISTENING' | 'SPEECH_DETECTED' | 'THINKING' | 'ACTING' | 'SPEAKING' | 'INTERRUPTED' | 'REPLANNING' | 'IDLE'
export interface BosonTranscript { role: 'user' | 'assistant'; text: string; final?: boolean; source?: string }
export interface BosonCallbacks {
  sessionId?: string
  /** 'dinner' (default) or 'site': which COMPASS runtime the voice bridge talks to. */
  domain?: 'dinner' | 'site'
  onStatus: (s: BosonStatus) => void
  onEvent: (e: AgentEvent) => void
  onTranscript: (t: BosonTranscript) => void
  onError: (e: { code?: string; message?: string }) => void
  onMode: (m: VoiceSource) => void
}
export interface BosonClient {
  start(): Promise<VoiceSource>
  sendText(text: string): void
  stop(): void
  readonly mode: 'boson' | 'browser' | null
  /** Which realtime provider answered: 'gradium' | 'boson' | 'browser'. */
  readonly provider: VoiceSource | null
  readonly sessionId: string | null
}

export function voicePreference(): 'auto' | 'browser' {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('voice') : null
  return q === 'browser' ? 'browser' : 'auto'
}

export async function bosonConfigured(): Promise<boolean> {
  if (voicePreference() === 'browser') return false
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    if (!r.ok) return false
    const h = await r.json() as { voice?: { realtime?: boolean }; boson?: { configured?: boolean } }
    return Boolean(h.voice?.realtime ?? h.boson?.configured)
  } catch { return false }
}

type Factory = (opts: Record<string, unknown>) => BosonClient
export async function loadBoson(cb: BosonCallbacks): Promise<BosonClient | null> {
  try {
    const url = '/api/voice/client.js'
    const mod = await import(/* @vite-ignore */ url) as { createCompassVoice?: Factory }
    if (!mod.createCompassVoice) return null
    return mod.createCompassVoice({ ...cb, sessionId: cb.sessionId, domain: cb.domain ?? 'dinner', output: 'speakers' })
  } catch { return null }
}
