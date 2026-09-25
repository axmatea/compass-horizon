/**
 * Turn transport. Identical contract (v1) for both modes; the UI never branches on mode.
 *   live: POST <endpoint> with Accept: text/event-stream on the same origin. Keys stay server-side.
 *   mock: replay of the recorded backend session (mockBackend.ts), dinner domain only.
 * Default (auto): live when GET /api/health reports the model configured, otherwise mock.
 * Override: ?backend=live|mock in the URL, or VITE_COMPASS_BACKEND at build time.
 * VITE_COMPASS_API_URL overrides the endpoint (default /api/turn).
 * If live is unreachable (network error or non-2xx before any event), the turn falls back to mock and is flagged,
 * unless the transport was created with allowMock:false (website domain has no recording): the error surfaces.
 */
import { mockTurn, resetMockSession } from './mockBackend'
import type { AgentEvent, TurnRequest, TurnResponse } from './types'

export type TransportMode = 'mock' | 'live'
export interface SendOptions { onEvent: (e: AgentEvent) => void; signal?: AbortSignal }
export interface TurnTransport {
  /** Resolved mode (auto-detected once). */
  ready(): Promise<TransportMode>
  send(req: TurnRequest, opts: SendOptions): Promise<TurnResponse & { servedBy: TransportMode }>
  reset(): void
}
export interface TransportOptions { endpoint?: string; allowMock?: boolean }

type ViteEnv = { env?: Record<string, string | undefined> }
const env = (import.meta as ImportMeta & ViteEnv).env ?? {}

export function requestedMode(): TransportMode | 'auto' {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('backend') : null
  const v = (q ?? env.VITE_COMPASS_BACKEND ?? 'auto').toLowerCase()
  return v === 'live' ? 'live' : v === 'mock' ? 'mock' : 'auto'
}

async function detect(): Promise<TransportMode> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    if (!r.ok) return 'mock'
    const h = await r.json() as { ok?: boolean; llm?: { configured?: boolean }; nebius?: { configured?: boolean } }
    return h.ok && (h.llm?.configured ?? h.nebius?.configured) ? 'live' : 'mock'
  } catch { return 'mock' }
}

export class Unreachable extends Error {}

async function sse(endpoint: string, req: TurnRequest, { onEvent, signal }: SendOptions): Promise<TurnResponse> {
  let res: Response
  try {
    res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(req), signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new Unreachable((err as Error).message)
  }
  if (!res.ok || !res.body || !/event-stream/.test(res.headers.get('content-type') ?? '')) throw new Unreachable('HTTP ' + res.status)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: TurnResponse | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, sep); buf = buf.slice(sep + 2)
      let type = 'message'; const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (!data.length) continue
      const payload = JSON.parse(data.join('\n'))
      if (type === 'result') result = payload as TurnResponse
      else onEvent(payload as AgentEvent)
    }
  }
  if (!result) throw new Error('Stream ended without result')
  return result
}

export function createTransport(requested: TransportMode | 'auto' = requestedMode(), { endpoint = env.VITE_COMPASS_API_URL ?? '/api/turn', allowMock = true }: TransportOptions = {}): TurnTransport {
  let resolved: Promise<TransportMode> | null = null
  const ready = () => (resolved ??= requested === 'auto' ? detect() : Promise.resolve(allowMock ? requested : 'live'))
  return {
    ready,
    async send(req, opts) {
      const mode = await ready()
      if (mode === 'mock' && allowMock) return { ...(await mockTurn(req, opts.onEvent, opts.signal)), servedBy: 'mock' }
      try {
        return { ...(await sse(endpoint, req, opts)), servedBy: 'live' }
      } catch (err) {
        if (!(err instanceof Unreachable) || !allowMock) throw err
        console.warn('[compass] /api/turn unreachable, using recorded mock:', err.message)
        return { ...(await mockTurn(req, opts.onEvent, opts.signal)), servedBy: 'mock' }
      }
    },
    reset() { resetMockSession() },
  }
}
