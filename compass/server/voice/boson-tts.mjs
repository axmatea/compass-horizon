// Boson Higgs TTS (POST /v1/audio/speech, higgs-tts-3). Server-side only.
// Used for voice auditions and to synthesize test utterances. Streams PCM16 24 kHz mono.
export async function synthesizePcm({ apiKey, text, voice = 'default', signal, baseUrl = 'https://api.boson.ai' }) {
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'higgs-tts-3', input: text, voice, response_format: 'pcm', stream: true }),
    signal,
  });
  if (!res.ok) throw Object.assign(new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  const chunks = [];
  let firstByteMs = null;
  for await (const c of res.body) { if (firstByteMs == null) firstByteMs = Math.round(performance.now() - t0); chunks.push(Buffer.from(c)); }
  const pcm = Buffer.concat(chunks);
  return { pcm, firstByteMs, totalMs: Math.round(performance.now() - t0), seconds: pcm.length / 2 / 24000 };
}

export function wavFromPcm(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Cheap delivery proxies: words/minute and loudness variation (flat = robotic, very high = theatrical). */
export function deliveryStats(pcm, text) {
  const n = pcm.length / 2;
  const frame = 480; // 20 ms
  const rms = [];
  for (let i = 0; i + frame <= n; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) { const v = pcm.readInt16LE((i + j) * 2) / 32768; s += v * v; }
    rms.push(Math.sqrt(s / frame));
  }
  const voiced = rms.filter((r) => r > 0.02);
  const mean = voiced.reduce((a, b) => a + b, 0) / (voiced.length || 1);
  const sd = Math.sqrt(voiced.reduce((a, b) => a + (b - mean) ** 2, 0) / (voiced.length || 1));
  const words = text.split(/\s+/).filter(Boolean).length;
  const seconds = n / 24000;
  return { wpm: Math.round((words / seconds) * 60), pausesPct: Math.round((1 - voiced.length / (rms.length || 1)) * 100), loudnessVar: +(sd / (mean || 1)).toFixed(2) };
}
