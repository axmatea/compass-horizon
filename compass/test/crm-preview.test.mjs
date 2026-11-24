import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCrmPreviewRenderer} from '../generation/crm/preview.mjs';
import {createApplicationManifest} from '../generation/manifest.mjs';

const manifest = createApplicationManifest('Build a CRM named Ember Studio with a pipeline');
const unavailable = {code: 'crm_preview_unavailable', status: 503};
const script = 'document.querySelector("#crm-root").textContent = "Ready";\n';
const style = '#crm-root { color: navy; }\n';
const hash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

async function buildOutput(t) {
  const root = await mkdtemp(join(tmpdir(), 'compass-crm-preview-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const output = join(root, 'internal-crm');
  await mkdir(output);
  return {root, output, write: (name, value) => writeFile(join(output, name), value)};
}

test('trusted assets use exact frame CSP hashes and CRM text is inert', async t => {
  const {root, write} = await buildOutput(t);
  await Promise.all([write('crm.js', script.replaceAll('\n', '\r\n')), write('crm.css', style)]);
  const renderer = createCrmPreviewRenderer(root);
  const title = 'A & B </title><script>blocked()</script>';
  const description = '</script><svg/onload=blocked()> & \u2028 \u2029 end';
  const document = await renderer.render({...manifest, title, description});
  assert.ok(document.startsWith('<!doctype html>'));
  assert.ok(document.includes('<title>A &amp; B &lt;/title&gt;&lt;script&gt;blocked()&lt;/script&gt;</title>'));
  assert.ok(document.includes('<div id="crm-root"></div>'));
  const data = document.match(/<script type="application\/json" id="crm-manifest">([^<]+)<\/script>/)?.[1];
  assert.ok(data);
  assert.doesNotMatch(data, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(data), {title, description, theme: manifest.theme, crm: manifest.crm});
  assert.ok(document.includes(`<script>${script}</script>`));
  assert.ok(document.includes(`<style>${style}</style>`));
  assert.ok(document.includes(`script-src ${hash(script)}; style-src ${hash(style)}; connect-src 'none'`));
  assert.equal(await renderer.scriptHash(), hash(script));
  assert.match(document, /object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'/);
  assert.doesNotMatch(document, /<svg|<script>blocked/);
});

test('a preview requires a valid CRM and bounded, safe build files', async t => {
  const {root, output, write} = await buildOutput(t);
  const renderer = createCrmPreviewRenderer(root);
  await assert.rejects(renderer.render({...manifest, kind: 'tracker'}), {code: 'invalid_manifest', status: 400});
  await assert.rejects(renderer.render(createApplicationManifest('Build a contact workspace')), {code: 'invalid_manifest', status: 400});
  await assert.rejects(renderer.render(manifest), unavailable);
  await write('crm.css', style);
  for (const input of ['console.log("</ScRiPt>")', '/* <!-- */', Buffer.from([0xc0, 0x80]), Buffer.alloc(1024 * 1024 + 1)]) {
    await write('crm.js', input);
    await assert.rejects(renderer.scriptHash(), unavailable);
  }
  await rm(join(output, 'crm.js'));
  await symlink('crm.css', join(output, 'crm.js'));
  await assert.rejects(renderer.scriptHash(), unavailable);
  await rm(join(output, 'crm.js'));
  await write('crm.js', script);
  await write('crm.css', 'p::before { content: "</STYLE>" }');
  await assert.rejects(renderer.render(manifest), unavailable);
  await write('crm.css', style);
  assert.equal(await renderer.scriptHash(), hash(script));
});

test('separate static roots keep independent immutable hashes', async t => {
  const first = await buildOutput(t), second = await buildOutput(t);
  const alternative = 'console.log("A separate immutable build");\n';
  await Promise.all([first.write('crm.js', script), first.write('crm.css', style), second.write('crm.js', alternative), second.write('crm.css', style)]);
  const a = createCrmPreviewRenderer(first.root), b = createCrmPreviewRenderer(second.root);
  assert.deepEqual(await Promise.all([a.scriptHash(), b.scriptHash()]), [hash(script), hash(alternative)]);
  await first.write('crm.js', alternative);
  assert.equal(await a.scriptHash(), hash(script));
  assert.ok((await a.render(manifest)).includes(`<script>${script}</script>`));
});
