// Voice audition for COMPASS. Same three sentences per candidate voice.
//   node --env-file=.env scripts/boson-voice-audition.mjs [outDir]
// Writes WAVs for listening + prints latency and delivery proxies. Never prints the key.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { synthesizePcm, wavFromPcm, deliveryStats } from '../server/voice/boson-tts.mjs';

const apiKey = process.env.BOSON_API_KEY;
if (!apiKey) { console.error('BOSON_API_KEY not set'); process.exit(2); }
const outDir = process.argv[2] || 'voice-audition';
mkdirSync(outDir, { recursive: true });
// Shortlist from official preset descriptions (docs.boson.ai/models/higgs-tts/voices.md):
// oliver "calm, articulate, thoughtful", eleanor "calm, articulate", nora "calm, clear, narrative",
// plus the realtime "default". Excluded: jake (dramatic, sports), marcus (enthusiastic, professorial),
// chloe (engaging, informative: closest to support-bot register). Override with VOICES=a,b,c.
const VOICES = (process.env.VOICES || 'default,oliver,eleanor,nora').split(',');
const SENTENCES = [
  'Got it. Dinner tomorrow at seven. I’m looking for an Italian place now.',
  'Actually, eight works better. I’ll keep everything else the same and look near Palo Alto.',
  'Done. I updated the plan without restarting what we already figured out.',
];
const rows = [];
for (const voice of VOICES) {
  const per = [];
  for (let i = 0; i < SENTENCES.length; i++) {
    try {
      const r = await synthesizePcm({ apiKey, text: SENTENCES[i], voice });
      writeFileSync(join(outDir, `${voice}-${i + 1}.wav`), wavFromPcm(r.pcm));
      per.push({ firstByteMs: r.firstByteMs, seconds: +r.seconds.toFixed(2), ...deliveryStats(r.pcm, SENTENCES[i]) });
    } catch (e) { per.push({ error: String(e.message).slice(0, 120) }); }
  }
  const ok = per.filter((p) => !p.error);
  const avg = (k) => (ok.length ? Math.round(ok.reduce((a, p) => a + p[k], 0) / ok.length * 100) / 100 : null);
  rows.push({ voice, firstByteMs: avg('firstByteMs'), wpm: avg('wpm'), pausesPct: avg('pausesPct'), loudnessVar: avg('loudnessVar'), errors: per.filter((p) => p.error).map((p) => p.error) });
}
console.log(JSON.stringify({ outDir, rows }, null, 1));
