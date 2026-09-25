// Upstream connection to Boson Higgs Realtime (contract: COMPASS_MASTER §18,
// https://docs.boson.ai/api-reference/realtime/client-events.md, retrieved 2026-09-18).
// The API key is sent only in the Authorization header of this server-side socket.
import WebSocket from 'ws';

export const BOSON_REALTIME_URL = 'wss://api.boson.ai/v1/realtime?model=higgs-realtime';
export const AUDIO_RATE = 24000; // PCM16 LE mono, Boson internal rate

export const COMPASS_TURN_TOOL = Object.freeze({
  type: 'function',
  name: 'compass_turn',
  description: 'Send what the user just said to COMPASS, which owns all reasoning, memory and actions. Call this for every user utterance.',
  parameters: {
    type: 'object',
    properties: { utterance: { type: 'string', description: "The user's exact words, verbatim, in their language." } },
    required: ['utterance'],
  },
});

export const VOICE_INSTRUCTIONS = `You are the voice of COMPASS, a calm, warm and quietly intelligent personal companion.
You never decide, plan or remember anything yourself. COMPASS does that.
Every time the user speaks, call compass_turn with their exact words and nothing else.
When you receive a compass_turn result, say its "say" text to the user naturally, like a thoughtful friend: relaxed pace, warm, never theatrical, never like an announcer or a support bot.
Keep every fact exactly as given (times, dates, places, names, numbers). Do not add facts, offers, questions or small talk. Keep it short.
Never mention tools, functions, systems or COMPASS internals. Reply in the user's language.`;

/**
 * Events that make Higgs speak `text` as a COMPASS result. Measured live 2026-09-18:
 * per-response `instructions` did NOT work (model called compass_turn("hello") even with
 * tool_choice "none"); a synthetic function_call + function_call_output pair followed by
 * response.create was spoken verbatim, first audio ~495 ms.
 */
export function speakEvents(text, { callId, metadata } = {}) {
  const call_id = callId || `call_compass_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return [
    { type: 'conversation.item.create', item: { type: 'function_call', call_id, name: 'compass_turn', arguments: '{"utterance":""}' } },
    { type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ say: String(text), kind: 'update' }) } },
    { type: 'response.create', response: metadata ? { metadata } : undefined },
  ];
}

/**
 * tool_choice stays "auto": measured live 2026-09-18, forced tool_choice
 * ({type:"function",name} and "required") hung after response.created with no output,
 * while "auto" + these instructions called compass_turn verbatim in ~380 ms.
 */
export function buildSessionConfig({ voice = 'default', turnDetection = 'semantic_vad', toolChoice = 'auto', transcription = true, noiseReduction = 'near_field' } = {}) {
  const td = turnDetection === 'semantic_vad'
    ? { type: 'semantic_vad' }
    : { type: 'server_vad', threshold: 0.55, prefix_padding_ms: 300, silence_duration_ms: 500, min_speech_duration: 0.125 };
  return {
    type: 'realtime',
    model: 'higgs-realtime',
    instructions: VOICE_INSTRUCTIONS,
    output_modalities: ['audio'],
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: AUDIO_RATE },
        noise_reduction: noiseReduction ? { type: noiseReduction } : null,
        transcription: transcription ? { model: 'higgs-stt-3.1', language: null } : null,
        turn_detection: td,
      },
      output: { format: { type: 'audio/pcm', rate: AUDIO_RATE }, voice },
    },
    tools: [COMPASS_TURN_TOOL],
    tool_choice: toolChoice,
    temperature: 0.3,
  };
}

/**
 * Open the upstream socket. Resolves once open. `url`/`WebSocketImpl` are injectable for tests.
 * Returns { send(event), close(code, reason), on(type, fn), socket }.
 */
export function connectBoson({ apiKey, url = BOSON_REALTIME_URL, WebSocketImpl = WebSocket, openTimeoutMs = 8000 }) {
  if (!apiKey) return Promise.reject(Object.assign(new Error('BOSON_API_KEY not configured'), { code: 'not_configured' }));
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url, ['realtime'], { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: openTimeoutMs });
    const handlers = new Map();
    const emit = (type, payload) => { for (const fn of handlers.get(type) || []) fn(payload); for (const fn of handlers.get('*') || []) fn(payload); };
    const api = {
      socket,
      send: (event) => { if (socket.readyState === 1) socket.send(JSON.stringify(event)); },
      close: (code = 1000, reason = '') => { try { socket.close(code, reason); } catch { /* already closed */ } },
      on: (type, fn) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return api; },
    };
    let opened = false;
    socket.on('open', () => { opened = true; resolve(api); });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      let ev;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
      if (ev && typeof ev.type === 'string') { const t = ev.type; handlers.get(t)?.forEach((fn) => fn(ev)); handlers.get('*')?.forEach((fn) => fn(ev)); }
    });
    socket.on('close', (code, reason) => {
      const info = { code, reason: String(reason || '').slice(0, 200) };
      if (!opened) reject(Object.assign(new Error(`Boson socket closed before open (${code})`), { code: 'connect_failed', closeCode: code }));
      emit('__close', info);
    });
    socket.on('error', (err) => {
      if (!opened) reject(Object.assign(new Error('Boson connection failed'), { code: 'connect_failed', cause: err }));
      emit('__error', { message: String(err?.message || err).slice(0, 200) });
    });
  });
}

export function describeCloseCode(code) {
  return ({ 1000: 'normal', 1013: 'boson_busy', 3000: 'boson_auth', 4429: 'boson_quota' })[code] || 'boson_closed';
}
