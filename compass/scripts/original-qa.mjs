import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL || 'http://localhost:8904';
const browser = await chromium.launch();
const errors = [];
try {
 for (const width of [390, 768, 1440]) {
  const page = await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  assert.equal((await page.goto(base+'/original')).status(),200);
  await page.getByRole('button',{name:'Introduce a supplier delay',exact:true}).click();
  await page.getByRole('button',{name:'Review the revised plan',exact:true}).click();
  await page.getByRole('button',{name:'Approve as Maya',exact:true}).click();
  await page.getByRole('button',{name:'Trace this decision',exact:true}).click();
  assert(await page.locator('.of-memory').isVisible());
  await page.getByRole('button',{name:'Reset office demo',exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/tmp/compass-original-office-${width}.png`});
  assert.equal((await page.goto(base+'/original/site')).status(),200);
  await page.locator('.compass-site').waitFor();
  assert(await page.getByRole('heading',{name:'Room to think. A way forward.'}).isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/tmp/compass-original-site-${width}.png`});
  console.log(`PASS ${width}px: original office interaction + early website`);
  await page.close();
 }
 const page=await browser.newPage();
 for(const path of ['/','/original/tour','/presentation','/demo','/horizon','/api/health']){
  assert.equal((await page.goto(base+path)).status(),200);console.log(`PASS ${path}`);
 }
 const media=await page.request.get(base+'/media/compass-film-nyc.mp4',{headers:{Range:'bytes=0-1023'}});
 assert.equal(media.status(),206);
 assert.deepEqual(errors,[]);
} finally { await browser.close(); }
