export const stages = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const projectStates = ['planned', 'active', 'complete'] as const;
export const taskKinds = ['task', 'follow-up'] as const;
export type Stage = (typeof stages)[number];
export type ProjectState = (typeof projectStates)[number];
export type TaskKind = (typeof taskKinds)[number];

type Common = {id: number; title: string; notes: string};
export type Client = Common & {kind: 'client'; industry: string};
export type Contact = Common & {kind: 'contact'; clientId: number; email: string; role: string};
export type Opportunity = Common & {kind: 'opportunity'; clientId: number; stage: Stage; valueCents: number};
export type Task = Common & {kind: 'task'; clientId: number | null; category: TaskKind; dueDate: string; done: boolean};
export type Project = Common & {kind: 'project'; clientId: number | null; status: ProjectState; photoUri: string | null};
export type Row = Client | Contact | Opportunity | Task | Project;
export type Kind = Row['kind'];
export type Workspace = {version: 1; nextId: number; records: Row[]};
export type Draft = {title: string; notes: string; clientId: number | null; industry: string; email: string; role: string;
  stage: Stage; value: string; category: TaskKind; dueDate: string; done: boolean; status: ProjectState};

const limit = 400;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const safeText = (value: unknown, max: number) => typeof value === 'string' && value.length <= max && !controls.test(value);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const maybeId = (value: unknown) => value === null || positiveId(value);
const validImageUri = (value: unknown) => typeof value === 'string' && value.length <= 1024 &&
  /^file:\/\/\/[^\u0000-\u001f\u007f]+\/personal-os-[0-9-]+\.(?:jpg|png|webp|heic)$/.test(value);

export function emptyWorkspace(): Workspace {
  return {version: 1, nextId: 1, records: []};
}

export function listOf<K extends Kind>(workspace: Workspace, kind: K): Extract<Row, {kind: K}>[] {
  return workspace.records.filter((row): row is Extract<Row, {kind: K}> => row.kind === kind);
}

export function dayKey(now: Date = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

export function nextDay(now: Date = new Date()) {
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

export function validDay(value: string) {
  if (!/^[2-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00');
  return Number.isFinite(parsed.valueOf()) && dayKey(parsed) === value;
}

export function reminderDate(dueDate: string, now = Date.now()): Date | null {
  if (!validDay(dueDate)) return null;
  const date = new Date(dueDate + 'T09:00:00');
  return date.valueOf() > now ? date : null;
}

export function centsFromAmount(input: string): number | null {
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(input.trim())) return null;
  const [units, fraction = ''] = input.trim().split('.');
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'));
}

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {style: 'currency', currency, minimumFractionDigits: cents % 100 ? 2 : 0}).format(cents / 100);
}

function isRow(value: unknown): value is Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!positiveId(row.id) || !safeText(row.title, 100) || !(row.title as string).trim() || !safeText(row.notes, 600)) return false;
  switch (row.kind) {
    case 'client': return safeText(row.industry, 100);
    case 'contact': return positiveId(row.clientId) && safeText(row.email, 254) && safeText(row.role, 100) &&
      (row.email === '' || emailPattern.test(row.email as string));
    case 'opportunity': return positiveId(row.clientId) && stages.includes(row.stage as Stage) && typeof row.valueCents === 'number' &&
      Number.isSafeInteger(row.valueCents) && row.valueCents >= 0 && row.valueCents <= 99_999_999_999;
    case 'task': return maybeId(row.clientId) && taskKinds.includes(row.category as TaskKind) &&
      typeof row.done === 'boolean' && typeof row.dueDate === 'string' && (row.dueDate === '' || validDay(row.dueDate));
    case 'project': return maybeId(row.clientId) && projectStates.includes(row.status as ProjectState) &&
      (row.photoUri === null || validImageUri(row.photoUri));
    default: return false;
  }
}

export function decodeWorkspace(value: string | null): Workspace {
  if (value === null) return emptyWorkspace();
  const candidate: unknown = JSON.parse(value);
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new Error('Invalid workspace.');
  const {version, nextId, records} = candidate as Record<string, unknown>;
  if (version !== 1 || !positiveId(nextId) || !Array.isArray(records) || records.length > limit || !records.every(isRow)) {
    throw new Error('Invalid workspace.');
  }
  const ids = new Set(records.map(row => row.id));
  const clientIds = new Set(records.filter(row => row.kind === 'client').map(row => row.id));
  if (ids.size !== records.length || records.some(row => row.id >= nextId ||
      ('clientId' in row && row.clientId !== null && !clientIds.has(row.clientId)))) throw new Error('Invalid workspace links.');
  return {version, nextId, records};
}

export function newDraft(kind: Kind, row?: Row): Draft {
  return {
    title: row?.title ?? '', notes: row?.notes ?? '',
    clientId: row && 'clientId' in row ? row.clientId : null,
    industry: row?.kind === 'client' ? row.industry : '',
    email: row?.kind === 'contact' ? row.email : '', role: row?.kind === 'contact' ? row.role : '',
    stage: row?.kind === 'opportunity' ? row.stage : 'new',
    value: row?.kind === 'opportunity' ? (row.valueCents / 100).toFixed(2) : '',
    category: row?.kind === 'task' ? row.category : 'task',
    dueDate: row?.kind === 'task' ? row.dueDate : kind === 'task' ? dayKey() : '',
    done: row?.kind === 'task' ? row.done : false,
    status: row?.kind === 'project' ? row.status : 'planned',
  };
}

