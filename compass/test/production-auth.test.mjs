import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtemp,mkdir,rm,realpath,access,readFile,writeFile,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createAccountAuth} from '../account/auth.mjs';
import {createAccountStore} from '../account/store.mjs';

const origin='https://mycompass.world';
const password='Synthetic production verification password 58!';

async function fixture(t,{extra={},options={},mounted=true,beforeAuth}={}) {
  const directory=await realpath(await mkdtemp(join(tmpdir(),'compass-production-auth-')));
  const mount=join(directory,'volume'),publicRoot=join(directory,'public');
  await mkdir(mount,{mode:0o700});await mkdir(publicRoot,{mode:0o700});
  const env={NODE_ENV:'production',COMPASS_ACCOUNT_MODE:'production',COMPASS_ACCOUNT_ORIGIN:origin,
    COMPASS_STORAGE_MODE:'persistent-volume',RAILWAY_VOLUME_MOUNT_PATH:mount,
    COMPASS_ACCOUNT_DATABASE:join(mount,'private','account.sqlite'),STATIC_ROOT:publicRoot,
    BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),
    GOOGLE_CLIENT_ID:'synthetic-google-id',GOOGLE_CLIENT_SECRET:'synthetic-google-secret',...extra};
  const storageOptions={readMountInfo:async()=>mounted?`29 23 8:1 / ${mount.replace(/ /g,'\\040')} rw,relatime - ext4 /dev/synthetic-volume rw\n`:''};
  if(beforeAuth)await beforeAuth({env,mount,publicRoot,directory});
  let auth=createAccountAuth({env,storageOptions,...options});await auth.ready;
  const server=createServer(async(req,res)=>{
    try{if(!await auth.handleNode(req,res)){res.statusCode=404;res.end()}}
    catch{res.statusCode=500;res.end()}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const local=`http://127.0.0.1:${server.address().port}`;
  const request=(path,{method='GET',body,cookie,headers={}}={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(local+path,{method,headers:{host:'mycompass.world',
      ...(method==='POST'?{origin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const resultHeaders=new Headers();
        for(let i=0;i<res.rawHeaders.length;i+=2)resultHeaders.append(res.rawHeaders[i],res.rawHeaders[i+1]);
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:resultHeaders}));
      });
    });
    req.on('error',reject);req.end(body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body));
  });
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await auth.close();await rm(directory,{recursive:true,force:true})});
  return {get auth(){return auth},env,mount,publicRoot,directory,request,
    async restart(nextOptions=options){await auth.close();auth=createAccountAuth({env,storageOptions,...nextOptions});await auth.ready;return auth}};
}

const cookieFor=response=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const mailUrl=(messages,kind)=>new URL(messages.find(message=>message.kind===kind).text.match(/https?:\/\/\S+/)[0]);

test('production needs the exact HTTPS origin, fixed secret and a real provider before creating a database',async t=>{
  for(const extra of [
    {COMPASS_ACCOUNT_ORIGIN:'https://www.mycompass.world'},
    {COMPASS_ACCOUNT_ORIGIN:'https://mycompass.world.'},
    {COMPASS_ACCOUNT_ORIGIN:'http://mycompass.world'},
    {COMPASS_ACCOUNT_ORIGIN:'https://example.test'},
    {BETTER_AUTH_SECRET:undefined,COMPASS_ACCOUNT_EPHEMERAL_SECRET:'1'},
    {GOOGLE_CLIENT_SECRET:undefined},
    {GOOGLE_CLIENT_ID:undefined,COMPASS_ACCOUNT_EMAIL_PROVIDER:'resend',RESEND_API_KEY:'synthetic-key',COMPASS_ACCOUNT_EMAIL_FROM:undefined},
  ]){
    const f=await fixture(t,{extra});
    assert.equal(f.auth.publicConfig().configured,false);
    assert.equal(f.auth.database,null);
    await assert.rejects(access(f.env.COMPASS_ACCOUNT_DATABASE));
    assert.equal((await f.request('/api/auth/get-session')).status,503);
  }
});

test('production refuses an ordinary directory and does not bootstrap outside a verified volume',async t=>{
  const f=await fixture(t,{mounted:false});
  assert.equal(f.auth.publicConfig().configured,false);
  await assert.rejects(access(f.env.COMPASS_ACCOUNT_DATABASE));
  const outside=await fixture(t,{beforeAuth({env,directory}){env.COMPASS_ACCOUNT_DATABASE=join(directory,'outside.sqlite')}});
  assert.equal(outside.auth.publicConfig().configured,false);
  await assert.rejects(access(outside.env.COMPASS_ACCOUNT_DATABASE));
});

