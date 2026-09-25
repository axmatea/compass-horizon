import type { ProviderConfig, WorkspaceMeta } from '@/engine/project';
import type { Providers } from '@/engine/wake';
import { liquidEndpoint, liquidExtract } from './liquid';
import { nimbleConfigured, nimbleSearch } from './nimble';
import { tinybirdConfigured, tinybirdMirror } from './tinybird';

/** Honest status per workspace: BLOCKED without credentials, READY with credentials; LIVE only after a real successful call (see project.providerStatus). */
export function providerConfig(ws: Pick<WorkspaceMeta, 'liveProviders'> | null, env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const live = Boolean(ws?.liveProviders);
  const ep = liquidEndpoint(env);
  return {
    nimble: nimbleConfigured(env)
      ? { status: 'READY', detail: live ? 'Key present: market scans call Nimble search in this workspace' : 'Key present, but the public demo makes no Nimble calls: segments stay hypotheses' }
      : { status: 'BLOCKED', detail: 'NIMBLE_API_KEY not set: market scans record BLOCKED with no sources' },
    liquid: ep
      ? { status: 'READY', detail: live ? `Key present: replies are extracted by ${ep.model}${ep.via === 'openrouter' ? ' via OpenRouter' : ''}` : 'Key present, but the public demo uses the rules fallback' }
      : { status: 'BLOCKED', detail: 'LIQUID_API_KEY not set: public demo uses the rules fallback' },
    tinybird: tinybirdConfigured(env)
      ? { status: 'READY', detail: live ? 'Token present: ledger mirrored to longview_events, as-of metrics queried' : 'Token present, but the public demo computes metrics locally (LOCAL)' }
      : { status: 'BLOCKED', detail: 'TINYBIRD_TOKEN not set: metrics computed from Postgres (LOCAL)' },
  };
}

export function serverProviders(ws: WorkspaceMeta): Providers {
  const config = providerConfig(ws);
  return {
    config,
    canCall: (name) => ws.liveProviders && config[name].status === 'READY',
    liquidExtract: (text) => liquidExtract(text),
    nimbleSearch: (query) => nimbleSearch(query),
    tinybirdMirror: (events, asOfIso, workspaceId) => tinybirdMirror(events, asOfIso, workspaceId),
  };
}
