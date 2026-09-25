export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'blocked';
export type Phase = 'planning' | 'working' | 'night' | 'checking' | 'restoring' | 'finished';
export type Preset = 'sarah-leave' | 'deadline-shift' | 'dependency-delay';
export type Person = { id: string; name: string; role: string; initials: string; color: string; skills: string[] };
export type Task = {
  id: string; title: string; ownerId: string; sprint: number;
  startDay: number; dueDay: number; completedDay: number | null;
  status: 'planned' | 'active' | 'blocked' | 'done'; dependsOn: string[];
};
export type Fact = {
  id: string; text: string; personId: string | null; learnedDay: number;
  effectiveFrom: number; effectiveTo: number; state: 'active' | 'folded' | 'archived';
  source: string; sourceEventId: string;
};
export type MemoryOp = { id: string; day: number; op: 'keep' | 'fold' | 'archive' | 'promote' | 'restore'; factIds: string[]; why: string };
export type Decision = { id: string; day: number; summary: string; before?: string; after?: string; evidenceIds: string[]; state: 'proposed' | 'applied' | 'prevented' };
export type ShadowCheck = { id: string; day: number; doer: string; shadow: string; verdict: 'same' | 'divergence' | 'inconclusive' | 'restored'; factIds: string[]; summary: string };
export type Receipt = { provider: string; operation: string; status: 'completed' | 'blocked' | 'failed'; at: string; model?: string };
export type LogEntry = { id: string; day: number; kind: string; title: string; detail: string; evidenceIds: string[] };
export type Snapshot = {
  schemaVersion: 1; runId: string; seq: number; executionMode: 'fixture' | 'live'; teamSource: 'simulated';
  day: number; deadlineDay: number; status: RunStatus; phase: Phase; stressTest: boolean; seed: number;
  team: Person[]; tasks: Task[]; facts: Fact[]; memoryOps: MemoryOp[]; decisions: Decision[];
  checks: ShadowCheck[]; feed: LogEntry[]; receipts: Receipt[]; injections: Preset[];
  metrics: { completedTasks: number; totalTasks: number; conflictsDetected: number; restores: number; protectedFacts: number; contextTokens: number | null };
  outcome: null | { success: boolean; title: string; reason: string };
};
export type RunOptions = { seed: number; stressTest: boolean };
export type Command = { commandId: string; type: 'pause' | 'resume' } | { commandId: string; type: 'inject_event'; payload: { preset: Preset } };
export type RuntimeEvent = { id: string; runId: string; seq: number; simulatedDay: number; receivedAt: string; snapshot: Snapshot };
export type TransportUpdate = { kind: 'state'; snapshot: Snapshot } | { kind: 'connection'; status: 'connecting' | 'connected' | 'reconnecting' | 'blocked'; message?: string };
export interface Transport {
  getSnapshot(): Snapshot | null;
  subscribe(listener: (update: TransportUpdate) => void): () => void;
  start(options: RunOptions): Promise<void>;
  command(command: Command): Promise<void>;
  dispose(): void;
  advanceTime?(ms: number): void;
}