test('bootstrap leaves existing unsafe files untouched and preserves existing private database data',async t=>{
  const marker='Existing operator data must not be replaced';
  const unsafe=await fixture(t,{beforeAuth:async({env})=>{
    await mkdir(join(env.RAILWAY_VOLUME_MOUNT_PATH,'private'),{mode:0o700});
    await writeFile(env.COMPASS_ACCOUNT_DATABASE,marker,{mode:0o644});await chmod(env.COMPASS_ACCOUNT_DATABASE,0o644);
  }});
  assert.equal(unsafe.auth.publicConfig().configured,false);
  assert.equal(await readFile(unsafe.env.COMPASS_ACCOUNT_DATABASE,'utf8'),marker);
  assert.equal((await stat(unsafe.env.COMPASS_ACCOUNT_DATABASE)).mode&0o777,0o644);
  const existing=await fixture(t,{beforeAuth:async({env})=>{
    await mkdir(join(env.RAILWAY_VOLUME_MOUNT_PATH,'private'),{mode:0o700});
    const db=new DatabaseSync(env.COMPASS_ACCOUNT_DATABASE);
    db.exec("CREATE TABLE retained_probe(value TEXT); INSERT INTO retained_probe(value) VALUES ('Keep existing rows')");db.close();
    await chmod(env.COMPASS_ACCOUNT_DATABASE,0o600);
  }});
  assert.equal(existing.auth.publicConfig().configured,true);
  assert.equal(existing.auth.database.prepare('SELECT value FROM retained_probe').get().value,'Keep existing rows');
});

test('a supplied in-memory database cannot impersonate the verified production database',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const f=await fixture(t,{options:{database:db}});
  assert.equal(f.auth.publicConfig().configured,false);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get().count,0);
});

