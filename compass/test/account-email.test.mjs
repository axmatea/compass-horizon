import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailDelivery } from '../account/email.mjs';

const message = {
  kind: 'verify-email', to: 'person@compass.test', subject: 'Verify your COMPASS email',
  text: 'Verify your email: https://compass.test/api/auth/verify-email?token=synthetic-token',
};
const resend = {
  COMPASS_ACCOUNT_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_synthetic_test_key',
  COMPASS_ACCOUNT_EMAIL_FROM: 'COMPASS <accounts@auth.compass.test>',
};

test('email delivery is off until an explicit complete provider is configured', () => {
  for (const env of [
    {}, { RESEND_API_KEY: resend.RESEND_API_KEY },
    { ...resend, COMPASS_ACCOUNT_EMAIL_PROVIDER: undefined },
    { ...resend, COMPASS_ACCOUNT_EMAIL_PROVIDER: 'smtp' },
    { ...resend, RESEND_API_KEY: '' }, { ...resend, RESEND_API_KEY: 'secret\r\nheader' },
    { ...resend, COMPASS_ACCOUNT_EMAIL_FROM: undefined },
    { ...resend, COMPASS_ACCOUNT_EMAIL_FROM: 'Invalid sender' },
    { ...resend, COMPASS_ACCOUNT_EMAIL_FROM: 'COMPASS <a@compass.test>\nBcc: other@compass.test' },
    { COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL: 'http://mail.test' },
    { COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL: 'https://user:pass@mail.test' },
    { COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mail.test#secret' },
    { COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mail.test', COMPASS_ACCOUNT_EMAIL_WEBHOOK_TOKEN: 'bad\nheader' },
  ]) assert.equal(createEmailDelivery(env), null);
});

test('Resend sends only bounded account mail through the fixed HTTPS API', async () => {
  const calls = [];
  const deliver = createEmailDelivery(resend, { fetchImpl: async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({ id: 'synthetic-accepted-id' }) };
  } });
  for (const kind of ['verify-email', 'reset-password', 'confirm-email-change']) await deliver({ ...message, kind });
  assert.equal(calls.length, 3);
  for (const [url, options] of calls) {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${resend.RESEND_API_KEY}`);
    assert.equal(options.headers['content-type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {
      from: resend.COMPASS_ACCOUNT_EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text,
    });
  }
});

test('existing HTTPS webhook configuration retains its authorized account-mail contract', async () => {
  for (const provider of [undefined, 'webhook']) {
    let received;
    const deliver = createEmailDelivery({
      COMPASS_ACCOUNT_EMAIL_PROVIDER: provider,
      COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mail.compass.test/deliver',
      COMPASS_ACCOUNT_EMAIL_WEBHOOK_TOKEN: 'synthetic-webhook-key',
    }, { fetchImpl: async (...args) => { received = args; return { ok: true }; } });
    await deliver(message);
    assert.equal(received[0], 'https://mail.compass.test/deliver');
    assert.equal(received[1].headers.authorization, 'Bearer synthetic-webhook-key');
    assert.deepEqual(JSON.parse(received[1].body), message);
    assert.equal(received[1].redirect, 'error');
  }
});

test('an explicitly incomplete Resend configuration never falls back to a webhook', () => {
  assert.equal(createEmailDelivery({ ...resend, RESEND_API_KEY: '', COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mail.test' }), null);
});

test('invalid message content is rejected before any provider request', async () => {
  let calls = 0;
  const deliver = createEmailDelivery(resend, { fetchImpl: async () => { calls++; throw new Error('must not send'); } });
  for (const invalid of [
    null, { ...message, kind: 'marketing' }, { ...message, to: ['person@compass.test'] },
    { ...message, to: 'person@compass.test,other@compass.test' },
    { ...message, to: 'person@compass.test\r\nBcc: other@compass.test' },
    { ...message, subject: 'Injected\nheader' }, { ...message, subject: '' },
    { ...message, subject: 'a'.repeat(201) }, { ...message, text: '' }, { ...message, text: 'a'.repeat(16_385) },
  ]) await assert.rejects(deliver(invalid), { message: 'Email delivery unavailable.' });
  assert.equal(calls, 0);
});

test('rejected, malformed, redirected and network failures expose only a generic error', async () => {
  const privateValue = `${message.to} ${message.text} ${resend.RESEND_API_KEY}`;
  for (const fetchImpl of [
    async () => ({ ok: false, text: async () => privateValue }),
    async () => ({ ok: true, json: async () => ({ error: privateValue }) }),
    async () => ({ ok: true, json: async () => ({ id: '' }) }),
    async () => ({ ok: true, json: async () => { throw new Error(privateValue); } }),
    async () => { throw new Error(privateValue); },
    async () => { throw new TypeError('redirect rejected ' + privateValue); },
  ]) {
    const deliver = createEmailDelivery(resend, { fetchImpl });
    await assert.rejects(deliver(message), error => {
      assert.equal(error.message, 'Email delivery unavailable.');
      assert.equal(error.cause, undefined);
      assert.ok(!String(error).includes(privateValue));
      return true;
    });
  }
});

test('test delivery injection remains available without a real email provider', () => {
  const sendEmail = async () => {};
  assert.equal(createEmailDelivery({}, { sendEmail }), sendEmail);
});
