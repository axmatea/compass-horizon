import { readConfig } from './config.mjs';
import { createHttp, ProviderError } from './http.mjs';
import { research } from './nimble.mjs';
import { extract } from './liquid.mjs';
import { metrics } from './tinybird.mjs';

export { ProviderError } from './http.mjs';

export function createProviders({ env = process.env, fetchImpl = fetch } = {}) {
  const config = readConfig(env);
  const http = createHttp(fetchImpl, config.timeoutMs);
  const metricsHttp = createHttp(fetchImpl, Math.max(10000, config.timeoutMs));
  const providers = [config.nimble, config.liquid, config.tinybird];
  const capabilityBlocks = new Map();

  async function run(provider, operation, input, request) {
    const started = performance.now();
    const receipt = status => ({
      provider: provider.name, operation,
      ...(provider.model ? { model: provider.model } : {}),
      status, at: new Date().toISOString(), durationMs: Math.max(0, Math.round(performance.now() - started)),
    });
    try {
      if (provider.reason) throw new ProviderError('PROVIDER_BLOCKED');
      const result = await request(provider, input);
      capabilityBlocks.delete(provider.name);
      return { result, receipt: receipt('completed') };
    } catch (error) {
      const safe = error instanceof ProviderError ? error : new ProviderError('INVALID_RESPONSE');
      if (['MODEL_UNAVAILABLE', 'STRUCTURED_OUTPUT_UNAVAILABLE'].includes(safe.reasonCode)) capabilityBlocks.set(provider.name, safe.message);
      safe.receipt = receipt(safe.status === 'BLOCKED' ? 'blocked' : 'failed');
      throw safe;
    }
  }

  return {
    status: () => providers.map(provider => {
      const reason = provider.reason ?? capabilityBlocks.get(provider.name);
      return { name: provider.name, status: reason ? 'BLOCKED' : 'CONFIGURED', operation: provider.operation,
        ...(reason ? { reason } : { reason: 'Configured only; availability is verified during an operation.' }) };
    }),
    research: input => run(config.nimble, 'research', input, (provider, args) => research(provider, http, args)),
    extract: input => run(config.liquid, 'extract', input, (provider, args) => extract(provider, http, args)),
    metrics: input => run(config.tinybird, 'metrics', input, (provider, args) => metrics(provider, metricsHttp, args)),
  };
}
