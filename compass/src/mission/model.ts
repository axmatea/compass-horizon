import { createDemo } from '../workspace/demo.ts';
import type { TaskStatus } from '../workspace/types.ts';

export const ACCESSIBILITY_TASK_ID = 'mission-accessibility';
export const ACCESSIBILITY_TITLE = 'Check step-free access and restroom details';
export const SOURCE_ID = 'm2';
export type MachineStep = 'ready' | 'inspected' | 'proposed' | 'approved';

export function createMission() {
  return {
    snapshot: createDemo(),
    step: 'ready' as MachineStep,
    notice: '',
  };
}

export type MissionState = ReturnType<typeof createMission>;
export type MissionAction =
  | { type: 'reset' }
  | { type: 'inspect' }
  | { type: 'propose' }
  | { type: 'approve' }
  | { type: 'move'; id: string; status: TaskStatus };

export function missionReducer(state: MissionState, action: MissionAction): MissionState {
  switch (action.type) {
    case 'reset':
      return { ...createMission(), notice: 'Demo reset. Four original tasks restored; local changes cleared.' };
    case 'inspect':
      return state.step === 'ready'
        ? { ...state, step: 'inspected', notice: 'Venue conversation inspected. You can now create the scripted proposal.' }
        : state;
    case 'propose':
      return state.step === 'inspected'
        ? { ...state, step: 'proposed', notice: 'Scripted proposal ready. The plan stays unchanged until Maya confirms.' }
        : state;
    case 'approve': {
      if (state.step !== 'proposed') return state;
      // Stable identity makes approval safe to repeat, including queued clicks.
      const tasks = state.snapshot.tasks.some(task => task.id === ACCESSIBILITY_TASK_ID)
        ? state.snapshot.tasks
        : [...state.snapshot.tasks, {
            id: ACCESSIBILITY_TASK_ID,
            title: ACCESSIBILITY_TITLE,
            assigneeId: 'maya',
            status: 'todo' as const,
            dueDate: '2026-10-05',
            version: 1,
          }];
      return {
        ...state,
        step: 'approved',
        snapshot: { ...state.snapshot, tasks },
        notice: 'Confirmed as demo owner Maya. One accessibility task added to To do. No booking was made.',
      };
    }
    case 'move': {
      if (!['todo', 'doing', 'done'].includes(action.status)) return state;
      const task = state.snapshot.tasks.find(item => item.id === action.id);
      if (!task || task.status === action.status) return state;
      const label = { todo: 'To do', doing: 'In progress', done: 'Done' }[action.status];
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          tasks: state.snapshot.tasks.map(item => item.id === action.id
            ? { ...item, status: action.status, version: item.version + 1 }
            : item),
        },
        notice: `${task.title} moved to ${label}. Saved only for this demo session.`,
      };
    }
  }
}
