import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {startApplication} from '../server.mjs';

test('exported CRM builds, protects records, and persists linked workflows across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'crm-export-verification-'));
  const env = {PORT:'0', APP_DATABASE:join(directory,'isolated.sqlite'), BETTER_AUTH_SECRET:randomBytes(32).toString('hex')};
  let app = await startApplication({env});
  t.after(async () => {
    try {await app.close();}
    finally {await rm(directory,{recursive:true,force:true});}
  });
  function request(path, {method='GET', body, cookie, user, recordVersion, origin=app.origin} = {}) {
    return fetch(app.origin + path, {method, headers: {
      origin,
      ...(body ? {'content-type':'application/json'} : {}),
      ...(cookie ? {cookie} : {}),
      ...(user ? {'x-crm-user':user} : {}),
      ...(recordVersion ? {'x-compass-record-version':String(recordVersion)} : {}),
    }, ...(body ? {body:JSON.stringify(body)} : {})});
  }
  async function signup(email) {
    const response = await request('/api/auth/sign-up/email', {method:'POST', body:{name:'CRM QA',email,password:'local-test-only-password'}});
    assert.equal(response.status,200,await response.clone().text());
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.match(response.headers.getSetCookie().join(';'),/HttpOnly/i);
    const session = await (await request('/api/auth/get-session',{cookie})).json();
    return {cookie,user:session.user.id};
  }
  async function create(entity, owner, data) {
    const response = await request('/api/crm/'+entity, {...owner,method:'POST',body:{data}});
    assert.equal(response.status,201,await response.clone().text());
    return (await response.json()).record;
  }

  const page = await request('/');
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(await page.text(),/id="crm-root"/);
  assert.ok((await (await request('/crm.js')).text()).length > 1000);
  assert.equal((await request('/api/crm/clients')).status,401);
  assert.equal((await request('/not-a-real-page')).status,404);
  const first = await signup('one@example.test'), second = await signup('two@example.test');
  const client = await create('clients',first,{name:'Northstar Studio'});
  const contact = await create('contacts',first,{name:'Synthetic Morgan',email:'morgan@example.test',clientId:client.id});
  const deal = await create('deals',first,{title:'Automation audit',clientId:client.id,stage:'new',valueCents:725000});
  const task = await create('tasks',first,{title:'Follow up on scope',clientId:client.id,status:'open'});
  const proposal = await create('proposals',first,{title:'Audit proposal',dealId:deal.id,status:'sent',valueCents:725000});

  assert.equal((await request('/api/crm/clients',{...first,origin:'https://outside.test'})).status,403);
  assert.equal((await request('/api/crm/clients',{...second,user:first.user})).status,403);
  assert.deepEqual(await (await request('/api/crm/clients',second)).json(),{records:[]});
  assert.equal((await request('/api/crm/contacts',{...second,method:'POST',body:{data:contact.data}})).status,409);
  assert.equal((await request('/api/crm/deals/'+deal.id,{...second,method:'PUT',body:{data:deal.data,version:1}})).status,404);
  assert.equal((await request('/api/crm/clients/'+client.id,{...first,method:'DELETE',recordVersion:1})).status,409);
  const moved = await request('/api/crm/deals/'+deal.id,{...first,method:'PUT',body:{data:{...deal.data,stage:'won'},version:1}});
  assert.equal(moved.status,200,await moved.clone().text());
  assert.equal((await moved.json()).record.version,2);
  assert.equal((await request('/api/crm/deals/'+deal.id,{...first,method:'PUT',body:{data:deal.data,version:1}})).status,409);
  await app.close();
  app = await startApplication({env});
  const lists = Object.fromEntries(await Promise.all(['clients','contacts','deals','tasks','proposals'].map(async entity => {
    const response = await request('/api/crm/'+entity,first);
    assert.equal(response.status,200);
    return [entity,(await response.json()).records];
  })));
  assert.equal(lists.clients[0].id,client.id);
  assert.equal(lists.contacts[0].id,contact.id);
  assert.equal(lists.deals[0].data.stage,'won');
  assert.equal(lists.deals[0].data.valueCents,725000);
  assert.equal(lists.tasks[0].id,task.id);
  assert.equal(lists.proposals[0].id,proposal.id);
  assert.equal((await request('/api/auth/sign-out',{...first,method:'POST',body:{}})).status,200);
  assert.equal((await request('/api/crm/clients',first)).status,401);
});
