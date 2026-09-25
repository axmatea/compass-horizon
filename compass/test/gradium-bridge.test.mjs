import test from 'node:test';
import assert from 'node:assert/strict';
import { createGradiumBridge } from '../server/voice/gradium-bridge.mjs';
import { createAgentRuntime } from '../server/agent/runtime.mjs';
import { siteDomain } from '../server/domains/site.mjs';
import { createCompassBackend } from '../server/app.mjs';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createToolRegistry } from '../server/tools/registry.mjs';

// ---- fakes ----
function fakeUpstream(path, log) {
  const handlers = new Map();
  const up = {
    path, sent: [], closed: null,
    send: (m) => { up.sent.push(m); log?.push([path, m.type]); },
    close: (code, reason) => { if (!up.closed) { up.closed = { code, reason }; up.emit('__close', { code, reason }); } },
    on: (t, fn) => { handlers.set(t, [...(handlers.get(t) || []), fn]); },
    emit: (t, e = {}) => { for (const fn of handlers.get(t) || []) fn(e); },
  };
  return up;
}
function fakeClient() {
  const c = { json: [], bin: [], closed: null, sendJson: (m) => c.json.push(m), sendBinary: (b) => c.bin.push(b), close: (code, reason) => { c.closed = { code, reason }; } };
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 1500) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(10); } };

function siteRuntime() {
  const interpreter = { interpret: async ({ text: utterance }) => {
    if (/tea/i.test(utterance)) return { set: { business: 'Leaf', kind: 'tea house' }, tool: 'write_copy', reply: 'Switching to a tea house.' };
    return { set: { business: 'Northwind', kind: 'coffee roastery' }, tool: 'write_copy', reply: 'Starting the page.' };
  } };
  const tools = [{ name: 'write_copy', description: 'fake copywriter', argsFromIntent: (intent) => ({ kind: intent.kind, business: intent.business }), requires: ['kind'], dependsOn: ['kind', 'business'], run: async (args, { signal }) => { await new Promise((r, j) => { const t = setTimeout(r, 120); signal?.addEventListener('abort', () => { clearTimeout(t); j(new Error('aborted')); }); }); return { wrote: ['hero'], hero: { headline: `Hello ${args.business}` } }; }, summarize: () => 'Words are in.' }];
  return createAgentRuntime({ interpreter, tools: createToolRegistry(tools), domain: siteDomain });
}

test('gradium bridge: VAD phases: inactive arms, active opens (barge-in), inactive ends; cooldown after flush', async () => {
  const ups = [];
  const client = fakeClient();
  const bridge = createGradiumBridge({ client, runtime: siteRuntime(), connect: async (path) => { const u = fakeUpstream(path); ups.push(u); return u; }, voiceId: 'v1', minTurnMs: 0, turnCooldownFrames: 2 });
  await bridge.start();
  const stt = ups[0]; stt.emit('ready', {});
  const step = (p) => stt.emit('step', { vad: [{ horizon_s: 3, inactivity_prob: p }] });
  step(0.9); assert.equal(bridge.status, 'LISTENING');
  step(0.1); assert.equal(bridge.status, 'SPEECH_DETECTED', 'turn opens on the first active step');
  stt.emit('text', { text: 'Build a coffee page' });
  step(0.8);
  assert.ok(stt.sent.some((m) => m.type === 'flush'), 'turn ends on inactive step');
  stt.emit('flushed', {});
  await until(() => ups.length >= 2);
  step(0.1); step(0.1); // cooldown frames ignored
  assert.notEqual(bridge.status, 'SPEECH_DETECTED');
  bridge.close();
});

test('gradium bridge: audio forwarded in 3840-byte chunks after STT ready; ready reports provider', async () => {
  const ups = [];
  const client = fakeClient();
  const bridge = createGradiumBridge({ client, runtime: siteRuntime(), connect: async (path) => { const u = fakeUpstream(path); ups.push(u); return u; }, voiceId: 'v1', voiceName: 'zoey' });
  await bridge.start();
  assert.equal(ups[0].path, '/speech/asr');
  assert.equal(ups[0].sent[0].type, 'setup');
  assert.equal(ups[0].sent[0].input_format, 'pcm_24000');
  assert.equal(ups[0].sent[0].json_config.delay_in_frames, 12);
  bridge.onClientAudio(Buffer.alloc(2000)); // buffered until ready
  assert.equal(ups[0].sent.filter((m) => m.type === 'audio').length, 0);
  ups[0].emit('ready', { sample_rate: 24000, frame_size: 1920 });
  const ready = client.json.find((m) => m.type === 'ready');
  assert.equal(ready.provider, 'gradium'); assert.equal(ready.voice, 'zoey'); assert.equal(ready.sampleRate, 24000);
  bridge.onClientAudio(Buffer.alloc(2000));
  const audio = ups[0].sent.filter((m) => m.type === 'audio');
  assert.equal(audio.length, 1);
  assert.equal(Buffer.from(audio[0].audio, 'base64').length, 3840);
  bridge.close();
  assert.equal(ups[0].closed.code, 1000);
});

