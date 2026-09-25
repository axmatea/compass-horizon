// COMPASS realtime voice bridge: browser <-> this server <-> Boson Higgs Realtime.
//
// Division of labour (COMPASS_MASTER §18 proposal, approved scope):
//   Boson  : mic audio in, VAD / turn taking, barge-in, natural speech out.
//   COMPASS: every user utterance goes through runtime.runTurn (Nebius GLM-5.3):
//            mutable intent, invalidation, re-planning, tools. Boson never answers on its own.
//
// Mechanism (validated live against Boson 2026-09-18): tool_choice "auto" + instructions
// make Boson's automatic end-of-turn response a compass_turn call carrying the user's
// words. We run the COMPASS turn, return {say} as function_call_output and send
// response.create; Higgs speaks it. Later results (tool finished) are spoken via a
// synthetic function_call + function_call_output pair (speakEvents). If Boson ever
// answers with its own audio instead of calling the tool, that audio is dropped and
// the input transcript is sent to COMPASS instead.
//
// Browser protocol (WebSocket /api/voice/realtime):
//   client -> server  binary: PCM16 LE mono 24 kHz mic audio
//                     {type:'hello', sessionId?} {type:'text', text} {type:'played', itemId, ms} {type:'bye'}
//   server -> client  {type:'ready', sessionId, provider, voice, sampleRate}
//                     {type:'status', status}   LISTENING|SPEECH_DETECTED|THINKING|ACTING|SPEAKING|INTERRUPTED|REPLANNING
//                     {type:'compass', event}   v1 runtime events (state_patch, action_invalidated, tool_call, ...)
//                     {type:'transcript', role, text, final}
//                     {type:'audio.start', itemId, responseId} + binary PCM16 frames + {type:'audio.end', itemId}
//                     {type:'audio.flush', itemId}  stop playback NOW (barge-in)
//                     {type:'metrics', ...} {type:'error', code, message}
import { randomUUID } from 'node:crypto';
import { buildSessionConfig, speakEvents, describeCloseCode } from './boson-realtime.mjs';
import { detectLang, t as tr } from '../i18n/lang.mjs';

export const STATUS = Object.freeze({
  LISTENING: 'LISTENING', SPEECH_DETECTED: 'SPEECH_DETECTED', THINKING: 'THINKING', ACTING: 'ACTING',
  SPEAKING: 'SPEAKING', INTERRUPTED: 'INTERRUPTED', REPLANNING: 'REPLANNING',
});

