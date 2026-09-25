// LIVE voice test through the real bridge: synthesized user speech -> Boson realtime ->
// compass_turn -> Nebius GLM-5.3 runtime -> Boson speech. Includes a real barge-in.
//   node --env-file=.env scripts/boson-live-voice.mjs
// Needs BOSON_API_KEY + NEBIUS_API_KEY. Prints results only, never keys.
import { createServer } from 'node:http';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createCompassBackend } from '../server/app.mjs';
import { connectBoson } from '../server/voice/boson-realtime.mjs';
import { synthesizePcm } from '../server/voice/boson-tts.mjs';

const key = process.env.BOSON_API_KEY;
if (!key || !process.env.NEBIUS_API_KEY) { console.log('keys missing'); process.exit(2); }
const USER_VOICE = process.env.USER_VOICE || 'marcus';
const T0 = performance.now();
const t = () => Math.round(performance.now() - T0);
const upstreamLog = [];
const backend = createCompassBackend({
  env: { ...process.env, MOCK_TOOL_DELAY_MS: process.env.MOCK_TOOL_DELAY_MS || '2500' },
  connectUpstream: async () => {
    const up = await connectBoson({ apiKey: key });
    up.on('*', (e) => upstreamLog.push({ t: t(), type: e.type, name: e.name, args: e.arguments, status: e.response?.status, meta: e.response?.metadata, err: e.error && { type: e.error.type, code: e.error.code, message: String(e.error.message || '').slice(0, 140) }, transcript: e.transcript }));
    return up;
  },
});
const http = createServer((req, res) => backend.handleApi(req, res));
backend.attachVoice(http);
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const port = http.address().port;
setTimeout(() => { report('hard timeout'); process.exit(3); }, 150_000);

// SCENARIO=question (default) | move | ru
const SCENARIOS = {
  question: {
    T1: 'Schedule dinner tomorrow at 7 and find an Italian restaurant.',
    T2: 'Actually make it 8. Somewhere near Palo Alto.',
    T3: 'Can we change it for next week?',
    T4: 'Actually, not next week. The week after next.',
  },
  move: {
    T1: 'Schedule dinner tomorrow at 7 and find an Italian restaurant.',
    T2: 'Actually make it 8. Somewhere near Palo Alto.',
    T3: 'Move it to next week.',
    T4: 'Actually, not next week. The week after next.',
  },
  // R4: T2 arrives as two fragments; the second overlaps COMPASS's reply to the first.
  split: {
    T1: 'Schedule dinner tomorrow at 7 and find an Italian restaurant.',
    T2a: 'Actually, make it 8.',
    T2b: 'Somewhere near Palo Alto.',
    T3: 'Move it to next week.',
    T4: 'Actually, not next week. The week after next.',
  },
  ru: {
    T1: 'Запланируй ужин завтра в семь и найди итальянский ресторан.',
    T2: 'Нет, лучше в восемь. Где-нибудь рядом с Пало-Альто.',
    T3: 'Перенеси на следующую неделю.',
    T4: 'Нет, не на следующую неделю, а через две недели.',
  },
};
const SCENARIO = process.env.SCENARIO || 'question';
const LINES = SCENARIOS[SCENARIO];
if (!LINES) { console.log('unknown SCENARIO'); process.exit(2); }
// User lines are synthesized once and cached (TTS is rate limited).
const CACHE = process.env.USER_LINES_CACHE || '.cache/user-lines';
mkdirSync(CACHE, { recursive: true });
const audio = {};
for (const [k, text] of Object.entries(LINES)) {
  const f = join(CACHE, `${USER_VOICE}-${k}-${Buffer.from(text).toString('base64url').slice(0, 24)}.pcm`);
  if (existsSync(f)) { audio[k] = readFileSync(f); continue; }
  for (let attempt = 0; ; attempt++) {
    try { audio[k] = (await synthesizePcm({ apiKey: key, text, voice: USER_VOICE })).pcm; writeFileSync(f, audio[k]); break; }
    catch (e) { if (e.status !== 429 || attempt >= 8) throw e; await new Promise((r) => setTimeout(r, 8000)); }
  }
}

