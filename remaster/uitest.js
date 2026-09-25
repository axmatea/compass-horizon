// UI dry-run: filter as PERSON, send MSG to the scrum master, wait for replan, screenshot.
// usage: node uitest.js <person> "<message>" <outPrefix>
const { chromium } = require('playwright');
const [person, msg, prefix] = process.argv.slice(2);
const OUT = '/Users/macminivince/vince_assistant_3/workspace/hackathon/remaster/runs/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto('http://localhost:8770/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.selectOption('#viewas', person);
  await p.evaluate(() => viewChanged());
  await p.waitForTimeout(500);
  await p.fill('#chatmsg', msg);
  await p.screenshot({ path: `${OUT}${prefix}_1_typed.png` });
  await p.click('text=💬 Send');
  // wait for the agent: ack updated by server AND busy false
  await p.waitForFunction(
    per => typeof S !== 'undefined' && S && !S.busy && S.ack && S.ack.person === per && !document.getElementById('ack').textContent.includes('thinking'),
    person, { timeout: 240000, polling: 2000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}${prefix}_2_filtered_replanned.png` });
  await p.selectOption('#viewas', '');
  await p.evaluate(() => viewChanged());
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}${prefix}_3_team_replanned.png` });
  await b.close();
  console.log('done');
})();
