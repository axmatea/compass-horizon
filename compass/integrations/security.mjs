import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class IntegrationError extends Error {
  constructor(status, code) { super(code); this.name = 'IntegrationError'; this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new IntegrationError(status, code); };
export function ownerId(owner) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) fail(401, 'integration_owner_required');
  return owner;
}
export function stagingConfig(env) {
  let origin, key;
  try {
    const url = new URL(env.COMPASS_ACCOUNT_ORIGIN);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (env.COMPASS_INTEGRATIONS_MODE !== 'staging' || url.origin !== env.COMPASS_ACCOUNT_ORIGIN
      || url.username || url.password || ['mycompass.world', 'www.mycompass.world'].includes(hostname)
      || !(url.protocol === 'https:' || (env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)))) return null;
    origin = url.origin;
    if (typeof env.COMPASS_INTEGRATION_ENCRYPTION_KEY !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(env.COMPASS_INTEGRATION_ENCRYPTION_KEY)) return null;
    key = Buffer.from(env.COMPASS_INTEGRATION_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32 || key.toString('base64') !== env.COMPASS_INTEGRATION_ENCRYPTION_KEY) return null;
  } catch { return null; }
  return { origin, key };
}
export function secretBox(key) {
  const aad = (owner, provider, kind) => Buffer.from(JSON.stringify(['compass-integrations-v1', owner, provider, kind]));
  return {
    seal(owner, provider, kind, value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(owner, provider, kind));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    },
    open(owner, provider, kind, value) {
      try {
        const box = JSON.parse(value);
        if (box.v !== 1) throw Error();
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
        decipher.setAAD(aad(owner, provider, kind));
        decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
      } catch { fail(409, 'integration_key_or_ciphertext_invalid'); }
    },
  };
}

// Endpoint selection belongs to engineer-authored adapters. Never accept a URL
// from the client, discovery documents, pagination links, or provider responses.
const endpoints = new Map([
  ['github.com', /^\/login\/oauth\/access_token$/],
  ['api.github.com', /^\/(?:graphql|user(?:\/repos)?|repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/git\/ref\/heads\/[A-Za-z0-9_./-]+)?|applications\/[A-Za-z0-9_.-]+\/token)$/],
  ['oauth2.googleapis.com', /^\/(?:token|revoke)$/],
  ['www.googleapis.com', /^\/(?:drive\/v3\/files|calendar\/v3\/calendars\/[A-Za-z0-9_%@.+-]+\/events)$/],
  ['sheets.googleapis.com', /^\/v4\/spreadsheets\/[A-Za-z0-9_-]+(?:\/values\/[^/]+)?$/],
  ['gmail.googleapis.com', /^\/gmail\/v1\/users\/me\/messages(?:\/[a-zA-Z0-9_-]+)?$/],
  ['api.notion.com', /^\/v1\/(?:oauth\/(?:token|revoke)|pages\/[a-f0-9-]+|blocks\/[a-f0-9-]+\/children)$/],
  ['slack.com', /^\/api\/(?:oauth\.v2\.access|auth\.revoke|conversations\.list)$/],
]);
export function createTransport(fetchImpl) {
  return async function transport(target, options = {}, limit = 1024 * 1024) {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
      || !endpoints.get(url.hostname)?.test(url.pathname)) fail(400, 'integration_endpoint_refused');
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new IntegrationError(504, 'integration_timeout')); }, 8000); });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(url.href, { ...options, redirect: 'error', signal: controller.signal });
        if (!(response instanceof Response) || response.redirected || (response.status >= 300 && response.status < 400)) fail(502, 'integration_redirect_refused');
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > limit) fail(502, 'integration_response_too_large');
        const chunks = []; let length = 0;
        if (response.body) {
          const reader = response.body.getReader();
          const cancel = () => { reader.cancel().catch(() => {}); };
          controller.signal.addEventListener('abort', cancel, { once: true });
          try {
            while (true) {
              const { done, value } = await reader.read(); if (done) break;
              length += value.byteLength;
              if (length > limit) { await reader.cancel(); fail(502, 'integration_response_too_large'); }
              chunks.push(Buffer.from(value));
            }
          } finally { controller.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
        }
        const body = Buffer.concat(chunks);
        return new Response(body.length ? body : null, { status: response.status, headers: response.headers });
      })()]);
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      fail(502, 'integration_provider_unavailable');
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
export async function responseJSON(response, allowArray = false) {
  try {
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:;|$)/i.test(response.headers.get('content-type') || '')) fail(502, 'integration_invalid_response');
    const value = await response.json();
    if (!value || typeof value !== 'object' || (!allowArray && Array.isArray(value))) fail(502, 'integration_invalid_response');
    return value;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    fail(502, 'integration_invalid_response');
  }
}
