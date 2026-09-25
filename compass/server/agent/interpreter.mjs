// GLM-5.3 intent interpreter: state + utterance -> { set, unset, tool, reply }.
// The schema (function, prompt, validation) is pluggable per domain; the dinner intent is the default
// and server/agent/site-interpreter.mjs supplies the website brief.
import { parseJsonLoose, LlmError } from '../llm/nebius.mjs';
import { FIELDS } from '../state/intent.mjs';

/** Forced function call. Measured 2026-09-18: json_object mode echoed the old state
 * on corrections (4/4 wrong), function calling was correct 8/8 at ~360ms. */
export function buildIntentFunction(tools) {
  return {
    type: 'function',
    function: {
      name: 'update_intent',
      description: 'Record the intent update for this utterance.',
      parameters: {
        type: 'object',
        properties: {
          set: {
            type: 'object',
            description: 'Only fields newly provided or changed in this utterance.',
            properties: {
              task: { type: 'string' }, date: { type: 'string' },
              time: { type: 'string', description: '24h HH:MM' },
              location: { type: 'string' }, cuisine: { type: 'string' }, party_size: { type: 'integer' },
            },
            additionalProperties: false,
          },
          unset: { type: 'array', items: { type: 'string' } },
          tool: { type: ['string', 'null'], enum: [...tools.map((t) => t.name), null] },
          reply: { type: 'string' },
        },
        required: ['set', 'unset', 'tool', 'reply'],
      },
    },
  };
}

export function buildSystemPrompt(tools) {
  const toolLines = tools.length ? tools.map((t) => `- ${t.name}: ${t.description} (needs: ${t.requires.join(', ') || 'nothing'})`).join('\n') : '- none';
  return `You are the intent interpreter of COMPASS, a voice assistant that keeps a structured intent state and adapts while acting.
Given CURRENT_STATE and the user's latest UTTERANCE, call update_intent with:
{"set": {"<field>": <value>}, "unset": ["<field>"], "tool": "<tool name>" or null, "reply": "<string>"}
Fields:
- task: short lowercase verb phrase, e.g. "schedule dinner"
- date: as spoken, e.g. "tomorrow", or YYYY-MM-DD
- time: 24h HH:MM. An explicit AM/PM always wins ("8 AM", "8 in the morning", "9 утра" -> morning; "7 PM", "7 вечера" -> evening). Only a BARE hour for dinner means PM ("7" -> "19:00")
- location: place name only, e.g. "Palo Alto"
- cuisine: one word, e.g. "Italian"
- party_size: integer
Rules:
- The utterance may start a new intent, correct it, or extend it.
- "set" contains ONLY fields the user newly provided or changed in THIS utterance. Never repeat unchanged fields. Never invent values.
- "actually", "make it", "instead", "change to" replace the old value.
- A bare number ("make it eight", "make it 8", "сделай в девять") is the TIME (dinner -> PM). It is party_size ONLY if people are mentioned ("for eight", "eight people", "table for 8", "нас восемь").
- A question that proposes a change ("can we change it to X?", "what about X?", "could we do X?") IS a change request: apply X.
- "date" keeps relative phrases as spoken ("next week", "the week after next").
- "unset" only if the user explicitly drops a detail.
- "tool": pick a tool only if the user's goal needs it now, else null. If the user asked for it but a needed field is missing, STILL set the tool (COMPASS waits for the field) and ask for the missing field in "reply".
Tools:
${toolLines}
- "reply": ALWAYS one short spoken sentence, max 14 words, acknowledging what changed, written in the language given by LANG (en = English, ru = Russian). Never empty. Never claim a booking or message was completed. COMPASS cannot book, reserve, send, invite or confirm anything; never offer to. It can only keep the plan and search places. In Russian avoid gendered first-person past tense (say "Перенесено на ...", "Записано", not "перенёс/перенесла"). Never say "Done"/"Готово": updating the plan is not completing the task.
- Field values are ALWAYS canonical English regardless of LANG: "завтра" -> "tomorrow", "через две недели" -> "the week after next", "в девять" -> "21:00", "Пало-Альто" -> "Palo Alto", "итальянский" -> "Italian".
Always include all four keys. Example:
CURRENT_STATE {"task":"schedule dinner","time":"19:00","location":null,"cuisine":"Italian"}
UTTERANCE "no, 7:30, and somewhere in San Mateo"
OUTPUT {"set":{"time":"19:30","location":"San Mateo"},"unset":[],"tool":null,"reply":"Changed to 7:30 in San Mateo."}`;
}

