/**
 * Mock /api/turn = verbatim replay of the backend's recorded live session
 * (feat/agent-core test/fixtures/dinner-turns.json, copied byte-identical).
 * Events are re-emitted on the recorded timeline, session-wide, exactly like the real
 * runtime (an open turn stream also receives later turns' events). No parsing, no
 * invented state. Anything off-script gets an explicit v1 `error` event saying so.
 */
import fixture from './fixtures/dinner-turns.json'
import type { AgentEvent, TurnRequest, TurnResponse } from './types'

type RecordedTurn = { request: TurnRequest; sentAtMs: number; response: TurnResponse }
const TURNS = (fixture as unknown as { turns: RecordedTurn[] }).turns
const at = (e: AgentEvent) => Date.parse(e.at)
const T0 = at(TURNS[0].response.events![0])
const keyOf = (e: AgentEvent) => [e.type, e.turnId, 'actionId' in e ? e.actionId : '', e.at, 'stage' in e ? e.stage : '', 'text' in e ? e.text : ''].join('|')
/** Recorded session timeline, deduplicated (each turn stream holds a copy of shared events). */
const TIMELINE: AgentEvent[] = (() => {
  const seen = new Set<string>(); const out: AgentEvent[] = []
  for (const t of TURNS) for (const e of t.response.events ?? []) { const k = keyOf(e); if (!seen.has(k)) { seen.add(k); out.push(e) } }
  return out.sort((a, b) => at(a) - at(b))
})()

const words = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean)
function matchTurn(text: string): number {
  const heard = new Set(words(text))
  return TURNS.findIndex(t => { const w = words(t.request.text); return w.filter(x => heard.has(x)).length / w.length >= 0.6 })
}
const MOCK_LIMIT_MS = 9000
const MOCK_NOTE = 'Mock mode replays one recorded live session. Interrupt with: "Actually make it 8. Somewhere near Palo Alto." Use ?backend=live for open conversation.'

type Listener = (e: AgentEvent) => void
interface MockSession {
  listeners: Set<Listener>
  timers: ReturnType<typeof setTimeout>[]
  next: number              // next fixture turn index expected
  pending: Map<number, (r: TurnResponse) => void>
  cursor: number            // TIMELINE index up to which events were scheduled
  lastFireAt: number        // wall clock of the latest scheduled event
}
const sessions = new Map<string, MockSession>()
const SESSION_ID = TURNS[0].response.sessionId

function session(): MockSession {
  let s = sessions.get(SESSION_ID)
  if (!s) { s = { listeners: new Set(), timers: [], next: 0, pending: new Map(), cursor: 0, lastFireAt: 0 }; sessions.set(SESSION_ID, s) }
  return s
}

function emit(s: MockSession, e: AgentEvent) { for (const l of [...s.listeners]) l(e) }

/** Play recorded events while `until` holds; recorded time `base` maps to wall clock `startAt`. */
function schedule(s: MockSession, until: (e: AgentEvent) => boolean, base: number, startAt = Date.now()) {
  while (s.cursor < TIMELINE.length && until(TIMELINE[s.cursor])) {
    const e = TIMELINE[s.cursor++]
    const fireAt = startAt + Math.max(0, at(e) - base)
    s.lastFireAt = Math.max(s.lastFireAt, fireAt)
    s.timers.push(setTimeout(() => {
      emit(s, e)
      if (e.type === 'done') {
        const idx = TURNS.findIndex(t => t.response.turnId === e.turnId)
        s.pending.get(idx)?.(TURNS[idx].response); s.pending.delete(idx)
      }
    }, Math.max(0, fireAt - Date.now())))
  }
}

function offScript(s: MockSession, text: string, sessionId: string): Promise<TurnResponse> {
  const turnId = 't_mock_' + Math.random().toString(36).slice(2, 8)
  const state = TURNS[Math.max(0, s.next - 1)].response.state
  const base = { sessionId, version: state.version, at: new Date().toISOString(), turnId }
  const events: AgentEvent[] = [
    { ...base, type: 'error', code: 'mock_off_script', message: MOCK_NOTE },
    { ...base, type: 'done', superseded: false },
  ]
  return new Promise(resolve => setTimeout(() => {
    events.forEach(e => emit(s, e))
    resolve({ sessionId, turnId, state, patch: [], reply: null, toolResult: null, superseded: false, events, error: 'mock_off_script' })
  }, 250))
  void text
}

export function mockTurn(req: TurnRequest, onEvent: Listener, signal?: AbortSignal): Promise<TurnResponse> {
  const s = session()
  s.listeners.add(onEvent)
  const cleanup = () => s.listeners.delete(onEvent)
  signal?.addEventListener('abort', cleanup, { once: true })
  const idx = matchTurn(req.text)
  let p: Promise<TurnResponse>
  if (idx !== s.next) p = offScript(s, req.text, SESSION_ID)
  else {
    s.next++
    p = new Promise<TurnResponse>(resolve => s.pending.set(idx, resolve))
    if (idx === 0) {
      // Turn 1 alone: its own events recorded before turn 2 arrived.
      const t1 = TURNS[0].response.turnId
      schedule(s, e => e.turnId === t1 && at(e) < T0 + TURNS[1].sentAtMs, T0)
      s.timers.push(setTimeout(() => {
        if (s.next !== 1) return
        const a = TIMELINE.find(e => e.type === 'tool_call')!
        const base = { sessionId: SESSION_ID, version: a.version, at: new Date().toISOString(), turnId: a.turnId }
        const stop: AgentEvent[] = [
          { ...base, type: 'error', code: 'mock_replay_limit', message: MOCK_NOTE, actionId: (a as { actionId: string }).actionId },
          { ...base, type: 'done', superseded: false },
        ]
        stop.forEach(e => emit(s, e))
        s.next = TURNS.length
        s.pending.get(0)?.({ ...TURNS[0].response, reply: null, superseded: false, events: stop, error: 'mock_replay_limit' }); s.pending.delete(0)
      }, MOCK_LIMIT_MS))
    } else {
      // Later turns: recorded send time maps to now. Like the real runtime (interpretation is
      // serialized per session), nothing of this turn may precede the previous turn's queued events.
      const first = TIMELINE[s.cursor]
      if (first) schedule(s, () => true, at(first), Math.max(Date.now(), s.lastFireAt + 1))
    }
  }
  return p.finally(cleanup)
}

export function resetMockSession() {
  const s = sessions.get(SESSION_ID)
  if (s) { s.timers.forEach(clearTimeout); s.listeners.clear(); s.pending.clear() }
  sessions.delete(SESSION_ID)
}
