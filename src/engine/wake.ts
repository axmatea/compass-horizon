/**
 * The run engine. Every wake is a run of 7 checkpointed steps (brief section 5).
 * Effects use deterministic keys, so a replayed run never performs an effect twice.
 * Resume continues the latest run.started without run.completed.
 */
import type { MarketSignal, ProviderName, ProviderStatus, RunView } from '@/contract';
import { dayToIso, isoToDay, learnedDay, num, str, WAKE_HOUR, type LedgerEvent } from './events';
import { evaluate, round3, type ArmSnapshot, type Evaluation } from './decide';
import { extractRules, type Extraction } from './extract-rules';
import { nextPolicy, POLICY_V1, type DecisionPolicy } from './policy';
import { buildRun, incompleteRun, STEP_NAMES, type ProviderConfig, type WorkspaceMeta } from './project';
import { FIELD_LABEL, questionFor, RULES_V1 } from './rules';
import { scenarioDeliveries, SCENARIO_ID } from './scenario/ai-media-q4';
import { campaignsFrom, deriveLeads, firstName, hasRules, policyFrom, rulesFrom, usd, visibleAt, type DerivedLead } from './world';

export interface AppendResult {
  inserted: string[];
  duplicates: string[];
}

export interface Store {
  append(events: LedgerEvent[]): Promise<AppendResult>;
  list(workspaceId: string): Promise<LedgerEvent[]>;
}

export interface ReceiptInput {
  provider: ProviderName;
  operation: string;
  status: ProviderStatus;
  model?: string;
  latencyMs?: number;
  costUsd?: number;
  note?: string;
  wallTime?: string;
}

export type MarketSource = MarketSignal['sources'][number];

export interface Providers {
  config: ProviderConfig;
  canCall(name: ProviderName): boolean;
  liquidExtract(text: string): Promise<{ extraction: Extraction | null; receipt: ReceiptInput }>;
  nimbleSearch(query: string): Promise<{ sources: MarketSource[] | null; receipt: ReceiptInput }>;
  tinybirdMirror(events: LedgerEvent[], asOfIso: string, workspaceId: string): Promise<ReceiptInput>;
}

export const OFFLINE_CONFIG: ProviderConfig = {
  nimble: { status: 'BLOCKED', detail: 'NIMBLE_API_KEY not set: no market sources, segments stay hypotheses' },
  liquid: { status: 'BLOCKED', detail: 'LIQUID_API_KEY not set: rules fallback extracts fields' },
  tinybird: { status: 'BLOCKED', detail: 'TINYBIRD_TOKEN not set: metrics computed locally (LOCAL)' },
};

/** Providers that never call out. Used by tests and whenever sponsor calls are not allowed. */
export function offlineProviders(config: ProviderConfig = OFFLINE_CONFIG): Providers {
  const never = () => Promise.reject(new Error('provider calls disabled'));
  return { config, canCall: () => false, liquidExtract: never, nimbleSearch: never, tinybirdMirror: never };
}

export class SimulatedCrash extends Error {
  constructor(message = 'Simulated crash: the process was killed mid-run') {
    super(message);
    this.name = 'SimulatedCrash';
  }
}

export interface WakeContext {
  store: Store;
  workspace: WorkspaceMeta;
  providers: Providers;
  /** world day for a new run (ignored when resuming) */
  day: number;
  trigger: RunView['trigger'];
  beat?: number;
  /** Called after step k+1 performed its effects when chaos {afterStep:k} is armed. Must write chaos.fired, then never return. */
  crash: (fired: LedgerEvent) => Promise<never>;
  wallClock?: () => string;
}

export interface WakeResult {
  run: RunView;
  events: LedgerEvent[];
}

type StepEffect = { key: string; kind: string; state: 'PERFORMED' | 'SKIPPED_DUPLICATE' };

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function pendingChaos(events: LedgerEvent[]): { armedId: string; afterStep: number } | null {
  const fired = new Set(events.filter((e) => e.type === 'chaos.fired').map((e) => str(e.payload.armedId)));
  const armed = events.filter((e) => e.type === 'chaos.armed' && !fired.has(e.id));
  const last = armed[armed.length - 1];
  if (!last) return null;
  return { armedId: last.id, afterStep: num(last.payload.afterStep) ?? 3 };
}

