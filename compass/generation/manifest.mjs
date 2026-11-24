import {validateApplicationManifest,validateApplicationRecord,CRM_CURRENCIES,CRM_STAGES} from './templates/lib/schema.mjs';
import {referenceAppearanceNotes} from '../src/start/reference.mjs';
export {validateApplicationManifest,validateApplicationRecord};
const field = (key,label,type = 'text',required = false,options) => ({key,label,type,required,...(options ? {options} : {})});
const KINDS = {
  tracker:{singular:'Task',plural:'Tasks',fields:[field('title','Title','text',true),field('status','Status','select',true,['To do','In progress','Done']),field('notes','Notes','textarea')]},
  crm:{singular:'Contact',plural:'Contacts',fields:[field('name','Name','text',true),field('email','Email'),field('company','Company'),field('status','Status','select',true,['New','Contacted','Customer']),field('notes','Notes','textarea')]},
  booking:{singular:'Booking',plural:'Bookings',fields:[field('name','Name','text',true),field('service','Service','text',true),field('date','Date','date',true),field('status','Status','select',true,['Requested','Confirmed','Completed']),field('notes','Notes','textarea')]},
  inventory:{singular:'Item',plural:'Inventory',fields:[field('name','Name','text',true),field('quantity','Quantity','number',true),field('category','Category'),field('notes','Notes','textarea')]},
};
const clean = (value,max) => String(value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

// The reference planner emits a small declarative header. It cannot name new
// field types, services or code. Keeping this explicit selection authoritative
// also prevents a reference name (e.g. Booking.com) from changing a tracker.
export function referenceApplicationSelection(prompt) {
  if(typeof prompt!=='string')return null;
  const header=prompt.match(/^Create an original (project tracker|CRM|booking records|inventory) app called "([^"\u0000-\u001f\u007f]{1,60})"\./);
  if(!header)return null;
  const tail=prompt.slice(header[0].length);
  if(!tail.startsWith(' Fields:'))return null;
  const selected=tail.match(/^ Fields: ([^.]{1,100})\./);
  const kind={'project tracker':'tracker',CRM:'crm','booking records':'booking',inventory:'inventory'}[header[1]];
  const keys=selected?.[1].split(',').map(value=>value.trim());
  if(!keys?.length || keys.length>8 || new Set(keys).size!==keys.length
    || keys.some(key=>!KINDS[kind].fields.some(field=>field.key===key))
    || !keys.includes(KINDS[kind].fields[0].key) || !header[2].trim() || /[<>\\]/.test(header[2])) {
    throw Object.assign(new Error('Choose supported fields and keep the main record field.'),{code:'invalid_reference_plan',status:400});
  }
  return {kind,title:header[2],notes:referenceAppearanceNotes(tail.slice(selected[0].length)),entity:{...structuredClone(KINDS[kind]),fields:keys.map(key=>structuredClone(KINDS[kind].fields.find(field=>field.key===key)))}};
}