test('social-only production disables email routes, exposes no secrets and has its own bounded database cap',async t=>{
  const f=await fixture(t);
  assert.equal(f.auth.mode,'production');assert.equal(f.auth.publicConfig().configured,true);
  assert.deepEqual(f.auth.publicConfig().providers,['google']);
  assert.equal(f.auth.publicConfig().emailMode,'disabled');
  assert.equal(f.auth.publicConfig().features.passwordRecovery,false);
  assert.equal((await stat(f.env.COMPASS_ACCOUNT_DATABASE)).mode&0o777,0o600);
  assert.ok(!JSON.stringify(f.auth.publicConfig()).includes('synthetic-google'));
  const bytes=f.auth.database.prepare('PRAGMA page_size').get().page_size*f.auth.database.prepare('PRAGMA max_page_count').get().max_page_count;
  assert.equal(bytes,256*1024*1024);
  assert.equal(f.auth.database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='trigger' AND name='compass_account_staging_user_limit'").get().count,0);
  for(const path of ['/sign-up/email','/sign-in/email','/change-password','/request-password-reset','/reset-password']){
    assert.equal((await f.request('/api/auth'+path,{method:'POST',body:{email:'person@example.com',password}})).status,404,path);
  }
});

test('verified production email supports sign-in, private projects, fixed-key restarts and password recovery',async t=>{
  const messages=[];
  const f=await fixture(t,{extra:{GOOGLE_CLIENT_ID:undefined,COMPASS_ACCOUNT_EPHEMERAL_SECRET:'1'},options:{sendEmail:async message=>{messages.push(message)}}});
  assert.deepEqual(f.auth.publicConfig().providers,['email']);
  assert.equal(f.auth.publicConfig().secretMode,'configured');
  const signup=await f.request('/api/auth/sign-up/email',{method:'POST',body:{name:'Production tester',email:'production@example.com',password}});
  assert.equal(signup.status,200,await signup.clone().text());
  assert.ok(!cookieFor(signup).includes('session_token='));
  assert.equal((await f.request('/api/auth/sign-in/email',{method:'POST',body:{email:'production@example.com',password}})).status,403);
  const url=mailUrl(messages,'verify-email');assert.equal(url.origin,origin);
  const verified=await f.request(url.pathname+url.search,{headers:{'sec-fetch-site':'cross-site'}});
  assert.ok([200,302].includes(verified.status),await verified.clone().text());
  const login=await f.request('/api/auth/sign-in/email',{method:'POST',body:{email:'production@example.com',password}});
  assert.equal(login.status,200,await login.clone().text());
  const cookie=cookieFor(login),sessionCookie=login.headers.getSetCookie().find(value=>value.includes('session_token='));
  assert.match(sessionCookie,/compass-account\.session_token=/);assert.match(sessionCookie,/; Secure(?:;|$)/i);
  assert.match(sessionCookie,/HttpOnly/i);assert.match(sessionCookie,/SameSite=Lax/i);assert.ok(!/Domain=/i.test(sessionCookie));
  const identity=await f.auth.getIdentity(new Headers({cookie}));assert.ok(identity);
  const store=createAccountStore(f.auth.database),stamp=new Date().toISOString();
  const project=store.saveProject(identity.userId,{name:'Private production project',revisions:[{id:'revision_production',at:stamp,prompt:'A private project',number:1,
    plan:{intent:{business:'Private project',kind:'studio'},version:1},render:{html:'<!doctype html><h1>Private</h1>',version:1,pending:[]},source:'prepared',placeholder:true}]});
  assert.throws(()=>store.getProject('another_owner',project.id),error=>error.status===404);
  const restarted=await f.restart();
  assert.deepEqual(await restarted.getIdentity(new Headers({cookie})),identity);
  assert.deepEqual(createAccountStore(restarted.database).getProject(identity.userId,project.id),project);
  assert.equal(await restarted.getIdentity(new Headers({cookie,origin:'https://attacker.test'})),null);
  assert.equal((await f.request('/api/auth/update-user',{method:'POST',cookie,headers:{origin:'https://attacker.test'},body:{name:'Changed'}})).status,403);
  assert.equal((await f.request('/api/auth/get-session',{cookie,headers:{host:'attacker.test'}})).status,403);
  const reset=await f.request('/api/auth/request-password-reset',{method:'POST',body:{email:'production@example.com'}});
  assert.equal(reset.status,200);
  const resetUrl=mailUrl(messages,'reset-password'),token=resetUrl.pathname.split('/').pop();
  assert.equal((await f.request('/api/auth/reset-password',{method:'POST',body:{token,newPassword:'Replacement production password 93!'}})).status,200);
  assert.equal(await restarted.getIdentity(new Headers({cookie})),null);
});

test('production is not restricted by the staging 50-user test limit',async t=>{
  const f=await fixture(t,{options:{sendEmail:async()=>{}}});
  const signup=await f.request('/api/auth/sign-up/email',{method:'POST',body:{name:'First',email:'first@example.com',password}});
  assert.equal(signup.status,200);
  const user=f.auth.database.prepare('SELECT * FROM compass_account_user LIMIT 1').get(),columns=Object.keys(user);
  const insert=f.auth.database.prepare(`INSERT INTO compass_account_user (${columns.map(name=>`"${name}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
  for(let index=1;index<51;index++){
    const value={...user,id:`synthetic_production_${index}`,email:`production_${index}@example.com`};
    insert.run(...columns.map(name=>value[name]));
  }
  assert.equal((await f.request('/api/auth/sign-up/email',{method:'POST',body:{name:'Beyond QA cap',email:'beyond@example.com',password}})).status,200);
  assert.equal(f.auth.database.prepare('SELECT count(*) AS count FROM compass_account_user').get().count,52);
});

function appleSecret({expires=Math.floor(Date.now()/1000)+3600}={}) {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'ES256',kid:'SYNTHETIC_KEY'})}.${encode({iss:'SYNTHETIC_TEAM',sub:'world.mycompass.signin',aud:'https://appleid.apple.com',iat:Math.floor(Date.now()/1000),exp:expires})}.synthetic_signature`;
}

test('Apple state cookies support form_post while malformed/expired client assertions stay unavailable',async t=>{
  for(const secret of ['malformed',appleSecret({expires:Math.floor(Date.now()/1000)-60})]){
    const unavailable=await fixture(t,{extra:{APPLE_CLIENT_ID:'world.mycompass.signin',APPLE_CLIENT_SECRET:secret}});
    assert.deepEqual(unavailable.auth.publicConfig().providers,['google']);
    assert.equal((await unavailable.request('/api/auth/callback/apple',{method:'POST',body:'state=forged&code=forged',headers:{origin:'https://appleid.apple.com','content-type':'application/x-www-form-urlencoded'}})).status,404);
  }
  const f=await fixture(t,{extra:{APPLE_CLIENT_ID:'world.mycompass.signin',APPLE_CLIENT_SECRET:appleSecret()}});
  const response=await f.request('/api/auth/sign-in/social',{method:'POST',body:{provider:'apple',callbackURL:origin+'/workspace'}});
  assert.equal(response.status,200,await response.clone().text());
  const body=await response.json();assert.equal(new URL(body.url).origin,'https://appleid.apple.com');
  assert.equal(new URL(body.url).searchParams.get('response_mode'),'form_post');
  const stateCookie=response.headers.getSetCookie().find(value=>/\.state=/.test(value));
  assert.match(stateCookie,/SameSite=None/i);assert.match(stateCookie,/; Secure(?:;|$)/i);assert.match(stateCookie,/HttpOnly/i);
  const callback=await f.request('/api/auth/callback/apple',{method:'POST',cookie:cookieFor(response),body:'state=forged&code=forged',
    headers:{origin:'https://appleid.apple.com','sec-fetch-site':'cross-site','content-type':'application/x-www-form-urlencoded'}});
  assert.equal(callback.status,302);
  // Better Auth normalizes Apple's form POST to a same-origin GET, then checks
  // the signed state against its database entry before any token exchange.
  const callbackUrl=new URL(callback.headers.get('location'));
  const rejected=await f.request(callbackUrl.pathname+callbackUrl.search,{cookie:cookieFor(response)});
  assert.equal(rejected.status,302);assert.match(rejected.headers.get('location'),/error=/);
  assert.equal(f.auth.database.prepare('SELECT count(*) AS count FROM compass_account_user').get().count,0);
});

test('Railway public-ingress IP trust is opt-in and ignores unvalidated forwarded headers',async t=>{
  for(const trusted of [false,true]){
    const f=await fixture(t,{extra:{COMPASS_ACCOUNT_TRUST_RAILWAY_PROXY:trusted?'1':undefined,RAILWAY_PROJECT_ID:'synthetic-project',RAILWAY_SERVICE_ID:'synthetic-service'}});
    const options={method:'POST',body:{provider:'unconfigured'},headers:{'x-real-ip':'203.0.113.11','x-forwarded-for':'203.0.113.99'}};
    for(let index=0;index<30;index++)assert.equal((await f.request('/api/auth/sign-in/social',options)).status,400);
    assert.equal((await f.request('/api/auth/sign-in/social',options)).status,429);
    const separate=await f.request('/api/auth/sign-in/social',{...options,headers:{'x-real-ip':'203.0.113.12'}});
    assert.equal(separate.status,trusted?400:429);
    assert.equal((await f.request('/api/auth/sign-in/social',{...options,headers:{'x-real-ip':'forged, 203.0.113.13'}})).status,trusted?400:429);
  }
});

test('production waits for tracked delivery to finish before closing its database',async t=>{
  let deliver,started=false;
  const pending=new Promise(resolve=>{deliver=resolve});
  const f=await fixture(t,{options:{sendEmail:async()=>{started=true;await pending}}});
  const signup=await f.request('/api/auth/sign-up/email',{method:'POST',body:{name:'Delivery drain',email:'drain@example.com',password}});
  assert.equal(signup.status,200);assert.equal(started,true);
  let closed=false;const closing=f.auth.close().then(()=>{closed=true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
  deliver();await closing;assert.equal(f.auth.database,null);
});

test('disconnect keeps a usable configured sign-in method, including concurrent social-only requests',async t=>{
  const f=await fixture(t,{options:{sendEmail:async()=>{}}});
  await f.request('/api/auth/sign-up/email',{method:'POST',body:{name:'Method guard',email:'method@example.com',password}});
  f.auth.database.prepare('UPDATE compass_account_user SET emailVerified=1 WHERE email=?').run('method@example.com');
  const login=await f.request('/api/auth/sign-in/email',{method:'POST',body:{email:'method@example.com',password}});
  assert.equal(login.status,200);const cookie=cookieFor(login);
  const credential=f.auth.database.prepare("SELECT * FROM compass_account_identity WHERE providerId='credential'").get();
  const columns=Object.keys(credential),insert=f.auth.database.prepare(`INSERT INTO compass_account_identity (${columns.map(name=>'"'+name+'"').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
  for(const provider of ['google','github']){
    const row={...credential,id:'identity_'+provider,providerId:provider,accountId:'synthetic_'+provider,password:null};
    insert.run(...columns.map(name=>row[name]));
  }
  await f.restart({});
  assert.deepEqual(f.auth.publicConfig().providers,['google']);
  const blocked=await f.request('/api/auth/unlink-account',{method:'POST',cookie,body:{accountId:'identity_google'}});
  assert.equal(blocked.status,400);assert.equal((await blocked.json()).code,'FAILED_TO_UNLINK_LAST_ACCOUNT');
  f.env.GITHUB_CLIENT_ID='synthetic-github-id';f.env.GITHUB_CLIENT_SECRET='synthetic-github-secret';
  await f.restart({});
  const responses=await Promise.all(['google','github'].map(provider=>f.request('/api/auth/unlink-account',{method:'POST',cookie,body:{accountId:'identity_'+provider}})));
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,400]);
  assert.equal(f.auth.database.prepare("SELECT count(*) AS count FROM compass_account_identity WHERE providerId IN ('google','github')").get().count,1);
});
