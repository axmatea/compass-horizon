// Composition root for the COMPASS backend. Only this file wires config -> providers.
import { loadConfig, describeConfig } from './config.mjs';
import { createNebiusClient, createLlmChain, LlmError } from './llm/nebius.mjs';
import { createGlmInterpreter } from './agent/interpreter.mjs';
import { createSiteInterpreter } from './agent/site-interpreter.mjs';
import { createAgentRuntime } from './agent/runtime.mjs';
import { createToolRegistry } from './tools/registry.mjs';
import { createMockRestaurantSearch } from './tools/mock-restaurant-search.mjs';
import { createOsmRestaurantSearch } from './tools/osm-restaurant-search.mjs';
import { createSiteCopyTool } from './tools/site-copy.mjs';
import { dinnerDomain } from './domains/dinner.mjs';
import { siteDomain } from './domains/site.mjs';
import { createVoiceRegistry } from './voice/provider.mjs';
import { createApiHandler } from './api.mjs';
import { attachVoiceServer } from './voice/ws-server.mjs';

export function createCompassBackend({ env = process.env, interpreter, siteInterpreter, tools, siteTools, connectUpstream, connectGradiumUpstream, logger = console } = {}) {
  const config = loadConfig(env);
  // Inference chain: General Compute first, Nebius as fallback (see server/config.mjs).
  const llm = config.llmChain.length ? createLlmChain(config.llmChain.map((c) => createNebiusClient(c)), { logger }) : null;
  const notConfigured = { interpret: async () => { throw new LlmError('No inference provider configured (GENERALCOMPUTE_API_KEY or NEBIUS_API_KEY)', { code: 'not_configured' }); } };

  // Dinner domain (original demo, /api/turn): real OpenStreetMap search by default, mock for offline replay.
  const toolRegistry = tools || createToolRegistry([
    env.COMPASS_TOOLS === 'mock' ? createMockRestaurantSearch({ delayMs: Number(env.MOCK_TOOL_DELAY_MS ?? 1500) }) : createOsmRestaurantSearch(),
  ]);
  const runtime = createAgentRuntime({ interpreter: interpreter || (llm ? createGlmInterpreter(llm) : notConfigured), tools: toolRegistry, domain: dinnerDomain });

  // Website domain (/demo, /api/site/turn): brief + write_copy + renderer. No publishing of any kind.
  const siteRegistry = siteTools || createToolRegistry([createSiteCopyTool({ llm })]);
  const siteRuntime = createAgentRuntime({ interpreter: siteInterpreter || (llm ? createSiteInterpreter(llm) : notConfigured), tools: siteRegistry, domain: siteDomain });

  const runtimes = { dinner: runtime, site: siteRuntime };
  const voice = createVoiceRegistry(config);
  const health = () => ({
    ...describeConfig(config),
    voice: { ...describeConfig(config).voice, provider: voice.activeName, realtime: voice.active.where === 'server' },
    tools: toolRegistry.list().map((t) => ({ name: t.name, mock: t.mock })),
    site: { implemented: true, tools: siteRegistry.list().map((t) => ({ name: t.name, mock: t.mock })), publishes: false },
  });
  return {
    runtime,
    siteRuntime,
    runtimes,
    voice,
    handleApi: createApiHandler({ runtime, siteRuntime, health, voice, logger }),
    /** Mount the realtime voice WebSocket on an http.Server (upgrade on /api/voice/realtime[?domain=site]). */
    attachVoice: (httpServer, options = {}) => attachVoiceServer(httpServer, { runtime, runtimes, config, connectUpstream, connectGradiumUpstream, logger, ...options }),
    config: describeConfig(config),
  };
}
