export type Entity = 'clients' | 'contacts' | 'deals' | 'tasks' | 'proposals';
export type DealStage = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type TaskStatus = 'open' | 'done';
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
export type CrmRow = {
  id: string;
  version: number;
  data: Record<string, string | number>;
  updatedAt: string;
};
export type Records = Record<Entity, CrmRow[]>;
export type CrmConfig = {
  title: string;
  description: string;
  theme: {mode: 'light' | 'dark'; accent: string; font: string; density: string};
  crm?: {currency: Currency; stages: Record<DealStage, string>};
};
export type CrmClient = {
  list(entity: Entity): Promise<{records: CrmRow[]}>;
  save(entity: Entity, data: CrmRow['data'], row?: CrmRow): Promise<{record: CrmRow}>;
  delete(entity: Entity, row: CrmRow): Promise<unknown>;
};
