import { clarifyLocal, planLocal, rateLimitFallback, MAX_INTENT } from './src/demo/catalog.mjs';
import { loadLlm, parseJsonLoose } from './llm.mjs';

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const NOTICE = 'Preview only. Nothing is sent or published.';

export function demoVideoUrl(env) {
  const raw = env.DEMO_VIDEO_URL || '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export function llmStatus(env) {
  return loadLlm(env, async () => { throw new Error('status check must not call the network'); }).configured;
}

function questionsFromModel(json) {
  const list = Array.isArray(json?.questions) ? json.questions.slice(0, 3) : [];
  const questions = [];
  for (const item of list) {
    const prompt = clip(item?.prompt, 180);
    const options = (Array.isArray(item?.options) ? item.options : []).map(option => clip(option, 60)).filter(Boolean).slice(0, 4);
    if (prompt.length < 8 || options.length < 2) continue;
    questions.push({ id: 'q' + (questions.length + 1), prompt, options });
  }
  return questions.length ? questions : null;
}

function partsFromModel(json, intent, answers) {
  const screens = (Array.isArray(json?.screens) ? json.screens : []).map(item => ({
    name: clip(item?.name, 40),
    purpose: clip(item?.purpose, 160),
  })).filter(item => item.name && item.purpose).slice(0, 5);
  const dataModel = (Array.isArray(json?.dataModel) ? json.dataModel : []).map(item => ({
    name: clip(item?.name, 40),
    fields: (Array.isArray(item?.fields) ? item.fields : []).map(field => clip(field, 40)).filter(Boolean).slice(0, 6),
  })).filter(item => item.name && item.fields.length >= 2).slice(0, 5);
  const integrations = (Array.isArray(json?.integrations) ? json.integrations : []).map(item => ({
    name: clip(item?.name, 40),
    purpose: clip(item?.purpose, 160).replace(/\$\d[\d,]*/g, '').trim(),
  })).filter(item => item.name && item.purpose).slice(0, 4);
  if (screens.length < 3 || dataModel.length < 2 || integrations.length < 1) return null;
  const tabs = screens.slice(0, 4).map((screen, index) => ({
    id: 's' + index,
    label: screen.name,
    title: screen.name,
    kicker: screen.purpose,
    lines: [
      { title: screen.name, meta: screen.purpose },
      ...answers.filter(item => item.value).slice(0, 2).map(item => ({ title: item.value, meta: item.prompt || 'Your answer' })),
    ].slice(0, 4),
  }));
  return {
    productName: clip(json?.title, 48) || 'Your product',
    summary: clip(json?.summary, 220) || `A first plan for “${intent}”.`,
    screens, dataModel, integrations,
    preview: { headline: tabs[0].title, subhead: clip(json?.summary, 140) || intent, tabs },
  };
}

async function ask(env, fetchImpl, messages) {
  const loaded = loadLlm(env, fetchImpl);
  if (!loaded.client) return null;
  const out = await loaded.client.chat({ messages, maxTokens: 900 });
  return parseJsonLoose(out.message.content || '');
}

const system = 'You plan software for COMPASS. Return one JSON object and nothing else. Do not include prices, revenue, customer counts, or real people.';

export async function clarifyDemo({ intent, exampleId, env, fetchImpl = fetch }) {
  const local = clarifyLocal(intent, exampleId);
  if (!local.ok || local.example) return { ...local, source: local.example ? 'example' : 'fallback', notice: NOTICE };
  try {
    const json = await ask(env, fetchImpl, [
      { role: 'system', content: system },
      { role: 'user', content: `Intent: ${local.intent}\nReturn {"questions":[{"prompt":"string","options":["string","string"]}]} with 1 to 3 questions and 2 to 4 short options each.` },
    ]);
    const questions = json && questionsFromModel(json);
    if (!questions) return { ...local, source: 'fallback', notice: NOTICE };
    return { ok: true, example: false, exampleId: null, intent: local.intent, questions, source: 'model', notice: NOTICE };
  } catch {
    return { ...local, source: 'fallback', notice: NOTICE };
  }
}

export async function planDemo({ intent, exampleId, answers, env, fetchImpl = fetch }) {
  const local = planLocal(intent, exampleId, answers);
  if (!local.ok || local.example || findPrepared(local)) return { ...local, source: local.example ? 'example' : 'fallback', notice: NOTICE };
  try {
    const json = await ask(env, fetchImpl, [
      { role: 'system', content: system },
      { role: 'user', content: `Intent: ${local.intent}\nAnswers: ${JSON.stringify(local.answers)}\nReturn {"title":"string","summary":"string","screens":[{"name":"string","purpose":"string"}],"dataModel":[{"name":"string","fields":["string","string"]}],"integrations":[{"name":"string","purpose":"string"}]}. 3 to 5 screens, 2 to 5 data entities, 1 to 4 integrations. No prices.` },
    ]);
    const parts = json && partsFromModel(json, local.intent, local.answers);
    if (!parts) return { ...local, source: 'fallback', notice: NOTICE };
    return { ...local, ...parts, source: 'model', notice: NOTICE };
  } catch {
    return { ...local, source: 'fallback', notice: NOTICE };
  }
}

function findPrepared(local) {
  return local.exampleId && local.example;
}

export function fallbackRun() {
  const plan = rateLimitFallback();
  return { ...plan, source: 'example', notice: NOTICE, limited: true };
}

export { MAX_INTENT };
