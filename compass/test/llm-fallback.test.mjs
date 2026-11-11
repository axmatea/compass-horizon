import test from 'node:test';
import assert from 'node:assert/strict';
import { clarifyDemo, planDemo } from '../demo-api.mjs';
import { clarifyLocal, planLocal } from '../src/demo/catalog.mjs';
import { parseJsonLoose, loadLlm, llmModelNotices } from '../llm.mjs';

const intent = 'an inventory tracker for my coffee roastery with low-stock alerts';
const gcKey = 'gc-test-key';
const nebiusKey = 'nebius-test-key';

function completion(content, { message = {}, finishReason = 'stop', status = 200 } = {}) {
  return new Response(JSON.stringify({
    choices: [{ message: { content, ...message }, finish_reason: finishReason }],
  }), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(handler) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const call = { url: String(url), body: JSON.parse(opts.body), auth: opts.headers.Authorization };
    calls.push(call);
    return handler(call, calls);
  };
  return { calls, fetchImpl };
}

const beans = '{"questions":[{"prompt":"Which beans should trigger a low-stock alert?","options":["Espresso","Filter"]}]}';
const thinkPrefixed = `<think>Draft a generic form. {"questions":[{"prompt":"Who is it for?","options":["Customers","A team","Both"]}]}</think>\n${beans}`;
const fenced = '```json\n{"questions":[{"prompt":"Where is the coffee stock counted?","options":["Roastery","Cafe"]}]}\n```';

test('think blocks and code fences still yield the JSON object', () => {
  const parsed = parseJsonLoose(thinkPrefixed);
  assert.equal(parsed.questions[0].prompt, 'Which beans should trigger a low-stock alert?');
  assert.equal(parseJsonLoose(fenced).questions[0].options[1], 'Cafe');
  const braces = '{"questions":[{"prompt":"Which {lot} should alert first?","options":["East hopper","West hopper"]}]}';
  assert.equal(parseJsonLoose(braces).questions[0].options[0], 'East hopper');
  assert.throws(() => parseJsonLoose('{"questions":[{"prompt":"Which beans are running low today?"'), /no JSON object/);
});

test('a think-prefixed model reply is used and the decoy inside the think block is not', async () => {
  const { calls, fetchImpl } = recorder(() => completion(thinkPrefixed));
  const lines = [];
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey, NEBIUS_API_KEY: nebiusKey },
    fetchImpl,
    log: line => lines.push(line),
  });
  assert.equal(out.source, 'model');
  assert.equal(out.questions[0].prompt, 'Which beans should trigger a low-stock alert?');
  assert.deepEqual(out.questions[0].options, ['Espresso', 'Filter']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /generalcompute\.com/);
  assert.equal(calls[0].body.max_tokens, 1200);
  assert.equal(calls[0].body.reasoning_effort, undefined);
  assert.equal(calls[0].body.chat_template_kwargs, undefined);
  assert.equal(lines.length, 0);
  assert.equal(JSON.stringify(out).includes(gcKey), false);
});

test('JSON in a code fence is used', async () => {
  const { calls, fetchImpl } = recorder(() => completion(fenced));
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey },
    fetchImpl,
    log() { throw new Error('should not log'); },
  });
  assert.equal(out.source, 'model');
  assert.equal(out.questions[0].prompt, 'Where is the coffee stock counted?');
  assert.equal(calls.length, 1);
});

test('option objects and alternate question keys are accepted', async () => {
  const body = JSON.stringify({
    questions: [{
      question: 'Who gets the low-stock alert?',
      choices: [{ label: 'The roaster' }, { text: 'The cafe' }],
    }],
  });
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey },
    fetchImpl: async () => completion(body),
    log() { throw new Error('should not log'); },
  });
  assert.equal(out.source, 'model');
  assert.equal(out.questions[0].prompt, 'Who gets the low-stock alert?');
  assert.deepEqual(out.questions[0].options, ['The roaster', 'The cafe']);
});

