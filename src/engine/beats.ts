/** The 8 stage beats of the demo (brief section 4). Captions are spoken lines; numbers on screen come from the engine. */
export interface BeatDef {
  beat: number;
  title: string;
  caption: string;
  day: number;
  /** false for the time machine beat: no clock change, no agent wake */
  wakes: boolean;
  nextLabel: string | null;
}

export const BEATS: BeatDef[] = [
  {
    beat: 0,
    title: 'Day 0: Launch',
    caption: 'Two campaigns go live with qualification rules v1 and decision policy v1, and the agent starts by admitting it knows nothing yet.',
    day: 0,
    wakes: true,
    nextLabel: 'Day 3: the dashboard says A',
  },
  {
    beat: 1,
    title: 'Day 3: The dashboard says A',
    caption: 'A brings far more leads at a fraction of the cost, two fast A leads confirm budget, and the agent leans A on thin evidence while it schedules questions for everyone still unresolved.',
    day: 3,
    wakes: true,
    nextLabel: 'Day 6: busy buyers answer',
  },
  {
    beat: 2,
    title: 'Day 6: Busy buyers answer',
    caption: 'CPA partners finally reply with real budgets, a duplicate webhook is ignored, A follow-ups reveal no budget, and the belief drops back to insufficient.',
    day: 6,
    wakes: true,
    nextLabel: 'Day 9: the agent changes its mind',
  },
  {
    beat: 3,
    title: 'Day 9: The agent changes its mind',
    caption: 'The agent revises its day 3 read to lean B, writes down why it was fooled, and tightens its own decision policy.',
    day: 9,
    wakes: true,
    nextLabel: 'Day 11: late truth',
  },
  {
    beat: 4,
    title: 'Day 11: Late truth',
    caption: 'A CRM sync delivers two calls that happened days ago, the past is restated correctly, and the evidence now supports B.',
    day: 11,
    wakes: true,
    nextLabel: 'Day 14: pull the plug',
  },
  {
    beat: 5,
    title: 'Day 14: Pull the plug',
    caption: 'The day 14 wake has promises due; we kill the process mid-run, and the next wake resumes from its last checkpoint without repeating a single effect.',
    day: 14,
    wakes: true,
    nextLabel: 'Day 21: outcome',
  },
  {
    beat: 6,
    title: 'Day 21: Outcome',
    caption: "B closes a deal while A's only call ghosts, and the agent recommends B with the counterfactual of scaling A on day 3.",
    day: 21,
    wakes: true,
    nextLabel: 'Time machine',
  },
  {
    beat: 7,
    title: 'Time machine',
    caption: 'Drag back to day 3 to see exactly what the agent believed and why, then forward to day 21.',
    day: 21,
    wakes: false,
    nextLabel: null,
  },
];

export const TOTAL_BEATS = BEATS.length;
