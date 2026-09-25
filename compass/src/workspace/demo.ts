import type { Snapshot } from './types.ts';
export function createDemo(): Snapshot {
  return {
    workspace: { id: 'demo', name: 'Sunday studio', goal: 'Bring the neighborhood to the table.', deadline: '2026-10-18', role: 'owner' },
    members: [
      { userId: 'maya', name: 'Maya Chen', email: 'maya@example.test', role: 'owner' },
      { userId: 'leo', name: 'Leo Martin', email: 'leo@example.test', role: 'member' },
    ],
    tasks: [
      { id: 't1', title: 'Shape the gathering concept', assigneeId: 'maya', status: 'done', dueDate: '2026-10-02', version: 1 },
      { id: 't2', title: 'Find a space that feels like home', assigneeId: 'leo', status: 'doing', dueDate: '2026-10-06', version: 1 },
      { id: 't3', title: 'Design the first invitation', assigneeId: 'maya', status: 'todo', dueDate: '2026-10-09', version: 1 },
      { id: 't4', title: 'Plan a shared seasonal menu', assigneeId: 'leo', status: 'todo', dueDate: '2026-10-12', version: 1 },
    ],
    materials: [
      { id: 'm1', title: 'The gathering brief', content: 'A long table. Twenty neighbors. One Sunday afternoon.\n\nMake a small, welcoming gathering where people can meet over a shared meal. Keep the invitation personal and the food seasonal.\n\nSuccess: a confirmed venue, a thoughtful menu, and invitations ready for October 18.', createdAt: '2026-09-25T10:00:00Z', authorId: 'maya' },
      { id: 'm2', title: 'Venue conversation', content: 'Example note from Leo, September 25:\n\nThe courtyard is available October 18. The venue needs a written accessibility check before we confirm. Maya can review the step-free entrance and accessible restroom details.\n\nDo not confirm the booking until that check is complete.', createdAt: '2026-09-25T11:00:00Z', authorId: 'leo' },
    ], proposals: [], events: [], seq: '0', ai: { status: 'BLOCKED', reason: 'No AI is connected. This local demo uses a scripted example, not model output.' },
  };
}
