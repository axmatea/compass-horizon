export type OfficeLayer = 'office' | 'memory';
export type ScenePerson = { id: string; name: string; role: string; color: string; objective: string };
export type OfficeSceneProps = {
  people: ScenePerson[];
  selectedId?: string | null;
  affectedIds?: string[];
  layer?: OfficeLayer;
  meetingIds?: string[];
  onSelectPerson: (id: string) => void;
  onSelectPlan: () => void;
  onSelectMemory: () => void;
  compact?: boolean;
};
