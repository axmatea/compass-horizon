import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIntegrations } from '../integrations/index.mjs';
import { createTransport } from '../integrations/security.mjs';
import { PROVIDERS } from '../integrations/providers.mjs';

const code = 'synthetic-authorization-code';
const denied = code => error => error.code === code && !error.cause;
function fixture(t, extra = {}) {
  const database = extra.database || new DatabaseSync(':memory:');
  if (!extra.database) t.after(() => database.close());
  let stamp = 1800000000000;
  const env = { NODE_ENV: 'test', COMPASS_INTEGRATIONS_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: 'https://compass-staging.test',
    COMPASS_INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    COMPASS_GITHUB_CLIENT_ID: 'github-test-client', COMPASS_GITHUB_CLIENT_SECRET: 'synthetic-github-client-secret',
    COMPASS_GOOGLE_CLIENT_ID: 'google-test-client', COMPASS_GOOGLE_CLIENT_SECRET: 'synthetic-google-client-secret',
    COMPASS_NOTION_CLIENT_ID: 'notion-test-client', COMPASS_NOTION_CLIENT_SECRET: 'synthetic-notion-client-secret', COMPASS_NOTION_READ_ONLY: 'true',
    COMPASS_SLACK_CLIENT_ID: '123.456', COMPASS_SLACK_CLIENT_SECRET: 'synthetic-slack-client-secret', COMPASS_SLACK_PKCE_ENABLED: 'true', ...extra.env };
  const calls = [], queue = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    const action = queue.shift();
    assert.ok(action, `Unexpected mock endpoint: ${new URL(url).origin}${new URL(url).pathname}`);
    return typeof action === 'function' ? action(url, options) : action;
  };
  const integrations = createIntegrations({ database, env, fetchImpl, now: () => stamp });
  const reply = (body, status = 200) => queue.push(Response.json(body, { status }));
  const flow = (owner, provider, options) => { const result = integrations.connect(owner, provider, options); return { ...result, state: new URL(result.authorizationUrl).searchParams.get('state') }; };
  const grant = async (owner = 'owner-a', provider = 'github', token = {}, options) => {
    const auth = flow(owner, provider, options);
    reply({ access_token: `synthetic-access-${owner}-${provider}`, token_type: provider === 'slack' ? 'bot' : 'bearer',
      ...(provider === 'slack' ? { ok: true } : {}), scope: auth.scopes.join(provider === 'github' || provider === 'slack' ? ',' : ' '), ...token });
    await integrations.callback(owner, provider, { state: auth.state, code });
    return auth;
  };
  return { integrations, database, env, fetchImpl, calls, queue, reply, flow, grant, advance: delta => { stamp += delta; } };
}

