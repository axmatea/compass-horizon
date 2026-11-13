import { createHash } from 'node:crypto';
import { IntegrationError, fail, ownerId } from './security.mjs';
import { repositoryName } from './providers.mjs';

const sha256 = content => createHash('sha256').update(content).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const plain = value => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const mutation = `mutation CompassReviewedExport($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;
const forbiddenPath = /(?:^|\/)(?:\.env(?:\..*)?|\.git(?:hub)?|\.aws|\.ssh|\.npmrc|\.netrc|\.pypirc|\.docker|keys?|(?:auth|oauth)\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*(?:secret|credential|password|token|(?:private|api|access)[_-]?key|keystore|service[_-]?account).*|.*\.(?:pem|key|p12|pfx|jks|sqlite|db)|(?:dockerfile|procfile|railway\.json|vercel\.json|netlify\.toml))(?=\/|$)/i;
// Restrict to source/documentation/assets; never publish workflows, executable
// shell hooks, deployment configuration, credential bundles, or hidden paths.
const extension = /\.(?:html|css|js|mjs|cjs|jsx|ts|tsx|json|md|txt|svg|xml|csv|toml|yaml|yml)$/i;
export function reviewGitHubExport(input) {
  if (!plain(input) || Object.keys(input).some(k => !['repository', 'branch', 'expectedHeadSha', 'files', 'requestKey'].includes(k))) fail(400, 'integration_invalid_export');
  const repository = repositoryName(input.repository);
  const { branch, expectedHeadSha, requestKey } = input;
  // An existing, explicitly selected feature branch is required. No branch
  // creation, default/main updates, merge, deployment, or force operation.
  if (typeof branch !== 'string' || branch.length > 120 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(branch)
    || branch.split('/').some(part => /^(?:main|master|production|prod|live|deploy|release|gh-pages)$/i.test(part))) fail(400, 'integration_feature_branch_required');
  if (!sha(expectedHeadSha) || typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestKey)) fail(400, 'integration_invalid_export');
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 40) fail(400, 'integration_file_limit');
  let bytes = 0; const paths = new Set();
  const files = input.files.map(file => {
    if (!plain(file) || Object.keys(file).some(k => !['path', 'content'].includes(k)) || typeof file.path !== 'string' || file.path.length > 200
      || !/^[A-Za-z0-9_/-][A-Za-z0-9_./-]*$/.test(file.path) || !extension.test(file.path)
      || file.path.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part === '..')
      || forbiddenPath.test(file.path) || paths.has(file.path.toLowerCase()) || typeof file.content !== 'string'
      || file.content.includes('\0') || /-----BEGIN (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/.test(file.content)) fail(400, 'integration_unsafe_file');
    const size = Buffer.byteLength(file.content, 'utf8'); bytes += size;
    if (size > 128 * 1024 || bytes > 512 * 1024) fail(400, 'integration_byte_limit');
    paths.add(file.path.toLowerCase());
    return { path: file.path, bytes: size, sha256: sha256(file.content) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  // This summary can be shown before the root UI requests export confirmation.
  return { repository, branch, expectedHeadSha, requestKey, files, bytes };
}

export function createGitHubExporter({ database, now = Date.now }) {
  database.exec(`CREATE TABLE IF NOT EXISTS compass_integration_export (
    owner TEXT NOT NULL, provider TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
    state TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY(owner,provider,request_key));`);
  return async function exportGitHub(owner, input, { request }) {
    ownerId(owner);
    const review = reviewGitHubExport(input), hash = sha256(JSON.stringify(review));
    const snapshot = input.files.map(file => ({ path: file.path, content: file.content }));
    const previous = database.prepare('SELECT * FROM compass_integration_export WHERE owner=? AND provider=? AND request_key=?').get(owner, 'github', review.requestKey);
    if (previous) {
      if (previous.request_hash !== hash) fail(409, 'integration_idempotency_conflict');
      if (previous.state === 'succeeded') return { ...JSON.parse(previous.result), replay: true };
      fail(409, previous.state === 'uncertain' ? 'integration_export_outcome_uncertain' : 'integration_export_already_attempted');
    }
    const inserted = database.prepare(`INSERT INTO compass_integration_export(owner,provider,request_key,request_hash,state,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(owner,provider,request_key) DO NOTHING`).run(owner, 'github', review.requestKey, hash, 'running', Number(now()));
    if (inserted.changes !== 1) fail(409, 'integration_export_already_attempted');
    let mutationStarted = false;
    try {
      const base = `https://api.github.com/repos/${review.repository}`;
      const repo = await request(base);
      if (repo.private !== false || repo.visibility && repo.visibility !== 'public' || repo.archived !== false || repo.disabled === true || repo.permissions?.push !== true
        || typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== review.repository.toLowerCase()) fail(403, 'integration_public_writable_repository_required');
      if (repo.default_branch === review.branch) fail(403, 'integration_default_branch_refused');
      const ref = await request(`${base}/git/ref/heads/${review.branch}`);
      if (ref.ref !== `refs/heads/${review.branch}` || ref.object?.type !== 'commit' || ref.object.sha !== review.expectedHeadSha) fail(409, 'integration_branch_changed');
      const additions = snapshot.sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ path: file.path, contents: Buffer.from(file.content, 'utf8').toString('base64') }));
      mutationStarted = true;
      // expectedHeadOid is GitHub's atomic compare-and-swap. A REST ref update
      // with force:false alone would provide a weaker fast-forward guarantee.
      const data = await request('https://api.github.com/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: mutation, variables: { input: {
        branch: { repositoryNameWithOwner: review.repository, branchName: review.branch }, expectedHeadOid: review.expectedHeadSha,
        message: { headline: 'COMPASS reviewed staging export' }, fileChanges: { additions },
        clientMutationId: sha256(JSON.stringify([owner, review.requestKey])),
      } } }) });
      const commitSha = data.data?.createCommitOnBranch?.commit?.oid;
      if (data.errors?.length || !sha(commitSha)) fail(409, 'integration_export_rejected_or_uncertain');
      const result = { ...review, commitSha, commitUrl: `https://github.com/${review.repository}/commit/${commitSha}`, replay: false };
      database.prepare("UPDATE compass_integration_export SET state='succeeded',result=? WHERE owner=? AND provider=? AND request_key=? AND request_hash=? AND state='running'")
        .run(JSON.stringify(result), owner, 'github', review.requestKey, hash);
      return result;
    } catch (error) {
      database.prepare("UPDATE compass_integration_export SET state=? WHERE owner=? AND provider=? AND request_key=? AND request_hash=? AND state='running'")
        .run(mutationStarted ? 'uncertain' : 'failed', owner, 'github', review.requestKey, hash);
      if (error instanceof IntegrationError) throw error;
      fail(502, 'integration_export_provider_unavailable');
    }
  };
}
