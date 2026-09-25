/** project(events, opts) => WorldView. Pure: the whole product is a projection of the ledger as known on a day. */
import type {
  BeliefStatus,
  BeliefView,
  CampaignView,
  CommitmentKind,
  CommitmentView,
  CurvePoint,
  LeadView,
  LedgerEntry,
  LessonView,
  MarketSignal,
  Mode,
  ProviderName,
  ProviderStatus,
  ReceiptView,
  RunView,
  WorldView,
} from '../contract';
import { BEATS, TOTAL_BEATS } from './beats';
import { byLearned, dayToIso, HORIZON_DAYS, isoToDay, learnedDay, num, occurredDay, str, WAKE_HOUR, type LedgerEvent } from './events';
import { questionFor } from './rules';
import { armMetrics, campaignsFrom, deriveLeads, firstName, policyFrom, rulesFrom, usd, visibleAt, type DerivedLead } from './world';

export interface WorkspaceMeta {
  id: string;
  mode: Mode;
  label: string;
  scenario: string | null;
  liveProviders: boolean;
}

export type ProviderConfig = Record<ProviderName, { status: ProviderStatus; detail: string }>;

export interface ProjectOptions {
  workspace: WorkspaceMeta;
  asOfDay?: number | null;
  providers: ProviderConfig;
  /** LIVE workspaces: real world day. DEMO: derived from runs. */
  liveDay?: number;
}

export const STEP_NAMES = ['ingest', 'extract', 'qualify', 'commitments', 'metrics', 'decide', 'market'] as const;

export function clockDayOf(events: LedgerEvent[]): number {
  let day = 0;
  for (const e of events) {
    if (e.type === 'run.started') day = Math.max(day, num(e.payload.day) ?? 0);
  }
  return day;
}

export function currentBeatOf(events: LedgerEvent[]): number {
  let beat = -1;
  for (const e of events) if (e.type === 'stage.beat') beat = Math.max(beat, num(e.payload.beat) ?? -1);
  return beat;
}

/** Latest run.started without run.completed, if any. */
export function incompleteRun(events: LedgerEvent[]): LedgerEvent | null {
  const completed = new Set(events.filter((e) => e.type === 'run.completed').map((e) => str(e.payload.runId)));
  const started = events.filter((e) => e.type === 'run.started');
  for (let i = started.length - 1; i >= 0; i--) {
    const id = str(started[i].payload.runId);
    if (id && !completed.has(id)) return started[i];
  }
  return null;
}

type StepEffect = { key: string; kind: string; state: 'PERFORMED' | 'SKIPPED_DUPLICATE' };

export function buildRun(events: LedgerEvent[], runId: string): RunView | null {
  const started = events.find((e) => e.type === 'run.started' && str(e.payload.runId) === runId);
  if (!started) return null;
  const mine = events.filter((e) => str(e.payload.runId) === runId);
  const completed = mine.some((e) => e.type === 'run.completed');
  const resumes = mine.filter((e) => e.type === 'run.resumed');
  const lastResume = resumes[resumes.length - 1];
  const skipped = new Set<number>(((lastResume?.payload.skippedSteps as number[] | undefined) ?? []).map(Number));
  const stepEvents = mine.filter((e) => e.type === 'run.step');
  const doneSteps = new Map<number, LedgerEvent>();
  for (const s of stepEvents) doneSteps.set(num(s.payload.n) ?? 0, s);
  const steps: RunView['steps'] = STEP_NAMES.map((name, i) => {
    const n = i + 1;
    const s = doneSteps.get(n);
    if (skipped.has(n)) return { n, name, state: 'SKIPPED_ALREADY_DONE' as const, summary: 'Checkpoint found, step not repeated' };
    if (s) return { n, name, state: 'DONE' as const, summary: str(s.payload.summary) };
    return { n, name, state: 'PENDING' as const };
  });
  const effects: StepEffect[] = [];
  const seen = new Set<string>();
  for (const s of [...doneSteps.values()].sort((a, b) => (num(a.payload.n) ?? 0) - (num(b.payload.n) ?? 0))) {
    for (const f of (s.payload.effects as StepEffect[] | undefined) ?? []) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      effects.push(f);
    }
  }
  if (!completed) {
    for (const e of mine) {
      if (e.type !== 'effect.performed') continue;
      const key = str(e.payload.key) ?? e.id;
      if (seen.has(key)) continue;
      seen.add(key);
      effects.push({ key, kind: str(e.payload.kind) ?? 'EFFECT', state: 'PERFORMED' });
    }
  }
  const costUsd = mine.filter((e) => e.type === 'receipt').reduce((a, e) => a + (num(e.payload.costUsd) ?? 0), 0);
  const trigger = (resumes.length ? 'RESUME' : str(started.payload.trigger) ?? 'MANUAL') as RunView['trigger'];
  return {
    id: runId,
    day: num(started.payload.day) ?? learnedDay(started),
    trigger,
    state: completed ? 'COMPLETED' : 'INTERRUPTED',
    steps,
    effects,
    ...(lastResume ? { resumedFromStep: num(lastResume.payload.fromStep) } : {}),
    costUsd: Math.round(costUsd * 1e6) / 1e6,
  };
}

