export type TaskStatus = 'todo' | 'doing' | 'done';
export type Task = { id: string; title: string; assigneeId: string | null; status: TaskStatus; dueDate: string | null; version: number };
export type TaskInput = Omit<Task, 'id' | 'version'>;
export type Member = { userId: string; name: string; email: string; role: string };
export type Material = { id: string; title: string; content: string; createdAt: string; authorId: string };
export type Workspace = { id: string; name: string; goal: string; deadline: string | null; role: string };
export type WorkspaceEvent = { id: string; type: string; createdAt?: string; actorId?: string };
export type Snapshot = { workspace: Workspace; members: Member[]; tasks: Task[]; materials: Material[]; proposals: unknown[]; events: WorkspaceEvent[]; ai: { status: string; reason: string }; seq: string | number };

export function parseSequence(value: unknown): bigint {
  if ((typeof value === 'string' && /^(0|[1-9]\d{0,19})$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return BigInt(value);
  throw new Error('Invalid workspace sequence. Refresh to verify the latest state.');
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function nullableString(value: unknown) { return value === null || typeof value === 'string'; }
export function isWorkspace(value: unknown): value is Workspace {
  return record(value) && ['id', 'name', 'goal', 'role'].every(key => typeof value[key] === 'string') && nullableString(value.deadline);
}
export function parseSnapshot(value: unknown): Snapshot {
  if (!record(value) || !isWorkspace(value.workspace)
    || !Array.isArray(value.members) || !value.members.every(m => record(m) && ['userId', 'name', 'email', 'role'].every(k => typeof m[k] === 'string'))
    || !Array.isArray(value.tasks) || !value.tasks.every(t => record(t) && typeof t.id === 'string' && typeof t.title === 'string' && nullableString(t.assigneeId) && nullableString(t.dueDate) && ['todo', 'doing', 'done'].includes(String(t.status)) && Number.isInteger(t.version) && Number(t.version) >= 0)
    || !Array.isArray(value.materials) || !value.materials.every(m => record(m) && ['id', 'title', 'content', 'createdAt', 'authorId'].every(k => typeof m[k] === 'string'))
    || !Array.isArray(value.proposals) || !Array.isArray(value.events)
    || !value.events.every(e => record(e) && typeof e.id === 'string' && typeof e.type === 'string' && (e.createdAt === undefined || typeof e.createdAt === 'string'))
    || !record(value.ai) || typeof value.ai.status !== 'string' || typeof value.ai.reason !== 'string') {
    throw new Error('The server returned an invalid workspace. No sample data has been substituted.');
  }
  parseSequence(value.seq);
  return value as Snapshot;
}
