import test from 'node:test';
import assert from 'node:assert/strict';
import { readProvider, validateReadInput } from '../integrations/providers.mjs';

const refused = error => error.code?.startsWith('integration_') && error.status >= 400;
const requestFor = values => {
  const calls = [];
  return { calls, request: async url => { calls.push(new URL(url)); assert.ok(values.length); return values.shift(); } };
};

test('GitHub metadata never exposes private repositories or upstream URLs and bounds output', async () => {
  const f = requestFor([Array.from({ length: 40 }, (_, i) => ({ private: i === 0, full_name: `org/repo${i}`, description: 'd'.repeat(800), url: 'https://evil.test', token: 'never return' }))]);
  const result = await readProvider('github', {}, f.request);
  assert.equal(f.calls[0].origin, 'https://api.github.com'); assert.equal(f.calls[0].pathname, '/user/repos');
  assert.equal(f.calls[0].searchParams.get('visibility'), 'public');
  assert.equal(result.repositories.length, 30); assert.equal(result.repositories[0].description.length, 500);
  assert.ok(!JSON.stringify(result).includes('evil')); assert.ok(!JSON.stringify(result).includes('never return'));
  await assert.rejects(readProvider('github', { repository: 'org/private' }, async () => ({ private: true })), refused);
});

test('Drive requests metadata fields only and refuses raw content and caller URLs', async () => {
  const f = requestFor([{ files: [{ id: 'drive-id', name: 'Document', mimeType: 'text/plain', content: 'private content', exportLinks: { raw: 'https://evil.test' } }], nextPageToken: 'secret-pagination-value' }]);
  const result = await readProvider('google-drive', {}, f.request);
  assert.deepEqual(result.files, [{ id: 'drive-id', name: 'Document', mimeType: 'text/plain', modifiedTime: '' }]);
  assert.equal(result.hasMore, true); assert.ok(!JSON.stringify(result).includes('secret-pagination'));
  assert.equal(f.calls[0].searchParams.get('fields'), 'files(id,name,mimeType,modifiedTime),nextPageToken');
  assert.equal(f.calls[0].searchParams.has('alt'), false);
  await assert.rejects(readProvider('google-drive', { url: 'http://localhost/' }, f.request), refused);
});

test('Sheets requires explicit spreadsheet ID and a small rectangular range and returns bounded text cells', async () => {
  const f = requestFor([{ values: Array.from({ length: 200 }, () => Array.from({ length: 50 }, () => 'x'.repeat(2000))), private: 'omit' }]);
  const result = await readProvider('google-sheets', { spreadsheetId: 'spreadsheet_explicit', range: 'Sheet1!A1:J100' }, f.request);
  assert.equal(f.calls[0].origin, 'https://sheets.googleapis.com');
  assert.equal(decodeURIComponent(f.calls[0].pathname), '/v4/spreadsheets/spreadsheet_explicit/values/Sheet1!A1:J100');
  assert.equal(f.calls[0].searchParams.get('valueRenderOption'), 'FORMATTED_VALUE');
  assert.equal(result.values.length, 100); assert.equal(result.values[0].length, 10); assert.equal(result.values[0][0].length, 1000);
  for (const range of ['A1:Z1000', 'A1:A101', 'B1:A2', 'A2:A1', 'A:Z', '1:10', 'A0:A1', 'https://evil.test', 'A1:B50000']) {
    assert.throws(() => validateReadInput('google-sheets', { spreadsheetId: 'spreadsheet_explicit', range }), refused);
  }
  await assert.rejects(readProvider('google-sheets', { range: 'A1:B2' }, f.request), refused);
});

test('Gmail uses metadata format, selected headers and no query/body/send/attachment endpoint', async () => {
  const f = requestFor([
    { messages: [{ id: 'abc', threadId: 'def', snippet: 'private body' }] },
    { id: 'abc', threadId: 'def', labelIds: ['INBOX'], snippet: 'private body', payload: { body: { data: 'private encoded body' }, headers: [{ name: 'Subject', value: 'Hello' }, { name: 'Authorization', value: 'private header' }] } },
  ]);
  assert.deepEqual(await readProvider('gmail', {}, f.request), { messages: [{ id: 'abc', threadId: 'def' }], hasMore: false });
  const result = await readProvider('gmail', { messageId: 'abc' }, f.request);
  assert.equal(f.calls[1].searchParams.get('format'), 'metadata');
  assert.deepEqual(f.calls[1].searchParams.getAll('metadataHeaders'), ['From', 'To', 'Subject', 'Date']);
  assert.deepEqual(result.headers, [{ name: 'Subject', value: 'Hello' }]);
  assert.ok(!JSON.stringify(result).includes('private'));
  for (const input of [{ q: 'password' }, { messageId: '../messages/send' }, { format: 'full' }, { body: 'hello' }]) assert.throws(() => validateReadInput('gmail', input), refused);
});

