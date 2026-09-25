/**
 * COMPASS agent UI state = pure function of the v1 event stream (+ local voice I/O).
 * No schema translation: patch ops, action statuses and intent are rendered as the backend sends them.
 * Events can arrive twice (an open turn stream also carries later turns' events), so they are deduplicated.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createListener, createSpeaker, isEcho, recognitionSupported } from './speech'
import type { Listener } from './speech'
import { createTransport } from './transport'
import type { TransportMode } from './transport'
import type { AgentEvent, Intent, OrbState, PatchOp, ToolOutput, Turn } from './types'
import { t } from './i18n'
import { bosonConfigured, loadBoson } from './bosonVoice'
import type { BosonClient, BosonStatus, VoiceSource } from './bosonVoice'

export interface ActionView {
  id: string
  tool: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'invalidated' | 'failed'
  changedFields?: string[]
  result?: ToolOutput
  mock?: boolean
  run: number
}
export interface PlanView { intent: Intent; patch: PatchOp[]; version: number; revision: boolean }
/** Website domain: the generated page as the backend rendered it. */
export interface RenderView { html: string; version: number; pending: string[]; highlight: string[]; placeholder: boolean; key: number; stage: string }
export interface AgentOptions {
  /** 'dinner' = /api/turn with recorded replay fallback; 'site' = /api/site/turn, live only. */
  domain?: 'dinner' | 'site'
}

const BUSY: OrbState[] = ['thinking', 'acting', 'speaking', 'replanning']
export const isBusy = (s: OrbState) => BUSY.includes(s)
const T = { interruptFlare: 460, replanHold: 1300, msPerWord: 330, holdMax: 4000 }
const eventKey = (e: AgentEvent) => [e.type, e.turnId, 'actionId' in e ? e.actionId : '', e.at, 'stage' in e ? e.stage : '', 'text' in e ? e.text : ''].join('|')

