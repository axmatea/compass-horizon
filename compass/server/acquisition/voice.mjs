import {randomUUID} from 'node:crypto';
import {problem,text} from './domain.mjs';

// The existing speech bridge speaks this adapter's acknowledgements. The
// authoritative lead, evidence and extraction job stay in PostgreSQL.
export async function createAcquisitionVoiceRuntime({store,identity,leadId,isAuthorized}){
  const state=await store.state(identity.tenantId);
  if(!state.leads.some(l=>l.id===leadId))throw problem('Lead not found.',404);
  const session={id:randomUUID(),state:{actions:[]}},listeners=new Set();
  const emit=e=>{for(const fn of listeners)fn(e);};
  return {
    isAuthorized,
    createSession:()=>session,
    getSession:id=>id===session.id?session:null,
    subscribe:(_id,fn)=>{listeners.add(fn);return()=>listeners.delete(fn);},
    async runTurn(_id,utterance,{turnId=randomUUID()}={}){
      try{
        if(!await isAuthorized())throw problem('Session expired.',401);
        const value=text(utterance,'Lead response',4000);
        const run=await store.addRun(identity.tenantId,{operation:'extract',leadId,text:value});
        const reply='I saved that response for extraction. Review the proposed fields before applying them. No qualification has changed yet.';
        emit({type:'acquisition_run',turnId,run});emit({type:'say',turnId,text:reply,final:true});emit({type:'done',turnId});
        return {reply,run};
      }catch{
        const reply='I could not save that response. Please use the text form and try again.';
        emit({type:'say',turnId,text:reply,final:true});emit({type:'done',turnId});return {reply};
      }
    },
  };
}
