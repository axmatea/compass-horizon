const EMAIL_MAX = 200;
const MAILTO_ADDRESS = 'info@aimedia.global';

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (!email || email.length > EMAIL_MAX) return null;
  if (/[\u0000-\u001F\s]/.test(email)) return null;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || local.length > 64 || !domain || domain.length > 190) return null;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..') || local.includes('..')) return null;
  return email;
}

export function mailtoFor(email) {
  const subject = encodeURIComponent('COMPASS early access');
  const body = encodeURIComponent('Email: ' + email);
  return `mailto:${MAILTO_ADDRESS}?subject=${subject}&body=${body}`;
}

export function webhookUrl(env) {
  const raw = env?.WAITLIST_WEBHOOK_URL || '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function submitEarlyAccess(input, { env = {}, fetchImpl = fetch, now = () => new Date() } = {}) {
  const honey = input?.hp;
  if (honey != null && String(honey).trim() !== '') {
    return { status: 200, body: { ok: true, stored: false } };
  }
  const email = normalizeEmail(input?.email);
  if (!email) return { status: 400, body: { ok: false, stored: false, error: 'invalid_email' } };
  const hook = webhookUrl(env);
  if (!hook) {
    return { status: 200, body: { ok: true, stored: false, delivery: 'mailto', mailto: mailtoFor(email) } };
  }
  try {
    const response = await fetchImpl(hook, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, timestamp: now().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    try {
      if (response.body?.cancel) await response.body.cancel();
      else if (response.arrayBuffer) await response.arrayBuffer();
    } catch { /* delivery already succeeded or failed with status */ }
    if (!response.ok) {
      return { status: 502, body: { ok: false, stored: false, error: 'delivery_failed', delivery: 'mailto', mailto: mailtoFor(email) } };
    }
    return { status: 200, body: { ok: true, stored: true, delivery: 'webhook' } };
  } catch {
    return { status: 502, body: { ok: false, stored: false, error: 'delivery_failed', delivery: 'mailto', mailto: mailtoFor(email) } };
  }
}
