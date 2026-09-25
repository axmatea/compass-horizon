// Server-side configuration. Secrets are read from process.env only and are
// never logged, serialized, or sent to the browser.
//
// Inference: General Compute (sponsor, OpenAI-compatible) is primary when GENERALCOMPUTE_API_KEY is set,
//            Nebius GLM-5.3 is the fallback (or primary when only NEBIUS_API_KEY is set). LLM_PROVIDER forces one.
// Voice:     Gradium (sponsor, STT + TTS WebSockets) is primary when GRADIUM_API_KEY is set,
//            Boson Higgs Realtime next, browser speech last. VOICE_PROVIDER forces one.
export function loadConfig(env = process.env) {
  const nebius = {
    provider: 'nebius',
    apiKey: env.NEBIUS_API_KEY || '',
    baseUrl: (env.NEBIUS_BASE_URL || 'https://api.tokenfactory.us-north1.nebius.com/v1/').replace(/\/?$/, '/'),
    model: env.NEBIUS_MODEL || 'zai-org/GLM-5.3',
    timeoutMs: Number(env.NEBIUS_TIMEOUT_MS || 20000),
    thinking: env.NEBIUS_THINKING === 'on',
  };
  const generalcompute = {
    provider: 'generalcompute',
    apiKey: env.GENERALCOMPUTE_API_KEY || env.GENERAL_COMPUTE_API_KEY || '',
    baseUrl: (env.GENERALCOMPUTE_BASE_URL || env.GENERAL_COMPUTE_BASE_URL || 'https://api.generalcompute.com/v1/').replace(/\/?$/, '/'),
    model: env.GENERALCOMPUTE_MODEL || env.GENERAL_COMPUTE_MODEL || 'minimax-m2.7',
    timeoutMs: Number(env.GENERALCOMPUTE_TIMEOUT_MS || env.GENERAL_COMPUTE_TIMEOUT_MS || env.NEBIUS_TIMEOUT_MS || 20000),
    thinking: false,
  };
  const forced = env.LLM_PROVIDER === 'nebius' ? 'nebius' : /^general[_-]?compute$/i.test(env.LLM_PROVIDER || '') ? 'generalcompute' : null;
  const llmOrder = forced ? [forced] : ['generalcompute', 'nebius'];
  const llmChain = llmOrder.map((p) => (p === 'nebius' ? nebius : generalcompute)).filter((c) => c.apiKey);

  const boson = {
    apiKey: env.BOSON_API_KEY || '',
    // Voice is a product decision: set from the audition (scripts/boson-voice-audition.mjs).
    // Chosen by audition 2026-09-18 (nora: 160 Hz, 4.1 st pitch SD, 154 wpm). See COMPASS_MASTER §18.
    voice: env.BOSON_VOICE || 'nora',
    turnDetection: env.BOSON_TURN_DETECTION === 'server_vad' ? 'server_vad' : 'semantic_vad',
    realtimeUrl: env.BOSON_REALTIME_URL || 'wss://api.boson.ai/v1/realtime?model=higgs-realtime',
  };
  const gradium = {
    apiKey: env.GRADIUM_API_KEY || '',
    baseUrl: (env.GRADIUM_BASE_URL || 'wss://api.gradium.ai/api').replace(/\/$/, ''),
    // Flagship English voices (docs.gradium.ai/guides/voices/flagship-voices): Zoey NbpkqMVS3CJeq2j8, Sunnie YVzbrdWnnu9FgRn5, Harper 4SZHfMpw-p46Ywgs.
    voiceId: env.GRADIUM_VOICE_ID || 'NbpkqMVS3CJeq2j8',
    voiceName: env.GRADIUM_VOICE_NAME || 'zoey',
    language: env.GRADIUM_STT_LANGUAGE || 'en',
    // End of turn when the semantic VAD's inactivity probability at this horizon exceeds the threshold.
    // Turn-taking recipe from the Pipecat Gradium STT reference: watch the 3 s end-pointing horizon,
    // inactivity >= 0.5 arms/ends a turn, ignore 8 step messages after each flush.
    turnHorizonS: Number(env.GRADIUM_EOT_HORIZON_S || env.GRADIUM_TURN_HORIZON_S || 3),
    turnThreshold: Number(env.GRADIUM_EOT_THRESHOLD || env.GRADIUM_TURN_THRESHOLD || 0.5),
    turnCooldownFrames: Number(env.GRADIUM_POST_FLUSH_COOLDOWN_FRAMES || 8),
  };
  const wanted = ['gradium', 'boson', 'browser'].includes(env.VOICE_PROVIDER) ? env.VOICE_PROVIDER : 'auto';
  const voiceProvider = wanted !== 'auto' ? wanted : gradium.apiKey ? 'gradium' : boson.apiKey ? 'boson' : 'browser';

  return {
    nebius,
    generalcompute,
    /** Ordered inference chain; llm = primary. Empty when no key is configured. */
    llmChain,
    llm: llmChain[0] || null,
    boson,
    gradium,
    voiceProvider,
    voiceRequested: wanted,
  };
}

/** Safe description of config for logs/health: presence flags only. */
export function describeConfig(cfg) {
  const voiceCfg = cfg.voiceProvider === 'gradium' ? cfg.gradium : cfg.voiceProvider === 'boson' ? cfg.boson : null;
  return {
    llm: { provider: cfg.llm?.provider || null, model: cfg.llm?.model || null, configured: Boolean(cfg.llm), fallback: cfg.llmChain[1]?.provider || null },
    nebius: { configured: Boolean(cfg.nebius.apiKey), model: cfg.nebius.model },
    generalcompute: { configured: Boolean(cfg.generalcompute.apiKey), model: cfg.generalcompute.model },
    boson: { configured: Boolean(cfg.boson.apiKey), voice: cfg.boson.voice, turnDetection: cfg.boson.turnDetection },
    gradium: { configured: Boolean(cfg.gradium.apiKey), voice: cfg.gradium.voiceName, language: cfg.gradium.language },
    voiceProvider: cfg.voiceProvider,
    voiceRequested: cfg.voiceRequested,
    voice: { provider: cfg.voiceProvider, realtime: cfg.voiceProvider !== 'browser', voice: voiceCfg ? (voiceCfg.voiceName || voiceCfg.voice) : null },
  };
}
