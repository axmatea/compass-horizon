// Smallest real Boson connectivity test. Never prints the key.
//   railway run -s compass-web -e production -- node scripts/boson-smoke.mjs
//   or: node --env-file=.env scripts/boson-smoke.mjs
// Checks: REST auth (GET /v1/audio/voices), realtime WS open + session.created,
// one spoken reply (first audio latency), clean close.
import { connectBoson, buildSessionConfig } from '../server/voice/boson-realtime.mjs';

const key = process.env.BOSON_API_KEY || '';
if (!key) { console.log(JSON.stringify({ ok: false, error: 'BOSON_API_KEY not set' })); process.exit(2); }
const out = { keyPresent: true };
setTimeout(() => { console.log(JSON.stringify({ ...out, ok: false, error: 'hard timeout 40s' })); process.exit(3); }, 40_000);

// 1. REST
{
  const t0 = performance.now();
  const r = await fetch('https://api.boson.ai/v1/audio/voices', { headers: { Authorization: `Bearer ${key}` } });
  out.rest = { status: r.status, ms: Math.round(performance.now() - t0) };
  const body = await r.text();
  try {
    const j = JSON.parse(body);
    const list = j.data || j.voices || (Array.isArray(j) ? j : []);
    out.rest.voices = list.map((v) => v.id || v.name || v.voice).filter(Boolean).slice(0, 40);
  } catch { out.rest.body = body.slice(0, 160); }
}

// 2. Realtime
const t0 = performance.now();
const up = await connectBoson({ apiKey: key }).catch((e) => { out.ws = { error: e.code, closeCode: e.closeCode }; return null; });
if (!up) { console.log(JSON.stringify({ ...out, ok: false })); process.exit(1); }
out.ws = { openMs: Math.round(performance.now() - t0) };
const events = [];
let firstAudio = null, audioBytes = 0, transcript = '';
const done = new Promise((resolve) => {
  up.on('*', (e) => {
    events.push(e.type);
    if (e.type === 'session.created') out.ws.sessionCreatedMs = Math.round(performance.now() - t0);
    if (e.type === 'response.output_audio.delta') { if (firstAudio == null) firstAudio = performance.now(); audioBytes += Buffer.from(e.delta, 'base64').length; }
    if (e.type === 'response.output_audio_transcript.done') transcript = e.transcript;
    if (e.type === 'error') out.ws.error = { type: e.error?.type, code: e.error?.code, message: String(e.error?.message || '').slice(0, 160) };
    if (e.type === 'response.done') resolve(e.response?.status);
  });
  up.on('__close', (c) => { out.ws.closed = c; resolve('closed'); });
});
up.send({ type: 'session.update', session: { ...buildSessionConfig({ forceTool: false }), tools: [] } });
up.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say exactly: COMPASS voice online.' }] } });
const tReq = performance.now();
up.send({ type: 'response.create' });
out.ws.responseStatus = await done;
out.ws.firstAudioMs = firstAudio ? Math.round(firstAudio - tReq) : null;
out.ws.audioSeconds = +(audioBytes / 2 / 24000).toFixed(2);
out.ws.transcript = transcript;
out.ws.eventTypes = [...new Set(events)];
up.close();
console.log(JSON.stringify({ ok: out.rest.status === 200 && out.ws.responseStatus === 'completed' && audioBytes > 0, ...out }, null, 1));
process.exit(0);
