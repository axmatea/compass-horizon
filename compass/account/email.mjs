const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DELIVERY_ERROR = 'Email delivery unavailable.';
const MESSAGE_KINDS = new Set(['verify-email', 'reset-password', 'confirm-email-change']);
const EMAIL = /^[^\s@<>,]+@(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

function address(value) {
  return typeof value === 'string' && value.length <= 254 && !CONTROL.test(value) && EMAIL.test(value);
}

function sender(value) {
  if (typeof value !== 'string' || value.length > 320 || CONTROL.test(value)) return null;
  const normalized = value.trim();
  if (address(normalized)) return normalized;
  const match = /^([^<>]+)\s+<([^<>]+)>$/.exec(normalized);
  return match && match[1].trim() && address(match[2]) ? normalized : null;
}

function messageBody(value) {
  if (!value || !MESSAGE_KINDS.has(value.kind) || !address(value.to)
    || typeof value.subject !== 'string' || !value.subject.trim() || value.subject.length > 200 || CONTROL.test(value.subject)
    || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 16_384) {
    throw new Error(DELIVERY_ERROR);
  }
  return { kind: value.kind, to: value.to, subject: value.subject, text: value.text };
}

/** Server-only delivery. Configuration readiness does not prove inbox delivery. */
export function createEmailDelivery(env = {}, { sendEmail, fetchImpl = globalThis.fetch } = {}) {
  if (typeof sendEmail === 'function') return sendEmail;
  const provider = env.COMPASS_ACCOUNT_EMAIL_PROVIDER;
  if (provider !== undefined && provider !== 'webhook' && provider !== 'resend') return null;
  if (typeof fetchImpl !== 'function') return null;

  let target, headers, from;
  if (provider === 'resend') {
    const key = env.RESEND_API_KEY;
    from = sender(env.COMPASS_ACCOUNT_EMAIL_FROM);
    if (!from || typeof key !== 'string' || !key.trim() || /\s/.test(key) || CONTROL.test(key)) return null;
    target = RESEND_ENDPOINT;
    headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  } else {
    try {
      const url = new URL(env.COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
      target = url.href;
    } catch { return null; }
    headers = { 'content-type': 'application/json' };
    const token = env.COMPASS_ACCOUNT_EMAIL_WEBHOOK_TOKEN;
    if (token !== undefined && (typeof token !== 'string' || CONTROL.test(token))) return null;
    if (token) headers.authorization = `Bearer ${token}`;
  }

  return async (value) => {
    try {
      const message = messageBody(value);
      const body = provider === 'resend'
        ? { from, to: [message.to], subject: message.subject, text: message.text }
        : message;
      const response = await fetchImpl(target, {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000), redirect: 'error',
      });
      if (!response.ok) throw new Error(DELIVERY_ERROR);
      // Resend's accepted-send contract includes an ID. Do not report a
      // malformed successful response as an accepted verification/reset email.
      if (provider === 'resend') {
        const result = await response.json();
        if (typeof result?.id !== 'string' || !result.id.trim() || result.id.length > 200) throw new Error(DELIVERY_ERROR);
      }
    } catch {
      // Provider/network errors can contain addresses, message URLs or keys.
      // Never propagate response bodies, credentials or token-bearing payloads.
      throw new Error(DELIVERY_ERROR);
    }
  };
}
