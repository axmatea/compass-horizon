export const COMPASS_ORIGIN = 'https://mycompass.world';
export const SESSION_COOKIE = '__Secure-compass-account.session_token';
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_OWNER = /^[A-Za-z0-9_-]{1,128}$/;
const COOKIE_VALUE = /^[A-Za-z0-9._%~+\-\/=:]{1,1024}$/;

// Published account UI and native client use these same session-bound routes.
// Scope headers to exact API paths. No credentials enter a WebView or deep link.
const publicRoutes = new Map([
  ['/api/account/config', 'GET'], ['/api/auth/sign-in/email', 'POST'],
  ['/api/auth/sign-up/email', 'POST'], ['/api/auth/request-password-reset', 'POST'],
]);
const privateRoutes = [
  [/^\/api\/auth\/sign-out$/, ['POST']],
  [/^\/api\/account\/(?:me|usage|integrations)$/, ['GET']],
  [/^\/api\/account\/profile$/, ['GET', 'PUT']],
  [/^\/api\/account\/(?:projects|apps)$/, ['GET', 'POST']],
  [/^\/api\/account\/turn$/, ['POST']],
  [/^\/api\/account\/apps\/(?:plan|build-plan)$/, ['POST']],
  [/^\/api\/account\/projects\/[A-Za-z0-9_-]{1,80}$/, ['GET']],
  [/^\/api\/account\/apps\/[A-Za-z0-9_-]{1,80}(?:\/(?:revisions|records))?$/, ['GET']],
  [/^\/api\/account\/apps\/[A-Za-z0-9_-]{1,80}\/(?:build-plan|plan|restore|assets)$/, ['POST']],
  [/^\/api\/account\/apps\/[A-Za-z0-9_-]{1,80}\/context$/, ['GET', 'PUT', 'POST']],
  [/^\/api\/account\/apps\/[A-Za-z0-9_-]{1,80}\/crm\/(?:clients|contacts|deals|tasks|proposals)$/, ['GET']],
];

export class CompassApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function readSessionCookie(headers) {
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const lines = cookies.length ? cookies : [headers.get('set-cookie') || ''];
  for (const line of lines) {
    // Multiple Set-Cookie values may be joined across native network stacks.
    // An expires-date comma is safe because the boundary must precede this exact name.
    const cookie = line.split(/,(?=\s*__Secure-compass-account\.session_token=)/i);
    for (const segment of cookie) {
      const [pair, ...attributes] = segment.trim().split(';');
      if (!pair.startsWith(SESSION_COOKIE + '=')) continue;
      const value = pair.slice(SESSION_COOKIE.length + 1);
      const flags = attributes.map(attribute => attribute.trim().toLowerCase());
      if (COOKIE_VALUE.test(value) && flags.includes('secure') && flags.includes('httponly') && flags.includes('path=/') &&
        !flags.some(flag => flag.startsWith('domain=') || flag === 'max-age=0')) return value;
    }
  }
  return null;
}

export function checkedId(value) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new CompassApiError('invalid_project', 400);
  return value;
}

export function createTransport(fetcher, storage) {
  let session = null;
  let owner = null;

  async function clearSession() {
    session = null;
    owner = null;
    await storage.clear();
  }

  async function send(path, options = {}) {
    const method = options.method || 'GET';
    const isPublic = publicRoutes.get(path) === method;
    const permitted = isPublic || privateRoutes.some(([route, methods]) => route.test(path) && methods.includes(method));
    if (!permitted || /[?#%\\\s]/.test(path)) throw new CompassApiError('invalid_request', 400);
    if (!isPublic && !session) throw new CompassApiError('sign_in_required', 401);
    const headers = new Headers({Accept: 'application/json', Origin: COMPASS_ORIGIN});
    const tokenAtStart = session;
    if (!isPublic) {
      headers.set('Cookie', `${SESSION_COOKIE}=${session}`);
      if (owner) headers.set('X-Compass-User', owner);
    }
    if (options.key) headers.set('Idempotency-Key', options.key);
    if (options.appVersion) headers.set('X-Compass-App-Version', String(options.appVersion));
    if (options.bytes) headers.set('Content-Type', options.mime);
    else if (options.json !== undefined) headers.set('Content-Type', 'application/json');
    const deadline = new AbortController();
    const timeLimit = options.key ? 120000 : 30000;
    const timer = setTimeout(() => deadline.abort(), timeLimit);
    let response;
    let data;
    try {
      response = await fetcher(COMPASS_ORIGIN + path, {
        method, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
        body: options.bytes || (options.json === undefined ? undefined : JSON.stringify(options.json)),
        signal: deadline.signal,
      });
      if (response.redirected || (response.url && response.url !== COMPASS_ORIGIN + path) || (response.status >= 300 && response.status < 400)) {
        throw new CompassApiError('invalid_response', 502);
      }
      try { data = await response.json(); } catch { throw new CompassApiError('invalid_response', response.status); }
    } catch (error) {
      if (deadline.signal.aborted) throw new CompassApiError('request_timed_out', 408);
      throw error;
    } finally { clearTimeout(timer); }
    if (!isPublic && tokenAtStart !== session) throw new CompassApiError('account_changed', 403);
    if (!response.ok) {
      const rawCode = data?.code || data?.error;
      const code = typeof rawCode === 'string' && /^[a-z][a-z_]{1,64}$/i.test(rawCode) ? rawCode.toLowerCase() : 'request_failed';
      if (!isPublic && (response.status === 401 || code === 'account_changed')) await clearSession();
      throw new CompassApiError(code, response.status);
    }
    return {data, headers: response.headers};
  }

  async function verifySession() {
    const {data} = await send('/api/account/me');
    if (typeof data?.userId !== 'string' || !SAFE_OWNER.test(data.userId)) throw new CompassApiError('invalid_response', 502);
    owner = data.userId;
    return {userId: owner};
  }

  async function signIn(email, password) {
    const {headers} = await send('/api/auth/sign-in/email', {
      method: 'POST', json: {email, password, callbackURL: COMPASS_ORIGIN + '/create?view=account'},
    });
    const token = readSessionCookie(headers);
    if (!token) throw new CompassApiError('session_cookie_missing', 401);
    session = token;
    owner = null;
    try {
      const identity = await verifySession();
      await storage.set(token);
      return identity;
    } catch (error) {
      await clearSession();
      throw error;
    }
  }

  async function restore() {
    const saved = await storage.get();
    if (!saved) return null;
    if (typeof saved !== 'string' || !COOKIE_VALUE.test(saved)) {
      await clearSession();
      return null;
    }
    session = saved;
    try { return await verifySession(); }
    catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  async function signOut() {
    try { if (session) await send('/api/auth/sign-out', {method: 'POST', json: {}}); }
    finally { await clearSession(); }
  }

  return {
    restore, signIn, signOut,
    async request(path, options) { return (await send(path, options)).data; },
  };
}
