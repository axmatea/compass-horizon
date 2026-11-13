import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { EXAMPLES } from './demo/catalog.mjs';
import { team, visibleTeam } from './site/team.mjs';
import { studioTeam, studioCompany, studioQuotes } from './site/studio-content.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('public entry points stay honest, bounded, accessible and connected', async () => {
  const html = await read('index.html');
  const demo = await read('demo.html');
  const plan = await read('plan.html');
  const create = await read('create.html');
  const external = new Set(['https://aimedia.global', 'https://jarrarcpa.pro', 'https://compass-web-preview-production.up.railway.app/create?app=1']);
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    if (external.has(href) || href === '#watch') continue; // The server inserts this recording section.
    assert(href.startsWith('#') || /^\/demo(?:\?starter=(?:studio|bakery|portfolio))?$/.test(href) || href === '/plan' || href === '/studio' || href === '/create', href);
    if (href.startsWith('#')) assert(html.includes(`id="${href.slice(1)}"`), href);
  }
  assert.match(html, /Your idea\./);
  assert.match(html, /Its first page\./);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /class="voice-loop"/);
  for (const page of [html, demo, plan]) assert.match(page, /id="mic"/);
  const voice = await read('src/demo/voice.mjs');
  const demoJs = await read('src/demo/demo.js');
  assert.match(voice, /webkitSpeechRecognition/);
  assert.doesNotMatch(voice + demoJs, /MediaRecorder|getUserMedia|webkitSpeechRecognition\(\)|new WebSocket|EventSource/);
  assert.match(html, /id="compass-video"/);
  assert.match(html, /id="early-access"/);
  assert.match(html, /id="early-access"[^>]*action="#access"/);
  assert.doesNotMatch(html, /action="mailto:/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /name="hp"/);
  assert.doesNotMatch(html + demo + plan, /not connected|not on this page yet|coming soon|lorem ipsum|FIXME|TBD/i);
  assert.match(html, /id="how"/);
  assert.match(html, /property="og:image" content="https:\/\/mycompass\.world\/assets\/og\.jpg"/);
  await access(new URL('public/assets/og.jpg', root));
  assert.doesNotMatch(html + demo + plan, /vincent/i);
  assert.match(html, /NAŸL · AX Media Global/);
  assert.match(plan, /NAŸL · AX Media Global/);
  assert.doesNotMatch(html, /action="https?:/);
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.html')).sort(), ['create.html', 'demo.html', 'index.html', 'plan.html', 'studio.html']);
  assert.match(create, /name="robots" content="noindex,nofollow"/);
  assert.match(create, /id="create-prompt"[^>]*maxlength="500"/);
  assert.match(create, /<form id="account-form" method="post"/);
  assert.match(create, /id="continue-guest"/);
  assert.doesNotMatch(create, /<script\b(?![^>]*\bsrc=)[^>]*>/);
  const landing = await read('src/site/landing.js');
  assert.match(landing, /fetch\('\/api\/config'/);
  assert.match(landing, /\/api\/early-access/);
  assert.doesNotMatch(landing, /EventSource|WebSocket|localStorage|sessionStorage|TODO/);
  assert.deepEqual(team, []);
  assert.deepEqual(visibleTeam(team), []);
  assert.deepEqual(visibleTeam([{ name: '  ' }, { bio: 'Missing name' }]), []);
  const sample = visibleTeam([{ name: 'Example Person', role: 'Example role', bio: 'Example bio', logo: 'https://example.com/a.png' }, { name: 'Second', logo: '/assets/logo.svg' }]);
  assert.equal(sample[0].name, 'Example Person');
  assert.equal(sample[0].logo, '');
  assert.equal(sample[0].initials, 'EP');
  assert.equal(sample[1].logo, '/assets/logo.svg');
  assert.equal(studioCompany.arr, '$240K ARR');
  assert.equal(studioTeam.length, 1);
  assert.equal(studioTeam[0].name, 'Nayl Ahmadulin');
  assert.equal(studioTeam[0].role, 'Founder');
  assert.equal(studioTeam[0].photo, '');
  assert.deepEqual(studioQuotes, []);
  assert.doesNotMatch(JSON.stringify(studioTeam) + JSON.stringify(studioCompany), /Vincent/i);
  for (const example of EXAMPLES) assert.ok(plan.includes(example.intent), example.id);
});

test('public pages use the approved Fold mark', async () => {
  const fold = 'M4 12 15 5v16L4 28Zm14-4 10 6v14l-10-6Z';
  for (const page of ['index.html', 'demo.html', 'plan.html', 'studio.html', 'create.html']) {
    const html = await read(page);
    assert.ok(html.includes(fold), page);
    assert.doesNotMatch(html, /r="9\.6"|m31 16-4 12/);
  }
  const workspace = await read('src/account/workspace.mjs');
  assert.match(workspace, /\/assets\/brand-next\/mark-a-fold\.svg/);
  assert.doesNotMatch(workspace, /mark-b-offset\.svg/);
  const favicon = await read('public/favicon.svg');
  assert.match(favicon, /#18191b/);
  assert.match(favicon, /M3 11\.6 14\.6 4\.8v16\.6L3 28\.2Zm16\.4-5\.2 10\.2 6v15l-10\.2-6Z/);
  const ico = await readFile(new URL('public/favicon.ico', root));
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
  assert.deepEqual(sizes, [16, 32, 48]);
  const apple = await readFile(new URL('public/apple-touch-icon.png', root));
  assert.equal(apple.toString('ascii', 12, 16), 'IHDR');
  assert.equal(apple.readUInt32BE(16), 180);
  assert.equal(apple.readUInt32BE(20), 180);
  const tile = await readFile(new URL('public/assets/fold-app-icon.png', root));
  assert.equal(tile.readUInt32BE(16), 512);
  assert.equal(tile.readUInt32BE(20), 512);
  await access(new URL('public/assets/brand-next/mark-a-fold.svg', root));
  await access(new URL('public/assets/fold-app-icon.svg', root));
});

test('only referenced homepage assets and font licence are retained', async () => {
  const html = await read('index.html');
  for (const [, path] of html.matchAll(/(?:href|src|poster)="(\/[^"]+)"/g)) {
    if (!path.includes('.')) continue;
    if (path.startsWith('/src/')) await access(new URL(path.slice(1), root));
    else await access(new URL('public' + path, root));
  }
  assert.deepEqual((await readdir(new URL('public/', root))).sort(), ['apple-touch-icon.png', 'assets', 'favicon.ico', 'favicon.svg', 'licenses', 'robots.txt', 'sitemap.xml']);
  assert.match(await read('public/licenses/sora-OFL.txt'), /SIL OPEN FONT LICENSE/);
  const sitemap = await read('public/sitemap.xml');
  assert.match(sitemap, /https:\/\/mycompass\.world\/demo</);
  assert.match(sitemap, /https:\/\/mycompass\.world\/plan</);
  assert.match(sitemap, /https:\/\/mycompass\.world\/studio</);
  assert.doesNotMatch(sitemap, /\/(?:app|office|login|presentation)</);
});

test('runtime dependencies stay pinned and retired interfaces stay absent', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ['better-auth','css-tree','oauth4webapi','parse5','stripe']);
  for(const version of Object.values(pkg.dependencies))assert.match(version,/^\d+\.\d+\.\d+$/);
  assert.match(pkg.dependencies['better-auth'], /^\d+\.\d+\.\d+$/, 'auth dependency is pinned');
  assert.deepEqual(Object.keys(pkg.devDependencies), ['vite']);
  const vite = await read('vite.config.ts');
  assert.match(vite, /index\.html/);
  assert.match(vite, /demo\.html/);
  assert.match(vite, /plan\.html/);
  assert.match(vite, /studio\.html/);
  assert.match(vite, /create\.html/);
  for (const path of ['app.html', 'login.html', 'src/auth', 'src/workspace']) await assert.rejects(access(new URL(path, root)));
  const server = await read('server.mjs');
  assert.doesNotMatch(server, /(?:from\s+|import\s*\(\s*)['"](?:pg|react(?:\/[^'"]*)?|\.\/src\/(?:auth|workspace)(?:\/[^'"]*)?)['"]/);
  const account = await read('account/auth.mjs');
  assert.match(account, /COMPASS_ACCOUNT_MODE === 'staging'/);
  assert.match(account, /import\('better-auth'\)/);
  assert.match(account, /import\('node:sqlite'\)/);
  assert.doesNotMatch(await read('llm.mjs') + await read('demo-api.mjs') + await read('early-access.mjs') + await read('homepage.mjs'), /GENERAL_COMPUTE_API_KEY\s*=\s*['"][^'"]+['"]|WAITLIST_WEBHOOK_URL\s*=\s*['"]https/);
  assert.match(await read('Dockerfile'), /early-access\.mjs/);
  assert.match(await read('Dockerfile'), /homepage\.mjs/);
});
