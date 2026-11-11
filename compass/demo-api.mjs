import { clarifyLocal, planLocal, rateLimitFallback, MAX_INTENT } from './src/demo/catalog.mjs';
import { loadLlm, completeJson } from './llm.mjs';

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const NOTICE = 'Preview only. Nothing is sent or published.';
const CLARIFY_MAX_TOKENS = 1200;
const PLAN_MAX_TOKENS = 1600;

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

function scrub(text) {
  const marked = text
    .replace(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g, '\u0000')
    .replace(/\b\d[\d,]*\+?\s+(?:customers|users|subscribers)\b/gi, '\u0000');
  return marked
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => !sentence.includes('\u0000'))
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function modelText(value, max) {
  if (value == null || typeof value === 'object') return '';
  return clip(scrub(String(value).replace(/<\/?think(?:ing)?>/gi, ' ')), max);
}

function optionText(option) {
  if (typeof option === 'string' || typeof option === 'number') return modelText(option, 60);
  if (option && typeof option === 'object') return modelText(option.label ?? option.text ?? option.value ?? option.option ?? option.name, 60);
  return '';
}

function questionsFromModel(json) {
  const list = Array.isArray(json?.questions) ? json.questions
    : Array.isArray(json?.clarifying_questions) ? json.clarifying_questions
      : Array.isArray(json?.clarifyingQuestions) ? json.clarifyingQuestions : [];
  const questions = [];
  for (const item of list.slice(0, 3)) {
    const prompt = modelText(item?.prompt ?? item?.question ?? item?.text, 180);
    const rawOptions = Array.isArray(item?.options) ? item.options : Array.isArray(item?.choices) ? item.choices : [];
    const options = rawOptions.map(optionText).filter(Boolean).slice(0, 4);
    if (prompt.length < 8 || options.length < 2) continue;
    questions.push({ id: 'q' + (questions.length + 1), prompt, options });
  }
  return questions.length ? questions : null;
}

function named(item) {
  return modelText(item?.name ?? item?.title ?? item?.label, 40);
}

function purposeOf(item) {
  return modelText(item?.purpose ?? item?.description ?? item?.summary, 160);
}

function fieldText(field) {
  if (typeof field === 'string' || typeof field === 'number') return modelText(field, 40);
  if (field && typeof field === 'object') return modelText(field.name ?? field.field ?? field.title ?? field.label, 40);
  return '';
}

function partsFromModel(json, intent, answers) {
  const screenList = Array.isArray(json?.screens) ? json.screens : Array.isArray(json?.pages) ? json.pages : [];
  const screens = screenList.map(item => ({ name: named(item), purpose: purposeOf(item) })).filter(item => item.name && item.purpose).slice(0, 5);
  const dataList = Array.isArray(json?.dataModel) ? json.dataModel : Array.isArray(json?.data_model) ? json.data_model : Array.isArray(json?.entities) ? json.entities : [];
  const dataModel = dataList.map(item => ({
    name: named(item),
    fields: (Array.isArray(item?.fields) ? item.fields : Array.isArray(item?.columns) ? item.columns : []).map(fieldText).filter(Boolean).slice(0, 6),
  })).filter(item => item.name && item.fields.length >= 2).slice(0, 5);
  const linkList = Array.isArray(json?.integrations) ? json.integrations : [];
  const integrations = linkList.map(item => ({ name: named(item), purpose: purposeOf(item) })).filter(item => item.name && item.purpose).slice(0, 4);
  if (screens.length < 3 || dataModel.length < 2 || integrations.length < 1) return null;
  const summary = modelText(json?.summary ?? json?.description, 220);
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
    productName: modelText(json?.title ?? json?.productName ?? json?.name, 48) || 'Your product',
    summary: summary || `A first plan for “${intent}”.`,
    screens, dataModel, integrations,
    preview: { accent: '#243044', headline: tabs[0].title, subhead: clip(summary, 140) || intent, tabs },
  };
}

function label(value) {
  const clean = String(value ?? '').replace(/[^A-Za-z0-9_./:+ -]/g, '').slice(0, 96);
  return clean || '-';
}

function reportFallback(failures, route, log) {
  for (const item of failures) {
    const error = item.providerCode ? label(item.providerCode).slice(0, 60) : '-';
    const line = `compass demo llm fallback route=${label(route)} provider=${label(item.provider)} model=${label(item.model)} code=${label(item.code)} status=${item.status === '' || item.status == null ? '-' : label(item.status)} category=${label(item.category)} error=${error}`;
    try { log(line); } catch { /* a log failure must not change the preview */ }
  }
}

async function ask(env, fetchImpl, messages, maxTokens, accept, providerCaps) {
  const loaded = loadLlm(env, fetchImpl);
  if (!loaded.clients.length) return { json: null, failures: [] };
  return completeJson({ clients: loaded.clients, messages, maxTokens, accept, providerCaps });
}

const system = 'You plan software for COMPASS. Return one JSON object and nothing else. Close any thinking block before that JSON. Do not include prices, revenue, customer counts, or real people.';

export async function clarifyDemo({ intent, exampleId, env, fetchImpl = fetch, log = console.error }) {
  const local = clarifyLocal(intent, exampleId);
  if (!local.ok || local.example) return { ...local, source: local.example ? 'example' : 'fallback', notice: NOTICE };
  const result = await ask(env, fetchImpl, [
    { role: 'system', content: system },
    { role: 'user', content: `Intent: ${local.intent}\nReturn {"questions":[{"prompt":"string","options":["string","string"]}]} with 1 to 3 questions and 2 to 4 short options each.` },
  ], CLARIFY_MAX_TOKENS, json => Boolean(questionsFromModel(json)), { nebius: 512 });
  const questions = result.json && questionsFromModel(result.json);
  if (!questions) {
    reportFallback(result.failures, 'clarify', log);
    return { ...local, source: 'fallback', notice: NOTICE };
  }
  return { ok: true, example: false, exampleId: null, intent: local.intent, questions, source: 'model', notice: NOTICE };
}

export async function planDemo({ intent, exampleId, answers, env, fetchImpl = fetch, log = console.error }) {
  const local = planLocal(intent, exampleId, answers);
  if (!local.ok || local.example || findPrepared(local)) return { ...local, source: local.example ? 'example' : 'fallback', notice: NOTICE };
  const result = await ask(env, fetchImpl, [
    { role: 'system', content: system },
    { role: 'user', content: `Intent: ${local.intent}\nAnswers: ${JSON.stringify(local.answers)}\nReturn {"title":"string","summary":"string","screens":[{"name":"string","purpose":"string"}],"dataModel":[{"name":"string","fields":["string","string"]}],"integrations":[{"name":"string","purpose":"string"}]}. 3 to 5 screens, 2 to 5 data entities, 1 to 4 integrations. No prices.` },
  ], PLAN_MAX_TOKENS, json => Boolean(partsFromModel(json, local.intent, local.answers)));
  const parts = result.json && partsFromModel(result.json, local.intent, local.answers);
  if (!parts) {
    reportFallback(result.failures, 'plan', log);
    return { ...local, source: 'fallback', notice: NOTICE };
  }
  return { ...local, ...parts, source: 'model', notice: NOTICE };
}

function findPrepared(local) {
  return local.exampleId && local.example;
}

export function fallbackRun() {
  const plan = rateLimitFallback();
  return { ...plan, source: 'example', notice: NOTICE, limited: true };
}

export { MAX_INTENT };
