import type { Command, RunOptions, RuntimeEvent, Snapshot, Transport, TransportUpdate } from './types.ts';

type Check = (value: unknown) => boolean;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const presets = ['sarah-leave', 'deadline-shift', 'dependency-delay'];
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const string: Check = (v) => typeof v === 'string' && v.length > 0 && v.length <= 8192;
const id: Check = (v) => typeof v === 'string' && ID.test(v);
const integer: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const day: Check = (v) => integer(v) && (v as number) <= 60;
const calendarDay: Check = (v) => integer(v) && (v as number) <= 365;
const one = (...values: unknown[]): Check => (v) => values.includes(v);
const optional = (check: Check): Check => (v) => v === undefined || check(v);
const nullable = (check: Check): Check => (v) => v === null || check(v);
const list = (check: Check, max = 2000): Check => (v) => Array.isArray(v) && v.length <= max && v.every(check);
const shape = (fields: Record<string, Check>): Check => (v) => record(v) && Object.keys(v).every((key) => Object.hasOwn(fields, key)) && Object.entries(fields).every(([key, check]) => check(v[key]));
const timestamp: Check = (v) => typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const ids = list(id);
const person = shape({ id, name: string, role: string, initials: string, color: string, skills: list(string, 100) });
const task = shape({ id, title: string, ownerId: id, sprint: (v) => integer(v) && (v as number) >= 1 && (v as number) <= 6, startDay: calendarDay, dueDay: calendarDay, completedDay: nullable(day), status: one('planned', 'active', 'blocked', 'done'), dependsOn: ids });
const fact = shape({ id, text: string, personId: nullable(id), learnedDay: day, effectiveFrom: calendarDay, effectiveTo: calendarDay, state: one('active', 'folded', 'archived'), source: string, sourceEventId: id });
const memory = shape({ id, day, op: one('keep', 'fold', 'archive', 'promote', 'restore'), factIds: ids, why: string });
const decision = shape({ id, day, summary: string, before: optional(string), after: optional(string), evidenceIds: ids, state: one('proposed', 'applied', 'prevented') });
const shadow = shape({ id, day, doer: string, shadow: string, verdict: one('same', 'divergence', 'inconclusive', 'restored'), factIds: ids, summary: string });
const receipt = shape({ provider: string, operation: string, status: one('completed', 'blocked', 'failed'), at: timestamp, model: optional(string) });
const log = shape({ id, day, kind: string, title: string, detail: string, evidenceIds: ids });
const snapshotShape = shape({
  schemaVersion: one(1), runId: id, seq: integer, executionMode: one('live'), teamSource: one('simulated'),
  day, deadlineDay: (v) => calendarDay(v) && (v as number) > 0, status: one('idle', 'running', 'paused', 'completed', 'blocked'),
  phase: one('planning', 'working', 'night', 'checking', 'restoring', 'finished'), stressTest: one(false), seed: integer,
  team: list(person, 6), tasks: list(task, 1000), facts: list(fact), memoryOps: list(memory), decisions: list(decision),
  checks: list(shadow), feed: list(log), receipts: list(receipt, 1000), injections: list(one(...presets), 100),
  metrics: shape({ completedTasks: integer, totalTasks: integer, conflictsDetected: integer, restores: integer, protectedFacts: integer, contextTokens: nullable(integer) }),
  outcome: nullable(shape({ success: (v) => typeof v === 'boolean', title: string, reason: string })),
});

export class LiveTransportError extends Error {
  code: string;
  constructor(message: string, code = 'LIVE_BLOCKED') { super(message); this.name = 'LiveTransportError'; this.code = code; }
}
const incompatible = () => new LiveTransportError('Live runtime returned incompatible state. No fixture fallback was used.', 'INVALID_RUNTIME_STATE');

export function parseLiveSnapshot(value: unknown, expectedRunId?: string): Snapshot {
  if (!snapshotShape(value)) throw incompatible();
  const snapshot = value as Snapshot;
  if ((expectedRunId && snapshot.runId !== expectedRunId) || snapshot.team.length !== 6) throw incompatible();
  for (const rows of [snapshot.team, snapshot.tasks, snapshot.facts, snapshot.memoryOps, snapshot.decisions, snapshot.checks, snapshot.feed]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw incompatible();
  }
  const people = new Set(snapshot.team.map((row) => row.id));
  const tasks = new Set(snapshot.tasks.map((row) => row.id));
  const facts = new Set(snapshot.facts.map((row) => row.id));
  if (snapshot.tasks.some((row) => !people.has(row.ownerId) || row.startDay > row.dueDay || row.dependsOn.some((dependency) => dependency === row.id || !tasks.has(dependency)))) throw incompatible();
  if (snapshot.facts.some((row) => (row.personId !== null && !people.has(row.personId)) || row.effectiveFrom > row.effectiveTo)) throw incompatible();
  if ([...snapshot.memoryOps, ...snapshot.checks].some((row) => row.factIds.some((factId) => !facts.has(factId)))) throw incompatible();
  if (snapshot.metrics.totalTasks !== snapshot.tasks.length || snapshot.metrics.completedTasks !== snapshot.tasks.filter((row) => row.status === 'done').length) throw incompatible();
  return structuredClone(snapshot);
}

