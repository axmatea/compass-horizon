// COMPASS realtime voice bridge on Gradium: browser <-> this server <-> Gradium STT + TTS.
//
// Division of labour:
//   Gradium STT : mic audio in, words out, semantic VAD (step.vad) -> end of turn -> flush.
//   COMPASS     : every utterance goes through runtime.runTurn (LLM on General Compute / Nebius):
//                 mutable intent, invalidation, re-planning, tools, rendering.
//   Gradium TTS : one socket per spoken reply (there is no cancel message; barge-in closes it).
//
// Same browser protocol as the Boson bridge (server/voice/realtime-bridge.mjs), so the browser client
// and the UI do not change:
//   client -> server  binary PCM16 LE mono 24 kHz; {type:'text', text} {type:'played'} {type:'playback'} {type:'bye'}
//   server -> client  {type:'ready', sessionId, provider:'gradium', voice, sampleRate}
//                     {type:'status', status} {type:'compass', event} {type:'transcript', role, text, final, source}
//                     {type:'audio.start', itemId} + binary PCM16 + {type:'audio.end', itemId} {type:'audio.flush'} {type:'response.stale'}
//                     {type:'metrics', ...} {type:'error', code, message}
import { randomUUID } from 'node:crypto';
import { sttSetup, ttsSetup, describeGradiumClose, STT_CHUNK_BYTES } from './gradium.mjs';
import { detectLang, t as tr } from '../i18n/lang.mjs';

export const STATUS = Object.freeze({
  LISTENING: 'LISTENING', SPEECH_DETECTED: 'SPEECH_DETECTED', THINKING: 'THINKING', ACTING: 'ACTING',
  SPEAKING: 'SPEAKING', INTERRUPTED: 'INTERRUPTED', REPLANNING: 'REPLANNING',
});
const MS_BYTES = 48; // 24 kHz * 2 bytes / 1000

