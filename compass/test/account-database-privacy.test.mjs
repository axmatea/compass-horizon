import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {createCompassServer} from '../server.mjs';

const configuredOrigin='http://localhost:8779';
async function fixture(t,setup) {
  const directory=await mkdtemp(join(tmpdir(),'compass-private-database-')),publicRoot=join(directory,'public'),privateRoot=join(directory,'private');
  await Promise.all([mkdir(publicRoot),mkdir(privateRoot)]);
  const env={NODE_ENV:'test',COMPASS_ACCOUNT_MODE:'staging',COMPASS_ACCOUNT_ORIGIN:configuredOrigin,BETTER_AUTH_SECRET:randomBytes(32).toString('base64url'),COMPASS_DEMO_MODE:'examples',STATIC_ROOT:publicRoot,COMPASS_ACCOUNT_DATABASE:join(privateRoot,'accounts.json')};
  await setup?.({directory,publicRoot,privateRoot,env});
  const app=createCompassServer({env});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true})});
  const origin='http://127.0.0.1:'+app.server.address().port;
  const request=(path,options={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(origin+path,{...options,headers:{host:new URL(configuredOrigin).host,...options.headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{
        const headers=new Headers();for(const [key,value] of Object.entries(res.headers))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])headers.append(key,item);
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));
      });
    });req.on('error',reject);if(options.body!==undefined)req.write(options.body);req.end();
  });
  const config=await (await request('/api/account/config')).json();return {env,publicRoot,privateRoot,request,config};
}
function markerDatabase(path){const db=new DatabaseSync(path);db.exec('CREATE TABLE private_marker(value TEXT)');db.prepare('INSERT INTO private_marker VALUES(?)').run('Synthetic private fixture');db.close()}

test('public database destination fails closed before creating or migrating any file',async t=>{
  const f=await fixture(t,async({publicRoot,env})=>{env.COMPASS_ACCOUNT_DATABASE=join(publicRoot,'accounts.json')});
  assert.equal(f.config.configured,false);assert.equal((await f.request('/api/account/me')).status,503);assert.equal((await f.request('/accounts.json')).status,404);
  await assert.rejects(stat(f.env.COMPASS_ACCOUNT_DATABASE),{code:'ENOENT'});
});

test('existing SQLite with a served JSON extension is never downloaded or migrated',async t=>{
  let before;
  const f=await fixture(t,async({publicRoot,env})=>{env.COMPASS_ACCOUNT_DATABASE=join(publicRoot,'accounts.json');markerDatabase(env.COMPASS_ACCOUNT_DATABASE);before=await readFile(env.COMPASS_ACCOUNT_DATABASE)});
  assert.equal(f.config.configured,false);assert.equal((await f.request('/accounts.json')).status,404);assert.deepEqual(await readFile(f.env.COMPASS_ACCOUNT_DATABASE),before);
});

test('symlinked database parent into public root and symlinked static root both fail closed',async t=>{
  await t.test('database parent resolves into public',async t=>{
    const f=await fixture(t,async({directory,publicRoot,env})=>{const alias=join(directory,'linked-database');await symlink(publicRoot,alias);env.COMPASS_ACCOUNT_DATABASE=join(alias,'accounts.json');markerDatabase(join(publicRoot,'accounts.json'))});
    assert.equal(f.config.configured,false);assert.equal((await f.request('/accounts.json')).status,404);
  });
  await t.test('parent traversal after a symlink uses filesystem rather than lexical resolution',async t=>{
    const f=await fixture(t,async({directory,publicRoot,env})=>{const nested=join(publicRoot,'nested');await mkdir(nested);const alias=join(directory,'parent-alias');await symlink(nested,alias);env.COMPASS_ACCOUNT_DATABASE=alias+'/../accounts.json';markerDatabase(join(publicRoot,'accounts.json'))});
    assert.equal(f.config.configured,false);assert.equal((await f.request('/accounts.json')).status,404);
  });
  await t.test('static root alias resolves around private-looking database path',async t=>{
    const f=await fixture(t,async({directory,publicRoot,env})=>{const alias=join(directory,'linked-public');await symlink(publicRoot,alias);env.STATIC_ROOT=alias;env.COMPASS_ACCOUNT_DATABASE=join(publicRoot,'accounts.json');markerDatabase(env.COMPASS_ACCOUNT_DATABASE)});
    assert.equal(f.config.configured,false);assert.equal((await f.request('/accounts.json')).status,404);
  });
});

test('valid private temporary database stays enabled while aliases are blocked and same-basename JSON remains public',async t=>{
  const f=await fixture(t,async({publicRoot,privateRoot})=>{
    await writeFile(join(publicRoot,'accounts.json'),' {"asset":"public"}');
    await symlink(join(privateRoot,'accounts.json'),join(publicRoot,'database-copy.json'));
    await symlink(privateRoot,join(publicRoot,'private-alias'));
  });
  assert.equal(f.config.configured,true);assert.equal(f.config.secretMode,'configured');
  const registration=await f.request('/api/auth/sign-up/email',{method:'POST',headers:{origin:configuredOrigin,'content-type':'application/json'},body:JSON.stringify({name:'Privacy QA',email:'privacy@compass.test',password:'Synthetic privacy password 42!'})});
  assert.equal(registration.status,200,await registration.clone().text());
  const cookie=registration.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.equal((await f.request('/api/account/me',{headers:{cookie}})).status,200);
  assert.equal((await stat(f.env.COMPASS_ACCOUNT_DATABASE)).mode&0o077,0);
  assert.equal((await f.request('/database-copy.json')).status,404);assert.equal((await f.request('/private-alias/accounts.json')).status,404);
  const asset=await f.request('/accounts.json');assert.equal(asset.status,200);assert.deepEqual(await asset.json(),{asset:'public'});
});
