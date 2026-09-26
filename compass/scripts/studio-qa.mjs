import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL || 'http://localhost:8905';
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/');
    assert.equal(await page.locator('meta[name="compass-design"]').getAttribute('content'), 'voice-builder-v3');
    assert.ok(await page.locator('a[href="/studio"]').count());
    await page.goto(base + '/studio');
    await page.getByRole('button', { name: 'Introduce a supplier delay' }).click();
    await page.getByRole('button', { name: 'Review the revised plan' }).click();
    await page.getByRole('button', { name: 'Approve as Maya' }).click();
    await page.getByRole('button', { name: 'Trace this decision' }).click();
    await page.getByRole('button', { name: 'Read source for', exact: false }).first().click();
    assert.ok(await page.locator('dialog').isVisible());
    await page.getByRole('button', { name: 'Close source', exact: true }).click();
    await page.getByRole('button', { name: 'Reset office demo' }).click();
    await page.locator('#context-note').fill('A literal note for the demo.');
    await page.getByRole('button', { name: 'Keep this context' }).click();
    await page.getByRole('button', { name: /Your context note 1/ }).click();
    assert.ok(await page.getByText('A literal note for the demo.', { exact: true }).count());
    await page.getByRole('button', { name: 'Close source', exact: true }).click();
    await page.getByRole('button', { name: 'Reset office demo' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `/tmp/compass-studio-${width}.png`, fullPage: true });
    await page.goto(base + '/studio/tour');
    assert.ok(await page.locator('body').innerText());
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: homepage retained, office interaction, memory, reset, tour, no overflow/errors`);
    await page.close();
  }
  for (const route of ['/', '/studio', '/studio/tour', '/presentation', '/demo', '/horizon', '/vision', '/office', '/api/health']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
  }
  console.log('PASS preserved routes');
} finally {
  await browser.close();
}