export async function wake(ctx: WakeContext): Promise<WakeResult> {
  const { store, workspace } = ctx;
  const wsId = workspace.id;
  const wall = ctx.wallClock ?? (() => new Date().toISOString());
  const local: LedgerEvent[] = await store.list(wsId);

  // A step checkpoint is written in the same statement as the next write (atomic), which cuts round trips
  // without weakening crash safety: a later step's effects never become durable before the earlier checkpoint.
  let pending: LedgerEvent[] = [];
  const append = async (input: LedgerEvent[]): Promise<{ inserted: Set<string>; duplicates: Set<string> }> => {
    const evts = pending.length ? [...pending, ...input] : input;
    pending = [];
    if (!evts.length) return { inserted: new Set(), duplicates: new Set() };
    const uniq: LedgerEvent[] = [];
    const seen = new Set<string>();
    for (const e of evts) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      uniq.push(e);
    }
    const res = await store.append(uniq);
    const inserted = new Set(res.inserted);
    for (const e of uniq) if (inserted.has(e.id)) local.push(e);
    return { inserted, duplicates: new Set(res.duplicates) };
  };

  // Resume or start
  const open = incompleteRun(local);
  let runId: string;
  let runDay: number;
  let fromStep = 1;
  if (open) {
    runId = str(open.payload.runId) as string;
    runDay = num(open.payload.day) ?? learnedDay(open);
    const done = new Set(local.filter((e) => e.type === 'run.step' && str(e.payload.runId) === runId).map((e) => num(e.payload.n)));
    let k = 0;
    while (done.has(k + 1)) k++;
    fromStep = k + 1;
    const attempt = local.filter((e) => e.type === 'run.resumed' && str(e.payload.runId) === runId).length + 1;
    const skippedSteps = Array.from({ length: k }, (_, i) => i + 1);
    await append([mk(`${runId}:resumed:${attempt}`, 'run.resumed', { runId, fromStep, skippedSteps, attempt, trigger: ctx.trigger })]);
  } else {
    runDay = ctx.day;
    const n = local.filter((e) => e.type === 'run.started').length + 1;
    runId = `run-${String(n).padStart(3, '0')}-d${runDay}`;
    pending.push(mk(`${runId}:started`, 'run.started', { runId, day: runDay, trigger: ctx.trigger, ...(ctx.beat !== undefined ? { beat: ctx.beat } : {}) }));
  }

  function mk(id: string, type: LedgerEvent['type'], payload: Record<string, unknown>, opts: Partial<Pick<LedgerEvent, 'occurredAt' | 'learnedAt' | 'source'>> = {}): LedgerEvent {
    const at = dayToIso(runDay, WAKE_HOUR);
    return {
      id,
      workspaceId: wsId,
      type,
      occurredAt: opts.occurredAt ?? at,
      learnedAt: opts.learnedAt ?? at,
      source: opts.source ?? 'agent',
      mode: workspace.mode,
      payload,
    };
  }

  /** What this step is allowed to see: known by the run day, excluding this run's own writes from this step onward (so a re-attempt plans identically). */
  const planView = (n: number) =>
    visibleAt(
      local.filter((e) => !(str(e.payload.runId) === runId && (num(e.payload.step) ?? 0) >= n)),
      runDay,
    );

  let receiptSeq = 0;
  const receiptEvent = (step: number, r: ReceiptInput) =>
    mk(`${runId}:rcpt:${step}:${receiptSeq++}`, 'receipt', {
      provider: r.provider,
      operation: r.operation,
      status: r.status,
      ...(r.model ? { model: r.model } : {}),
      ...(r.latencyMs !== undefined ? { latencyMs: r.latencyMs } : {}),
      costUsd: r.costUsd ?? 0,
      ...(r.note ? { note: r.note } : {}),
      wallTime: r.wallTime ?? wall(),
      runId,
      step,
    }, { source: r.provider });

  const steps: Record<number, () => Promise<{ summary: string; effects: StepEffect[] }>> = {
    1: async () => {
      if (workspace.scenario !== SCENARIO_ID) {
        return { summary: 'No scheduled deliveries: live events arrive through /api/events', effects: [] };
      }
      const due = scenarioDeliveries().filter((d) => isoToDay(d.event.learnedAt) <= runDay);
      const existing = new Map(local.map((e) => [e.id, e]));
      const batch = new Map<string, string>();
      const toInsert: LedgerEvent[] = [];
      const dups: LedgerEvent[] = [];
      for (const d of due) {
        const prior = existing.get(d.event.id);
        const priorDelivery = prior ? str(prior.payload.deliveryId) : batch.get(d.event.id);
        if (prior || batch.has(d.event.id)) {
          if (priorDelivery !== d.deliveryId) {
            const dupId = `dup:${d.deliveryId}`;
            if (!existing.has(dupId)) {
              dups.push(
                mk(dupId, 'webhook.duplicate_ignored', { eventId: d.event.id, externalId: str(d.event.payload.externalId) ?? d.event.id, deliveryId: d.deliveryId, leadId: str(d.event.payload.leadId) ?? null, runId, step: 1 }, {
                  occurredAt: d.event.learnedAt,
                  learnedAt: d.event.learnedAt,
                  source: d.event.source,
                }),
              );
            }
          }
          continue;
        }
        batch.set(d.event.id, d.deliveryId);
        toInsert.push({ ...d.event, workspaceId: wsId, mode: workspace.mode });
      }
      const res = await append([...toInsert, ...dups]);
      const ins = toInsert.filter((e) => res.inserted.has(e.id));
      const count = (t: string) => ins.filter((e) => e.type === t).length;
      const late = ins.filter((e) => isoToDay(e.learnedAt) > isoToDay(e.occurredAt)).length;
      const parts = [
        `${ins.length} events ingested`,
        count('lead.captured') ? `${count('lead.captured')} leads` : '',
        count('lead.replied') ? `${count('lead.replied')} replies` : '',
        count('outcome.recorded') ? `${count('outcome.recorded')} CRM updates` : '',
        late ? `${late} learned late` : '',
        dups.length ? `${dups.length} duplicate webhook ignored` : '',
      ].filter(Boolean);
      return { summary: parts.join(', '), effects: [] };
    },

    2: async () => {
      const view = planView(2);
      const done = new Set(view.filter((e) => e.type === 'lead.fields.extracted').map((e) => str(e.payload.sourceEventId)));
      const sources = view.filter(
        (e) => (e.type === 'lead.replied' || (e.type === 'outcome.recorded' && str(e.payload.note))) && !done.has(e.id) && str(e.payload.leadId),
      );
      if (!sources.length) return { summary: 'No new replies to read', effects: [] };
      const useLiquid = ctx.providers.canCall('liquid');
      const receipts: ReceiptInput[] = [];
      const results = await mapLimit(sources, 4, async (src) => {
        const text = (src.type === 'lead.replied' ? str(src.payload.text) : str(src.payload.note)) ?? '';
        if (useLiquid) {
          try {
            const r = await ctx.providers.liquidExtract(text);
            receipts.push(r.receipt);
            if (r.extraction) return { src, extraction: r.extraction, provider: 'liquid' as const };
          } catch (err) {
            receipts.push({ provider: 'liquid', operation: 'extract', status: 'ERROR', note: `adapter error: ${(err as Error).name}; rules fallback used` });
          }
        }
        return { src, extraction: extractRules(text), provider: 'rules' as const };
      });
      // CRM notes describe the deal, not the lead's problem: only qualification fields are taken from them.
      for (const r of results) if (r.src.type === 'outcome.recorded') r.extraction = { ...r.extraction, problem: null };
      if (!useLiquid) {
        receipts.push({ provider: 'liquid', operation: 'extract', status: ctx.providers.config.liquid.status, note: `${sources.length} texts read by the rules fallback, no model call. ${ctx.providers.config.liquid.detail}` });
      }
      const evts = results.map(({ src, extraction, provider }) =>
        mk(
          `x:${src.id}`,
          'lead.fields.extracted',
          { leadId: str(src.payload.leadId), sourceEventId: src.id, sourceType: src.type, provider, fields: extraction, extractedDay: runDay, runId, step: 2 },
          { occurredAt: src.occurredAt, learnedAt: src.learnedAt, source: provider },
        ),
      );
      await append([...evts, ...receipts.map((r) => receiptEvent(2, r))]);
      const liquidCount = results.filter((r) => r.provider === 'liquid').length;
      return {
        summary: `Read ${results.length} ${results.length === 1 ? 'text' : 'texts'}: ${liquidCount ? `${liquidCount} by Liquid, ` : ''}${results.length - liquidCount} by the rules extractor`,
        effects: [],
      };
    },

    3: async () => {
      let view = planView(3);
      if (!hasRules(view)) {
        await append([mk('rules:v1', 'rules.versioned', { ...RULES_V1, reason: 'Initial qualification rules', runId, step: 3 })]);
        view = planView(3);
      }
      const rules = rulesFrom(view);
      const leads = deriveLeads(view, rules);
      const last = new Map<string, string>();
      for (const e of view) if (e.type === 'lead.qualified') last.set(str(e.payload.leadId) ?? '', str(e.payload.status) ?? 'UNRESOLVED');
      const evts: LedgerEvent[] = [];
      for (const l of leads) {
        const prev = last.get(l.id) ?? 'UNRESOLVED';
        if (prev === l.qual.status) continue;
        evts.push(mk(`${runId}:q:${l.id}`, 'lead.qualified', { leadId: l.id, status: l.qual.status, from: prev, reasons: l.qual.reasons, missing: l.qual.missing, rulesVersion: rules.version, runId, step: 3 }));
      }
      await append(evts);
      const campaigns = campaignsFrom(view);
      const parts = campaigns.map((c) => {
        const mine = leads.filter((l) => l.campaignId === c.id);
        const n = (s: string) => mine.filter((l) => l.qual.status === s).length;
        return `${c.key}: ${n('QUALIFIED')} qualified, ${n('NOT_A_FIT')} not a fit, ${n('UNRESOLVED')} unresolved`;
      });
      const unk = leads.filter((l) => l.campaignId === null);
      if (unk.length) parts.push(`Unknown attribution: ${unk.length} (never credited to A or B)`);
      return { summary: `${evts.length} status changes under rules v${rules.version}. ${parts.join('; ')}`, effects: [] };
    },

    4: async () => {
      const view = planView(4);
      const leads = deriveLeads(view, rulesFrom(view));
      const byId = new Map(leads.map((l) => [l.id, l]));
      const created = new Map<string, LedgerEvent>();
      const closed = new Set<string>();
      for (const e of view) {
        const cid = str(e.payload.commitmentId);
        if (!cid) continue;
        if (e.type === 'commitment.created' && !created.has(cid)) created.set(cid, e);
        if (e.type === 'commitment.kept' || e.type === 'commitment.cancelled') closed.add(cid);
      }
      const effectEvents: LedgerEvent[] = [];
      const effectKinds = new Map<string, string>();
      const bookkeeping: LedgerEvent[] = [];
      let cancelled = 0;
      let kept = 0;
      for (const [cid, c] of created) {
        if (closed.has(cid)) continue;
        const kind = str(c.payload.kind);
        const title = str(c.payload.title) ?? cid;
        const dueDay = num(c.payload.dueDay) ?? runDay;
        const lead = byId.get(str(c.payload.leadId) ?? '');
        if (kind === 'ASK_MISSING') {
          const field = str(c.payload.field) as keyof DerivedLead['known'];
          if (!lead || lead.qual.status !== 'UNRESOLVED' || lead.known[field] !== null) {
            const why = !lead ? 'lead missing' : lead.qual.status !== 'UNRESOLVED' ? `answer arrived first, lead is ${lead.qual.status}` : `answer arrived first, ${FIELD_LABEL[field].toLowerCase()} is known`;
            bookkeeping.push(mk(`${cid}:cancelled`, 'commitment.cancelled', { commitmentId: cid, title, reason: why, runId, step: 4 }));
            cancelled++;
          } else if (dueDay <= runDay) {
            const key = `fx:draft:${cid}`;
            effectKinds.set(key, 'DRAFT_QUESTION');
            effectEvents.push(mk(key, 'effect.performed', { key, kind: 'DRAFT_QUESTION', commitmentId: cid, leadId: lead.id, title: `Question for ${lead.name} about ${FIELD_LABEL[field].toLowerCase()}`, text: questionFor(field, firstName(lead.name)), sent: false, runId, step: 4 }));
            bookkeeping.push(mk(`${cid}:kept`, 'commitment.kept', { commitmentId: cid, title, effectKey: key, runId, step: 4 }));
            kept++;
          }
        } else if (kind === 'CHECK_OUTCOME') {
          const final = lead?.outcomes.find((o) => o.stage === 'WON' || o.stage === 'LOST');
          if (!lead) continue;
          if (final) {
            bookkeeping.push(mk(`${cid}:cancelled`, 'commitment.cancelled', { commitmentId: cid, title, reason: `answer arrived first, outcome ${final.stage}`, runId, step: 4 }));
            cancelled++;
          } else if (dueDay <= runDay) {
            const last = lead.outcomes[lead.outcomes.length - 1];
            const key = `fx:followup:${cid}`;
            const text = last?.stage === 'PROPOSAL'
              ? `Hi ${firstName(lead.name)}, checking in on the proposal. Is there anything you need from us to decide?`
              : last?.stage === 'CALL_BOOKED'
                ? `Hi ${firstName(lead.name)}, following up after our call. Would a short written scope help you move forward?`
                : last?.stage === 'GHOSTED'
                  ? `Hi ${firstName(lead.name)}, we missed each other. Should I close the file or pick a new time?`
                  : `Hi ${firstName(lead.name)}, you mentioned a timeline earlier. Would a 20 minute scoping call this week be useful?`;
            effectKinds.set(key, 'DRAFT_FOLLOW_UP');
            effectEvents.push(mk(key, 'effect.performed', { key, kind: 'DRAFT_FOLLOW_UP', commitmentId: cid, leadId: lead.id, title: `Follow-up for ${lead.name}`, text, sent: false, runId, step: 4 }));
            bookkeeping.push(mk(`${cid}:kept`, 'commitment.kept', { commitmentId: cid, title, effectKey: key, runId, step: 4 }));
            kept++;
          }
        }
      }
      // New commitments
      const fresh: LedgerEvent[] = [];
      for (const l of leads) {
        if (l.qual.status === 'UNRESOLVED' && l.qual.missing.length) {
          const field = l.qual.missing[0];
          const cid = `cm:ask:${l.id}:${field}`;
          if (!created.has(cid)) {
            const label = FIELD_LABEL[field].toLowerCase();
            fresh.push(mk(`${cid}:created`, 'commitment.created', {
              commitmentId: cid,
              kind: 'ASK_MISSING',
              leadId: l.id,
              field,
              title: `Ask ${firstName(l.name)} about ${label}`,
              reason: `${FIELD_LABEL[field]} unknown, so ${firstName(l.name)} stays UNRESOLVED. Draft the question on day ${runDay + 2} unless the answer arrives first.`,
              dueDay: runDay + 2,
              runId,
              step: 4,
            }));
          }
        }
        if (l.qual.status === 'QUALIFIED') {
          const cid = `cm:outcome:${l.id}`;
          if (!created.has(cid)) {
            const dueDay = runDay < 14 ? 14 : runDay + 7;
            fresh.push(mk(`${cid}:created`, 'commitment.created', {
              commitmentId: cid,
              kind: 'CHECK_OUTCOME',
              leadId: l.id,
              title: `Check outcome for ${l.name}`,
              reason: `Qualified on the reply; judged on the outcome. Check on day ${dueDay}.`,
              dueDay,
              runId,
              step: 4,
            }));
          }
        }
      }
      const res = await append([...effectEvents, ...bookkeeping, ...fresh]);
      const effects: StepEffect[] = effectEvents.map((e) => ({
        key: e.id,
        kind: effectKinds.get(e.id) ?? 'EFFECT',
        state: res.inserted.has(e.id) ? 'PERFORMED' : 'SKIPPED_DUPLICATE',
      }));
      const skipped = effects.filter((f) => f.state === 'SKIPPED_DUPLICATE').length;
      return {
        summary: `${fresh.length} created, ${kept} kept, ${cancelled} cancelled; ${effects.length} drafts (never sent)${skipped ? `, ${skipped} already performed` : ''}`,
        effects,
      };
    },

    5: async () => {
      const view = planView(5);
      const ev = evaluate(view, policyFrom(view));
      const parts = ev.arms.map(
        (a) => `${a.key}: ${a.leads} leads, CPL ${usd(a.cplUsd)}, ${a.qualified} qualified, ${a.costPerQualifiedUsd === null ? 'no qualified yet' : `${usd(a.costPerQualifiedUsd)} per qualified`}`,
      );
      let source = 'LOCAL';
      let receipt: ReceiptInput;
      if (ctx.providers.canCall('tinybird')) {
        const lastMirror = view.filter((e) => e.type === 'receipt' && str(e.payload.provider) === 'tinybird' && str(e.payload.status) === 'LIVE').pop();
        const from = num(lastMirror?.payload.mirroredCount) ?? 0;
        const batch = local.slice(from);
        try {
          receipt = await ctx.providers.tinybirdMirror(batch, dayToIso(runDay, WAKE_HOUR), wsId);
        } catch (err) {
          receipt = { provider: 'tinybird', operation: 'mirror', status: 'ERROR', note: `adapter error: ${(err as Error).name}` };
        }
        if (receipt.status === 'LIVE') source = 'Tinybird mirror + LOCAL';
        await append([mk(`${runId}:rcpt:5:${receiptSeq++}`, 'receipt', { ...receipt, costUsd: receipt.costUsd ?? 0, wallTime: receipt.wallTime ?? wall(), mirroredCount: receipt.status === 'LIVE' ? local.length : from, runId, step: 5 }, { source: 'tinybird' })]);
      } else {
        receipt = { provider: 'tinybird', operation: 'mirror', status: ctx.providers.config.tinybird.status, note: `Metrics computed locally from the ledger (LOCAL). ${ctx.providers.config.tinybird.detail}` };
        await append([receiptEvent(5, receipt)]);
      }
      return { summary: `${parts.join('. ')}. Source: ${source}`, effects: [] };
    },

    6: async () => {
      let view = planView(6);
      if (!view.some((e) => e.type === 'policy.versioned')) {
        await append([mk('policy:v1', 'policy.versioned', { ...POLICY_V1, reason: 'Initial decision policy', runId, step: 6 })]);
        view = planView(6);
      }
      let policy = policyFrom(view);
      let ev = evaluate(view, policy);
      const beliefs = view.filter((e) => e.type === 'belief.recorded').sort((a, b) => (num(a.payload.version) ?? 0) - (num(b.payload.version) ?? 0));
      const last = beliefs[beliefs.length - 1];
      const prevDirectional = [...beliefs].reverse().find((b) => str(b.payload.favors));
      const notes: string[] = [];
      let lessonEvent: LedgerEvent | null = null;

      if (ev.favors && prevDirectional && str(prevDirectional.payload.favors) !== ev.favors) {
        const np = nextPolicy(policy);
        const thin = num(prevDirectional.payload.minResolved) ?? 0;
        if (np && thin < np.minResolvedPerArmToLean) {
          const revArm = ev.arms.find((a) => a.campaignId === str(prevDirectional.payload.favors));
          const other = ev.arms.find((a) => a.campaignId !== str(prevDirectional.payload.favors));
          const fast = revArm && other && revArm.medianReplyDays !== null && other.medianReplyDays !== null && revArm.medianReplyDays < other.medianReplyDays;
          const d = learnedDay(prevDirectional);
          const days = (x: number | null) => (x === null ? 'unknown' : `${x} ${x === 1 ? 'day' : 'days'}`);
          const text = fast
            ? `My day ${d} read favored fast responders (${revArm!.key} leads replied in a median of ${days(revArm!.medianReplyDays)}, ${other!.key} leads in ${days(other!.medianReplyDays)}). Policy v${np.version}: require at least ${np.minResolvedPerArmToLean} resolved leads per arm before leaning.`
            : `My day ${d} read leaned on ${thin} resolved ${thin === 1 ? 'lead' : 'leads'} on the thinnest arm. Policy v${np.version}: require at least ${np.minResolvedPerArmToLean} resolved leads per arm before leaning.`;
          lessonEvent = mk(`lesson:${runId}`, 'lesson.recorded', {
            text,
            policyFrom: policy.version,
            policyTo: np.version,
            reversedBeliefVersion: num(prevDirectional.payload.version),
            evidence: [
              { eventId: prevDirectional.id, day: d, label: `Belief v${num(prevDirectional.payload.version)}: ${str(prevDirectional.payload.status)} ${str(prevDirectional.payload.favors)} on ${thin} resolved` },
              ...ev.arms.map((a) => ({
                eventId: ev.campaigns.find((c) => c.id === a.campaignId)?.launchedEventId ?? a.campaignId,
                day: runDay,
                label: `${a.key}: ${a.qualified} of ${a.resolved} resolved leads qualified, median first reply ${days(a.medianReplyDays)}`,
              })),
            ],
            runId,
            step: 6,
          });
          await append([
            lessonEvent,
            mk(`policy:v${np.version}`, 'policy.versioned', { ...np, reason: text, runId, step: 6 }),
          ]);
          notes.push(`Lesson recorded, policy v${policy.version} -> v${np.version}`);
          policy = np;
          ev = evaluate(view, policy);
        }
      }

      const lastDay = last ? learnedDay(last) : -1;
      const newFinal = view.filter((e) => e.type === 'outcome.recorded' && ['WON', 'LOST'].includes(str(e.payload.stage) ?? '') && learnedDay(e) > lastDay);
      const changed = !last || str(last.payload.status) !== ev.status || (str(last.payload.favors) ?? null) !== ev.favors || newFinal.length > 0;
      if (!changed) {
        return { summary: `Belief v${num(last!.payload.version)} holds: ${ev.status}${ev.favors ? ` ${ev.favors}` : ''}${ev.pA !== null ? ` (P(A) = ${ev.pA.toFixed(2)})` : ''}`, effects: [] };
      }
      const version = (last ? num(last.payload.version) ?? 0 : 0) + 1;
      const payload = composeBelief(view, ev, policy, version, last, prevDirectional, newFinal, runDay);
      await append([mk(`belief:v${version}`, 'belief.recorded', { ...payload, runId, step: 6 })]);
      notes.unshift(`Belief v${version}: ${ev.status}${ev.favors ? ` ${ev.favors}` : ''}${ev.probability !== null ? ` (P = ${ev.probability.toFixed(2)})` : ''}`);
      return { summary: notes.join('. '), effects: [] };
    },

    7: async () => {
      const view = planView(7);
      const campaigns = campaignsFrom(view);
      const scans = view.filter((e) => e.type === 'market.scanned');
      const created = view.filter((e) => e.type === 'commitment.created' && str(e.payload.kind) === 'MARKET_RESCAN');
      const closed = new Set(view.filter((e) => e.type === 'commitment.kept' || e.type === 'commitment.cancelled').map((e) => str(e.payload.commitmentId)));
      const dueRescan = created.find((c) => !closed.has(str(c.payload.commitmentId)) && (num(c.payload.dueDay) ?? 99) <= runDay);
      let queries: { campaignId: string; query: string; segment: string | null }[] = [];
      if (!scans.length) {
        queries = campaigns.map((c) => ({ campaignId: c.id, query: c.marketQuery, segment: null }));
      } else if (dueRescan) {
        const belief = view.filter((e) => e.type === 'belief.recorded').sort((a, b) => (num(a.payload.version) ?? 0) - (num(b.payload.version) ?? 0)).pop();
        const fav = campaigns.find((c) => c.id === str(belief?.payload.favors));
        queries = fav && fav.adjacentSegment
          ? [{ campaignId: fav.id, query: fav.adjacentSegment.query, segment: fav.adjacentSegment.name }]
          : campaigns.map((c) => ({ campaignId: c.id, query: c.marketQuery, segment: null }));
      }
      if (!queries.length) {
        const next = created.find((c) => !closed.has(str(c.payload.commitmentId)));
        return { summary: next ? `No market scan due (re-scan on day ${num(next.payload.dueDay)})` : 'No market scan due', effects: [] };
      }
      const canNimble = ctx.providers.canCall('nimble');
      const evts: LedgerEvent[] = [];
      const statuses: string[] = [];
      for (const q of queries) {
        let status: ProviderStatus = 'BLOCKED';
        let sources: MarketSource[] = [];
        let receipt: ReceiptInput;
        if (canNimble) {
          try {
            const r = await ctx.providers.nimbleSearch(q.query);
            receipt = r.receipt;
            if (r.sources) {
              status = 'LIVE';
              sources = r.sources;
            } else status = 'ERROR';
          } catch (err) {
            status = 'ERROR';
            receipt = { provider: 'nimble', operation: 'search', status: 'ERROR', note: `adapter error: ${(err as Error).name}` };
          }
        } else {
          receipt = { provider: 'nimble', operation: 'search', status: ctx.providers.config.nimble.status, note: `No call made, no sources recorded. ${ctx.providers.config.nimble.detail}` };
        }
        statuses.push(status);
        evts.push(mk(`mk:${runId}:${q.campaignId}`, 'market.scanned', { campaignId: q.campaignId, query: q.query, segment: q.segment, status, sources, runId, step: 7 }, { source: 'nimble' }));
        evts.push(receiptEvent(7, receipt));
      }
      if (!scans.length && !created.length) {
        evts.push(mk('cm:rescan:1:created', 'commitment.created', { commitmentId: 'cm:rescan:1', kind: 'MARKET_RESCAN', title: 'Re-scan the market on day 14', reason: 'Competitor offers move. Re-check before recommending a next test.', dueDay: 14, runId, step: 7 }));
      }
      if (dueRescan) {
        const cid = str(dueRescan.payload.commitmentId) as string;
        evts.push(mk(`${cid}:kept`, 'commitment.kept', { commitmentId: cid, title: str(dueRescan.payload.title), runId, step: 7 }));
      }
      await append(evts);
      return { summary: `${queries.length} market ${queries.length === 1 ? 'scan' : 'scans'}: ${statuses.join(', ')}${statuses.every((s) => s !== 'LIVE') ? ', no sources recorded' : ''}`, effects: [] };
    },
  };

  const chaos = pendingChaos(local);
  for (let n = fromStep; n <= STEP_NAMES.length; n++) {
    const out = await steps[n]();
    if (chaos && chaos.afterStep === n - 1) {
      if (pending.length) await append([]);
      const fired = mk(`chaos:fired:${chaos.armedId}`, 'chaos.fired', { runId, afterStep: chaos.afterStep, armedId: chaos.armedId, killedDuringStep: n });
      await ctx.crash(fired);
    }
    pending.push(mk(`${runId}:step:${n}`, 'run.step', { runId, n, name: STEP_NAMES[n - 1], summary: out.summary, effects: out.effects }));
  }
  const cost = [...local, ...pending].filter((e) => e.type === 'receipt' && str(e.payload.runId) === runId).reduce((a, e) => a + (num(e.payload.costUsd) ?? 0), 0);
  await append([mk(`${runId}:completed`, 'run.completed', { runId, costUsd: cost })]);
  const run = buildRun(local, runId) as RunView;
  return { run, events: local };
}

