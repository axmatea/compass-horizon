/** The 8 stage beats of the demo. Captions are a few words each; numbers on screen come from the engine. */
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
    caption: 'Two campaigns launch.',
    day: 0,
    wakes: true,
    nextLabel: 'Day 3: cheap leads',
  },
  {
    beat: 1,
    title: 'Day 3: Cheap leads',
    caption: 'Cheap leads. The agent leans A.',
    day: 3,
    wakes: true,
    nextLabel: 'Day 6: busy buyers answer',
  },
  {
    beat: 2,
    title: 'Day 6: Busy buyers answer',
    caption: 'Busy buyers answer late.',
    day: 6,
    wakes: true,
    nextLabel: 'Day 9: the agent changes its mind',
  },
  {
    beat: 3,
    title: 'Day 9: The agent changes its mind',
    caption: 'It changes its mind.',
    day: 9,
    wakes: true,
    nextLabel: 'Day 11: late CRM data',
  },
  {
    beat: 4,
    title: 'Day 11: Late CRM data',
    caption: 'Late CRM data confirms B.',
    day: 11,
    wakes: true,
    nextLabel: 'Day 14: follow-ups',
  },
  {
    beat: 5,
    title: 'Day 14: Follow-ups',
    caption: 'Follow-ups due, proposals out.',
    day: 14,
    wakes: true,
    nextLabel: 'Day 21: outcome',
  },
  {
    beat: 6,
    title: 'Day 21: Outcome',
    caption: 'B closes $18,000.',
    day: 21,
    wakes: true,
    nextLabel: 'Time machine',
  },
  {
    beat: 7,
    title: 'Time machine',
    caption: 'Drag back to any day to see what the agent knew.',
    day: 21,
    wakes: false,
    nextLabel: null,
  },
];

export const TOTAL_BEATS = BEATS.length;
