export const crmEntities = Object.freeze(['clients', 'contacts', 'deals', 'tasks', 'proposals']);
export const dealStages = Object.freeze(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
export const taskStatuses = Object.freeze(['open', 'done']);
export const proposalStatuses = Object.freeze(['draft', 'sent', 'accepted', 'declined']);

const text = (value, max) => typeof value === 'string' && value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && Boolean(value.trim());
export const crmId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const amount = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_00;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const email = value => text(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const label = value => text(value, 120);
const notes = value => text(value, 1000);

const fields = {
  clients: {required: {name: label}, optional: {industry: label, website: value => text(value, 250), notes}},
  contacts: {required: {name: label, clientId: crmId}, optional: {email, role: label, notes}},
  deals: {required: {title: label, clientId: crmId, stage: value => dealStages.includes(value), valueCents: amount}, optional: {closeDate: date, notes}},
  tasks: {required: {title: label, clientId: crmId, status: value => taskStatuses.includes(value)}, optional: {dueDate: date, notes}},
  proposals: {required: {title: label, dealId: crmId, status: value => proposalStatuses.includes(value), valueCents: amount}, optional: {notes}},
};

export function parseCrmRecord(entity, input) {
  const invalid = {ok: false, error: 'invalid_record'};
  if (!crmEntities.includes(entity) || !input || typeof input !== 'object' || Array.isArray(input)) return invalid;
  const {required, optional} = fields[entity];
  const data = {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) return invalid;
  }
  for (const [key, validate] of Object.entries({...required, ...optional})) {
    const raw = Object.hasOwn(input, key) ? input[key] : undefined;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (Object.hasOwn(optional, key) && (value === undefined || value === '')) continue;
    if (!validate(value)) return invalid;
    data[key] = value;
  }
  return {ok: true, data};
}

export function crmReferences(entity, data) {
  if (entity === 'proposals') return [{entity: 'deals', id: data.dealId}];
  if (entity === 'contacts' || entity === 'deals' || entity === 'tasks') return [{entity: 'clients', id: data.clientId}];
  return [];
}