test('gradium bridge: words -> VAD end of turn -> flush -> COMPASS turn -> TTS relay -> transcript', async () => {
  const ups = [];
  const client = fakeClient();
  const bridge = createGradiumBridge({ client, runtime: siteRuntime(), connect: async (path) => { const u = fakeUpstream(path); ups.push(u); return u; }, voiceId: 'v1', minTurnMs: 0 });
  await bridge.start();
  const stt = ups[0]; stt.emit('ready', {});
  stt.emit('text', { text: 'Build a page' });
  assert.equal(bridge.status, 'SPEECH_DETECTED');
  stt.emit('text', { text: 'for Northwind' });
  assert.ok(client.json.some((m) => m.type === 'transcript' && !m.final && m.text === 'Build a page for Northwind'));
  stt.emit('step', { vad: [{ horizon_s: 0.5, inactivity_prob: 0.1 }, { horizon_s: 1, inactivity_prob: 0.9 }] });
  const flush = stt.sent.find((m) => m.type === 'flush');
  assert.ok(flush, 'flush sent on end of turn');
  assert.equal(typeof flush.flush_id, 'string');
  stt.emit('flushed', { flush_id: flush.flush_id });
  await until(() => ups.length >= 2);
  const tts = ups[1];
  assert.equal(tts.path, '/speech/tts');
  assert.equal(tts.sent[0].type, 'setup'); assert.equal(tts.sent[0].voice_id, 'v1'); assert.equal(tts.sent[0].output_format, 'pcm_24000');
  assert.equal(tts.sent[1].type, 'text'); assert.equal(tts.sent[1].text, 'Starting the page.');
  assert.equal(tts.sent[2].type, 'end_of_stream');
  tts.emit('audio', { audio: Buffer.alloc(4800).toString('base64') });
  assert.ok(client.json.some((m) => m.type === 'audio.start'));
  assert.equal(client.bin.length, 1);
  assert.equal(bridge.status, 'SPEAKING');
  tts.emit('end_of_stream', {});
  assert.ok(client.json.some((m) => m.type === 'audio.end' && m.status === 'completed'));
  assert.ok(client.json.some((m) => m.type === 'transcript' && m.role === 'assistant' && m.text === 'Starting the page.'));
  assert.ok(client.json.some((m) => m.type === 'compass' && m.event.type === 'state_patch'));
  assert.ok(client.json.some((m) => m.type === 'compass' && m.event.type === 'render'));
  assert.equal(tts.closed?.code, 1000);
  bridge.close();
});

test('gradium bridge: barge-in closes the TTS socket, flushes playback, new utterance replans', async () => {
  const ups = [];
  const client = fakeClient();
  const bridge = createGradiumBridge({ client, runtime: siteRuntime(), connect: async (path) => { const u = fakeUpstream(path); ups.push(u); return u; }, voiceId: 'v1', minTurnMs: 0 });
  await bridge.start();
  const stt = ups[0]; stt.emit('ready', {});
  stt.emit('text', { text: 'Build a coffee page' });
  bridge._endTurn();
  stt.emit('flushed', {});
  await until(() => ups.length >= 2);
  const tts = ups[1];
  tts.emit('audio', { audio: Buffer.alloc(48000).toString('base64') }); // ~1 s of audio playing
  assert.equal(bridge.status, 'SPEAKING');
  stt.emit('text', { text: 'Actually a tea house' });
  assert.equal(tts.closed?.reason, 'barge-in');
  assert.ok(client.json.some((m) => m.type === 'audio.flush'));
  assert.ok(client.json.some((m) => m.type === 'response.stale'));
  assert.equal(bridge.status, 'INTERRUPTED');
  bridge._endTurn(); stt.emit('flushed', {});
  await until(() => ups.length >= 3);
  assert.equal(ups[2].sent[1].text, 'Switching to a tea house.');
  assert.ok(client.json.some((m) => m.type === 'compass' && m.event.type === 'action_invalidated'), 'the running copy action was invalidated');
  bridge.close();
});

test('gradium bridge: typed text is a turn too; STT reconnects when upstream closes', async () => {
  const ups = [];
  const client = fakeClient();
  const bridge = createGradiumBridge({ client, runtime: siteRuntime(), connect: async (path) => { const u = fakeUpstream(path); ups.push(u); return u; }, voiceId: 'v1' });
  await bridge.start();
  ups[0].emit('ready', {});
  ups[0].close(1000, 'session limit');
  await until(() => ups.length >= 2 && ups[1].path === '/speech/asr');
  assert.equal(client.closed, null, 'client stays open across STT rotation');
  bridge.onClientJson({ type: 'text', text: 'Build a page for Northwind' });
  await until(() => ups.some((u) => u.path === '/speech/tts'));
  bridge.close();
});

test('ws server selects the Gradium bridge when a Gradium upstream is configured', async () => {
  const env = { NEBIUS_API_KEY: 'SECRET', GRADIUM_API_KEY: 'SECRET2', GENERALCOMPUTE_API_KEY: 'SECRET3' };
  const ups = [];
  const backend = createCompassBackend({ env, interpreter: { interpret: async () => ({ set: {}, reply: 'ok' }) }, siteInterpreter: { interpret: async () => ({ set: {}, reply: 'ok' }) }, tools: createToolRegistry([]), siteTools: createToolRegistry([]), connectGradiumUpstream: async (path) => { const u = fakeUpstream(path); ups.push(u); setTimeout(() => u.emit('ready', {}), 5); return u; }, logger: { error() {}, warn() {}, info() {} } });
  const server = createServer((req, res) => backend.handleApi(req, res) || (res.statusCode = 404, res.end()));
  backend.attachVoice(server);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(h.voice.provider, 'gradium'); assert.equal(h.voice.realtime, true);
  assert.equal(h.llm.provider, 'generalcompute'); assert.equal(h.llm.fallback, 'nebius');
  assert.ok(!JSON.stringify(h).includes('SECRET'));
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/realtime?domain=site`);
  const ready = await new Promise((resolve, reject) => { ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'ready') resolve(m); if (m.type === 'error') reject(new Error(m.code)); }); ws.on('error', reject); });
  assert.equal(ready.provider, 'gradium');
  assert.equal(ups[0].path, '/speech/asr');
  ws.close();
  await new Promise((r) => server.close(r));
});
