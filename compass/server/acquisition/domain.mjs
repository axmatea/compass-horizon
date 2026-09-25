export const DEFAULT_RULES = Object.freeze({ minBudget: 5000, maxTimelineDays: 90 });
export const FIELD_NAMES = ['problem', 'decisionMaker', 'budget', 'timelineDays', 'businessFit'];
export function problem(message, status = 400, code = 'invalid_request') {
  return Object.assign(new Error(message), { status, code });
}
export function text(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw problem(`${name} is required (maximum ${max} characters).`);
  return value.trim();
}
export function validateRules(value) {
  const rules = value ?? DEFAULT_RULES;
  if (!rules || !Number.isFinite(rules.minBudget) || rules.minBudget < 0 || rules.minBudget > 1e9 || !Number.isInteger(rules.maxTimelineDays) || rules.maxTimelineDays < 1 || rules.maxTimelineDays > 3650) throw problem('Invalid qualification rules.');
  return { minBudget: rules.minBudget, maxTimelineDays: rules.maxTimelineDays };
}
export function validateFields(value, { partial = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('Fields must be an object.');
  const result = partial ? {} : Object.fromEntries(FIELD_NAMES.map(k => [k, null]));
  for (const [key, v] of Object.entries(value)) {
    if (!FIELD_NAMES.includes(key)) throw problem(`Unsupported field: ${key}`);
    if (v === null) { result[key] = null; continue; }
    if (key === 'problem') { result[key] = text(v, key, 2000); continue; }
    if (['decisionMaker', 'businessFit'].includes(key)) {
      if (typeof v !== 'boolean') throw problem(`${key} must be true, false or null.`);
    } else if (!Number.isFinite(v) || v < 0 || v > 1e9 || (key === 'timelineDays' && !Number.isInteger(v))) throw problem(`${key} must be a non-negative number or null.`);
    result[key] = v;
  }
  return result;
}
export function qualify(fields, rules = DEFAULT_RULES, rulesVersion = 1) {
  const missing = FIELD_NAMES.filter(k => fields[k] === null || fields[k] === undefined);
  const reasons = [];
  if (fields.decisionMaker === false) reasons.push('Not a decision maker.');
  if (fields.businessFit === false) reasons.push('Business is outside the agreed customer profile.');
  if (fields.budget != null && fields.budget < rules.minBudget) reasons.push(`Confirmed budget is below $${rules.minBudget.toLocaleString('en-US')}.`);
  if (fields.timelineDays != null && fields.timelineDays > rules.maxTimelineDays) reasons.push(`Confirmed timeline exceeds ${rules.maxTimelineDays} days.`);
  const questions = { problem: 'What specific workflow needs to improve?', decisionMaker: 'Are you responsible for the implementation decision?', businessFit: 'What does your business do?', budget: 'What budget have you allocated for this implementation?', timelineDays: 'Within how many days do you need to begin?' };
  return { status: reasons.length ? 'NOT_ICP' : missing.length ? 'NEEDS_CONTEXT' : 'QUALIFIED', reasons: reasons.length ? reasons : missing.length ? ['More evidence is needed.'] : ['All confirmed fields meet the current rules.'], missing, nextQuestion: missing.length ? questions[missing[0]] : null, rulesVersion };
}
// Per-field clocks prevent a late answer from rolling back unrelated newer facts.
// A stable tie-break makes equal-time, out-of-order deliveries deterministic.
export function mergeEvidence(fields, clocks, incoming, event) {
  const next = { ...fields }, versions = { ...clocks };
  const clock = JSON.stringify([event.occurredAt,event.source,event.externalId]);
  const changed = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (!versions[key] || clock > versions[key]) {
      if (next[key] !== value) changed.push(key);
      next[key] = value;
      versions[key] = clock;
    }
  }
  return { fields: next, clocks: versions, changed };
}
export function calculateMetrics(leads, source = 'PostgreSQL') {
  const m = { source, totalLeads: leads.length, qualified: 0, unresolved: 0, notIcp: 0, unknownAttribution: 0, sampleStatus: leads.length < 20 ? 'insufficient_evidence' : 'review', experiments: [] };
  const experiments = new Map();
  for (const lead of leads) {
    if (lead.qualification.status === 'QUALIFIED') m.qualified++;
    else if (lead.qualification.status === 'NOT_ICP') m.notIcp++;
    else m.unresolved++;
    if (!lead.experimentId) m.unknownAttribution++;
    else {
      const row = experiments.get(lead.experimentId) || { experimentId: lead.experimentId, total: 0, qualified: 0 };
      row.total++; if (lead.qualification.status === 'QUALIFIED') row.qualified++;
      experiments.set(lead.experimentId, row);
    }
  }
  m.experiments = [...experiments.values()];
  return m;
}
export function snapshotKey(leads) {
  return leads.map(l=>`${l.id}:${l.version}`).sort().join('|');
}
export function recommend(metrics) {
  if (!metrics.totalLeads) return 'Define two hypotheses, then record the first inbound conversation. No advertising is launched by COMPASS.';
  if (metrics.unresolved) return `Ask the missing qualification questions for ${metrics.unresolved} unresolved lead${metrics.unresolved === 1 ? '' : 's'}. Keep both hypotheses open; do not scale spend yet.`;
  if (metrics.unknownAttribution) return 'Resolve unknown attribution before comparing the experiments. Do not assign a source by guessing.';
  return metrics.sampleStatus === 'insufficient_evidence' ? 'Insufficient evidence to choose a winner. Keep the qualification rules fixed and collect the next comparable batch.' : 'Review qualification by experiment and check comparable spend and observation windows before designing the next test. These counts alone do not establish a winner.';
}