export function validateInterpretation(obj) {
  const out = { set: {}, unset: [], tool: null, reply: '' };
  // Accept {set:{...}} (instructed) or a flat object of fields (observed GLM drift).
  const source = obj && typeof obj.set === 'object' && !Array.isArray(obj.set) ? obj.set : obj && typeof obj === 'object' ? obj : {};
  for (const [k, v] of Object.entries(source)) if (FIELDS.includes(k)) out.set[k] = v;
  if (Array.isArray(obj?.unset)) out.unset = obj.unset.filter((f) => FIELDS.includes(f));
  if (typeof obj?.tool === 'string' && obj.tool.trim() && !/^(none|null)$/i.test(obj.tool.trim())) out.tool = obj.tool.trim();
  if (typeof obj?.reply === 'string') out.reply = obj.reply.trim().slice(0, 240);
  return out;
}

/** Dinner intent schema (default). */
export const DINNER_SCHEMA = Object.freeze({ name: 'update_intent', stateKey: 'CURRENT_STATE', buildPrompt: buildSystemPrompt, buildFunction: buildIntentFunction, validate: validateInterpretation });

/** A usable interpretation must carry at least one of set / reply / tool. */
function isMeaningful(obj) {
  return Boolean(obj && typeof obj === 'object' && (('set' in obj) || (typeof obj.reply === 'string' && obj.reply.trim()) || ('tool' in obj)));
}

/**
 * Measured 2026-09-18 on Nebius GLM-5.3 (3 runs x 5 canonical utterances):
 *   tool_choice "required": ~250 ms, but returned {} for "Can we change it for next week?"
 *   tool_choice "auto":     ~450-900 ms, but made no call for "make it 8" / "we are four".
 * No single mode is reliable; together they cover all cases. By default both run in parallel
 * and the first meaningful result wins (latency = fastest good answer, ~2x tokens).
 * (Named forced tool_choice also returned {}.)
 */
export const INTERPRET_MODES = Object.freeze(['required', 'auto']);

export function createGlmInterpreter(llm, { schema = DINNER_SCHEMA, maxTokens = 300, attemptTimeoutMs = 8000, retries = 1, modes = INTERPRET_MODES, parallel = true } = {}) {
  async function once({ state, text, lang, tools, signal }, toolChoice) {
    const attempt = AbortSignal.timeout(attemptTimeoutMs);
    const r = await llm.chat({
      messages: [
        { role: 'system', content: schema.buildPrompt(tools) },
        { role: 'user', content: JSON.stringify({ [schema.stateKey || 'CURRENT_STATE']: state.intent, LANG: lang || 'en', UTTERANCE: text }) },
      ],
      tools: [schema.buildFunction(tools)],
      toolChoice,
      temperature: 0,
      maxTokens,
      signal: signal ? AbortSignal.any([signal, attempt]) : attempt,
    }).catch((err) => {
      // Per-attempt timeout surfaces as 'aborted' from the client; relabel it.
      if (err.code === 'aborted' && attempt.aborted && !signal?.aborted) err.code = 'timeout';
      throw err;
    });
    const call = r.message?.tool_calls?.find((c) => c.function?.name === schema.name);
    const raw = call?.function?.arguments ?? r.message?.content;
    let parsed = null;
    try { parsed = raw ? (typeof raw === 'string' ? parseJsonLoose(raw) : raw) : null; } catch { parsed = null; }
    if (!isMeaningful(parsed)) throw Object.assign(new LlmError(`Empty interpretation (${typeof toolChoice === 'string' ? toolChoice : 'named'})`, { code: 'parse' }), { latencyMs: r.latencyMs });
    return { ...schema.validate(parsed), latencyMs: r.latencyMs, mode: toolChoice };
  }

  /** Run all modes in parallel; first meaningful result wins, the rest are aborted. */
  function race(input) {
    const controllers = modes.map(() => new AbortController());
    const signalFor = (i) => (input.signal ? AbortSignal.any([input.signal, controllers[i].signal]) : controllers[i].signal);
    return new Promise((resolve, reject) => {
      let pending = modes.length;
      let lastErr;
      modes.forEach((mode, i) => {
        once({ ...input, signal: signalFor(i) }, mode).then(
          (out) => { controllers.forEach((c, j) => j !== i && c.abort()); resolve(out); },
          (err) => { lastErr = err; if (--pending === 0) reject(lastErr); },
        );
      });
    });
  }

  return {
    async interpret(input) {
      let lastErr;
      for (let i = 0; i <= retries; i++) {
        try {
          const out = parallel ? await race(input) : await sequential(input);
          return i ? { ...out, retried: i } : out;
        } catch (err) {
          lastErr = err;
          if (input.signal?.aborted || !['timeout', 'network', 'parse', 'http', 'aborted'].includes(err.code) || (err.code === 'http' && err.status < 500 && err.status !== 429)) throw err;
        }
      }
      throw lastErr;
    },
  };

  async function sequential(input) {
    let spent = 0; let lastErr;
    for (const mode of modes) {
      try { const out = await once(input, mode); return { ...out, latencyMs: spent + out.latencyMs, ...(mode !== modes[0] ? { fellBack: true } : {}) }; }
      catch (err) { lastErr = err; spent += err.latencyMs || 0; if (input.signal?.aborted) throw err; }
    }
    throw lastErr;
  }
}
