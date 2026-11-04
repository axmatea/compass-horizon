import test from 'node:test';
import assert from 'node:assert/strict';
import { authReady, authRequest, getSession, registerInvite, signIn } from './api.ts';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const account = { user: { id: 'test-user', email: 'test@example.test' } };

test('auth readiness uses only core status and honors a blocked database', async t => {
  const calls = [];
  let database = 'blocked';
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push([path, options]); return json({ database }); });
  assert.equal(await authReady(), false);
  database = 'ready'; assert.equal(await authReady(), true);
  database = 'unknown'; await assert.rejects(authReady(), /readiness could not be verified/);
  assert(calls.every(([path, options]) => path === '/api/auth/status' && options.credentials === 'same-origin' && options.cache === 'no-store'));
});

test('sign-in is not successful until get-session confirms an account', async t => {
  let session = null;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push([path, options]); return json(path === '/api/auth/get-session' ? session : {}); });
  await assert.rejects(signIn('test@example.test', 'password'), /did not establish a session/);
  session = {};
  await assert.rejects(signIn('test@example.test', 'password'), /session could not be verified/);
  session = account; await signIn('test@example.test', 'password');
  assert.equal(calls[0][0], '/api/auth/sign-in/email');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { email: 'test@example.test', password: 'password' });
});

test('server errors, non-JSON, and network failures never become auth success', async t => {
  let response = () => json({ message: 'Invalid email or password' }, 401);
  t.mock.method(globalThis, 'fetch', async () => response());
  await assert.rejects(signIn('test@example.test', 'bad'), /Invalid email or password/);
  response = () => new Response('<html>Unavailable</html>', { status: 200 });
  await assert.rejects(authRequest('/api/auth/get-session'), /invalid response/);
  response = () => json({ error: { message: 'Storage unavailable' } }, 503);
  await assert.rejects(getSession(), /Storage unavailable/);
  response = () => { throw new Error('Network unavailable'); };
  await assert.rejects(authReady(), /Network unavailable/);
});

test('invited registration retains the compatibility alias and requires explicit confirmation', async t => {
  let result = { ok: false };
  const input = { token: 't'.repeat(43), name: 'Test user', email: 'test@example.test', password: 'test-password' };
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/acquisition/accept-invite');
    assert.deepEqual(JSON.parse(options.body), input);
    return json(result);
  });
  await assert.rejects(registerInvite(input), /registration was not confirmed/);
  result = { ok: true }; await registerInvite(input);
  result = { ok: 'true' }; await assert.rejects(registerInvite(input), /registration was not confirmed/);
});
