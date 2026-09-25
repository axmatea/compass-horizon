// Run against an integrator-mounted /presentation; never activates voice or models.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5197');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Presentation QA is local-only. Supply a localhost URL.');
}
const output = await mkdtemp(join(tmpdir(), 'compass-finale-qa-'));
const browser = await chromium.launch();
const errors = [];
const forbiddenRequests = [];
const checks = [];

try {
  for (const width of [390, 768, 1440]) {
    for (const reducedMotion of ['reduce', 'no-preference']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if ((url.protocol.startsWith('http') && url.origin !== base.origin) || url.pathname.startsWith('/api/')) {
          forbiddenRequests.push(url.origin + url.pathname);
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(new URL('/presentation', base).href);
      await expect(page.locator('.finale')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.fonts.check('16px "Finale Manrope"')), true);
      await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();

      for (let scene = 1; scene <= 8; scene++) {
        await expect(page.locator('.finale')).toHaveAttribute('data-scene', String(scene));
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(scene));
        await expect(page.locator('iframe')).toHaveCount(scene === 5 ? 1 : 0);
        assert.equal(await page.evaluate(() => {
          const root = document.querySelector('.finale');
          const main = document.querySelector('.finale-main');
          return root.scrollWidth > root.clientWidth || main.scrollWidth > main.clientWidth;
        }), false, `Horizontal overflow at ${width}px / scene ${scene}`);
        const controls = await page.locator('.finale-footer').boundingBox();
        assert.ok(controls && controls.y >= 0 && controls.y + controls.height <= 901);
        if (reducedMotion === 'reduce') {
          assert.equal(await page.locator('.finale-scene').evaluate(element => getComputedStyle(element).animationName), 'none');
        }
        if (scene === 3) {
          const steps = page.getByRole('group', { name: 'Explore the illustrated human workflow' });
          for (const label of ['Inspect source', 'Owner approval', 'Shared plan', 'Update']) {
            const button = steps.getByRole('button', { name: new RegExp(label) });
            await button.click();
            await expect(button).toHaveAttribute('aria-pressed', 'true');
          }
        }
        if (scene === 5) {
          await expect(page.getByText('A/B percentages and $18k', { exact: false })).toBeVisible();
          const horizon = page.frameLocator('iframe');
          await expect(horizon.locator('.cp')).toBeVisible();
          await expect(page.getByRole('link', { name: '3D', exact: false })).toHaveAttribute('href', '/horizon?view=3d');
          await expect(page.getByRole('link', { name: 'Phone', exact: false })).toHaveAttribute('href', '/horizon?view=phone');
        }
        await page.getByRole('button', { name: 'Speaker notes', exact: true }).click();
        await expect(page.getByRole('complementary', { name: 'Speaker notes' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.finale-notes')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Speaker notes', exact: true })).toBeFocused();
        if (reducedMotion === 'reduce') {
          await page.screenshot({ path: join(output, `${width}-scene-${scene}.png`) });
        }
        if (scene < 8) {
          if (scene % 2) await page.keyboard.press('ArrowRight');
          else await page.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
        }
      }
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
      const links = page.getByRole('navigation', { name: 'Demo and workspace links' });
      assert.deepEqual(await links.locator('a').evaluateAll(elements => elements.map(element => element.getAttribute('href'))), ['/demo/workspace', '/horizon', '/voice-demo', '/app']);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.finale')).toHaveAttribute('data-scene', '8');
      for (let scene = 7; scene >= 1; scene--) await page.keyboard.press('ArrowLeft');
      await expect(page.locator('.finale')).toHaveAttribute('data-scene', '1');
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('.finale')).toHaveAttribute('data-scene', '1');
      checks.push({ width, reducedMotion, scenes: 8, passed: true });
      await page.close();
    }
  }
  assert.deepEqual(errors, [], 'Browser errors');
  assert.deepEqual(forbiddenRequests, [], 'External or API requests');
  console.log(JSON.stringify({ checks, errors, forbiddenRequests, screenshots: output }, null, 2));
} finally {
  await browser.close();
}
