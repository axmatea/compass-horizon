import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { corePage } from './routes.ts';
import { workspaceReturn, afterSignupLocation } from './auth/login-return.ts';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('only core routes map to HTML and invitation query parameters survive', () => {
  assert.equal(corePage('/'), '/index.html');
  assert.equal(corePage('/app?demo=1'), '/app.html?demo=1');
  assert.equal(corePage('/office/?workspaceInvite=token'), '/app.html?workspaceInvite=token');
  assert.equal(corePage('/login/?returnTo=%2Fapp&token=token'), '/login.html?returnTo=%2Fapp&token=token');
  for (const route of ['/demo', '/demo/workspace', '/demo/remaster/app', '/voice-demo', '/presentation', '/presentation/finale', '/protect', '/horizon', '/studio', '/vision', '/live', '/acquisition', '/acquisition/app', '/missing']) assert.equal(corePage(route), undefined, route);
});

test('auth redirects stay internal and never revive retired products', () => {
  const token = 'a'.repeat(43);
  assert.equal(workspaceReturn('/login/', `?returnTo=/app&workspaceInvite=${token}`), `/app?workspaceInvite=${token}`);
  assert.equal(afterSignupLocation('/login', `?returnTo=/app&workspaceInvite=${token}&token=${token}`), `/login?returnTo=/app&workspaceInvite=${token}`);
  for (const destination of ['https://example.test', '//example.test', '/demo/remaster/app', '/acquisition/app']) {
    assert.equal(workspaceReturn('/login', `?returnTo=${encodeURIComponent(destination)}`), null);
    assert.equal(afterSignupLocation('/login', `?returnTo=${encodeURIComponent(destination)}`), '/login?returnTo=/app');
  }
  assert.equal(workspaceReturn('/login', '?returnTo=/app&workspaceInvite=invalid'), '/app');
});

test('home links target existing anchors or the core office/login pages, with no embedded demo', async () => {
  const html = await read('index.html');
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    if (href.startsWith('#')) assert(html.includes(`id="${href.slice(1)}"`), href);
    else assert(['/', '/app', '/login'].includes(href), href);
  }
  assert.doesNotMatch(html, /Try it live|yourcompany\.ai|page-pricing|page-build|voice-builder|overture|href="\/(demo|presentation|horizon|studio|vision|protect|acquisition)/i);
  assert.doesNotMatch(await read('src/site/landing.js'), /fetch\(|EventSource|WebSocket|overture|setStep/);
});

test('build entries, public pages, and shared brand dependencies are core-only', async () => {
  const config = await read('vite.config.ts');
  assert(config.includes("appType: 'mpa'"));
  assert.deepEqual([...config.matchAll(/new URL\("\.\/([^\"]+\.html)"/g)].map(match => match[1]).sort(), ['app.html', 'index.html', 'login.html']);
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.html')).sort(), ['app.html', 'index.html', 'login.html']);
  assert(!(await readdir(new URL('public/', root))).some(name => name.endsWith('.html') || name === 'acquisition'));
  for (const path of ['app.html', 'login.html', 'src/auth/styles.css', 'src/workspace/styles.css', 'public/manifest.webmanifest']) {
    const source = await read(path);
    assert.doesNotMatch(source, /\/acquisition\//, path);
    for (const [, asset] of source.matchAll(/['"](\/brand\/[^'"]+)['"]/g)) await access(new URL(`public${asset}`, root));
  }
  await access(new URL('public/brand/fonts/OFL.txt', root));
});

test('private workspace has no public mode, demo mutation, or fixture imports', async () => {
  const entry = await read('src/entry.tsx');
  assert.deepEqual([...entry.matchAll(/import\('([^']+)'\)/g)].map(match => match[1]), ['./workspace/App']);
  const hook = await read('src/workspace/useWorkspace.ts');
  assert.doesNotMatch(hook, /createDemo|localChange|demoProjects|if \(demo\)/);
  assert.match(hook, /fetchSnapshot/);
  assert.match(hook, /version: task.version/);
  assert.match(hook, /Workspace membership was not confirmed/);
  const ui = await read('src/workspace/App.tsx');
  assert.doesNotMatch(ui, /LOCAL_DEMO|Explore demo|SCRIPTED DEMO|demo=|kind === 'proposal'/);
  assert.match(ui, /parseTaskCSV/);
  assert.match(ui, /model.acceptInvite/);
  assert.match(ui, /model.error \? 'Unavailable' : model.connection/);
  assert.match(ui, /className="cw-welcome-actions"/);
  assert.match(ui, /href="\/">Homepage/);
  assert.match(ui, /type="file" disabled=\{!snapshot \|\| busy \|\| importing\}/);
  assert.match(ui, /if \(!file \|\| !snapshot\) return/);
});
