import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGitHubExporter, reviewGitHubExport } from '../integrations/github-export.mjs';
import { createIntegrations } from '../integrations/index.mjs';
import { randomBytes } from 'node:crypto';

const head = 'a'.repeat(40), committed = 'b'.repeat(40);
const payload = extra => ({ repository: 'test-owner/public-site', branch: 'compass/review-1', expectedHeadSha: head, requestKey: 'synthetic-request-key-0001', files: [{ path: 'index.html', content: '<h1>Review me</h1>\n' }], ...extra });
const repo = extra => ({ full_name: 'test-owner/public-site', private: false, visibility: 'public', archived: false, disabled: false, permissions: { push: true }, default_branch: 'main', ...extra });
function fixture(t, initial = []) {
  const database = new DatabaseSync(':memory:'); t.after(() => database.close());
  const calls = [], replies = [...initial];
  const request = async (url, options = {}) => {
    calls.push({ url, options }); const response = replies.shift(); assert.ok(response, `Unexpected endpoint: ${url}`);
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response(url, options) : response;
  };
  return { database, calls, replies, request, exportGitHub: createGitHubExporter({ database }) };
}
const successResponses = () => [repo(), { ref: 'refs/heads/compass/review-1', object: { type: 'commit', sha: head } }, { data: { createCommitOnBranch: { commit: { oid: committed } } } }];

