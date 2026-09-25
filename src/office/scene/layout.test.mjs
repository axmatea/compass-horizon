import test from 'node:test';
import assert from 'node:assert/strict';
import { assignSeats, contextPath, ROOM_IMAGE } from './layout.ts';
const person = id => ({ id, name: id, role: 'Member', color: '#607153', objective: 'Work' });

test('uses the exact unchanged existing room asset', () => {
  assert.equal(ROOM_IMAGE, '/remaster/studio/room-v1.webp');
});
test('named seats stay fixed across a two-person private subset and reorder', () => {
  const seats = assignSeats(['maya', 'leo'].map(person));
  assert.deepEqual(seats.map(seat => seat.index), [4, 3]);
  assert.deepEqual(assignSeats(['leo', 'maya'].map(person)).map(seat => seat.index), [3, 4]);
});
test('current public model maps to all six distinct photographed desks', () => {
  const seats = assignSeats(['maya', 'noa', 'leo', 'esra', 'ravi', 'sam'].map(person));
  assert.equal(new Set(seats.map(seat => seat.index)).size, 6);
  assert.deepEqual(seats.map(seat => seat.index), [4, 5, 3, 0, 1, 2]);
});
test('unknown people get distinct seats; overflow stays roster-only', () => {
  const seats = assignSeats(Array.from({ length: 8 }, (_, i) => person(`person-${i}`)));
  assert.equal(seats.filter(seat => seat.index >= 0).length, 6);
  assert.equal(seats.filter(seat => seat.index === -1).length, 2);
  assert.deepEqual(assignSeats([]), []);
});
test('duplicate ids are not rendered twice and context ends at the plan', () => {
  assert.equal(assignSeats([person('maya'), person('maya')]).length, 1);
  assert.match(contextPath(28, 30), /^M 28 30 Q .* 48 53$/);
});