function composeBelief(
  view: LedgerEvent[],
  ev: Evaluation,
  policy: DecisionPolicy,
  version: number,
  last: LedgerEvent | undefined,
  prevDirectional: LedgerEvent | undefined,
  newFinal: LedgerEvent[],
  runDay: number,
): Record<string, unknown> {
  const A = ev.arms.find((a) => a.key === 'A');
  const B = ev.arms.find((a) => a.key === 'B');
  const fav = ev.arms.find((a) => a.campaignId === ev.favors) ?? null;
  const other = fav ? ev.arms.find((a) => a.campaignId !== fav.campaignId) ?? null : null;
  const leader = ev.pA === null ? null : ev.pA >= 0.5 ? A : B;
  const pLeader = ev.pA === null ? null : ev.pA >= 0.5 ? ev.pA : round3(1 - ev.pA);
  const rulesVersion = rulesFrom(view).version;

  let statement: string;
  let recommendation: string;
  let nextTest: string;
  const outcomesLanded = newFinal.length > 0 || view.some((e) => e.type === 'outcome.recorded' && str(e.payload.stage) === 'WON');

  if (ev.pA === null || !A || !B) {
    statement = 'No resolved leads on both arms yet. Both campaigns are hypotheses; nothing is believed.';
    recommendation = 'Keep both campaigns at the test budget. Do not scale either.';
    nextTest = 'Collect replies. Every unresolved lead gets a drafted question (never sent).';
  } else if (ev.status === 'INSUFFICIENT') {
    const thin = ev.minResolved < policy.minResolvedPerArmToLean;
    statement = thin
      ? `Only ${ev.minResolved} resolved ${ev.minResolved === 1 ? 'lead' : 'leads'} on the thinnest arm; policy v${policy.version} needs ${policy.minResolvedPerArmToLean} before leaning.`
      : `Evidence is mixed: P(${leader!.key} yields more qualified leads per dollar) = ${pLeader!.toFixed(2)}, below the ${policy.leanAt} bar to lean. Resolved: A ${A.resolved}, B ${B.resolved}.`;
    recommendation = 'Keep both campaigns at the test budget. Do not scale either on this evidence.';
    nextTest = 'Get answers from unresolved leads: a question is drafted for each (never sent).';
  } else {
    const p = ev.probability!.toFixed(2);
    if (ev.status === 'LEANING') {
      statement = `Leaning ${fav!.key} (${fav!.name}): P = ${p} that it yields more qualified leads per dollar, with ${A.resolved} resolved on A and ${B.resolved} on B.`;
      recommendation = `Keep both running. Do not scale ${fav!.key} until the support gate is met (${policy.minResolvedPerArmToSupport} resolved per arm and P of at least ${policy.supportAt}).`;
      nextTest = 'Resolve the open leads on both arms before moving budget.';
    } else {
      statement = `${fav!.key} (${fav!.name}) is supported: P = ${p} that it yields more qualified leads per dollar, with ${A.resolved} resolved on A and ${B.resolved} on B.`;
      recommendation = `Shift the remaining test budget to ${fav!.key} (${fav!.name}) and stop scaling ${other!.key}.`;
      const seg = ev.campaigns.find((c) => c.id === fav!.campaignId)?.adjacentSegment;
      const scans = view.filter((e) => e.type === 'market.scanned' && str(e.payload.campaignId) === fav!.campaignId && str(e.payload.status) === 'LIVE');
      const src = scans.flatMap((e) => (e.payload.sources as MarketSource[] | undefined) ?? [])[0];
      nextTest = seg
        ? src
          ? `Next test: the ${fav!.name} offer for ${seg.name}. Surfaced by the market scan: "${src.title}" (${src.url}).`
          : `Next test: the ${fav!.name} offer for ${seg.name}. This segment is a hypothesis, not yet researched: the market scan is BLOCKED, so no sources exist.`
        : `Next test: a second creative for ${fav!.name}.`;
      if (outcomesLanded) {
        statement += ` Won so far: ${usd(fav!.wonUsd)} from ${fav!.key}, ${usd(other!.wonUsd)} from ${other!.key}.`;
        recommendation += ' ' + counterfactual(view, fav!, other!);
      }
    }
  }

  const evidence = beliefEvidence(ev, newFinal);
  // revisedFrom: the belief being reversed if the favored arm flips, else the previous version.
  let revisedSrc: LedgerEvent | undefined = last;
  if (ev.favors && prevDirectional && str(prevDirectional.payload.favors) !== ev.favors) revisedSrc = prevDirectional;
  const revisedFrom = revisedSrc
    ? {
        version: num(revisedSrc.payload.version) ?? 0,
        statement: str(revisedSrc.payload.statement) ?? '',
        status: str(revisedSrc.payload.status) ?? 'INSUFFICIENT',
        favors: str(revisedSrc.payload.favors) ?? null,
      }
    : undefined;

  const changes: string[] = [];
  if (last) {
    const lp = last.payload;
    if (str(lp.status) !== ev.status) changes.push(`Status: ${str(lp.status)} -> ${ev.status}`);
    if ((str(lp.favors) ?? null) !== ev.favors) changes.push(`Favors: ${str(lp.favors) ?? 'none'} -> ${ev.favors ?? 'none'}`);
    const lpA = num(lp.pA);
    if (lpA !== undefined && ev.pA !== null && (1 - lpA).toFixed(2) !== (1 - ev.pA).toFixed(2)) changes.push(`P(B better per dollar): ${(1 - lpA).toFixed(2)} -> ${(1 - ev.pA).toFixed(2)}`);
    const la = (lp.arms as Record<string, { resolved: number; qualified: number }> | undefined) ?? {};
    if (A && B) changes.push(`Resolved leads: A ${la.A?.resolved ?? 0} -> ${A.resolved}, B ${la.B?.resolved ?? 0} -> ${B.resolved}`);
    if ((num(lp.policyVersion) ?? 1) !== policy.version) changes.push(`Decision policy v${num(lp.policyVersion) ?? 1} -> v${policy.version}`);
    if (revisedSrc && revisedSrc !== last) changes.push(`Revises belief v${num(revisedSrc.payload.version)} (${str(revisedSrc.payload.status)} ${str(revisedSrc.payload.favors)}) from day ${learnedDay(revisedSrc)}`);
    const lastDay = learnedDay(last);
    const names = new Map(ev.leads.map((l) => [l.id, l.name]));
    for (const e of view) {
      if (e.type !== 'outcome.recorded' && e.type !== 'lead.replied') continue;
      const od = isoToDay(e.occurredAt);
      const ld = learnedDay(e);
      if (ld > lastDay && ld > od) changes.push(`Late evidence: ${e.type === 'outcome.recorded' ? str(e.payload.stage) : 'reply'} for ${names.get(str(e.payload.leadId) ?? '') ?? str(e.payload.leadId)} occurred day ${od}, learned day ${ld}`);
    }
    for (const o of newFinal) changes.push(`Outcome: ${str(o.payload.stage)} ${usd(num(o.payload.valueUsd) ?? null)} (lead ${str(o.payload.leadId)}, day ${learnedDay(o)})`);
  }

  const arms: Record<string, unknown> = {};
  for (const a of ev.arms) {
    arms[a.key] = { campaignId: a.campaignId, leads: a.leads, spendUsd: a.spendUsd, cplUsd: a.cplUsd, qualified: a.qualified, resolved: a.resolved, costPerQualifiedUsd: a.costPerQualifiedUsd, wonUsd: a.wonUsd, pipelineUsd: a.pipelineUsd };
  }

  return {
    version,
    status: ev.status,
    favors: ev.favors,
    probability: ev.probability,
    pA: ev.pA,
    minResolved: ev.minResolved,
    statement,
    recommendation,
    nextTest,
    evidence,
    ...(revisedFrom ? { revisedFrom } : {}),
    ...(last ? { changes } : {}),
    policyVersion: policy.version,
    rulesVersion,
    arms,
  };
}