test('review payload is bounded and includes file digests and byte counts without storing source', () => {
  const result = reviewGitHubExport(payload());
  assert.equal(result.files[0].path, 'index.html'); assert.equal(result.files[0].bytes, 19); assert.match(result.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes('Review me'));
  for (const branch of ['main', 'master', 'production', 'prod', 'live', 'gh-pages', 'feature/main', '../feature', 'feature..x', 'feature@{x}', 'refs/heads/main', 'feature%2Fmain']) assert.throws(() => reviewGitHubExport(payload({ branch })));
  for (const path of ['.env', '.env.example', 'config/.env.local', 'keys/private.key', 'keys/config.json', 'api-key.json', 'auth.json', 'credentials.json', 'service-account.json', 'private_key.txt', 'id_rsa', '.github/workflows/push.yml', 'src/../safe.js', '/absolute.js', 'src\\other.js', 'src/%2e%2e/file.js', 'src//file.js', 'src/file.js.', '.git/config', 'Dockerfile', 'railway.json', 'vercel.json', 'deploy.sh', 'token-cache.json']) {
    assert.throws(() => reviewGitHubExport(payload({ files: [{ path, content: 'x' }] })), `path ${path}`);
  }
  assert.throws(() => reviewGitHubExport(payload({ files: [{ path: 'a.js', content: 'x' }, { path: 'A.js', content: 'y' }] })));
  assert.throws(() => reviewGitHubExport(payload({ files: [{ path: 'a.txt', content: '-----BEGIN PRIVATE KEY-----' }] })));
  assert.throws(() => reviewGitHubExport(payload({ files: [{ path: 'a.js', content: '\0' }] })));
  assert.throws(() => reviewGitHubExport(payload({ files: [{ path: 'large.txt', content: 'a'.repeat(128 * 1024 + 1) }] })));
  assert.throws(() => reviewGitHubExport(payload({ files: Array.from({ length: 41 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' })) })));
  assert.throws(() => reviewGitHubExport(payload({ files: Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.txt`, content: 'x'.repeat(128 * 1024) })) })));
  assert.throws(() => reviewGitHubExport(payload({ expectedHeadSha: 'untrusted-ref' })));
  assert.throws(() => reviewGitHubExport(payload({ requestKey: 'too-short' })));
});

test('public feature branch export uses official atomic expectedHeadOid mutation with no force or deploy and replays once', async t => {
  const f = fixture(t, successResponses());
  const result = await f.exportGitHub('owner-a', payload(), { request: f.request });
  assert.equal(result.commitSha, committed); assert.equal(result.replay, false);
  assert.deepEqual(f.calls.slice(0, 2).map(c => c.url), ['https://api.github.com/repos/test-owner/public-site', 'https://api.github.com/repos/test-owner/public-site/git/ref/heads/compass/review-1']);
  const mutation = JSON.parse(f.calls[2].options.body);
  assert.equal(f.calls[2].url, 'https://api.github.com/graphql'); assert.equal(f.calls[2].options.method, 'POST');
  assert.equal(mutation.variables.input.expectedHeadOid, head);
  assert.deepEqual(mutation.variables.input.branch, { repositoryNameWithOwner: 'test-owner/public-site', branchName: 'compass/review-1' });
  assert.equal(Buffer.from(mutation.variables.input.fileChanges.additions[0].contents, 'base64').toString('utf8'), payload().files[0].content);
  assert.ok(!mutation.query.includes('updateRef')); assert.ok(!mutation.query.includes('force'));
  const replay = await f.exportGitHub('owner-a', payload(), { request: f.request }); assert.equal(replay.replay, true); assert.equal(f.calls.length, 3);
  assert.ok(!JSON.stringify(f.database.prepare('SELECT * FROM compass_integration_export WHERE owner=? AND provider=?').get('owner-a', 'github')).includes('Review me'));
  await assert.rejects(f.exportGitHub('owner-a', payload({ files: [{ path: 'index.html', content: 'different' }] }), { request: f.request }), { code: 'integration_idempotency_conflict' });
  f.replies.push(...successResponses()); await f.exportGitHub('owner-b', payload(), { request: f.request }); assert.equal(f.calls.length, 6);
});

test('private, unwritable, archived, renamed and default branch repositories never reach mutation', async t => {
  for (const data of [repo({ private: true }), repo({ permissions: { push: false } }), repo({ archived: true }), repo({ default_branch: 'compass/review-1' }), repo({ full_name: 'elsewhere/new-name' }), repo({ visibility: 'internal' }), repo({ disabled: true })]) {
    const f = fixture(t, [data]);
    await assert.rejects(f.exportGitHub('owner-a', payload(), { request: f.request })); assert.equal(f.calls.length, 1);
  }
});

test('changed head aborts before mutation; provider lease conflict cannot overwrite concurrent changes', async t => {
  const f = fixture(t, [repo(), { ref: 'refs/heads/compass/review-1', object: { type: 'commit', sha: 'c'.repeat(40) } }]);
  await assert.rejects(f.exportGitHub('owner-a', payload(), { request: f.request }), { code: 'integration_branch_changed' }); assert.equal(f.calls.length, 2);
  const racing = fixture(t, [repo(), { ref: 'refs/heads/compass/review-1', object: { type: 'commit', sha: head } }, { errors: [{ type: 'STALE_DATA', message: 'upstream-sensitive-detail' }] }]);
  await assert.rejects(racing.exportGitHub('owner-a', payload(), { request: racing.request }), error => error.code === 'integration_export_rejected_or_uncertain' && !error.message.includes('sensitive'));
  await assert.rejects(racing.exportGitHub('owner-a', payload(), { request: racing.request }), { code: 'integration_export_outcome_uncertain' }); assert.equal(racing.calls.length, 3);
});

test('lost mutation response is persisted as uncertain and never repeated on restart', async t => {
  const f = fixture(t, [repo(), { ref: 'refs/heads/compass/review-1', object: { type: 'commit', sha: head } }, new Error('mock network response lost')]);
  await assert.rejects(f.exportGitHub('owner-a', payload(), { request: f.request }));
  const restarted = createGitHubExporter({ database: f.database });
  await assert.rejects(restarted('owner-a', payload(), { request: f.request }), { code: 'integration_export_outcome_uncertain' }); assert.equal(f.calls.length, 3);
});

test('export snapshots reviewed contents before awaiting provider requests', async t => {
  const input = payload();
  const f = fixture(t, successResponses());
  f.replies[0] = () => { input.files[0].content = 'mutated after review'; return repo(); };
  await f.exportGitHub('owner-a', input, { request: f.request });
  const data = JSON.parse(f.calls[2].options.body);
  assert.equal(Buffer.from(data.variables.input.fileChanges.additions[0].contents, 'base64').toString(), payload().files[0].content);
});

test('factory export requires the owner grant and sends only its server-held token to official HTTPS', async t => {
  const database = new DatabaseSync(':memory:'); t.after(() => database.close());
  const calls = [], replies = [];
  const env = { COMPASS_INTEGRATIONS_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: 'https://compass-staging.test', COMPASS_INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    COMPASS_GITHUB_CLIENT_ID: 'synthetic-client', COMPASS_GITHUB_CLIENT_SECRET: 'synthetic-secret', COMPASS_GITHUB_PUBLIC_EXPORT: 'true' };
  const integrations = createIntegrations({ database, env, fetchImpl: async (url, options) => { calls.push({ url, options }); assert.equal(options.redirect, 'error'); return Response.json(replies.shift()); } });
  const auth = integrations.connect('owner-a', 'github', { publicRepositoryExport: true });
  replies.push({ access_token: 'synthetic-owner-a-export', token_type: 'bearer', scope: 'public_repo,read:user' });
  await integrations.callback('owner-a', 'github', { code: 'synthetic-code', state: new URL(auth.authorizationUrl).searchParams.get('state') });
  await assert.rejects(integrations.exportGitHub('owner-b', payload()), { code: 'integration_not_connected' });
  replies.push(...successResponses()); const result = await integrations.exportGitHub('owner-a', payload()); assert.equal(result.commitSha, committed);
  for (const call of calls.slice(1)) assert.equal(new Headers(call.options.headers).get('authorization'), 'Bearer synthetic-owner-a-export');
  assert.ok(!JSON.stringify(result).includes('synthetic-owner-a-export'));
});
