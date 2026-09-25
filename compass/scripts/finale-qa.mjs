import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.QA_ORIGIN || 'http://localhost:8770';
if (!['localhost','127.0.0.1','mycompass.world'].includes(new URL(base).hostname)) throw new Error('Unexpected QA origin');
const folder = `delivery/final/${new URL(base).hostname}`;
await mkdir(folder, {recursive:true});
const browser = await chromium.launch();
const errors=[],api=[],checks=[];
try {
 for (const width of [390,768,1440]) {
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
  await page.goto(base+'/presentation');
  for(let scene=1;scene<=8;scene++) {
   await expect(page.locator('.finale')).toHaveAttribute('data-scene',String(scene));
   await expect(page.getByRole('heading',{level:1})).toBeVisible();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const next=page.getByRole('button',{name:'Next',exact:false});
   const rect=await next.boundingBox();assert(rect&&rect.y>=0&&rect.y+rect.height<=900,'Stage navigation stays on screen');
   if(scene===3){await page.getByRole('button',{name:/Owner approval/}).click();await expect(page.locator('.finale-source-card')).toContainText('decision');}
   if(scene===5){const frame=page.frameLocator('iframe');await expect(frame.locator('.cp-day')).toBeVisible();await frame.getByRole('button',{name:'Play',exact:true}).click();await frame.getByRole('button',{name:'Pause',exact:true}).click();}
   else await expect(page.locator('iframe')).toHaveCount(0);
   await page.screenshot({path:`${folder}/${width}-scene-${scene}.png`,fullPage:true});
   if(scene<8)await next.click();
  }
  await expect(page.getByRole('button',{name:'Next',exact:false})).toBeDisabled();
  await page.keyboard.press('ArrowLeft');await expect(page.locator('.finale')).toHaveAttribute('data-scene','7');
  await page.getByRole('button',{name:'Speaker notes',exact:true}).click();await expect(page.getByRole('complementary',{name:'Speaker notes'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('complementary',{name:'Speaker notes'})).toHaveCount(0);
  checks.push({width,scenes:8,keyboard:true,notes:true,horizonPlayback:true,noOverflow:true});
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
 await writeFile(`${folder}/presentation-report.json`,JSON.stringify({checks,errors,apiCalls:api.length},null,2));
 console.log(JSON.stringify({checks,errors,apiCalls:api.length}));
}finally{await browser.close();}
