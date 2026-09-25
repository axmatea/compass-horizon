// Real-browser voice test: Chromium's fake microphone plays a WAV of user speech into
// getUserMedia -> AudioWorklet -> /api/voice/realtime -> Boson -> COMPASS (GLM) -> Boson audio.
//   PLAYWRIGHT_CORE=/path/to/playwright-core BASE=http://127.0.0.1:PORT MIC_WAV=mic.wav node scripts/browser-voice-e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE = process.env.BASE; const MIC = process.env.MIC_WAV; const SECONDS = Number(process.env.SECONDS || 30);
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}%noloop`, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
await page.goto(`${BASE}/api/voice/console`);
await page.check('#hp');
const t0 = Date.now();
await page.click('#start');
await page.waitForTimeout(SECONDS * 1000);
const out = await page.evaluate(() => ({
  mode: document.getElementById('mode').textContent,
  status: document.getElementById('status').textContent,
  intent: [...document.querySelectorAll('#intent tr')].map((tr) => [...tr.children].map((td) => td.innerHTML.replace(/<s>(.*?)<\/s>/, '~~$1~~')).join(' | ')),
  you: document.getElementById('you').textContent,
  said: document.getElementById('said').textContent,
  log: document.getElementById('log').textContent.split('\n').filter(Boolean),
}));
await browser.close();
console.log(JSON.stringify({ elapsedMs: Date.now() - t0, consoleErrors, ...out }, null, 1));
