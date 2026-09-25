import { createHmac } from 'node:crypto';
import { boundedText, isRecord, requireValid } from './http.mjs';

const STATES = ['QUALIFIED', 'NEEDS_CONTEXT', 'NOT_ICP'];
const KEYS = ['tenantId', 'leadId', 'version', 'experimentId', 'status', 'mode', 'deleted'];
const hashPattern = /^[a-f0-9]{64}$/;

export function prepareRows(rows, hashKey) {
  requireValid(Array.isArray(rows) && rows.length > 0 && rows.length <= 5000, 'INVALID_INPUT');
  const hash = (...parts) => createHmac('sha256', hashKey).update(JSON.stringify(parts)).digest('hex');
  const experimentIds = new Map();
  const versions = new Map();
  let tenantId;
  let mode;
  const events = rows.map(row => {
    // Strict allowlist: accidental canonical lead objects containing PII are rejected, not forwarded.
    requireValid(isRecord(row) && Object.keys(row).every(key => KEYS.includes(key)), 'INVALID_INPUT');
    requireValid(boundedText(row.tenantId, 200) && boundedText(row.leadId, 200)
      && Number.isSafeInteger(row.version) && row.version >= 1
      && (row.experimentId === null || boundedText(row.experimentId, 200))
      && STATES.includes(row.status) && ['LIVE', 'DEMO'].includes(row.mode)
      && (row.deleted === undefined || typeof row.deleted === 'boolean'), 'INVALID_INPUT');
    tenantId ??= row.tenantId;
    mode ??= row.mode;
    requireValid(row.tenantId === tenantId && row.mode === mode, 'INVALID_INPUT');
    const experimentKey = row.experimentId === null ? '' : hash('experiment', mode, tenantId, row.experimentId);
    if (experimentKey) experimentIds.set(experimentKey, row.experimentId);
    const event = {
      tenant_key: hash('tenant', mode, tenantId), lead_key: hash('lead', mode, tenantId, row.leadId), mode, version: row.version,
      experiment_key: experimentKey, qualification: row.status, deleted: row.deleted ? 1 : 0,
    };
    event.event_id = hash('lead-version', event);
    const key = `${event.lead_key}:${event.version}`;
    requireValid(!versions.has(key) || versions.get(key) === event.event_id, 'INVALID_INPUT');
    versions.set(key, event.event_id);
    return event;
  });
  return { events: [...new Map(events.map(event => [event.event_id, event])).values()], tenantKey: events[0].tenant_key, mode, experimentIds };
}

export function metricsSql(datasource, tenantKey, mode) {
  requireValid(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(datasource) && hashPattern.test(tenantKey) && ['LIVE', 'DEMO'].includes(mode), 'INVALID_INPUT');
  // Hash-only tenant and identifier-only resource names cannot escape these SQL literals.
  return `SELECT
  tupleElement(current, 1) AS experiment_key,
  count() AS total,
  countIf(tupleElement(current, 2) = 'QUALIFIED') AS qualified,
  countIf(tupleElement(current, 2) = 'NEEDS_CONTEXT') AS unresolved,
  countIf(tupleElement(current, 2) = 'NOT_ICP') AS not_icp
FROM (
  SELECT tenant_key, lead_key,
    argMax(tuple(experiment_key, qualification, deleted), tuple(version, event_id)) AS current
  FROM ${datasource}
  WHERE tenant_key = '${tenantKey}' AND mode = '${mode}'
  GROUP BY tenant_key, lead_key
)
WHERE tupleElement(current, 3) = 0
GROUP BY experiment_key
ORDER BY experiment_key
FORMAT JSON`;
}

function count(value) {
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) value = Number(value);
  requireValid(Number.isSafeInteger(value) && value >= 0);
  return value;
}

export function parseMetrics(data, experimentIds) {
  requireValid(isRecord(data) && !data.error && Array.isArray(data.data) && data.data.length <= 5001);
  if (data.rows !== undefined) requireValid(count(data.rows) === data.data.length);
  const metrics = { source: 'Tinybird', totalLeads: 0, qualified: 0, unresolved: 0, notIcp: 0, unknownAttribution: 0,
    sampleStatus: 'insufficient_evidence', experiments: [] };
  const seen = new Set();
  for (const row of data.data) {
    requireValid(isRecord(row) && (row.experiment_key === '' || (hashPattern.test(row.experiment_key) && experimentIds.has(row.experiment_key)))
      && !seen.has(row.experiment_key));
    seen.add(row.experiment_key);
    const total = count(row.total);
    const qualified = count(row.qualified);
    const unresolved = count(row.unresolved);
    const notIcp = count(row.not_icp);
    requireValid(qualified + unresolved + notIcp === total);
    metrics.totalLeads += total;
    metrics.qualified += qualified;
    metrics.unresolved += unresolved;
    metrics.notIcp += notIcp;
    if (row.experiment_key === '') metrics.unknownAttribution += total;
    else metrics.experiments.push({ experimentId: experimentIds.get(row.experiment_key), total, qualified });
  }
  requireValid(Number.isSafeInteger(metrics.totalLeads));
  // Counts do not establish significance, causal lift, or a winning experiment.
  return metrics;
}

export async function metrics(config, http, { rows } = {}) {
  const { events, tenantKey, mode, experimentIds } = prepareRows(rows, config.hashKey);
  const url = new URL(`${config.base}/v0/events`);
  url.searchParams.set('name', config.datasource);
  url.searchParams.set('wait', 'true');
  const body = events.map(row => JSON.stringify(row)).join('\n') + '\n';
  requireValid(Buffer.byteLength(body) <= 4 * 1024 * 1024, 'INVALID_INPUT');
  const ack = await http(url, { method: 'POST', token: config.appendToken, contentType: 'application/x-ndjson', body });
  requireValid(isRecord(ack) && !ack.error && ack.successful_rows === events.length && ack.quarantined_rows === 0, 'INGEST_NOT_ACKNOWLEDGED');
  const response = await http(`${config.base}/v0/sql`, {
    method: 'POST', token: config.readToken, contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({ q: metricsSql(config.datasource, tenantKey, mode) }).toString(),
  });
  return parseMetrics(response, experimentIds);
}