const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/realtime`);
const log = [];            // client-visible timeline
const statuses = [];
let current = null;        // { itemId, startedAt, bytes }
const items = new Map();   // itemId -> { bytes, afterFlushBytes, flushed }
let flushes = 0;
const stale = [];
ws.on('message', (data, isBinary) => {
  if (isBinary) {
    if (current) { current.bytes += data.length; const it = items.get(current.itemId); it.bytes += data.length; if (it.flushed) it.afterFlushBytes += data.length; }
    return;
  }
  const m = JSON.parse(data.toString());
  if (m.type === 'status') statuses.push({ t: t(), s: m.status });
  if (m.type === 'audio.start') { current = { itemId: m.itemId, startedAt: performance.now(), bytes: 0 }; items.set(m.itemId, { bytes: 0, afterFlushBytes: 0, flushed: false, startT: t() }); }
  if (m.type === 'audio.flush') {
    flushes++;
    const it = m.itemId && items.get(m.itemId);
    if (it) it.flushed = true;
    // Simulated player: it had played real-time since audio.start, capped by what arrived.
    if (current && m.itemId) {
      const playedMs = Math.min(performance.now() - current.startedAt, (current.bytes / 2 / 24000) * 1000);
      ws.send(JSON.stringify({ type: 'played', itemId: m.itemId, ms: Math.round(playedMs) }));
    }
    current = null;
  }
  if (m.type === 'audio.end') current = null;
  if (m.type === 'response.stale') stale.push({ t: t(), itemId: m.itemId, reason: m.reason });
  if (m.type !== 'compass') log.push({ t: t(), ...m, ...(m.type === 'compass' ? {} : {}) });
  else if (['state_patch', 'action_invalidated', 'tool_call', 'tool_result', 'say'].includes(m.event.type)) log.push({ t: t(), type: `compass.${m.event.type}`, turnId: m.event.turnId, text: m.event.text, final: m.event.final, changed: m.event.changed, intent: m.event.intent });
});
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
await waitFor(() => log.some((l) => l.type === 'ready'), 15000, 'ready');

// Mic: continuous 40 ms frames; silence unless a line is queued.
let queue = Buffer.alloc(0);
const FRAME = 1920;
const mic = setInterval(() => {
  let frame;
  if (queue.length) { frame = queue.subarray(0, FRAME); queue = queue.subarray(FRAME); if (frame.length < FRAME) frame = Buffer.concat([frame, Buffer.alloc(FRAME - frame.length)]); }
  else frame = Buffer.alloc(FRAME);
  if (ws.readyState === 1) ws.send(frame, { binary: true });
}, 40);
const say = (k) => { log.push({ t: t(), type: `user.says.${k}`, text: LINES[k] }); queue = Buffer.concat([queue, audio[k]]); };

function waitFor(pred, ms, label) {
  return new Promise((resolve, reject) => {
    const s = Date.now();
    const iv = setInterval(() => { if (pred()) { clearInterval(iv); resolve(); } else if (Date.now() - s > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${label}`)); } }, 20);
  });
}
const lastStatus = () => statuses.at(-1)?.s;

