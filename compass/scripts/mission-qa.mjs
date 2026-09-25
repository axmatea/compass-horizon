import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.QA_ORIGIN || 'http://localhost:8899';
if (!['localhost', '127.0.0.1', 'mycompass.world'].includes(new URL(base).hostname)) throw new Error('Unexpected QA origin');
const folder = `delivery/final/${new URL(base).hostname}`;
await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
const errors = [], api = [], checks = [];
try {
 for (const width of [390, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
  await page.goto(base);
  const nav = page.getByRole('navigation', { name: 'Workspace sections' });
  await expect(page.locator('.ms-task')).toHaveCount(4);
  await page.screenshot({ path: `${folder}/${width}-workspace.png`, fullPage: true });
  for (const name of ['Pipeline', 'Memory', 'Machines', 'Horizon', 'Workspace']) {
   await nav.getByRole('button', { name, exact: true }).click();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} ${name} overflow`);
  }
  await nav.getByRole('button', { name: 'Machines', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm as demo owner' })).toBeDisabled();
  await page.getByRole('button', { name: 'Inspect source', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Do not confirm');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Create scripted proposal' }).click();
  await page.getByRole('button', { name: 'Confirm as demo owner' }).click();
  await page.screenshot({ path: `${folder}/${width}-machines.png`, fullPage: true });
  await page.getByRole('button', { name: 'View updated plan' }).click();
  await expect(page.locator('.ms-task')).toHaveCount(5);
  const task = page.locator('.ms-task').filter({ hasText: 'Check step-free access and restroom details' });
  await expect(task).toHaveCount(1);
  await task.getByRole('combobox').selectOption('done');
  await expect(task.getByRole('combobox')).toHaveValue('done');
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.locator('.ms-task')).toHaveCount(4);
  await page.goto(base + '/demo/workspace');
  await expect(nav).toBeVisible();
  checks.push({ width, source: true, approval: true, move: true, reset: true, noOverflow: true });
  await page.close();
 }
 assert.deepEqual(errors, []); assert.deepEqual(api, []);
 await writeFile(`${folder}/mission-report.json`, JSON.stringify({ checks, errors, apiCalls: api.length }, null, 2));
 console.log(JSON.stringify({ checks, errors, apiCalls: api.length }));
} finally { await browser.close(); }
