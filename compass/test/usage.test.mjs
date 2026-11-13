import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, completeJson, loadLlm, LlmError } from '../llm.mjs';
import { normalizeProviderUsage, withUsageTracking } from '../usage.mjs';

const key = 'usage-private-key-sentinel';
const prompt = 'private-prompt-sentinel-not-for-accounting';
const answer = 'private-answer-sentinel-not-for-accounting';
const jsonResponse = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const anthropic = (content = '{"valid":true}', usage, model) => jsonResponse({ content: [{ type: 'text', text: content }], stop_reason: 'end_turn', usage, model });
const compatible = (content = '{"valid":true}', usage) => jsonResponse({ choices: [{ message: { content }, finish_reason: 'stop' }], usage });
const makeClient = (provider, fetchImpl, extra = {}) => createClient({
  provider, apiKey: key, baseUrl: `https://${provider}.usage-test.example/v1/`,
  model: `${provider}-usage-model`, timeoutMs: 1000, fetchImpl, ...extra,
});
const request = clients => completeJson({ clients, messages: [{ role: 'user', content: prompt }], maxTokens: 300, accept: value => value.valid === true });

test('Anthropic accounting preserves actual cache categories and a single accepted receipt', async () => {
  const events = [];
  const usage = { input_tokens: 91, output_tokens: 17, cache_read_input_tokens: 200, cache_creation_input_tokens: 40, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 30 }, output_tokens_details: { thinking_tokens: 8 }, private_extra: answer };
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => anthropic('{"valid":true,"body":"' + answer + '"}', usage, 'claude-response-model-version')),
  ]));
  assert.equal(result.json.valid, true);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.match(event.id, /^[a-f0-9-]{36}$/);
  assert.equal(event.provider, 'anthropic');
  assert.equal(event.model, 'anthropic-usage-model');
  assert.equal(event.reportedModel, 'claude-response-model-version');
  assert.equal(event.status, 'accepted');
  assert.equal(event.usageComplete, true);
  assert.equal(event.httpStatus, 200);
  assert.equal(event.inputTokenBasis, 'excludes_cache');
  assert.equal(event.inputTokens, 91);
  assert.equal(event.outputTokens, 17);
  assert.equal(event.cacheReadTokens, 200);
  assert.equal(event.cacheWriteTokens, 40);
  assert.equal(event.cacheWrite5mTokens, 10);
  assert.equal(event.cacheWrite1hTokens, 30);
  assert.equal(event.reasoningTokens, 8);
  assert.equal(event.totalTokens, null, 'a missing total is not invented');
  assert.ok(event.durationMs >= 0);
  assert.ok(Number.isFinite(Date.parse(event.startedAt)));
  assert.ok(Object.isFrozen(event));
  assert.doesNotMatch(JSON.stringify(events), new RegExp([key, prompt, answer].join('|')));
  assert.equal('private_extra' in event, false);
  assert.equal('cost' in event, false);
});