function beliefEvidence(ev: Evaluation, newFinal: LedgerEvent[]): { eventId: string; day: number; label: string }[] {
  const byCampaign = new Map(ev.campaigns.map((c) => [c.id, c.key]));
  const resolved = ev.leads
    .filter((l) => l.campaignId && l.qual.status !== 'UNRESOLVED')
    .sort((a, b) => (b.resolvedLearnedDay ?? 0) - (a.resolvedLearnedDay ?? 0));
  const out: { eventId: string; day: number; label: string }[] = [];
  for (const o of newFinal) {
    out.push({ eventId: o.id, day: learnedDay(o), label: `${str(o.payload.stage)}: ${usd(num(o.payload.valueUsd) ?? null)} (${str(o.payload.leadId)})` });
  }
  for (const l of resolved.slice(0, 8)) {
    const src = l.fields.budgetUsd.source ?? l.fields.decisionMaker.source ?? l.fields.timelineDays.source;
    const lateSrc = [l.fields.timelineDays.source, l.fields.decisionMaker.source, l.fields.budgetUsd.source].find((s) => s && s.eventId.startsWith('ext:crm:'));
    const s = lateSrc ?? src;
    if (!s) continue;
    const why = l.qual.status === 'QUALIFIED' ? `qualified (${usd(l.known.budgetUsd)}, ${l.known.timelineDays} days)` : `not a fit (${l.qual.reasons[0] ?? ''})`;
    out.push({ eventId: s.eventId, day: l.resolvedLearnedDay ?? s.day, label: `${byCampaign.get(l.campaignId as string) ?? ''}: ${l.name} ${why}${lateSrc ? ', learned late from CRM' : ''}` });
  }
  return out.slice(0, 10);
}

