import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('homepage has only working same-page navigation and no app/demo entry', async () => {
  const html = await read('index.html');
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    assert(href.startsWith('#'), href);
    assert(html.includes(`id="${href.slice(1)}"`), href);
  }
  assert.doesNotMatch(html, /<form|href="\/(?:app|office|login|demo|presentation)(?:["?/.])|id="film"|Try it live|page-pricing/i);
  assert.match(html, /not an available app/);
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.html')), ['index.html']);
  assert.doesNotMatch(await read('src/site/landing.js'), /fetch\(|EventSource|WebSocket|localStorage|sessionStorage/);
});

test('only referenced homepage assets and font licence are retained', async () => {
  const html = await read('index.html');
  for (const [, path] of html.matchAll(/(?:href|src|poster)="(\/[^"]+)"/g)) {
    if (path.startsWith('/src/')) await access(new URL(path.slice(1), root));
    else await access(new URL('public' + path, root));
  }
  assert.deepEqual((await readdir(new URL('public/', root))).sort(), ['apple-touch-icon.png', 'assets', 'favicon.ico', 'favicon.svg', 'licenses', 'robots.txt', 'sitemap.xml']);
  assert.match(await read('public/licenses/sora-OFL.txt'), /SIL OPEN FONT LICENSE/);
  assert.doesNotMatch(await read('public/sitemap.xml'), /\/(?:app|office|login|demo|presentation)</);
});

test('runtime, build and CI have no retired database or React dependencies', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(Object.keys(pkg.devDependencies), ['vite']);
  assert.match(await read('vite.config.ts'), /input: "index.html"/);
  for (const path of ['server', 'scripts', 'app.html', 'login.html', 'src/auth', 'src/workspace']) await assert.rejects(access(new URL(path, root)));
  assert.doesNotMatch(await read('server.mjs'), /import.+(?:pg|auth|workspace|react)/i);
});
