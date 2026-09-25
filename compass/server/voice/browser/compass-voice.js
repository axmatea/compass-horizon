// COMPASS voice client (no UI). Primary: Boson Higgs Realtime via /api/voice/realtime.
// Fallback: browser Web Speech (SpeechRecognition + speechSynthesis) via POST /api/turn.
//
//   import { createCompassVoice } from '/api/voice/client.js';
//   const voice = createCompassVoice({ onStatus, onEvent, onTranscript, onMetrics, onError, onMode });
//   await voice.start();            // call from a user gesture (mic permission + audio unlock)
//   voice.sendText('make it 8');    // optional typed turn, same pipeline
//   voice.stop();
//
// onStatus(status): LISTENING | SPEECH_DETECTED | THINKING | ACTING | SPEAKING | INTERRUPTED | REPLANNING | IDLE
// onEvent(event):   COMPASS v1 runtime events (state_patch has event.intent + event.patch)
// onMode(mode):     'boson' | 'browser'
export function createCompassVoice(opts = {}) {
  const {
    base = location.origin,
    onStatus = () => {}, onEvent = () => {}, onTranscript = () => {}, onMetrics = () => {}, onError = () => {}, onMode = () => {},
    // 'headphones': full-duplex barge-in. 'speakers': while COMPASS plays, only loud mic frames pass (echo guard).
    output = 'speakers', echoGateRms = 0.045, connectTimeoutMs = 8000,
    // 'dinner' (default, /api/turn) or 'site' (website brief, /api/site/turn). Same events, same voice.
    domain = 'dinner',
  } = opts;
  const turnUrl = `${base}/api/${domain === 'site' ? 'site/' : ''}turn`;
  let mode = null, provider = null, sessionId = opts.sessionId || null, ws = null, ctx = null, mic = null, player = null, stream = null;
  let playing = false, currentItem = null, lastStatus = null, markAt = null, flushRequestedAt = null;
  const items = new Map(); // itemId -> { start (samples enqueued before), len }
  let enqueued = 0; let preRoll = [];
  const status = (s) => { if (s !== lastStatus) { lastStatus = s; if (['INTERRUPTED', 'SPEECH_DETECTED'].includes(s)) markAt = performance.now(); onStatus(s); } };
  const wsUrl = () => { const q = new URLSearchParams(); if (sessionId) q.set('sessionId', sessionId); if (domain !== 'dinner') q.set('domain', domain); const qs = q.toString(); return `${base.replace(/^http/, 'ws')}/api/voice/realtime${qs ? `?${qs}` : ''}`; };

  async function setupAudio() {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(`${base}/api/voice/pcm-worklet.js`);
    await ctx.resume();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const src = ctx.createMediaStreamSource(stream);
    mic = new AudioWorkletNode(ctx, 'compass-mic');
    src.connect(mic);
    const sink = ctx.createGain(); sink.gain.value = 0; mic.connect(sink); sink.connect(ctx.destination); // keep mic node pulled
    player = new AudioWorkletNode(ctx, 'compass-player', { outputChannelCount: [1] });
    player.connect(ctx.destination);
    player.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'started') { playing = true; if (markAt != null) { onMetrics({ source: 'client', firstAudibleAfterSpeechMs: Math.round(performance.now() - markAt) }); markAt = null; } }
      if (m.type === 'drained') { playing = false; if (currentItem) send({ type: 'playback', state: 'ended', itemId: currentItem }); }
      if (m.type === 'flushed') {
        playing = false;
        if (m.wasActive && flushRequestedAt != null) onMetrics({ source: 'client', flushToSilenceMs: Math.round(performance.now() - flushRequestedAt), audioWasPlaying: true });
        flushRequestedAt = null;
        const it = currentItem && items.get(currentItem);
        if (it) send({ type: 'played', itemId: currentItem, ms: Math.round((Math.max(0, Math.min(m.played - it.start, it.len)) / 24000) * 1000) });
      }
    };
    mic.port.onmessage = (e) => {
      if (e.data.type !== 'frame' || !ws || ws.readyState !== 1) return;
      // Echo guard on speakers: while COMPASS plays, pass only loud frames (+300 ms pre-roll).
      if (output === 'speakers' && playing && e.data.rms < echoGateRms) { preRoll.push(e.data.pcm); if (preRoll.length > 8) preRoll.shift(); return; }
      if (preRoll.length) { for (const p of preRoll) ws.send(p); preRoll = []; }
      ws.send(e.data.pcm);
    };
  }
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  function startBoson() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(wsUrl()); ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { reject(new Error('timeout')); try { ws.close(); } catch {} }, connectTimeoutMs);
      let ready = false;
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          if (currentItem && items.has(currentItem)) items.get(currentItem).len += e.data.byteLength / 2;
          enqueued += e.data.byteLength / 2;
          player.port.postMessage({ type: 'push', pcm: e.data }, [e.data]);
          return;
        }
        const m = JSON.parse(e.data);
        if (m.type === 'ready') { ready = true; sessionId = m.sessionId; provider = m.provider || 'boson'; clearTimeout(timer); resolve(); }
        else if (m.type === 'status') status(m.status);
        else if (m.type === 'compass') onEvent(m.event);
        else if (m.type === 'transcript') onTranscript(m);
        else if (m.type === 'metrics') onMetrics({ source: 'server', ...m });
        else if (m.type === 'audio.start') { currentItem = m.itemId; items.set(m.itemId, { start: enqueued, len: 0 }); }
        else if (m.type === 'audio.flush') { flushRequestedAt = performance.now(); player.port.postMessage({ type: 'flush' }); enqueued = 0; items.clear(); }
        else if (m.type === 'response.stale') onEvent({ type: 'response_stale', itemId: m.itemId, turnId: m.turnId, reason: m.reason });
        else if (m.type === 'error') onError(m);
      };
      ws.onclose = (e) => { clearTimeout(timer); if (!ready) reject(Object.assign(new Error(e.reason || 'closed'), { code: e.code })); else { onError({ code: 'voice_closed', message: `closed ${e.code}` }); status('IDLE'); } };
      ws.onerror = () => {};
    });
  }

  // ---------- fallback: browser speech ----------
  let rec = null;
  function startBrowser() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('No speech recognition in this browser');
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      if (speechSynthesis.speaking) { speechSynthesis.cancel(); status('INTERRUPTED'); } else if (!r.isFinal) status('SPEECH_DETECTED');
      if (r.isFinal) { const text = r[0].transcript.trim(); if (text) { onTranscript({ role: 'user', text, final: true }); browserTurn(text); } }
    };
    rec.onend = () => { if (mode === 'browser') try { rec.start(); } catch {} };
    rec.start();
    status('LISTENING');
  }
  async function browserTurn(text) {
    status('THINKING');
    const res = await fetch(turnUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ sessionId, text }) });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const type = /^event: (.*)$/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!type || !data) continue;
        const ev = JSON.parse(data);
        if (type === 'result') { sessionId = ev.sessionId; continue; }
        onEvent(ev);
        if (type === 'action_invalidated') status('REPLANNING'); else if (type === 'tool_call') status('ACTING');
        if (type === 'say' && ev.text) speakBrowser(ev.text);
      }
    }
  }
  function speakBrowser(text) {
    const u = new SpeechSynthesisUtterance(text); u.rate = 0.95;
    u.onstart = () => status('SPEAKING'); u.onend = () => status('LISTENING');
    speechSynthesis.speak(u);
  }

  return {
    async start() {
      try {
        await setupAudio();
        await startBoson();
        mode = 'boson';
      } catch (err) {
        onError({ code: 'boson_unavailable', message: String(err.message || err), closeCode: err.code });
        try { ws?.close(); } catch {}
        try { stream?.getTracks().forEach((t) => t.stop()); await ctx?.close(); } catch {}
        mode = 'browser'; provider = 'browser';
        startBrowser();
      }
      onMode(mode, provider);
      return mode;
    },
    sendText(text) { if (mode === 'boson') { markAt = performance.now(); send({ type: 'text', text }); } else if (mode === 'browser') browserTurn(text); },
    stop() {
      mode = null;
      try { send({ type: 'bye' }); ws?.close(); } catch {}
      try { rec?.stop(); speechSynthesis.cancel(); } catch {}
      try { stream?.getTracks().forEach((t) => t.stop()); ctx?.close(); } catch {}
      status('IDLE');
    },
    get mode() { return mode; },
    get provider() { return provider; },
    get sessionId() { return sessionId; },
  };
}