const LEDGER_HIDDEN = new Set(['run.step', 'receipt', 'spend.recorded', 'lead.fields.extracted', 'stage.beat']);
const EXTERNAL_TYPES = new Set(['lead.captured', 'lead.replied', 'outcome.recorded', 'spend.recorded', 'campaign.launched']);

function ledgerLabel(e: LedgerEvent, leadsById: Map<string, DerivedLead>): string {
  const p = e.payload;
  const lead = leadsById.get(str(p.leadId) ?? '');
  const who = lead ? `${lead.name} (${lead.company})` : str(p.leadId) ?? '';
  switch (e.type) {
    case 'campaign.launched':
      return `Campaign ${str(p.key) ?? ''} launched: ${str(p.name) ?? ''}`;
    case 'lead.captured':
      return `Lead captured: ${who}${p.campaignId ? '' : ', no UTM, attribution unknown'}`;
    case 'lead.replied':
      return `Reply from ${who}`;
    case 'lead.qualified':
      return `${who}: ${str(p.status) ?? ''}`;
    case 'outcome.recorded':
      return `${str(p.stage) ?? 'Outcome'}: ${who}${num(p.valueUsd) ? ` ${usd(num(p.valueUsd))}` : ''}`;
    case 'market.scanned':
      return `Market scan ${str(p.status) ?? ''}: ${str(p.query) ?? ''}`;
    case 'rules.versioned':
      return `Qualification rules v${num(p.version) ?? 1}`;
    case 'policy.versioned':
      return `Decision policy v${num(p.version) ?? 1}`;
    case 'lesson.recorded':
      return `Lesson: ${str(p.text) ?? ''}`;
    case 'commitment.created':
      return `Commitment: ${str(p.title) ?? ''} (due day ${num(p.dueDay) ?? ''})`;
    case 'commitment.kept':
      return `Kept: ${str(p.title) ?? str(p.commitmentId) ?? ''}`;
    case 'commitment.cancelled':
      return `Cancelled: ${str(p.title) ?? str(p.commitmentId) ?? ''}, ${str(p.reason) ?? ''}`;
    case 'effect.performed':
      return `Drafted (not sent): ${str(p.title) ?? str(p.kind) ?? ''}`;
    case 'belief.recorded':
      return `Belief v${num(p.version) ?? ''}: ${str(p.status) ?? ''}${p.favors ? ` ${str(p.favors)}` : ''}`;
    case 'run.started':
      return `Agent wake (${str(p.trigger) ?? ''}) day ${num(p.day) ?? ''}`;
    case 'run.resumed':
      return `Run resumed from step ${num(p.fromStep) ?? ''}`;
    case 'run.completed':
      return 'Agent wake completed';
    case 'webhook.duplicate_ignored':
      return `Duplicate webhook ignored: ${str(p.externalId) ?? ''}`;
    case 'chaos.armed':
      return `Chaos armed: kill after step ${num(p.afterStep) ?? ''}`;
    case 'chaos.fired':
      return `Process killed after step ${num(p.afterStep) ?? ''}`;
    default:
      return e.type;
  }
}

