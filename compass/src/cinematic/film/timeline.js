// Exact 28.000s timeline. Pure data, no DOM. Beats are absolute seconds.
// Beat ORDER follows the recorded v1 event order in dinner-turns.json:
// T1 state_patch -> tool_call -> say -> (T2) reasoning -> state_patch ->
// action_invalidated -> tool_call -> say -> tool_result -> reply -> done.
export const DURATION = 28;
export const FPS = 30;

export const SHOTS = [
  { id: 1, name: "Listening", start: 0.0, end: 2.5 },
  { id: 2, name: "Instruction", start: 2.5, end: 6.0 },
  { id: 3, name: "Intent materializes", start: 6.0, end: 9.0 },
  { id: 4, name: "Acting", start: 9.0, end: 12.0 },
  { id: 5, name: "Interruption", start: 12.0, end: 15.0 },
  { id: 6, name: "Intent patch", start: 15.0, end: 19.5 },
  { id: 7, name: "Replan, keep acting", start: 19.5, end: 24.0 },
  { id: 8, name: "Resolve", start: 24.0, end: 28.0 },
];

// Spoken windows. Word timings are fitted inside these windows.
export const UTTER = {
  user1: [2.7, 5.7], // turns[0].request.text
  say1: [9.4, 11.7], // T1 event "say"
  user2: [12.25, 14.7], // turns[1].request.text
  say2: [17.0, 18.8], // T2 event "say"
  reply: [20.9, 23.9], // turns[1].response.reply
};
export const CUE_HOLD = 0.45;

export const BEATS = {
  orbIn: [0.2, 1.6],
  headerIn: [0.6, 1.6],
  subtitleDock: [6.0, 6.9],
  orbDock: [6.0, 7.1],
  cardIn: [6.4, 7.1],
  rowStart: 6.9,
  rowStagger: 0.38,
  actIn: [8.9, 9.6], // T1 tool_call
  bargeIn: 12.2, // user starts speaking over the running action
  strike: [15.3, 15.8], // T2 state_patch: time updated
  recede: [15.9, 16.5],
  activeIn: [16.1, 16.9],
  addIn: [16.9, 17.6], // location added
  keptIn: [17.5, 18.2],
  patchNote: [18.0, 18.6],
  invalidate: [19.6, 20.1], // action_invalidated
  newAction: [20.0, 20.6], // new tool_call on version 2
  toolDone: 21.4, // tool_result
  resultsIn: 21.5,
  resultsStagger: 0.3,
  uiOut: [24.0, 24.8],
  orbHero: [24.1, 25.4],
  wordmarkIn: [24.9, 25.8],
  ruleIn: [25.4, 26.2],
  line1In: [25.7, 26.5],
  line2In: [26.3, 27.1],
};

export function shotAt(t) {
  return SHOTS.find((s) => t >= s.start && t < s.end) || SHOTS[SHOTS.length - 1];
}

// Mirrors state.status + reasoning_status events of the live runtime.
export function statusAt(t) {
  if (t < 5.8) return "Listening";
  if (t < 7.0) return "Interpreting";
  if (t < BEATS.bargeIn) return "Acting";
  if (t < 14.8) return "Listening";
  if (t < BEATS.strike[0]) return "Interpreting";
  if (t < BEATS.toolDone) return "Acting";
  if (t < 24.0) return "Ready";
  return "";
}
