import {loadLlm,completeJson} from '../llm.mjs';
import {createApplicationManifest,refineApplicationManifest,validateApplicationManifest} from '../generation/index.mjs';

// Models propose a bounded data schema. They never supply executable source.
// User records, OAuth tokens and account/session data never enter this context.
export async function applicationPlan({text,previous=null,preferences={},env,fetchImpl}) {
  const local=previous?refineApplicationManifest(previous,text):{manifest:createApplicationManifest(text,{preferences}),changed:true};
  if(previous&&local.changed)return {...local,source:'prepared',modelUsed:false};
  const clients=loadLlm(env,fetchImpl).clients;
  if(!clients.length)return {...local,source:'prepared',modelUsed:false};
  const result=await completeJson({clients,maxTokens:1500,messages:[{
    role:'system',content:'Design the structure of a small functional CRUD application. Return one JSON object matching the supplied manifest exactly. No code, HTML, URLs, services, credentials, records, or invented integrations. Supported kinds tracker, crm, booking, inventory. Theme mode light/dark; accent indigo/blue/slate/rose/amber; font sans/serif; density comfortable/compact. Entity contains singular, plural, at most8 fields; field key lower_snake_case, label, type text/textarea/number/date/select, required boolean, select options2to8 strings. Keep title64chars, description240chars. Do not include fields named id/owner/user/session/password/token/prototype/constructor. Preserve existing business purpose unless explicitly changed.'
  },{role:'user',content:JSON.stringify({request:text,current:previous,example:local.manifest,preferences:{visualDirection:preferences.visualDirection}})}],accept:json=>Boolean(validateApplicationManifest(json))});
  const proposed=result.json&&validateApplicationManifest(result.json);
  const manifest=proposed&&validateApplicationManifest({...proposed,...(previous?.assets?{assets:previous.assets}:{})});
  return {manifest:manifest||local.manifest,changed:!previous||JSON.stringify(manifest||local.manifest)!==JSON.stringify(previous),source:manifest?'model':'prepared',modelUsed:true};
}