function laneOf(e: LedgerEvent, leadsById: Map<string, DerivedLead>): string {
  const p = e.payload;
  if (e.type === 'market.scanned') return 'market';
  const leadId = str(p.leadId);
  if (leadId && e.type !== 'commitment.created' && e.type !== 'commitment.kept' && e.type !== 'commitment.cancelled' && e.type !== 'effect.performed') {
    const lead = leadsById.get(leadId);
    if (lead) return lead.campaignId ?? 'unknown';
    return 'unknown';
  }
  if (e.type === 'campaign.launched') return str(p.campaignId) ?? 'agent';
  return 'agent';
}

function toBelief(e: LedgerEvent): BeliefView {
  const p = e.payload;
  const rf = p.revisedFrom as BeliefView['revisedFrom'] | undefined;
  return {
    id: e.id,
    version: num(p.version) ?? 1,
    day: learnedDay(e),
    status: (str(p.status) ?? 'INSUFFICIENT') as BeliefStatus,
    favors: str(p.favors) ?? null,
    probability: num(p.probability) ?? null,
    statement: str(p.statement) ?? '',
    recommendation: str(p.recommendation) ?? '',
    nextTest: str(p.nextTest) ?? '',
    evidence: (p.evidence as BeliefView['evidence']) ?? [],
    ...(rf ? { revisedFrom: rf } : {}),
    ...(Array.isArray(p.changes) ? { changes: p.changes as string[] } : {}),
    policyVersion: num(p.policyVersion) ?? 1,
    rulesVersion: num(p.rulesVersion) ?? 1,
  };
}

