import type { ScenePerson } from '../types.ts';

export const ROOM_IMAGE = '/remaster/studio/room-v1.webp';
export const SEATS = [
  { x: 28, y: 30 }, { x: 54, y: 33 }, { x: 76, y: 45 },
  { x: 22, y: 57 }, { x: 47, y: 78 }, { x: 70, y: 75 },
] as const;
export const TABLE = { x: 48, y: 53 };
const namedSeats: Record<string, number> = {
  priya: 0, sarah: 1, max: 2, leo: 3, maya: 4, noah: 5,
  esra: 0, ravi: 1, sam: 2, noa: 5,
};

// Known people retain their place even when a private adapter supplies a subset.
// Extra people remain available in the roster, never stacked over another desk.
export function assignSeats(people: ScenePerson[]) {
  const assigned = new Map<string, number>();
  const used = new Set<number>();
  const unique = [...new Map(people.map(person => [person.id, person])).values()];
  for (const person of unique) {
    const key = person.id.toLowerCase();
    const index = namedSeats[key] ?? namedSeats[person.name.split(' ')[0].toLowerCase()];
    if (index !== undefined && !used.has(index)) {
      assigned.set(person.id, index);
      used.add(index);
    }
  }
  for (const person of [...unique].sort((a, b) => a.id.localeCompare(b.id))) {
    if (assigned.has(person.id)) continue;
    const index = SEATS.findIndex((_, slot) => !used.has(slot));
    if (index !== -1) { assigned.set(person.id, index); used.add(index); }
  }
  return unique.map(person => ({ person, index: assigned.get(person.id) ?? -1 }));
}

export function contextPath(x: number, y: number, targetX = TABLE.x, targetY = TABLE.y) {
  return `M ${x} ${y} Q ${(x + targetX) / 2} ${Math.min(y, targetY) - 10} ${targetX} ${targetY}`;
}
