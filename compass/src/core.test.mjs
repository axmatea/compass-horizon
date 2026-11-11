import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { EXAMPLES } from './demo/catalog.mjs';
import { team, visibleTeam } from './site/team.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('homepage offers the demo and does not call the product unavailable', async () => {
  const html = await read('index.html');
  const demo = await read('demo.html');
  const external = new Set(['https://aimedia.global', 'https://jarrarcpa.pro', 'https://docs.lovable.dev/introduction/welcome', 'https://docs.lovable.dev/introduction/faq', 'https://bolt.new/', 'https://replit.com/', 'https://v0.app/']);
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    if (external.has(href)) continue;
    assert(href.startsWith('#') || href === '/demo', href);
    if (href.startsWith('#')) assert(html.includes(`id="${href.slice(1)}"`), href);
  }
  assert.match(html, /Describe it\./);
  assert.match(html, /COMPASS builds it:/);
  assert.match(html, /web, mobile, real software/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /Try the demo/);
  assert.match(html, /class="voice-loop"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(demo, /id="mic"/);
  assert.match(demo, /Speak your idea/);
  assert.match(demo, /Skip to the demo/);
  const voice = await read('src/demo/voice.mjs');
  const demoJs = await read('src/demo/demo.js');
  assert.match(voice, /webkitSpeechRecognition/);
  assert.doesNotMatch(voice + demoJs, /MediaRecorder|getUserMedia|webkitSpeechRecognition\(\)|new WebSocket|EventSource/);
  assert.match(html, /id="hero-secondary" href="#how">See how it works/);
  assert.match(html, /id="compass-video"/);
  assert.match(html, /id="early-access"/);
  assert.match(html, /action="mailto:info@aimedia\.global\?subject=COMPASS%20early%20access"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /name="hp"/);
  assert.match(html, /AX Media Global builds software for business clients/);
  assert.doesNotMatch(html + demo, /TODO|not connected|not on this page yet|coming soon|lorem ipsum|\bconcept\b|Watch the video/i);
  assert.match(html, /id="team"/);
  assert.match(html, /id="compare"/);
  assert.match(html, /id="how"/);
  assert.match(html, /property="og:image" content="https:\/\/mycompass\.world\/assets\/og\.jpg"/);
  assert.match(html, /og:image:width" content="1200"/);
  assert.match(html, /og:image:height" content="630"/);
  await access(new URL('public/assets/og.jpg', root));
  assert.doesNotMatch(html + demo, /not an available app|concept, not|Try it live|page-pricing|id="film"/i);
  assert.doesNotMatch(html, /action="https?:/);
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.html')).sort(), ['demo.html', 'index.html']);
  const landing = await read('src/site/landing.js');
  assert.match(landing, /fetch\('\/api\/config'/);
  assert.match(landing, /\/api\/early-access/);
  assert.match(landing, /visibleTeam/);
  assert.doesNotMatch(landing, /EventSource|WebSocket|localStorage|sessionStorage|TODO/);
  const teamSource = await read('src/site/team.mjs');
  assert.match(teamSource, /TODO: team bios and logos/);
  assert.deepEqual(team, []);
  assert.deepEqual(visibleTeam(team), []);
  assert.deepEqual(visibleTeam([{ name: '  ' }, { bio: 'Missing name' }]), []);
  const sample = visibleTeam([{ name: 'Example Person', role: 'Example role', bio: 'Example bio', logo: 'https://example.com/a.png' }, { name: 'Second', logo: '/assets/logo.svg' }]);
  assert.equal(sample[0].name, 'Example Person');
  assert.equal(sample[0].logo, '');
  assert.equal(sample[1].logo, '/assets/logo.svg');
  for (const example of EXAMPLES) assert.ok(demo.includes(example.intent), example.id);
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
  assert.doesNotMatch(sitemap, /\/(?:app|office|login|presentation)</);
});

test('runtime, build and CI have no retired database or React dependencies', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(Object.keys(pkg.devDependencies), ['vite']);
  const vite = await read('vite.config.ts');
  assert.match(vite, /index\.html/);
  assert.match(vite, /demo\.html/);
  for (const path of ['scripts', 'app.html', 'login.html', 'src/auth', 'src/workspace']) await assert.rejects(access(new URL(path, root)));
  assert.doesNotMatch(await read('server.mjs'), /import.+(?:pg|auth|workspace|react)/i);
  assert.doesNotMatch(await read('llm.mjs') + await read('demo-api.mjs') + await read('early-access.mjs') + await read('homepage.mjs'), /GENERAL_COMPUTE_API_KEY\s*=\s*['"][^'"]+['"]|WAITLIST_WEBHOOK_URL\s*=\s*['"]https/);
  assert.match(await read('Dockerfile'), /early-access\.mjs/);
  assert.match(await read('Dockerfile'), /homepage\.mjs/);
});
