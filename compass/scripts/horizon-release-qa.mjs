import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.QA_ORIGIN || 'http://localhost:8770';
if (!['localhost', '127.0.0.1', 'mycompass.world'].includes(new URL(base).hostname)) throw new Error('Unexpected QA origin');
const folder = `delivery/final/${new URL(base).hostname}`;
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const errors = [], apiCalls = [], checks = [];
try {
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url()); });
    await page.goto(`${base}/horizon?day=3`);
    await expect(page.locator('.cp-day')).toHaveText('Day 3');
    await expect(page.locator('.cp-honest')).toContainText('Simulation');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.cp-day')).not.toHaveText('Day 3');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('.hz-svg')).toBeVisible(); // reduced motion must retain the 2D fallback
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${folder}/${width}-horizon.png`, fullPage: true });
    await page.getByRole('button', { name: 'Phone', exact: true }).click();
    await expect(page.locator('.ph-honest')).toContainText('Simulation');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${folder}/${width}-phone.png`, fullPage: true });
    checks.push({ width, playback: true, reducedMotionFallback: true, phone: true });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/horizon?view=3d&day=11`);
  await expect(page.locator('.cp-day')).toHaveText('Day 11');
  await expect(page.locator('.h3d canvas')).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: `${folder}/1440-webgl.png`, fullPage: true });
  checks.push({ actualWebGLCanvas: true });
  await page.close();
  for (const route of ['/', '/demo', '/voice-demo', '/presentation', '/presentation/legacy', '/horizon', '/api/health']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
  }
  const forbidden = await fetch(base + '/api/workspaces');
  assert([401, 503].includes(forbidden.status), 'Private workspace must fail closed without a session');
  assert.deepEqual(errors, []); assert.deepEqual(apiCalls, []);
  await writeFile(`${folder}/horizon-report.json`, JSON.stringify({ checks, errors, privateBlocked: true }, null, 2));
  console.log(JSON.stringify({ checks, errors, privateBlocked: true }));
} finally { await browser.close(); }
