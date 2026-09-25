import { randomUUID } from 'node:crypto';
import { validateFields, problem, snapshotKey } from './domain.mjs';

// Jobs are leased in PostgreSQL, not held in a process-local queue. A crash in
// the external-call window is deliberately blocked rather than billed twice.
export function createWorker({store,providers,enabled=false,intervalMs=1500}) {
  let timer, busy=false, stopped=false;
  const pool=store.pool;
  async function tick(){
    if(busy||stopped)return false;busy=true;
    try{
      await pool.query("UPDATE acq_runs SET status='blocked',checkpoint='uncertain',reason='Worker stopped during a provider call. Verify the provider receipt before retrying.',lease_token=NULL,updated_at=now() WHERE status='running' AND lease_until<now() AND checkpoint='dispatching'");
      await pool.query("UPDATE acq_runs SET status='queued',lease_token=NULL,updated_at=now() WHERE status='running' AND lease_until<now() AND checkpoint<>'dispatching'");
      const token=randomUUID();
      const run=(await pool.query("UPDATE acq_runs SET status='running',lease_token=$1,lease_until=now()+interval '6 minutes',updated_at=now() WHERE id=(SELECT id FROM acq_runs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",[token])).rows[0];
      if(!run)return false;
      try{
        let result=run.result, metricsSnapshot=run.input.metricsSnapshot;
        if(run.checkpoint!=='provider_done'){
          if(!enabled)throw problem('Sponsor calls are disabled until a spending limit and provider access are approved.',503,'BLOCKED');
          let args={...run.input,requestId:run.id};
          if(run.operation==='metrics'){
            const state=await store.state(run.tenant_id);
            if(!state.leads.length)throw problem('Record at least one lead before querying sponsor analytics.',409,'BLOCKED');
            args.rows=state.leads.map(l=>({tenantId:run.tenant_id,leadId:l.id,version:l.version,experimentId:l.experimentId,status:l.qualification.status,mode:l.mode}));
            metricsSnapshot=snapshotKey(state.leads);
            await pool.query('UPDATE acq_runs SET input=$1 WHERE id=$2 AND lease_token=$3',[{...run.input,metricsSnapshot},run.id,token]);
          }
          // Only this durable transition authorizes one external attempt.
          const fenced=await pool.query("UPDATE acq_runs SET checkpoint='dispatching',updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()",[run.id,token]);
          if(!fenced.rowCount)return true;
          const output=await providers[run.operation](args);
          result=output.result;
          const persisted=await pool.query("UPDATE acq_runs SET result=$1,receipt=$2,checkpoint='provider_done',updated_at=now() WHERE id=$3 AND lease_token=$4 AND status='running' AND lease_until>now()",[result,output.receipt,run.id,token]);
          if(!persisted.rowCount)return true;
        }
        if(run.operation==='extract'){
          // Persist extraction as a proposal. Human review of every field is
          // required before facts can change; the model does not qualify leads.
          validateFields(result.fields);
        }
        await store.transaction(run.tenant_id,async c=>{
          const owned=await c.query("SELECT id FROM acq_runs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",[run.id,token]);
          if(!owned.rowCount)return;
          if(run.operation==='metrics'){
            const p=(await c.query('SELECT rules_version FROM acq_projects WHERE tenant_id=$1',[run.tenant_id])).rows[0];
            // Tinybird contributes the actual decision metrics only if the
            // receipt still describes the current versioned workspace.
            if(p)await store.decision(c,run.tenant_id,p.rules_version,[`run:${run.id}`],result,metricsSnapshot);
          }
          await c.query("UPDATE acq_runs SET status='completed',checkpoint='completed',lease_until=NULL,lease_token=NULL,reason=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",[run.id,token]);
        });
      }catch(error){
        const current=(await pool.query('SELECT checkpoint FROM acq_runs WHERE id=$1',[run.id])).rows[0];
        const blocked=error.code==='BLOCKED'||error.code==='not_configured';
        const checkpoint=blocked?'blocked':current?.checkpoint==='dispatching'?'uncertain':current?.checkpoint||'failed';
        const reason=blocked?'Provider access or spending approval is missing. Check integrations.':checkpoint==='uncertain'?'Provider outcome is uncertain; automatic retry is disabled. Inspect the receipt before starting another job.':'Provider response could not be applied. No lead facts were changed.';
        await pool.query("UPDATE acq_runs SET status=$1,checkpoint=$2,reason=$3,receipt=$4,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$5 AND lease_token=$6",[blocked?'blocked':'failed',checkpoint,reason,error.receipt||null,run.id,token]);
      }
      return true;
    }finally{busy=false;}
  }
  return {tick,start(){stopped=false;timer=setInterval(()=>tick().catch(()=>{}),intervalMs);timer.unref();},async stop(){stopped=true;clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,20));}};
}