export function saveDraft(workspace: Workspace, kind: Kind, draft: Draft, existingId?: number): Workspace {
  const existing = existingId === undefined ? undefined : workspace.records.find(row => row.id === existingId && row.kind === kind);
  if (existingId !== undefined && !existing) throw new Error('This record is no longer available.');
  if (!existing && workspace.records.length >= limit) throw new Error('This device workspace has reached its record limit.');
  const common = {id: existing?.id ?? workspace.nextId, title: draft.title.trim(), notes: draft.notes.trim()};
  if (!common.title) throw new Error('Enter a name.');
  const {clientId} = draft;
  if ((kind === 'contact' || kind === 'opportunity') && clientId === null) throw new Error('Choose a client.');
  if (kind !== 'client' && clientId !== null && !workspace.records.some(row => row.kind === 'client' && row.id === clientId)) {
    throw new Error('Choose an available client.');
  }
  let record: Row;
  switch (kind) {
    case 'client': record = {...common, kind, industry: draft.industry.trim()}; break;
    case 'contact': record = {...common, kind, clientId: clientId!, email: draft.email.trim(), role: draft.role.trim()}; break;
    case 'opportunity': {
      const valueCents = centsFromAmount(draft.value);
      if (valueCents === null) throw new Error('Enter a valid amount with no more than two decimal places.');
      record = {...common, kind, clientId: clientId!, stage: draft.stage, valueCents};
      break;
    }
    case 'task': {
      if (draft.dueDate && !validDay(draft.dueDate)) throw new Error('Use a valid date in YYYY-MM-DD format.');
      if (draft.category === 'follow-up' && !draft.dueDate) throw new Error('Enter a due date for the follow-up.');
      record = {...common, kind, clientId, category: draft.category, dueDate: draft.dueDate, done: draft.done};
      break;
    }
    case 'project': record = {...common, kind, clientId, status: draft.status, photoUri: existing?.kind === 'project' ? existing.photoUri : null}; break;
  }
  if (!isRow(record)) throw new Error(kind === 'contact' ? 'Check the contact details and email address.' : 'Check the record details.');
  return {
    ...workspace,
    nextId: existing ? workspace.nextId : workspace.nextId + 1,
    records: existing ? workspace.records.map(row => row.id === record.id ? record : row) : [...workspace.records, record],
  };
}

export function updateRecord<R extends Row>(workspace: Workspace, record: R): Workspace {
  if (!isRow(record) || !workspace.records.some(row => row.id === record.id && row.kind === record.kind)) {
    throw new Error('This record is no longer available.');
  }
  if ('clientId' in record && record.clientId !== null && !workspace.records.some(row => row.kind === 'client' && row.id === record.clientId)) {
    throw new Error('Choose an available client.');
  }
  return {...workspace, records: workspace.records.map(row => row.id === record.id ? record : row)};
}

export function removeRecord(workspace: Workspace, record: Row): Workspace {
  if (record.kind === 'client' && workspace.records.some(row => 'clientId' in row && row.clientId === record.id)) {
    throw new Error('Remove or reassign this client’s linked records first.');
  }
  return {...workspace, records: workspace.records.filter(row => row.id !== record.id)};
}

export function summarize(workspace: Workspace, now: Date = new Date()) {
  const today = dayKey(now);
  const tasks = listOf(workspace, 'task');
  const openTasks = tasks.filter(task => !task.done && (!task.dueDate || task.dueDate <= today));
  const opportunities = listOf(workspace, 'opportunity');
  return {
    openTasks,
    overdueFollowUps: openTasks.filter(task => task.category === 'follow-up' && task.dueDate < today),
    won: opportunities.filter(deal => deal.stage === 'won').reduce((sum, deal) => sum + deal.valueCents, 0),
    activePipeline: opportunities.filter(deal => deal.stage !== 'won' && deal.stage !== 'lost')
      .reduce((sum, deal) => sum + deal.valueCents, 0),
    activeProjects: listOf(workspace, 'project').filter(project => project.status === 'active').length,
    opportunityValues: Object.fromEntries(stages.map(stage => [stage, opportunities
      .filter(deal => deal.stage === stage).reduce((sum, deal) => sum + deal.valueCents, 0)])) as Record<Stage, number>,
  };
}

export function sampleWorkspace(now: Date = new Date()): Workspace {
  const today = dayKey(now);
  const tomorrow = nextDay(now);
  return {version: 1, nextId: 9, records: [
    {id: 1, kind: 'client', title: 'Northstar Studio', industry: 'Creative studio', notes: ''},
    {id: 2, kind: 'client', title: 'Juniper Works', industry: 'Professional services', notes: ''},
    {id: 3, kind: 'contact', title: 'Avery Demo', clientId: 1, email: 'avery@example.test', role: 'Operations lead', notes: ''},
    {id: 4, kind: 'opportunity', title: 'Automation discovery', clientId: 1, stage: 'qualified', valueCents: 720000, notes: ''},
    {id: 5, kind: 'opportunity', title: 'AI readiness audit', clientId: 2, stage: 'won', valueCents: 1180000, notes: ''},
    {id: 6, kind: 'task', title: 'Send the workshop outline', clientId: 1, category: 'task', dueDate: today, done: false, notes: ''},
    {id: 7, kind: 'task', title: 'Check on the proposal', clientId: 2, category: 'follow-up', dueDate: tomorrow, done: false, notes: ''},
    {id: 8, kind: 'project', title: 'Discovery sprint', clientId: 1, status: 'active', photoUri: null, notes: 'Map the client handoff and identify one task to automate.'},
  ]};
}
