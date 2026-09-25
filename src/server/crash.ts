import type { LedgerEvent } from '@/engine/events';
import { SimulatedCrash, type Store } from '@/engine/wake';

export { SimulatedCrash };

/** Pull the plug: write chaos.fired first, then really kill the serverless process on Vercel. Locally, throw so the dev server survives. */
export function makeCrash(store: Store) {
  return async (fired: LedgerEvent): Promise<never> => {
    await store.append([fired]);
    if (process.env.VERCEL) process.exit(1);
    throw new SimulatedCrash();
  };
}
