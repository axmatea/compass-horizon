import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { DEFAULT_RULES, FIELD_NAMES, problem, text, validateRules, validateFields, qualify, mergeEvidence, calculateMetrics, recommend, snapshotKey } from './domain.mjs';

const iso = value => new Date(value).toISOString();
const leadView = r => ({ id:r.id, name:r.name, experimentId:r.experiment_id, fields:r.fields, qualification:r.qualification, version:Number(r.version), updatedAt:iso(r.updated_at), mode:r.mode });
const runView = r => ({ id:r.id, operation:r.operation, status:r.status, checkpoint:r.checkpoint, leadId:r.input?.leadId, reason:r.reason, result:r.result, receipt:r.receipt, updatedAt:iso(r.updated_at) });
export { runView };
export function createPool(env = process.env) {
  if (!env.DATABASE_URL) return null;
  return new pg.Pool({ connectionString:env.DATABASE_URL, max:8, connectionTimeoutMillis:5000, idleTimeoutMillis:30000, ...(env.PGSSL === 'require' ? {ssl:{rejectUnauthorized:true}} : {}) });
}
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('compass-acquisition-schema-v1'))");
    await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export function createStore(pool) {
  async function transaction(tenant, fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenant]);
      const value = await fn(c);
      await c.query('COMMIT'); return value;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async function project(c, tenant) {
    const r = (await c.query('SELECT * FROM acq_projects WHERE tenant_id=$1',[tenant])).rows[0];
    if (!r) throw problem('Set up your business first.',409,'project_required');
    return r;
  }
  async function decision(c, tenant, rulesVersion, evidenceIds, sponsorMetrics, expectedSnapshot) {
    const leads = (await c.query('SELECT * FROM acq_leads WHERE tenant_id=$1',[tenant])).rows.map(leadView);
    let metrics = calculateMetrics(leads);
    if(sponsorMetrics && expectedSnapshot===snapshotKey(leads)){
      const keys=['totalLeads','qualified','unresolved','notIcp','unknownAttribution'];
      const sort=rows=>JSON.stringify([...rows].sort((a,b)=>a.experimentId.localeCompare(b.experimentId)));
      if(sponsorMetrics.source!=='Tinybird'||keys.some(k=>sponsorMetrics[k]!==metrics[k])||sort(sponsorMetrics.experiments)!==sort(metrics.experiments))throw problem('Sponsor metrics do not match the canonical snapshot.',409,'metrics_mismatch');
      metrics={...sponsorMetrics,_snapshot:expectedSnapshot};
    }
    await c.query('INSERT INTO acq_decisions(id,tenant_id,recommendation,status,evidence_ids,rules_version,metrics) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),tenant,recommend(metrics),metrics.sampleStatus,JSON.stringify(evidenceIds),rulesVersion,metrics]);
  }
  async function state(tenant, integrations = []) {
    // A read transaction keeps the workspace snapshot internally consistent.
    return transaction(tenant, async c => {
      const p = (await c.query('SELECT * FROM acq_projects WHERE tenant_id=$1',[tenant])).rows[0];
      const experiments = (await c.query('SELECT * FROM acq_experiments WHERE tenant_id=$1 ORDER BY created_at,id',[tenant])).rows.map(r=>({id:r.id,name:r.name,hypothesis:r.hypothesis,audience:r.audience,message:r.message}));
      const leads = (await c.query('SELECT * FROM acq_leads WHERE tenant_id=$1 ORDER BY updated_at DESC,id',[tenant])).rows.map(leadView);
      const events = (await c.query('SELECT * FROM acq_events WHERE tenant_id=$1 ORDER BY received_at DESC,id LIMIT 200',[tenant])).rows.map(r=>({id:r.id,source:r.source,externalId:r.external_id,leadId:r.lead_id,fields:r.fields,occurredAt:iso(r.occurred_at),receivedAt:iso(r.received_at),mode:r.mode}));
      const decisionRows=(await c.query('SELECT * FROM acq_decisions WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT 100',[tenant])).rows;
      const decisions = decisionRows.map(r=>({id:r.id,recommendation:r.recommendation,status:r.status,evidenceIds:r.evidence_ids,rulesVersion:r.rules_version,createdAt:iso(r.created_at)}));
      const runs = (await c.query('SELECT * FROM acq_runs WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT 50',[tenant])).rows.map(runView);
      const sponsor=decisionRows.find(r=>r.metrics.source==='Tinybird'&&r.metrics._snapshot===snapshotKey(leads))?.metrics;
      const metrics=sponsor?Object.fromEntries(Object.entries(sponsor).filter(([k])=>k!=='_snapshot')):calculateMetrics(leads);
      return { mode:'LIVE', project:p?{id:p.id,name:p.name,goal:p.goal,rules:p.rules,rulesVersion:p.rules_version}:null, experiments,leads,events,decisions,runs,metrics,integrations };
    });
  }
  async function saveProject(tenant, input) {
    const name=text(input.name,'Business name',120), goal=text(input.goal,'Goal',500);
    return transaction(tenant, async c => {
      const old=(await c.query('SELECT * FROM acq_projects WHERE tenant_id=$1',[tenant])).rows[0];
      const rules=validateRules(input.rules ?? old?.rules ?? DEFAULT_RULES);
      const changed=!old || JSON.stringify(rules)!==JSON.stringify(old.rules);
      const version=old?(old.rules_version+(changed?1:0)):1;
      await c.query('INSERT INTO acq_projects(id,tenant_id,name,goal,rules,rules_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id) DO UPDATE SET name=$3,goal=$4,rules=$5,rules_version=$6',[old?.id||randomUUID(),tenant,name,goal,rules,version]);
      if(changed){
        await c.query('INSERT INTO acq_rules(tenant_id,version,rules) VALUES($1,$2,$3)',[tenant,version,rules]);
        const leads=(await c.query('SELECT * FROM acq_leads WHERE tenant_id=$1',[tenant])).rows;
        for(const lead of leads) await c.query('UPDATE acq_leads SET qualification=$1,version=version+1,updated_at=now() WHERE tenant_id=$2 AND id=$3',[qualify(lead.fields,rules,version),tenant,lead.id]);
        await decision(c,tenant,version,[`rules:${version}`]);
      }
    });
  }
  async function addExperiment(tenant,input){
    const values=['name','hypothesis','audience','message'].map(k=>text(input[k],k,k==='name'?120:1500));
    return transaction(tenant,async c=>{
      await project(c,tenant);
      const count=Number((await c.query('SELECT count(*) FROM acq_experiments WHERE tenant_id=$1',[tenant])).rows[0].count);
      if(count>=100)throw problem('Experiment limit reached.',409);
      const id=randomUUID();await c.query('INSERT INTO acq_experiments(id,tenant_id,name,hypothesis,audience,message) VALUES($1,$2,$3,$4,$5,$6)',[id,tenant,...values]);return {id};
    });
  }
  async function addLead(tenant,input){
    const name=text(input.name,'Lead name',120);
    const fields=validateFields(Object.fromEntries(FIELD_NAMES.filter(k=>k in input).map(k=>[k,input[k]])),{partial:false});
    return transaction(tenant,async c=>{
      const p=await project(c,tenant);
      const count=Number((await c.query('SELECT count(*) FROM acq_leads WHERE tenant_id=$1',[tenant])).rows[0].count);
      if(count>=5000)throw problem('Workspace lead limit reached.',409);
      const experimentId=input.experimentId||null;
      if(experimentId && !(await c.query('SELECT id FROM acq_experiments WHERE tenant_id=$1 AND id::text=$2',[tenant,experimentId])).rowCount)throw problem('Experiment not found.',404);
      const id=randomUUID(),eid=randomUUID(),occurredAt=new Date().toISOString();
      const clocks=Object.fromEntries(FIELD_NAMES.filter(k=>fields[k]!==null).map(k=>[k,JSON.stringify([occurredAt,'manual',eid])]));
      await c.query('INSERT INTO acq_leads(id,tenant_id,name,experiment_id,fields,clocks,qualification) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,tenant,name,experimentId,fields,clocks,qualify(fields,p.rules,p.rules_version)]);
      await c.query("INSERT INTO acq_events(id,tenant_id,source,external_id,lead_id,fields,occurred_at,mode) VALUES($1::uuid,$2,'manual',$1::text,$3,$4,$5,'LIVE')",[eid,tenant,id,fields,occurredAt]);
      await decision(c,tenant,p.rules_version,[eid]);return {id};
    });
  }
  async function applyEvent(tenant,input){
    const source=text(input.source,'Source',80),externalId=text(input.externalId,'External event ID',180);
    const leadId=text(input.leadId,'Lead ID',64),fields=validateFields(input.fields);
    if(!Object.keys(fields).length)throw problem('Provide at least one field.');
    const date=new Date(input.occurredAt);
    if(!input.occurredAt||!Number.isFinite(date.getTime())||date.getTime()>Date.now()+300000)throw problem('A valid occurrence time, not in the future, is required.');
    const occurredAt=date.toISOString();
    return transaction(tenant,async c=>{
      const duplicate=(await c.query('SELECT * FROM acq_events WHERE tenant_id=$1 AND source=$2 AND external_id=$3',[tenant,source,externalId])).rows[0];
      if(duplicate){
        if(duplicate.lead_id!==leadId||iso(duplicate.occurred_at)!==occurredAt||JSON.stringify(Object.entries(duplicate.fields).sort())!==JSON.stringify(Object.entries(fields).sort()))throw problem('Event ID was already used for different evidence.',409,'idempotency_conflict');
        return {duplicate:true,eventId:duplicate.id};
      }
      const lead=(await c.query('SELECT * FROM acq_leads WHERE tenant_id=$1 AND id::text=$2 FOR UPDATE',[tenant,leadId])).rows[0];
      if(!lead)throw problem('Lead not found.',404);
      const p=await project(c,tenant),id=randomUUID();
      const merged=mergeEvidence(lead.fields,lead.clocks,fields,{occurredAt,source,externalId});
      await c.query('INSERT INTO acq_events(id,tenant_id,source,external_id,lead_id,fields,occurred_at,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,tenant,source,externalId,leadId,fields,occurredAt,lead.mode]);
      await c.query('UPDATE acq_leads SET fields=$1,clocks=$2,qualification=$3,version=version+1,updated_at=now() WHERE tenant_id=$4 AND id=$5',[merged.fields,merged.clocks,qualify(merged.fields,p.rules,p.rules_version),tenant,leadId]);
      await decision(c,tenant,p.rules_version,[id]);return {duplicate:false,eventId:id,changed:merged.changed};
    });
  }
  async function addRun(tenant,input){
    if(!['research','extract','metrics'].includes(input.operation))throw problem('Unknown operation.');
    const clean={};
    if(input.operation==='research')clean.query=text(input.query,'Research query',1000);
    if(input.operation==='extract'){clean.text=text(input.text,'Lead response',4000);clean.leadId=text(input.leadId,'Lead ID',64);}
    return transaction(tenant,async c=>{
      await project(c,tenant);
      if(clean.leadId && !(await c.query('SELECT id FROM acq_leads WHERE tenant_id=$1 AND id::text=$2',[tenant,clean.leadId])).rowCount)throw problem('Lead not found.',404);
      const count=Number((await c.query("SELECT count(*) FROM acq_runs WHERE tenant_id=$1 AND status IN ('queued','running')",[tenant])).rows[0].count);
      if(count>=5)throw problem('Five jobs are already queued. Wait for completion.',429);
      return runView((await c.query('INSERT INTO acq_runs(id,tenant_id,operation,input) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),tenant,input.operation,clean])).rows[0]);
    });
  }
  async function resumeRun(tenant,id){
    return transaction(tenant,async c=>{
      const run=(await c.query('SELECT * FROM acq_runs WHERE tenant_id=$1 AND id::text=$2 FOR UPDATE',[tenant,id])).rows[0];
      if(!run)throw problem('Run not found.',404);
      if(run.status==='completed'||run.status==='running'||run.status==='queued')return runView(run);
      if(['dispatching','uncertain'].includes(run.checkpoint))throw problem('Provider outcome is uncertain. Inspect provider records before any retry; this run will not dispatch twice.',409,'outcome_uncertain');
      const count=Number((await c.query("SELECT count(*) FROM acq_runs WHERE tenant_id=$1 AND status IN ('queued','running')",[tenant])).rows[0].count);
      if(count>=5)throw problem('Five jobs are already queued. Wait for completion.',429);
      return runView((await c.query("UPDATE acq_runs SET status='queued',reason=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 RETURNING *",[run.id])).rows[0]);
    });
  }
  async function saveEarlyAccess(input){
    const email=text(input.email,'Email',254).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||input.consent!==true)throw problem('Enter a valid email and consent to contact about early access.');
    const name=input.name?text(input.name,'Name',120):null,business=input.business?text(input.business,'Business',300):null;
    await pool.query('INSERT INTO acq_early_access(id,email,name,business,consent) VALUES($1,$2,$3,$4,true) ON CONFLICT(email) DO NOTHING',[randomUUID(),email,name,business]);
    return {ok:true};
  }
  return {pool,transaction,state,saveProject,addExperiment,addLead,applyEvent,addRun,resumeRun,saveEarlyAccess,decision};
}
