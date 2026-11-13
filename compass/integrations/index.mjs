import { randomBytes, createHash } from 'node:crypto';
import * as oauth from 'oauth4webapi';
import { IntegrationError, fail, ownerId, stagingConfig, secretBox, createTransport, responseJSON } from './security.mjs';
import { providerIds, providerDefinition, readProvider, validateReadInput } from './providers.mjs';
import { createGitHubExporter } from './github-export.mjs';
export { IntegrationError } from './security.mjs';

const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const tokenString = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\r\n\u0000]/.test(value);

// Only a verified server-session owner ID may be passed to these methods.
// This module never establishes identity from OAuth state or accepts tokens.
export function createIntegrations({ database, env = {}, fetchImpl = fetch, now = Date.now } = {}) {
  const config = stagingConfig(env);
  const enabled = !!(config && database?.prepare && database?.exec);
  const box = enabled ? secretBox(config.key) : null;
  const transport = createTransport(fetchImpl);
  const clock = () => Number(now());
  if (enabled) database.exec(`
    CREATE TABLE IF NOT EXISTS compass_integration (
      owner TEXT NOT NULL, provider TEXT NOT NULL, generation TEXT NOT NULL,
      credential TEXT, refresh_lock TEXT, refresh_until INTEGER, updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner, provider));
    CREATE TABLE IF NOT EXISTS compass_integration_state (
      owner TEXT NOT NULL, provider TEXT NOT NULL, state_hash TEXT NOT NULL, generation TEXT NOT NULL,
      sealed TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(owner, provider, state_hash));
  `);
  function credentials(provider) {
    const def = providerDefinition(provider);
    const prefix = `COMPASS_${def.prefix}`;
    const clientId = env[`${prefix}_CLIENT_ID`], clientSecret = env[`${prefix}_CLIENT_SECRET`];
    const configured = enabled && typeof clientId === 'string' && /^[A-Za-z0-9_.-]{1,250}$/.test(clientId)
      && tokenString(clientSecret)
      && (provider !== 'notion' || env.COMPASS_NOTION_READ_ONLY === 'true')
      && (provider !== 'slack' || (env.COMPASS_SLACK_PKCE_ENABLED === 'true' && config.origin.startsWith('https:')));
    return { configured: !!configured, def, clientId, clientSecret };
  }
  function requireConfigured(owner, provider) {
    ownerId(owner);
    const details = credentials(provider);
    if (!details.configured) fail(503, 'integration_external_blocked');
    return details;
  }
  function rowFor(owner, provider) {
    return database.prepare('SELECT * FROM compass_integration WHERE owner=? AND provider=?').get(owner, provider);
  }
  function active(owner, provider, row) {
    const current = rowFor(owner, provider);
    if (!current?.credential || current.generation !== row.generation || current.credential !== row.credential) fail(409, 'integration_connection_changed');
  }
  function invalidate(owner, provider, row) {
    database.prepare('UPDATE compass_integration SET credential=NULL, generation=?, refresh_lock=NULL, refresh_until=NULL, updated_at=? WHERE owner=? AND provider=? AND generation=? AND credential=?')
      .run(random(), clock(), owner, provider, row.generation, row.credential);
  }
  function metadata(owner, provider) {
    const { configured, def } = credentials(provider);
    let state = configured ? 'not_connected' : 'external_blocked', scopes = [...def.scopes], exportEnabled = false;
    if (configured) {
      const row = rowFor(owner, provider);
      if (row?.credential) {
        try {
          const token = box.open(owner, provider, 'credential', row.credential);
          scopes = token.scopes; exportEnabled = token.publicRepositoryExport === true;
          state = token.expiresAt && token.expiresAt <= clock() + 30000 ? (token.refreshToken ? 'refresh_required' : 'reconnect_required') : 'connected';
        } catch { state = 'reconnect_required'; }
      }
    }
    return { provider, label: def.label, configured, state, connected: state === 'connected', scopes,
      permissions: [...def.permissions, ...(exportEnabled ? ['Export reviewed files to an explicitly selected public feature branch'] : [])],
      ...(def.limitation ? { limitation: def.limitation } : {}), publicRepositoryExport: exportEnabled };
  }
  function status(owner) {
    ownerId(owner);
    return { enabled, mode: enabled ? 'staging' : 'off', providers: providerIds.map(provider => metadata(owner, provider)) };
  }
  function connect(owner, provider, options = {}) {
    const { def, clientId } = requireConfigured(owner, provider);
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'publicRepositoryExport')
      || (options.publicRepositoryExport !== undefined && typeof options.publicRepositoryExport !== 'boolean')) fail(400, 'integration_invalid_input');
    const publicRepositoryExport = options.publicRepositoryExport === true;
    if (publicRepositoryExport && (provider !== 'github' || env.COMPASS_GITHUB_PUBLIC_EXPORT !== 'true')) fail(403, 'integration_export_not_enabled');
    const appMode = provider === 'github' && env.COMPASS_GITHUB_APP_MODE === 'true';
    const scopes = appMode ? [] : [...def.scopes, ...(publicRepositoryExport ? ['public_repo'] : [])];
    const generation = random(), state = oauth.generateRandomState(), verifier = def.pkce ? oauth.generateRandomCodeVerifier() : null;
    const redirectUri = `${config.origin}/api/account/integrations/${provider}/callback`;
    // One outstanding flow per owner/provider. No writes touch another owner.
    database.prepare('DELETE FROM compass_integration_state WHERE owner=? AND provider=?').run(owner, provider);
    database.prepare(`INSERT INTO compass_integration(owner,provider,generation,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(owner,provider) DO UPDATE SET generation=excluded.generation,refresh_lock=NULL,refresh_until=NULL,updated_at=excluded.updated_at`).run(owner, provider, generation, clock());
    database.prepare('INSERT INTO compass_integration_state(owner,provider,state_hash,generation,sealed,expires_at) VALUES(?,?,?,?,?,?)')
      .run(owner, provider, digest(state), generation, box.seal(owner, provider, 'state', { state, verifier, scopes, redirectUri, publicRepositoryExport, appMode }), clock() + 600000);
    const url = new URL(def.server.authorization_endpoint);
    for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state })) url.searchParams.set(k, v);
    if (scopes.length) url.searchParams.set('scope', scopes.join(provider === 'slack' ? ',' : ' '));
    if (verifier) {
      // Node crypto produces the same RFC 7636 S256 challenge synchronously.
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      url.searchParams.set('code_challenge_method', 'S256');
    }
    if (def.prefix === 'GOOGLE') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); url.searchParams.set('include_granted_scopes', 'false'); }
    if (provider === 'notion') url.searchParams.set('owner', 'user');
    if (provider === 'github') url.searchParams.set('allow_signup', 'false');
    return { provider, authorizationUrl: url.href, scopes, permissions: [...def.permissions, ...(publicRepositoryExport ? ['Write reviewed files to selected public feature branch; public_repo is a broad public-repository OAuth grant'] : [])],
      expiresIn: 600, stateCookie: null, requiresVerifiedSession: true };
  }
  function clientInfo(provider, details) {
    const { def, clientId, clientSecret } = details;
    const client = { client_id: clientId };
    const authentication = def.auth === 'basic' ? oauth.ClientSecretBasic(clientSecret) : def.auth === 'none' ? oauth.None() : oauth.ClientSecretPost(clientSecret);
    const options = { [oauth.customFetch]: async (url, init) => {
      if (String(url) !== def.server.token_endpoint) fail(400, 'integration_endpoint_refused');
      const headers = new Headers(init.headers); headers.set('accept', 'application/json');
      let body = init.body;
      // Notion documents JSON token requests rather than form encoding. The
      // required OAuth response fields are still validated by oauth4webapi.
      if (provider === 'notion') { body = JSON.stringify(Object.fromEntries(new URLSearchParams(body))); headers.set('content-type', 'application/json'); headers.set('Notion-Version', '2026-03-11'); }
      const response = await transport(url, { ...init, headers, body }, 65536);
      if (provider === 'notion') {
        const payload = await responseJSON(response);
        // Notion documents refresh_token as nullable. Omission is the OAuth
        // representation for an absent optional token; do not fabricate one.
        if (payload.refresh_token === null) delete payload.refresh_token;
        return Response.json(payload, { status: response.status });
      }
      if (provider === 'slack') {
        const payload = await responseJSON(response);
        if (payload.ok !== true || payload.token_type !== 'bot' || !tokenString(payload.access_token) || payload.authed_user?.access_token) fail(502, 'integration_token_rejected');
        return Response.json(payload, { status: response.status });
      }
      return response;
    } };
    const processing = provider === 'slack' ? { recognizedTokenTypes: { bot: (_response, value) => { if (value.ok !== true) fail(502, 'integration_token_rejected'); } } } : undefined;
    return { client, authentication, options, processing };
  }
  function tokenRecord(provider, result, grant, previous) {
    if (!tokenString(result.access_token) || result.refresh_token !== undefined && !tokenString(result.refresh_token)
      || !['bearer', ...(provider === 'slack' ? ['bot'] : [])].includes(result.token_type)) fail(502, 'integration_token_rejected');
    const scopes = result.scope === undefined ? grant.scopes : result.scope.split(/[ ,]+/).filter(Boolean);
    // OAuth permits omission when unchanged. An explicitly returned grant must
    // exactly match the minimal requested set; fail closed on additive consent.
    if (scopes.length !== grant.scopes.length || grant.scopes.some(s => !scopes.includes(s))) fail(403, 'integration_scope_mismatch');
    if (result.expires_in !== undefined && (!Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 366 * 86400)) fail(502, 'integration_token_rejected');
    return { accessToken: result.access_token, refreshToken: result.refresh_token || (provider === 'notion' ? null : previous?.refreshToken) || null,
      expiresAt: result.expires_in ? clock() + result.expires_in * 1000 : null, scopes,
      publicRepositoryExport: grant.publicRepositoryExport === true, appMode: grant.appMode === true };
  }
  async function callback(owner, provider, input) {
    const details = requireConfigured(owner, provider), { def } = details;
    if (!input || Object.keys(input).some(k => !['state', 'code'].includes(k)) || typeof input.state !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(input.state)
      || typeof input.code !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(input.code)) fail(400, 'integration_invalid_callback');
    const stateRow = database.prepare('DELETE FROM compass_integration_state WHERE owner=? AND provider=? AND state_hash=? RETURNING *').get(owner, provider, digest(input.state));
    if (!stateRow || stateRow.expires_at <= clock() || rowFor(owner, provider)?.generation !== stateRow.generation) fail(400, 'integration_state_invalid');
    const grant = box.open(owner, provider, 'state', stateRow.sealed);
    const { client, authentication, options, processing } = clientInfo(provider, details);
    try {
      const params = oauth.validateAuthResponse(def.server, client, new URLSearchParams({ state: input.state, code: input.code }), grant.state);
      const response = await oauth.authorizationCodeGrantRequest(def.server, client, authentication, params, grant.redirectUri, grant.verifier || oauth.nopkce, options);
      const result = await oauth.processAuthorizationCodeResponse(def.server, client, response, processing);
      const token = tokenRecord(provider, result, grant);
      const update = database.prepare('UPDATE compass_integration SET credential=?,updated_at=? WHERE owner=? AND provider=? AND generation=?')
        .run(box.seal(owner, provider, 'credential', token), clock(), owner, provider, stateRow.generation);
      if (update.changes !== 1) fail(409, 'integration_connection_changed');
      return metadata(owner, provider);
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      fail(502, 'integration_oauth_rejected');
    }
  }
  async function access(owner, provider) {
    const details = requireConfigured(owner, provider);
    let row = rowFor(owner, provider);
    if (!row?.credential) fail(409, 'integration_not_connected');
    let token = box.open(owner, provider, 'credential', row.credential);
    if (token.expiresAt && token.expiresAt <= clock() + 30000) {
      if (!token.refreshToken) { invalidate(owner, provider, row); fail(409, 'integration_reconnect_required'); }
      const lock = random();
      const lease = database.prepare(`UPDATE compass_integration SET refresh_lock=?,refresh_until=? WHERE owner=? AND provider=? AND generation=? AND credential=? AND (refresh_until IS NULL OR refresh_until<=?)`)
        .run(lock, clock() + 15000, owner, provider, row.generation, row.credential, clock());
      if (lease.changes !== 1) fail(409, 'integration_refresh_in_progress');
      try {
        const { client, authentication, options, processing } = clientInfo(provider, details);
        const response = await oauth.refreshTokenGrantRequest(details.def.server, client, authentication, token.refreshToken, options);
        const result = await oauth.processRefreshTokenResponse(details.def.server, client, response, processing);
        const updated = tokenRecord(provider, result, token, token);
        const encrypted = box.seal(owner, provider, 'credential', updated);
        const saved = database.prepare('UPDATE compass_integration SET credential=?,refresh_lock=NULL,refresh_until=NULL,updated_at=? WHERE owner=? AND provider=? AND generation=? AND credential=? AND refresh_lock=?')
          .run(encrypted, clock(), owner, provider, row.generation, row.credential, lock);
        if (saved.changes !== 1) fail(409, 'integration_connection_changed');
        row = rowFor(owner, provider); token = updated;
      } catch (error) {
        invalidate(owner, provider, row);
        if (error instanceof IntegrationError) throw error;
        fail(409, 'integration_reconnect_required');
      }
    }
    return { row, token };
  }
  async function apiRequest(owner, provider, lease, url, options = {}) {
    requireConfigured(owner, provider); active(owner, provider, lease.row);
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${lease.token.accessToken}`); headers.set('accept', 'application/json');
    if (provider === 'github') { headers.set('accept', 'application/vnd.github+json'); headers.set('x-github-api-version', '2026-03-10'); headers.set('user-agent', 'COMPASS-Staging-Integrations'); }
    if (provider === 'notion') headers.set('notion-version', '2026-03-11');
    const response = await transport(url, { ...options, headers });
    active(owner, provider, lease.row);
    if (response.status === 401) { invalidate(owner, provider, lease.row); fail(409, 'integration_reconnect_required'); }
    if (!response.ok) fail(response.status === 429 ? 429 : 502, response.status === 429 ? 'integration_rate_limited' : 'integration_provider_rejected');
    const result = await responseJSON(response, provider === 'github');
    active(owner, provider, lease.row);
    if (provider === 'slack' && result.ok !== true) {
      if (['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive'].includes(result.error)) { invalidate(owner, provider, lease.row); fail(409, 'integration_reconnect_required'); }
      fail(502, 'integration_provider_rejected');
    }
    return result;
  }
  async function read(owner, provider, input = {}) {
    requireConfigured(owner, provider); validateReadInput(provider, input);
    const lease = await access(owner, provider);
    try {
      const result = await readProvider(provider, input, (url, options) => apiRequest(owner, provider, lease, url, options));
      active(owner, provider, lease.row);
      return result;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      fail(502, 'integration_invalid_response');
    }
  }
  async function disconnect(owner, provider) {
    ownerId(owner); providerDefinition(provider);
    if (!enabled) return { provider, disconnected: true, remoteRevocation: 'unavailable' };
    const row = rowFor(owner, provider);
    // Invalidate the lease and pending flows BEFORE any outbound work.
    database.prepare('DELETE FROM compass_integration_state WHERE owner=? AND provider=?').run(owner, provider);
    database.prepare('UPDATE compass_integration SET credential=NULL,generation=?,refresh_lock=NULL,refresh_until=NULL,updated_at=? WHERE owner=? AND provider=?')
      .run(random(), clock(), owner, provider);
    if (!row?.credential) return { provider, disconnected: true, remoteRevocation: 'not_needed' };
    let token;
    try { token = box.open(owner, provider, 'credential', row.credential); } catch { return { provider, disconnected: true, remoteRevocation: 'unavailable' }; }
    const details = credentials(provider);
    if (!details.configured) return { provider, disconnected: true, remoteRevocation: 'unavailable' };
    let remoteRevocation = 'failed';
    try {
      let response;
      if (details.def.prefix === 'GOOGLE') response = await transport('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: token.refreshToken || token.accessToken }) }, 65536);
      if (provider === 'github') response = await transport(`https://api.github.com/applications/${details.clientId}/token`, { method: 'DELETE', headers: { authorization: `Basic ${Buffer.from(details.clientId + ':' + details.clientSecret).toString('base64')}`, accept: 'application/vnd.github+json', 'user-agent': 'COMPASS-Staging-Integrations', 'content-type': 'application/json', 'x-github-api-version': '2026-03-10' }, body: JSON.stringify({ access_token: token.accessToken }) }, 65536);
      if (provider === 'notion') response = await transport('https://api.notion.com/v1/oauth/revoke', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(details.clientId + ':' + details.clientSecret).toString('base64')}`, 'content-type': 'application/json', 'notion-version': '2026-03-11' }, body: JSON.stringify({ token: token.accessToken }) }, 65536);
      if (provider === 'slack') {
        response = await transport('https://slack.com/api/auth.revoke', { method: 'POST', headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams() }, 65536);
        const value = await responseJSON(response); if (!value.ok || value.revoked !== true) fail(502, 'integration_revocation_failed');
      }
      if (response?.ok) remoteRevocation = 'revoked';
    } catch { /* Deliberately report only a safe status; local access is gone. */ }
    return { provider, disconnected: true, remoteRevocation,
      ...(details.def.prefix === 'GOOGLE' ? { notice: 'Google revocation can also invalidate other grants for this OAuth application.' } : {}) };
  }
  const exporter = enabled ? createGitHubExporter({ database, now: clock }) : null;
  async function exportGitHub(owner, input) {
    requireConfigured(owner, 'github');
    if (env.COMPASS_GITHUB_PUBLIC_EXPORT !== 'true') fail(403, 'integration_export_not_enabled');
    const lease = await access(owner, 'github');
    if (!lease.token.publicRepositoryExport || !lease.token.appMode && !lease.token.scopes.includes('public_repo')) fail(403, 'integration_export_grant_required');
    return exporter(owner, input, { request: (url, options) => apiRequest(owner, 'github', lease, url, options) });
  }
  return Object.freeze({ status, connect, callback, disconnect, read, exportGitHub });
}
