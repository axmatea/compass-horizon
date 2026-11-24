import type {CrmClient, CrmConfig, CrmRow, Entity} from './types';

const requestErrors: Record<string, string> = {
  invalid_record: 'Check the required fields.',
  account_changed: 'The signed-in account changed. Reopen the workspace.',
  crm_reference_missing: 'Choose a client or deal from this workspace.',
  crm_record_in_use: 'Remove related records first.',
  crm_record_limit: 'This workspace has reached its record limit.',
  invalid_reference: 'Choose a client or deal from this workspace.',
  invalid_relationship: 'Choose a client or deal from this workspace.',
  reference_in_use: 'Remove related records first.',
  record_in_use: 'Remove related records first.',
  not_found: 'This record no longer exists. Refresh and try again.',
  record_limit: 'This workspace has reached its record limit.',
  record_conflict: 'The record changed elsewhere. Refresh and try again.',
  record_version_conflict: 'The record changed elsewhere. Refresh and try again.',
  sign_in_required: 'Sign in to continue.',
  stale_preview: 'Reopen the preview to continue.',
  version_conflict: 'Reopen the preview to continue.',
  rate_limited: 'Too many requests. Try again in a moment.',
};
function requestError(code: unknown) {
  return new Error(typeof code === 'string' ? requestErrors[code] || 'The request could not finish.' : 'The request could not finish.');
}

export function previewClient(): CrmClient {
  function send<T>(operation: string, entity: Entity, data?: CrmRow['data'], row?: CrmRow) {
    return new Promise<T>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const finish = () => {
        window.removeEventListener('message', receive);
        window.clearTimeout(timer);
      };
      const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || event.data?.type !== 'compass-crm-response' ||
            event.data.requestId !== requestId) return;
        finish();
        if (event.data.error) reject(requestError(event.data.error));
        else resolve(event.data.data);
      };
      const timer = window.setTimeout(() => {
        finish();
        reject(new Error('Preview connection timed out. Refresh to check whether the request finished.'));
      }, 10000);
      window.addEventListener('message', receive);
      window.parent.postMessage({type: 'compass-crm-request', requestId, operation, entity,
        ...(row ? {id: row.id, version: row.version} : {}), ...(data ? {data} : {})}, '*');
    });
  }
  return {
    list: entity => send('list', entity),
    save: (entity, data, row) => send('save', entity, data, row),
    delete: (entity, row) => send('delete', entity, undefined, row),
  };
}

export async function localRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {accept: 'application/json', ...(options?.body ? {'content-type': 'application/json'} : {}), ...options?.headers},
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const value = await response.json();
  if (!response.ok) throw requestError(value?.error || value?.code);
  return value;
}

export function standaloneClient(userId: string): CrmClient {
  const headers = {'x-crm-user': userId};
  const path = (entity: Entity, row?: CrmRow) => '/api/crm/' + entity + (row ? '/' + encodeURIComponent(row.id) : '');
  return {
    list: entity => localRequest(path(entity), {headers}),
    save: (entity, data, row) => localRequest(path(entity, row), {method: row ? 'PUT' : 'POST', headers, body: JSON.stringify({data, ...(row ? {version: row.version} : {})})}),
    delete: (entity, row) => localRequest(path(entity, row), {method: 'DELETE', headers: {...headers, 'x-compass-record-version': String(row.version)}}),
  };
}

export function getConfig() {
  return localRequest<CrmConfig>('/api/config');
}

export async function currentUser() {
  const session = await localRequest<{user?: {id: string}} | null>('/api/auth/get-session');
  return session?.user?.id || null;
}