test('unconfigured, unsafe origins and incomplete provider config fail closed without requests or schema', t => {
  for (const env of [
    { COMPASS_INTEGRATIONS_MODE: '' }, { COMPASS_INTEGRATION_ENCRYPTION_KEY: '' }, { COMPASS_INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(44) },
    { COMPASS_ACCOUNT_ORIGIN: 'https://mycompass.world' }, { COMPASS_ACCOUNT_ORIGIN: 'https://www.mycompass.world' },
    { COMPASS_ACCOUNT_ORIGIN: 'https://MYCOMPASS.WORLD.' }, { COMPASS_ACCOUNT_ORIGIN: 'https://staging.test/path' },
    { COMPASS_ACCOUNT_ORIGIN: 'https://user:pass@staging.test' }, { COMPASS_ACCOUNT_ORIGIN: 'http://staging.test' },
    { COMPASS_ACCOUNT_ORIGIN: 'http://127.0.0.1:8770', NODE_ENV: 'production' },
  ]) {
    const f = fixture(t, { env });
    assert.equal(f.integrations.status('owner-a').enabled, false);
    assert.ok(f.integrations.status('owner-a').providers.every(p => !p.configured && !p.connected && p.state === 'external_blocked'));
    assert.throws(() => f.integrations.connect('owner-a', 'github'), denied('integration_external_blocked'));
    assert.equal(f.database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'compass_integration%'").get().count, 0);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(t, { env: { COMPASS_GITHUB_CLIENT_SECRET: '', COMPASS_NOTION_READ_ONLY: '', COMPASS_SLACK_PKCE_ENABLED: '' } });
  assert.equal(f.integrations.status('owner-a').providers.find(p => p.provider === 'github').configured, false);
  assert.equal(f.integrations.status('owner-a').providers.find(p => p.provider === 'notion').configured, false);
  assert.equal(f.integrations.status('owner-a').providers.find(p => p.provider === 'slack').configured, false);
  assert.throws(() => f.integrations.status({ userId: 'owner-a' }), denied('integration_owner_required'));
  assert.throws(() => f.integrations.connect('owner-a', '__proto__'), denied('integration_provider_unknown'));
});

test('authorization URLs use exact minimal scopes, exact callbacks and S256; verifier and state stay encrypted', async t => {
  const f = fixture(t);
  for (const [provider, def] of Object.entries(PROVIDERS)) {
    const auth = f.flow('owner-a', provider), url = new URL(auth.authorizationUrl);
    assert.equal(url.origin + url.pathname, def.server.authorization_endpoint);
    assert.equal(url.searchParams.get('redirect_uri'), `${f.env.COMPASS_ACCOUNT_ORIGIN}/api/account/integrations/${provider}/callback`);
    assert.deepEqual(auth.scopes, def.scopes);
    assert.equal(auth.stateCookie, null); assert.equal(auth.requiresVerifiedSession, true);
    assert.ok(!url.searchParams.has('client_secret')); assert.ok(!url.searchParams.has('access_token'));
    if (def.pkce) {
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    } else assert.equal(url.searchParams.has('code_challenge'), false);
    const stored = f.database.prepare('SELECT * FROM compass_integration_state WHERE owner=? AND provider=?').get('owner-a', provider);
    assert.ok(!JSON.stringify(stored).includes(auth.state));
    assert.equal(stored.state_hash, createHash('sha256').update(auth.state).digest('hex'));
    f.reply({ access_token: 'synthetic-access-pkce', token_type: provider === 'slack' ? 'bot' : 'bearer', ...(provider === 'slack' ? { ok: true } : {}), scope: auth.scopes.join(',') });
    await f.integrations.callback('owner-a', provider, { state: auth.state, code });
    const call = f.calls.at(-1);
    const params = provider === 'notion' ? JSON.parse(call.options.body) : Object.fromEntries(new URLSearchParams(call.options.body));
    assert.equal(call.url.href, def.server.token_endpoint); assert.equal(params.redirect_uri, url.searchParams.get('redirect_uri'));
    assert.equal(params.grant_type, 'authorization_code'); assert.equal(params.code, code);
    if (def.pkce) {
      assert.match(params.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
      assert.equal(createHash('sha256').update(params.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
      assert.ok(!JSON.stringify(stored).includes(params.code_verifier));
    }
    if (provider === 'slack') { assert.equal(params.client_secret, undefined); assert.equal(new Headers(call.options.headers).has('authorization'), false); }
    if (provider === 'notion') assert.equal(new Headers(call.options.headers).get('content-type'), 'application/json');
  }
  assert.equal(f.integrations.status('owner-a').providers.filter(p => p.connected).length, 7);
  assert.equal(f.integrations.status('owner-b').providers.filter(p => p.connected).length, 0);
  const publicJSON = JSON.stringify(f.integrations.status('owner-a'));
  assert.ok(!publicJSON.includes('synthetic-access')); assert.ok(!publicJSON.includes('synthetic-github-client-secret'));
});

test('state is bound to verified owner and provider, expires after ten minutes and is consumed once', async t => {
  const f = fixture(t), auth = f.flow('owner-a', 'github');
  await assert.rejects(f.integrations.callback('owner-b', 'github', { state: auth.state, code }), denied('integration_state_invalid'));
  await assert.rejects(f.integrations.callback('owner-a', 'google-drive', { state: auth.state, code }), denied('integration_state_invalid'));
  await assert.rejects(f.integrations.callback('owner-a', 'github', { state: 'x'.repeat(43), code }), denied('integration_state_invalid'));
  assert.equal(f.calls.length, 0);
  f.reply({ access_token: 'synthetic-bound-access', token_type: 'bearer', scope: 'read:user' });
  await f.integrations.callback('owner-a', 'github', { state: auth.state, code });
  await assert.rejects(f.integrations.callback('owner-a', 'github', { state: auth.state, code }), denied('integration_state_invalid'));
  const expired = f.flow('owner-a', 'github'); f.advance(600000);
  await assert.rejects(f.integrations.callback('owner-a', 'github', { state: expired.state, code }), denied('integration_state_invalid'));
  assert.equal(f.calls.length, 1);
  const replaced = f.flow('owner-a', 'github'); f.flow('owner-a', 'github');
  await assert.rejects(f.integrations.callback('owner-a', 'github', { state: replaced.state, code }), denied('integration_state_invalid'));
});

test('protocol errors, unexpected scopes and token types fail without raw upstream details or state reuse', async t => {
  const f = fixture(t);
  for (const payload of [
    { token_type: 'bearer' }, { access_token: 'synthetic' }, { access_token: 'synthetic', token_type: 'mac' },
    { access_token: 'synthetic', token_type: 'bearer', scope: 'read:user repo' },
    { access_token: 'synthetic', token_type: 'bearer', scope: '' },
    { access_token: 'synthetic', token_type: 'bearer', expires_in: -10 },
    { error: 'invalid_grant', error_description: 'upstream-private-detail' },
  ]) {
    const auth = f.flow('owner-a', 'github'); f.reply(payload);
    await assert.rejects(f.integrations.callback('owner-a', 'github', { state: auth.state, code }), error => {
      assert.ok(!JSON.stringify(error).includes('upstream-private-detail')); assert.equal(error.cause, undefined); return true;
    });
    assert.equal(f.integrations.status('owner-a').providers.find(p => p.provider === 'github').connected, false);
    await assert.rejects(f.integrations.callback('owner-a', 'github', { state: auth.state, code }), denied('integration_state_invalid'));
  }
  const slack = f.flow('owner-a', 'slack');
  f.reply({ ok: false, error: 'sensitive_detail', access_token: 'synthetic', token_type: 'bot' });
  await assert.rejects(f.integrations.callback('owner-a', 'slack', { state: slack.state, code }), denied('integration_token_rejected'));
});

test('on-disk SQLite stores no plaintext access token, refresh token or verifier and survives restart; key rotation fails closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compass-integrations-'));
  const path = join(directory, 'isolated.sqlite'), database = new DatabaseSync(path);
  t.after(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });
  const f = fixture(t, { database });
  await f.grant('owner-a', 'google-drive', { access_token: 'synthetic-disk-access', refresh_token: 'synthetic-disk-refresh', expires_in: 3600 });
  const bytes = await readFile(path);
  assert.ok(!bytes.includes(Buffer.from('synthetic-disk-access'))); assert.ok(!bytes.includes(Buffer.from('synthetic-disk-refresh')));
  const same = createIntegrations({ database, env: f.env, fetchImpl: f.fetchImpl });
  assert.equal(same.status('owner-a').providers.find(p => p.provider === 'google-drive').connected, true);
  const rotated = createIntegrations({ database, env: { ...f.env, COMPASS_INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64') }, fetchImpl: f.fetchImpl });
  assert.equal(rotated.status('owner-a').providers.find(p => p.provider === 'google-drive').state, 'reconnect_required');
  await assert.rejects(rotated.read('owner-a', 'google-drive'), denied('integration_key_or_ciphertext_invalid'));
  assert.equal((await rotated.disconnect('owner-a', 'google-drive')).remoteRevocation, 'unavailable');
  assert.equal(f.calls.length, 1);
});

test('AES associated data prevents moving ciphertext between owners or providers', async t => {
  const f = fixture(t); await f.grant();
  const sealed = f.database.prepare('SELECT credential FROM compass_integration WHERE owner=? AND provider=?').get('owner-a', 'github').credential;
  f.flow('owner-b', 'github'); f.flow('owner-a', 'google-drive');
  for (const [owner, provider] of [['owner-b', 'github'], ['owner-a', 'google-drive']]) {
    f.database.prepare('UPDATE compass_integration SET credential=? WHERE owner=? AND provider=?').run(sealed, owner, provider);
    await assert.rejects(f.integrations.read(owner, provider), denied('integration_key_or_ciphertext_invalid'));
  }
  assert.equal(f.calls.length, 1);
});

test('expired credentials refresh using the owner refresh token, persist rotation and never use another owner token', async t => {
  const f = fixture(t);
  await f.grant('owner-a', 'google-drive', { access_token: 'synthetic-old-a', refresh_token: 'synthetic-refresh-a', expires_in: 60 });
  await f.grant('owner-b', 'google-drive', { access_token: 'synthetic-old-b', refresh_token: 'synthetic-refresh-b', expires_in: 3600 });
  f.advance(61000);
  assert.equal(f.integrations.status('owner-a').providers.find(p => p.provider === 'google-drive').state, 'refresh_required');
  f.reply({ access_token: 'synthetic-new-a', token_type: 'bearer', refresh_token: 'synthetic-rotated-a', expires_in: 3600 });
  f.reply({ files: [{ id: 'file-a', name: 'A' }] });
  assert.equal((await f.integrations.read('owner-a', 'google-drive')).files[0].id, 'file-a');
  const refresh = new URLSearchParams(f.calls[2].options.body);
  assert.equal(refresh.get('grant_type'), 'refresh_token'); assert.equal(refresh.get('refresh_token'), 'synthetic-refresh-a');
  assert.equal(new Headers(f.calls[3].options.headers).get('authorization'), 'Bearer synthetic-new-a');
  f.reply({ files: [] }); await f.integrations.read('owner-b', 'google-drive');
  assert.equal(new Headers(f.calls[4].options.headers).get('authorization'), 'Bearer synthetic-old-b');
  f.advance(3601000); f.reply({ error: 'invalid_grant', error_description: 'private' }, 400);
  await assert.rejects(f.integrations.read('owner-a', 'google-drive'), denied('integration_reconnect_required'));
  assert.equal(new URLSearchParams(f.calls[5].options.body).get('refresh_token'), 'synthetic-rotated-a');
  await assert.rejects(f.integrations.read('owner-a', 'google-drive'), denied('integration_not_connected'));
});

test('expired tokens without refresh and upstream 401 require reconnect, with no fallback or raw provider errors', async t => {
  const f = fixture(t); await f.grant('owner-a', 'github', { expires_in: 5 }); f.advance(6000);
  await assert.rejects(f.integrations.read('owner-a', 'github'), denied('integration_reconnect_required'));
  await f.grant(); f.reply({ error: 'synthetic-sensitive-provider-error' }, 401);
  await assert.rejects(f.integrations.read('owner-a', 'github'), denied('integration_reconnect_required'));
  const count = f.calls.length;
  await assert.rejects(f.integrations.read('owner-b', 'github'), denied('integration_not_connected'));
  assert.equal(f.calls.length, count);
});

test('disconnect removes access immediately even during a callback or remote revocation failure', async t => {
  const f = fixture(t); await f.grant();
  f.queue.push(async () => {
    await assert.rejects(f.integrations.read('owner-a', 'github'), denied('integration_not_connected'));
    throw Error('synthetic-private-remote-failure');
  });
  assert.deepEqual(await f.integrations.disconnect('owner-a', 'github'), { provider: 'github', disconnected: true, remoteRevocation: 'failed' });
  const auth = f.flow('owner-a', 'github'); let unblock, started;
  const reached = new Promise(resolve => { started = resolve; });
  f.queue.push(() => { started(); return new Promise(resolve => { unblock = () => resolve(Response.json({ access_token: 'synthetic-late', token_type: 'bearer', scope: 'read:user' })); }); });
  const callback = f.integrations.callback('owner-a', 'github', { state: auth.state, code });
  await reached;
  assert.equal((await f.integrations.disconnect('owner-a', 'github')).disconnected, true);
  unblock(); await assert.rejects(callback, denied('integration_connection_changed'));
  assert.equal(f.integrations.status('owner-a').providers.find(p => p.provider === 'github').connected, false);
});

test('refresh is serialized across service instances and a concurrent disconnect cannot resurrect tokens', async t => {
  const f = fixture(t); await f.grant('owner-a', 'google-drive', { refresh_token: 'synthetic-refresh', expires_in: 5 }); f.advance(6000);
  const second = createIntegrations({ database: f.database, env: f.env, fetchImpl: f.fetchImpl, now: () => 1800000006000 });
  let unblock, started;
  const reached = new Promise(resolve => { started = resolve; });
  f.queue.push(() => { started(); return new Promise(resolve => { unblock = () => resolve(Response.json({ access_token: 'synthetic-late-refresh', token_type: 'bearer', expires_in: 3600 })); }); });
  const pending = f.integrations.read('owner-a', 'google-drive'); await reached;
  await assert.rejects(second.read('owner-a', 'google-drive'), denied('integration_refresh_in_progress'));
  f.reply({ error: 'revocation unavailable' }, 503); await second.disconnect('owner-a', 'google-drive');
  unblock(); await assert.rejects(pending, denied('integration_connection_changed'));
  await assert.rejects(f.integrations.read('owner-a', 'google-drive'), denied('integration_not_connected'));
});

test('official revocation adapters report remote success honestly and are owner scoped', async t => {
  for (const provider of ['github', 'google-drive', 'notion', 'slack']) {
    const f = fixture(t); await f.grant('owner-a', provider, { refresh_token: 'synthetic-revoke-refresh' });
    await f.grant('owner-b', provider);
    f.queue.push(provider === 'github' ? new Response(null, { status: 204 }) : provider === 'google-drive' ? new Response(null, { status: 200 }) : Response.json(provider === 'slack' ? { ok: true, revoked: true } : {}));
    assert.equal((await f.integrations.disconnect('owner-a', provider)).remoteRevocation, 'revoked');
    assert.equal(f.integrations.status('owner-b').providers.find(p => p.provider === provider).connected, true);
    const { url, options } = f.calls.at(-1);
    if (provider === 'github') { assert.equal(url.pathname, '/applications/github-test-client/token'); assert.equal(options.method, 'DELETE'); }
    if (provider === 'google-drive') { assert.equal(url.href, 'https://oauth2.googleapis.com/revoke'); assert.equal(new URLSearchParams(options.body).get('token'), 'synthetic-revoke-refresh'); }
    if (provider === 'notion') assert.equal(url.href, 'https://api.notion.com/v1/oauth/revoke');
    if (provider === 'slack') assert.equal(url.href, 'https://slack.com/api/auth.revoke');
  }
});

test('transport rejects untrusted, redirecting and oversized endpoints; timeout covers body consumption', async t => {
  let calls = 0;
  const transport = createTransport(async () => { calls++; return Response.json({}); });
  for (const url of ['http://api.github.com/user', 'https://api.github.com.evil.test/user', 'https://user:pass@api.github.com/user', 'https://api.github.com:444/user', 'https://127.0.0.1/user', 'https://api.github.com/user#token', 'https://api.github.com/redirect', 'https://sheets.googleapis.com.evil.test/v4/spreadsheets/id']) {
    await assert.rejects(transport(url), denied('integration_endpoint_refused'));
  }
  assert.equal(calls, 0);
  await assert.rejects(createTransport(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }))('https://api.github.com/user'), denied('integration_redirect_refused'));
  await assert.rejects(createTransport(async () => new Response('x'.repeat(200)))('https://api.github.com/user', {}, 100), denied('integration_response_too_large'));
  const start = Date.now();
  await assert.rejects(createTransport(async () => new Response(new ReadableStream({ start() {} })))('https://api.github.com/user'), denied('integration_timeout'));
  assert.ok(Date.now() - start < 10000);
});

test('GitHub write grant is separate and cannot be enabled by tokens or payloads', async t => {
  const f = fixture(t);
  assert.throws(() => f.flow('owner-a', 'github', { publicRepositoryExport: true }), denied('integration_export_not_enabled'));
  assert.throws(() => f.integrations.connect('owner-a', 'github', { accessToken: 'client-supplied' }), denied('integration_invalid_input'));
  await f.grant();
  await assert.rejects(f.integrations.exportGitHub('owner-a', {}), denied('integration_export_not_enabled'));
  const enabled = fixture(t, { env: { COMPASS_GITHUB_PUBLIC_EXPORT: 'true' } });
  await enabled.grant();
  await assert.rejects(enabled.integrations.exportGitHub('owner-a', {}), denied('integration_export_grant_required'));
  const auth = await enabled.grant('owner-a', 'github', {}, { publicRepositoryExport: true });
  assert.deepEqual(auth.scopes, ['read:user', 'public_repo']);
  const app = fixture(t, { env: { COMPASS_GITHUB_APP_MODE: 'true' } });
  const appAuth = app.flow('owner-a', 'github');
  assert.deepEqual(appAuth.scopes, []); assert.equal(new URL(appAuth.authorizationUrl).searchParams.has('scope'), false);
});

test('every bounded reader runs through the factory with actual SQLite and the correct provider grant', async t => {
  const f = fixture(t);
  const cases = [
    ['github', {}, [], 'https://api.github.com/user/repos'],
    ['google-drive', {}, { files: [] }, 'https://www.googleapis.com/drive/v3/files'],
    ['google-sheets', { spreadsheetId: 'explicit_spreadsheet', range: "'Sheet 1'!A1:B3" }, { values: [['text']] }, 'https://sheets.googleapis.com/v4/spreadsheets/explicit_spreadsheet/values/'],
    ['gmail', { messageId: 'message_1' }, { id: 'message_1', payload: { headers: [] } }, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/message_1'],
    ['google-calendar', { calendarId: 'name@example.test', timeMin: '2026-11-13T00:00:00Z', timeMax: '2026-11-14T00:00:00Z' }, { items: [] }, 'https://www.googleapis.com/calendar/v3/calendars/name%40example.test/events'],
    ['notion', { pageId: '11111111222233334444555555555555' }, { object: 'page', id: '11111111222233334444555555555555', properties: {} }, 'https://api.notion.com/v1/pages/11111111222233334444555555555555'],
    ['slack', {}, { ok: true, channels: [] }, 'https://slack.com/api/conversations.list'],
  ];
  for (const [provider, input, body, expected] of cases) {
    await f.grant('owner-a', provider, provider === 'notion' ? { refresh_token: null } : {});
    const count = f.calls.length; f.reply(body);
    if (provider === 'notion') f.reply({ results: [] });
    const result = await f.integrations.read('owner-a', provider, input);
    assert.ok(f.calls[count].url.href.startsWith(expected));
    for (const call of f.calls.slice(count)) assert.equal(new Headers(call.options.headers).get('authorization'), `Bearer synthetic-access-owner-a-${provider}`);
    assert.ok(!JSON.stringify(result).includes('synthetic-access'));
    const final = f.calls.length;
    await assert.rejects(f.integrations.read('owner-b', provider, input), denied('integration_not_connected'));
    assert.equal(f.calls.length, final);
  }
});

test('GitHub, Notion and Slack refresh use official grant encodings without expanding permissions', async t => {
  for (const provider of ['github', 'notion', 'slack']) {
    const f = fixture(t);
    await f.grant('owner-a', provider, { refresh_token: 'synthetic-initial-refresh', expires_in: 5 }); f.advance(6000);
    f.reply({ access_token: 'synthetic-refreshed-provider', token_type: provider === 'slack' ? 'bot' : 'bearer', ...(provider === 'slack' ? { ok: true } : {}), refresh_token: 'synthetic-rotated-refresh', expires_in: 3600 });
    const input = provider === 'notion' ? { pageId: '11111111222233334444555555555555' } : {};
    f.reply(provider === 'github' ? [] : provider === 'notion' ? { object: 'page', properties: {} } : { ok: true, channels: [] });
    if (provider === 'notion') f.reply({ results: [] });
    await f.integrations.read('owner-a', provider, input);
    const refresh = f.calls[1], params = provider === 'notion' ? JSON.parse(refresh.options.body) : Object.fromEntries(new URLSearchParams(refresh.options.body));
    assert.equal(refresh.url.href, PROVIDERS[provider].server.token_endpoint);
    assert.equal(params.grant_type, 'refresh_token'); assert.equal(params.refresh_token, 'synthetic-initial-refresh');
    if (provider === 'notion') assert.match(new Headers(refresh.options.headers).get('authorization'), /^Basic /);
    if (provider === 'slack') { assert.equal(params.client_id, '123.456'); assert.equal(params.client_secret, undefined); }
    assert.equal(new Headers(f.calls[2].options.headers).get('authorization'), 'Bearer synthetic-refreshed-provider');
  }
});

test('disconnect rejects an in-flight read result and Slack revocation errors never claim success', async t => {
  const f = fixture(t); await f.grant();
  let unblock, started; const reached = new Promise(resolve => { started = resolve; });
  f.queue.push(() => { started(); return new Promise(resolve => { unblock = () => resolve(Response.json([])); }); });
  const pending = f.integrations.read('owner-a', 'github'); await reached;
  f.queue.push(new Response(null, { status: 204 })); await f.integrations.disconnect('owner-a', 'github');
  unblock(); await assert.rejects(pending, denied('integration_connection_changed'));
  await f.grant('owner-a', 'slack'); f.reply({ ok: false, error: 'upstream-private-error' });
  assert.equal((await f.integrations.disconnect('owner-a', 'slack')).remoteRevocation, 'failed');
  await assert.rejects(f.integrations.read('owner-a', 'slack'), denied('integration_not_connected'));
});

test('disconnect while a buffered API response is parsed also rejects the completed read', async t => {
  const f = fixture(t); await f.grant();
  f.reply([]); f.queue.push(new Response(null, { status: 204 }));
  const original = Response.prototype.json;
  let interrupted = false;
  Response.prototype.json = async function () {
    const value = await original.call(this);
    if (!interrupted) { interrupted = true; await f.integrations.disconnect('owner-a', 'github'); }
    return value;
  };
  try { await assert.rejects(f.integrations.read('owner-a', 'github'), denied('integration_connection_changed')); }
  finally { Response.prototype.json = original; }
  assert.equal(interrupted, true);
});

test('malformed upstream data returns a safe error rather than an adapter exception', async t => {
  const f = fixture(t); await f.grant('owner-a', 'gmail');
  f.reply({ payload: { headers: [{ name: 42, value: 'upstream-private-detail' }] } });
  await assert.rejects(f.integrations.read('owner-a', 'gmail', { messageId: 'abc' }), denied('integration_invalid_response'));
});
