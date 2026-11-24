import type {CrmConfig, CrmRow, Currency, DealStage, Entity, Records} from './types';

export const entities: Entity[] = ['clients', 'contacts', 'deals', 'tasks', 'proposals'];
export const stages: DealStage[] = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const stageLabels: Record<DealStage, string> = {
  new: 'New', qualified: 'Qualified', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
};
export const names: Record<Entity, string> = {clients: 'Client', contacts: 'Contact', deals: 'Deal', tasks: 'Follow-up', proposals: 'Proposal'};
export const recordName = (row: CrmRow) => String(row.data.name ?? row.data.title ?? '');
export const stageLabel = (config: CrmConfig, stage: DealStage) => config.crm?.stages[stage] || stageLabels[stage];
export const money = (cents: number, currency: Currency = 'USD') =>
  new Intl.NumberFormat('en-US', {style: 'currency', currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2}).format(cents / 100);
export const amount = (row: CrmRow) => Number(row.data.valueCents) || 0;
const byId = (rows: CrmRow[], id: string | number) => rows.find(row => row.id === id);
export const relationName = (rows: CrmRow[], id: string | number) => {
  const row = byId(rows, id);
  return row ? recordName(row) : '';
};

type Option = {value: string; label: string};
export type Field = {
  key: string; label: string; type: 'text' | 'email' | 'notes' | 'money' | 'date' | 'select';
  required?: boolean; options?: Option[];
};
const option = (value: string, label: string): Option => ({value, label});
const required = (key: string, label: string, type: Field['type'] = 'text'): Field => ({key, label, type, required: true});
const notes: Field = {key: 'notes', label: 'Notes', type: 'notes'};
const valued = required('valueCents', 'Value', 'money');
const link = (records: CrmRow[], key: string, label: string): Field =>
  ({key, label, type: 'select', required: true, options: records.map(row => option(row.id, recordName(row)))});

export function entityFields(entity: Entity, records: Records, config: CrmConfig): Field[] {
  const client = link(records.clients, 'clientId', 'Client');
  switch (entity) {
    case 'clients': return [required('name', 'Client name'), {key: 'industry', label: 'Industry', type: 'text'}, {key: 'website', label: 'Website', type: 'text'}, notes];
    case 'contacts': return [required('name', 'Full name'), client, {key: 'email', label: 'Email', type: 'email'}, {key: 'role', label: 'Role', type: 'text'}, notes];
    case 'deals': return [required('title', 'Deal name'), client, {...required('stage', 'Stage', 'select'), options: stages.map(stage => option(stage, stageLabel(config, stage)))}, valued, {key: 'closeDate', label: 'Close date', type: 'date'}, notes];
    case 'tasks': return [required('title', 'Follow-up'), client, {...required('status', 'Status', 'select'), options: [option('open', 'Open'), option('done', 'Done')]}, {key: 'dueDate', label: 'Due date', type: 'date'}, notes];
    case 'proposals': return [required('title', 'Proposal name'), link(records.deals, 'dealId', 'Deal'), {...required('status', 'Status', 'select'), options: [option('draft', 'Draft'), option('sent', 'Sent'), option('accepted', 'Accepted'), option('declined', 'Declined')]}, valued, notes];
  }
}

export function recordDetails(entity: Entity, row: CrmRow, records: Records, config: CrmConfig) {
  const data = row.data;
  const client = relationName(records.clients, row.data.clientId);
  switch (entity) {
    case 'clients': return [String(data.industry || ''), String(data.website || '')];
    case 'contacts': return [client, String(data.role || ''), String(data.email || '')];
    case 'deals': return [client, money(amount(row), config.crm?.currency), stageLabel(config, String(data.stage) as DealStage)];
    case 'tasks': return [client, data.status === 'done' ? 'Done' : 'Open', String(data.dueDate || '')];
    case 'proposals': return [relationName(records.deals, data.dealId), money(amount(row), config.crm?.currency), String(data.status || '')];
  }
}