test('reasoning_content is used only when the visible content has no usable JSON', async () => {
  const reasoning = 'The answer belongs here. {"questions":[{"prompt":"Which roast levels do you track?","options":["Single origin","Blend"]}]}';
  const visible = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey },
    fetchImpl: async () => completion(beans, { message: { reasoning_content: reasoning } }),
  });
  assert.equal(visible.questions[0].options[0], 'Espresso');

  const hidden = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey },
    fetchImpl: async () => completion('', { message: { reasoning_content: reasoning } }),
  });
  assert.equal(hidden.source, 'model');
  assert.equal(hidden.questions[0].prompt, 'Which roast levels do you track?');

  const prose = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey },
    fetchImpl: async () => completion('<think>only prose</think>', { message: { reasoning_content: 'no object here' } }),
    log() {},
  });
  assert.equal(prose.source, 'fallback');
});

test('truncated JSON tries the next provider', async () => {
  const { calls, fetchImpl } = recorder(call => {
    if (call.url.includes('generalcompute')) {
      return completion('{"questions":[{"prompt":"Which beans are running low today?"', { finishReason: 'length' });
    }
    return completion('{"questions":[{"prompt":"How should a low-stock alert be delivered?","options":["Text","Note"]}]}');
  });
  const lines = [];
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey, NEBIUS_API_KEY: nebiusKey },
    fetchImpl,
    log: line => lines.push(line),
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /nebius\.com/);
  assert.equal(calls[1].body.reasoning_effort, 'low');
  assert.equal(calls[1].body.chat_template_kwargs, undefined);
  assert.equal(out.source, 'model');
  assert.equal(out.questions[0].prompt, 'How should a low-stock alert be delivered?');
  assert.equal(lines.length, 0);
});

test('an HTTP 400 on the first provider tries the second and logs neither the key nor the body', async () => {
  const marker = 'FULL_MODEL_OUTPUT_SHOULD_NOT_APPEAR';
  const { calls, fetchImpl } = recorder(call => {
    if (call.url.includes('generalcompute')) return new Response(`{"error":"${marker} ${gcKey}"}`, { status: 400 });
    return completion('{"questions":[{"prompt":"What should the wedding gallery list first?","options":["Dates","Albums"]}]}');
  });
  const lines = [];
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey, NEBIUS_API_KEY: nebiusKey },
    fetchImpl,
    log: line => lines.push(line),
  });
  assert.equal(calls.length, 2);
  assert.equal(out.source, 'model');
  assert.equal(out.questions[0].options[0], 'Dates');
  assert.equal(lines.length, 0);
  assert.equal(calls[0].body.messages.some(item => item.content.includes(intent)), true);

  const failed = [];
  const both = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey, NEBIUS_API_KEY: nebiusKey },
    fetchImpl: async url => {
      if (String(url).includes('generalcompute')) return new Response(`bad ${marker} ${gcKey}`, { status: 400 });
      return new Response(marker + ' ' + nebiusKey, { status: 500 });
    },
    log: line => failed.push(line),
  });
  const local = clarifyLocal(intent);
  assert.equal(both.source, 'fallback');
  assert.equal(both.ok, true);
  assert.deepEqual(both.questions, local.questions);
  assert.equal(failed.length, 2);
  assert.match(failed[0], /route=clarify provider=generalcompute model=minimax-m2\.7 code=http status=400 category=http 400/);
  assert.match(failed[1], /route=clarify provider=nebius model=zai-org\/GLM-5\.3-fast code=http status=500 category=http 500 error=-/);
  const blob = failed.join('\n');
  assert.equal(blob.includes(gcKey), false);
  assert.equal(blob.includes(nebiusKey), false);
  assert.equal(blob.includes(marker), false);
  assert.equal(blob.includes(intent), false);
  assert.equal(JSON.stringify(both).includes(gcKey), false);
});

test('a rejected shape on the first provider tries the second', async () => {
  const { calls, fetchImpl } = recorder(call => {
    if (call.url.includes('generalcompute')) return completion('{"questions":[{"prompt":"Too short","options":["Only one"]}]}');
    return completion(beans);
  });
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey, NEBIUS_API_KEY: nebiusKey },
    fetchImpl,
    log() { throw new Error('success must not log'); },
  });
  assert.equal(calls.length, 2);
  assert.equal(out.source, 'model');
  assert.equal(out.questions[0].options[0], 'Espresso');
});