export function createApplicationManifest(prompt, {preferences = {}} = {}) {
  if (typeof prompt !== 'string' || prompt.trim().length < 3 || prompt.length > 2000) throw Object.assign(new Error('Describe the application in 3–2000 characters.'),{code:'invalid_prompt'});
  const selection=referenceApplicationSelection(prompt);
  const fullCrm=!selection && /\bcrm\b/i.test(prompt) && /\b(?:pipeline|proposals?|revenue|follow[- ]ups?|consulting)\b/i.test(prompt);
  const kind = selection?.kind || (fullCrm ? 'crm' : /\b(book|booking|reservation|appointment)\b/i.test(prompt) ? 'booking'
    : /\b(inventory|stock|warehouse|quantity)\b/i.test(prompt) ? 'inventory'
      : /\bcrm\b/i.test(prompt) ? 'crm'
        : /\b(task|tasks|to-do|todo|project tracker)\b/i.test(prompt) ? 'tracker'
          : /\b(contact|contacts|customer|customers|lead|leads)\b/i.test(prompt) ? 'crm' : 'tracker');
  const named = prompt.match(/\b(?:called|named)\s+["“]?([\p{L}\p{N}][\p{L}\p{N} &'’-]{1,63})/iu)?.[1];
  const title = selection?.title || clean(named?.split(/\s+(?:with|and|that|for|using|where)\s+/i)[0] || (fullCrm ? 'Consulting CRM' : {crm:'Contact workspace',booking:'Booking workspace',inventory:'Inventory workspace',tracker:'Project tracker'}[kind]),64);
  const appearance=selection ? selection.notes : prompt;
  const theme = {mode:/\bdark\b/i.test(appearance) ? 'dark' : 'light',accent:'indigo',font:preferences.visualDirection === 'editorial' ? 'serif' : 'sans',density:'comfortable'};
  if (/\bcompact\b/i.test(appearance)) theme.density = 'compact';
  const sans=/\bsans(?:[\s-]+serif)?\b/i.test(appearance);
  if (sans) theme.font = 'sans';
  else if (/\b(?:serif|editorial)\b/i.test(appearance)) theme.font = 'serif';
  for (const accent of ['indigo','blue','slate','rose','amber']) if (new RegExp(`\\b${accent}\\b`,'i').test(appearance)) theme.accent = accent;
  const description=fullCrm ? 'Manage clients, deals, follow-ups, proposals, and revenue.' : selection ? {tracker:'Project tracker',crm:'Contacts',booking:'Booking records',inventory:'Inventory'}[kind] : clean(prompt,240);
  const currency=prompt.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1].toUpperCase() || 'USD';
  return validateApplicationManifest({schema:1,title,description,kind,theme,entity:selection?.entity || structuredClone(KINDS[kind]),...(fullCrm?{crm:{currency,stages:CRM_STAGES}}:{})});
}

export function refineApplicationManifest(value,instruction) {
  const manifest = validateApplicationManifest(value);
  if (!manifest || typeof instruction !== 'string' || instruction.length > 2000 || !instruction.trim()) throw Object.assign(new Error('Invalid refinement.'),{code:'invalid_refinement'});
  const next = structuredClone(manifest), changes = [];
  const set = (field,value) => { if (next.theme[field] !== value) { next.theme[field] = value; changes.push(`theme.${field}`); } };
  if (/\bdark\b/i.test(instruction)) set('mode','dark');
  else if (/\blight|white\b/i.test(instruction)) set('mode','light');
  if (/\bcompact\b/i.test(instruction)) set('density','compact');
  else if (/\bcomfortable|spacious|minimal\b/i.test(instruction)) set('density','comfortable');
  if (/\bserif|editorial\b/i.test(instruction)) set('font','serif');
  else if (/\bsans|modern type\b/i.test(instruction)) set('font','sans');
  for (const accent of ['indigo','blue','slate','rose','amber']) if (new RegExp(`\\b${accent}\\b`,'i').test(instruction)) set('accent',accent);
  if (next.crm) {
    const currency=instruction.match(/\bcurrency\s+(?:to\s+)?([A-Z]{3})\b/i)?.[1].toUpperCase();
    if (CRM_CURRENCIES.includes(currency) && next.crm.currency!==currency) {
      next.crm.currency=currency;
      changes.push('crm.currency');
    }
    return {manifest:validateApplicationManifest(next),changed:changes.length>0,changes,message:changes.length?'CRM settings updated.':'Use Plan to review CRM design and pipeline changes.'};
  }
  const known = [field('priority','Priority','select',false,['Low','Normal','High']),field('due_date','Due date','date'),field('email','Email'),field('notes','Notes','textarea'),field('amount','Amount','number'),field('quantity','Quantity','number'),field('status','Status','select',true,['To do','In progress','Done'])];
  for (const candidate of known) {
    const words = candidate.label.toLowerCase().replace(/ /g,'\\s+');
    if (new RegExp(`\\b(?:add|include)\\s+(?:an?\\s+)?${words}(?:\\s+field)?\\b`,'i').test(instruction) && !next.entity.fields.some(item => item.key === candidate.key) && next.entity.fields.length < 8) {
      next.entity.fields.push(candidate); changes.push(`add.${candidate.key}`);
    }
    if (new RegExp(`\\bremove\\s+(?:the\\s+)?${words}(?:\\s+field)?\\b`,'i').test(instruction) && next.entity.fields.length > 1 && next.entity.fields.some(item => item.key === candidate.key)) {
      next.entity.fields = next.entity.fields.filter(item => item.key !== candidate.key); changes.push(`remove.${candidate.key}`);
    }
  }
  return {manifest:validateApplicationManifest(next),changed:changes.length > 0,changes,
    message:changes.length ? 'Application fields and appearance updated.' : 'Try changing the theme or adding a priority, due date, notes, amount or quantity field.'};
}