function counterfactual(view: LedgerEvent[], fav: ArmSnapshot, other: ArmSnapshot): string {
  // What scaling the day 3 dashboard pick would have bought: move the favored arm's post-day-3 budget to the other arm at its observed rates.
  const early = visibleAt(view, 3);
  let favSpendByDay3 = 0;
  for (const e of early) if (e.type === 'spend.recorded' && str(e.payload.campaignId) === fav.campaignId) favSpendByDay3 += num(e.payload.amountUsd) ?? 0;
  const moved = Math.max(0, fav.spendUsd - favSpendByDay3);
  const extraLeads = other.cplUsd ? Math.round(moved / other.cplUsd) : 0;
  const rate = other.leads ? other.qualified / other.leads : 0;
  const extraQ = Math.round(extraLeads * rate * 10) / 10;
  return `Counterfactual: scaling ${other.key} on day 3 would have moved ${usd(moved)} of ${fav.key}'s budget into ${other.key}, buying about ${extraLeads} more leads at ${usd(other.cplUsd)} CPL and about ${extraQ} qualified at ${other.key}'s ${Math.round(rate * 100)}% rate, with ${usd(other.wonUsd)} won from ${other.key} so far. ${fav.key} turned ${usd(fav.spendUsd)} into ${usd(fav.wonUsd)} won plus ${usd(fav.pipelineUsd)} open pipeline.`;
}