test('no keys and a total provider failure keep the local fallback', async () => {
  let called = false;
  const lines = [];
  const quiet = await clarifyDemo({
    intent,
    env: {},
    fetchImpl: async () => { called = true; throw new Error('should not be called'); },
    log: line => lines.push(line),
  });
  const local = clarifyLocal(intent);
  assert.equal(called, false);
  assert.deepEqual(lines, []);
  assert.equal(quiet.source, 'fallback');
  assert.equal(quiet.notice, 'Preview only. Nothing is sent or published.');
  assert.deepEqual(quiet.questions, local.questions);
  assert.equal(quiet.intent, local.intent);

  const answers = local.questions.map(question => ({ id: question.id, prompt: question.prompt, value: question.options[0] }));
  const planned = await planDemo({
    intent,
    answers,
    env: {},
    fetchImpl: async () => { called = true; throw new Error('should not be called'); },
    log: line => lines.push(line),
  });
  const localPlan = planLocal(intent, null, answers);
  assert.equal(called, false);
  assert.equal(planned.source, 'fallback');
  assert.deepEqual(planned.screens, localPlan.screens);
  assert.deepEqual(planned.dataModel, localPlan.dataModel);
  assert.deepEqual(planned.integrations, localPlan.integrations);
  assert.deepEqual(planned.preview, localPlan.preview);
  assert.deepEqual(lines, []);
});

test('a plan survives think tags, shape variants, and drops prices and customer counts', async () => {
  const plan = {
    title: 'Roastery stock',
    summary: 'Tracks beans and alerts. $49 a month for 10000 customers.',
    screens: [
      { title: 'Stock', description: 'On-hand beans by roast.' },
      { name: 'Alerts', purpose: 'What is below the line.' },
      { name: 'Orders', purpose: 'Green coffee still incoming.' },
    ],
    data_model: [
      { name: 'Bean', fields: [{ name: 'Roast' }, { name: 'Grams' }] },
      { name: 'Alert', fields: ['Bean', 'Threshold'] },
    ],
    integrations: [{ name: 'Scale', purpose: 'Reads the hopper. £12 and 500 users.' }],
  };
  const wrapped = `<think>prices and a draft {"title":"Wrong"}</think>\n${JSON.stringify(plan)}`;
  const { calls, fetchImpl } = recorder(() => completion(wrapped));
  const answers = [{ id: 'q1', prompt: 'Which beans?', value: 'Espresso' }];
  const out = await planDemo({
    intent,
    answers,
    env: { NEBIUS_API_KEY: nebiusKey, LLM_PROVIDER: 'nebius', NEBIUS_THINKING: 'on' },
    fetchImpl,
  });
  assert.equal(out.source, 'model');
  assert.equal(out.productName, 'Roastery stock');
  assert.equal(out.screens[0].name, 'Stock');
  assert.equal(out.screens[0].purpose, 'On-hand beans by roast.');
  assert.equal(out.dataModel[0].fields[0], 'Roast');
  assert.equal(calls[0].body.max_tokens, 1600);
  assert.equal(calls[0].body.reasoning_effort, undefined);
  assert.equal(calls[0].body.chat_template_kwargs, undefined);
  const blob = JSON.stringify({ summary: out.summary, integrations: out.integrations, preview: out.preview });
  assert.doesNotMatch(blob, /\$\d|£\d|\b10000 customers\b|\b500 users\b|a month for/);
  assert.equal(out.summary, 'Tracks beans and alerts.');
  assert.equal(out.integrations[0].purpose, 'Reads the hopper.');
  assert.match(JSON.stringify(out.preview), /Espresso/);
});

