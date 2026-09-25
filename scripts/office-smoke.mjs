import assert from 'node:assert/strict';
// Set PLAYWRIGHT_MODULE to an installed Playwright ESM entry if not local.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://localhost:8901';
const browser = await chromium.launch();
const errors = [];
try {
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('.osc-room-image').first().waitFor();
    assert(await page.locator('.osc-room-image').first().evaluate(img => img.complete && img.naturalWidth === 1536));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('input[type=password]').count(), 0);
    await page.getByRole('button', { name: 'Introduce a supplier delay', exact: true }).click();
    await page.getByRole('button', { name: 'Review the revised plan', exact: true }).click();
    assert(await page.getByText('Proposed revision', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Approve as Maya', exact: true }).click();
    assert(await page.getByText('Owner-confirmed revision', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Trace this decision', exact: true }).click();
    assert(await page.locator('.of-memory').isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Reset office demo', exact: true }).click();
    await page.screenshot({ path: `/tmp/compass-office-${width}.png` });
    console.log(`PASS ${width}px: office, review, approval, memory, reset, no overflow`);
    await page.close();
  }
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const route of ['/app', '/presentation', '/horizon?day=9']) {
    const response = await page.goto(base + route);
    assert.equal(response.status(), 200);
    console.log(`PASS ${route}: HTTP 200`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
