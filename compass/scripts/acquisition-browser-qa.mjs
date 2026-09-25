import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.ACQUISITION_QA_URL||'http://localhost:8770';
const out=resolve('delivery/qa');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const report={base,at:new Date().toISOString(),checks:[],errors:[]};
try{
 for(const width of [390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844},reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const external=[];page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.goto(`${base}/acquisition`);await page.locator('.page-heading h1').waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const tab of ['Mission','Experiments','Pipeline','Memory']){
   const nav=page.getByRole('navigation',{name:width<1100?'Mobile workspace':'Workspace',exact:true});
   // Actual visible navigation is authoritative at each breakpoint.
   const button=await nav.isVisible()?nav.getByRole('button',{name:new RegExp(tab)}):page.locator('nav:visible').getByRole('button',{name:new RegExp(tab)}).first();
   await button.click();await page.waitForTimeout(100);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Horizontal overflow at ${width}/${tab}`);
   await page.screenshot({path:resolve(out,`${width}-${tab.toLowerCase()}.png`),fullPage:true});
  }
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,'Unexpected third-party browser request');
  report.checks.push({width,tabs:4,horizontalOverflow:false,pageErrors:0,thirdPartyRequests:0});
  await page.goto(`${base}/acquisition?tour=1`);
  const tour=page.getByRole('region',{name:'Guided demo tour'});
  await tour.waitFor();
  for(const label of ['Explore experiments','Meet the pipeline','Jump 2 days: receive answer','Replay the same event','Change the business rules','Check the evidence','Finish & explore']){
   await tour.getByRole('button',{name:label,exact:true}).click();
  }
  await page.getByRole('status').filter({hasText:'Tour complete'}).waitFor();
  report.checks.push({width,guidedTour:'7 steps completed',motion:'reduced'});
  await context.close();
 }
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`${base}/acquisition?tour=1`);await page.getByRole('region',{name:'Guided demo tour'}).waitFor();
 assert(new URL(page.url()).searchParams.get('tour')==='1');
 await page.getByRole('button',{name:'Exit tour',exact:true}).click();
 await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body));
 await page.goto(`${base}/acquisition/app`);await page.getByRole('button',{name:'Open workspace',exact:true}).waitFor();
 assert.equal(await page.getByText('Mira Chen',{exact:true}).count(),0);
 report.checks.push({privateWorkspace:'Unauthenticated form only; no fixture substitution',preservedAcquisition:'same-product tour retained on compatibility route',keyboard:'focus available'});
 await page.close();
}catch(e){report.errors.push(e.message);throw e;}
finally{await browser.close();await writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
