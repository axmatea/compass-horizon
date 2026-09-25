// Slide-to-speech map. Every slide: steps (on-screen builds), exact speech per step,
// motion, media, trigger and expected duration (speech at ~150 wpm + scripted pauses).
import fixture from "../../../cinematic/film/dinner-turns.json";
import { deriveRows, formatValue } from "../../../cinematic/film/intent.js";
import { CONFIG } from "../config.js";

const rows = deriveRows(fixture);
const t1 = fixture.turns[0];
const firstIntent = t1.response.patch.map((p) => formatValue(p.field, p.to));
const WPS = 2.5;
const words = (s) => s.replace(/\[[^\]]*\]/g, "").split(/\s+/).filter(Boolean).length;
const pauses = (s) => [...s.matchAll(/\[PAUSE (\d+(?:\.\d+)?)s\]/g)].reduce((a, m) => a + Number(m[1]), 0);
export const speechSeconds = (s) => Math.round(words(s) / WPS + pauses(s));

export const SLIDES_V10 = [
  {
    id: "founders", title: "Founders", orb: "hidden", media: CONFIG.founders.photo ? "founders photo" : "none (photo slot empty)",
    motion: "Names mask-reveal, × draws, origins and role fade up.",
    trigger: "Auto on start. → after the last sentence.",
    steps: [
      { speech: "Hey everyone. I'm Nail, originally from Russia, and this is Vincent, from France. We build SaaS products together, products that are already generating real revenue. [PAUSE 0.5s] And lately we've become obsessed with one question." },
    ],
    flag: CONFIG.founders.arr ? null : "ARR not verified: figure hidden. 'Already generating real revenue' must be true before you say it.",
  },
  {
    id: "human", title: "Does AI feel human?", orb: "hidden", media: "human-balcony.mp4 (film-A 20.3-25.9s, cropped, muted loop)",
    motion: "Footage fades in dim; the line masks up word by word.",
    trigger: "→ right after 'one question.'",
    steps: [
      { speech: "Quick show of hands. [PAUSE 1s] Who here has ever talked to an AI voice agent that was so good... that even your grandma couldn't figure out it was AI? [PAUSE 3s] Yeah. Exactly. [PAUSE 0.5s] Neither have we. [PAUSE 3s]" },
    ],
  },
  {
    id: "problem", title: "Humans change their minds", orb: "hidden", media: "human-speak.mp4 (hf night office, muted loop)",
    motion: "Line 1 masks up over footage. Step 2: footage desaturates and freezes, line 2 cuts in hard.",
    trigger: "→ after the laugh. → again on 'AI keeps executing'.",
    steps: [
      { speech: "And that's actually the deeper problem. AI has become incredibly good at following instructions. But humans are terrible at giving final instructions. We change our minds. We interrupt ourselves. We realize halfway through that what we asked for isn't actually what we wanted." },
      { speech: "[PAUSE 1s]" },
    ],
  },
  {
    id: "action", title: "Request, plan, action", orb: "hidden", media: "none (HTML)",
    motion: "Three nodes draw in with connectors. Step 2: action starts running. Step 3: the correction arrives and bounces off; action keeps running on 7:00 PM.",
    trigger: "→ enters. → starts action. → interrupts.",
    steps: [
      { speech: "And once most agents start acting," },
      { speech: "they're optimized around the instruction you already gave them." },
      { speech: "[PAUSE 1.5s]" },
    ],
  },
  {
    id: "compass", title: "COMPASS", orb: "hero", media: "orb (HTML)",
    motion: "Previous slide collapses into a point; the orb grows out of it. Wordmark, then the line.",
    trigger: "→ collapses into the orb.",
    steps: [
      { speech: "So we built COMPASS." },
      { speech: "COMPASS doesn't just answer the request you gave it. It understands when the request changes while it's already acting." },
    ],
  },
  {
    id: "demo", title: "Live demo", orb: "center", media: "LIVE /demo in a full-screen frame. Fallback: demo-fallback.mp4 (18.5s, real /demo replaying the recorded session)",
    motion: "Orb breathes. Step 2: orb expands and dissolves into the live product.",
    trigger: "→ opens LIVE demo. R = recorded fallback. PageDown / presenter → returns.",
    steps: [
      { speech: "But explaining this is boring. Let me just show you." },
      { speech: "[LIVE] \"Schedule dinner tomorrow at 7 and find an Italian restaurant.\" [let it start acting] \"Actually, make it 8. Somewhere near Palo Alto.\" [PAUSE 2s] That's the part. [let it finish]", live: 45 },
    ],
  },
  {
    id: "takeaway", title: "It understood what changed", orb: "corner", media: "state strip from contract v1 fixture",
    motion: "Line 1 in. Line 2 pushes it up. Step 3: the dinner state lays out: kept values stay put, 7:00 PM strikes, 8:00 PM and Palo Alto light gold.",
    trigger: "→ per line.",
    steps: [
      { speech: "Notice what just happened. It didn't restart the conversation." },
      { speech: "It didn't throw away everything we'd already figured out. It understood what changed..." },
      { speech: "[PAUSE 0.5s] and what didn't." },
    ],
  },
  {
    id: "stack", title: "Technology", orb: "corner", media: "none (HTML)",
    motion: "Stack builds top-down. Step 2 lights Boson. Step 3 lights Nebius.",
    trigger: "→ per layer you talk about.",
    steps: [
      { speech: "Underneath it," },
      { speech: "Boson gives us realtime conversation and interruption." },
      { speech: "Nebius gives COMPASS the reasoning layer that understands mutable intent and replans actions. But the important part isn't the architecture. It's how the interaction feels." },
    ],
  },
  {
    id: "partners", title: "Design partners", orb: "corner", media: "none",
    motion: "Line 1 in; step 2 line 1 dims, 'Design partners.' lands large.",
    trigger: "→ on 'design partners'.",
    steps: [
      { speech: "We're not trying to open COMPASS to everyone tomorrow." },
      { speech: "We're starting with a small number of design partners where voice AI actually touches real workflows. Because this only gets interesting when COMPASS can actually act." },
    ],
  },
  {
    id: "cta", title: "Build with us", orb: "cta", media: "QR (mycompass.world)",
    motion: "Orb settles above the wordmark; domain and QR fade up. Step 2: 'Thank you.'",
    trigger: "→ enters. → on 'Thank you'.",
    steps: [
      { speech: "So if you're building a company where people are still clicking through software they should simply be able to talk to... come find us. Maybe you're one of the first teams we build COMPASS with." },
      { speech: "Thank you. [PAUSE 3s]" },
    ],
  },
];

export const STATE_STRIP_V10 = rows; // kept / updated / added straight from contract v1
export const FIRST_INTENT_V10 = firstIntent;

export function timing() {
  let speech = 0;
  let live = 0;
  const per = SLIDES.map((s) => {
    const sp = s.steps.reduce((a, st) => a + (st.live ? 0 : speechSeconds(st.speech)), 0) + (s.steps.length - 1) * 0.5;
    const lv = s.steps.reduce((a, st) => a + (st.live || 0), 0);
    speech += sp;
    live += lv;
    return { id: s.id, speech: Math.round(sp), live: lv };
  });
  return { per, speech: Math.round(speech), live, total: Math.round(speech + live) };
}
