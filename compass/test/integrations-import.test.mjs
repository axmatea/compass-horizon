import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createApplicationManifest } from '../generation/manifest.mjs';
import { createGitHubManifestImporter } from '../integrations/github-import.mjs';
import { secretBox } from '../integrations/security.mjs';

const repo = 'synthetic-owner/sample-app';
const selected = { repository: repo, branch: 'compass/refine' };
const commitSha = 'a'.repeat(40), treeSha = 'b'.repeat(40);
const repoResponse = { id: 42, full_name: repo, private: false, visibility: 'public' };
const refResponse = { ref: 'refs/heads/' + selected.branch, object: { type: 'commit', sha: commitSha } };
const old = createApplicationManifest('A task tracker called Launch QA');
const remote = { ...old, title: 'Updated launch', theme: { ...old.theme, accent: 'amber' } };

function fixture(manifest = remote) {
  const bytes = Buffer.from(JSON.stringify(manifest));
  const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const entry = { path: 'manifest.json', mode: '100644', type: 'blob', size: bytes.length, sha: blobSha };
  const replies = [structuredClone(repoResponse), structuredClone(refResponse), { sha: commitSha, tree: { sha: treeSha } },
    { sha: treeSha, truncated: false, tree: [entry] }, { sha: blobSha, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') }];
  const calls = [];
  let clock = 1000;
  const importer = createGitHubManifestImporter({ box: secretBox(randomBytes(32)), now: () => clock });
  const scope = { application: { id: 'project-test', version: 1, manifest: old }, contextVersion: 2, generation: 'test-owner-generation',
    request: async (url, options, limit) => { calls.push({ url, options, limit }); assert.ok(replies.length); return replies.shift(); } };
  return { ...importer, scope, replies, calls, advance: ms => { clock += ms; } };
}

test('manifest review pins a regular Git blob and retains local assets and record compatibility', async () => {
  const f = fixture({ ...remote, assets: { logo: 'asset_from-other-project' } });
  f.scope.application.manifest = { ...old, assets: { logo: 'asset_existing' } };
  const review = await f.review('owner-a', selected, f.scope);
  assert.equal(review.changed, true);
  assert.equal(review.commitSha, commitSha);
  assert.equal(review.manifest.title, remote.title);
  assert.equal(review.current.title, old.title);
  assert.deepEqual(review.manifest.assets, { logo: 'asset_existing' });
  assert.equal(JSON.stringify(review).includes('asset_from-other-project'), false);
  assert.equal(review.ticket.includes(remote.title), false);
  const api = `https://api.github.com/repos/${repo}`;
  assert.deepEqual(f.calls.map(call => call.url).slice(0, 4), [api, `${api}/git/ref/heads/${selected.branch}`, `${api}/git/commits/${commitSha}`, `${api}/git/trees/${treeSha}`]);
  assert.match(f.calls[4].url, /\/git\/blobs\/[a-f0-9]{40}$/);
  assert.equal(f.calls[4].limit, 64 * 1024);
  f.replies.push(repoResponse, refResponse);
  const approved = await f.apply('owner-a', review.ticket, f.scope);
  assert.deepEqual(approved.manifest, review.manifest);
  assert.equal(approved.version, f.scope.application.version);
  assert.equal(approved.contextVersion, f.scope.contextVersion);
  assert.equal(f.calls.some(call => call.options?.method && call.options.method !== 'GET'), false);
});

test('manifest review rejects non-public targets, unsafe branches, symlink manifests, and incompatible schema changes', async () => {
  const wrongBranch = fixture();
  await assert.rejects(wrongBranch.review('owner-a', {...selected,branch:'../main'}, wrongBranch.scope), {code:'integration_invalid_branch'});
  assert.equal(wrongBranch.calls.length, 0);
  const privateRepo = fixture(); privateRepo.replies[0].private = true;
  await assert.rejects(privateRepo.review('owner-a', selected, privateRepo.scope), {code:'integration_public_repository_required'});
  assert.equal(privateRepo.calls.length, 1);
  const symlink = fixture(); symlink.replies[3].tree[0].mode = '120000';
  await assert.rejects(symlink.review('owner-a', selected, symlink.scope), {code:'integration_manifest_required'});
  assert.equal(symlink.calls.length, 4);
  const altered = fixture(); altered.replies[4].content = Buffer.alloc(altered.replies[4].size, 'a').toString('base64');
  await assert.rejects(altered.review('owner-a', selected, altered.scope), {code:'integration_invalid_response'});
  const changedKind = fixture({...remote,kind:'inventory'});
  await assert.rejects(changedKind.review('owner-a', selected, changedKind.scope), {code:'integration_manifest_incompatible'});
  const removedField = fixture({...remote,entity:{...remote.entity,fields:remote.entity.fields.slice(1)}});
  await assert.rejects(removedField.review('owner-a', selected, removedField.scope), {code:'integration_manifest_incompatible'});
});

test('manifest apply binds each review to owner, connection, app, context, repository, commit, and expiry', async () => {
  const f = fixture();
  const { ticket } = await f.review('owner-a', selected, f.scope);
  await assert.rejects(f.apply('owner-b', ticket, f.scope), {code:'integration_import_review_required'});
  await assert.rejects(f.apply('owner-a', ticket, {...f.scope,generation:'reconnected'}), {code:'integration_import_review_required'});
  await assert.rejects(f.apply('owner-a', ticket, {...f.scope,application:{...f.scope.application,id:'other-app'}}), {code:'integration_import_review_required'});
  await assert.rejects(f.apply('owner-a', ticket, {...f.scope,application:{...f.scope.application,version:2}}), {code:'version_conflict'});
  await assert.rejects(f.apply('owner-a', ticket, {...f.scope,contextVersion:3}), {code:'project_context_conflict'});
  assert.equal(f.calls.length, 5);
  f.replies.push(repoResponse, {...refResponse,object:{type:'commit',sha:'c'.repeat(40)}});
  await assert.rejects(f.apply('owner-a', ticket, f.scope), {code:'integration_branch_changed'});
  f.replies.push({...repoResponse,id:repoResponse.id+1}, refResponse);
  await assert.rejects(f.apply('owner-a', ticket, f.scope), {code:'integration_branch_changed'});
  f.advance(300000);
  await assert.rejects(f.apply('owner-a', ticket, f.scope), {code:'integration_import_review_required'});
  assert.equal(f.calls.length, 9);
});