test('Calendar uses bounded explicit time windows and excludes descriptions, guests and conference links', async () => {
  const f = requestFor([{ items: [{ id: 'event-1', summary: 'Review', start: { dateTime: '2026-11-13T10:00:00Z' }, end: { dateTime: '2026-11-13T11:00:00Z' }, attendees: [{ email: 'private' }], description: 'private', conferenceData: 'private' }], nextPageToken: 'private' }]);
  const input = { calendarId: 'primary', timeMin: '2026-11-13T00:00:00Z', timeMax: '2026-11-14T00:00:00Z' };
  const result = await readProvider('google-calendar', input, f.request);
  assert.equal(f.calls[0].pathname, '/calendar/v3/calendars/primary/events'); assert.equal(f.calls[0].searchParams.get('maxResults'), '30');
  assert.ok(!JSON.stringify(result).includes('private')); assert.equal(result.events[0].summary, 'Review');
  for (const invalid of [{ ...input, timeMax: '2027-01-01T00:00:00Z' }, { ...input, timeMax: input.timeMin }, { ...input, calendarId: '../../other' }, { ...input, timeMin: 'not-a-date' }]) assert.throws(() => validateReadInput('google-calendar', invalid), refused);
});

test('Notion reads only an explicit accessible page and one block page with text only; it never follows URLs', async () => {
  const pageId = '11111111-2222-3333-4444-555555555555';
  const f = requestFor([
    { object: 'page', id: pageId, properties: { Name: { type: 'title', title: [{ plain_text: 'Selected page' }] }, Private: { email: 'omit' } }, url: 'http://localhost', icon: 'private' },
    { results: [{ id: 'block1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Read text', text: { link: { url: 'http://localhost' } } }] }, has_children: true }, { id: 'block2', type: 'file', file: { url: 'https://private-storage.test/secret' } }], has_more: true, next_cursor: 'private' },
  ]);
  const result = await readProvider('notion', { pageId }, f.request);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].href, `https://api.notion.com/v1/pages/${pageId}`);
  assert.equal(result.title, 'Selected page'); assert.equal(result.blocks[0].text, 'Read text'); assert.equal(result.blocks[0].hasChildren, true);
  assert.ok(!JSON.stringify(result).includes('http')); assert.ok(!JSON.stringify(result).includes('private'));
  assert.throws(() => validateReadInput('notion', { pageId: 'https://notion.so/page' }), refused);
});

test('Slack only lists public channel metadata without topics, purpose, history or private channels', async () => {
  const f = requestFor([{ ok: true, channels: [
    { id: 'C1', name: 'public', is_channel: true, is_private: false, num_members: 8, topic: { value: 'private-topic' } },
    { id: 'G1', name: 'private-channel', is_channel: true, is_private: true },
    { id: 'D1', name: 'private-dm', is_channel: false, is_private: false },
  ], response_metadata: { next_cursor: 'private-cursor' } }]);
  const result = await readProvider('slack', {}, f.request);
  assert.equal(f.calls[0].searchParams.get('types'), 'public_channel');
  assert.deepEqual(result.channels, [{ id: 'C1', name: 'public', memberCount: 8 }]); assert.ok(!JSON.stringify(result).includes('private'));
  assert.throws(() => validateReadInput('slack', { channel: 'C1', method: 'conversations.history' }), refused);
});

test('all read adapters reject URL, token and unknown-field injection before making a request', async () => {
  let calls = 0; const request = async () => { calls++; return {}; };
  for (const provider of ['github', 'google-drive', 'google-sheets', 'gmail', 'google-calendar', 'notion', 'slack']) {
    for (const input of [{ url: 'https://evil.test' }, { access_token: 'synthetic' }, { pageToken: 'https://evil.test' }, []]) await assert.rejects(readProvider(provider, input, request), refused);
  }
  for (const repository of ['https://api.github.com/org/repo', 'org/../repo', 'org/repo?url=evil', 'org/repo.git', 'org/%2e%2e', 'org/repo/other']) {
    await assert.rejects(readProvider('github', { repository }, request), refused);
  }
  assert.equal(calls, 0);
});