export function project(events: LedgerEvent[], opts: ProjectOptions): WorldView {
  const all = byLearned(events);
  const mode = opts.workspace.mode;
  const clockDay = Math.min(HORIZON_DAYS, mode === 'LIVE' && opts.liveDay !== undefined ? opts.liveDay : clockDayOf(all));
  const requested = opts.asOfDay ?? null;
  const asOf = requested === null || !Number.isFinite(requested) ? clockDay : Math.max(0, Math.min(clockDay, Math.floor(requested)));
  const visible = visibleAt(all, asOf);

  const rules = rulesFrom(visible);
  const policy = policyFrom(visible);
  const campaigns = campaignsFrom(visible);
  const leads = deriveLeads(visible, rules);
  const leadsById = new Map(leads.map((l) => [l.id, l]));

  const drafts = visible.filter((e) => e.type === 'effect.performed' && str(e.payload.leadId));
  const leadViews: LeadView[] = leads.map((l) => {
    const messages: LeadView['messages'] = [
      ...l.replies.map((r) => ({ day: r.day, from: 'lead' as const, text: r.text })),
      ...drafts
        .filter((d) => str(d.payload.leadId) === l.id)
        .map((d) => ({ day: learnedDay(d), from: 'agent-draft' as const, text: str(d.payload.text) ?? '' })),
    ].sort((a, b) => a.day - b.day);
    return {
      id: l.id,
      name: l.name,
      company: l.company,
      role: l.role,
      campaignId: l.campaignId,
      capturedDay: l.capturedDay,
      fields: l.fields,
      status: l.qual.status,
      reasons: l.qual.reasons,
      missing: l.qual.missing,
      nextQuestion: l.qual.status === 'UNRESOLVED' && l.qual.missing.length ? questionFor(l.qual.missing[0], firstName(l.name)) : null,
      rulesVersion: rules.version,
      outcomes: l.outcomes.map((o) => ({ stage: o.stage, day: o.day, learnedDay: o.learnedDay, ...(o.valueUsd !== undefined ? { valueUsd: o.valueUsd } : {}) })),
      messages,
    };
  });

  const campaignViews: CampaignView[] = campaigns.map((c) => {
    const m = armMetrics(visible, c.id, leads);
    return {
      id: c.id,
      key: c.key,
      name: c.name,
      angle: c.angle,
      audience: c.audience,
      offer: c.offer,
      creative: c.creative,
      spendUsd: m.spendUsd,
      leads: m.leads,
      cplUsd: m.cplUsd,
      qualified: m.qualified,
      unresolved: m.unresolved,
      notAFit: m.notAFit,
      costPerQualifiedUsd: m.costPerQualifiedUsd,
      callsBooked: m.callsBooked,
      pipelineUsd: m.pipelineUsd,
      wonUsd: m.wonUsd,
    };
  });

  const unknownLeads = leads.filter((l) => l.campaignId === null);

  // Curves: one point per day 0..asOf, as known on that day.
  const byCampaign: Record<string, CurvePoint[]> = {};
  for (const c of campaigns) byCampaign[c.id] = [];
  let flipDay: number | null = null;
  for (let d = 0; d <= asOf; d++) {
    const vis = visibleAt(all, d);
    const r = rulesFrom(vis);
    const ls = deriveLeads(vis, r);
    const points: Record<string, CurvePoint> = {};
    for (const c of campaigns) {
      const m = armMetrics(vis, c.id, ls);
      points[c.id] = { day: d, cplUsd: m.cplUsd, costPerQualifiedUsd: m.costPerQualifiedUsd, qualified: m.qualified, leads: m.leads };
      byCampaign[c.id].push(points[c.id]);
    }
    if (flipDay === null && campaigns.length >= 2) {
      const [x, y] = campaigns;
      const px = points[x.id];
      const py = points[y.id];
      if (px.cplUsd !== null && py.cplUsd !== null && px.cplUsd !== py.cplUsd) {
        const cheap = px.cplUsd < py.cplUsd ? px : py;
        const other = cheap === px ? py : px;
        if (other.costPerQualifiedUsd !== null && (cheap.costPerQualifiedUsd === null || other.costPerQualifiedUsd < cheap.costPerQualifiedUsd)) {
          flipDay = d;
        }
      }
    }
  }

  const beliefs = visible.filter((e) => e.type === 'belief.recorded').map(toBelief).sort((a, b) => a.version - b.version);

  const lessons: LessonView[] = visible
    .filter((e) => e.type === 'lesson.recorded')
    .map((e) => ({
      id: e.id,
      day: learnedDay(e),
      text: str(e.payload.text) ?? '',
      policyFrom: num(e.payload.policyFrom) ?? 1,
      policyTo: num(e.payload.policyTo) ?? 2,
      evidence: (e.payload.evidence as LessonView['evidence']) ?? [],
    }));

  const commitments: CommitmentView[] = [];
  const cmIndex = new Map<string, CommitmentView>();
  for (const e of visible) {
    const id = str(e.payload.commitmentId);
    if (!id) continue;
    if (e.type === 'commitment.created' && !cmIndex.has(id)) {
      const c: CommitmentView = {
        id,
        kind: (str(e.payload.kind) ?? 'REVIEW') as CommitmentKind,
        ...(str(e.payload.leadId) ? { leadId: str(e.payload.leadId) } : {}),
        title: str(e.payload.title) ?? '',
        reason: str(e.payload.reason) ?? '',
        createdDay: learnedDay(e),
        dueDay: num(e.payload.dueDay) ?? learnedDay(e),
        state: 'OPEN',
        ...(str(e.payload.runId) ? { runId: str(e.payload.runId) } : {}),
      };
      cmIndex.set(id, c);
      commitments.push(c);
    }
  }
  for (const e of visible) {
    const c = cmIndex.get(str(e.payload.commitmentId) ?? '');
    if (!c || c.state !== 'OPEN') continue;
    if (e.type === 'commitment.kept') {
      c.state = 'KEPT';
      c.keptDay = learnedDay(e);
    } else if (e.type === 'commitment.cancelled') {
      c.state = 'CANCELLED';
      c.keptDay = learnedDay(e);
    }
  }
  for (const c of commitments) if (c.state === 'OPEN' && c.dueDay < asOf) c.state = 'OVERDUE';

  const runIds = visible.filter((e) => e.type === 'run.started').map((e) => str(e.payload.runId) ?? '');
  const runs: RunView[] = runIds
    .map((id) => buildRun(visible, id))
    .filter((r): r is RunView => r !== null)
    .reverse();

  const ledger: LedgerEntry[] = visible
    .filter((e) => !LEDGER_HIDDEN.has(e.type))
    .map((e) => {
      const od = occurredDay(e);
      const ld = learnedDay(e);
      return { id: e.id, type: e.type, occurredDay: od, learnedDay: ld, lane: laneOf(e, leadsById), label: ledgerLabel(e, leadsById), late: ld > od, source: e.source };
    });

  const market: MarketSignal[] = visible
    .filter((e) => e.type === 'market.scanned')
    .map((e) => ({
      id: e.id,
      campaignId: str(e.payload.campaignId) ?? '',
      query: str(e.payload.query) ?? '',
      day: learnedDay(e),
      status: (str(e.payload.status) ?? 'BLOCKED') as ProviderStatus,
      sources: (e.payload.sources as MarketSignal['sources']) ?? [],
    }));

  const receipts: ReceiptView[] = visible
    .filter((e) => e.type === 'receipt')
    .map((e) => ({
      id: e.id,
      provider: (str(e.payload.provider) ?? 'liquid') as ProviderName,
      operation: str(e.payload.operation) ?? '',
      status: (str(e.payload.status) ?? 'BLOCKED') as ProviderStatus,
      ...(str(e.payload.model) ? { model: str(e.payload.model) } : {}),
      ...(num(e.payload.latencyMs) !== undefined ? { latencyMs: num(e.payload.latencyMs) } : {}),
      day: learnedDay(e),
      wallTime: str(e.payload.wallTime) ?? e.wallAt ?? e.learnedAt,
      ...(str(e.payload.note) ? { note: str(e.payload.note) } : {}),
    }))
    .reverse();

  const providers = providerStatus(all, opts.providers);

  let stage: WorldView['stage'] = null;
  if (mode === 'DEMO') {
    const b = Math.max(0, currentBeatOf(all));
    const def = BEATS[Math.min(b, TOTAL_BEATS - 1)];
    stage = { beat: def.beat, totalBeats: TOTAL_BEATS, title: def.title, caption: def.caption, nextLabel: def.nextLabel };
  }

  const stepEffects = visible
    .filter((e) => e.type === 'run.step')
    .flatMap((e) => ((e.payload.effects as StepEffect[] | undefined) ?? []));

  return {
    workspace: { ...opts.workspace },
    clock: { day: clockDay, iso: dayToIso(clockDay, WAKE_HOUR), simulated: mode === 'DEMO', horizonDays: HORIZON_DAYS },
    asOfDay: asOf,
    isTimeTravel: asOf < clockDay,
    rules: { version: rules.version, minBudgetUsd: rules.minBudgetUsd, maxTimelineDays: rules.maxTimelineDays, requireDecisionMaker: rules.requireDecisionMaker },
    policy: { ...policy },
    campaigns: campaignViews,
    unknownAttribution: { leads: unknownLeads.length, qualified: unknownLeads.filter((l) => l.qual.status === 'QUALIFIED').length },
    leads: leadViews,
    beliefs,
    currentBelief: beliefs.length ? beliefs[beliefs.length - 1] : null,
    lessons,
    commitments,
    runs,
    ledger,
    curves: { byCampaign, flipDay },
    market,
    receipts,
    providers,
    stage,
    stats: {
      events: visible.length,
      duplicatesIgnored: visible.filter((e) => e.type === 'webhook.duplicate_ignored').length,
      lateEvents: visible.filter((e) => EXTERNAL_TYPES.has(e.type) && learnedDay(e) > occurredDay(e)).length,
      effectsPerformed: visible.filter((e) => e.type === 'effect.performed').length,
      effectsSkipped: stepEffects.filter((f) => f.state === 'SKIPPED_DUPLICATE').length,
      cognitionCostUsd: Math.round(visible.filter((e) => e.type === 'receipt').reduce((a, e) => a + (num(e.payload.costUsd) ?? 0), 0) * 1e6) / 1e6,
    },
  };
}

/** Provider status: config decides BLOCKED or READY; only a real successful call in this workspace makes it LIVE. */
export function providerStatus(events: LedgerEvent[], config: ProviderConfig): ProviderConfig {
  const out = { ...config } as ProviderConfig;
  (Object.keys(config) as ProviderName[]).forEach((name) => {
    const base = config[name];
    if (base.status !== 'READY') return;
    const receipts = events.filter((e) => e.type === 'receipt' && str(e.payload.provider) === name);
    const calls = receipts.filter((e) => ['LIVE', 'ERROR'].includes(str(e.payload.status) ?? ''));
    const last = calls[calls.length - 1];
    if (!last) return;
    const st = str(last.payload.status) as ProviderStatus;
    out[name] = {
      status: st,
      detail: st === 'LIVE' ? `Last call succeeded on day ${learnedDay(last)}` : `Last call failed on day ${learnedDay(last)}: ${str(last.payload.note) ?? 'error'}`,
    };
  });
  return out;
}

export { isoToDay };