let error = null;
try {
  // Scenario A: dinner, then barge-in while COMPASS is speaking.
  say('T1');
  await waitFor(() => lastStatus() === 'SPEAKING', Number(process.env.T1_WAIT || 30000), 'COMPASS speaking after T1');
  await new Promise((r) => setTimeout(r, 700)); // let it talk a bit, then interrupt
  if (LINES.T2) say('T2');
  else {
    const seen = statuses.length;
    say('T2a');
    // Fragment 2 starts the moment COMPASS begins answering fragment 1 (overlap), or after SPLIT_GAP_MS.
    await waitFor(() => statuses.slice(seen).some((x) => x.s === 'SPEAKING') || false, Number(process.env.SPLIT_GAP_MS || 15000), 'COMPASS answering fragment 1').catch(() => {});
    say('T2b');
  }
  await waitFor(() => log.some((l) => l.type === 'compass.state_patch' && l.intent?.location), 30000, 'state patch with location');
  await waitFor(() => { const s = backend.runtime.getSession(sessionId())?.state; return s && s.actions.some((a) => a.status === 'done' && a.args.location); }, 30000, 'rescoped search done');
  await waitFor(() => lastStatus() === 'LISTENING', 30000, 'back to listening');
  const afterA = structuredClone(backend.runtime.getSession(sessionId()).state);

  // Scenario B: conversational date correction.
  const turnsSeen = () => new Set(log.filter((l) => l.type === 'compass.say' && l.final).map((l) => l.turnId)).size;
  let n = turnsSeen();
  say('T3');
  await waitFor(() => turnsSeen() > n, 30000, 'T3 turn');
  await waitFor(() => lastStatus() === 'SPEAKING' || lastStatus() === 'LISTENING', 30000, 'T3 reply');
  await new Promise((r) => setTimeout(r, 400));
  n = turnsSeen();
  say('T4');
  await waitFor(() => turnsSeen() > n, 30000, 'T4 turn');
  await waitFor(() => lastStatus() === 'LISTENING' && !queue.length, 40000, 'final listening');
  report(null, afterA);
} catch (e) { error = e.message; report(error); }
clearInterval(mic); ws.close(); http.close(); process.exit(0);

function sessionId() { return log.find((l) => l.type === 'ready')?.sessionId; }
function report(err, afterA) {
  const st = backend.runtime.getSession(sessionId())?.state;
  console.log(JSON.stringify({
    error: err,
    scenario: SCENARIO,
    stale,
    assistantTranscripts: upstreamLog.filter((u) => u.type === 'response.output_audio_transcript.done').map((u) => u.transcript),
    afterDinner: afterA && { intent: afterA.intent, version: afterA.version, actions: afterA.actions.map((a) => `${a.status}:${a.args.time}@${a.args.location}`) },
    final: st && { intent: st.intent, version: st.version, actions: st.actions.map((a) => `${a.status}:${JSON.stringify(a.args)}${a.error ? ' ' + a.error : ''}${a.result?.via ? ' via ' + a.result.via : ''}`), history: st.history.map((h) => ({ v: h.version, text: h.text, changes: h.patch.map((p) => `${p.field}:${p.from}->${p.to}`) })) },
    flushes,
    itemsAudio: [...items.entries()].map(([id, v]) => ({ id: id.slice(-6), sec: +(v.bytes / 48000).toFixed(2), flushed: v.flushed, afterFlushSec: +(v.afterFlushBytes / 48000).toFixed(2), startT: v.startT })),
    statuses: statuses.map((s) => `${s.t}:${s.s}`).join(' '),
    timeline: log.filter((l) => l.type !== 'status').map((l) => `${l.t} ${l.type}${l.text ? ' "' + l.text + '"' : ''}${l.role ? ' [' + l.role + ']' : ''}${l.code ? ' ' + l.code : ''}${l.changed ? ' changed=' + l.changed : ''}`),
    metrics: log.filter((l) => l.type === 'metrics').map(({ t: tt, type, ...rest }) => rest),
    upstream: upstreamLog.filter((u) => process.env.ALL_EVENTS || /speech_|function_call|response.created|response.done|output_item|error|transcription|session/.test(u.type)).map((u) => `${u.t} ${u.type}${u.name ? ' ' + u.name + ' ' + u.args : ''}${u.status ? ' ' + u.status : ''}${u.meta ? ' ' + JSON.stringify(u.meta) : ''}${u.err ? ' ' + JSON.stringify(u.err) : ''}${u.transcript ? ' "' + u.transcript + '"' : ''}`),
  }, null, 1));
}
