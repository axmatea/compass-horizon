import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictation } from '../src/demo/voice.mjs';

function microphone(options = {}, overrides = {}) {
  let recognition;
  let field = '';
  const events = [];
  class Recognition {
    constructor() { recognition = this; }
    start() {}
    abort() { this.aborted = true; this.onend?.(); }
  }
  const dictation = createDictation({ SpeechRecognition: Recognition }, {
    onState: value => events.push(['state', value]),
    onTranscript: (value, meta) => { field = value; events.push(['text', value, meta.final]); },
    onSubmit: value => events.push(['submit', value]),
    onEnd: (reason, value) => events.push(['end', reason, value]),
    onError: (message, code) => events.push(['error', code, message]),
    ...overrides,
  }, options);
  return { dictation, events, recognition: () => recognition, field: () => field, edit: value => { field = value; } };
}

test('pause finalizes editable dictation without submitting or overwriting later edits', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mic = microphone({ pauseMs: 100, max: 500 });
  assert.equal(mic.dictation.start(), true);
  const speech = mic.recognition();
  assert.deepEqual(mic.events, [['state', 'starting']]);
  speech.onstart();
  assert.deepEqual(mic.events.at(-1), ['state', 'listening']);
  speech.onresult({ results: [{ isFinal: false, 0: { transcript: 'a bakery' } }] });
  assert.equal(mic.field(), 'a bakery');
  assert.deepEqual(mic.events.at(-1), ['text', 'a bakery', false]);
  speech.onresult({ results: [{ isFinal: true, 0: { transcript: 'a bakery website' } }] });
  t.mock.timers.tick(100);
  assert.equal(mic.dictation.active, false);
  assert.deepEqual(mic.events.at(-1), ['end', 'pause', 'a bakery website']);
  mic.edit('an edited bakery website');
  speech.onresult({ results: [{ isFinal: true, 0: { transcript: 'late stale result' } }] });
  t.mock.timers.tick(1000);
  assert.equal(mic.field(), 'an edited bakery website');
  assert.equal(mic.events.some(event => event[0] === 'submit'), false);
});

test('manual stop always clears listening state and sends one end notification', () => {
  const mic = microphone();
  mic.dictation.start();
  mic.recognition().onresult({ results: [{ isFinal: false, 0: { transcript: 'keep this' } }] });
  mic.dictation.stop();
  mic.dictation.stop();
  mic.recognition().onstart();
  assert.equal(mic.dictation.active, false);
  assert.equal(mic.recognition().aborted, true);
  assert.deepEqual(mic.events.slice(-2), [['state', 'idle'], ['end', 'stopped', 'keep this']]);
  assert.equal(mic.events.filter(event => event[0] === 'end').length, 1);
  assert.equal(mic.events.some(event => event[0] === 'state' && event[1] === 'listening'), false, 'a cancelled permission request cannot become listening later');
});

test('native end and transcript limit preserve text without submission', () => {
  const ended = microphone();
  ended.dictation.start();
  ended.recognition().onresult({ results: [{ isFinal: false, 0: { transcript: 'a page' } }] });
  ended.recognition().onend();
  assert.deepEqual(ended.events.at(-1), ['end', 'ended', 'a page']);
  const limited = microphone({ max: 5 });
  limited.dictation.start();
  limited.recognition().onresult({ results: [{ isFinal: true, 0: { transcript: 'abcdefgh' } }] });
  assert.deepEqual(limited.events.at(-1), ['end', 'limit', 'abcde']);
  assert.equal(limited.events.some(event => event[0] === 'submit'), false);
});

test('permission, no-speech, capture and network errors clear state and preserve editable text', () => {
  for (const code of ['not-allowed', 'service-not-allowed', 'no-speech', 'audio-capture', 'network']) {
    const mic = microphone();
    mic.dictation.start();
    mic.recognition().onresult({ results: [{ isFinal: false, 0: { transcript: 'keep draft' } }] });
    mic.recognition().onerror({ error: code });
    assert.equal(mic.dictation.active, false, code);
    assert.equal(mic.field(), 'keep draft');
    assert.deepEqual(mic.events.at(-1), ['end', 'error', 'keep draft']);
    assert.equal(mic.events.at(-2)[1], code);
    assert.equal(mic.events.some(event => event[0] === 'submit'), false);
  }
});

test('unsupported and failed start paths give an accurate idle result', () => {
  assert.equal(createDictation({}, {}), null);
  for (const constructorFailure of [false, true]) {
    const events = [];
    class Broken {
      constructor() { if (constructorFailure) throw new Error('construction failed'); }
      start() { throw new Error('start failed'); }
      abort() {}
    }
    const dictation = createDictation({ SpeechRecognition: Broken }, {
      onState: value => events.push(value),
      onError: (_message, code) => events.push(code),
      onEnd: reason => events.push(reason),
    });
    assert.equal(dictation.start(), false);
    assert.equal(dictation.active, false);
    assert.deepEqual(events, ['starting', 'idle', 'start-failed', 'error']);
  }
});

test('automatic submission requires explicit opt-in and still respects manual stop', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mic = microphone({ autoSubmit: true, pauseMs: 100 });
  mic.dictation.start();
  mic.recognition().onresult({ results: [{ isFinal: true, 0: { transcript: 'explicit legacy mode' } }] });
  t.mock.timers.tick(100);
  assert.deepEqual(mic.events.at(-1), ['submit', 'explicit legacy mode']);
  const stopped = microphone({ autoSubmit: true });
  stopped.dictation.start();
  stopped.recognition().onresult({ results: [{ isFinal: false, 0: { transcript: 'do not send' } }] });
  stopped.dictation.stop();
  t.mock.timers.tick(1000);
  assert.equal(stopped.events.some(event => event[0] === 'submit'), false);
});