test('generalcompute 404 discovers active models, retries once, and caches the list', async () => {
  const base = 'https://gc-discover.example/v1/';
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const target = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: target, method: opts.method, body, auth: opts.headers.Authorization });
    if (opts.method === 'GET') {
      return new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'deepseek-v3.2', object: 'model' },
          { id: 'gpt-oss-120b', object: 'model' },
          { id: 'minimax-m2.7', object: 'model' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (body.model === 'minimax-m2.7' || body.model === 'retired-model') {
      return new Response(JSON.stringify({
        error: { message: 'not active ' + gcKey, type: 'invalid_request_error', code: 'model_not_found' },
      }), { status: 404 });
    }
    return completion(beans);
  };
  const env = { GENERALCOMPUTE_API_KEY: gcKey, GENERALCOMPUTE_BASE_URL: base };
  const before = llmModelNotices().filter(line => line.includes('model=gpt-oss-120b')).length;
  const first = await clarifyDemo({ intent, env, fetchImpl, log() { throw new Error('success must not fallback-log'); } });
  assert.equal(first.source, 'model');
  assert.notEqual(first.source, 'fallback');
  assert.equal(first.questions[0].options[0], 'Espresso');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.model, 'minimax-m2.7');
  assert.equal(calls[1].method, 'GET');
  assert.match(calls[1].url, /\/v1\/models$/);
  assert.equal(calls[1].auth, 'Bearer ' + gcKey);
  assert.equal(calls[2].body.model, 'gpt-oss-120b');
  const gets = () => calls.filter(call => call.method === 'GET').length;
  assert.equal(gets(), 1);

  const second = await clarifyDemo({ intent, env, fetchImpl, log() { throw new Error('success must not fallback-log'); } });
  assert.equal(second.source, 'model');
  assert.equal(gets(), 1, 'cached discovery is not fetched again');
  assert.equal(calls.at(-1).body.model, 'gpt-oss-120b');
  const notes = llmModelNotices().filter(line => line.includes('model=gpt-oss-120b'));
  assert.equal(notes.length - before, 1);
  assert.match(notes.at(-1), /^compass demo llm model provider=generalcompute model=gpt-oss-120b$/);
  assert.equal(notes.at(-1).includes(gcKey), false);

  const explicit = [];
  await clarifyDemo({
    intent,
    env: { ...env, GENERALCOMPUTE_BASE_URL: 'https://gc-explicit.example/v1/', GENERALCOMPUTE_MODEL: 'retired-model' },
    fetchImpl: async (url, opts) => {
      const body = opts.body ? JSON.parse(opts.body) : null;
      explicit.push({ method: opts.method, model: body?.model });
      if (opts.method === 'GET') {
        return new Response(JSON.stringify({ data: [{ id: 'gemma-4-31B-it' }, { id: 'retired-model' }] }), { status: 200 });
      }
      if (body.model === 'retired-model') return new Response(JSON.stringify({ error: { code: 'model_not_found', type: 'invalid_request_error', message: 'gone' } }), { status: 404 });
      return completion(beans);
    },
    log() { throw new Error('success must not fallback-log'); },
  });
  assert.deepEqual(explicit.map(call => call.model ?? call.method), ['retired-model', 'GET', 'gemma-4-31B-it']);
});

test('a provider error code is logged without message text or secrets', async () => {
  const lines = [];
  const secretMessage = `The model does not exist ${gcKey} and the prompt must stay out of the log`;
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey, GENERALCOMPUTE_BASE_URL: 'https://gc-error.example/v1/' },
    fetchImpl: async (_url, opts) => {
      if (opts.method === 'GET') return new Response(JSON.stringify({ error: { message: secretMessage, code: 'server_error' } }), { status: 500 });
      return new Response(JSON.stringify({
        error: { message: secretMessage, type: 'invalid_request_error', code: 'model_not_found', param: null },
      }), { status: 404, headers: { 'content-type': 'application/json' } });
    },
    log: line => lines.push(line),
  });
  const local = clarifyLocal(intent);
  assert.equal(out.source, 'fallback');
  assert.deepEqual(out.questions, local.questions);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /route=clarify provider=generalcompute model=minimax-m2\.7 code=http status=404 category=http 404 error=model_not_found$/);
  assert.equal(lines[0].includes(gcKey), false);
  assert.equal(lines[0].includes('does not exist'), false);
  assert.equal(lines[0].includes('prompt must stay'), false);
  assert.equal(lines[0].includes(secretMessage), false);
  assert.equal(JSON.stringify(out).includes(gcKey), false);
});

