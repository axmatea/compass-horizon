import { BEATS } from '@/engine/beats';
import { dayToIso, WAKE_HOUR, type LedgerEvent } from '@/engine/events';
import { project, type WorkspaceMeta } from '@/engine/project';
import { SCENARIO_ID } from '@/engine/scenario/ai-media-q4';
import { OFFLINE_CONFIG, offlineProviders, SimulatedCrash, wake, type WakeResult } from '@/engine/wake';
import { MemoryStore } from '@/server/memory-store';

export function demoWorkspace(id = 'test-ws'): WorkspaceMeta {
  return { id, mode: 'DEMO', label: 'Demo', scenario: SCENARIO_ID, liveProviders: false };
}

export function crashFor(store: MemoryStore) {
  return async (fired: LedgerEvent): Promise<never> => {
    await store.append([fired]);
    throw new SimulatedCrash();
  };
}

export async function beat(store: MemoryStore, ws: WorkspaceMeta, n: number): Promise<WakeResult | null> {
  const def = BEATS[n];
  await store.append([
    { id: `stage:beat:${n}`, workspaceId: ws.id, type: 'stage.beat', occurredAt: dayToIso(def.day, WAKE_HOUR), learnedAt: dayToIso(def.day, WAKE_HOUR), source: 'presenter', mode: ws.mode, payload: { beat: n } },
  ]);
  if (!def.wakes) return null;
  return wake({ store, workspace: ws, providers: offlineProviders(), day: def.day, trigger: 'BEAT', beat: n, crash: crashFor(store) });
}

export async function world(store: MemoryStore, ws: WorkspaceMeta, asOfDay?: number) {
  return project(await store.list(ws.id), { workspace: ws, providers: OFFLINE_CONFIG, asOfDay });
}
