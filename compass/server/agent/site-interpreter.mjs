// GLM-5.3 interpreter for the website brief: CURRENT_SPEC + utterance -> partial spec update.
// Same mechanics as the dinner interpreter (forced function call, required/auto race); only the
// schema differs. The model never writes the page: it patches the brief, write_copy writes words,
// the renderer draws.
import { createGlmInterpreter } from './interpreter.mjs';
import { SITE_FIELDS, SECTIONS, THEMES, ACCENTS, FONTS, HEROES } from '../state/site.mjs';

export function buildSiteFunction(tools) {
  const str = { type: 'string' };
  return {
    type: 'function',
    function: {
      name: 'update_site',
      description: 'Record how this utterance changes the website brief.',
      parameters: {
        type: 'object',
        properties: {
          set: {
            type: 'object',
            description: 'Only fields newly provided or changed in this utterance.',
            properties: {
              business: str, kind: str, audience: str, tone: str,
              theme: { type: 'string', enum: [...THEMES] }, accent: { type: 'string', enum: [...ACCENTS] },
              font: { type: 'string', enum: [...FONTS] }, hero: { type: 'string', enum: [...HEROES] },
              sections: { type: 'array', items: { type: 'string', enum: [...SECTIONS] }, description: 'Full ordered list; only on a new site or to reorder.' },
              headline: str, subhead: str, cta: str, lang: str,
            },
            additionalProperties: false,
          },
          add_sections: { type: 'array', items: { type: 'string', enum: [...SECTIONS] } },
          remove_sections: { type: 'array', items: { type: 'string', enum: [...SECTIONS] } },
          unset: { type: 'array', items: { type: 'string' } },
          tool: { type: ['string', 'null'], enum: [...tools.map((t) => t.name), null] },
          reply: { type: 'string' },
        },
        required: ['set', 'unset', 'tool', 'reply'],
      },
    },
  };
}

export function buildSitePrompt(tools) {
  const toolLines = tools.length ? tools.map((t) => `- ${t.name}: ${t.description} (needs: ${t.requires.join(', ') || 'nothing'})`).join('\n') : '- none';
  return `You are the intent interpreter of COMPASS, a voice agent that keeps a structured website brief (the SPEC) and updates it while the user talks. The user describes a website out loud, then changes their mind. Given CURRENT_SPEC and the latest UTTERANCE, call update_site with ONLY what this utterance changes.
Fields:
- business: proper name of the business, project or person the site is for, e.g. "Northwind Coffee". Omit if not said.
- kind: what it is, short noun phrase, e.g. "coffee roastery", "AI startup", "wedding photographer", "hackathon meetup page". Required on a new site: infer it from context if not said.
- audience: who it is for, short. Optional.
- tone: 1-3 words, e.g. "warm", "premium and calm", "playful".
- theme: "light" or "dark". "darker", "dark mode", "black", "moody" -> dark. "lighter", "bright", "white" -> light.
- accent: one of ${ACCENTS.join(', ')}. Colours map: green -> emerald, blue -> sky, purple -> violet, pink -> rose, orange -> amber, red -> coral, grey -> slate, yellow or warm -> gold.
- font: "serif" (editorial, classic), "sans" (clean, modern), "display" (bold, loud).
- hero: layout of the top section: "centered", "split" (text left, visual right) or "poster" (full-bleed visual). "change the hero", "different hero", "new hero" -> choose a layout DIFFERENT from the current one.
- sections: ordered list from ${SECTIONS.join(', ')}. Use add_sections for "add a product section", "add pricing"; remove_sections for "remove the FAQ". Set the full "sections" list only on a new site or to reorder.
- headline, subhead, cta: ONLY when the user dictates or asks to change the words themselves ("the headline should say ...", "call the button Join"). Otherwise omit: COMPASS writes the copy.
- lang: language code of the page copy ("en", "ru"). Set only when the user asks for a language.
Rules:
- NEW SITE (CURRENT_SPEC.kind is null): set kind (and business if named), tone, theme, accent, font, hero and 2-4 sections that fit (a landing page usually gets features plus signup or contact; a shop gets products; a portfolio gets gallery). Pick design values that fit the request, never leave them empty.
- LATER UTTERANCES: "set" contains ONLY the fields the user changed now. Never repeat unchanged fields. Never invent facts.
- "actually", "make it", "instead", "change" replace the old value. A question that proposes a change ("could it be darker?") IS a change request.
- Unrelated remarks or greetings change nothing: empty set, tool null, short reply.
- "tool": "write_copy" when a site is started, when sections are added, or when business, kind, audience, tone, hero, headline, subhead or cta changed. null for pure design changes (theme, accent, font, reorder, remove).
Tools:
${toolLines}
- "reply": ONE short spoken sentence, max 12 words, in the language LANG (en = English, ru = Russian), saying what is happening now, e.g. "Building a warm landing page for Northwind Coffee." or "Going dark, new hero, and adding products." Never say published, deployed, live, online or launched: the page is only rendered in the preview. Never say "Done".
- Field values are ALWAYS English (kind, tone, audience) except headline/subhead/cta, which follow the page language.
Always include set, unset, tool and reply. Example:
CURRENT_SPEC {"business":"Northwind Coffee","kind":"coffee roastery","theme":"light","accent":"gold","font":"sans","hero":"centered","sections":["features","signup"]}
UTTERANCE "Make it darker, change the hero and add a product section."
OUTPUT {"set":{"theme":"dark","hero":"split"},"add_sections":["products"],"unset":[],"tool":"write_copy","reply":"Going dark, switching the hero, adding products."}`;
}

export function validateSiteInterpretation(obj) {
  const out = { set: {}, unset: [], add_sections: [], remove_sections: [], tool: null, reply: '' };
  const source = obj && typeof obj.set === 'object' && !Array.isArray(obj.set) ? obj.set : obj && typeof obj === 'object' ? obj : {};
  for (const [k, v] of Object.entries(source)) if (SITE_FIELDS.includes(k)) out.set[k] = v;
  for (const k of ['add_sections', 'remove_sections']) if (Array.isArray(obj?.[k])) out[k] = obj[k].filter((x) => typeof x === 'string');
  if (Array.isArray(obj?.unset)) out.unset = obj.unset.filter((f) => SITE_FIELDS.includes(f));
  if (typeof obj?.tool === 'string' && obj.tool.trim() && !/^(none|null)$/i.test(obj.tool.trim())) out.tool = obj.tool.trim();
  if (typeof obj?.reply === 'string') out.reply = obj.reply.trim().slice(0, 240);
  return out;
}

export const SITE_SCHEMA = Object.freeze({ name: 'update_site', stateKey: 'CURRENT_SPEC', buildPrompt: buildSitePrompt, buildFunction: buildSiteFunction, validate: validateSiteInterpretation });

export function createSiteInterpreter(llm, opts = {}) {
  return createGlmInterpreter(llm, { schema: SITE_SCHEMA, maxTokens: 400, ...opts });
}