export function parseRuntimeEvent(value: unknown, runId: string): RuntimeEvent {
  if (!shape({ id, runId: id, seq: integer, simulatedDay: day, receivedAt: timestamp, snapshot: record })(value)) throw incompatible();
  const event = value as RuntimeEvent;
  const snapshot = parseLiveSnapshot(event.snapshot, runId);
  if (event.runId !== runId || event.seq !== snapshot.seq || event.simulatedDay !== snapshot.day) throw incompatible();
  return { ...event, snapshot };
}

type EventSourceLike = Pick<EventSource, 'addEventListener' | 'removeEventListener' | 'close'>;
export type LiveTransportDependencies = {
  fetchImpl?: typeof fetch;
  eventSourceFactory?: (url: string, options: EventSourceInit) => EventSourceLike;
  setTimeoutImpl?: typeof globalThis.setTimeout;
  clearTimeoutImpl?: typeof globalThis.clearTimeout;
  reconnectDelayMs?: number;
  requestTimeoutMs?: number;
  maxReconnectAttempts?: number;
  signal?: AbortSignal;
};

/** Explicit-start, same-origin client for Vincent's runtime, never an AI backend. */
export class LiveTransport implements Transport {
  private snapshot: Snapshot | null = null;
  private listeners = new Set<(update: TransportUpdate) => void>();
  private controllers = new Set<AbortController>();
  private eventCleanup: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private generation = 0;
  private mutationPending = false;
  private recovering = false;
  private reconnectAttempts = 0;
  private sentCommands = new Set<string>();
  private fetchImpl: typeof fetch;
  private sourceFactory: NonNullable<LiveTransportDependencies['eventSourceFactory']>;
  private schedule: typeof globalThis.setTimeout;
  private cancel: typeof globalThis.clearTimeout;
  private reconnectDelay: number;
  private requestTimeout: number;
  private maxReconnectAttempts: number;
  private detachAbort: (() => void) | null = null;

