/**
 * UI labels only. User speech, model replies and intent values are content and are never
 * passed through here: they render as sent (UTF-8, dir="auto").
 * English is canonical. To localize: add a dictionary with the same keys and select it.
 * Sentences with variables are functions so word order can differ per language.
 */
import type { OrbState } from './types'

export const en = {
  orb: { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', acting: 'Acting', speaking: 'Speaking', interrupted: 'Interrupted', replanning: 'Replanning' } satisfies Record<OrbState, string>,
  hint: {
    idle: 'Say what you need. Then change your mind.',
    idleWithPlan: 'Change anything. It adapts mid-action.',
    thinking: 'Understanding…',
    replanning: 'Updating only what changed.',
    acting: 'Working on it. Interrupt any time.',
    interrupted: 'Listening to you.',
  },
  voiceSource: { gradium: 'Voice · Gradium', boson: 'Voice · Boson Higgs', browser: 'Voice · Browser' } as Record<string, string>,
  disclosure: { live: 'Live · Restaurants from OpenStreetMap · Nothing is booked', recorded: 'Replay of a recorded live session · Restaurant results are sample data' },
  talk: 'Talk', listening: 'Listening', interrupt: 'Interrupt', interruptTitle: 'Interrupt (Esc)',
  micTitle: 'Talk, and talk over COMPASS to interrupt', micUnsupported: 'Voice input is not supported in this browser',
  voiceOn: 'Voice on', voiceOff: 'Muted', voiceTitle: 'COMPASS speaks its replies', reset: 'Start over',
  tryLabel: 'Try saying', interruptLabel: 'Interrupt with', changeLabel: 'Change the plan',
  typePlaceholder: 'Or type…', typeToInterrupt: 'Type to interrupt…', typeLabel: 'Type to COMPASS', send: 'Send',
  transcript: 'Transcript', you: 'You', compass: 'COMPASS', cutOff: 'cut off',
  plan: 'The plan', updated: 'Updated', action: 'Action', sampleData: 'sample data', anywhere: 'Anywhere', notSet: 'Not set',
  superseded: 'superseded',
  tag: { kept: 'kept', changed: 'updated', added: 'added', removed: 'removed' } as Record<string, string>,
  field: { task: 'Plan', date: 'When', time: 'Time', cuisine: 'Cuisine', location: 'Near', party_size: 'Party' } as Record<string, string>,
  act: {
    running: 'Searching', paused: 'Paused, listening', stopped: 'Stopped', results: (n: number) => `${n} results`,
    invalidated: (fields: string[]) => `Replaced: ${new Intl.ListFormat('en', { type: 'conjunction' }).format(fields)} changed`,
    currentArea: 'current area', nearby: 'Nearby', km: (d: number) => `${d.toFixed(1)} km`,
  },
  notice: {
    listening: 'Listening. Talk over COMPASS any time to interrupt. Headphones work best.',
    noVoice: 'Voice input is not available in this browser. Type instead.',
    unreachable: 'Live backend unreachable. This turn replayed the recorded session.',
    failed: 'That turn failed. Try again.',
    voiceClosed: 'Voice connection closed. Tap Talk to reconnect.',
  },
}
export type Strings = typeof en
export const t: Strings = en
