/**
 * COMPASS /api/turn contract v1 (COMPASS_MASTER §15, frozen 2026-09-18; backend implementation wins).
 * Mirrors feat/agent-core server/state/intent.mjs + server/agent/runtime.mjs. No frontend-only schema.
 * The website domain (/api/site/turn) uses the same contract with a different field set
 * (server/state/site.mjs) plus `render` events carrying the generated page.
 *
 *   POST /api/turn {sessionId?, text}
 *     Accept: application/json  -> TurnResponse
 *     Accept: text/event-stream -> one SSE event per AgentEvent, then `event: result` (TurnResponse without events)
 */

export type OrbState = 'idle' | 'listening' | 'thinking' | 'acting' | 'speaking' | 'interrupted' | 'replanning'

export type DinnerField = 'task' | 'date' | 'time' | 'location' | 'cuisine' | 'party_size'
export type SiteField = 'business' | 'kind' | 'audience' | 'tone' | 'theme' | 'accent' | 'font' | 'hero' | 'sections' | 'headline' | 'subhead' | 'cta' | 'lang'
export type FieldName = DinnerField | SiteField
export type FieldValue = string | number | string[] | null
/** intent.time is 24h "HH:MM". Formatting happens only at render. */
export type Intent = Record<string, FieldValue>

export interface PatchOp {
  field: FieldName
  from: FieldValue
  to: FieldValue
  status: 'active' | 'kept'
  change?: 'added' | 'updated' | 'removed'
  /** sections op only */
  added?: string[]
  removed?: string[]
}

export type StateStatus = 'idle' | 'thinking' | 'acting' | 'ready' | 'error'
export type ActionStatus = 'pending' | 'running' | 'done' | 'invalidated' | 'failed'

export interface RestaurantResult { name: string; area: string | null; availableAt: FieldValue; distanceKm: number }
export interface SearchResult { mock?: boolean; query: Record<string, FieldValue>; results: RestaurantResult[] }
/** write_copy result: sections written this run, sections reused from the previous run, placeholder flag. */
export interface CopyResult { wrote?: string[]; reused?: string[]; fallback?: boolean; latencyMs?: number; [section: string]: unknown }
export type ToolOutput = SearchResult | CopyResult

export interface Action {
  id: string
  tool: string
  args: Record<string, FieldValue>
  dependsOn: string[]
  status: ActionStatus
  basedOnVersion: number
  turnId?: string
  result?: ToolOutput
  error?: string
  invalidatedBy?: { version: number; fields: string[] }
}

export interface HistoryEntry { version: number; turnId: string; text: string; patch: PatchOp[] }

export interface AgentState {
  sessionId: string
  version: number
  status: StateStatus
  intent: Intent
  actions: Action[]
  history: HistoryEntry[]
  updatedAt: string
}

export interface ToolResult { actionId: string; tool: string; mock: boolean; result: ToolOutput }

interface EventBase { sessionId: string; version: number; at: string; turnId?: string }
export type AgentEvent = EventBase & (
  | { type: 'reasoning_status'; stage: 'interpreting' | 'waiting_for_fields' | 'reusing_action' | 'superseded' | string; text?: string; tool?: string; missing?: string[]; actionId?: string }
  | { type: 'state_patch'; patch: PatchOp[]; changed: string[]; rejected: unknown[]; intent: Intent; latencyMs?: number }
  | { type: 'action_invalidated'; actionId: string; tool: string; previousStatus: ActionStatus; changedFields: string[]; reason: string }
  | { type: 'tool_call'; actionId: string; tool: string; args: Record<string, FieldValue>; mock?: boolean }
  | { type: 'tool_result'; actionId: string; tool: string; result: ToolOutput; mock?: boolean }
  | { type: 'render'; stage: string; html: string; pending: string[]; highlight: string[]; placeholder?: boolean }
  | { type: 'say'; text: string; final: boolean }
  | { type: 'done'; superseded?: boolean }
  | { type: 'error'; code: string; message: string; actionId?: string; tool?: string }
)

export interface TurnRequest { sessionId?: string; text: string }
export interface TurnResponse {
  sessionId: string
  turnId: string
  state: AgentState
  patch: PatchOp[]
  reply: string | null
  toolResult: ToolResult | null
  superseded?: boolean
  events?: AgentEvent[]
  error?: string
}

export interface Turn { id: string; who: 'user' | 'compass'; text: string; interrupted?: boolean }