export function createGradiumBridge({ client, runtime, connect, sessionId, voiceId, voiceName = 'gradium', language = 'en', turnHorizonS = 3, turnThreshold = 0.5, turnCooldownFrames = 8, minTurnMs = 250, sttReconnectMs = 280_000, now = () => performance.now(), logger = console }) {
  // connect(path) -> upstream { send, close, on, open }
  const known = sessionId && runtime.getSession(sessionId);
  const session = known || runtime.createSession();
  const sessionReset = Boolean(sessionId) && !known;
  const sid = session.id;
  let stt = null;
  let closed = false;
  let status = null;
  let turnSeq = 0;
  let interpreting = 0;
  let userSpeaking = false;
  let awaitingTurn = false;
  let lastLang = 'en';
  const m = {};
  // utterance being spoken: words since the last flush
  let words = [];
  let flushSeq = 0;
  let pendingFlush = null; // flush_id we wait a `flushed` for
  // Turn phases as in the Pipecat Gradium STT reference: IDLE -(inactive step)-> ARMED -(active step or text)-> OPEN -(inactive step)-> ENDING -(flushed)-> IDLE.
  let phase = 'IDLE';
  let cooldown = 0;
  let utteranceStartedAt = null;
  let sttReady = false;
  let sttTimer = null;
  let sttBuf = [];
  let sttBufBytes = 0;

  // speaking
  const speakQueue = [];
  let active = null;         // { id, socket, itemId, startAt, durMs, turnId, turnSeq, cancelled }
  let playingItem = null;
  const playback = new Map();
  let playbackTimer = null;

  const setStatus = (s) => { if (s !== status) { status = s; client.sendJson({ type: 'status', status: s, at: Date.now() }); } };

  const unsubscribe = runtime.subscribe(sid, (ev) => {
    client.sendJson({ type: 'compass', event: ev });
    if (ev.type === 'reasoning_status' && ev.stage === 'interpreting') setStatus(STATUS.THINKING);
    else if (ev.type === 'action_invalidated') setStatus(STATUS.REPLANNING);
    else if (ev.type === 'tool_call' && !active) setStatus(STATUS.ACTING);
    else if (ev.type === 'state_patch') m.patchAt = now();
  });

  const isPlaying = () => { const p = playingItem && playback.get(playingItem); return Boolean(p && !p.truncated && now() < p.startAt + p.durMs); };
  function schedulePlaybackEnd() {
    clearTimeout(playbackTimer);
    const p = playingItem && playback.get(playingItem);
    if (!p) return;
    playbackTimer = setTimeout(() => { if (!isPlaying()) { playingItem = null; idleStatus(); pumpSpeech(); } }, Math.max(0, p.startAt + p.durMs - now()) + 30);
    playbackTimer.unref?.();
  }
  function idleStatus() {
    if (active || isPlaying()) return;
    if (userSpeaking) return setStatus(STATUS.SPEECH_DETECTED);
    if (awaitingTurn || interpreting) return setStatus(STATUS.THINKING);
    const acting = runtime.getSession(sid)?.state.actions.some((a) => a.status === 'running');
    setStatus(acting ? STATUS.ACTING : STATUS.LISTENING);
  }
  function metrics(extra) {
    const r = (a, b) => (m[a] != null && m[b] != null ? Math.round(m[b] - m[a]) : null);
    client.sendJson({ type: 'metrics', turnSeq, speechEndToRecognizedMs: r('speechStoppedAt', 'recognizedAt'), recognizedToPatchMs: r('recognizedAt', 'patchAt'), patchToFirstAudioMs: r('patchAt', 'firstAudioAt'), speechEndToFirstAudioMs: r('speechStoppedAt', 'firstAudioAt'), interruptToFlushMs: r('interruptAt', 'flushAt'), ...extra });
  }

  // ---------- speaking (Gradium TTS, one socket per reply) ----------
  let lastSpokenTurnId = null;
  function requestSpeech(text, meta) { if (text) { speakQueue.push({ text, ...meta }); pumpSpeech(); } }
  function isStale(item) {
    if (!item.turnId) return false;
    const acts = runtime.getSession(sid)?.state.actions.filter((a) => a.turnId === item.turnId) || [];
    return acts.length > 0 && acts.every((a) => a.status === 'invalidated');
  }
  async function pumpSpeech() {
    if (active || closed || !speakQueue.length || userSpeaking || awaitingTurn || interpreting) return;
    while (speakQueue.length && isStale(speakQueue[0])) {
      const dropped = speakQueue.shift();
      client.sendJson({ type: 'compass', event: { type: 'reasoning_status', stage: 'speech_dropped_stale', turnId: dropped.turnId, text: dropped.text } });
      client.sendJson({ type: 'response.stale', itemId: null, turnId: dropped.turnId || null, reason: 'superseded_before_speaking' });
    }
    if (!speakQueue.length) return idleStatus();
    const next = speakQueue.shift();
    const rec = { id: `tts_${++turnSeq}_${randomUUID().slice(0, 6)}`, itemId: `item_${randomUUID().slice(0, 8)}`, turnId: next.turnId || null, turnSeq: next.turnSeq, cancelled: false, socket: null, started: false };
    active = rec;
    lastSpokenTurnId = rec.turnId || lastSpokenTurnId;
    let up;
    try { up = await connect('/speech/tts'); }
    catch (err) { active = null; client.sendJson({ type: 'error', code: 'gradium_tts_connect_failed', message: 'Voice output unavailable' }); logger.error?.('[gradium] tts connect', String(err?.message || err).slice(0, 120)); idleStatus(); return pumpSpeech(); }
    if (rec.cancelled || closed) { up.close(1000, 'cancelled'); active = null; return pumpSpeech(); }
    rec.socket = up;
    up.on('audio', (e) => {
      if (rec.cancelled || !e.audio) return;
      const buf = Buffer.from(e.audio, 'base64');
      if (!rec.started) {
        rec.started = true;
        client.sendJson({ type: 'audio.start', itemId: rec.itemId, responseId: rec.id });
        const prev = playingItem && playback.get(playingItem);
        const startAt = prev && isPlaying() ? prev.startAt + prev.durMs : now();
        playback.set(rec.itemId, { startAt, durMs: 0, truncated: false });
        playingItem = rec.itemId;
        m.firstAudioAt = now(); setStatus(STATUS.SPEAKING); metrics({ kind: next.reason || 'speak' }); m.interruptAt = null; m.flushAt = null;
      }
      const p = playback.get(rec.itemId);
      if (p) { p.durMs += buf.length / MS_BYTES; schedulePlaybackEnd(); }
      client.sendBinary(buf);
    });
    const finish = () => {
      if (active !== rec) return;
      active = null;
      client.sendJson({ type: 'audio.end', itemId: rec.itemId, status: rec.cancelled ? 'cancelled' : 'completed' });
      if (!rec.cancelled) client.sendJson({ type: 'transcript', role: 'assistant', text: next.text, final: true, itemId: rec.itemId });
      up.close(1000, 'done');
      if (speakQueue.length) pumpSpeech(); else idleStatus();
    };
    up.on('end_of_stream', finish);
    up.on('error', (e) => { client.sendJson({ type: 'error', code: 'gradium_tts_error', message: String(e.message || '').slice(0, 200) }); rec.cancelled = true; finish(); });
    up.on('__close', () => finish());
    up.send(ttsSetup({ voiceId }));
    up.send({ type: 'text', text: next.text });
    up.send({ type: 'end_of_stream' });
  }

  // ---------- barge-in ----------
  function interrupt(reason) {
    const wasSpeaking = isPlaying() || Boolean(active && active.started);
    if (wasSpeaking) {
      m.interruptAt = now(); m.flushAt = null;
      const itemId = playingItem || active?.itemId || null;
      client.sendJson({ type: 'audio.flush', itemId, reason });
      m.flushAt = now();
      client.sendJson({ type: 'response.stale', itemId, turnId: active?.turnId ?? lastSpokenTurnId ?? null, reason });
      for (const q of playback.values()) q.truncated = true;
      playingItem = null;
      clearTimeout(playbackTimer);
    }
    if (active) {
      const rec = active;
      rec.cancelled = true;
      if (rec.socket) { active = null; rec.socket.close(1000, 'barge-in'); } // else: connect pending, dropped when it resolves
    }
    speakQueue.length = 0;
    setStatus(wasSpeaking ? STATUS.INTERRUPTED : STATUS.SPEECH_DETECTED);
  }

  // ---------- COMPASS turn ----------
  async function runCompassTurn(utterance) {
    lastLang = detectLang(utterance);
    const seq = ++turnSeq;
    m.recognizedAt = now();
    awaitingTurn = false;
    interpreting++;
    let released = false;
    const release = () => { if (!released) { released = true; interpreting--; } };
    client.sendJson({ type: 'transcript', role: 'user', text: utterance, final: true, itemId: null });
    const turnId = `t_${randomUUID().slice(0, 8)}`;
    let ackResolve;
    const ack = new Promise((r) => { ackResolve = r; });
    const off = runtime.subscribe(sid, (ev) => {
      if (ev.turnId !== turnId) return;
      if (ev.type === 'say') ackResolve({ text: ev.text, final: Boolean(ev.final) });
      if (ev.type === 'done') ackResolve({ text: '', final: true });
    });
    const turnPromise = runtime.runTurn(sid, utterance, { turnId });
    let first;
    try { first = await Promise.race([ack, turnPromise.then((r) => ({ text: r.reply || '', final: true }))]); }
    finally { off(); release(); }
    if (closed) return;
    if (first.text) requestSpeech(first.text, { turnSeq: seq, turnId, reason: 'ack' });
    else pumpSpeech();
    if (first.final) { idleStatus(); return; }
    const result = await turnPromise;
    if (closed || result.superseded || !result.reply || result.reply === first.text) { idleStatus(); return; }
    requestSpeech(result.reply, { turnSeq: seq, turnId, reason: 'final' });
  }

  // ---------- STT ----------
  function onWords(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (!words.length) { utteranceStartedAt = now(); m.speechStartedAt = utteranceStartedAt; m.firstAudioAt = null; }
    if (phase === 'ENDING') { /* tail tokens of the closing turn */ words.push(clean); return; }
    if (phase !== 'OPEN') openTurn();
    userSpeaking = true;
    words.push(clean);
    client.sendJson({ type: 'transcript', role: 'user', text: words.join(' '), final: false, source: 'gradium-stt' });
  }
  function openTurn() {
    phase = 'OPEN';
    if (!utteranceStartedAt || !words.length) utteranceStartedAt = now();
    userSpeaking = true;
    if (isPlaying() || (active && active.started)) interrupt('speech_started'); else setStatus(STATUS.SPEECH_DETECTED);
  }
  function onStep(e) {
    const vad = Array.isArray(e.vad) ? e.vad : [];
    if (!vad.length) return;
    if (cooldown > 0) { cooldown--; return; }
    const pick = vad.reduce((best, v) => (best == null || Math.abs(v.horizon_s - turnHorizonS) < Math.abs(best.horizon_s - turnHorizonS) ? v : best), null);
    if (!pick || pick.inactivity_prob == null) return;
    const inactive = pick.inactivity_prob >= turnThreshold;
    if (phase === 'IDLE' && inactive) phase = 'ARMED';
    else if (phase === 'ARMED' && !inactive) openTurn();
    else if (phase === 'OPEN' && inactive && now() - utteranceStartedAt >= minTurnMs) endTurn();
    // ENDING ignores the signal until `flushed`.
  }
  function endTurn() {
    if (pendingFlush != null) return;
    phase = 'ENDING';
    if (!words.length) { phase = 'IDLE'; userSpeaking = false; return idleStatus(); }
    pendingFlush = ++flushSeq;
    m.speechStoppedAt = now();
    userSpeaking = false; awaitingTurn = true; setStatus(STATUS.THINKING);
    stt?.send({ type: 'flush', flush_id: String(pendingFlush) });
    // Never wait forever for `flushed`.
    setTimeout(() => { if (pendingFlush === flushSeq) finalizeTurn(); }, 1500).unref?.();
  }
  function finalizeTurn() {
    pendingFlush = null;
    phase = 'IDLE';
    cooldown = turnCooldownFrames;
    const text = words.join(' ').replace(/\s+/g, ' ').trim();
    words = []; utteranceStartedAt = null;
    if (!text) { awaitingTurn = false; return idleStatus(); }
    runCompassTurn(text).catch((err) => { logger.error?.('[gradium] turn', String(err?.message || err).slice(0, 200)); client.sendJson({ type: 'error', code: 'turn_failed', message: 'Voice turn failed' }); awaitingTurn = false; idleStatus(); });
  }

  async function openStt(initial) {
    const up = await connect('/speech/asr');
    if (closed) { up.close(1000, 'client gone'); return; }
    stt = up; sttReady = false;
    up.on('ready', () => {
      sttReady = true;
      if (initial) { client.sendJson({ type: 'ready', sessionId: sid, provider: 'gradium', voice: voiceName, sampleRate: 24000, ...(sessionReset ? { sessionReset: true } : {}) }); setStatus(STATUS.LISTENING); }
      flushSttBuffer();
    });
    up.on('text', (e) => onWords(e.text));
    up.on('step', onStep);
    up.on('flushed', (e) => { if (pendingFlush != null && (e.flush_id == null || String(e.flush_id) === String(pendingFlush))) setTimeout(finalizeTurn, 100).unref?.(); });
    up.on('error', (e) => client.sendJson({ type: 'error', code: 'gradium_stt_error', message: String(e.message || '').slice(0, 200) }));
    up.on('__close', ({ code }) => {
      if (closed || stt !== up) return;
      stt = null; sttReady = false;
      if (words.length) { pendingFlush = null; finalizeTurn(); }
      // Sessions are time-limited upstream: reconnect quietly while the browser is still here.
      openStt(false).catch((err) => { client.sendJson({ type: 'error', code: describeGradiumClose(code), message: `Voice input closed (${code})` }); shutdown(4502, describeGradiumClose(code)); logger.error?.('[gradium] stt reconnect failed', String(err?.message || err).slice(0, 120)); });
    });
    up.send(sttSetup({ language }));
    clearTimeout(sttTimer);
    sttTimer = setTimeout(() => { if (!closed && stt === up && !words.length) { const old = up; stt = null; openStt(false).then(() => old.close(1000, 'rotate')).catch(() => { stt = old; }); } }, sttReconnectMs);
    sttTimer.unref?.();
  }
  function flushSttBuffer() {
    if (!stt || !sttReady) return;
    while (sttBufBytes >= STT_CHUNK_BYTES) {
      const all = Buffer.concat(sttBuf); sttBuf = [all.subarray(STT_CHUNK_BYTES)]; sttBufBytes = sttBuf[0].length;
      stt.send({ type: 'audio', audio: all.subarray(0, STT_CHUNK_BYTES).toString('base64') });
    }
  }

  function shutdown(code = 1000, reason = '') {
    if (closed) return;
    closed = true;
    clearTimeout(playbackTimer); clearTimeout(sttTimer);
    unsubscribe();
    if (active) { active.cancelled = true; active.socket?.close(1000, 'client gone'); active = null; }
    stt?.send({ type: 'end_of_stream' });
    stt?.close(1000, 'client gone');
    client.close(code, reason);
  }

  return {
    sessionId: sid,
    async start() { await openStt(true); },
    onClientAudio(buf) {
      if (closed || !buf?.length) return;
      sttBuf.push(buf); sttBufBytes += buf.length;
      if (sttBufBytes > 24000 * 2 * 30) { sttBuf = [Buffer.concat(sttBuf).subarray(-STT_CHUNK_BYTES * 4)]; sttBufBytes = sttBuf[0].length; } // never hoard audio
      flushSttBuffer();
    },
    onClientJson(msg) {
      if (msg.type === 'playback' && msg.state === 'ended' && msg.itemId) {
        const p = playback.get(msg.itemId);
        if (p) p.durMs = Math.min(p.durMs, Math.max(0, now() - p.startAt));
        if (playingItem === msg.itemId) { playingItem = null; clearTimeout(playbackTimer); idleStatus(); pumpSpeech(); }
      } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
        if (isPlaying() || active) interrupt('text');
        m.speechStoppedAt = now();
        words = []; pendingFlush = null; phase = 'IDLE';
        runCompassTurn(msg.text.trim().slice(0, 500)).catch((err) => { logger.error?.('[gradium] turn', String(err?.message || err).slice(0, 200)); client.sendJson({ type: 'error', code: 'turn_failed', message: 'Voice turn failed' }); idleStatus(); });
      } else if (msg.type === 'bye') shutdown(1000, 'bye');
    },
    close: shutdown,
    get status() { return status; },
    /** For tests: force end of turn as the VAD would. */
    _endTurn: endTurn,
  };
}
