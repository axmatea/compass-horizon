import { DELAY_SOURCE, createOffice, memoryPacket, officeReducer } from '../model';

export { PEOPLE as STORY_PEOPLE } from '../model';

export const CHANGES = [
  { name: 'Supplier delivery', owner: 'Noa / supplier handover', before: 'Wed, Sep 30 · 09:00', after: 'Thu, Oct 1 · 09:00', kind: 'changed' },
  { name: 'Installation', owner: 'Leo / build & systems', before: 'Wed, Sep 30 · 10:00', after: 'Thu, Oct 1 · 10:00', kind: 'proposed' },
  { name: 'Validation', owner: 'Leo / build & systems', before: 'Thu, Oct 1 · 09:00', after: 'Fri, Oct 2 · 09:00', kind: 'proposed' },
  { name: 'Client preview', owner: 'Shared commitment', before: 'Fri, Oct 2 · 15:00', after: 'Fri, Oct 2 · 15:00', kind: 'unchanged' },
] as const;

export const SOURCE_TEXT = DELAY_SOURCE.content;

// Pure fixture projection; it never mutates the parent office or applies approval.
export const MEMORY = memoryPacket(officeReducer(createOffice(), { type: 'delay' }))
  .map(item => [item.label, item.value] as const);

export const SLIDES = [
  { label: 'Six seats. One plan.', time: '0:00-0:22', action: 'Point to the six seats and the central table. Seat controls inspect fictional context.', speech: 'This is COMPASS, by NAYL and Vincent. Imagine Harbor studio preparing for a launch. Six people have their own work, but they share one environment and one plan. The office is the interface: a seat for each person, a table for the work they share, and the original context underneath.' },
  { label: 'One change enters the room.', time: '0:22-0:43', action: 'Read the supplier note. Point to the Wednesday-to-Thursday change.', speech: 'A supplier moves delivery from Wednesday, September thirtieth, to Thursday, October first. This is a fictional, local example. The original note stays available. Rather than treating that change as a message everyone must interpret, we show the specific dependency it affects: installation, followed by validation.' },
  { label: 'The plan bends, not everything.', time: '0:43-1:09', action: 'Trace delivery, installation, validation, then the unchanged client preview.', speech: 'Noa handles the supplier handover. The proposed plan moves Leo\'s installation from Wednesday to Thursday, then his validation from Thursday to Friday at nine. The client preview stays Friday, October second, at three. Maya reviews this proposal before a plan is applied. This is a scripted local preview, not an automatically coordinated schedule.' },
  { label: 'Only the necessary conversation.', time: '1:09-1:31', action: 'Point to Noa and Leo. Emphasize proposed, not booked.', speech: 'Noa and Leo share the dependency, so the example proposes a ten-minute conversation for those two, not a six-person meeting. Noa checks the supplier handover; Leo checks installation and validation readiness. Maya retains approval. Esra, Ravi, and Sam keep their existing plan. No meeting is booked and no notification is sent.' },
  { label: 'Keep the reason underneath.', time: '1:31-1:54', action: 'Open Read original supplier note. The five memory labels are an editorial structure.', speech: 'Beneath the room is a simple way to inspect shared context: goal, owner, constraint, decision, and next action. The original supplier note is still here. This is a designed view of a synthetic example, not a claim of automatic memory, lossless compression, or an AI watching the team.' },
  { label: 'Right context. Right person.', time: '1:54-2:16', action: 'Return to the office only if requested. Do not imply that the proposal was approved.', speech: 'The intended outcome is simple: Noa and Leo see the change they need to review, Maya keeps the decision, and the rest of the team can stay with their work. Six independent seats, one shared plan. Explore the local office to inspect the example. COMPASS: the team moves together without every change becoming everyone\'s interruption.' },
] as const;
