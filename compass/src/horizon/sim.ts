/**
 * Client-side, deterministic demo data. Runs the ai-media-q4 scenario through every stage beat with the real
 * engine (in-memory ledger, offline providers, no chaos) and serves the world as the agent knew it on any day.
 * No server, no network, no env vars. To feed real data, replace this module with a fetch that returns WorldView frames.
 */
import type { WorldView } from './contract';
import { BEATS } from './engine/beats';
import { dayToIso, WAKE_HOUR, type LedgerEvent } from './engine/events';
import { MemoryStore } from './engine/memory-store';
import { project, type WorkspaceMeta } from './engine/project';
import { SCENARIO_ID } from './engine/scenario/ai-media-q4';
import { OFFLINE_CONFIG, offlineProviders, SimulatedCrash, wake } from './engine/wake';

const WORKSPACE: WorkspaceMeta = { id: 'compass-demo', mode: 'DEMO', label: 'Demo', scenario: SCENARIO_ID, liveProviders: false };

export interface KeyDay {
  day: number;
  caption: string;
}

export interface Simulation {
  lastDay: number;
  /** Days the story stops on, with a caption of a few words. */
  keyDays: KeyDay[];
  /** project(events, { asOfDay: day }): the world exactly as the agent knew it on that day. Memoized. */
  frameAt(day: number): WorldView;
}

async function runScenario(): Promise<LedgerEvent[]> {
  const store = new MemoryStore();
  for (const def of BEATS) {
    const at = dayToIso(def.day, WAKE_HOUR);
    await store.append([
      { id: `stage:beat:${def.beat}`, workspaceId: WORKSPACE.id, type: 'stage.beat', occurredAt: at, learnedAt: at, source: 'presenter', mode: 'DEMO', payload: { beat: def.beat } },
    ]);
    if (!def.wakes) continue;
    await wake({
      store,
      workspace: WORKSPACE,
      providers: offlineProviders(),
      day: def.day,
      trigger: 'BEAT',
      beat: def.beat,
      crash: async () => {
        throw new SimulatedCrash();
      },
      wallClock: () => at,
    });
  }
  return store.list(WORKSPACE.id);
}

function build(events: LedgerEvent[]): Simulation {
  const waking = BEATS.filter((b) => b.wakes);
  const lastDay = Math.max(...waking.map((b) => b.day));
  const cache = new Map<number, WorldView>();
  return {
    lastDay,
    keyDays: waking.map((b) => ({ day: b.day, caption: b.caption })),
    frameAt(day: number) {
      const d = Math.max(0, Math.min(lastDay, Math.round(day)));
      let frame = cache.get(d);
      if (!frame) {
        frame = project(events, { workspace: WORKSPACE, providers: OFFLINE_CONFIG, asOfDay: d });
        cache.set(d, frame);
      }
      return frame;
    },
  };
}

let loading: Promise<Simulation> | null = null;

/** Runs the scenario once per page load; later calls share the result. */
export function loadSimulation(): Promise<Simulation> {
  loading ??= runScenario().then(build);
  return loading;
}
