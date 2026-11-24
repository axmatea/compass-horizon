import {completeJson} from '../llm.mjs';
import {validateApplicationManifest,validateCrmConfiguration,CRM_CURRENCIES} from '../generation/templates/lib/schema.mjs';

const draftKeys=['title','description','theme','crm'];
const plain = value => value && typeof value==='object' && !Array.isArray(value);

export function compileCrmDraft(baseline,draft) {
  if (!plain(draft) || !Object.keys(draft).some(key=>draftKeys.includes(key)) || Object.keys(draft).some(key=>!draftKeys.includes(key))) return null;
  const candidate={...baseline,...draft};
  const valid=validateApplicationManifest(candidate);
  if (valid?.crm) return {manifest:valid,buildReport:{outcome:'verified',diagnostics:[]}};

  const diagnostics=[], corrected={...baseline};
  for (const field of ['title','description','theme']) {
    if (!Object.hasOwn(draft,field)) continue;
    const trial=validateApplicationManifest({...baseline,[field]:draft[field]});
    if (trial) corrected[field]=trial[field];
    else diagnostics.push({title:'Invalid title. Kept the last valid title.',description:'Invalid description. Kept the last valid description.',theme:'Unsupported theme. Kept the last valid theme.'}[field]);
  }
  if (Object.hasOwn(draft,'crm')) {
    const settings=plain(draft.crm)?draft.crm:{};
    const currency=CRM_CURRENCIES.includes(settings.currency)?settings.currency:baseline.crm.currency;
    const branded=validateCrmConfiguration({currency,stages:settings.stages});
    corrected.crm=branded || {...baseline.crm,currency};
    if (settings.currency!==currency) diagnostics.push('Unsupported currency. Kept the last valid currency.');
    if (!branded) diagnostics.push('Invalid pipeline labels. Kept the last valid labels.');
    if (Object.keys(settings).some(key=>!['currency','stages'].includes(key))) diagnostics.push('Removed unsupported CRM settings.');
  }
  const manifest=validateApplicationManifest(corrected);
  return manifest?.crm ? {manifest,buildReport:{outcome:'repaired',diagnostics}} : null;
}

export async function planCrm({text,local,previous,projectContext,clients}) {
  if (!clients.length) return {...local,source:'prepared',modelUsed:false,buildReport:{outcome:'prepared',diagnostics:[]}};
  let compiled;
  const editable=({title,description,theme,crm})=>({title,description,theme,crm});
  const result=await completeJson({clients,maxTokens:650,messages:[{
    role:'system',content:'Configure a working consulting CRM. Return one JSON object with title (max 64), description (max 240), theme and crm, using the editable example as contract. No code, URLs, services, credentials, or records. Theme: mode light/dark, accent indigo/blue/slate/rose/amber, font sans/serif, density comfortable/compact. Currency: USD/EUR/GBP/CAD/AUD. Preserve the currency on existing projects unless explicitly asked to change it. CRM stages are display labels, max 32 chars and unique, with fixed keys new/qualified/proposal/negotiation/won/lost. Carry forward existing decisions when relevant. The current request takes precedence. Only the owner updates saved project context.'
  },{role:'user',content:JSON.stringify({request:text,current:previous?editable(previous):null,example:editable(local.manifest),...(projectContext?{projectContext}:{})})}],accept:value=>Boolean(compiled=compileCrmDraft(local.manifest,value))});
  if (!result.json || !compiled) {
    return {...local,source:'prepared',modelUsed:true,buildReport:{outcome:'prepared',diagnostics:['No valid model draft. Used the verified CRM configuration.']}};
  }
  return {...compiled,source:'model',modelUsed:true,changed:!previous||JSON.stringify(compiled.manifest)!==JSON.stringify(previous)};
}
