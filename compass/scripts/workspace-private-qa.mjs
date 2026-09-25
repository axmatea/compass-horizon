import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createInvite} from './acquisition-invite.mjs';

const db=process.env.ACQUISITION_TEST_DATABASE_URL;
if(!db||!['localhost','127.0.0.1'].includes(new URL(db).hostname)||new URL(db).pathname!='/compass_test')throw new Error('Explicit local compass_test database required.');
const origin='http://localhost:8787';
const pool=new pg.Pool({connectionString:db});
const browser=await chromium.launch();
const contexts=[],emails=[],checks=[],errors=[];
let child,workspaceId;
const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',PORT:'8787',DATABASE_URL:db,
 BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:'synthetic-local-workspace-browser-secret-2026',ACQUISITION_SPONSOR_CALLS_ENABLED:'false'};
async function start(){
 child=spawn(process.execPath,['server.mjs'],{env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',()=>{});
 for(let i=0;i<100;i++){
  try{const r=await fetch(`${origin}/healthz`);if(r.ok)return;}catch{}
  if(child.exitCode!==null)throw new Error('QA server failed to start.');
  await delay(100);
 }throw new Error('QA server readiness timeout.');
}
async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');for(let i=0;i<200&&child.exitCode===null&&child.signalCode===null;i++)await delay(50);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');throw new Error('QA server failed to stop gracefully.');}}
async function call(ctx,path,data,method=data?'POST':'GET',status=200){
 const r=await ctx.request.fetch(origin+path,{method,headers:{Origin:origin},...(data?{data}:{} )});
 const body=await r.json();assert.equal(r.status(),status,`${method} ${path}: ${body.error||''}`);return body;
}
const cmd=()=>randomUUID();
try{
 await start();
 const a=await browser.newContext({viewport:{width:1440,height:1000}}), b=await browser.newContext({viewport:{width:390,height:844}});contexts.push(a,b);
 const ownerEmail=`ws-owner-${cmd()}@example.test`,memberEmail=`ws-member-${cmd()}@example.test`;emails.push(ownerEmail,memberEmail);
 const password=`qa-only-${cmd()}`;
 const seed=await createInvite({pool,email:ownerEmail});
 await call(a,'/api/acquisition/accept-invite',{token:seed.token,email:ownerEmail,name:'QA Owner',password});
 await call(a,'/api/auth/sign-in/email',{email:ownerEmail,password});
 const owner=await a.newPage();owner.on('pageerror',e=>errors.push(e.message));
 await owner.goto(`${origin}/app`);await owner.getByRole('button',{name:'Create your first project',exact:true}).click();
 await owner.getByLabel('Project name',{exact:true}).fill('QA shared project');
 await owner.getByLabel('Shared goal',{exact:true}).fill('Verify two humans work from the same saved state.');
 await owner.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(owner.getByRole('heading',{name:'QA shared project.'})).toBeVisible();
 workspaceId=(await call(a,'/api/workspaces')).workspaces[0].id;
 const path=`/api/workspaces/${workspaceId}`;
 const invite=await call(a,path+'/invites',{email:memberEmail,commandId:cmd()},'POST',201);
 assert.equal(invite.signupRequired,true);
 const member=await b.newPage();member.on('pageerror',e=>errors.push(e.message));
 await member.goto(`${origin}/login?returnTo=/app&workspaceInvite=${invite.token}&token=${invite.token}`);
 await member.getByLabel('Your name',{exact:true}).fill('QA Member');
 await member.getByLabel('Email',{exact:true}).fill(memberEmail);await member.getByLabel('Password',{exact:true}).fill(password);
 await member.getByRole('button',{name:'Accept invitation',exact:true}).click();
 await expect(member.getByText('Invitation accepted. Sign in with your new account.')).toBeVisible();
 await member.getByLabel('Email',{exact:true}).fill(memberEmail);await member.getByLabel('Password',{exact:true}).fill(password);
 await member.getByRole('button',{name:'Open workspace',exact:true}).click();
 await member.getByRole('button',{name:'Accept invitation',exact:true}).click();
 await expect(member.getByRole('heading',{name:'QA shared project.'})).toBeVisible();
 assert(!member.url().includes(invite.token));
 await expect(owner.getByRole('button',{name:'2 people, one team'})).toBeVisible();
 checks.push('Team invitation creates a new account, preserves membership token across login, requires explicit acceptance, synchronizes owner view.');
 await owner.getByRole('button',{name:'Add task',exact:true}).click();
 await owner.getByLabel('Task title',{exact:true}).fill('Check the original source');
 const snapshot=await call(a,path), memberId=snapshot.members.find(m=>m.email===memberEmail).userId;
 await owner.getByRole('dialog').locator('select[name=assigneeId]').selectOption(memberId);
 await owner.getByRole('button',{name:'Create task',exact:true}).click();
 await expect(member.locator('.cw-task-row').filter({hasText:'Check the original source'})).toBeVisible();
 await member.locator('.cw-task-row').filter({hasText:'Check the original source'}).click();
 await member.getByRole('dialog').locator('select[name=status]').selectOption('done');await member.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(owner.locator('.cw-task-row').filter({hasText:'Check the original source'})).toContainText('Done');
 const update={title:'Late update',content:'QA Member is unavailable on Friday.',commandId:cmd()};
 await call(b,path+'/materials',update, 'POST',201);await call(b,path+'/materials',update,'POST',201);
 const persisted=await call(a,path);assert.equal(persisted.materials.filter(m=>m.title==='Late update').length,1);
 assert.equal(persisted.tasks[0].status,'done');assert.equal(persisted.ai.status,'BLOCKED');
 checks.push('Member edits task; owner receives actual SSE update. Replayed material command creates one source. AI stays BLOCKED.');
 await mkdir('delivery/workspace/private-qa',{recursive:true});
 await expect(owner.getByText('Late update',{exact:true})).toBeVisible();
 await expect(member.getByText('Late update',{exact:true})).toBeVisible();
 await owner.screenshot({path:'delivery/workspace/private-qa/owner.png',fullPage:true});
 await member.screenshot({path:'delivery/workspace/private-qa/member.png',fullPage:true});
 await stop();await start();
 const after=await call(a,path);assert.equal(after.tasks[0].status,'done');assert.equal(after.materials.length,1);
 await owner.reload();await expect(owner.getByRole('heading',{name:'QA shared project.'})).toBeVisible();
 await member.reload();await expect(member.getByRole('heading',{name:'QA shared project.'})).toBeVisible();
 checks.push('Actual Node server restart preserves sessions, workspace, task versions and material.');
 await call(a,path+`/members/${memberId}`,{commandId:cmd()},'DELETE');
 await expect(member.getByRole('heading',{name:'QA shared project.'})).toHaveCount(0,{timeout:10000});
 await call(b,path,undefined,'GET',404);
 checks.push('Membership removal clears the open private UI and blocks subsequent reads.');
 await owner.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(owner.getByRole('button',{name:'Open workspace',exact:true})).toBeVisible();
 await call(a,path,undefined,'GET',401);
 checks.push('Owner sign-out invalidates the real cookie session and removes private UI.');
 assert.deepEqual(errors,[]);
}catch(error){
 errors.push(error.message);
 await mkdir('delivery/workspace/private-qa',{recursive:true});
 for(let i=0;i<contexts.length;i++)for(const [j,page]of contexts[i].pages().entries()){
  await page.screenshot({path:`delivery/workspace/private-qa/failure-${i}-${j}.png`,fullPage:true}).catch(()=>{});
  await writeFile(`delivery/workspace/private-qa/failure-${i}-${j}.txt`,await page.locator('body').innerText().catch(()=>''));
 }
 throw error;
}finally{
 for(const c of contexts)await c.close();await browser.close();await stop();
 if(workspaceId)await pool.query('DELETE FROM ws_workspaces WHERE id=$1',[workspaceId]);
 await pool.query('DELETE FROM acq_invites WHERE email=ANY($1::text[])',[emails]);
 await pool.query('DELETE FROM acq_auth_users WHERE email=ANY($1::text[])',[emails]);await pool.end();
 await mkdir('delivery/workspace/private-qa',{recursive:true});
 await writeFile('delivery/workspace/private-qa/report.json',JSON.stringify({checks,errors},null,2));
}
console.log(JSON.stringify({checks,errors},null,2));
