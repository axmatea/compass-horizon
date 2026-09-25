import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
import {migrate,createStore} from '../server/acquisition/store.mjs';
import {createWorker} from '../server/acquisition/worker.mjs';

const url=process.env.ACQUISITION_TEST_DATABASE_URL;
test('PostgreSQL: tenant isolation, replay, late arrival, versioned rules, durable queue', {skip:!url}, async()=>{
 const pool=new pg.Pool({connectionString:url});
 await migrate(pool);const store=createStore(pool),a=randomUUID(),b=randomUUID();
 const fixture={problem:'Automate sales handover',decisionMaker:true,businessFit:true,budget:null,timelineDays:30};
 try{
  await store.saveProject(a,{name:'Synthetic A',goal:'Qualify inbound demand'});
  await store.saveProject(b,{name:'Synthetic B',goal:'Separate tenant'});
  const exp=await store.addExperiment(a,{name:'A',hypothesis:'Response quality',audience:'Owners',message:'Reduce handover work'});
  const lead=await store.addLead(a,{name:'Synthetic lead',experimentId:exp.id,...fixture});
  assert.equal((await store.state(a)).leads[0].qualification.status,'NEEDS_CONTEXT');
  assert.equal((await store.state(b)).leads.length,0);
  await assert.rejects(store.addLead(b,{name:'Forbidden link',experimentId:exp.id,...fixture}),/Experiment not found/);
  const e={source:'test',externalId:randomUUID(),leadId:lead.id,occurredAt:new Date().toISOString(),fields:{budget:8000}};
  await assert.rejects(store.applyEvent(b,e),/Lead not found/);
  assert.equal((await store.applyEvent(a,e)).duplicate,false);
  assert.equal((await store.applyEvent(a,e)).duplicate,true);
  assert.equal((await store.state(a)).leads.length,1);
  assert.equal((await store.state(a)).events.length,2);
  assert.equal((await store.state(a)).leads[0].qualification.status,'QUALIFIED');
  await assert.rejects(store.applyEvent(a,{...e,fields:{budget:12000}}),/different evidence/);
  await store.applyEvent(a,{...e,externalId:randomUUID(),occurredAt:'2020-01-01T00:00:00Z',fields:{budget:1000}});
  assert.equal((await store.state(a)).leads[0].fields.budget,8000);
  const unknown=await store.addLead(a,{name:'Unknown attribution',...fixture});
  assert.equal((await store.state(a)).metrics.unknownAttribution,1);
  await store.saveProject(a,{name:'Synthetic A',goal:'Qualify inbound demand',rules:{minBudget:9000,maxTimelineDays:90}});
  const after=await store.state(a);
  assert.equal(after.project.rulesVersion,2);
  assert.equal(after.leads.find(l=>l.id===lead.id).qualification.status,'NOT_ICP');
  assert.equal(after.leads.find(l=>l.id===unknown.id).fields.budget,null);
  const run=await store.addRun(a,{operation:'research',query:'Synthetic public company research'});
  let calls=0;const providers={research:async()=>{calls++;return {result:{sources:[]},receipt:{provider:'TEST',status:'success'}};}};
  const worker=createWorker({store,providers,enabled:true});
  await worker.tick();
  assert.equal((await store.state(a)).runs.find(r=>r.id===run.id).status,'completed');
  await store.resumeRun(a,run.id);await worker.tick();assert.equal(calls,1);
  await assert.rejects(store.resumeRun(b,run.id),/Run not found/);
  // Run the real worker in a child and kill it immediately after its durable
  // provider-result write, before the completion transaction can run.
  const checkpoint=await store.addRun(a,{operation:'research',query:'Restart test'});
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import pg from 'pg';
    import {createStore} from ${JSON.stringify(new URL('../server/acquisition/store.mjs',import.meta.url).href)};
    import {createWorker} from ${JSON.stringify(new URL('../server/acquisition/worker.mjs',import.meta.url).href)};
    const p=new pg.Pool({connectionString:process.env.ACQUISITION_TEST_DATABASE_URL});
    const query=p.query.bind(p);
    p.query=async(sql,args)=>{
      const result=await query(sql,args);
      if(sql.includes("checkpoint='provider_done'")&&args[2]===process.env.TEST_RUN&&result.rowCount===1)process.kill(process.pid,'SIGKILL');
      return result;
    };
    const providers={research:async()=>({result:{sources:[]},receipt:{provider:'TEST',status:'completed',requestId:process.env.TEST_RUN}})};
    await createWorker({store:createStore(p),providers,enabled:true}).tick();
    await p.end();
  `],{env:{...process.env,TEST_RUN:checkpoint.id},stdio:'ignore'});
  const [exitCode,signal]=await once(child,'exit');
  assert.equal(exitCode,null);assert.equal(signal,'SIGKILL');
  const saved=(await pool.query('SELECT checkpoint,receipt FROM acq_runs WHERE id=$1',[checkpoint.id])).rows[0];
  assert.equal(saved.checkpoint,'provider_done');
  // Accelerate lease expiry only; the worker, not the test, wrote its checkpoint.
  await pool.query("UPDATE acq_runs SET lease_until=now()-interval '1 second' WHERE id=$1",[checkpoint.id]);
  const restarted=createWorker({store:createStore(pool),providers:{research:async()=>{throw new Error('Must not repeat provider call');}},enabled:true});
  await restarted.tick();
  assert.equal((await store.state(a)).runs.find(r=>r.id===checkpoint.id).status,'completed');
  assert.deepEqual((await pool.query('SELECT receipt FROM acq_runs WHERE id=$1',[checkpoint.id])).rows[0].receipt,saved.receipt);
  const uncertain=await store.addRun(a,{operation:'research',query:'Ambiguous dispatch'});
  await pool.query("UPDATE acq_runs SET status='running',checkpoint='dispatching',lease_until=now()-interval '1 second' WHERE id=$1",[uncertain.id]);
  await restarted.tick();
  assert.equal((await store.state(a)).runs.find(r=>r.id===uncertain.id).checkpoint,'uncertain');
  await assert.rejects(store.resumeRun(a,uncertain.id),/uncertain/);
  const blocked=await store.addRun(a,{operation:'research',query:'Spending disabled'});
  await createWorker({store,providers,enabled:false}).tick();
  assert.equal((await store.state(a)).runs.find(r=>r.id===blocked.id).status,'blocked');assert.equal(calls,1);
 }finally{
  for(const table of ['acq_runs','acq_decisions','acq_events','acq_leads','acq_experiments','acq_rules','acq_projects'])await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`,[[a,b]]);
  await pool.end();
 }
});