  constructor(deps: LiveTransportDependencies = {}) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sourceFactory = deps.eventSourceFactory ?? ((url, options) => new EventSource(url, options));
    this.schedule = deps.setTimeoutImpl ?? globalThis.setTimeout.bind(globalThis);
    this.cancel = deps.clearTimeoutImpl ?? globalThis.clearTimeout.bind(globalThis);
    this.reconnectDelay = Math.max(1, Math.min(8000, deps.reconnectDelayMs ?? 500));
    this.requestTimeout = Math.max(25, Math.min(30_000, deps.requestTimeoutMs ?? 15_000));
    this.maxReconnectAttempts = Math.max(1, Math.min(10, deps.maxReconnectAttempts ?? 5));
    if (deps.signal) {
      const abort = () => this.dispose();
      deps.signal.addEventListener('abort', abort, { once: true });
      this.detachAbort = () => deps.signal?.removeEventListener('abort', abort);
      if (deps.signal.aborted) this.dispose();
    }
  }

  getSnapshot(): Snapshot | null { return this.snapshot ? structuredClone(this.snapshot) : null; }
  subscribe(listener: (update: TransportUpdate) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(update: TransportUpdate): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try { listener(structuredClone(update)); } catch { /* UI listeners cannot change transport authority. */ }
    }
  }
  private connection(status: 'connecting' | 'connected' | 'reconnecting' | 'blocked', message?: string): void {
    this.emit({ kind: 'connection', status, ...(message ? { message } : {}) });
  }
  private active(): void {
    if (this.disposed) throw new LiveTransportError('Live transport has been disposed.', 'DISPOSED');
  }
  private stopEvents(): void { this.eventCleanup?.(); this.eventCleanup = null; }
  private stopReconnect(): void {
    if (this.reconnectTimer !== null) this.cancel(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  private block(message: string): void { this.stopEvents(); this.stopReconnect(); this.connection('blocked', message); }
  private apply(snapshot: Snapshot): void {
    if (this.snapshot && snapshot.runId !== this.snapshot.runId) throw incompatible();
    if (this.snapshot && snapshot.seq <= this.snapshot.seq) return;
    this.snapshot = structuredClone(snapshot);
    this.emit({ kind: 'state', snapshot });
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    this.active();
    const generation = this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = this.schedule(() => controller.abort(), this.requestTimeout);
    const clearTimer = () => this.cancel(timer);
    controller.signal.addEventListener('abort', clearTimer, { once: true });
    try {
      const response = await this.fetchImpl(`/api/remaster${path}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: controller.signal, headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new LiveTransportError(
          response.status === 401 ? 'Sign in with an invited account to use live mode.' : 'Live runtime request failed. No fixture fallback was used.',
          response.status === 401 || response.status === 403 ? 'SESSION_REQUIRED' : 'REQUEST_FAILED',
        );
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw incompatible();
      }
      const reader = response.body.getReader();
      const abortRead = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', abortRead, { once: true });
      let content = '';
      let bytes = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 512 * 1024) throw incompatible();
          content += decoder.decode(value, { stream: true });
        }
        content += decoder.decode();
      } finally {
        controller.signal.removeEventListener('abort', abortRead);
        await reader.cancel().catch(() => {});
      }
      if (controller.signal.aborted || generation !== this.generation || this.disposed) throw new LiveTransportError('Live request was cancelled.', 'CANCELLED');
      try { return JSON.parse(content); } catch { throw incompatible(); }
    } finally {
      this.cancel(timer);
      controller.signal.removeEventListener('abort', clearTimer);
      this.controllers.delete(controller);
    }
  }
  private snapshotResponse(value: unknown, runId?: string): Snapshot {
    if (!shape({ snapshot: record })(value)) throw incompatible();
    return parseLiveSnapshot((value as { snapshot: unknown }).snapshot, runId);
  }
  private async refresh(minimumSeq = this.snapshot?.seq ?? 0): Promise<void> {
    if (!this.snapshot) throw new LiveTransportError('No live run is available to resynchronize.', 'NO_RUN');
    const runId = this.snapshot.runId;
    const snapshot = this.snapshotResponse(await this.request(`/runs/${runId}`), runId);
    if (snapshot.seq < minimumSeq) throw incompatible();
    this.apply(snapshot);
  }

  async start(options: RunOptions): Promise<void> {
    this.active();
    if (this.mutationPending || this.recovering) throw new LiveTransportError('Another live operation is pending.', 'OPERATION_PENDING');
    if (!record(options) || !integer(options.seed) || typeof options.stressTest !== 'boolean') throw new LiveTransportError('Invalid run options.', 'INVALID_COMMAND');
    this.mutationPending = true;
    this.stopEvents(); this.stopReconnect();
    for (const controller of this.controllers) controller.abort();
    this.generation++;
    this.snapshot = null;
    this.sentCommands.clear();
    this.reconnectAttempts = 0;
    this.connection('connecting');
    let attempted = false;
    try {
      const status = await this.request('/status');
      if (!shape({ status: one('CONFIGURED', 'BLOCKED'), reason: string })(status) || (status as { status: string }).status !== 'CONFIGURED') throw new LiveTransportError('Live runtime is blocked. No fixture fallback was used.');
      attempted = true;
      const snapshot = this.snapshotResponse(await this.request('/runs', { seed: options.seed, stressTest: false }));
      this.apply(snapshot);
      this.openEvents();
    } catch (error) {
      const safe = this.snapshot ? new LiveTransportError('The run was created, but its live stream could not be opened. No new run was retried.', 'STREAM_UNAVAILABLE') : new LiveTransportError(attempted
        ? 'Run creation outcome is uncertain. No retry was sent; recover the run with the runtime operator before starting another.'
        : error instanceof LiveTransportError ? error.message : 'Live runtime is unavailable. No fixture fallback was used.', attempted ? 'START_UNCERTAIN' : 'LIVE_BLOCKED');
      this.block(safe.message);
      throw safe;
    } finally { this.mutationPending = false; }
  }

  async command(command: Command): Promise<void> {
    this.active();
    if (!this.snapshot) throw new LiveTransportError('Start a live run explicitly first.', 'NO_RUN');
    if (this.mutationPending || this.recovering) throw new LiveTransportError('Another live operation is pending.', 'OPERATION_PENDING');
    if (!(shape({ commandId: id, type: one('pause', 'resume') })(command) || shape({ commandId: id, type: one('inject_event'), payload: shape({ preset: one(...presets) }) })(command))) throw new LiveTransportError('Invalid live command.', 'INVALID_COMMAND');
    if (this.sentCommands.has(command.commandId)) throw new LiveTransportError('This command was already sent. It will not be retried.', 'COMMAND_ALREADY_SENT');
    if (this.sentCommands.size >= 4096) throw new LiveTransportError('Command limit reached for this transport.', 'COMMAND_LIMIT');
    this.sentCommands.add(command.commandId);
    this.mutationPending = true;
    this.stopEvents(); this.stopReconnect();
    const runId = this.snapshot.runId;
    try {
      const snapshot = this.snapshotResponse(await this.request(`/runs/${runId}/commands`, command), runId);
      if (snapshot.seq < this.snapshot.seq) throw incompatible();
      this.apply(snapshot);
      this.openEvents();
    } catch {
      if (this.disposed) throw new LiveTransportError('Live transport has been disposed.', 'DISPOSED');
      let refreshed = false;
      try { await this.refresh(); refreshed = true; } catch { /* Retain the last verified snapshot. */ }
      const error = new LiveTransportError(refreshed
        ? 'Command outcome is uncertain. Authoritative state was refetched; no retry was sent. Review state before sending a new command.'
        : 'Command outcome is uncertain and state could not be refetched. No retry was sent. Live updates are blocked.', 'COMMAND_UNCERTAIN');
      this.block(error.message);
      throw error;
    } finally { this.mutationPending = false; }
  }

  private openEvents(): void {
    this.active();
    if (!this.snapshot) return;
    this.stopEvents();
    const runId = this.snapshot.runId;
    const generation = this.generation;
    const source = this.sourceFactory(`/api/remaster/runs/${runId}/events?after=${this.snapshot.seq}`, { withCredentials: true });
    let detached = false;
    const current = () => !detached && !this.disposed && this.generation === generation;
    const open: EventListener = () => { if (current()) { this.reconnectAttempts = 0; this.connection('connected'); } };
    const state: EventListener = (raw) => {
      if (!current()) return;
      try {
        const message = raw as MessageEvent<string>;
        if (typeof message.data !== 'string' || new TextEncoder().encode(message.data).byteLength > 512 * 1024) throw incompatible();
        const event = parseRuntimeEvent(JSON.parse(message.data), runId);
        if (message.lastEventId !== String(event.seq)) throw incompatible();
        if (!this.snapshot || event.seq <= this.snapshot.seq) return;
        if (event.seq !== this.snapshot.seq + 1) { void this.recover(event.seq); return; }
        this.apply(event.snapshot);
      } catch { this.block(incompatible().message); }
    };
    const error: EventListener = () => { if (current()) this.queueReconnect(); };
    const bridgeError: EventListener = (raw) => {
      if (!current()) return;
      try {
        const data = JSON.parse((raw as MessageEvent<string>).data) as { code?: string };
        if (data.code === 'SESSION_REQUIRED') this.block('Your session ended. Sign in again to continue live mode.');
        else if (data.code === 'RUNTIME_INVALID_RESPONSE') this.block(incompatible().message);
        else this.queueReconnect();
      } catch { this.block(incompatible().message); }
    };
    const handlers = { open, state, error, 'bridge-error': bridgeError };
    for (const [name, listener] of Object.entries(handlers)) source.addEventListener(name, listener);
    this.eventCleanup = () => {
      if (detached) return;
      detached = true;
      for (const [name, listener] of Object.entries(handlers)) source.removeEventListener(name, listener);
      source.close();
    };
  }

  private queueReconnect(): void {
    this.stopEvents();
    if (this.disposed || this.reconnectTimer !== null || this.recovering || this.mutationPending) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) { this.block('Live reconnection failed. No fixture fallback was used.'); return; }
    this.connection('reconnecting', 'Refetching authoritative state before reconnecting.');
    const delay = Math.min(8000, this.reconnectDelay * 2 ** this.reconnectAttempts++);
    this.reconnectTimer = this.schedule(() => { this.reconnectTimer = null; void this.recover(); }, delay);
  }
  private async recover(minimumSeq?: number): Promise<void> {
    if (this.disposed || this.recovering || this.mutationPending) return;
    this.recovering = true;
    this.stopEvents(); this.stopReconnect();
    this.connection('reconnecting', 'Resynchronizing the live run.');
    try {
      await this.refresh(minimumSeq);
      if (this.disposed) return;
      this.openEvents();
    } catch (error) {
      if (!this.disposed && error instanceof LiveTransportError && ['SESSION_REQUIRED', 'INVALID_RUNTIME_STATE'].includes(error.code)) this.block(error.message);
      else if (!this.disposed) { this.recovering = false; this.queueReconnect(); }
    } finally { this.recovering = false; }
  }

  abort(): void { this.dispose(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.stopEvents(); this.stopReconnect();
    this.detachAbort?.(); this.detachAbort = null;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.listeners.clear();
  }
}
