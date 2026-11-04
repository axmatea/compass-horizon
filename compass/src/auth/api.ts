export type Session = { user: { id: string; email: string; name?: string } };

export async function authRequest(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => { throw new Error('Authentication returned an invalid response. No success was confirmed.'); });
  if (!response.ok) {
    const detail = typeof data?.error === 'string' ? data.error : data?.error?.message ?? data?.message;
    throw new Error(typeof detail === 'string' ? detail : `Authentication is unavailable (${response.status}). No success was confirmed.`);
  }
  return data;
}

export async function authReady(signal?: AbortSignal): Promise<boolean> {
  const status = await authRequest('/api/auth/status', undefined, signal) as { database?: unknown } | null;
  if (!status || !['ready', 'blocked'].includes(String(status.database))) throw new Error('Authentication readiness could not be verified.');
  return status.database === 'ready';
}

export async function getSession(signal?: AbortSignal): Promise<Session | null> {
  const session = await authRequest('/api/auth/get-session', undefined, signal) as Session | null;
  if (session === null) return null;
  if (!session || typeof session.user?.id !== 'string' || !session.user.id || typeof session.user.email !== 'string') {
    throw new Error('Your signed-in session could not be verified. Please try again.');
  }
  return session;
}

export async function signIn(email: string, password: string): Promise<void> {
  await authRequest('/api/auth/sign-in/email', { email, password });
  if (!await getSession()) throw new Error('Sign-in did not establish a session. Check your credentials and try again.');
}

export async function registerInvite(input: { token: string; name: string; email: string; password: string }): Promise<void> {
  const result = await authRequest('/api/acquisition/accept-invite', input) as { ok?: unknown } | null;
  if (result?.ok !== true) throw new Error('Account registration was not confirmed. Please request a fresh invitation if needed.');
}
