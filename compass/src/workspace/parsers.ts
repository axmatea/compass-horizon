import type { TaskInput } from './types.ts';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_TASKS = 200;
export function validateTitle(value: string, maxBytes = 240): string {
  const title = value.trim();
  if (!title || /[\u0000-\u001f\u007f-\u009f]/.test(value) || /[\uD800-\uDFFF]/u.test(value) || new TextEncoder().encode(title).length > maxBytes) throw new Error(`Title must contain 1-${maxBytes} UTF-8 bytes with no control characters.`);
  return title;
}
export function validateUpload(file: { name: string; size: number }): 'csv' | 'text' {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Choose a file no larger than 5 MB.');
  if (!file.size) throw new Error('This file is empty.');
  const ext = file.name.toLowerCase().split('.').pop();
  if (!['txt', 'md', 'csv'].includes(ext ?? '')) throw new Error('Supported files: .txt, .md, and .csv.');
  return ext === 'csv' ? 'csv' : 'text';
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Strict RFC-style CSV: escaped quotes, embedded newlines, BOM and CRLF. */
export function parseCSV(source: string): string[][] {
  if (new TextEncoder().encode(source).length > MAX_UPLOAD_BYTES) throw new Error('CSV exceeds 5 MB.');
  const input = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (row.some(c => c.trim())) rows.push(row); row = []; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') { pushRow(); if (char === '\r' && input[i + 1] === '\n') i++; }
    else if (char === '"') {
      if (cell || closed) throw new Error(`Unexpected quote near CSV row ${rows.length + 1}.`);
      quoted = true;
    } else {
      if (closed) throw new Error(`Unexpected text after a closing quote near CSV row ${rows.length + 1}.`);
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  pushRow();
  return rows;
}

export function parseTaskCSV(source: string, memberIds: string[] = []): TaskInput[] {
  const [header, ...rows] = parseCSV(source);
  if (!header) throw new Error('Add a header and at least one task.');
  const keys = header.map(h => h.trim());
  if (!keys.includes('title')) throw new Error('CSV requires a title column.');
  if (new Set(keys).size !== keys.length) throw new Error('CSV headers must be unique.');
  if (keys.some(k => !['title', 'assigneeId', 'status', 'dueDate'].includes(k))) throw new Error('Allowed columns: title, assigneeId, status, dueDate.');
  if (!rows.length || rows.length > MAX_IMPORT_TASKS) throw new Error(`Import between 1 and ${MAX_IMPORT_TASKS} tasks at a time.`);
  return rows.map((row, i) => {
    const fail = (message: string): never => { throw new Error(`Row ${i + 2}: ${message}`); };
    if (row.length !== keys.length) fail('column count does not match the header.');
    const get = (key: string) => (row[keys.indexOf(key)] ?? '').trim();
    const title = get('title'), assigneeId = get('assigneeId') || null, status = get('status') || 'todo', dueDate = get('dueDate') || null;
    try { validateTitle(row[keys.indexOf('title')] ?? ''); } catch (e) { fail(e instanceof Error ? e.message : 'invalid title.'); }
    if (!['todo', 'doing', 'done'].includes(status)) fail('status must be todo, doing, or done.');
    if (assigneeId && !memberIds.includes(assigneeId)) fail('assigneeId is not a workspace member.');
    if (dueDate && !validDate(dueDate)) fail('dueDate must be a real date in YYYY-MM-DD format.');
    return { title, assigneeId, status: status as TaskInput['status'], dueDate };
  });
}
