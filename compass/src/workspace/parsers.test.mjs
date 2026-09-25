import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseTaskCSV, validDate, validateTitle, validateUpload, MAX_UPLOAD_BYTES } from './parsers.ts';
import { parseSequence, parseSnapshot } from './types.ts';
import { createDemo } from './demo.ts';

test('CSV supports BOM, quoted commas, escaped quotes, CRLF, embedded newlines and empty last fields', () => {
  assert.deepEqual(parseCSV('\uFEFFtitle,description,empty\r\n"A, B","A ""quote""\r\nand another line",\r\n'), [
    ['title', 'description', 'empty'], ['A, B', 'A "quote"\r\nand another line', ''],
  ]);
});
test('CSV rejects unterminated quotes, stray quotes and trailing text', () => {
  for (const source of ['title\n"unfinished', 'title\nstray"quote', 'title\n"finished"oops']) assert.throws(() => parseCSV(source));
});
test('task imports validate columns, status, dates, assignment and width', () => {
  assert.deepEqual(parseTaskCSV('title,assigneeId,status,dueDate\n"Talk, then decide",maya,doing,2028-02-29', ['maya']), [
    { title: 'Talk, then decide', assigneeId: 'maya', status: 'doing', dueDate: '2028-02-29' },
  ]);
  assert.deepEqual(parseTaskCSV('title\nFirst step\n\n'), [{ title: 'First step', assigneeId: null, status: 'todo', dueDate: null }]);
  for (const source of ['name\nTask', 'title,title\nA,B', 'title,unknown\nA,B', 'title,status\nA,online', 'title,dueDate\nA,2026-02-29', 'title,assigneeId\nA,outsider', 'title,status\nA', 'title\n', 'title\n"   "']) assert.throws(() => parseTaskCSV(source));
});
test('task titles use UTF-8 byte limits and reject control characters', () => {
  assert.equal(validateTitle('é'.repeat(120)).length, 120);
  assert.throws(() => validateTitle('é'.repeat(121)));
  assert.throws(() => parseTaskCSV(`title\n${'é'.repeat(121)}`));
  assert.throws(() => parseTaskCSV('title\n"line\nbreak"'));
  for (const value of ['zero\0byte', 'tab\ttitle', '\u0001bad', 'bad\u007f', 'bad\ud800']) assert.throws(() => validateTitle(value));
  assert.equal(validateTitle('A human 🌿'), 'A human 🌿');
});
test('uploaded text remains literal, including HTML and spreadsheet formula strings', () => {
  assert.equal(parseTaskCSV('title\n<script>alert(1)</script>')[0].title, '<script>alert(1)</script>');
  assert.equal(parseTaskCSV('title\n=1+1')[0].title, '=1+1');
});
test('import limits and extensions are enforced before reading', () => {
  assert.equal(validateUpload({ name: 'NOTES.MD', size: MAX_UPLOAD_BYTES }), 'text');
  assert.equal(validateUpload({ name: 'tasks.csv', size: 10 }), 'csv');
  for (const file of [{ name: 'data.csv', size: MAX_UPLOAD_BYTES + 1 }, { name: 'empty.txt', size: 0 }, { name: 'fake.csv.html', size: 20 }]) assert.throws(() => validateUpload(file));
  assert.throws(() => parseTaskCSV('title\n' + 'task\n'.repeat(201)));
});
test('dates are real calendar days rather than normalized invalid dates', () => {
  assert(validDate('2028-02-29'));
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', 'tomorrow']) assert(!validDate(value));
});
test('sequence parsing preserves bigint precision and rejects unsafe or malformed values', () => {
  assert.equal(parseSequence('9007199254740993'), 9007199254740993n);
  assert(parseSequence('9007199254740993') > parseSequence('9007199254740992'));
  assert.equal(parseSequence(12), 12n);
  for (const value of [null, undefined, -1, 0.5, 9007199254740993, '1e2', '12x', '-1', '']) assert.throws(() => parseSequence(value));
});
test('snapshots are validated and demo creation never shares mutable arrays', () => {
  const first = createDemo(); const second = createDemo();
  assert.equal(parseSnapshot(first), first);
  first.tasks.pop(); assert.equal(second.tasks.length, 4);
  assert.throws(() => parseSnapshot({ ...second, seq: 'not-a-sequence' }));
  assert.throws(() => parseSnapshot({ ...second, tasks: [{ ...second.tasks[0], status: 'online' }] }));
  assert.throws(() => parseSnapshot({ ...second, members: [{ name: 'Fake' }] }));
  assert.throws(() => parseSnapshot({ ...second, ai: null }));
});
