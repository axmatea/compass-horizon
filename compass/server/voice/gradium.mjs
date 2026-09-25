// Upstream connections to Gradium (docs.gradium.ai, retrieved 2026-09-19):
//   STT  wss://api.gradium.ai/api/speech/asr   setup -> ready; audio (base64 PCM16 24 kHz) ->
//        text / end_text / step{vad} ; flush -> flushed ; end_of_stream
//   TTS  wss://api.gradium.ai/api/speech/tts   setup{voice_id, output_format} -> ready; text ; end_of_stream ->
//        audio (base64 PCM16) / text (word timings) / end_of_stream
// Auth: x-api-key header, server-side only. There is no cancel message: barge-in closes the TTS socket.
import WebSocket from 'ws';

export const GRADIUM_BASE_URL = 'wss://api.gradium.ai/api';
export const AUDIO_RATE = 24000; // PCM16 LE mono, both directions (TTS asks for pcm_24000)
export const STT_CHUNK_BYTES = 1920 * 2; // 80 ms frames, the documented chunk size

// Mirrors the Pipecat GradiumSTTService reference (pipecat/services/gradium/stt.py): pcm_<rate>, delay_in_frames 12 (80 ms frames).
export function sttSetup({ language = 'en', delayInFrames = 12 } = {}) {
  return { type: 'setup', model_name: 'default', input_format: 'pcm_24000', json_config: { language, delay_in_frames: delayInFrames } };
}
export function ttsSetup({ voiceId, modelName = 'default' }) {
  return { type: 'setup', voice_id: voiceId, model_name: modelName, output_format: 'pcm_24000' };
}

/** Open one Gradium socket. Resolves once open. Returns { send, close, on, socket }. */
export function connectGradium({ apiKey, baseUrl = GRADIUM_BASE_URL, path, WebSocketImpl = WebSocket, openTimeoutMs = 8000 }) {
  if (!apiKey) return Promise.reject(Object.assign(new Error('GRADIUM_API_KEY not configured'), { code: 'not_configured' }));
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(`${baseUrl}${path}`, { headers: { 'x-api-key': apiKey, 'x-api-source': 'compass' }, handshakeTimeout: openTimeoutMs });
    const handlers = new Map();
    const emit = (type, payload) => { for (const fn of handlers.get(type) || []) fn(payload); for (const fn of handlers.get('*') || []) fn(payload); };
    const api = {
      socket,
      path,
      send: (event) => { if (socket.readyState === 1) socket.send(JSON.stringify(event)); },
      close: (code = 1000, reason = '') => { try { socket.close(code, reason); } catch { /* already closed */ } },
      on: (type, fn) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return api; },
      get open() { return socket.readyState === 1; },
    };
    let opened = false;
    socket.on('open', () => { opened = true; resolve(api); });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      let ev;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
      if (ev && typeof ev.type === 'string') emit(ev.type, ev);
    });
    socket.on('close', (code, reason) => {
      const info = { code, reason: String(reason || '').slice(0, 200) };
      if (!opened) reject(Object.assign(new Error(`Gradium socket closed before open (${code})`), { code: 'connect_failed', closeCode: code }));
      emit('__close', info);
    });
    socket.on('error', (err) => {
      if (!opened) reject(Object.assign(new Error('Gradium connection failed'), { code: 'connect_failed', cause: err }));
      emit('__error', { message: String(err?.message || err).slice(0, 200) });
    });
  });
}

export function describeGradiumClose(code) {
  return ({ 1000: 'normal', 1008: 'gradium_rejected', 1011: 'gradium_server_error', 1002: 'gradium_protocol' })[code] || 'gradium_closed';
}
