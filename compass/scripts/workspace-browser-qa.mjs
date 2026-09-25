import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.WORKSPACE_QA_URL||'http://localhost:8770';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local QA only.');
const out='delivery/workspace/qa';await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const report={checks:[],errors:[]};
try {
  for(const width of [390,768,1440]) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000},hasTouch:width===390});
    const page=await context.newPage(); const requests=[];
    page.on('pageerror',e=>report.errors.push(e.message));
    page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url());});
    await page.goto(`${base}/demo/table`);await page.getByRole('region',{name:'Interactive team table'}).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`${out}/${width}-table.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.getByRole('button',{name:"Open Maya Chen's member details",exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('Maya Chen');
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'Add shared context',exact:true}).click();
    const dialog=page.getByRole('dialog');
    const labels=await dialog.locator('input,textarea').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,name:n.name})));
    assert(labels.length>=2,'Context title and content fields');
    await dialog.locator('input').first().fill('QA original note');
    await dialog.locator('textarea').first().fill('Synthetic update: review the venue entrance. <script>throw new Error("never run")</script>');
    await dialog.locator('form .cw-primary').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('QA original note',{exact:true})).toBeVisible();
    await page.getByText('QA original note',{exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('<script>');
    await page.screenshot({path:`${out}/${width}-source.png`,fullPage:true});await page.keyboard.press('Escape');
    if(width===1440){
      await page.locator('input[type=file]').setInputFiles({name:'tasks.csv',mimeType:'text/csv',buffer:Buffer.from('title,status,dueDate\n"Review, with team",todo,2026-10-12\nConfirm next step,doing,2026-10-13')});
      await expect(page.getByRole('dialog')).toContainText('Preview only');
      await expect(page.locator('.cw-task-row').filter({hasText:'Review, with team'})).toHaveCount(0);
      await page.getByRole('button',{name:'Import 2 tasks',exact:true}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.cw-task-row').filter({hasText:'Review, with team'})).toBeVisible();
      await expect(page.getByText('tasks.csv',{exact:true})).toBeVisible();
      await page.locator('.cw-proposal-card').click();
      await expect(page.getByRole('dialog')).toContainText('NOT LIVE AI');
      await page.getByRole('button',{name:'Approve and add example task'}).click();
      await expect(page.locator('.cw-task-row').filter({hasText:'Review the courtyard accessibility'})).toHaveCount(1);
      await page.locator('.cw-task-row').filter({hasText:'Confirm next step'}).click();
      await page.getByRole('dialog').locator('select[name=status]').selectOption('done');
      await page.getByRole('button',{name:'Save changes',exact:true}).click();
      await expect(page.locator('.cw-task-row').filter({hasText:'Confirm next step'})).toContainText('Done');
      await page.screenshot({path:`${out}/1440-updated.png`,fullPage:true});
      report.checks.push({csvPreview:true,originalCsvSaved:true,taskEdit:true,scriptedApproval:true});
    }
    assert.equal(requests.length,0,'Demo must never call private/model APIs');
    report.checks.push({width,overflow:false,sourceSafe:true,demoApiRequests:0});
    await context.close();
  }
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await page.goto(`${base}/demo/table`);await page.getByRole('region',{name:'Interactive team table'}).waitFor();
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body));
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  report.checks.push({keyboard:true,reducedMotion:true});
  await page.goto(`${base}/demo/remaster`);await page.locator('#start-btn').waitFor();
  await page.goto(`${base}/acquisition`);await page.locator('.page-heading h1').waitFor();
  report.checks.push({legacyRoutes:true});
  assert.deepEqual(report.errors,[]);
} finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
