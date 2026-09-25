// Voice provider abstraction. The agent core never talks to a voice vendor directly.
//
// VoiceProvider {
//   name: string
//   capabilities: { stt, tts, realtime, bargeIn, streamingTts, languages[] }
//   where: 'browser' | 'server'           // browser = runs client-side, server only reports it
//   status(): { configured: boolean, verifiedContract: boolean, note?: string }
// }
//
// Barge-in contract with the agent core: when the provider detects user speech while
// the assistant speaks, playback is flushed and the new utterance becomes a runtime turn,
// which patches state and invalidates dependent actions.

export function createBrowserVoiceProvider() {
  return {
    name: 'browser',
    where: 'browser',
    capabilities: { stt: true, tts: true, realtime: false, bargeIn: true, streamingTts: false, languages: ['browser-dependent'] },
    status: () => ({ configured: true, verifiedContract: true, note: 'Web Speech API in the browser; no server audio.' }),
  };
}

/**
 * Boson Higgs Realtime (contract verified from official docs 2026-09-18, COMPASS_MASTER §18).
 * Runs server-side as a relay (server/voice/realtime-bridge.mjs); the browser never sees the key.
 */
export function createBosonVoiceProvider({ apiKey, voice = 'default', turnDetection = 'semantic_vad' }) {
  return {
    name: 'boson',
    where: 'server',
    endpoint: '/api/voice/realtime',
    capabilities: { stt: true, tts: true, realtime: true, bargeIn: true, streamingTts: true, languages: ['100+ (auto-detected)'] },
    status: () => ({ configured: Boolean(apiKey), verifiedContract: true, liveVerified: false, voice, turnDetection, note: 'WebSocket relay to wss://api.boson.ai/v1/realtime (higgs-realtime); reasoning stays on COMPASS via compass_turn.' }),
  };
}

/**
 * Gradium STT + TTS (docs.gradium.ai, retrieved 2026-09-19). Server-side relay
 * (server/voice/gradium-bridge.mjs): semantic VAD from the STT stream, one TTS socket per reply.
 */
export function createGradiumVoiceProvider({ apiKey, voiceName = 'zoey', language = 'en' }) {
  return {
    name: 'gradium',
    where: 'server',
    endpoint: '/api/voice/realtime',
    capabilities: { stt: true, tts: true, realtime: true, bargeIn: true, streamingTts: true, languages: ['en', 'fr', 'es', 'pt', 'de'] },
    status: () => ({ configured: Boolean(apiKey), verifiedContract: true, liveVerified: false, voice: voiceName, language, note: 'WebSocket relay to wss://api.gradium.ai/api/speech/{asr,tts}; reasoning stays on COMPASS.' }),
  };
}

export function createVoiceRegistry(config) {
  const providers = [createBrowserVoiceProvider(), createBosonVoiceProvider(config.boson), createGradiumVoiceProvider(config.gradium)];
  const byName = new Map(providers.map((p) => [p.name, p]));
  // Priority resolved in config: gradium -> boson -> browser (VOICE_PROVIDER overrides).
  const active = byName.get(config.voiceProvider) && byName.get(config.voiceProvider).status().configured ? byName.get(config.voiceProvider) : byName.get('browser');
  return {
    activeName: active.name,
    fallback: 'browser',
    active,
    get: (n) => byName.get(n) || null,
    list: () => providers.map((p) => ({ name: p.name, where: p.where, capabilities: p.capabilities, ...p.status() })),
  };
}