function sseFrame(type, value = {}) { return `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`; }
function sseDocument(text = '{"valid":true}', { thinking = false, terminal = true, finalUsage = true, error = false } = {}) {
  let value = sseFrame('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', content: [], model: 'claude-stream-version', usage: {
    input_tokens: 24, output_tokens: 1, cache_read_input_tokens: 12, cache_creation_input_tokens: 4,
    cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 1 },
  } } });
  value += sseFrame('ping');
  value += sseFrame('future_protocol_notice', { future: true });
  let index = 0;
  if (thinking) {
    value += sseFrame('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    value += sseFrame('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: 'private-thinking-sentinel' } });
    value += sseFrame('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'private-signature-sentinel' } });
    value += sseFrame('content_block_stop', { index }); index += 1;
  }
  value += sseFrame('content_block_start', { index, content_block: { type: 'text', text: '' } });
  const middle = Math.floor(text.length / 2);
  value += sseFrame('content_block_delta', { index, delta: { type: 'text_delta', text: text.slice(0, middle) } });
  value += sseFrame('content_block_delta', { index, delta: { type: 'text_delta', text: text.slice(middle) } });
  if (error) return value + sseFrame('error', { error: { type: 'overloaded_error', message: key + prompt } });
  value += sseFrame('content_block_stop', { index });
  value += sseFrame('message_delta', { delta: { stop_reason: null }, ...(finalUsage ? { usage: { output_tokens: 7 } } : {}) });
  value += sseFrame('message_delta', { delta: { stop_reason: 'end_turn' }, ...(finalUsage ? { usage: { output_tokens: 9, output_tokens_details: { thinking_tokens: thinking ? 3 : 0 } } } : {}) });
  if (terminal) value += sseFrame('message_stop');
  return value;
}
function streamResponse(text, { chunks = [1, 7, 23], canceled } = {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0, count = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(bytes.length, offset + chunks[count++ % chunks.length]);
      controller.enqueue(bytes.slice(offset, end)); offset = end;
    },
    cancel() { canceled?.(); },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

test('opt-in Anthropic provider SSE handles real fragmented UTF-8 frames and cumulative usage', async () => {
  const events = [], bodies = [];
  const loaded = loadLlm({ ANTHROPIC_API_KEY: key, ANTHROPIC_MODEL: 'claude-fixture', ANTHROPIC_STREAMING: 'on' }, async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return streamResponse(sseDocument('{"valid":true,"label":"Café 🧭"}'));
  });
  const result = await withUsageTracking(event => events.push(event), () => request(loaded.clients));
  assert.equal(result.json.label, 'Café 🧭');
  assert.equal(bodies[0].stream, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'accepted');
  assert.equal(events[0].usageComplete, true);
  assert.equal(events[0].inputTokens, 24);
  assert.equal(events[0].outputTokens, 9, 'cumulative deltas are not added together');
  assert.equal(events[0].cacheReadTokens, 12);
  assert.equal(events[0].cacheWriteTokens, 4);
  assert.equal(events[0].cacheWrite5mTokens, 3);
  assert.equal(events[0].cacheWrite1hTokens, 1);
  assert.equal(events[0].reportedModel, 'claude-stream-version');
  assert.doesNotMatch(JSON.stringify(events), /Café|usage-private-key|private-prompt/);
});

test('thinking and signature deltas stay out of usage receipts while structured text is validated', async () => {
  const events = [];
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => streamResponse(sseDocument('{"valid":true}', { thinking: true })), { streaming: true }),
  ]));
  assert.equal(result.json.valid, true);
  assert.equal(events[0].reasoningTokens, 3);
  assert.equal(events[0].outputTokens, 9);
  assert.doesNotMatch(JSON.stringify(events), /private-thinking|private-signature/);
});

test('an interrupted provider stream cannot complete even when its partial text is valid JSON', async () => {
  const events = [];
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => streamResponse(sseDocument('{"valid":true}', { terminal: false })), { streaming: true }),
  ]));
  assert.equal(result.json, null);
  assert.equal(result.failures[0].code, 'parse');
  assert.equal(events[0].status, 'parse_error');
  assert.equal(events[0].usageComplete, false);
  assert.equal(events[0].outputTokens, 9, 'reported partial counters are retained without claiming finality');
});

test('provider SSE error frames preserve partial usage and trigger the existing next-provider fallback', async () => {
  const events = [];
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => streamResponse(sseDocument('{"valid":true}', { error: true })), { streaming: true }),
    makeClient('generalcompute', async (_url, options) => {
      assert.equal(JSON.parse(options.body).stream, undefined);
      return compatible('{"valid":true}', { prompt_tokens: 5, completion_tokens: 6 });
    }),
  ]));
  assert.equal(result.provider, 'generalcompute');
  assert.deepEqual(events.map(event => event.status), ['error', 'accepted']);
  assert.deepEqual(events.map(event => event.usageComplete), [false, true]);
  assert.doesNotMatch(JSON.stringify(events), new RegExp([key, prompt].join('|')));
});

