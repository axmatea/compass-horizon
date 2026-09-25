// Local environment check. Prints presence and shape only, never values.
//   npm run doctor
import { loadConfig, describeConfig } from '../server/config.mjs';
const cfg = loadConfig();
const shape = (v, prefix) => (v ? `PRESENT (len ${v.length}${prefix ? `, ${v.startsWith(prefix) ? 'expected prefix' : 'UNEXPECTED prefix'}` : ''})` : 'MISSING');
const rows = {
  NEBIUS_API_KEY: shape(cfg.nebius.apiKey, 'v1.'),
  NEBIUS_THINKING: process.env.NEBIUS_THINKING ?? 'unset (defaults to off)',
  BOSON_API_KEY: shape(cfg.boson.apiKey, 'bai-'),
  BOSON_VOICE: cfg.boson.voice,
  VOICE_PROVIDER: cfg.voiceProvider,
};
for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(16), v);
const d = describeConfig(cfg);
console.log('\nvoice path:', d.boson.configured && cfg.voiceProvider !== 'browser' ? 'Boson realtime (browser speech = fallback)' : 'browser speech only (Boson not configured)');
if (!cfg.nebius.apiKey) process.exitCode = 1;
