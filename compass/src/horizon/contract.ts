/**
 * COMPASS contract. The engine produces a WorldView (the world as the agent knew it on a day), the UI renders it.
 * Rule: unknown is null, never 0 or false.
 */

export type Mode = 'DEMO' | 'LIVE';
export type ProviderName = 'nimble' | 'liquid' | 'tinybird';
/** LIVE = real call succeeded. BLOCKED = credentials missing, no call made.
 *  FIXTURE = recorded sample, always labeled. ERROR = call attempted and failed.
 *  READY = credentials present but no successful call yet in this workspace. */
export type ProviderStatus = 'LIVE' | 'READY' | 'BLOCKED' | 'FIXTURE' | 'ERROR';

export type BeliefStatus = 'INSUFFICIENT' | 'LEANING' | 'SUPPORTED';
export type LeadStatus = 'QUALIFIED' | 'UNRESOLVED' | 'NOT_A_FIT';
export type FieldKey = 'budgetUsd' | 'timelineDays' | 'decisionMaker' | 'problem';
export type CommitmentKind = 'ASK_MISSING' | 'CHECK_OUTCOME' | 'MARKET_RESCAN' | 'REVIEW';
export type CommitmentState = 'OPEN' | 'KEPT' | 'CANCELLED' | 'OVERDUE';
export type RunState = 'RUNNING' | 'INTERRUPTED' | 'COMPLETED';
export type OutcomeStage = 'CALL_BOOKED' | 'PROPOSAL' | 'WON' | 'LOST' | 'GHOSTED';

export interface Clock {
  day: number;            // world day the agent has lived through (0..horizonDays)
  iso: string;            // world timestamp for that day
  simulated: boolean;     // true in DEMO: clock advanced by presenter, always labeled
  horizonDays: number;    // 30 in the demo scenario
}

export interface FieldValue<T> {
  value: T | null;        // null = UNKNOWN
  status: 'CONFIRMED' | 'UNKNOWN';
  source?: { eventId: string; day: number; quote?: string; provider: 'liquid' | 'rules' | 'user' };
}

export interface LeadView {
  id: string;
  name: string;
  company: string;
  role: string;
  campaignId: string | null;          // null = UNKNOWN attribution, never guessed
  capturedDay: number;
  fields: {
    budgetUsd: FieldValue<number>;
    timelineDays: FieldValue<number>;
    decisionMaker: FieldValue<boolean>;
    problem: FieldValue<string>;
  };
  status: LeadStatus;
  reasons: string[];
  missing: FieldKey[];
  nextQuestion: string | null;        // drafted by the agent, never sent
  rulesVersion: number;
  outcomes: { stage: OutcomeStage; day: number; learnedDay: number; valueUsd?: number }[];
  messages: { day: number; from: 'lead' | 'agent-draft'; text: string }[];
}

export interface CampaignView {
  id: string;
  key: 'A' | 'B';
  name: string;
  angle: string;
  audience: string;
  offer: string;
  creative: { headline: string; body: string; cta: string };
  spendUsd: number;
  leads: number;
  cplUsd: number | null;              // what an ad dashboard shows
  qualified: number;
  unresolved: number;
  notAFit: number;
  costPerQualifiedUsd: number | null; // what the agent waits for
  callsBooked: number;
  pipelineUsd: number;
  wonUsd: number;
}

export interface CurvePoint {
  day: number;
  cplUsd: number | null;
  costPerQualifiedUsd: number | null;
  qualified: number;
  leads: number;
}

export interface Curves {
  byCampaign: Record<string, CurvePoint[]>; // key = campaignId, one point per day 0..asOfDay, as known on that day
  flipDay: number | null;                   // first day cost-per-qualified ranking contradicts the CPL ranking
}

export interface BeliefView {
  id: string;
  version: number;
  day: number;
  status: BeliefStatus;
  favors: string | null;          // campaignId or null
  probability: number | null;     // P(favored arm yields more qualified leads per dollar), 0..1
  statement: string;
  recommendation: string;
  nextTest: string;
  evidence: { eventId: string; day: number; label: string }[];
  revisedFrom?: { version: number; statement: string; status: BeliefStatus; favors: string | null };
  changes?: string[];             // human-readable diff lines
  policyVersion: number;
  rulesVersion: number;
}

export interface LessonView {
  id: string;
  day: number;
  text: string;                   // what the agent learned about its own decision process
  policyFrom: number;
  policyTo: number;
  evidence: { eventId: string; day: number; label: string }[];
}

export interface CommitmentView {
  id: string;
  kind: CommitmentKind;
  leadId?: string;
  title: string;
  reason: string;
  createdDay: number;
  dueDay: number;
  state: CommitmentState;
  keptDay?: number;
  runId?: string;
}

export interface RunView {
  id: string;
  day: number;
  trigger: 'BEAT' | 'TICK' | 'RESUME' | 'CRON' | 'MANUAL';
  state: RunState;
  steps: { n: number; name: string; state: 'DONE' | 'SKIPPED_ALREADY_DONE' | 'PENDING'; summary?: string }[];
  effects: { key: string; kind: string; state: 'PERFORMED' | 'SKIPPED_DUPLICATE' }[];
  resumedFromStep?: number;
  costUsd: number;
}

export interface LedgerEntry {
  id: string;
  type: string;
  occurredDay: number;
  learnedDay: number;
  lane: string;                   // campaignId | 'unknown' | 'agent' | 'market'
  label: string;
  late: boolean;                  // learnedDay > occurredDay
  source: string;
}

export interface ReceiptView {
  id: string;
  provider: ProviderName;
  operation: string;
  status: ProviderStatus;
  model?: string;
  latencyMs?: number;
  day: number;
  wallTime: string;
  note?: string;                  // never tokens, never PII
}

export interface MarketSignal {
  id: string;
  campaignId: string;
  query: string;
  day: number;
  status: ProviderStatus;
  sources: { title: string; url: string; fetchedAt: string; fact: string }[];
}

export interface StageBeat {
  beat: number;                   // 0-based index of the beat currently shown
  totalBeats: number;
  title: string;
  caption: string;                // one sentence the presenter can read
  nextLabel: string | null;       // label for the Next button, null at the end
}

export interface WorldView {
  workspace: { id: string; mode: Mode; label: string; scenario: string | null; liveProviders: boolean }; // liveProviders: sponsor calls allowed here (stage + LIVE); public demo uses rules fallback, never invented sources
  clock: Clock;
  asOfDay: number;                // time machine cutoff; equals clock.day when not time travelling
  isTimeTravel: boolean;
  rules: { version: number; minBudgetUsd: number; maxTimelineDays: number; requireDecisionMaker: boolean };
  policy: { version: number; minResolvedPerArmToLean: number; minResolvedPerArmToSupport: number; leanAt: number; supportAt: number };
  campaigns: CampaignView[];
  unknownAttribution: { leads: number; qualified: number };
  leads: LeadView[];
  beliefs: BeliefView[];          // ascending by version
  currentBelief: BeliefView | null;
  lessons: LessonView[];
  commitments: CommitmentView[];
  runs: RunView[];                // most recent first
  ledger: LedgerEntry[];
  curves: Curves;
  market: MarketSignal[];
  receipts: ReceiptView[];        // most recent first
  providers: Record<ProviderName, { status: ProviderStatus; detail: string }>;
  stage: StageBeat | null;        // DEMO only
  stats: {
    events: number;
    duplicatesIgnored: number;
    lateEvents: number;
    effectsPerformed: number;
    effectsSkipped: number;
    cognitionCostUsd: number;
  };
}