export function useCompassAgent({ domain = 'dinner' }: AgentOptions = {}) {
  const transport = useMemo(() => (domain === 'site' ? createTransport(undefined, { endpoint: '/api/site/turn', allowMock: false }) : createTransport()), [domain])
  const speaker = useMemo(() => createSpeaker(), [])

  const [plan, setPlan] = useState<PlanView | null>(null)
  const [render, setRender] = useState<RenderView | null>(null)
  const [actions, setActions] = useState<ActionView[]>([])
  const [thinking, setThinking] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [interrupted, setInterrupted] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [holding, setHolding] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [interim, setInterim] = useState('')
  const [caption, setCaption] = useState<{ text: string; key: number; msPerWord: number } | null>(null)
  const [servedBy, setServedBy] = useState<TransportMode | null>(null)
  const modeRef = useRef<TransportMode | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const [notice, setNotice] = useState('')
  const [micSupported, setMicSupported] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [revisions, setRevisions] = useState(0)
  const [voiceSource, setVoiceSource] = useState<VoiceSource | null>(null)
  const bosonOk = useRef(false)
  const bosonRef = useRef<BosonClient | null>(null)
  /** Resolves when a Boson connection attempt settles, so a turn typed meanwhile is never lost. */
  const bosonPending = useRef<Promise<boolean> | null>(null)

  const seen = useRef(new Set<string>())
  const sessionRef = useRef<string | undefined>(undefined)
  const sessionWaiters = useRef<((id: string) => void)[]>([])
  const inflight = useRef(0)
  const epoch = useRef(0)
  const speakingText = useRef<string | null>(null)
  const echoRef = useRef<string | null>(null)
  const echoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const simTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const voiceOnRef = useRef(true)
  const micOnRef = useRef(false)
  const orbRef = useRef<OrbState>('idle')
  const listenerRef = useRef<Listener | null>(null)
  const counter = useRef(0)
  const nextKey = () => ++counter.current
  const later = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); timers.current.push(t) }

  const hasRunning = actions.some(a => a.status === 'running')
  const orb: OrbState = interrupted ? 'interrupted' : replanning ? 'replanning' : speaking ? 'speaking' : thinking ? 'thinking' : hasRunning ? 'acting' : micOn ? 'listening' : interim ? 'listening' : 'idle'
  orbRef.current = orb

  useEffect(() => {
    setMicSupported(recognitionSupported())
    setVoiceSupported(speaker.supported())
    void transport.ready().then(async m => {
      modeRef.current = m; setServedBy(m)
      if (m === 'live' && await bosonConfigured()) { bosonOk.current = true; setMicSupported(true) }
    })
    return () => { speaker.stop(); listenerRef.current?.stop(); bosonRef.current?.stop(); timers.current.forEach(clearTimeout) }
  }, [speaker, transport])
  useEffect(() => { voiceOnRef.current = voiceOn; if (!voiceOn) speaker.stop() }, [voiceOn, speaker])

  /* ---------- voice out ---------- */
  const stopSpeech = useCallback((markCut: boolean) => {
    const was = speakingText.current
    speakingText.current = null
    if (simTimer.current) clearTimeout(simTimer.current)
    speaker.stop()
    setSpeaking(false); setCaption(null)
    if (markCut && was) setTurns(t => { const i = t.map(x => x.who === 'compass' && x.text === was).lastIndexOf(true); return i < 0 ? t : t.map((x, j) => (j === i ? { ...x, interrupted: true } : x)) })
  }, [speaker])

  const say = useCallback((text: string) => {
    if (bosonRef.current) { setCaption({ text, key: nextKey(), msPerWord: T.msPerWord }); return }
    stopSpeech(false)
    const myEpoch = epoch.current
    speakingText.current = text
    if (echoTimer.current) clearTimeout(echoTimer.current)
    echoRef.current = text
    setCaption({ text, key: nextKey(), msPerWord: T.msPerWord })
    setSpeaking(true)
    const finish = () => {
      if (speakingText.current !== text || epoch.current !== myEpoch) return
      speakingText.current = null; setSpeaking(false)
      echoTimer.current = setTimeout(() => { echoRef.current = null }, 1800)
    }
    if (voiceOnRef.current && speaker.supported()) speaker.speak(text, { onState: s => { if (s === 'ended' || s === 'unavailable') finish() } })
    else simTimer.current = setTimeout(finish, Math.max(1400, text.split(/\s+/).length * T.msPerWord))
  }, [speaker, stopSpeech])

  /* ---------- event reducer ---------- */
  const onEvent = useCallback((e: AgentEvent, myEpoch: number) => {
    if (myEpoch !== epoch.current) return
    const k = eventKey(e)
    if (seen.current.has(k)) return
    seen.current.add(k)
    if (!sessionRef.current && e.sessionId) { sessionRef.current = e.sessionId; sessionWaiters.current.splice(0).forEach(w => w(e.sessionId)) }
    switch (e.type) {
      case 'reasoning_status':
        if (e.stage === 'interpreting') setThinking(true)
        break
      case 'state_patch': {
        setThinking(false); setHolding(false)
        const revision = e.patch.some(op => op.status === 'kept') && e.patch.some(op => op.status === 'active')
        setPlan({ intent: e.intent, patch: e.patch, version: e.version, revision })
        if (revision) { setRevisions(n => n + 1); setReplanning(true); later(() => setReplanning(false), T.replanHold) }
        break
      }
      case 'action_invalidated':
        setActions(list => list.map(a => (a.id === e.actionId ? { ...a, status: 'invalidated', changedFields: e.changedFields } : a)))
        break
      case 'tool_call':
        setActions(list => [...list.filter(a => a.id !== e.actionId), { id: e.actionId, tool: e.tool, args: e.args, status: 'running' as const, mock: e.mock, run: nextKey() }].slice(-3))
        break
      case 'tool_result':
        setActions(list => list.map(a => (a.id === e.actionId ? { ...a, status: 'done', result: e.result } : a)))
        break
      case 'render':
        setRender({ html: e.html, version: e.version, pending: e.pending ?? [], highlight: e.highlight ?? [], placeholder: Boolean(e.placeholder), key: nextKey(), stage: e.stage })
        break
      case 'say':
        setTurns(t => [...t, { id: 'c' + nextKey(), who: 'compass', text: e.text }])
        say(e.text)
        break
      case 'error':
        setThinking(false)
        if (e.actionId) setActions(list => list.map(a => (a.id === e.actionId && a.status === 'running' ? { ...a, status: 'failed' } : a)))
        setNotice(e.message)
        break
      case 'done':
        break
    }
  }, [say])

  const waitSession = () => (sessionRef.current || !inflight.current ? Promise.resolve(sessionRef.current) : new Promise<string>(r => sessionWaiters.current.push(r)))

  const send = useCallback(async (text: string) => {
    const myEpoch = epoch.current
    setTurns(t => [...t, { id: 'u' + nextKey(), who: 'user', text }])
    setInterim('')
    setThinking(true)
    const sessionId = await waitSession()
    inflight.current++
    try {
      const res = await transport.send({ sessionId, text }, { onEvent: e => onEvent(e, myEpoch) })
      if (myEpoch !== epoch.current) return
      if (!sessionRef.current) sessionRef.current = res.sessionId
      setServedBy(res.servedBy)
      if (res.servedBy === 'mock' && modeRef.current === 'live') setNotice(t.notice.unreachable)
    } catch (err) {
      if (myEpoch === epoch.current && (err as Error).name !== 'AbortError') { setNotice(t.notice.failed); setThinking(false) }
    } finally {
      inflight.current--
      if (!inflight.current && !sessionRef.current) sessionWaiters.current.splice(0).forEach(w => w(undefined as unknown as string))
    }
  }, [onEvent, transport])

  /** Barge-in: cut speech now, flare, send the new words immediately (the backend supersedes stale work). */
  const flare = useCallback(() => {
    setInterrupted(true); setHolding(true)
    later(() => setInterrupted(false), T.interruptFlare)
    later(() => setHolding(false), T.holdMax)
  }, [])

  const interrupt = useCallback((text?: string) => {
    if (bosonRef.current) { flare(); return }
    stopSpeech(true)
    setInterrupted(true); setHolding(true)
    later(() => setInterrupted(false), T.interruptFlare)
    later(() => setHolding(false), T.holdMax)
    if (text) void send(text)
  }, [flare, send, stopSpeech])

  const submit = useCallback((text: string) => {
    const clean = text.trim()
    if (!clean) return
    setNotice('')
    if (bosonPending.current) { const p = bosonPending.current; setThinking(true); void p.then(() => submitRef.current(clean)); return }
    const boson = bosonRef.current
    if (boson && boson.mode === 'boson') { if (isBusy(orbRef.current)) flare(); setThinking(true); boson.sendText(clean); return }
    if (isBusy(orbRef.current)) interrupt(clean)
    else void send(clean)
  }, [flare, interrupt, send])

  const submitRef = useRef(submit)
  submitRef.current = submit

  const endMic = useCallback(() => { micOnRef.current = false; setMicOn(false); setInterim(''); setSpeaking(false) }, [])

  const onBosonStatus = useCallback((s: BosonStatus) => {
    setSpeaking(s === 'SPEAKING')
    if (s === 'THINKING') setThinking(true)
    if (s === 'SPEECH_DETECTED' && isBusy(orbRef.current)) flare()
    if (s === 'INTERRUPTED') {
      flare()
      setCaption(c => { if (c) setTurns(t => { const i = t.map(x => x.who === 'compass' && x.text === c.text).lastIndexOf(true); return i < 0 ? t : t.map((x, j) => (j === i ? { ...x, interrupted: true } : x)) }); return null })
    }
    if (s === 'REPLANNING') { setReplanning(true); later(() => setReplanning(false), T.replanHold) }
  }, [flare])

  function toggleMic() {
    if (micOnRef.current) {
      if (bosonRef.current) { bosonRef.current.stop(); bosonRef.current = null; setVoiceSource(null); endMic() }
      else listenerRef.current?.stop()
      return
    }
    if (bosonOk.current && !bosonRef.current) { void startBoson(); return }
    startBrowser()
  }

  const startBoson = async () => {
    micOnRef.current = true; setMicOn(true); setNotice('')
    const myEpoch = epoch.current
    let settle: (ok: boolean) => void = () => {}
    bosonPending.current = new Promise<boolean>(r => { settle = r })
    const client = await loadBoson({
      sessionId: sessionRef.current,
      domain,
      onStatus: s => { if (bosonRef.current === client) onBosonStatus(s) },
      onEvent: e => { if (bosonRef.current === client) onEvent(e, myEpoch) },
      onTranscript: tr => {
        if (bosonRef.current !== client || tr.role !== 'user' || !tr.text) return
        if (tr.source === 'higgs-stt') { setInterim(tr.text); return }
        setInterim(''); setTurns(t => [...t, { id: 'u' + nextKey(), who: 'user', text: tr.text }])
      },
      onError: e => { if (bosonRef.current === client && e.code === 'voice_closed') { bosonRef.current = null; setVoiceSource(null); endMic(); setNotice(t.notice.voiceClosed) } },
      onMode: () => {},
    })
    if (!client) { bosonPending.current = null; settle(false); bosonOk.current = false; endMic(); startBrowser(); return }
    bosonRef.current = client
    let mode: string = 'failed'
    try {
      mode = await Promise.race([client.start(), new Promise<string>(r => setTimeout(() => r('timeout'), 9000))])
    } catch { /* no mic or no recognition: handled below */ }
    bosonPending.current = null
    settle(mode === 'boson' && bosonRef.current === client)
    if (bosonRef.current !== client) return
    if (mode !== 'boson') {
      // The backend client falls back on its own; use ours instead (echo filter, recorded replay, i18n).
      client.stop(); bosonRef.current = null; bosonOk.current = false; endMic(); startBrowser(); return
    }
    if (!sessionRef.current && client.sessionId) sessionRef.current = client.sessionId
    setVoiceSource(client.provider ?? 'boson'); setServedBy('live'); setNotice(t.notice.listening)
  }

  function startBrowser() {
    const listener = createListener({
      onInterim: heard => {
        if (isEcho(heard, echoRef.current)) return
        if (isBusy(orbRef.current) && heard.split(/\s+/).length >= 2) { if (orbRef.current !== 'interrupted') interrupt() }
        setInterim(heard)
      },
      onFinal: heard => { if (isEcho(heard, echoRef.current)) { setInterim(''); return } submit(heard) },
      onError: msg => setNotice(msg),
      onEnd: () => { micOnRef.current = false; setMicOn(false); setInterim(''); setVoiceSource(null) },
    })
    listenerRef.current = listener
    if (listener.start()) { micOnRef.current = true; setMicOn(true); setVoiceSource('browser'); setNotice(t.notice.listening) }
    else setNotice(t.notice.noVoice)
  }

  const reset = useCallback(() => {
    epoch.current++
    stopSpeech(false)
    if (bosonRef.current) { bosonRef.current.stop(); bosonRef.current = null; setVoiceSource(null); endMic() }
    timers.current.forEach(clearTimeout); timers.current = []
    transport.reset()
    seen.current.clear(); sessionRef.current = undefined; sessionWaiters.current = []
    setPlan(null); setRender(null); setActions([]); setTurns([]); setInterim(''); setNotice(''); setRevisions(0)
    setThinking(false); setInterrupted(false); setReplanning(false); setHolding(false)
  }, [endMic, stopSpeech, transport])

  return {
    orb, plan, render, actions, holding, turns, interim, caption, servedBy, revisions, voiceSource,
    sessionId: sessionRef.current,
    micOn, micSupported, voiceOn, voiceSupported, notice,
    setVoiceOn, submit, interrupt, toggleMic, reset,
    hasPlan: Boolean(plan),
  }
}
