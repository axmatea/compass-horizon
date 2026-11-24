import { createHash } from 'node:crypto';
import { validateApplicationManifest } from '../generation/templates/lib/schema.mjs';
import { repositoryName } from './providers.mjs';
import { fail } from './security.mjs';

const manifestPath = 'manifest.json';
const maxBytes = 32 * 1024;
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const isRepositoryId = value => Number.isSafeInteger(value) && value > 0;

function target(input) {
  const repository = repositoryName(input.repository);
  const branch = input.branch;
  if (typeof branch !== 'string' || branch.length > 120 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(branch)) {
    fail(400, 'integration_invalid_branch');
  }
  return { repository, branch };
}

async function publicHead({ repository, branch }, request) {
  const base = `https://api.github.com/repos/${repository}`;
  const repo = await request(base);
  if (repo.private !== false || (repo.visibility && repo.visibility !== 'public') || repo.disabled === true
    || typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== repository.toLowerCase() || !isRepositoryId(repo.id)) {
    fail(403, 'integration_public_repository_required');
  }
  const ref = await request(`${base}/git/ref/heads/${branch}`);
  if (ref.ref !== `refs/heads/${branch}` || ref.object?.type !== 'commit' || !isSha(ref.object.sha)) {
    fail(409, 'integration_branch_changed');
  }
  return { base, repositoryId: repo.id, commitSha: ref.object.sha };
}

async function readManifest({ base, commitSha }, request) {
  const commit = await request(`${base}/git/commits/${commitSha}`);
  if (commit.sha !== commitSha || !isSha(commit.tree?.sha)) fail(502, 'integration_invalid_response');
  const tree = await request(`${base}/git/trees/${commit.tree.sha}`);
  if (tree.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree)) fail(502, 'integration_invalid_response');
  const matches = tree.tree.filter(entry => entry?.path === manifestPath);
  const entry = matches[0];
  if (matches.length !== 1 || entry.type !== 'blob' || entry.mode !== '100644' || !isSha(entry.sha)
    || !Number.isSafeInteger(entry.size) || entry.size < 2 || entry.size > maxBytes) fail(400, 'integration_manifest_required');
  const blob = await request(`${base}/git/blobs/${entry.sha}`, {}, 64 * 1024);
  if (blob.sha !== entry.sha || blob.size !== entry.size || blob.encoding !== 'base64' || typeof blob.content !== 'string') {
    fail(502, 'integration_invalid_response');
  }
  const encoded = blob.content.replace(/\r?\n/g, '');
  const bytes = Buffer.from(encoded, 'base64');
  const gitSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (bytes.length !== entry.size || bytes.toString('base64') !== encoded || gitSha !== entry.sha) fail(502, 'integration_invalid_response');
  let manifest;
  try { manifest = validateApplicationManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  catch { fail(400, 'integration_manifest_invalid'); }
  if (!manifest) fail(400, 'integration_manifest_invalid');
  return { manifest, blobSha: entry.sha };
}

function compatibleManifest(current, incoming) {
  if (incoming.kind !== current.kind || JSON.stringify(incoming.crm) !== JSON.stringify(current.crm)) {
    fail(409, 'integration_manifest_incompatible');
  }
  const prior = new Map(current.entity.fields.map(field => [field.key, field]));
  const next = new Map(incoming.entity.fields.map(field => [field.key, field]));
  for (const field of prior.values()) {
    const updated = next.get(field.key);
    if (!updated || field.type !== updated.type || (updated.required && !field.required)
      || (field.type === 'select' && field.options.some(option => !updated.options.includes(option)))) fail(409, 'integration_manifest_incompatible');
  }
  if (incoming.entity.fields.some(field => field.required && !prior.has(field.key))) fail(409, 'integration_manifest_incompatible');
  // Repository manifests cannot read or change locally uploaded image assets.
  return validateApplicationManifest({ ...incoming, assets: current.assets });
}

export function createGitHubManifestImporter({ box, now }) {
  const purpose = 'manifest-import-review';

  async function review(owner, input, { request, generation, application, contextVersion }) {
    const selected = target(input);
    const { base, repositoryId, commitSha } = await publicHead(selected, request);
    const remote = await readManifest({ base, commitSha }, request);
    const manifest = compatibleManifest(application.manifest, remote.manifest);
    const receipt = { ...selected, repositoryId, commitSha, blobSha: remote.blobSha, manifest,
      appId: application.id, version: application.version, contextVersion, generation, expiresAt: now() + 300000 };
    return { ...selected, commitSha, current: application.manifest, manifest,
      changed: JSON.stringify(manifest) !== JSON.stringify(application.manifest), ticket: box.seal(owner, 'github', purpose, receipt) };
  }

  async function apply(owner, ticket, { request, generation, application, contextVersion }) {
    if (typeof ticket !== 'string' || ticket.length > 40000) fail(400, 'integration_invalid_input');
    let receipt;
    try { receipt = box.open(owner, 'github', purpose, ticket); }
    catch { fail(409, 'integration_import_review_required'); }
    if (receipt.appId !== application.id || receipt.generation !== generation || receipt.expiresAt <= now()) {
      fail(409, 'integration_import_review_required');
    }
    if (receipt.version !== application.version) fail(409, 'version_conflict');
    if (receipt.contextVersion !== contextVersion) fail(409, 'project_context_conflict');
    const { repositoryId, commitSha } = await publicHead(target(receipt), request);
    if (repositoryId !== receipt.repositoryId || commitSha !== receipt.commitSha) fail(409, 'integration_branch_changed');
    if (receipt.expiresAt <= now()) fail(409, 'integration_import_review_required');
    return receipt;
  }

  return { review, apply };
}