export function createRealtimeBridge({ client, runtime, connectUpstream, voice = 'default', turnDetection = 'semantic_vad', sessionId, now = () => performance.now(), logger = console, fragmentRecoverMs = 2500 }) {
  // client: { sendJson(obj), sendBinary(buf), close(code, reason) }
  const known = sessionId && runtime.getSession(sessionId);
  const session = known || runtime.createSession();
  const sessionReset = Boolean(sessionId) && !known;
  const sid = session.id;
  let upstream = null;
  let closed = false;
  let status = null;
  let turnSeq = 0;
  const responses = new Map(); // responseId -> { kind, turnSeq, itemId, firstAudioAt, audioItems:Set }
  let active = null;           // response currently streaming/in progress
  const speakQueue = [];       // [{ text, turnSeq, reason }]
  const transcripts = new Map(); // user itemId -> text
  const pendingTranscriptTurns = new Map(); // itemId -> resolve (guard path)
  // R4: every user speech segment must become a COMPASS turn. Boson occasionally emits no
  // transcription / no compass_turn for a fragment that overlaps a response; recover it.
  const segments = new Map(); // user itemId -> { handled, recovered, timer }
  function markHandled(itemId) { const sg = itemId && segments.get(itemId); if (sg) { sg.handled = true; clearTimeout(sg.timer); } }
  function recoverSegment(itemId, text, via = 'transcript') {
    const sg = segments.get(itemId);
    if (!sg || sg.handled || !text) return;
    sg.recovered = true;
    markHandled(itemId);
    client.sendJson({ type: 'compass', event: { type: 'reasoning_status', stage: 'fragment_recovered', itemId, text, via } });
    runCompassTurn(text, { userItemId: itemId }).catch((err) => fail('turn_failed', err));
  }
  // Mic audio as appended to Boson (PCM16 24 kHz), last ~30 s, so a lost fragment can be re-heard.
  const MS_BYTES = 48; // 24000 Hz * 2 bytes / 1000
  let micChunks = []; let micStartMs = 0; let micTotalMs = 0;
  function keepMic(buf) {
    micChunks.push(buf); micTotalMs += buf.length / MS_BYTES;
    while (micChunks.length > 1 && micTotalMs - micStartMs - micChunks[0].length / MS_BYTES > 30_000) micStartMs += micChunks.shift().length / MS_BYTES;
  }
  function micSlice(fromMs, toMs) {
    const all = Buffer.concat(micChunks);
    const a = Math.max(0, Math.floor((fromMs - micStartMs) * MS_BYTES / 2) * 2);
    const b = Math.min(all.length, Math.ceil((toMs - micStartMs) * MS_BYTES / 2) * 2);
    return b > a ? all.subarray(a, b) : null;
  }
  let lastLang = 'en';

  /** Re-hear a fragment on a short-lived second Boson session (verified contract: VAD + transcription + compass_turn). */
  async function reHear(pcm) {
    const side = await connectUpstream();
    try {
      return await new Promise((resolve) => {
        const done = (text) => { clearTimeout(timer); resolve(String(text || '').trim()); };
        const timer = setTimeout(() => done(''), 5000);
        side.on('conversation.item.input_audio_transcription.completed', (e) => done(e.transcript));
        side.on('response.function_call_arguments.done', (e) => { try { done(JSON.parse(e.arguments || '{}').utterance); } catch { /* keep waiting */ } });
        side.send({ type: 'session.update', session: buildSessionConfig({ voice, turnDetection: 'server_vad' }) });
        const padded = Buffer.concat([pcm, Buffer.alloc(24000 * 2)]); // 1 s trailing silence closes the turn
        for (let i = 0; i < padded.length; i += 256 * 1024) side.send({ type: 'input_audio_buffer.append', audio: padded.subarray(i, i + 256 * 1024).toString('base64') });
      });
    } finally { side.close?.(1000, 'rehear done'); }
  }

  function watchSegment(itemId) {
    const sg = itemId && segments.get(itemId);
    if (!sg || sg.handled) return;
    clearTimeout(sg.timer);
    sg.timer = setTimeout(async () => {
      if (sg.handled || closed) return;
      const known = transcripts.get(itemId);
      if (known) return recoverSegment(itemId, known);
      const pcm = sg.startMs != null && sg.endMs != null ? micSlice(sg.startMs - 200, sg.endMs + 200) : null;
      let text = '';
      if (pcm && pcm.length > MS_BYTES * 200) {
        try { text = await reHear(pcm); } catch (err) { logger.error?.('[voice] rehear failed', String(err?.message || err).slice(0, 120)); }
      }
      if (sg.handled || closed) return;
      if (text) return recoverSegment(itemId, text, 'rehear');
      // Never silently lose speech: say so.
      sg.handled = true;
      awaitingTurn = false;
      const durMs = sg.startMs != null && sg.endMs != null ? sg.endMs - sg.startMs : null;
      client.sendJson({ type: 'compass', event: { type: 'reasoning_status', stage: 'fragment_lost', itemId, durMs } });
      // Coughs / noise bursts are not worth an apology; real speech is.
      if (durMs == null || durMs >= 600) requestSpeech(tr(lastLang).fallback, { turnSeq, reason: 'fragment_lost' });
      else idleStatus();
    }, fragmentRecoverMs);
  }
  const m = {};                // current latency marks
  let speaking = false;        // upstream is generating audio for the active response
  // Playback tracking: Boson generates audio faster than real time, so "COMPASS is speaking"
  // must follow what the browser is still playing, not what Boson is still generating.
  const playback = new Map();  // itemId -> { startAt, durMs, truncated }
  let playingItem = null;
  let playbackTimer = null;
  let userSpeaking = false;    // between speech_started and speech_stopped
  let awaitingTurn = false;    // speech ended, waiting for Boson's compass_turn call
  let interpreting = 0;        // COMPASS turns before their ack is ready

  const setStatus = (s) => { if (s !== status) { status = s; client.sendJson({ type: 'status', status: s, at: Date.now() }); } };
  const sendUp = (ev) => upstream?.send(ev);
  const config = () => buildSessionConfig({ voice, turnDetection });

  // Mirror COMPASS runtime events to the browser and map them to orb states.
  const unsubscribe = runtime.subscribe(sid, (ev) => {
    client.sendJson({ type: 'compass', event: ev });
    if (ev.type === 'reasoning_status' && ev.stage === 'interpreting') setStatus(STATUS.THINKING);
    else if (ev.type === 'action_invalidated') setStatus(STATUS.REPLANNING);
    else if (ev.type === 'tool_call' && !speaking) setStatus(STATUS.ACTING);
    else if (ev.type === 'state_patch') { m.patchAt = now(); }
  });

  const isPlaying = () => {
    const p = playingItem && playback.get(playingItem);
    return Boolean(p && !p.truncated && now() < p.startAt + p.durMs);
  };
  function schedulePlaybackEnd() {
    clearTimeout(playbackTimer);
    const p = playingItem && playback.get(playingItem);
    if (!p) return;
    const ms = Math.max(0, p.startAt + p.durMs - now()) + 30;
    playbackTimer = setTimeout(() => { if (!isPlaying()) { playingItem = null; idleStatus(); pumpSpeech(); } }, ms);
    playbackTimer.unref?.();
  }

  function idleStatus() {
    if (speaking || active || isPlaying()) return;
    if (userSpeaking) return setStatus(STATUS.SPEECH_DETECTED);
    if (awaitingTurn || interpreting) return setStatus(STATUS.THINKING);
    const acting = runtime.getSession(sid)?.state.actions.some((a) => a.status === 'running');
    setStatus(acting ? STATUS.ACTING : STATUS.LISTENING);
  }

  function metrics(extra) {
    const r = (a, b) => (m[a] != null && m[b] != null ? Math.round(m[b] - m[a]) : null);
    client.sendJson({
      type: 'metrics', turnSeq,
      speechEndToRecognizedMs: r('speechStoppedAt', 'recognizedAt'),
      recognizedToPatchMs: r('recognizedAt', 'patchAt'),
      patchToFirstAudioMs: r('patchAt', 'firstAudioAt'),
      speechEndToFirstAudioMs: r('speechStoppedAt', 'firstAudioAt'),
      speechStartToFirstAudioMs: r('speechStartedAt', 'firstAudioAt'),
      interruptToFlushMs: r('interruptAt', 'flushAt'),
      interruptToResumedAudioMs: r('interruptAt', 'firstAudioAt'),
      ...extra,
    });
  }

  // ---------- speaking ----------
  let lastSpokenTurnId = null;
  function requestSpeech(text, meta) {
    if (!text) return;
    speakQueue.push({ text, ...meta });
    pumpSpeech();
  }
  function isStale(item) {
    if (!item.turnId) return false;
    const acts = runtime.getSession(sid)?.state.actions.filter((a) => a.turnId === item.turnId) || [];
    return acts.length > 0 && acts.every((a) => a.status === 'invalidated');
  }
  function pumpSpeech() {
    // Hold while the user is talking or a new turn is being understood: its result may supersede ours.
    if (active || !upstream || !speakQueue.length || userSpeaking || awaitingTurn || interpreting) return;
    while (speakQueue.length && isStale(speakQueue[0])) {
      const dropped = speakQueue.shift();
      client.sendJson({ type: 'compass', event: { type: 'reasoning_status', stage: 'speech_dropped_stale', turnId: dropped.turnId, text: dropped.text } });
      client.sendJson({ type: 'response.stale', itemId: null, turnId: dropped.turnId || null, reason: 'superseded_before_speaking' });
    }
    if (!speakQueue.length) return idleStatus();
    const next = speakQueue.shift();
    active = { pending: true, kind: 'speak', turnSeq: next.turnSeq, turnId: next.turnId || null };
    lastSpokenTurnId = next.turnId || lastSpokenTurnId;
    for (const ev of speakEvents(next.text, { metadata: { compass: 'speak', turnSeq: String(next.turnSeq) } })) sendUp(ev);
  }

  // ---------- COMPASS turn ----------
  async function runCompassTurn(utterance, { callId, userItemId } = {}) {
    markHandled(userItemId);
    lastLang = detectLang(utterance);
    const seq = ++turnSeq;
    m.recognizedAt = now();
    awaitingTurn = false;
    interpreting++;
    let released = false;
    const release = () => { if (!released) { released = true; interpreting--; } };
    client.sendJson({ type: 'transcript', role: 'user', text: utterance, final: true, itemId: userItemId ?? null });
    // Resolve as soon as COMPASS has a first thing to say (ack right after the state patch).
    const turnId = `t_${randomUUID().slice(0, 8)}`;
    let ackResolve;
    const ack = new Promise((r) => { ackResolve = r; });
    const off = runtime.subscribe(sid, (ev) => {
      if (ev.turnId !== turnId) return; // ignore other concurrent turns
      if (ev.type === 'say') ackResolve({ text: ev.text, final: Boolean(ev.final) });
      if (ev.type === 'done') ackResolve({ text: '', final: true });
    });
    const turnPromise = runtime.runTurn(sid, utterance, { turnId });
    let first;
    try {
      first = await Promise.race([ack, turnPromise.then((r) => ({ text: r.reply || '', final: true, result: r }))]);
    } finally { off(); release(); }
    if (closed) return;
    const state = runtime.getSession(sid)?.state;
    const output = JSON.stringify({ say: first.text || '', intent: state?.intent ?? null });
    if (callId) {
      sendUp({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
      if (first.text) {
        active = { pending: true, kind: 'ack', turnSeq: seq };
        sendUp({ type: 'response.create', response: { metadata: { compass: 'ack', turnSeq: String(seq) } } });
      }
    } else if (first.text) {
      requestSpeech(first.text, { turnSeq: seq, turnId, reason: 'ack' });
    }
    pumpSpeech();
    if (first.final) { idleStatus(); return; }
    const result = await turnPromise;
    if (closed || result.superseded || !result.reply || result.reply === first.text) { idleStatus(); return; }
    requestSpeech(result.reply, { turnSeq: seq, turnId, reason: 'final' });
  }

  // ---------- barge-in ----------
  function interrupt(reason) {
    const playing = isPlaying();
    const wasSpeaking = playing || speaking || Boolean(active && !active.pending && active.kind !== 'turn');
    if (wasSpeaking) {
      // Kept until the next COMPASS audio starts, so VAD-split follow-up speech does not erase it.
      m.interruptAt = now();
      m.flushAt = null;
      const itemId = playingItem || active?.itemId || null;
      client.sendJson({ type: 'audio.flush', itemId, reason });
      m.flushAt = now();
      // Explicit marker: everything COMPASS was saying is stale; UI drops captions/partial reply.
      client.sendJson({ type: 'response.stale', itemId, turnId: active?.turnId ?? lastSpokenTurnId ?? null, reason });
      // Truncate what the user actually heard (server estimate; the client may refine via 'played').
      const p = itemId && playback.get(itemId);
      if (p && !p.truncated) {
        p.truncated = true;
        sendUp({ type: 'conversation.item.truncate', item_id: itemId, content_index: 0, audio_end_ms: Math.max(0, Math.min(Math.round(now() - p.startAt), Math.round(p.durMs))) });
      }
      for (const q of playback.values()) q.truncated = true;
      playingItem = null;
      clearTimeout(playbackTimer);
    }
    if (active && !active.pending && active.id) sendUp({ type: 'response.cancel', response_id: active.id });
    if (active) active.cancelled = true;
    for (const rec of responses.values()) if (rec.kind !== 'turn') rec.cancelled = true;
    speakQueue.length = 0;
    speaking = false;
    setStatus(wasSpeaking ? STATUS.INTERRUPTED : STATUS.SPEECH_DETECTED);
  }

  // ---------- upstream events ----------
  function wireUpstream(up) {
    up.on('session.created', () => client.sendJson({ type: 'ready', sessionId: sid, provider: 'boson', voice, sampleRate: 24000, ...(sessionReset ? { sessionReset: true } : {}) }));
    up.on('input_audio_buffer.speech_started', (e) => {
      m.speechStartedAt = now(); m.firstAudioAt = null; userSpeaking = true; interrupt('speech_started');
      if (e.item_id) {
        m.userItemId = e.item_id;
        if (!segments.has(e.item_id)) segments.set(e.item_id, { handled: false, recovered: false, timer: null, startMs: e.audio_start_ms ?? null, endMs: null });
        while (segments.size > 64) segments.delete(segments.keys().next().value);
      }
    });
    up.on('input_audio_buffer.speech_stopped', (e) => {
      m.speechStoppedAt = now(); userSpeaking = false; awaitingTurn = true; setStatus(STATUS.THINKING);
      const segId = segments.has(e.item_id) ? e.item_id : m.userItemId;
      const sg = segments.get(segId);
      if (sg && e.audio_end_ms != null) sg.endMs = e.audio_end_ms;
      watchSegment(segId);
    });
    up.on('conversation.item.input_audio_transcription.completed', (e) => {
      transcripts.set(e.item_id, e.transcript || '');
      client.sendJson({ type: 'transcript', role: 'user', text: e.transcript || '', final: true, itemId: e.item_id, source: 'higgs-stt' });
      pendingTranscriptTurns.get(e.item_id)?.(e.transcript || '');
    });
    up.on('response.created', (e) => {
      const meta = e.response?.metadata || null;
      const kind = meta?.compass || 'turn';
      const rec = { id: e.response?.id, kind, turnSeq: Number(meta?.turnSeq) || turnSeq };
      responses.set(rec.id, rec);
      if (active?.pending && kind !== 'turn') {
        Object.assign(active, rec, { pending: false });
        if (active.cancelled) { rec.cancelled = true; sendUp({ type: 'response.cancel', response_id: rec.id }); }
      } else if (kind === 'turn') { active = { ...rec, pending: false }; }
    });
    up.on('response.function_call_arguments.done', (e) => {
      if (e.name !== 'compass_turn') return;
      let utterance = '';
      try { utterance = String(JSON.parse(e.arguments || '{}').utterance || '').trim(); } catch { /* bad args */ }
      if (segments.get(m.userItemId)?.recovered) { sendUp({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: e.call_id, output: '{"say":""}' } }); return; }
      if (!utterance && m.userItemId) utterance = transcripts.get(m.userItemId) || '';
      if (!utterance) { sendUp({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: e.call_id, output: '{"say":""}' } }); return; }
      runCompassTurn(utterance, { callId: e.call_id, userItemId: m.userItemId }).catch((err) => fail('turn_failed', err));
    });
    up.on('response.output_audio.delta', (e) => {
      const rec = responses.get(e.response_id);
      if (!rec || rec.cancelled || active?.cancelled) return;
      if (rec.kind === 'turn') {
        // Guard: Boson tried to answer by itself. Drop its audio; COMPASS answers instead.
        if (!rec.guarded) {
          rec.guarded = true;
          sendUp({ type: 'response.cancel', response_id: e.response_id });
          const itemId = m.userItemId;
          const t = transcripts.get(itemId);
          const go = (text) => text && runCompassTurn(text, { userItemId: itemId }).catch((err) => fail('turn_failed', err));
          if (t) go(t); else pendingTranscriptTurns.set(itemId, (text) => { pendingTranscriptTurns.delete(itemId); go(text); });
          client.sendJson({ type: 'error', code: 'boson_self_answer_blocked', message: 'Voice model answered without COMPASS; routed through COMPASS instead.' });
        }
        return;
      }
      if (!rec.itemId) {
        rec.itemId = e.item_id;
        if (active && active.id === rec.id) active.itemId = e.item_id;
        client.sendJson({ type: 'audio.start', itemId: e.item_id, responseId: e.response_id });
        // Queued after anything still playing (the browser plays items back to back).
        const prev = playingItem && playback.get(playingItem);
        const startAt = prev && isPlaying() ? prev.startAt + prev.durMs : now();
        playback.set(e.item_id, { startAt, durMs: 0, truncated: false });
        playingItem = e.item_id;
      }
      if (!speaking) { speaking = true; m.firstAudioAt = now(); setStatus(STATUS.SPEAKING); metrics({ kind: rec.kind }); m.interruptAt = null; m.flushAt = null; }
      const buf = Buffer.from(e.delta, 'base64');
      const p = playback.get(e.item_id);
      if (p) { p.durMs += (buf.length / 2 / 24000) * 1000; schedulePlaybackEnd(); }
      client.sendBinary(buf);
    });
    up.on('response.output_audio_transcript.done', (e) => {
      const rec = responses.get(e.response_id);
      if (rec && rec.kind !== 'turn' && !rec.cancelled) client.sendJson({ type: 'transcript', role: 'assistant', text: e.transcript, final: true, itemId: e.item_id });
    });
    up.on('response.done', (e) => {
      const rec = responses.get(e.response?.id);
      if (rec?.itemId) client.sendJson({ type: 'audio.end', itemId: rec.itemId, status: e.response?.status });
      if (rec?.kind === 'turn' && !(e.response?.output || []).some((o) => o.type === 'function_call')) awaitingTurn = false;
      const wasActive = active && active.id === e.response?.id;
      if (wasActive) { active = null; speaking = false; }
      responses.delete(e.response?.id);
      if (!wasActive && active) return; // another response is still in flight
      if (speakQueue.length) pumpSpeech(); else idleStatus();
    });
    up.on('error', (e) => {
      const err = e.error || {};
      if (err.code === 'response_not_active' || err.code === 'response_id_mismatch') return; // benign cancel race
      client.sendJson({ type: 'error', code: `boson_${err.type || 'error'}`, message: String(err.message || '').slice(0, 200) });
    });
    up.on('__close', ({ code }) => { if (!closed) { client.sendJson({ type: 'error', code: describeCloseCode(code), message: `Voice provider closed (${code})` }); shutdown(4502, describeCloseCode(code)); } });
  }

  function fail(code, err) {
    logger.error?.('[voice]', code, String(err?.message || err).slice(0, 200));
    client.sendJson({ type: 'error', code, message: 'Voice turn failed' });
    idleStatus();
  }

  function shutdown(code = 1000, reason = '') {
    if (closed) return;
    closed = true;
    clearTimeout(playbackTimer);
    for (const sg of segments.values()) clearTimeout(sg.timer);
    unsubscribe();
    upstream?.close(1000, 'client gone');
    client.close(code, reason);
  }

  return {
    sessionId: sid,
    async start() {
      upstream = await connectUpstream();
      wireUpstream(upstream);
      sendUp({ type: 'session.update', session: config() });
      setStatus(STATUS.LISTENING);
    },
    onClientAudio(buf) {
      if (!upstream || closed || !buf?.length) return;
      // ~1 MiB base64 cap per append; browser chunks are ~40 ms (1920 bytes).
      keepMic(buf);
      for (let i = 0; i < buf.length; i += 256 * 1024) sendUp({ type: 'input_audio_buffer.append', audio: buf.subarray(i, i + 256 * 1024).toString('base64') });
    },
    onClientJson(msg) {
      if (msg.type === 'played' && msg.itemId && Number.isFinite(msg.ms)) {
        // Client-measured position is authoritative; re-truncate to it.
        sendUp({ type: 'conversation.item.truncate', item_id: msg.itemId, content_index: 0, audio_end_ms: Math.max(0, Math.round(msg.ms)) });
      } else if (msg.type === 'playback' && msg.state === 'ended' && msg.itemId) {
        const p = playback.get(msg.itemId);
        if (p) p.durMs = Math.min(p.durMs, Math.max(0, now() - p.startAt));
        if (playingItem === msg.itemId) { playingItem = null; clearTimeout(playbackTimer); idleStatus(); pumpSpeech(); }
      } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
        if (speaking || active) interrupt('text');
        m.speechStoppedAt = now();
        runCompassTurn(msg.text.trim().slice(0, 500)).catch((err) => fail('turn_failed', err));
      } else if (msg.type === 'bye') shutdown(1000, 'bye');
    },
    close: shutdown,
    get status() { return status; },
  };
}