test('provider stream cancellation and timeout interrupt pending body reads without waiting for EOF', async t => {
  for (const mode of ['aborted', 'timeout']) await t.test(mode, async () => {
    const events = [], controller = new AbortController(); let canceled = 0, emitted = false;
    const prefix = sseFrame('message_start', { message: { type: 'message', role: 'assistant', content: [], model: 'claude-fixture', usage: { input_tokens: 20, output_tokens: 1 } } });
    const client = makeClient('anthropic', async () => new Response(new ReadableStream({
      pull(stream) { if (!emitted) { emitted = true; stream.enqueue(new TextEncoder().encode(prefix)); } },
      cancel() { canceled += 1; },
    }), { headers: { 'content-type': 'text/event-stream' } }), { streaming: true, timeoutMs: 100 });
    const keepAlive = setTimeout(() => {}, 1000);
    const abortTimer = mode === 'aborted' ? setTimeout(() => controller.abort(), 20) : null;
    try {
      await assert.rejects(withUsageTracking(event => events.push(event), () => client.chat({ messages: [], signal: controller.signal })), error => error.code === mode);
    } finally { clearTimeout(keepAlive); if (abortTimer) clearTimeout(abortTimer); }
    assert.equal(events[0].status, mode); assert.equal(events[0].usageComplete, false);
    assert.equal(events[0].httpStatus, 200); assert.equal(events[0].inputTokens, 20);
    assert.ok(canceled > 0);
  });
});

test('provider streams enforce byte limits and reject malformed lifecycle events', async () => {
  for (const [payload, extra] of [
    [sseDocument('{"valid":true,"large":"' + 'x'.repeat(4000) + '"}'), { maxResponseBytes: 512 }],
    [sseDocument().replace('"index":0,"content_block"', '"index":2,"content_block"'), {}],
    [sseDocument().replace(sseFrame('content_block_stop', { index: 0 }), ''), {}],
  ]) {
    const events = [];
    const result = await withUsageTracking(event => events.push(event), () => request([
      makeClient('anthropic', async () => streamResponse(payload), { streaming: true, ...extra }),
    ]));
    assert.equal(result.json, null); assert.equal(events[0].usageComplete, false);
  }
});

test('a complete stream without final usage delivers content but never labels partial usage as final', async () => {
  const events = [];
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => streamResponse(sseDocument('{"valid":true}', { finalUsage: false })), { streaming: true }),
  ]));
  assert.equal(result.json.valid, true);
  assert.equal(events[0].usageComplete, false);
  assert.equal(events[0].outputTokens, 1);
});

test('unexpected streamed tool blocks are not executed or accepted as page output', async () => {
  const events = [];
  const value = sseFrame('message_start', { message: { type: 'message', role: 'assistant', content: [], usage: { input_tokens: 10, output_tokens: 1 } } })
    + sseFrame('content_block_start', { index: 0, content_block: { type: 'tool_use', name: 'execute_shell', input: { command: 'private-command-sentinel' } } }) + sseFrame('message_stop');
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => streamResponse(value), { streaming: true }),
  ]));
  assert.equal(result.json, null);
  assert.equal(events[0].usageComplete, false);
  assert.doesNotMatch(JSON.stringify(events), /execute_shell|private-command/);
});

test('compatible providers retain inclusive input counts without adding cache tokens twice', async () => {
  const events = [];
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('nebius', async () => compatible('{"valid":true}', {
      prompt_tokens: 128, completion_tokens: 9, total_tokens: 137,
      prompt_tokens_details: { cached_tokens: 96, cache_write_tokens: 16 },
      completion_tokens_details: { reasoning_tokens: 4 },
    })),
  ]));
  assert.equal(result.provider, 'nebius');
  assert.equal(events[0].inputTokenBasis, 'includes_cache');
  assert.equal(events[0].inputTokens, 128);
  assert.equal(events[0].cacheReadTokens, 96);
  assert.equal(events[0].cacheWriteTokens, 16);
  assert.equal(events[0].totalTokens, 137);
  assert.equal(events[0].reasoningTokens, 4);
});

test('rejected model shapes and non-JSON output retain billed usage before provider fallback', async () => {
  const events = [];
  const clients = [
    makeClient('anthropic', async () => anthropic('{"wrong":true}', { input_tokens: 5, output_tokens: 6 })),
    makeClient('generalcompute', async () => compatible('This is not JSON', { prompt_tokens: 7, completion_tokens: 8 })),
    makeClient('nebius', async () => compatible('{"valid":true}', { prompt_tokens: 9, completion_tokens: 10 })),
  ];
  const result = await withUsageTracking(event => events.push(event), () => request(clients));
  assert.equal(result.provider, 'nebius');
  assert.deepEqual(events.map(event => event.status), ['rejected_shape', 'parse_error', 'accepted']);
  assert.deepEqual(events.map(event => event.outputTokens), [6, 8, 10]);
  assert.equal(new Set(events.map(event => event.id)).size, 3);
});

