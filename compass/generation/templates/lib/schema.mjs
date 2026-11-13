const TYPES = ['text','textarea','number','date','select'];
const MODES = ['light','dark'], ACCENTS = ['indigo','blue','slate','rose','amber'];
const RESERVED = new Set(['id','owner','owner_id','userid','user_id','session','password','token','constructor','prototype','__proto__']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value,max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;

export function validateApplicationManifest(value) {
  if (!plain(value) || value.schema !== 1 || !['tracker','crm','booking','inventory'].includes(value.kind)) return null;
  const title = text(value.title,64), description = text(value.description,240);
  if (!title || !description || !plain(value.theme) || !plain(value.entity)) return null;
  const theme = value.theme;
  if (!MODES.includes(theme.mode) || !ACCENTS.includes(theme.accent) || !['sans','serif'].includes(theme.font) || !['comfortable','compact'].includes(theme.density)) return null;
  const singular = text(value.entity.singular,32), plural = text(value.entity.plural,40);
  if (!singular || !plural || !Array.isArray(value.entity.fields) || !value.entity.fields.length || value.entity.fields.length > 8) return null;
  const fields = [], keys = new Set();
  for (const field of value.entity.fields) {
    if (!plain(field) || typeof field.key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(field.key) || RESERVED.has(field.key) || keys.has(field.key)) return null;
    const label = text(field.label,48);
    if (!label || !TYPES.includes(field.type) || typeof field.required !== 'boolean') return null;
    keys.add(field.key);
    const out = {key:field.key,label,type:field.type,required:field.required};
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length < 2 || field.options.length > 8 || field.options.some(option => !text(option,48))) return null;
      out.options = [...new Set(field.options.map(option => option.trim()))];
      if (out.options.length < 2) return null;
    }
    fields.push(out);
  }
  return {schema:1,title,description,kind:value.kind,theme:{mode:theme.mode,accent:theme.accent,font:theme.font,density:theme.density},entity:{singular,plural,fields}};
}

export function validateApplicationRecord(manifest, value) {
  const spec = validateApplicationManifest(manifest);
  if (!spec || !plain(value)) return {ok:false,error:'invalid_record'};
  const keys = new Set(spec.entity.fields.map(field => field.key));
  if (Object.keys(value).some(key => !keys.has(key))) return {ok:false,error:'unknown_field'};
  const out = {};
  for (const field of spec.entity.fields) {
    const item = value[field.key];
    if (item === undefined || item === null || item === '') {
      if (field.required) return {ok:false,error:'required_field',field:field.key};
      continue;
    }
    if (field.type === 'number') {
      if (typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1e9) return {ok:false,error:'invalid_number',field:field.key};
      out[field.key] = item;
    } else {
      if (typeof item !== 'string' || item.length > (field.type === 'textarea' ? 2000 : 500) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item)) return {ok:false,error:'invalid_text',field:field.key};
      if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(item) || !Number.isFinite(Date.parse(item)) || new Date(item).toISOString().slice(0,10) !== item)) return {ok:false,error:'invalid_date',field:field.key};
      if (field.type === 'select' && !field.options.includes(item)) return {ok:false,error:'invalid_option',field:field.key};
      out[field.key] = item;
    }
  }
  return BufferByteLength(JSON.stringify(out)) <= 16384 ? {ok:true,value:out} : {ok:false,error:'record_too_large'};
}

function BufferByteLength(value) { return new TextEncoder().encode(value).length; }