test('nebius clarify uses the fast flavor and finishes inside the timeout', async () => {
  const calls = [];
  const started = Date.now();
  const out = await clarifyDemo({
    intent: 'A booking app for a small yoga studio',
    env: { NEBIUS_API_KEY: nebiusKey, LLM_PROVIDER: 'nebius', NEBIUS_TIMEOUT_MS: '1000' },
    fetchImpl: async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (body.model === 'zai-org/GLM-5.3') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })); };
          if (opts.signal?.aborted) abort();
          else opts.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return completion('{"questions":[{"prompt":"How do students book a class?","options":["Drop-in","Membership"]}]}');
    },
  });
  assert.equal(out.source, 'model');
  assert.equal(out.questions[0].prompt, 'How do students book a class?');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'zai-org/GLM-5.3-fast');
  assert.equal(calls[0].reasoning_effort, 'low');
  assert.equal(calls[0].max_tokens, 512);
  assert.equal(calls[0].max_completion_tokens, 512);
  assert.equal(calls[0].chat_template_kwargs, undefined);
  assert.ok(Date.now() - started < 1000);

  const pinned = [];
  await clarifyDemo({
    intent,
    env: { NEBIUS_API_KEY: nebiusKey, LLM_PROVIDER: 'nebius', NEBIUS_MODEL: 'zai-org/GLM-5.3' },
    fetchImpl: async (_url, opts) => {
      pinned.push(JSON.parse(opts.body));
      return completion(beans);
    },
  });
  assert.equal(pinned[0].model, 'zai-org/GLM-5.3');
  assert.equal(pinned[0].max_tokens, 512);
  assert.equal(pinned[0].reasoning_effort, 'low');

  const chosen = [];
  await clarifyDemo({
    intent,
    env: { NEBIUS_API_KEY: nebiusKey, LLM_PROVIDER: 'nebius', NEBIUS_FALLBACK_MODEL: 'openai/gpt-oss-120b' },
    fetchImpl: async (_url, opts) => {
      chosen.push(JSON.parse(opts.body).model);
      return completion(beans);
    },
  });
  assert.deepEqual(chosen, ['openai/gpt-oss-120b']);

  const recovered = [];
  const recoveredOut = await clarifyDemo({
    intent,
    env: { NEBIUS_API_KEY: nebiusKey, LLM_PROVIDER: 'nebius', NEBIUS_TIMEOUT_MS: '1000' },
    fetchImpl: async (_url, opts) => {
      const body = JSON.parse(opts.body);
      recovered.push(body.model);
      if (body.model.endsWith('-fast')) {
        return new Response(JSON.stringify({ error: { message: 'missing ' + nebiusKey, type: 'invalid_request_error', code: 'model_not_found' } }), { status: 404 });
      }
      return completion(beans);
    },
  });
  assert.deepEqual(recovered, ['zai-org/GLM-5.3-fast', 'zai-org/GLM-5.3']);
  assert.equal(recoveredOut.source, 'model');
  assert.equal(JSON.stringify(recoveredOut).includes(nebiusKey), false);

  const loaded = loadLlm({ NEBIUS_API_KEY: nebiusKey, NEBIUS_TIMEOUT_MS: '30000', LLM_PROVIDER: 'nebius' }, async () => { throw new Error('no network'); });
  assert.equal(loaded.clients[0].timeoutMs, 12000);
  assert.equal(loaded.timeoutMs, 12000);
  assert.equal(loaded.model, 'zai-org/GLM-5.3-fast');
});

test('no-key fallback stays local and a non-barber booking intent is not a barbershop', async () => {
  const yoga = 'A booking app for a small yoga studio';
  let called = false;
  const out = await clarifyDemo({
    intent: yoga,
    env: {},
    fetchImpl: async () => { called = true; throw new Error('no key'); },
  });
  const local = clarifyLocal(yoga);
  assert.equal(called, false);
  assert.equal(out.source, 'fallback');
  assert.equal(out.intent, yoga);
  assert.deepEqual(out.questions, local.questions);
  const blob = JSON.stringify(out.questions);
  assert.doesNotMatch(blob, /barber|haircut|beard/i);
  assert.match(blob, /Waitlist|class/i);
  const shop = clarifyLocal('a booking app for my barbershop with SMS reminders');
  assert.match(JSON.stringify(shop.questions), /Haircut/);
  const reading = clarifyLocal(intent);
  assert.equal(reading.questions[0].prompt, 'Who is it for?');
  assert.doesNotMatch(JSON.stringify(reading.questions), /barber|Haircut|Beard/);
});

test('one provider that returns truncated JSON logs a truncated fallback and keeps the local questions', async () => {
  const lines = [];
  const out = await clarifyDemo({
    intent,
    env: { GENERALCOMPUTE_API_KEY: gcKey },
    fetchImpl: async () => completion('{"questions":[{"prompt":"Which beans are running low today?"', { finishReason: 'length' }),
    log: line => lines.push(line),
  });
  assert.equal(out.source, 'fallback');
  assert.deepEqual(out.questions, clarifyLocal(intent).questions);
  assert.match(lines[0], /category=truncated/);
  assert.equal(lines[0].includes('Which beans'), false);
});