test('HTTP errors and GC missing-model retries each record once; model-list GET is not billed', async () => {
  const events = [];
  let posts = 0;
  let gets = 0;
  const client = makeClient('generalcompute', async (_url, options) => {
    if (options.method === 'GET') { gets += 1; return jsonResponse({ data: [{ id: 'gpt-oss-120b' }] }); }
    posts += 1;
    if (posts === 1) return new Response(JSON.stringify({ error: { code: 'model_not_found', message: prompt + key }, usage: { prompt_tokens: 3, completion_tokens: 0 } }), { status: 404 });
    return compatible('{"valid":true}', { prompt_tokens: 11, completion_tokens: 12 });
  }, { baseUrl: 'https://usage-discovery-dedicated.example/v1/' });
  const result = await withUsageTracking(event => events.push(event), () => request([client]));
  assert.equal(result.model, 'gpt-oss-120b');
  assert.equal(posts, 2);
  assert.equal(gets, 1);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.status), ['http_error', 'accepted']);
  assert.deepEqual(events.map(event => event.httpStatus), [404, 200]);
  assert.deepEqual(events.map(event => event.inputTokens), [3, 11]);
  assert.equal(events[0].outputTokens, 0, 'reported zero stays distinct from unknown');
  assert.doesNotMatch(JSON.stringify(events), new RegExp([key, prompt].join('|')));
});

test('an HTTP-successful malformed response records unknown usage instead of a zero charge', async () => {
  const events = [];
  const result = await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => new Response('not JSON ' + key, { status: 200 })),
  ]));
  assert.equal(result.json, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'parse_error');
  assert.equal(events[0].httpStatus, 200);
  assert.equal(events[0].inputTokens, null);
  assert.equal(events[0].outputTokens, null);
  assert.doesNotMatch(JSON.stringify(events), /not JSON|usage-private-key/);
});

test('network errors, real abort deadlines and explicit cancellation record no guessed usage', async t => {
  for (const kind of ['network_error', 'timeout', 'aborted']) {
    await t.test(kind, async () => {
      const events = [];
      const controller = new AbortController();
      const client = makeClient('anthropic', async (_url, options) => {
        if (kind === 'network_error') throw new Error(prompt + key);
        return new Promise((resolve, reject) => {
          const fail = () => reject(Object.assign(new Error(answer), { name: 'AbortError' }));
          if (options.signal.aborted) fail();
          else options.signal.addEventListener('abort', fail, { once: true });
          if (kind === 'aborted') controller.abort();
        });
      }, { timeoutMs: 20 });
      // AbortSignal.timeout is intentionally unref'd; keep the test process alive.
      const keepAlive = setTimeout(() => {}, 1000);
      try {
        await assert.rejects(withUsageTracking(event => events.push(event), () => client.chat({ messages: [{ role: 'user', content: prompt }], signal: controller.signal })), LlmError);
      } finally { clearTimeout(keepAlive); }
      assert.equal(events.length, 1);
      assert.equal(events[0].status, kind);
      assert.equal(events[0].httpStatus, null);
      assert.equal(events[0].inputTokens, null);
      assert.equal(events[0].outputTokens, null);
      assert.doesNotMatch(JSON.stringify(events), new RegExp([key, prompt, answer].join('|')));
    });
  }
});

test('concurrent operations have independent asynchronous accounting scopes', async () => {
  const a = [];
  const b = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = withUsageTracking(event => a.push(event), () => request([
    makeClient('anthropic', async () => { await gate; return anthropic('{"valid":true}', { input_tokens: 10, output_tokens: 1 }); }, { model: 'scope-a' }),
  ]));
  const second = withUsageTracking(async event => { await Promise.resolve(); b.push(event); }, () => request([
    makeClient('nebius', async () => { release(); return compatible('{"valid":true}', { prompt_tokens: 20, completion_tokens: 2 }); }, { model: 'scope-b' }),
  ]));
  await Promise.all([first, second]);
  assert.deepEqual(a.map(event => event.model), ['scope-a']);
  assert.deepEqual(b.map(event => event.model), ['scope-b']);
  assert.notEqual(a[0].id, b[0].id);
});

