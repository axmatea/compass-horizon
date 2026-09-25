export type Tab = "mission" | "experiments" | "pipeline" | "memory";
export type Rules = { minBudget: number; maxTimelineDays: number };
export type Fields = {
  problem: string | null;
  decisionMaker: boolean | null;
  budget: number | null;
  timelineDays: number | null;
  businessFit: boolean | null;
};
export type Qualification = {
  status: "QUALIFIED" | "NEEDS_CONTEXT" | "NOT_ICP";
  reasons: string[];
  missing: string[];
  nextQuestion: string | null;
  rulesVersion: number;
};
export type Lead = {
  id: string;
  name: string;
  experimentId: string | null;
  fields: Fields;
  qualification: Qualification;
  updatedAt: string;
};
export type Experiment = {
  id: string;
  name: string;
  hypothesis: string;
  audience: string;
  message: string;
};
export type Integration = {
  name: string;
  status: string;
  operation: string;
  reason?: string;
};
export type Run = {
  id: string;
  operation: string;
  status: "queued" | "running" | "completed" | "blocked" | "failed";
  checkpoint: string;
  reason?: string;
  result?: unknown;
  updatedAt: string;
  leadId?: string | null;
};
export type State = {
  mode: "DEMO" | "LIVE";
  project: null | {
    id: string;
    name: string;
    goal: string;
    rules: Rules;
    rulesVersion: number;
  };
  experiments: Experiment[];
  leads: Lead[];
  events: {
    id: string;
    source: string;
    externalId: string;
    leadId: string;
    occurredAt: string;
    receivedAt: string;
    mode: string;
    fields?: Partial<Fields>;
  }[];
  decisions: {
    id: string;
    recommendation: string;
    status: "insufficient_evidence" | "review";
    evidenceIds: string[];
    rulesVersion: number;
    createdAt: string;
  }[];
  runs: Run[];
  metrics: {
    source: string;
    totalLeads: number;
    qualified: number;
    unresolved: number;
    notIcp: number;
    unknownAttribution: number;
    sampleStatus: string;
    experiments: { experimentId: string; total: number; qualified: number }[];
  };
  integrations: Integration[];
};
export type ServiceStatus = {
  database: "ready" | "blocked";
  integrations: Integration[];
  billingEnabled: false;
  sponsorCallsEnabled?: boolean;
  voice?: { status: string; reason?: string };
};
export type Session = { user: { id: string; name?: string; email: string } };
export type LeadInput = Omit<
  Lead,
  "id" | "qualification" | "updatedAt" | "fields"
> &
  Fields;
export type ProjectInput = { name: string; goal: string; rules: Rules };
export type AnswerInput = {
  source: string;
  externalId: string;
  leadId: string;
  occurredAt: string;
  fields: Partial<Fields>;
};
export type AnswerOutcome = { duplicate?: boolean; changed?: string[] };
export type Notice = { tone: "success" | "info" | "error"; message: string };
