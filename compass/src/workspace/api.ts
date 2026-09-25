import { isWorkspace, parseSnapshot } from './types.ts';
import type { Workspace } from './types.ts';
export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
export async function request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/workspaces${path}`, { method, credentials: 'same-origin', signal,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result?.error === 'string' ? result.error : result?.error?.message ?? result?.message;
    throw new ApiError(response.status === 401 ? 'Sign in to use your team workspace.' : response.status === 409 && result?.code === 'VERSION_CONFLICT' ? 'This item changed since you opened it. Your edits were not saved. Review the latest version and try again.' : typeof detail === 'string' ? detail : `Workspace request failed (${response.status}).`, response.status);
  }
  return result;
}
export async function listWorkspaces(signal?: AbortSignal): Promise<Workspace[]> {
  const data = await request('', 'GET', undefined, signal) as { workspaces?: unknown };
  if (!data || !Array.isArray(data.workspaces) || !data.workspaces.every(isWorkspace)) throw new Error('The server returned an invalid workspace list.');
  return data.workspaces;
}
export const workspacePath = (id: string) => `/${encodeURIComponent(id)}`;
export async function fetchSnapshot(id: string, signal?: AbortSignal) {
  const snapshot = parseSnapshot(await request(workspacePath(id), 'GET', undefined, signal));
  if (snapshot.workspace.id !== id) throw new Error('Workspace response did not match the selected project.');
  return snapshot;
}
export const commandId = () => crypto.randomUUID();
