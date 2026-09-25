import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.REMASTER_QA_URL || 'http://localhost:8770';
const out = resolve('delivery/remaster/studio-qa');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const report = { at: new Date().toISOString(), checks: [], errors: [] };
const ready = async page => {
  await page.goto(`${base}/demo/remaster?clock=manual`);
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('.studio-room-image')?.naturalWidth > 0);
};
const step = async (page, ms) => {
  await page.evaluate(ms => window.advanceTime(ms), ms);
  await page.waitForTimeout(400);
};
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await ready(page);
    await page.waitForTimeout(450);
    assert.equal(await page.locator('.studio-person').count(), 6);
    assert.equal(await page.locator('.studio-transfer-lines path').count(), 0, 'No invented transfer before a reassignment');
    assert.equal(await page.locator('.studio-memory-moment').count(), 0);
    assert.equal(await page.locator('.rm-mode').isVisible(), true, 'Simulation badge must also be visible on mobile');
    const cards = page.locator('.studio-task');
    assert.equal(await cards.first().evaluate(el => Number(getComputedStyle(el).opacity)), 1, 'Idle task entrance must not be paused invisible');
    for (const name of ['Priya', 'Sarah', 'Max', 'Leo', 'Maya', 'Noah']) {
      const button = page.getByRole('button', { name: new RegExp(`^Inspect ${name},`) });
      const rect = await button.boundingBox();
      assert(rect && rect.width >= 44 && rect.height >= 44, `${name}: touch target`);
      await button.click();
      assert.match(await page.getByRole('dialog').innerText(), new RegExp(name));
      await page.keyboard.press('Escape');
      assert.equal(await button.evaluate(el => document.activeElement === el), true, 'Focus returns to clicked teammate');
    }
    await page.locator('#start-btn').click();
    await step(page, 2000);
    assert.equal(await page.locator('.studio-person.active').filter({ hasText: 'Priya' }).count(), 1);
    await page.locator('#start-btn').click();
    const before = JSON.parse(await page.evaluate(() => window.render_game_to_text())).day;
    await step(page, 8000);
    assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).day, before);
    await page.screenshot({ path: resolve(out, `${width}-working.png`), fullPage: true });
    await page.locator('#start-btn').click();
    await step(page, 60000);
    assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).day, 31);
    assert.match(await page.locator('.studio-fact-preview').innerText(), /Sarah/);
    await page.locator('.studio-memory-moment').click();
    assert.match(await page.getByRole('dialog').innerText(), /Shadow|divergence/i);
    await page.keyboard.press('Escape');
    await step(page, 2000);
    assert.equal(await page.locator('.studio-transfer-lines path').count(), 0, 'A date correction must not invent an owner transfer');
    await page.screenshot({ path: resolve(out, `${width}-recovery.png`), fullPage: true });
    await page.locator('#start-btn').click();
    assert.equal(await page.locator('.studio-memory-moment').evaluate(el => Number(getComputedStyle(el).opacity)), 1);
    await page.screenshot({ path: resolve(out, `${width}-paused-recovery.png`), fullPage: true });
    assert.deepEqual(errors, []);
    report.checks.push({ width, sixHotspots: true, touchTargets: '44px+', focusReturn: true, badgeVisible: true, normalMotion: true, noFakeTransfers: true, reportedRecovery: true });
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/remaster/studio/room-v1.webp', route => route.abort());
  await page.goto(`${base}/demo/remaster?clock=manual`);
  await page.locator('.studio-roster-fallback').waitFor();
  assert.equal(await page.locator('.studio-roster-fallback .rm-person').count(), 6);
  await page.locator('.studio-roster-fallback .rm-person').filter({ hasText: 'Sarah' }).click();
  assert.match(await page.getByRole('dialog').innerText(), /Sarah/);
  await page.keyboard.press('Escape');
  await page.locator('#start-btn').click();
  await step(page, 2000);
  assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).day, 1);
  await page.screenshot({ path: resolve(out, 'image-unavailable.png'), fullPage: true });
  report.checks.push({ imageFailure: 'Accessible roster and game controls preserved' });
  await page.close();
  const live = await browser.newPage();
  await ready(live);
  const snapshot = JSON.parse(await live.evaluate(() => window.render_game_to_text())).snapshot;
  snapshot.executionMode = 'live'; snapshot.runId = 'studio-qa-only'; snapshot.team[1].name = 'Sam';
  // Explicit browser-only mock: no real runtime or sponsor connection is touched.
  await live.route('**/api/remaster/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) return route.fulfill({ json: { status: 'CONFIGURED', reason: 'Browser QA mock only' } });
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': browser QA only\n\n' });
    return route.fulfill({ json: { snapshot } });
  });
  await live.goto(`${base}/demo/remaster/app`);
  await live.locator('#start-btn').click();
  await live.locator('.studio-roster-fallback').waitFor();
  assert.match(await live.locator('.studio-roster-fallback').innerText(), /different team/);
  assert.equal(await live.locator('.studio-person').count(), 0, 'Different roster is not placed on the wrong illustrated cast');
  assert.equal(await live.getByRole('button', { name: /^Inspect Sam,/ }).count(), 1);
  report.checks.push({ differentRoster: 'Mocked live snapshot uses actual reported names, no fixture fallback' });
  await live.close();
  const transfer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  snapshot.team[1].name = 'Sarah'; snapshot.status = 'running';
  await transfer.route('**/api/remaster/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) return route.fulfill({ json: { status: 'CONFIGURED', reason: 'Browser QA mock only' } });
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': browser QA only\n\n' });
    if (path.endsWith('/commands')) {
      snapshot.seq = 1; snapshot.day = 1; snapshot.status = 'paused';
      snapshot.tasks[0].ownerId = 'leo';
    }
    return route.fulfill({ json: { snapshot } });
  });
  await transfer.goto(`${base}/demo/remaster/app`);
  await transfer.locator('#start-btn').click();
  await transfer.locator('.studio-room').waitFor();
  assert.equal(await transfer.locator('.studio-transfer-lines path').count(), 0);
  await transfer.getByRole('button', { name: 'Pause', exact: true }).click();
  await transfer.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  assert.equal(await transfer.locator('.studio-transfer-lines path').count(), 1, 'A received owner change creates one transfer path');
  assert.equal(await transfer.locator('.studio-transfer-lines path').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  report.checks.push({ transferPath: 'Rendered only from changed owner IDs in explicit mocked runtime snapshots; paused with clock' });
  await transfer.close();
  const compact = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await ready(compact);
  const room = await compact.locator('.studio-room').boundingBox();
  const dock = await compact.locator('.rm-controls').boundingBox();
  assert(room && dock && room.height > 200 && room.y + room.height <= dock.y, 'Whole studio must fit above controls on a laptop');
  assert.equal(await compact.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await compact.screenshot({ path: resolve(out, '1280-laptop.png'), fullPage: true });
  report.checks.push({ laptop: '1280x720 entire studio visible above controls' });
  await compact.close();
} catch (error) {
  report.errors.push(error.message);
  throw error;
} finally {
  await browser.close();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