test('a response body that exceeds the shared deadline records timeout rather than malformed JSON', async () => {
  const events = [];
  const client = makeClient('anthropic', async (_url, options) => ({
    ok: true,
    status: 200,
    json: () => new Promise((resolve, reject) => {
      const fail = () => reject(Object.assign(new Error(answer), { name: 'AbortError' }));
      if (options.signal.aborted) fail();
      else options.signal.addEventListener('abort', fail, { once: true });
    }),
  }), { timeoutMs: 20 });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await withUsageTracking(event => events.push(event), () => request([client]));
    assert.equal(result.json, null);
    assert.equal(result.failures[0].code, 'timeout');
  } finally { clearTimeout(keepAlive); }
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'timeout');
  assert.equal(events[0].httpStatus, 200);
  assert.equal(events[0].outputTokens, null);
});

test('all receipts are flushed when an async persistence callback fails', async () => {
  const events = [];
  const failure = new Error('test ledger unavailable');
  await assert.rejects(withUsageTracking(async event => {
    events.push(event);
    if (events.length === 1) throw failure;
  }, () => request([
    makeClient('anthropic', async () => anthropic('{"wrong":true}', { input_tokens: 1, output_tokens: 2 })),
    makeClient('nebius', async () => compatible('{"valid":true}', { prompt_tokens: 3, completion_tokens: 4 })),
  ])), error => error === failure);
  assert.deepEqual(events.map(event => event.status), ['rejected_shape', 'accepted']);
});

test('exceptions from the operation are preserved after usage persistence, including falsy throws', async () => {
  const events = [];
  const failure = new Error('operation failed');
  await assert.rejects(withUsageTracking(event => events.push(event), async () => {
    await request([makeClient('anthropic', async () => anthropic('{"valid":true}', { input_tokens: 1, output_tokens: 2 }))]);
    throw failure;
  }), error => error === failure);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'accepted');
  let threw = false;
  try { await withUsageTracking(() => {}, async () => { throw null; }); }
  catch (error) { threw = true; assert.equal(error, null); }
  assert.equal(threw, true);
});

test('missing providers make no accounting events and direct chat remains completed, not accepted', async () => {
  const events = [];
  const loaded = loadLlm({ COMPASS_DEMO_MODE: 'examples', ANTHROPIC_API_KEY: key });
  const local = await withUsageTracking(event => events.push(event), () => request(loaded.clients));
  assert.equal(local.json, null);
  assert.equal(events.length, 0);
  await withUsageTracking(event => events.push(event), () => makeClient('anthropic', async () => anthropic()).chat({ messages: [] }));
  assert.equal(events[0].status, 'completed', 'transport completion is not application-level validation');
  assert.equal(events[0].inputTokens, null);
});

test('usage normalization rejects unsafe counters and never copies provider fields or key-like models', async () => {
  const normalized = normalizeProviderUsage('anthropic', {
    input_tokens: '14', output_tokens: -1, total_tokens: Number.MAX_SAFE_INTEGER + 1,
    cache_read_input_tokens: true, cache_creation_input_tokens: 0.5,
    cache_creation: { ephemeral_5m_input_tokens: 0 }, secret: key,
  });
  assert.equal(normalized.inputTokens, null);
  assert.equal(normalized.outputTokens, null);
  assert.equal(normalized.totalTokens, null);
  assert.equal(normalized.cacheReadTokens, null);
  assert.equal(normalized.cacheWriteTokens, null);
  assert.equal(normalized.cacheWrite5mTokens, 0);
  assert.equal('secret' in normalized, false);
  const events = [];
  await withUsageTracking(event => events.push(event), () => request([
    makeClient('anthropic', async () => anthropic('{"valid":true}'), { model: key }),
  ]));
  assert.equal(events[0].model, null);
  assert.equal(JSON.stringify(events).includes(key), false);
  const lines = [];
  const originalError = console.error;
  console.error = line => lines.push(line);
  try {
    await withUsageTracking(event => events.push(event), () => request([
      makeClient('nebius', async () => compatible('{"valid":true}'), { model: key }),
    ]));
  } finally { console.error = originalError; }
  assert.equal(events[1].model, null);
  assert.equal(lines.join('\n').includes(key), false);
});
